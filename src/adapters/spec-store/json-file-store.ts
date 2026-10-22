// JSON spec sessions under the per-user data directory. Zod runs only while reading those files.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { SpecMutation, SpecStore, SpecStoreResult, SessionRef } from '../../application/ports.js';
import {
  SPEC_SCHEMA_VERSION,
  SPEC_SENTENCE_ID_MESSAGE,
  SPEC_SENTENCE_ID_PATTERN,
  SPEC_SESSION_ID_PATTERN,
  type Sentence,
  type SpecHistoryEntry,
  type SpecSnapshot,
  type TaggedSentence,
  type Token,
} from '../../domain/spec.js';
import { locatedErrors } from '../yaml/issue-lines.js';
import { specSessionDir, specRoot } from './data-dir.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const TOKEN_ID = /^s[1-9][0-9]*\.t[1-9][0-9]*$/;

const SentenceSchema = z.strictObject({
  id: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE),
  text: z.string(),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  hash: z.string().regex(HASH, 'hash must be sha256:<hex>'),
  section: z.string(),
  origin: z.literal('rule'),
  status: z.enum(['current', 'stale']),
  sources: z.array(z.string()),
});

const TokenSchema = z.strictObject({
  id: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  text: z.string(),
  tags: z.array(z.string()),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  origin: z.enum(['tagger', 'rule', 'agent']),
  status: z.enum(['current', 'stale']),
  sources: z.array(z.string()),
});

const TaggedSchema = z.strictObject({
  id: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE),
  status: z.enum(['current', 'stale']),
  clauses: z.array(z.string()),
  tokens: z.array(TokenSchema),
});

const SessionSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  id: z.string().regex(SPEC_SESSION_ID_PATTERN),
  specPath: z.string().min(1),
  specHash: z.string().regex(HASH, 'hash must be sha256:<hex>'),
  tagger: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
  }).optional(),
  created: z.string().min(1),
  updated: z.string().min(1),
});

const SentencesFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  sentences: z.array(SentenceSchema),
});

const TokensFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  sentences: z.array(TaggedSchema),
});

function isSessionId(id: string): boolean {
  return SPEC_SESSION_ID_PATTERN.test(id);
}

function migrationMessage(file: string, version: unknown): string {
  return `spec store schema ${String(version)} in ${file} is not supported; this Clew reads schema ${SPEC_SCHEMA_VERSION} and there is no migration yet (see docs/agent-cli.md)`;
}

function readJson(file: string): { ok: true; value: unknown } | { ok: false; fault: 'unreadable'; message: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, fault: 'unreadable', message: `cannot read ${file}: ${message}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, fault: 'unreadable', message: `invalid JSON in ${file}: ${message}` };
  }
}

function versionFault(value: unknown, file: string): { fault: 'schema' | 'unreadable'; message: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { fault: 'unreadable', message: `invalid spec store JSON in ${basename(file)}` };
  }
  if (!('schemaVersion' in value)) {
    return { fault: 'schema', message: migrationMessage(basename(file), 'missing') };
  }
  if (value.schemaVersion !== SPEC_SCHEMA_VERSION) {
    return { fault: 'schema', message: migrationMessage(basename(file), value.schemaVersion) };
  }
  return undefined;
}

function zodFault(file: string, error: z.ZodError): { fault: 'schema'; message: string } {
  const lines = locatedErrors(error.issues);
  const first = lines[0];
  if (first === undefined) return { fault: 'schema', message: `invalid spec store JSON in ${basename(file)}` };
  const where = first.path === '' ? basename(file) : `${basename(file)}: ${first.path}`;
  return { fault: 'schema', message: `invalid spec store JSON in ${where}: ${first.message}` };
}

function toSentence(raw: z.infer<typeof SentenceSchema>): Sentence | undefined {
  if (raw.span[1] < raw.span[0]) return undefined;
  const sources: string[] = [];
  for (const source of raw.sources) sources.push(source);
  return {
    id: raw.id,
    text: raw.text,
    span: [raw.span[0], raw.span[1]],
    hash: raw.hash,
    section: raw.section,
    origin: 'rule',
    status: raw.status,
    sources,
  };
}

function toToken(raw: z.infer<typeof TokenSchema>): Token | undefined {
  if (raw.span[1] < raw.span[0]) return undefined;
  const tags: string[] = [];
  for (const tag of raw.tags) tags.push(tag);
  const sources: string[] = [];
  for (const source of raw.sources) sources.push(source);
  return {
    id: raw.id,
    text: raw.text,
    tags,
    span: [raw.span[0], raw.span[1]],
    origin: raw.origin,
    status: raw.status,
    sources,
  };
}

function toTagged(raw: z.infer<typeof TaggedSchema>): TaggedSentence | undefined {
  const tokens: Token[] = [];
  for (const token of raw.tokens) {
    const built = toToken(token);
    if (built === undefined) return undefined;
    tokens.push(built);
  }
  const clauses: string[] = [];
  for (const clause of raw.clauses) clauses.push(clause);
  return { id: raw.id, status: raw.status, clauses, tokens };
}

function readSnapshot(dir: string, id: string): { ok: true; snapshot: SpecSnapshot | undefined } | SpecStoreResult & { ok: false } {
  const sessionFile = join(dir, 'session.json');
  if (!existsSync(sessionFile)) {
    const names = readdirSync(dir);
    for (const name of names) {
      if (name === '.lock') continue;
      return { ok: false, fault: 'unreadable', message: `spec session "${id}" has no session.json` };
    }
    return { ok: true, snapshot: undefined };
  }
  const sessionRead = readJson(sessionFile);
  if (!sessionRead.ok) return sessionRead;
  const sessionVersion = versionFault(sessionRead.value, sessionFile);
  if (sessionVersion !== undefined) return { ok: false, fault: sessionVersion.fault, message: sessionVersion.message };
  const sessionParsed = SessionSchema.safeParse(sessionRead.value);
  if (!sessionParsed.success) return { ok: false, ...zodFault(sessionFile, sessionParsed.error) };
  if (sessionParsed.data.id !== id) {
    return { ok: false, fault: 'schema', message: `session.json id "${sessionParsed.data.id}" does not match directory "${id}"` };
  }

  const sentencesFile = join(dir, 'sentences.json');
  const sentencesRead = readJson(sentencesFile);
  if (!sentencesRead.ok) return sentencesRead;
  const sentencesVersion = versionFault(sentencesRead.value, sentencesFile);
  if (sentencesVersion !== undefined) return { ok: false, fault: sentencesVersion.fault, message: sentencesVersion.message };
  const sentencesParsed = SentencesFileSchema.safeParse(sentencesRead.value);
  if (!sentencesParsed.success) return { ok: false, ...zodFault(sentencesFile, sentencesParsed.error) };
  const sentences: Sentence[] = [];
  for (const raw of sentencesParsed.data.sentences) {
    const sentence = toSentence(raw);
    if (sentence === undefined) return { ok: false, fault: 'schema', message: `invalid spec store JSON in ${basename(sentencesFile)}: span ends before it starts` };
    sentences.push(sentence);
  }

  const tokensFile = join(dir, 'tokens.json');
  let tagged: TaggedSentence[] = [];
  if (existsSync(tokensFile)) {
    const tokensRead = readJson(tokensFile);
    if (!tokensRead.ok) return tokensRead;
    const tokensVersion = versionFault(tokensRead.value, tokensFile);
    if (tokensVersion !== undefined) return { ok: false, fault: tokensVersion.fault, message: tokensVersion.message };
    const tokensParsed = TokensFileSchema.safeParse(tokensRead.value);
    if (!tokensParsed.success) return { ok: false, ...zodFault(tokensFile, tokensParsed.error) };
    for (const raw of tokensParsed.data.sentences) {
      const item = toTagged(raw);
      if (item === undefined) return { ok: false, fault: 'schema', message: `invalid spec store JSON in ${basename(tokensFile)}: span ends before it starts` };
      tagged.push(item);
    }
  }

  const snapshot: SpecSnapshot = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    id: sessionParsed.data.id,
    specPath: sessionParsed.data.specPath,
    specHash: sessionParsed.data.specHash,
    created: sessionParsed.data.created,
    updated: sessionParsed.data.updated,
    sentences,
    tagged,
  };
  if (sessionParsed.data.tagger !== undefined) {
    snapshot.tagger = { name: sessionParsed.data.tagger.name, version: sessionParsed.data.tagger.version };
  }
  return { ok: true, snapshot };
}

function sentenceRecord(sentence: Sentence): z.infer<typeof SentenceSchema> {
  const sources: string[] = [];
  for (const source of sentence.sources) sources.push(source);
  return {
    id: sentence.id,
    text: sentence.text,
    span: [sentence.span[0], sentence.span[1]],
    hash: sentence.hash,
    section: sentence.section,
    origin: 'rule',
    status: sentence.status,
    sources,
  };
}

function tokenRecord(token: Token): z.infer<typeof TokenSchema> {
  const tags: string[] = [];
  for (const tag of token.tags) tags.push(tag);
  const sources: string[] = [];
  for (const source of token.sources) sources.push(source);
  return {
    id: token.id,
    text: token.text,
    tags,
    span: [token.span[0], token.span[1]],
    origin: token.origin,
    status: token.status,
    sources,
  };
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

function writeSnapshot(dir: string, snapshot: SpecSnapshot, history: SpecHistoryEntry | undefined): void {
  const session: Record<string, unknown> = {
    schemaVersion: snapshot.schemaVersion,
    id: snapshot.id,
    specPath: snapshot.specPath,
    specHash: snapshot.specHash,
    created: snapshot.created,
    updated: snapshot.updated,
  };
  if (snapshot.tagger !== undefined) session.tagger = { name: snapshot.tagger.name, version: snapshot.tagger.version };
  writeJson(join(dir, 'session.json'), session);
  const sentences = [];
  for (const sentence of snapshot.sentences) sentences.push(sentenceRecord(sentence));
  writeJson(join(dir, 'sentences.json'), { schemaVersion: snapshot.schemaVersion, sentences });
  const tagged = [];
  for (const item of snapshot.tagged) {
    const clauses: string[] = [];
    for (const clause of item.clauses) clauses.push(clause);
    const tokens = [];
    for (const token of item.tokens) tokens.push(tokenRecord(token));
    tagged.push({ id: item.id, status: item.status, clauses, tokens });
  }
  writeJson(join(dir, 'tokens.json'), { schemaVersion: snapshot.schemaVersion, sentences: tagged });
  if (history !== undefined) appendFileSync(join(dir, 'history.jsonl'), `${JSON.stringify(historyRecord(history))}\n`);
}

function historyRecord(entry: SpecHistoryEntry): { at: string; command: string; args: { spec?: string; session: string; sentence?: string }; before: string[]; after: string[] } {
  const args: { spec?: string; session: string; sentence?: string } = { session: entry.args.session };
  if (entry.args.spec !== undefined) args.spec = entry.args.spec;
  if (entry.args.sentence !== undefined) args.sentence = entry.args.sentence;
  const before: string[] = [];
  for (const id of entry.before) before.push(id);
  const after: string[] = [];
  for (const id of entry.after) after.push(id);
  return { at: entry.at, command: entry.command, args, before, after };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return code === 'EPERM';
  }
}

function stealStaleLock(lockPath: string): boolean {
  let pid: number | undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'pid' in raw && typeof raw.pid === 'number') pid = raw.pid;
  } catch {
    return false;
  }
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0 || pid === process.pid || pidAlive(pid)) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

function acquireLock(dir: string, id: string): { ok: true; release: () => void } | { ok: false; message: string } {
  const lockPath = join(dir, '.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid }));
      } finally {
        closeSync(fd);
      }
      return {
        ok: true,
        release() {
          try {
            unlinkSync(lockPath);
          } catch {
            // The lock is already gone.
          }
        },
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `cannot lock spec session "${id}": ${message}` };
      }
      if (attempt === 0 && stealStaleLock(lockPath)) continue;
      return { ok: false, message: `spec session "${id}" is locked by another process` };
    }
  }
  return { ok: false, message: `spec session "${id}" is locked by another process` };
}

function listSpecPath(dir: string): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'specPath' in raw && typeof raw.specPath === 'string') return raw.specPath;
  } catch {
    return '';
  }
  return '';
}

export const jsonSpecStore: SpecStore = {
  listSessions() {
    const root = specRoot();
    if (!existsSync(root)) return [];
    const refs: SessionRef[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSessionId(entry.name)) continue;
      refs.push({ id: entry.name, specPath: listSpecPath(join(root, entry.name)) });
    }
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    return refs;
  },

  update(id, options, mutate) {
    if (!isSessionId(id)) return { ok: false, fault: 'unreadable', message: `session id "${id}" is not a safe name` };
    const dir = specSessionDir(id);
    if (!existsSync(dir)) {
      if (!options.create) return { ok: false, fault: 'missing', message: `no spec session "${id}"` };
      mkdirSync(dir, { recursive: true });
    }
    const lock = acquireLock(dir, id);
    if (!lock.ok) return { ok: false, fault: 'locked', message: lock.message };
    try {
      const loaded = readSnapshot(dir, id);
      if (!loaded.ok) return loaded;
      if (loaded.snapshot === undefined && !options.create) {
        return { ok: false, fault: 'unreadable', message: `spec session "${id}" has no session.json` };
      }
      let mutation: SpecMutation | undefined;
      try {
        mutation = mutate(loaded.snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, fault: 'unreadable', message };
      }
      if (mutation === undefined) {
        if (loaded.snapshot === undefined) return { ok: false, fault: 'unreadable', message: `spec session "${id}" was not created` };
        return { ok: true, snapshot: loaded.snapshot };
      }
      writeSnapshot(dir, mutation.snapshot, mutation.history);
      return { ok: true, snapshot: mutation.snapshot };
    } finally {
      lock.release();
    }
  },
};
