// JSON spec sessions under the per-user data directory. Zod runs only while reading those files.
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync, type Stats } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { SpecMutation, SpecRemovalResult, SpecSessionCounts, SpecSessionSummary, SpecStore, SpecStoreResult } from '../../application/ports.js';
import {
  SPEC_CONCEPT_ID_MESSAGE,
  SPEC_CONCEPT_ID_PATTERN,
  SPEC_FRAME_ID_MESSAGE,
  SPEC_FRAME_ID_PATTERN,
  SPEC_SCHEMA_VERSION,
  SPEC_SENTENCE_ID_MESSAGE,
  SPEC_SENTENCE_ID_PATTERN,
  SPEC_SESSION_ID_PATTERN,
  type Concept,
  type DraftGraph,
  type Field,
  type FieldVersion,
  type Frame,
  type GraphState,
  type Grouping,
  type GraphTransition,
  type LiveSpan,
  type Revision,
  type Role,
  copySentence,
  type Sentence,
  type SentenceText,
  type SpecFlow,
  type SpecHistoryEntry,
  type SpecSnapshot,
  type TaggedSentence,
  type Token,
} from '../../domain/spec.js';
import { attachOverlay } from '../../domain/spec-graph.js';
import { compileFrames } from '../../domain/spec-compile.js';
import { WORKFLOW_ID_PATTERN, WORKFLOW_WORD_PATTERN } from '../../domain/workflow.js';
import { locatedErrors } from '../yaml/issue-lines.js';
import { specSessionDir, specRoot } from './data-dir.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const TOKEN_ID = /^s[1-9][0-9]*\.t[1-9][0-9]*$/;
const SPAN_ID = /^sp:s[1-9][0-9]*\.t[1-9][0-9]*\.\.s[1-9][0-9]*\.t[1-9][0-9]*$/;

const SentenceTextSchema = z.strictObject({
  text: z.string(),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  hash: z.string().regex(HASH, 'hash must be sha256:<hex>'),
  section: z.string(),
}).refine((text) => text.span[1] >= text.span[0], 'span ends before it starts');

const SentenceRevisionSchema = z.strictObject({
  at: z.string().min(1),
  who: z.string().min(1),
  reason: z.string().min(1),
  finding: z.string().min(1).optional(),
  comment: z.string().min(1).optional(),
  value: SentenceTextSchema.nullable(),
});

const SentenceSchema = z.strictObject({
  id: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE),
  original: SentenceTextSchema.nullable(),
  latest: SentenceTextSchema.nullable(),
  history: z.array(SentenceRevisionSchema),
});

const ClauseBoundSchema = z.strictObject({
  text: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const TokenSchema = z.strictObject({
  id: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  text: z.string(),
  tags: z.array(z.string()),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  origin: z.enum(['tagger', 'rule', 'agent']),
  status: z.enum(['current', 'stale']),
  sources: z.array(z.string()),
  skipped: z.boolean().optional(),
  lemma: z.string().min(1).optional(),
  participle: z.string().min(1).optional(),
  clause: ClauseBoundSchema.optional(),
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

const LiveSpanSchema = z.strictObject({
  id: z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2'),
  firstTokenId: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  lastTokenId: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  surface: z.string(),
  tags: z.array(z.string()),
  origin: z.enum(['promote', 'lexicon', 'interactive']),
  lexiconEntryId: z.string().min(1).optional(),
  explicitlySet: z.boolean(),
  entityId: z.string().regex(SPEC_CONCEPT_ID_PATTERN, SPEC_CONCEPT_ID_MESSAGE).optional(),
  entityLinkExplicitlySet: z.boolean(),
  insignificant: z.boolean().optional(),
  clause: ClauseBoundSchema,
  lemma: z.string().min(1).optional(),
  participle: z.string().min(1).optional(),
});

const SpansFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  spans: z.array(LiveSpanSchema),
});

const ConceptSchema = z.strictObject({
  id: z.string().regex(SPEC_CONCEPT_ID_PATTERN, SPEC_CONCEPT_ID_MESSAGE),
  canonical: z.string().min(1),
  members: z.array(z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2')),
});

const RoleSchema = z.union([
  z.literal('unknown'),
  z.strictObject({ text: z.string().min(1), refs: z.array(z.string().min(1)) }),
]);

const FieldVersionSchema = z.strictObject({
  value: RoleSchema,
  dependsOn: z.array(z.string().min(1)),
});

function revisionSchema<T extends z.ZodType>(value: T) {
  return z.strictObject({
    at: z.string().min(1),
    who: z.string().min(1),
    reason: z.string().min(1),
    finding: z.string().min(1).optional(),
    comment: z.string().min(1).optional(),
    value,
  });
}

const FieldSchema = z.strictObject({
  original: FieldVersionSchema,
  latest: FieldVersionSchema,
  history: z.array(revisionSchema(FieldVersionSchema)),
});

const FrameVersionSchema = z.strictObject({
  notTransition: z.strictObject({ reason: z.string().min(1) }).nullable(),
});

const FrameSchema = z.strictObject({
  id: z.string().regex(SPEC_FRAME_ID_PATTERN, SPEC_FRAME_ID_MESSAGE),
  sentence: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE),
  clause: ClauseBoundSchema,
  marker: z.string().min(1).optional(),
  negated: z.literal(true).optional(),
  notTransition: z.strictObject({ reason: z.string().min(1), who: z.string().min(1).optional() }).optional(),
  roles: z.strictObject({
    actor: FieldSchema,
    event: FieldSchema,
    object: FieldSchema,
    result: FieldSchema,
    when: FieldSchema,
  }),
  history: z.array(revisionSchema(FrameVersionSchema)),
});

const ConceptRef = z.string().regex(SPEC_CONCEPT_ID_PATTERN, SPEC_CONCEPT_ID_MESSAGE).nullable();
const SpanRef = z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2');

const GroupingSchema = z.strictObject({
  span: SpanRef,
  original: ConceptRef,
  latest: ConceptRef,
  dependsOn: z.array(z.string().min(1)),
  history: z.array(revisionSchema(z.strictObject({ concept: ConceptRef, dependsOn: z.array(z.string().min(1)) }))),
});

const ConceptsFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  concepts: z.array(ConceptSchema),
  groups: z.array(GroupingSchema),
});

const FramesFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  frames: z.array(FrameSchema),
});

const GraphStateSchema = z.strictObject({
  id: z.string().regex(WORKFLOW_WORD_PATTERN),
  object: z.string().regex(WORKFLOW_WORD_PATTERN),
  initial: z.literal(true).optional(),
  final: z.literal(true).optional(),
  frames: z.array(z.string()),
});

const GraphTransitionSchema = z.strictObject({
  id: z.string().min(1),
  from: z.string().regex(WORKFLOW_WORD_PATTERN),
  event: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'events are UPPER_SNAKE_CASE'),
  to: z.string().regex(WORKFLOW_WORD_PATTERN),
  actor: z.string().regex(WORKFLOW_WORD_PATTERN).optional(),
  guard: z.string().regex(/^condition:[a-z][a-z0-9_]*$/, 'guards look like condition:<var>').optional(),
  object: z.string().regex(WORKFLOW_WORD_PATTERN),
  frame: z.string().regex(SPEC_FRAME_ID_PATTERN, SPEC_FRAME_ID_MESSAGE),
  frames: z.array(z.string()),
});

const OverlayId = z.string().regex(SPEC_FRAME_ID_PATTERN, 'flow steps are frame ids');

const FlowSchema = z.strictObject({
  id: z.string().regex(WORKFLOW_ID_PATTERN),
  title: z.string().min(1),
  expect: z.enum(['accepted', 'rejected']),
  rejectAt: z.number().int().positive().optional(),
  transitions: z.array(OverlayId),
  forbidden: z.string().regex(SPEC_FRAME_ID_PATTERN, SPEC_FRAME_ID_MESSAGE).optional(),
  origin: z.enum(['rule', 'agent']),
}).superRefine((flow, context) => {
  if (flow.expect === 'accepted' && flow.transitions.length < 1) {
    context.addIssue({ code: 'custom', message: 'an accepted flow needs a frame', path: ['transitions'] });
  }
  if (flow.expect === 'rejected' && flow.rejectAt === undefined) {
    context.addIssue({ code: 'custom', message: 'a rejected flow needs rejectAt', path: ['rejectAt'] });
  }
  if (flow.expect === 'rejected' && flow.transitions.length === 0 && flow.forbidden === undefined) {
    context.addIssue({ code: 'custom', message: 'a rejected flow needs a frame or a forbidden frame', path: ['forbidden'] });
  }
});

const GraphFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  objects: z.array(z.string()),
  states: z.array(GraphStateSchema),
  transitions: z.array(GraphTransitionSchema),
  flows: z.array(FlowSchema),
});

const OverlayFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  flows: z.array(FlowSchema),
});

function isSessionId(id: string): boolean {
  return SPEC_SESSION_ID_PATTERN.test(id);
}

function migrationMessage(file: string, version: unknown): string {
  return `spec store schema ${String(version)} in ${file} is not supported; this Clew reads schema ${SPEC_SCHEMA_VERSION} with no migration — drop the old session and re-run clew spec init / tag (see docs/agent-cli.md)`;
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

function toSentence(raw: z.infer<typeof SentenceSchema>): Sentence {
  const history: Sentence['history'] = [];
  for (const revision of raw.history) {
    const entry: Sentence['history'][number] = {
      at: revision.at,
      who: revision.who,
      reason: revision.reason,
      value: revision.value === null ? null : toSentenceText(revision.value),
    };
    if (revision.finding !== undefined) entry.finding = revision.finding;
    if (revision.comment !== undefined) entry.comment = revision.comment;
    history.push(entry);
  }
  return {
    id: raw.id,
    original: raw.original === null ? null : toSentenceText(raw.original),
    latest: raw.latest === null ? null : toSentenceText(raw.latest),
    history,
  };
}

function toSentenceText(raw: z.infer<typeof SentenceTextSchema>): SentenceText {
  return { text: raw.text, span: [raw.span[0], raw.span[1]], hash: raw.hash, section: raw.section };
}

function toToken(raw: z.infer<typeof TokenSchema>): Token | undefined {
  if (raw.span[1] < raw.span[0]) return undefined;
  const tags: string[] = [];
  for (const tag of raw.tags) tags.push(tag);
  const sources: string[] = [];
  for (const source of raw.sources) sources.push(source);
  const token: Token = {
    id: raw.id,
    text: raw.text,
    tags,
    span: [raw.span[0], raw.span[1]],
    origin: raw.origin,
    status: raw.status,
    sources,
  };
  if (raw.skipped === true) token.skipped = true;
  if (raw.lemma !== undefined) token.lemma = raw.lemma;
  if (raw.participle !== undefined) token.participle = raw.participle;
  if (raw.clause !== undefined) {
    token.clause = { text: raw.clause.text, start: raw.clause.start, end: raw.clause.end };
  }
  return token;
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

function toLiveSpan(raw: z.infer<typeof LiveSpanSchema>): LiveSpan {
  const tags: string[] = [];
  for (const tag of raw.tags) tags.push(tag);
  const span: LiveSpan = {
    id: raw.id,
    firstTokenId: raw.firstTokenId,
    lastTokenId: raw.lastTokenId,
    range: [raw.range[0], raw.range[1]],
    surface: raw.surface,
    tags,
    origin: raw.origin,
    explicitlySet: raw.explicitlySet,
    entityLinkExplicitlySet: raw.entityLinkExplicitlySet,
    clause: { text: raw.clause.text, start: raw.clause.start, end: raw.clause.end },
  };
  if (raw.lexiconEntryId !== undefined) span.lexiconEntryId = raw.lexiconEntryId;
  if (raw.entityId !== undefined) span.entityId = raw.entityId;
  if (raw.insignificant !== undefined) span.insignificant = raw.insignificant;
  if (raw.lemma !== undefined) span.lemma = raw.lemma;
  if (raw.participle !== undefined) span.participle = raw.participle;
  return span;
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
  for (const raw of sentencesParsed.data.sentences) sentences.push(toSentence(raw));

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
    specHash: sessionParsed.data.specHash,
    created: sessionParsed.data.created,
    updated: sessionParsed.data.updated,
    sentences,
    tagged,
  };
  if (sessionParsed.data.tagger !== undefined) {
    snapshot.tagger = { name: sessionParsed.data.tagger.name, version: sessionParsed.data.tagger.version };
  }

  const spansFile = join(dir, 'spans.json');
  if (existsSync(spansFile)) {
    const spansRead = readJson(spansFile);
    if (!spansRead.ok) return spansRead;
    const spansVersion = versionFault(spansRead.value, spansFile);
    if (spansVersion !== undefined) return { ok: false, fault: spansVersion.fault, message: spansVersion.message };
    const spansParsed = SpansFileSchema.safeParse(spansRead.value);
    if (!spansParsed.success) return { ok: false, ...zodFault(spansFile, spansParsed.error) };
    const spans: LiveSpan[] = [];
    for (const raw of spansParsed.data.spans) spans.push(toLiveSpan(raw));
    snapshot.spans = spans;
  }

  const conceptsFile = join(dir, 'concepts.json');
  if (existsSync(conceptsFile)) {
    const conceptsRead = readJson(conceptsFile);
    if (!conceptsRead.ok) return conceptsRead;
    const conceptsVersion = versionFault(conceptsRead.value, conceptsFile);
    if (conceptsVersion !== undefined) return { ok: false, fault: conceptsVersion.fault, message: conceptsVersion.message };
    const conceptsParsed = ConceptsFileSchema.safeParse(conceptsRead.value);
    if (!conceptsParsed.success) return { ok: false, ...zodFault(conceptsFile, conceptsParsed.error) };
    const concepts: Concept[] = [];
    for (const raw of conceptsParsed.data.concepts) concepts.push({ id: raw.id, canonical: raw.canonical, members: raw.members.slice() });
    snapshot.concepts = concepts;
    const groups: Grouping[] = [];
    for (const raw of conceptsParsed.data.groups) {
      groups.push({
        span: raw.span,
        original: raw.original,
        latest: raw.latest,
        dependsOn: raw.dependsOn.slice(),
        history: toHistory(raw.history, (value) => ({ concept: value.concept, dependsOn: value.dependsOn.slice() })),
      });
    }
    snapshot.groups = groups;
  }

  const framesFile = join(dir, 'frames.json');
  if (existsSync(framesFile)) {
    const framesRead = readJson(framesFile);
    if (!framesRead.ok) return framesRead;
    const framesVersion = versionFault(framesRead.value, framesFile);
    if (framesVersion !== undefined) return { ok: false, fault: framesVersion.fault, message: framesVersion.message };
    const framesParsed = FramesFileSchema.safeParse(framesRead.value);
    if (!framesParsed.success) return { ok: false, ...zodFault(framesFile, framesParsed.error) };
    const frames: Frame[] = [];
    for (const raw of framesParsed.data.frames) frames.push(toFrame(raw));
    snapshot.frames = frames;
  }

  const overlay = readOverlay(dir, snapshot.concepts ?? [], snapshot.frames ?? []);
  if (!overlay.ok) return overlay;
  if (overlay.graph !== undefined) snapshot.graph = overlay.graph;
  return { ok: true, snapshot };
}

function toFrame(raw: z.infer<typeof FrameSchema>): Frame {
  const frame: Frame = {
    id: raw.id,
    sentence: raw.sentence,
    clause: { text: raw.clause.text, start: raw.clause.start, end: raw.clause.end },
    roles: {
      actor: toField(raw.roles.actor),
      event: toField(raw.roles.event),
      object: toField(raw.roles.object),
      result: toField(raw.roles.result),
      when: toField(raw.roles.when),
    },
    history: toHistory(raw.history, (value) => ({ notTransition: value.notTransition === null ? null : { reason: value.notTransition.reason } })),
  };
  if (raw.marker !== undefined) frame.marker = raw.marker;
  if (raw.negated === true) frame.negated = true;
  if (raw.notTransition !== undefined) {
    frame.notTransition = { reason: raw.notTransition.reason };
    if (raw.notTransition.who !== undefined) frame.notTransition.who = raw.notTransition.who;
  }
  return frame;
}

function toField(raw: z.infer<typeof FieldSchema>): Field {
  return { original: toFieldVersion(raw.original), latest: toFieldVersion(raw.latest), history: toHistory(raw.history, toFieldVersion) };
}

interface RawRevision<R> {
  at: string;
  who: string;
  reason: string;
  finding?: string | undefined;
  comment?: string | undefined;
  value: R;
}

function toHistory<R, T>(raw: readonly RawRevision<R>[], value: (item: R) => T): Revision<T>[] {
  const history: Revision<T>[] = [];
  for (const revision of raw) {
    const entry: Revision<T> = { at: revision.at, who: revision.who, reason: revision.reason, value: value(revision.value) };
    if (revision.finding !== undefined) entry.finding = revision.finding;
    if (revision.comment !== undefined) entry.comment = revision.comment;
    history.push(entry);
  }
  return history;
}

function toFieldVersion(raw: z.infer<typeof FieldVersionSchema>): FieldVersion {
  return { value: toRole(raw.value), dependsOn: raw.dependsOn.slice() };
}

function toRole(raw: z.infer<typeof RoleSchema>): Role {
  return raw === 'unknown' ? 'unknown' : { text: raw.text, refs: raw.refs.slice() };
}

function readOverlay(
  dir: string,
  concepts: readonly Concept[],
  frames: readonly Frame[],
): { ok: true; graph?: DraftGraph } | { ok: false; fault: 'schema' | 'unreadable'; message: string } {
  const overlayFile = join(dir, 'flows.json');
  if (existsSync(overlayFile)) {
    const overlayRead = readJson(overlayFile);
    if (!overlayRead.ok) return overlayRead;
    const overlayVersion = versionFault(overlayRead.value, overlayFile);
    if (overlayVersion !== undefined) return { ok: false, fault: overlayVersion.fault, message: overlayVersion.message };
    const overlayParsed = OverlayFileSchema.safeParse(overlayRead.value);
    if (!overlayParsed.success) return { ok: false, ...zodFault(overlayFile, overlayParsed.error) };
    return { ok: true, graph: attachOverlay(compileFrames(frames, concepts).compiled, overlayFlows(overlayParsed.data.flows, [])) };
  }
  const graphFile = join(dir, 'graph.json');
  if (!existsSync(graphFile)) return { ok: true };
  const graphRead = readJson(graphFile);
  if (!graphRead.ok) return graphRead;
  const graphVersion = versionFault(graphRead.value, graphFile);
  if (graphVersion !== undefined) return { ok: false, fault: graphVersion.fault, message: graphVersion.message };
  const graphParsed = GraphFileSchema.safeParse(graphRead.value);
  if (!graphParsed.success) return { ok: false, ...zodFault(graphFile, graphParsed.error) };
  return { ok: true, graph: toGraph(graphParsed.data) };
}

function toGraph(raw: z.infer<typeof GraphFileSchema>): DraftGraph {
  const objects: string[] = [];
  for (const object of raw.objects) objects.push(object);
  const states: GraphState[] = [];
  for (const state of raw.states) {
    const frames: string[] = [];
    for (const frame of state.frames) frames.push(frame);
    const built: GraphState = { id: state.id, object: state.object, frames };
    if (state.initial === true) built.initial = true;
    if (state.final === true) built.final = true;
    states.push(built);
  }
  const transitions: GraphTransition[] = [];
  for (const transition of raw.transitions) {
    const frames: string[] = [];
    for (const frame of transition.frames) frames.push(frame);
    const built: GraphTransition = {
      id: transition.id,
      from: transition.from,
      event: transition.event,
      to: transition.to,
      object: transition.object,
      frame: transition.frame,
      frames,
    };
    if (transition.actor !== undefined) built.actor = transition.actor;
    if (transition.guard !== undefined) built.guard = transition.guard;
    transitions.push(built);
  }
  const flows: SpecFlow[] = [];
  for (const flow of raw.flows) {
    const transitionIds: string[] = [];
    for (const id of flow.transitions) transitionIds.push(id);
    const built: SpecFlow = {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      transitions: transitionIds,
      origin: flow.origin,
    };
    if (flow.rejectAt !== undefined) built.rejectAt = flow.rejectAt;
    if (flow.forbidden !== undefined) built.forbidden = flow.forbidden;
    flows.push(built);
  }
  return { objects, states, transitions, flows };
}

function overlayFlows(
  raw: readonly z.infer<typeof FlowSchema>[],
  transitions: readonly z.infer<typeof GraphTransitionSchema>[],
): SpecFlow[] {
  const frameOf = new Map<string, string>();
  for (const transition of transitions) frameOf.set(transition.id, transition.frame);
  const flows: SpecFlow[] = [];
  for (const flow of raw) {
    const ids: string[] = [];
    for (const id of flow.transitions) ids.push(frameOf.get(id) ?? id);
    const built: SpecFlow = {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      transitions: ids,
      origin: flow.origin,
    };
    if (flow.rejectAt !== undefined) built.rejectAt = flow.rejectAt;
    if (flow.forbidden !== undefined) built.forbidden = flow.forbidden;
    flows.push(built);
  }
  return flows;
}

function overlayRecord(schemaVersion: number, flows: readonly SpecFlow[]): z.infer<typeof OverlayFileSchema> {
  const records: z.infer<typeof FlowSchema>[] = [];
  for (const flow of flows) {
    const ids: string[] = [];
    for (const id of flow.transitions) ids.push(id);
    const record: z.infer<typeof FlowSchema> = {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      transitions: ids,
      origin: flow.origin,
    };
    if (flow.rejectAt !== undefined) record.rejectAt = flow.rejectAt;
    if (flow.forbidden !== undefined) record.forbidden = flow.forbidden;
    records.push(record);
  }
  return { schemaVersion: schemaVersion as typeof SPEC_SCHEMA_VERSION, flows: records };
}

function sentenceRecord(sentence: Sentence): z.infer<typeof SentenceSchema> {
  return copySentence(sentence);
}

function tokenRecord(token: Token): z.infer<typeof TokenSchema> {
  const tags: string[] = [];
  for (const tag of token.tags) tags.push(tag);
  const sources: string[] = [];
  for (const source of token.sources) sources.push(source);
  const record: z.infer<typeof TokenSchema> = {
    id: token.id,
    text: token.text,
    tags,
    span: [token.span[0], token.span[1]],
    origin: token.origin,
    status: token.status,
    sources,
  };
  if (token.skipped === true) record.skipped = true;
  if (token.lemma !== undefined) record.lemma = token.lemma;
  if (token.participle !== undefined) record.participle = token.participle;
  if (token.clause !== undefined) {
    record.clause = { text: token.clause.text, start: token.clause.start, end: token.clause.end };
  }
  return record;
}

function liveSpanRecord(span: LiveSpan): z.infer<typeof LiveSpanSchema> {
  const tags: string[] = [];
  for (const tag of span.tags) tags.push(tag);
  const record: z.infer<typeof LiveSpanSchema> = {
    id: span.id,
    firstTokenId: span.firstTokenId,
    lastTokenId: span.lastTokenId,
    range: [span.range[0], span.range[1]],
    surface: span.surface,
    tags,
    origin: span.origin,
    explicitlySet: span.explicitlySet,
    entityLinkExplicitlySet: span.entityLinkExplicitlySet,
    clause: { text: span.clause.text, start: span.clause.start, end: span.clause.end },
  };
  if (span.lexiconEntryId !== undefined) record.lexiconEntryId = span.lexiconEntryId;
  if (span.entityId !== undefined) record.entityId = span.entityId;
  if (span.insignificant !== undefined) record.insignificant = span.insignificant;
  if (span.lemma !== undefined) record.lemma = span.lemma;
  if (span.participle !== undefined) record.participle = span.participle;
  return record;
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

function writeSnapshot(dir: string, snapshot: SpecSnapshot, history: SpecMutation['history']): void {
  const session: Record<string, unknown> = {
    schemaVersion: snapshot.schemaVersion,
    id: snapshot.id,
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
  if (snapshot.spans !== undefined) {
    const spans = [];
    for (const span of snapshot.spans) spans.push(liveSpanRecord(span));
    writeJson(join(dir, 'spans.json'), { schemaVersion: snapshot.schemaVersion, spans });
  }
  if (snapshot.concepts !== undefined) {
    const concepts = [];
    for (const concept of snapshot.concepts) concepts.push({ id: concept.id, canonical: concept.canonical, members: concept.members.slice() });
    const groups: z.infer<typeof GroupingSchema>[] = [];
    for (const grouping of snapshot.groups ?? []) {
      groups.push({
        span: grouping.span,
        original: grouping.original,
        latest: grouping.latest,
        dependsOn: grouping.dependsOn.slice(),
        history: historyRecords(grouping.history, (value) => ({ concept: value.concept, dependsOn: value.dependsOn.slice() })),
      });
    }
    writeJson(join(dir, 'concepts.json'), { schemaVersion: snapshot.schemaVersion, concepts, groups });
  }
  if (snapshot.frames !== undefined) {
    const frames = [];
    for (const frame of snapshot.frames) frames.push(frameRecord(frame));
    writeJson(join(dir, 'frames.json'), { schemaVersion: snapshot.schemaVersion, frames });
  }
  const graphFile = join(dir, 'graph.json');
  if (existsSync(graphFile)) unlinkSync(graphFile);
  const overlayFile = join(dir, 'flows.json');
  if (snapshot.graph !== undefined) {
    writeJson(overlayFile, overlayRecord(snapshot.schemaVersion, snapshot.graph.flows));
  } else if (existsSync(overlayFile)) {
    unlinkSync(overlayFile);
  }
  const entries = history === undefined ? [] : Array.isArray(history) ? history : [history];
  for (const entry of entries) appendFileSync(join(dir, 'history.jsonl'), `${JSON.stringify(historyRecord(entry))}\n`);
}

function frameRecord(frame: Frame): z.infer<typeof FrameSchema> {
  const record: z.infer<typeof FrameSchema> = {
    id: frame.id,
    sentence: frame.sentence,
    clause: { text: frame.clause.text, start: frame.clause.start, end: frame.clause.end },
    roles: {
      actor: fieldRecord(frame.roles.actor),
      event: fieldRecord(frame.roles.event),
      object: fieldRecord(frame.roles.object),
      result: fieldRecord(frame.roles.result),
      when: fieldRecord(frame.roles.when),
    },
    history: historyRecords(frame.history, (value) => ({ notTransition: value.notTransition === null ? null : { reason: value.notTransition.reason } })),
  };
  if (frame.marker !== undefined) record.marker = frame.marker;
  if (frame.negated === true) record.negated = true;
  if (frame.notTransition !== undefined) {
    record.notTransition = { reason: frame.notTransition.reason };
    if (frame.notTransition.who !== undefined) record.notTransition.who = frame.notTransition.who;
  }
  return record;
}

function fieldRecord(field: Field): z.infer<typeof FieldSchema> {
  return { original: fieldVersionRecord(field.original), latest: fieldVersionRecord(field.latest), history: historyRecords(field.history, fieldVersionRecord) };
}

function historyRecords<T, R>(history: readonly Revision<T>[], value: (item: T) => R): RawRevision<R>[] {
  const records: RawRevision<R>[] = [];
  for (const revision of history) {
    const entry: RawRevision<R> = { at: revision.at, who: revision.who, reason: revision.reason, value: value(revision.value) };
    if (revision.finding !== undefined) entry.finding = revision.finding;
    if (revision.comment !== undefined) entry.comment = revision.comment;
    records.push(entry);
  }
  return records;
}

function fieldVersionRecord(version: FieldVersion): z.infer<typeof FieldVersionSchema> {
  return { value: version.value === 'unknown' ? 'unknown' : { text: version.value.text, refs: version.value.refs.slice() }, dependsOn: version.dependsOn.slice() };
}

function historyRecord(entry: SpecHistoryEntry): { at: string; command: string; args: SpecHistoryEntry['args']; before: string[]; after: string[] } {
  const args: SpecHistoryEntry['args'] = { session: entry.args.session };
  if (entry.args.spec !== undefined) args.spec = entry.args.spec;
  if (entry.args.sentence !== undefined) args.sentence = entry.args.sentence;
  if (entry.args.id !== undefined) args.id = entry.args.id;
  if (entry.args.ids !== undefined) args.ids = entry.args.ids.slice();
  if (entry.args.into !== undefined) args.into = entry.args.into;
  if (entry.args.name !== undefined) args.name = entry.args.name;
  if (entry.args.text !== undefined) args.text = entry.args.text;
  if (entry.args.kind !== undefined) args.kind = entry.args.kind;
  if (entry.args.reason !== undefined) args.reason = entry.args.reason;
  if (entry.args.from !== undefined) args.from = entry.args.from;
  if (entry.args.at !== undefined) args.at = entry.args.at;
  if (entry.args.title !== undefined) args.title = entry.args.title;
  if (entry.args.lexicon !== undefined) args.lexicon = entry.args.lexicon;
  if (entry.args.forceAuto !== undefined) args.forceAuto = entry.args.forceAuto;
  if (entry.args.tags !== undefined) args.tags = entry.args.tags.slice();
  if (entry.args.entity !== undefined) args.entity = entry.args.entity;
  if (entry.args.link !== undefined) args.link = entry.args.link;
  if (entry.args.finding !== undefined) args.finding = entry.args.finding;
  if (entry.args.by !== undefined) args.by = entry.args.by;
  if (entry.args.after !== undefined) args.after = entry.args.after;
  if (entry.args.frame !== undefined) args.frame = entry.args.frame;
  if (entry.args.span !== undefined) args.span = entry.args.span;
  if (entry.args.role !== undefined) args.role = entry.args.role;
  if (entry.args.values !== undefined) args.values = entry.args.values.slice();
  if (entry.args.dependsOn !== undefined) args.dependsOn = entry.args.dependsOn.slice();
  if (entry.args.clear !== undefined) args.clear = entry.args.clear;
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

function sessionIdMessage(id: string): string {
  return `session id "${id}" is not a safe name`;
}

function locateSession(id: string): { ok: true; root: string; dir: string } | { ok: false; message: string } {
  if (!isSessionId(id)) return { ok: false, message: sessionIdMessage(id) };
  const root = specRoot();
  const dir = join(root, id);
  if (resolve(dir) !== join(resolve(root), id)) return { ok: false, message: sessionIdMessage(id) };
  return { ok: true, root, dir };
}

function confinedToSession(root: string, dir: string, id: string): boolean {
  try {
    return relative(realpathSync(root), realpathSync(dir)) === id;
  } catch {
    return false;
  }
}

function liveCounts(snapshot: SpecSnapshot): SpecSessionCounts {
  let sentences = 0;
  for (const sentence of snapshot.sentences) {
    if (sentence.latest !== null) sentences += 1;
  }
  let frames = 0;
  for (const frame of snapshot.frames ?? []) {
    if (frame.notTransition === undefined) frames += 1;
  }
  return { sentences, frames, flows: snapshot.graph?.flows.length ?? 0 };
}

function lastWritten(dir: string): string {
  const sessionFile = join(dir, 'session.json');
  try {
    return statSync(sessionFile).mtime.toISOString();
  } catch {
    try {
      return statSync(dir).mtime.toISOString();
    } catch {
      return '';
    }
  }
}

function sessionDetail(dir: string, id: string): { updated: string; summary: SpecSessionCounts } {
  try {
    const loaded = readSnapshot(dir, id);
    if (loaded.ok && loaded.snapshot !== undefined) {
      return { updated: loaded.snapshot.updated, summary: liveCounts(loaded.snapshot) };
    }
  } catch {
    // listSessions still returns the directory. Callers only require the id.
  }
  return { updated: lastWritten(dir), summary: { sentences: 0, frames: 0, flows: 0 } };
}

export const jsonSpecStore: SpecStore = {
  listSessions() {
    const root = specRoot();
    if (!existsSync(root)) return [];
    const refs: SpecSessionSummary[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSessionId(entry.name)) continue;
      const dir = join(root, entry.name);
      const detail = sessionDetail(dir, entry.name);
      refs.push({
        id: entry.name,
        updated: detail.updated,
        summary: detail.summary,
      });
    }
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    return refs;
  },

  removeSession(id): SpecRemovalResult {
    const located = locateSession(id);
    if (!located.ok) return { ok: false, fault: 'unreadable', message: located.message };
    let info: Stats;
    try {
      info = lstatSync(located.dir);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ok: false, fault: 'missing', message: `no spec session "${id}"` };
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'unreadable', message: `cannot remove spec session "${id}": ${message}` };
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return { ok: false, fault: 'unreadable', message: `spec session "${id}" is not a directory` };
    }
    if (!confinedToSession(located.root, located.dir, id)) {
      return { ok: false, fault: 'unreadable', message: sessionIdMessage(id) };
    }
    const lock = acquireLock(located.dir, id);
    if (!lock.ok) return { ok: false, fault: 'locked', message: lock.message };
    try {
      const again = lstatSync(located.dir);
      if (again.isSymbolicLink() || !again.isDirectory() || !confinedToSession(located.root, located.dir, id)) {
        return { ok: false, fault: 'unreadable', message: sessionIdMessage(id) };
      }
      rmSync(located.dir, { recursive: true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'unreadable', message: `cannot remove spec session "${id}": ${message}` };
    } finally {
      lock.release();
    }
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
