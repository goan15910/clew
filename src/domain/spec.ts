// Sentences, tokens, and findings for a spec session.
// Pure data and rules. No tagger, no files, no Zod.
import type { Patch, Predicate } from './valuation.js';

export const SPEC_SCHEMA_VERSION = 5 as const;

export const SPEC_SESSION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const SPEC_SESSION_ID_MESSAGE = 'session ids start with a letter and then use letters, digits, underscores, or hyphens';
export const SPEC_SENTENCE_ID_PATTERN = /^s[1-9][0-9]*$/;
export const SPEC_SENTENCE_ID_MESSAGE = 'sentence ids look like s1';

export type SpecOrigin = 'tagger' | 'rule' | 'agent';
export type SpecItemStatus = 'current' | 'stale';
export type FindingKind = 'gap' | 'conflict' | 'stale' | 'vocabulary' | 'coverage';
export type FindingSeverity = 'blocking' | 'warning' | 'info';

export const SPEC_CONCEPT_ID_PATTERN = /^concept:[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const SPEC_CONCEPT_ID_MESSAGE = 'concept ids look like concept:order';
export const SPEC_FRAME_ID_PATTERN = /^fr:s[1-9][0-9]*\.t[1-9][0-9]*$/;
export const SPEC_FRAME_ID_MESSAGE = 'frame ids look like fr:s1.t2';
/** Actor label when a frame's actor is unknown. */
export const UNSPECIFIED_ACTOR_NAME = 'unspecified';

export interface Finding {
  id: string;
  kind: FindingKind;
  code: string;
  severity: FindingSeverity;
  message: string;
  refs: string[];
}

/** Who wrote a revision when Clew itself changed the record (re-init, dropped refinements). */
export const CLEW_AUTHOR = 'clew';

/** One write to a revised record. `value` is what the write left in `latest`. */
export interface Revision<T> {
  at: string;
  who: string;
  reason: string;
  finding?: string;
  comment?: string;
  value: T;
}

/** Text, file span, hash, and heading path of one version of a sentence. */
export interface SentenceText {
  text: string;
  span: [number, number];
  hash: string;
  section: string;
}

/**
 * The spec file is a seed. `original` is what the file said (null for an added sentence).
 * `latest` is the text the pipeline reads (null for a deleted sentence, kept as a tombstone).
 * Ids are never reused.
 */
export interface Sentence {
  id: string;
  original: SentenceText | null;
  latest: SentenceText | null;
  history: Revision<SentenceText | null>[];
}

/** A sentence with a latest version, as every later layer reads it. */
export interface LiveSentence extends SentenceText {
  id: string;
}

export type SentenceDraft = SentenceText;

/** Compromise clause cover relative to the sentence text. */
export interface ClauseBound {
  text: string;
  start: number;
  end: number;
}

export interface Token {
  id: string;
  text: string;
  tags: string[];
  span: [number, number];
  origin: SpecOrigin;
  status: SpecItemStatus;
  sources: string[];
  /**
   * Stop-word / function glue marked before span promotion.
   * Token stays in tokens.json with positions; promotes to an insignificant span.
   */
  skipped?: boolean;
  /** Verb infinitive from compromise when the tagger tagged this token as a Verb. */
  lemma?: string;
  /** Past participle of `lemma` from compromise. */
  participle?: string;
  /** Clause covering this token, assigned once at tag time. */
  clause?: ClauseBound;
}

export interface TaggedSentence {
  id: string;
  status: SpecItemStatus;
  clauses: string[];
  tokens: Token[];
}

/** Live span origin. Promote is the 1:1 token cover written by `spec tag`. */
export type SpanOrigin = 'promote' | 'lexicon' | 'interactive';

/**
 * One cell of the live span partition. Identity is the token cover:
 * `id` is always `sp:<firstTokenId>..<lastTokenId>`.
 */
export interface LiveSpan {
  id: string;
  firstTokenId: string;
  lastTokenId: string;
  /** Absolute character range covering the tokens (from first through last). */
  range: [number, number];
  /** Display / underline surface (original spec casing for the cover). */
  surface: string;
  tags: string[];
  origin: SpanOrigin;
  lexiconEntryId?: string;
  /** True when an agent or human last wrote cover/tags/surface. */
  explicitlySet: boolean;
  entityId?: string;
  /** True when an agent or human last wrote the entity link (including explicit none). */
  entityLinkExplicitlySet: boolean;
  insignificant?: boolean;
  /**
   * Clause covering this span: the union of its tokens' clause bounds.
   * Cross-clause merges are rejected, so this is always a single compromise clause.
   */
  clause: ClauseBound;
  /** Verb infinitive when this span carries a Verb (from compromise via the token). */
  lemma?: string;
  /** Past participle of `lemma`, copied from the verb token. */
  participle?: string;
}

/** A canonical identity and its member spans. A span's `entityId` names its concept. Kind is never stored. */
export interface Concept {
  id: string;
  canonical: string;
  members: string[];
}

export type RoleName = 'actor' | 'event' | 'object' | 'result' | 'when';

/** `refs` are concept ids (actor, object, result), a span id (event), or frame ids (when). */
export interface RoleValue {
  text: string;
  refs: string[];
}

export type Role = RoleValue | 'unknown';

/** `dependsOn` lists the span ids the value was read from. */
export interface FieldVersion {
  value: Role;
  dependsOn: string[];
}

export interface Field {
  original: FieldVersion;
  latest: FieldVersion;
  history: Revision<FieldVersion>[];
}

/** One clause of one sentence. `id` is `fr:<first token id of the clause>`. */
export interface Frame {
  id: string;
  sentence: string;
  clause: ClauseBound;
  marker?: string;
  negated?: true;
  notTransition?: { reason: string };
  roles: Record<RoleName, Field>;
}

export interface SpecSnapshot {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  id: string;
  specHash: string;
  tagger?: { name: string; version: string };
  created: string;
  updated: string;
  sentences: Sentence[];
  tagged: TaggedSentence[];
  /** Live span partition grounded in `tagged` tokens. Omitted until `spec tag` dual-emits. */
  spans?: LiveSpan[];
  concepts?: Concept[];
  frames?: Frame[];
  graph?: DraftGraph;
}

export type FlowOrigin = 'rule' | 'agent';

/** One state of one object. `frames` are the compiled items that name it. */
export interface GraphState {
  id: string;
  object: string;
  initial?: true;
  final?: true;
  frames: string[];
}

/** One overlay edge assembled from a compiled action. `id` and `frame` are that frame's id. */
export interface GraphTransition {
  id: string;
  from: string;
  event: string;
  to: string;
  actor?: string;
  guard?: string;
  object: string;
  frame: string;
  frames: string[];
}

/**
 * One named path through the graph.
 * Accepted paths list transition frame ids. A rejected path may list one frame,
 * or only `forbidden` when the refusal has no matching action yet.
 */
export interface SpecFlow {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  rejectAt?: number;
  transitions: string[];
  forbidden?: string;
  origin: FlowOrigin;
}

export interface DraftGraph {
  objects: string[];
  states: GraphState[];
  transitions: GraphTransition[];
  flows: SpecFlow[];
}

export type SpecCommandName =
  | 'spec.init'
  | 'spec.tag'
  | 'spec.sentences.add'
  | 'spec.sentences.edit'
  | 'spec.sentences.delete'
  | 'spec.spans.merge'
  | 'spec.spans.check'
  | 'spec.concepts.list'
  | 'spec.frames.list'
  | 'spec.graph.build'
  | 'spec.graph.split'
  | 'spec.graph.group';

export interface SpecHistoryArgs {
  spec?: string;
  session: string;
  sentence?: string;
  id?: string;
  ids?: string[];
  into?: string;
  name?: string;
  text?: string;
  kind?: string;
  reason?: string;
  from?: string;
  at?: string;
  title?: string;
  lexicon?: string;
  forceAuto?: boolean;
  tags?: string[];
  entity?: string;
  link?: string;
  finding?: string;
  by?: string;
  after?: string;
}

export interface SpecHistoryEntry {
  at: string;
  command: SpecCommandName;
  args: SpecHistoryArgs;
  before: string[];
  after: string[];
}

export interface PosToken {
  text: string;
  tags: string[];
  start: number;
  end: number;
  /** Verb infinitive from compromise when tagged as a Verb. */
  lemma?: string;
  participle?: string;
}

export interface PosTagging {
  tokens: PosToken[];
  clauses: string[];
}

export interface SplitSentence {
  text: string;
  span: [number, number];
  section: string;
}

export interface SplitResult {
  sentences: SplitSentence[];
  emptySpans: [number, number][];
}

export function hasBlocking(findings: readonly Finding[]): boolean {
  for (const finding of findings) {
    if (finding.severity === 'blocking') return true;
  }
  return false;
}

export function liveSentences(sentences: readonly Sentence[]): LiveSentence[] {
  const live: LiveSentence[] = [];
  for (const sentence of sentences) {
    if (sentence.latest !== null) live.push(liveSentence(sentence.id, sentence.latest));
  }
  return live;
}

export function liveSentence(id: string, text: SentenceText): LiveSentence {
  return { id, text: text.text, span: [text.span[0], text.span[1]], hash: text.hash, section: text.section };
}

export function sentenceIds(sentences: readonly Sentence[]): string[] {
  const ids: string[] = [];
  for (const sentence of liveSentences(sentences)) ids.push(sentence.id);
  return ids;
}

export type SentenceState = 'original' | 'edited' | 'added' | 'deleted';

export function sentenceState(sentence: Sentence): SentenceState {
  if (sentence.latest === null) return 'deleted';
  if (sentence.original === null) return 'added';
  return sentence.latest.hash === sentence.original.hash ? 'original' : 'edited';
}

/** True when an agent or a human wrote this sentence, not only `spec init`. */
export function sentenceRevised(sentence: Sentence): boolean {
  for (const revision of sentence.history) {
    if (revision.who !== CLEW_AUTHOR) return true;
  }
  return false;
}

const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}]/u;
const CONDITION_WORD = /\b(if|when|unless)\b/i;

export function suspectsNonEnglish(text: string): boolean {
  return NON_LATIN.test(text);
}

export function initFindings(sentences: readonly Sentence[], emptySpans: readonly [number, number][]): Finding[] {
  const findings: Finding[] = [];
  const current = liveSentences(sentences);
  if (current.length === 0) {
    findings.push({
      id: 'no-sentences',
      kind: 'coverage',
      code: 'no-sentences',
      severity: 'blocking',
      message: 'the spec has no sentences',
      refs: [],
    });
    return findings;
  }
  for (const span of emptySpans) {
    findings.push({
      id: `empty-sentence:${span[0]}`,
      kind: 'coverage',
      code: 'empty-sentence',
      severity: 'warning',
      message: `characters ${span[0]}-${span[1]} have no sentence text`,
      refs: [],
    });
  }
  const seen = new Map<string, string>();
  for (const sentence of current) {
    if (suspectsNonEnglish(sentence.text)) {
      findings.push({
        id: `non-english:${sentence.id}`,
        kind: 'coverage',
        code: 'non-english',
        severity: 'warning',
        message: `${sentence.id} looks non-English; translate it to plain English before tagging`,
        refs: [sentence.id],
      });
    }
    const key = sentence.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const first = seen.get(key);
    if (first !== undefined) {
      findings.push({
        id: `duplicate:${sentence.id}`,
        kind: 'coverage',
        code: 'duplicate-sentence',
        severity: 'warning',
        message: `${sentence.id} repeats ${first}`,
        refs: [sentence.id, first],
      });
    } else {
      seen.set(key, sentence.id);
    }
  }
  return findings;
}

export const REMOVED_SENTENCE = 'removed-sentence';
export const ORIGINAL_CHANGED = 'original-changed';

/**
 * Open re-init findings. Clew records each one as the finding id of its own revision,
 * so it stays open until an agent or human writes the sentence again.
 */
export function sentenceFindings(sentences: readonly Sentence[]): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of sentences) {
    const last = sentence.history[sentence.history.length - 1];
    if (last === undefined || last.who !== CLEW_AUTHOR || last.finding === undefined) continue;
    if (last.finding === `${REMOVED_SENTENCE}:${sentence.id}`) {
      findings.push({
        id: last.finding,
        kind: 'stale',
        code: REMOVED_SENTENCE,
        severity: 'warning',
        message: `${sentence.id} left the spec file and is now a tombstone`,
        refs: [sentence.id],
      });
    } else if (last.finding === `${ORIGINAL_CHANGED}:${sentence.id}`) {
      findings.push({
        id: last.finding,
        kind: 'conflict',
        code: ORIGINAL_CHANGED,
        severity: 'warning',
        message: `${sentence.id} was edited, and its original left the spec file; review the edit`,
        refs: [sentence.id],
      });
    }
  }
  return findings;
}

export function tagFindings(
  sentenceId: string,
  text: string,
  tokens: readonly { tags: readonly string[]; clause?: ClauseBound }[],
  /** @deprecated Prefer reading stored span/token clause bounds; kept for call-site clarity. */
  _clauses?: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  let verb = false;
  let actor = false;
  const clauseKeys = new Set<string>();
  for (const token of tokens) {
    for (const tag of token.tags) {
      if (tag === 'Verb') verb = true;
      if (tag === 'Actor') actor = true;
    }
    if (token.clause !== undefined) clauseKeys.add(`${token.clause.start}:${token.clause.end}`);
  }
  if (!verb) {
    findings.push({
      id: `no-verb:${sentenceId}`,
      kind: 'coverage',
      code: 'no-verb',
      severity: 'warning',
      message: `${sentenceId} has no verb`,
      refs: [sentenceId],
    });
  }
  if (!actor) {
    findings.push({
      id: `no-actor:${sentenceId}`,
      kind: 'coverage',
      code: 'no-actor',
      severity: 'warning',
      message: `${sentenceId} has no actor`,
      refs: [sentenceId],
    });
  }
  const condition = CONDITION_WORD.exec(text);
  const word = condition?.[1];
  if (word !== undefined && clauseKeys.size < 2) {
    findings.push({
      id: `condition-without-clause:${sentenceId}`,
      kind: 'coverage',
      code: 'condition-without-clause',
      severity: 'warning',
      message: `${sentenceId} uses "${word.toLowerCase()}" but the tagger did not split a clause`,
      refs: [sentenceId],
    });
  }
  return findings;
}

export function taggerVersionFinding(previous: { name: string; version: string } | undefined, next: { name: string; version: string }): Finding | undefined {
  if (previous === undefined) return undefined;
  if (previous.name === next.name && previous.version === next.version) return undefined;
  return {
    id: 'tagger-version',
    kind: 'conflict',
    code: 'tagger-version',
    severity: 'info',
    message: `tagger changed from ${previous.name} ${previous.version} to ${next.name} ${next.version}`,
    refs: [],
  };
}

export function tokensFromTagging(sentence: LiveSentence, tagging: PosTagging): Token[] {
  const clauseBounds = locateClauseBounds(sentence.text, tagging.clauses);
  const tokens: Token[] = [];
  let index = 1;
  for (const token of tagging.tokens) {
    const id = `${sentence.id}.t${index}`;
    index += 1;
    const relative = token.start;
    const clause = clauseCoveringRelative(clauseBounds, relative)
      ?? { text: sentence.text, start: 0, end: sentence.text.length };
    const next: Token = {
      id,
      text: token.text,
      tags: token.tags.slice(),
      span: [sentence.span[0] + token.start, sentence.span[0] + token.end],
      origin: 'tagger',
      status: 'current',
      sources: [sentence.id],
      clause: { text: clause.text, start: clause.start, end: clause.end },
    };
    if (token.lemma !== undefined && token.lemma !== '') next.lemma = token.lemma;
    if (token.participle !== undefined && token.participle !== '') next.participle = token.participle;
    tokens.push(next);
  }
  return tokens;
}

/** Locate compromise clause strings once inside the sentence text. */
export function locateClauseBounds(sentenceText: string, clauses: readonly string[]): ClauseBound[] {
  const bounds: ClauseBound[] = [];
  let search = 0;
  for (const clause of clauses) {
    const at = sentenceText.indexOf(clause, search);
    if (at < 0) continue;
    bounds.push({ text: clause, start: at, end: at + clause.length });
    search = at + clause.length;
  }
  return bounds;
}

export function clauseCoveringRelative(bounds: readonly ClauseBound[], relativeStart: number): ClauseBound | undefined {
  for (const bound of bounds) {
    if (relativeStart >= bound.start && relativeStart < bound.end) return bound;
  }
  return undefined;
}

export function taggingDiffers(existing: TaggedSentence, clauses: readonly string[], tokens: readonly Token[]): boolean {
  if (existing.clauses.length !== clauses.length) return true;
  for (let index = 0; index < clauses.length; index += 1) {
    if (existing.clauses[index] !== clauses[index]) return true;
  }
  if (existing.tokens.length !== tokens.length) return true;
  for (let index = 0; index < tokens.length; index += 1) {
    const left = existing.tokens[index];
    const right = tokens[index];
    if (left === undefined || right === undefined) return true;
    if (left.text !== right.text || left.span[0] !== right.span[0] || left.span[1] !== right.span[1]) return true;
    if ((left.skipped === true) !== (right.skipped === true)) return true;
    if (left.lemma !== right.lemma || left.participle !== right.participle) return true;
    if (!sameClauseBound(left.clause, right.clause)) return true;
    if (left.tags.length !== right.tags.length) return true;
    for (let tag = 0; tag < left.tags.length; tag += 1) {
      if (left.tags[tag] !== right.tags[tag]) return true;
    }
  }
  return false;
}

export function hasAgentTokens(tagged: TaggedSentence | undefined): boolean {
  if (tagged === undefined || tagged.status === 'stale') return false;
  for (const token of tagged.tokens) {
    if (token.origin === 'agent' && token.status === 'current') return true;
  }
  return false;
}

/**
 * Match file sentences to stored originals by hash. A matched id keeps its history.
 * An unrevised sentence follows its original. A revised one keeps its latest; when its
 * original left the file, that is an `original-changed` conflict. An unrevised sentence
 * that left the file becomes a tombstone. New text gets a fresh id; ids are never reused.
 */
export function applySpecText(
  previousSentences: readonly Sentence[],
  previousTagged: readonly TaggedSentence[],
  drafts: readonly SentenceDraft[],
  at: string,
): { sentences: Sentence[]; tagged: TaggedSentence[] } {
  const pools = new Map<string, Sentence[]>();
  for (const sentence of previousSentences) {
    if (sentence.original === null) continue;
    const pool = pools.get(sentence.original.hash) ?? [];
    pool.push(sentence);
    pools.set(sentence.original.hash, pool);
  }
  const used = new Set<string>();
  for (const sentence of previousSentences) used.add(sentence.id);
  const matched = new Set<string>();
  const ordered: Sentence[] = [];
  for (const draft of drafts) {
    const previous = pools.get(draft.hash)?.shift();
    if (previous === undefined) {
      const id = freshSentenceId(used);
      used.add(id);
      ordered.push({ id, original: copyText(draft), latest: copyText(draft), history: [] });
      continue;
    }
    matched.add(previous.id);
    ordered.push(reseed(previous, draft, at));
  }
  for (let index = 0; index < previousSentences.length; index += 1) {
    const previous = previousSentences[index];
    if (previous === undefined || matched.has(previous.id)) continue;
    const kept = orphaned(previous, at);
    const before = previousSentences[index - 1];
    const slot = before === undefined ? -1 : ordered.findIndex((item) => item.id === before.id);
    ordered.splice(slot + 1, 0, kept);
  }
  const previousById = new Map<string, Sentence>();
  for (const sentence of previousSentences) previousById.set(sentence.id, sentence);
  const nextById = new Map<string, Sentence>();
  for (const sentence of ordered) nextById.set(sentence.id, sentence);
  const tagged: TaggedSentence[] = [];
  for (const item of previousTagged) {
    const next = nextById.get(item.id)?.latest ?? null;
    const prev = previousById.get(item.id)?.latest ?? null;
    if (next === null || prev === null) continue;
    if (next.hash !== prev.hash) continue;
    tagged.push(retarget(item, next.span[0] - prev.span[0]));
  }
  return { sentences: ordered, tagged };
}

function reseed(previous: Sentence, draft: SentenceDraft, at: string): Sentence {
  const history = previous.history.slice();
  if (sentenceRevised(previous)) {
    return { id: previous.id, original: copyText(draft), latest: previous.latest === null ? null : copyText(previous.latest), history };
  }
  if (previous.latest === null) {
    history.push({ at, who: CLEW_AUTHOR, reason: 'the sentence is back in the spec file', value: copyText(draft) });
  }
  return { id: previous.id, original: copyText(draft), latest: copyText(draft), history };
}

function orphaned(previous: Sentence, at: string): Sentence {
  const history = previous.history.slice();
  const original = previous.original === null ? null : copyText(previous.original);
  const latest = previous.latest === null ? null : copyText(previous.latest);
  if (original === null || latest === null) return { id: previous.id, original, latest, history };
  if (!sentenceRevised(previous)) {
    history.push({ at, who: CLEW_AUTHOR, reason: 'the sentence left the spec file', finding: `${REMOVED_SENTENCE}:${previous.id}`, value: null });
    return { id: previous.id, original, latest: null, history };
  }
  const finding = `${ORIGINAL_CHANGED}:${previous.id}`;
  if (history[history.length - 1]?.finding !== finding) {
    history.push({ at, who: CLEW_AUTHOR, reason: 'the original left the spec file under an edit', finding, value: copyText(latest) });
  }
  return { id: previous.id, original, latest, history };
}

export function copyText(text: SentenceText): SentenceText {
  return { text: text.text, span: [text.span[0], text.span[1]], hash: text.hash, section: text.section };
}

export function copySentence(sentence: Sentence): Sentence {
  const history: Revision<SentenceText | null>[] = [];
  for (const revision of sentence.history) history.push(copyRevision(revision));
  return {
    id: sentence.id,
    original: sentence.original === null ? null : copyText(sentence.original),
    latest: sentence.latest === null ? null : copyText(sentence.latest),
    history,
  };
}

function copyRevision(revision: Revision<SentenceText | null>): Revision<SentenceText | null> {
  const copy: Revision<SentenceText | null> = {
    at: revision.at,
    who: revision.who,
    reason: revision.reason,
    value: revision.value === null ? null : copyText(revision.value),
  };
  if (revision.finding !== undefined) copy.finding = revision.finding;
  if (revision.comment !== undefined) copy.comment = revision.comment;
  return copy;
}

export function sameSentences(left: readonly Sentence[], right: readonly Sentence[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || !sameText(a.original, b.original) || !sameText(a.latest, b.latest)) return false;
    if (a.history.length !== b.history.length) return false;
  }
  return true;
}

function sameText(left: SentenceText | null, right: SentenceText | null): boolean {
  if (left === null || right === null) return left === right;
  return left.text === right.text && left.hash === right.hash && left.section === right.section
    && left.span[0] === right.span[0] && left.span[1] === right.span[1];
}

export function sameTagged(left: readonly TaggedSentence[], right: readonly TaggedSentence[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.status !== b.status) return false;
    if (!sameStrings(a.clauses, b.clauses)) return false;
    if (a.tokens.length !== b.tokens.length) return false;
    for (let token = 0; token < a.tokens.length; token += 1) {
      const leftToken = a.tokens[token];
      const rightToken = b.tokens[token];
      if (leftToken === undefined || rightToken === undefined) return false;
      if (leftToken.id !== rightToken.id || leftToken.text !== rightToken.text) return false;
      if (leftToken.origin !== rightToken.origin || leftToken.status !== rightToken.status) return false;
      if ((leftToken.skipped === true) !== (rightToken.skipped === true)) return false;
      if (leftToken.lemma !== rightToken.lemma || leftToken.participle !== rightToken.participle) return false;
      if (!sameClauseBound(leftToken.clause, rightToken.clause)) return false;
      if (leftToken.span[0] !== rightToken.span[0] || leftToken.span[1] !== rightToken.span[1]) return false;
      if (!sameStrings(leftToken.tags, rightToken.tags) || !sameStrings(leftToken.sources, rightToken.sources)) return false;
    }
  }
  return true;
}

export function sameClauseBound(left: ClauseBound | undefined, right: ClauseBound | undefined): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return left.text === right.text && left.start === right.start && left.end === right.end;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function freshSentenceId(used: ReadonlySet<string>): string {
  let number = 1;
  while (used.has(`s${number}`)) number += 1;
  return `s${number}`;
}

function retarget(item: TaggedSentence, delta: number): TaggedSentence {
  const clauses: string[] = [];
  for (const clause of item.clauses) clauses.push(clause);
  const tokens: Token[] = [];
  for (const token of item.tokens) {
    const sources: string[] = [];
    for (const source of token.sources) sources.push(source);
    const tags: string[] = [];
    for (const tag of token.tags) tags.push(tag);
    const next: Token = {
      id: token.id,
      text: token.text,
      tags,
      span: [token.span[0] + delta, token.span[1] + delta],
      origin: token.origin,
      status: token.status,
      sources,
    };
    if (token.skipped === true) next.skipped = true;
    if (token.lemma !== undefined) next.lemma = token.lemma;
    if (token.participle !== undefined) next.participle = token.participle;
    if (token.clause !== undefined) {
      next.clause = { text: token.clause.text, start: token.clause.start, end: token.clause.end };
    }
    tokens.push(next);
  }
  return { id: item.id, status: item.status, clauses, tokens };
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie',
  'inc', 'ltd', 'co', 'fig', 'al', 'approx', 'no', 'vol', 'dept', 'est',
]);

export function splitSpec(source: string): SplitResult {
  const lines = linesOf(source);
  const sentences: SplitSentence[] = [];
  const emptySpans: [number, number][] = [];
  const sectionStack: { level: number; title: string }[] = [];
  let fence: string | undefined;
  let inComment = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    const trimmed = line.text.trim();
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      index += 1;
      continue;
    }
    if (fence !== undefined) {
      if (closesFence(line.text, fence)) fence = undefined;
      index += 1;
      continue;
    }
    const opened = openFence(line.text);
    if (opened !== undefined) {
      fence = opened;
      index += 1;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      index += 1;
      continue;
    }
    if (trimmed === '') {
      index += 1;
      continue;
    }
    const heading = atxHeading(line.text);
    if (heading !== undefined) {
      while (sectionStack.length > 0) {
        const top = sectionStack[sectionStack.length - 1];
        if (top === undefined || top.level < heading.level) break;
        sectionStack.pop();
      }
      if (heading.title !== '') sectionStack.push(heading);
      index += 1;
      continue;
    }
    if (isThematicBreak(line.text)) {
      index += 1;
      continue;
    }
    const section = sectionPath(sectionStack);
    const list = listMarker(line.text);
    if (list !== undefined) {
      const contentStart = line.start + list.markerLength;
      let contentEnd = line.end;
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (next === undefined) break;
        if (next.text.trim() === '') break;
        if (atxHeading(next.text) !== undefined || openFence(next.text) !== undefined) break;
        if (listMarker(next.text) !== undefined || isThematicBreak(next.text)) break;
        if (next.text.trim().startsWith('<!--')) break;
        if (!isIndentedContinuation(next.text, list.indent)) break;
        contentEnd = next.end;
        index += 1;
      }
      pushBlock(source, contentStart, contentEnd, section, sentences, emptySpans);
      continue;
    }
    const start = line.start;
    let end = line.end;
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (next === undefined) break;
      if (next.text.trim() === '') break;
      if (atxHeading(next.text) !== undefined || openFence(next.text) !== undefined) break;
      if (listMarker(next.text) !== undefined || isThematicBreak(next.text)) break;
      if (next.text.trim().startsWith('<!--')) break;
      end = next.end;
      index += 1;
    }
    pushBlock(source, start, end, section, sentences, emptySpans);
  }
  return { sentences, emptySpans };
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
}

function linesOf(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && source[index] !== '\n') continue;
    let end = index;
    if (end > start && source[end - 1] === '\r') end -= 1;
    lines.push({ text: source.slice(start, end), start, end });
    start = index + 1;
  }
  return lines;
}

function sectionPath(stack: readonly { title: string }[]): string {
  const titles: string[] = [];
  for (const item of stack) titles.push(item.title);
  return titles.join(' / ');
}

function atxHeading(text: string): { level: number; title: string } | undefined {
  const match = /^( {0,3})(#{1,6})[ \t]+(.*)$/.exec(text);
  if (match === null) return undefined;
  const marks = match[2];
  if (marks === undefined) return undefined;
  const title = (match[3] ?? '').replace(/[ \t]+#+\s*$/, '').trim();
  return { level: marks.length, title };
}

function isThematicBreak(text: string): boolean {
  return /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text.trimEnd());
}

function listMarker(text: string): { markerLength: number; indent: number } | undefined {
  const match = /^( {0,3})(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(text);
  if (match === null) return undefined;
  return { markerLength: match[0].length, indent: (match[1] ?? '').length };
}

function isIndentedContinuation(text: string, markerIndent: number): boolean {
  let spaces = 0;
  while (spaces < text.length && text[spaces] === ' ') spaces += 1;
  if (text[spaces] === '\t') return true;
  return spaces >= markerIndent + 2;
}

function openFence(text: string): string | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(text);
  const marks = match?.[1];
  if (marks === undefined) return undefined;
  return marks[0];
}

function closesFence(text: string, char: string): boolean {
  const escaped = char === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${escaped}{3,}[ \\t]*$`).test(text);
}

function pushBlock(
  source: string,
  start: number,
  end: number,
  section: string,
  sentences: SplitSentence[],
  emptySpans: [number, number][],
): void {
  if (end < start) return;
  const raw = source.slice(start, end);
  const parts = splitSentences(raw);
  if (parts.length === 0) {
    if (raw.trim() !== '') emptySpans.push([start, end]);
    return;
  }
  for (const part of parts) {
    sentences.push({
      text: part.text,
      span: [start + part.from, start + part.to],
      section,
    });
  }
}

function splitSentences(raw: string): { text: string; from: number; to: number }[] {
  const parts: { text: string; from: number; to: number }[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    let boundary = -1;
    for (let index = cursor; index < raw.length; index += 1) {
      if (isSentenceBoundary(raw, index)) {
        boundary = index;
        break;
      }
    }
    const end = boundary === -1 ? raw.length : consumeClosers(raw, boundary + 1);
    const from = skipSpace(raw, cursor);
    let to = end;
    while (to > from && isSpace(raw[to - 1] ?? '')) to -= 1;
    const text = raw.slice(from, to);
    if (text !== '' && /[\p{L}\p{N}]/u.test(text)) parts.push({ text, from, to });
    if (boundary === -1) break;
    cursor = skipSpace(raw, end);
  }
  return parts;
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index];
  if (char !== '.' && char !== '!' && char !== '?') return false;
  if (char === '.' && text[index + 1] === '.') return false;
  if (char === '.' && isDecimal(text, index)) return false;
  if (char === '.' && isAbbreviation(wordBefore(text, index))) return false;
  const afterCloser = consumeClosers(text, index + 1);
  if (afterCloser >= text.length) return true;
  if (!isSpace(text[afterCloser] ?? '')) return false;
  const next = text[skipSpace(text, afterCloser)];
  if (next === undefined) return true;
  return startsSentence(next);
}

function startsSentence(char: string): boolean {
  if (char === '"' || char === "'" || char === '(') return true;
  if (/\p{Ll}/u.test(char)) return false;
  return /\p{L}/u.test(char);
}

function isDecimal(text: string, index: number): boolean {
  const before = text[index - 1];
  const after = text[index + 1];
  return before !== undefined && after !== undefined && /[0-9]/.test(before) && /[0-9]/.test(after);
}

function isAbbreviation(word: string): boolean {
  if (word.length === 1 && /\p{L}/u.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

function wordBefore(text: string, index: number): string {
  let start = index;
  while (start > 0 && /\p{L}/u.test(text[start - 1] ?? '')) start -= 1;
  return text.slice(start, index);
}

function consumeClosers(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && isCloser(text[cursor] ?? '')) cursor += 1;
  return cursor;
}

function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && isSpace(text[cursor] ?? '')) cursor += 1;
  return cursor;
}

function isCloser(char: string): boolean {
  return char === '"' || char === "'" || char === ')' || char === ']' || char === '`';
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
