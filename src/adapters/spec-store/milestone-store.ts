// Milestones of a spec session, stored beside it: milestones.json lists the records, and milestones/<id>/ holds a
// frozen copy of the session's data files as they were when the milestone was closed. history.jsonl is not copied:
// it is append-only, and each record names the range of its lines. Zod runs only while reading these files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FrozenVersion, MilestoneStore } from '../../application/ports.js';
import { SPEC_SESSION_ID_PATTERN, type SpecHistoryEntry } from '../../domain/spec.js';
import { MILESTONE_ID_PATTERN, type Milestone } from '../../domain/spec-versions.js';
import { readCanonState } from '../canon/canon-files.js';
import { specSessionDir } from './data-dir.js';
import { acquireLock, readSnapshot } from './json-file-store.js';

/**
 * The session files a milestone freezes. Everything a version is read from: the sentence layers, the frames path's
 * layers, and the canonical lexicon. Not history.jsonl (ranges point into it), the viewer, or the milestones.
 */
export const SNAPSHOT_FILES = ['session.json', 'sentences.json', 'tokens.json', 'spans.json', 'concepts.json', 'frames.json', 'flows.json', 'canon.json', 'workflows.json', 'projections.json'] as const;

const INDEX_FILE = 'milestones.json';
const SNAPSHOT_DIR = 'milestones';

const Range = z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() });
const Counts = z.strictObject({
  live: z.number().int().nonnegative(),
  frames: z.number().int().nonnegative().optional(),
  accepted: z.number().int().nonnegative().optional(),
  dangling: z.number().int().nonnegative().optional(),
  actions: z.number().int().nonnegative().optional(),
});
const Words = z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()) });
const LexiconDiff = z.strictObject({
  actors: Words.optional(),
  terms: Words.optional(),
  states: Words.optional(),
  verbs: Words.optional(),
  fixed: Words.optional(),
  instances: z.array(z.strictObject({ noun: z.string(), from: z.number().int().optional(), to: z.number().int().optional() })).optional(),
});
const ActionDiff = z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()), changed: z.array(z.string()) });
const MilestoneSchema = z.strictObject({
  id: z.string().regex(MILESTONE_ID_PATTERN),
  title: z.string().min(1),
  goal: z.string().min(1),
  decisions: z.array(z.string().min(1)),
  who: z.string().min(1),
  at: z.string().min(1),
  previous: z.string().min(1),
  history: Range,
  canon: Range,
  digest: z.strictObject({
    before: Counts,
    after: Counts,
    added: z.array(z.string()),
    deleted: z.array(z.string()),
    edited: z.array(z.string()),
    lexicon: LexiconDiff.optional(),
    actions: ActionDiff.optional(),
    commands: z.record(z.string(), z.number().int().nonnegative()),
  }),
});
const IndexSchema = z.strictObject({ schemaVersion: z.literal(1), milestones: z.array(MilestoneSchema) });

const HistoryLine = z.object({
  at: z.string(),
  command: z.string(),
  args: z.record(z.string(), z.unknown()),
  before: z.array(z.string()),
  after: z.array(z.string()),
});

type Read<T> = ({ ok: true } & T) | { ok: false; fault: 'missing' | 'locked' | 'schema' | 'unreadable'; message: string };

function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Milestone records as data: zod's parsed object, with the optional fields that are absent left out. */
function toMilestone(raw: z.infer<typeof MilestoneSchema>): Milestone {
  return JSON.parse(JSON.stringify(raw)) as Milestone;
}

export function jsonMilestoneStore(env: NodeJS.ProcessEnv = process.env): MilestoneStore {
  const sessionDir = (session: string): Read<{ dir: string }> => {
    if (!SPEC_SESSION_ID_PATTERN.test(session)) return { ok: false, fault: 'unreadable', message: `session id "${session}" is not a safe name` };
    const dir = specSessionDir(session, env);
    if (!existsSync(dir)) return { ok: false, fault: 'missing', message: `no spec session "${session}"` };
    return { ok: true, dir };
  };

  const readIndex = (dir: string): Read<{ milestones: Milestone[] }> => {
    const file = join(dir, INDEX_FILE);
    if (!existsSync(file)) return { ok: true, milestones: [] };
    try {
      const parsed = IndexSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success) return { ok: false, fault: 'schema', message: `${file}: ${issueText(parsed.error)}` };
      return { ok: true, milestones: parsed.data.milestones.map(toMilestone) };
    } catch (error) {
      return { ok: false, fault: 'unreadable', message: `${file}: ${message(error)}` };
    }
  };

  const readLog = (dir: string): Read<{ history: SpecHistoryEntry[] }> => {
    const file = join(dir, 'history.jsonl');
    if (!existsSync(file)) return { ok: true, history: [] };
    const history: SpecHistoryEntry[] = [];
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return { ok: false, fault: 'unreadable', message: `${file}: ${message(error)}` };
    }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.trim() === '') continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (error) {
        return { ok: false, fault: 'schema', message: `${file} line ${index + 1}: ${message(error)}` };
      }
      const parsed = HistoryLine.safeParse(raw);
      if (!parsed.success) return { ok: false, fault: 'schema', message: `${file} line ${index + 1}: ${issueText(parsed.error)}` };
      // The store wrote the line from a SpecHistoryEntry; it is read back as one.
      history.push(parsed.data as unknown as SpecHistoryEntry);
    }
    return { ok: true, history };
  };

  const readFrozen = (dir: string, session: string): Read<{ frozen: FrozenVersion }> => {
    const loaded = readSnapshot(dir, session);
    if (!loaded.ok) return { ok: false, fault: loaded.fault === 'locked' ? 'unreadable' : loaded.fault, message: loaded.message };
    if (loaded.snapshot === undefined) return { ok: false, fault: 'unreadable', message: `${dir} has no session.json` };
    const canon = readCanonState(join(dir, 'canon.json'));
    if (!canon.ok) return { ok: false, fault: 'schema', message: canon.message };
    return { ok: true, frozen: { snapshot: loaded.snapshot, canon: canon.state } };
  };

  return {
    list(session) {
      const located = sessionDir(session);
      if (!located.ok) return located;
      return readIndex(located.dir);
    },

    read(session, id) {
      const located = sessionDir(session);
      if (!located.ok) return located;
      if (!MILESTONE_ID_PATTERN.test(id)) return { ok: false, fault: 'missing', message: `no milestone "${id}"` };
      const dir = join(located.dir, SNAPSHOT_DIR, id);
      if (!existsSync(dir)) return { ok: false, fault: 'missing', message: `milestone ${id} has no frozen copy at ${dir}` };
      return readFrozen(dir, session);
    },

    log(session) {
      const located = sessionDir(session);
      if (!located.ok) return located;
      return readLog(located.dir);
    },

    close(session, build) {
      const located = sessionDir(session);
      if (!located.ok) return located;
      const dir = located.dir;
      const lock = acquireLock(dir, session);
      if (!lock.ok) return { ok: false, fault: 'locked', message: lock.message };
      try {
        const now = readFrozen(dir, session);
        if (!now.ok) return now;
        const index = readIndex(dir);
        if (!index.ok) return index;
        const log = readLog(dir);
        if (!log.ok) return log;
        const built = build({ snapshot: now.frozen.snapshot, canon: now.frozen.canon, history: log.history, milestones: index.milestones });
        if (!built.ok) return { ok: false, fault: 'refused', message: built.message };
        const milestone = built.milestone;
        if (index.milestones.some((item) => item.id === milestone.id)) return { ok: false, fault: 'unreadable', message: `milestone ${milestone.id} already exists` };
        // Freeze into a temporary folder, rename it into place, then append the record. A failure leaves no record.
        const root = join(dir, SNAPSHOT_DIR);
        const target = join(root, milestone.id);
        const temporary = join(root, `.${milestone.id}.${process.pid}.tmp`);
        try {
          mkdirSync(root, { recursive: true });
          if (existsSync(target)) rmSync(target, { recursive: true });
          rmSync(temporary, { recursive: true, force: true });
          mkdirSync(temporary);
          for (const file of SNAPSHOT_FILES) {
            if (existsSync(join(dir, file))) copyFileSync(join(dir, file), join(temporary, file));
          }
          renameSync(temporary, target);
          const file = join(dir, INDEX_FILE);
          const staged = `${file}.${process.pid}.tmp`;
          writeFileSync(staged, `${JSON.stringify({ schemaVersion: 1, milestones: [...index.milestones, milestone] }, null, 2)}\n`);
          renameSync(staged, file);
        } catch (error) {
          rmSync(temporary, { recursive: true, force: true });
          return { ok: false, fault: 'unreadable', message: `cannot freeze milestone ${milestone.id}: ${message(error)}` };
        }
        return { ok: true, milestone };
      } finally {
        lock.release();
      }
    },
  };
}
