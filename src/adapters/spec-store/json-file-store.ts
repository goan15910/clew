// JSON spec sessions under the per-user data directory. Zod runs only while reading those files.
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync, type Stats } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { SpecMutation, SpecRemovalResult, SpecSessionCounts, SpecSessionSummary, SpecStore, SpecStoreResult } from '../../application/ports.js';
import {
  ENTITY_KINDS,
  FACT_TYPES,
  SPEC_ENTITY_ID_PATTERN,
  SPEC_FACT_ID_PATTERN,
  SPEC_SCHEMA_VERSION,
  SPEC_SENTENCE_ID_MESSAGE,
  SPEC_SENTENCE_ID_PATTERN,
  SPEC_SESSION_ID_PATTERN,
  type DraftGraph,
  type Entity,
  type Fact,
  type GraphState,
  type GraphTransition,
  type LiveSpan,
  type Sentence,
  type SpecFlow,
  type SpecHistoryEntry,
  type SpecSnapshot,
  type TaggedSentence,
  type Token,
} from '../../domain/spec.js';
import { WORKFLOW_ID_PATTERN, WORKFLOW_WORD_PATTERN } from '../../domain/workflow.js';
import { locatedErrors } from '../yaml/issue-lines.js';
import { specSessionDir, specRoot } from './data-dir.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const TOKEN_ID = /^s[1-9][0-9]*\.t[1-9][0-9]*$/;
const SPAN_ID = /^sp:s[1-9][0-9]*\.t[1-9][0-9]*\.\.s[1-9][0-9]*\.t[1-9][0-9]*$/;

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

const LiveSpanSchema = z.strictObject({
  id: z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2'),
  firstTokenId: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  lastTokenId: z.string().regex(TOKEN_ID, 'token ids look like s1.t1'),
  surface: z.string(),
  tags: z.array(z.string()),
  origin: z.enum(['promote', 'lexicon', 'interactive']),
  lexiconEntryId: z.string().min(1).optional(),
  explicitlySet: z.boolean(),
  entityId: z.string().regex(SPEC_ENTITY_ID_PATTERN).optional(),
  entityLinkExplicitlySet: z.boolean(),
  insignificant: z.boolean().optional(),
});

const SpansFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  spans: z.array(LiveSpanSchema),
});

const EntitySchema = z.strictObject({
  id: z.string().regex(SPEC_ENTITY_ID_PATTERN),
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  sources: z.array(z.string()),
  origin: z.enum(['tagger', 'rule', 'agent']),
  status: z.enum(['candidate', 'confirmed', 'rejected', 'stale']),
  review: z.enum(['candidate', 'confirmed', 'rejected']).optional(),
  note: z.string().optional(),
}).superRefine((entity, context) => {
  if (entity.kind === 'condition' && entity.text === undefined) {
    context.addIssue({ code: 'custom', message: 'condition needs text', path: ['text'] });
  }
  if (entity.kind !== 'condition' && entity.name === undefined) {
    context.addIssue({ code: 'custom', message: `${entity.kind} needs a name`, path: ['name'] });
  }
  if (entity.status === 'stale' && entity.review === undefined) {
    context.addIssue({ code: 'custom', message: 'stale entity needs review', path: ['review'] });
  }
});

const FactSchema = z.strictObject({
  id: z.string().regex(SPEC_FACT_ID_PATTERN),
  type: z.enum(FACT_TYPES),
  actor: z.string().optional(),
  action: z.string().optional(),
  object: z.string().optional(),
  from: z.string().nullable().optional(),
  to: z.string().optional(),
  condition: z.string().optional(),
  state: z.string().optional(),
  origin: z.enum(['tagger', 'rule', 'agent']),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()),
  status: z.enum(['current', 'stale']),
  note: z.string().optional(),
  removed: z.literal(true).optional(),
});

const EntitiesFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  entities: z.array(EntitySchema),
});

const FactsFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  facts: z.array(FactSchema),
});

const GraphStateSchema = z.strictObject({
  id: z.string().regex(WORKFLOW_WORD_PATTERN),
  object: z.string().regex(WORKFLOW_WORD_PATTERN),
  initial: z.literal(true).optional(),
  final: z.literal(true).optional(),
  facts: z.array(z.string()),
});

const GraphTransitionSchema = z.strictObject({
  id: z.string().regex(/^tr[1-9][0-9]*$/, 'transition ids look like tr1'),
  from: z.string().regex(WORKFLOW_WORD_PATTERN),
  event: z.string().regex(WORKFLOW_WORD_PATTERN),
  to: z.string().regex(WORKFLOW_WORD_PATTERN),
  actor: z.string().regex(WORKFLOW_WORD_PATTERN).optional(),
  guard: z.string().regex(SPEC_ENTITY_ID_PATTERN).optional(),
  object: z.string().regex(WORKFLOW_WORD_PATTERN),
  fact: z.string().regex(SPEC_FACT_ID_PATTERN),
  facts: z.array(z.string()),
});

const FlowSchema = z.strictObject({
  id: z.string().regex(WORKFLOW_ID_PATTERN),
  title: z.string().min(1),
  expect: z.enum(['accepted', 'rejected']),
  rejectAt: z.number().int().positive().optional(),
  transitions: z.array(z.string().regex(/^tr[1-9][0-9]*$/)),
  forbidden: z.string().regex(SPEC_FACT_ID_PATTERN).optional(),
  origin: z.enum(['rule', 'agent']),
}).superRefine((flow, context) => {
  if (flow.expect === 'accepted' && flow.transitions.length < 1) {
    context.addIssue({ code: 'custom', message: 'an accepted flow needs a transition', path: ['transitions'] });
  }
  if (flow.expect === 'rejected' && flow.rejectAt === undefined) {
    context.addIssue({ code: 'custom', message: 'a rejected flow needs rejectAt', path: ['rejectAt'] });
  }
  if (flow.expect === 'rejected' && flow.transitions.length === 0 && flow.forbidden === undefined) {
    context.addIssue({ code: 'custom', message: 'a rejected flow needs a transition or a forbidden fact', path: ['forbidden'] });
  }
});

const GraphFileSchema = z.strictObject({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  objects: z.array(z.string()),
  states: z.array(GraphStateSchema),
  transitions: z.array(GraphTransitionSchema),
  flows: z.array(FlowSchema),
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

function toLiveSpan(raw: z.infer<typeof LiveSpanSchema>): LiveSpan {
  const tags: string[] = [];
  for (const tag of raw.tags) tags.push(tag);
  const span: LiveSpan = {
    id: raw.id,
    firstTokenId: raw.firstTokenId,
    lastTokenId: raw.lastTokenId,
    surface: raw.surface,
    tags,
    origin: raw.origin,
    explicitlySet: raw.explicitlySet,
    entityLinkExplicitlySet: raw.entityLinkExplicitlySet,
  };
  if (raw.lexiconEntryId !== undefined) span.lexiconEntryId = raw.lexiconEntryId;
  if (raw.entityId !== undefined) span.entityId = raw.entityId;
  if (raw.insignificant !== undefined) span.insignificant = raw.insignificant;
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

  const entitiesFile = join(dir, 'entities.json');
  if (existsSync(entitiesFile)) {
    const entitiesRead = readJson(entitiesFile);
    if (!entitiesRead.ok) return entitiesRead;
    const entitiesVersion = versionFault(entitiesRead.value, entitiesFile);
    if (entitiesVersion !== undefined) return { ok: false, fault: entitiesVersion.fault, message: entitiesVersion.message };
    const entitiesParsed = EntitiesFileSchema.safeParse(entitiesRead.value);
    if (!entitiesParsed.success) return { ok: false, ...zodFault(entitiesFile, entitiesParsed.error) };
    const entities: Entity[] = [];
    for (const raw of entitiesParsed.data.entities) entities.push(toEntity(raw));
    snapshot.entities = entities;
  }

  const factsFile = join(dir, 'facts.json');
  if (existsSync(factsFile)) {
    const factsRead = readJson(factsFile);
    if (!factsRead.ok) return factsRead;
    const factsVersion = versionFault(factsRead.value, factsFile);
    if (factsVersion !== undefined) return { ok: false, fault: factsVersion.fault, message: factsVersion.message };
    const factsParsed = FactsFileSchema.safeParse(factsRead.value);
    if (!factsParsed.success) return { ok: false, ...zodFault(factsFile, factsParsed.error) };
    const facts: Fact[] = [];
    for (const raw of factsParsed.data.facts) facts.push(toFact(raw));
    snapshot.facts = facts;
  }

  const graphFile = join(dir, 'graph.json');
  if (existsSync(graphFile)) {
    const graphRead = readJson(graphFile);
    if (!graphRead.ok) return graphRead;
    const graphVersion = versionFault(graphRead.value, graphFile);
    if (graphVersion !== undefined) return { ok: false, fault: graphVersion.fault, message: graphVersion.message };
    const graphParsed = GraphFileSchema.safeParse(graphRead.value);
    if (!graphParsed.success) return { ok: false, ...zodFault(graphFile, graphParsed.error) };
    snapshot.graph = toGraph(graphParsed.data);
  }
  return { ok: true, snapshot };
}

function toEntity(raw: z.infer<typeof EntitySchema>): Entity {
  const sources: string[] = [];
  for (const source of raw.sources) sources.push(source);
  const entity: Entity = { id: raw.id, kind: raw.kind, sources, origin: raw.origin, status: raw.status };
  if (raw.name !== undefined) entity.name = raw.name;
  if (raw.text !== undefined) entity.text = raw.text;
  if (raw.review !== undefined) entity.review = raw.review;
  if (raw.note !== undefined) entity.note = raw.note;
  return entity;
}

function toFact(raw: z.infer<typeof FactSchema>): Fact {
  const sources: string[] = [];
  for (const source of raw.sources) sources.push(source);
  const fact: Fact = {
    id: raw.id,
    type: raw.type,
    origin: raw.origin,
    confidence: raw.confidence,
    sources,
    status: raw.status,
  };
  if (raw.actor !== undefined) fact.actor = raw.actor;
  if (raw.action !== undefined) fact.action = raw.action;
  if (raw.object !== undefined) fact.object = raw.object;
  if (raw.from !== undefined) fact.from = raw.from;
  if (raw.to !== undefined) fact.to = raw.to;
  if (raw.condition !== undefined) fact.condition = raw.condition;
  if (raw.state !== undefined) fact.state = raw.state;
  if (raw.note !== undefined) fact.note = raw.note;
  if (raw.removed === true) fact.removed = true;
  return fact;
}

function toGraph(raw: z.infer<typeof GraphFileSchema>): DraftGraph {
  const objects: string[] = [];
  for (const object of raw.objects) objects.push(object);
  const states: GraphState[] = [];
  for (const state of raw.states) {
    const facts: string[] = [];
    for (const fact of state.facts) facts.push(fact);
    const built: GraphState = { id: state.id, object: state.object, facts };
    if (state.initial === true) built.initial = true;
    if (state.final === true) built.final = true;
    states.push(built);
  }
  const transitions: GraphTransition[] = [];
  for (const transition of raw.transitions) {
    const facts: string[] = [];
    for (const fact of transition.facts) facts.push(fact);
    const built: GraphTransition = {
      id: transition.id,
      from: transition.from,
      event: transition.event,
      to: transition.to,
      object: transition.object,
      fact: transition.fact,
      facts,
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

function graphRecord(schemaVersion: number, graph: DraftGraph): z.infer<typeof GraphFileSchema> {
  const objects: string[] = [];
  for (const object of graph.objects) objects.push(object);
  const states: z.infer<typeof GraphStateSchema>[] = [];
  for (const state of graph.states) {
    const facts: string[] = [];
    for (const fact of state.facts) facts.push(fact);
    const record: z.infer<typeof GraphStateSchema> = { id: state.id, object: state.object, facts };
    if (state.initial === true) record.initial = true;
    if (state.final === true) record.final = true;
    states.push(record);
  }
  const transitions: z.infer<typeof GraphTransitionSchema>[] = [];
  for (const transition of graph.transitions) {
    const facts: string[] = [];
    for (const fact of transition.facts) facts.push(fact);
    const record: z.infer<typeof GraphTransitionSchema> = {
      id: transition.id,
      from: transition.from,
      event: transition.event,
      to: transition.to,
      object: transition.object,
      fact: transition.fact,
      facts,
    };
    if (transition.actor !== undefined) record.actor = transition.actor;
    if (transition.guard !== undefined) record.guard = transition.guard;
    transitions.push(record);
  }
  const flows: z.infer<typeof FlowSchema>[] = [];
  for (const flow of graph.flows) {
    const transitionIds: string[] = [];
    for (const id of flow.transitions) transitionIds.push(id);
    const record: z.infer<typeof FlowSchema> = {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      transitions: transitionIds,
      origin: flow.origin,
    };
    if (flow.rejectAt !== undefined) record.rejectAt = flow.rejectAt;
    if (flow.forbidden !== undefined) record.forbidden = flow.forbidden;
    flows.push(record);
  }
  return { schemaVersion: schemaVersion as typeof SPEC_SCHEMA_VERSION, objects, states, transitions, flows };
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

function liveSpanRecord(span: LiveSpan): z.infer<typeof LiveSpanSchema> {
  const tags: string[] = [];
  for (const tag of span.tags) tags.push(tag);
  const record: z.infer<typeof LiveSpanSchema> = {
    id: span.id,
    firstTokenId: span.firstTokenId,
    lastTokenId: span.lastTokenId,
    surface: span.surface,
    tags,
    origin: span.origin,
    explicitlySet: span.explicitlySet,
    entityLinkExplicitlySet: span.entityLinkExplicitlySet,
  };
  if (span.lexiconEntryId !== undefined) record.lexiconEntryId = span.lexiconEntryId;
  if (span.entityId !== undefined) record.entityId = span.entityId;
  if (span.insignificant !== undefined) record.insignificant = span.insignificant;
  return record;
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
  if (snapshot.spans !== undefined) {
    const spans = [];
    for (const span of snapshot.spans) spans.push(liveSpanRecord(span));
    writeJson(join(dir, 'spans.json'), { schemaVersion: snapshot.schemaVersion, spans });
  }
  if (snapshot.entities !== undefined) {
    const entities = [];
    for (const entity of snapshot.entities) entities.push(entityRecord(entity));
    writeJson(join(dir, 'entities.json'), { schemaVersion: snapshot.schemaVersion, entities });
  }
  if (snapshot.facts !== undefined) {
    const facts = [];
    for (const fact of snapshot.facts) facts.push(factRecord(fact));
    writeJson(join(dir, 'facts.json'), { schemaVersion: snapshot.schemaVersion, facts });
  }
  if (snapshot.graph !== undefined) {
    writeJson(join(dir, 'graph.json'), graphRecord(snapshot.schemaVersion, snapshot.graph));
  }
  if (history !== undefined) appendFileSync(join(dir, 'history.jsonl'), `${JSON.stringify(historyRecord(history))}\n`);
}

function entityRecord(entity: Entity): z.infer<typeof EntitySchema> {
  const sources: string[] = [];
  for (const source of entity.sources) sources.push(source);
  const record: z.infer<typeof EntitySchema> = {
    id: entity.id,
    kind: entity.kind,
    sources,
    origin: entity.origin,
    status: entity.status,
  };
  if (entity.name !== undefined) record.name = entity.name;
  if (entity.text !== undefined) record.text = entity.text;
  if (entity.review !== undefined) record.review = entity.review;
  if (entity.note !== undefined) record.note = entity.note;
  return record;
}

function factRecord(fact: Fact): z.infer<typeof FactSchema> {
  const sources: string[] = [];
  for (const source of fact.sources) sources.push(source);
  const record: z.infer<typeof FactSchema> = {
    id: fact.id,
    type: fact.type,
    origin: fact.origin,
    confidence: fact.confidence,
    sources,
    status: fact.status,
  };
  if (fact.actor !== undefined) record.actor = fact.actor;
  if (fact.action !== undefined) record.action = fact.action;
  if (fact.object !== undefined) record.object = fact.object;
  if (fact.from !== undefined) record.from = fact.from;
  if (fact.to !== undefined) record.to = fact.to;
  if (fact.condition !== undefined) record.condition = fact.condition;
  if (fact.state !== undefined) record.state = fact.state;
  if (fact.note !== undefined) record.note = fact.note;
  if (fact.removed === true) record.removed = true;
  return record;
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

function liveCounts(snapshot: SpecSnapshot): { sentences: number; facts: number; flows: number } {
  let sentences = 0;
  for (const sentence of snapshot.sentences) {
    if (sentence.status === 'current') sentences += 1;
  }
  let facts = 0;
  for (const fact of snapshot.facts ?? []) {
    if (fact.status === 'current' && fact.removed !== true) facts += 1;
  }
  return { sentences, facts, flows: snapshot.graph?.flows.length ?? 0 };
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
    // listSessions still returns the directory. Callers only require id and specPath.
  }
  return { updated: lastWritten(dir), summary: { sentences: 0, facts: 0, flows: 0 } };
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
        specPath: listSpecPath(dir),
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
