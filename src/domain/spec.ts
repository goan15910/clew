// Sentences, tokens, and findings for a spec session.
// Pure data and rules. No tagger, no files, no Zod.

export const SPEC_SCHEMA_VERSION = 1 as const;

export const SPEC_SESSION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const SPEC_SESSION_ID_MESSAGE = 'session ids start with a letter and then use letters, digits, underscores, or hyphens';
export const SPEC_SENTENCE_ID_PATTERN = /^s[1-9][0-9]*$/;
export const SPEC_SENTENCE_ID_MESSAGE = 'sentence ids look like s1';

export type SpecOrigin = 'tagger' | 'rule' | 'agent';
export type SpecItemStatus = 'current' | 'stale';
export type EntityKind = 'actor' | 'object' | 'action' | 'condition';
export type EntityReview = 'candidate' | 'confirmed' | 'rejected';
export type EntityStatus = EntityReview | 'stale';
export type FactType = 'performs' | 'transition' | 'guard' | 'initial' | 'final' | 'forbidden';
export type FindingKind = 'gap' | 'conflict' | 'stale' | 'vocabulary' | 'coverage';
export type FindingSeverity = 'blocking' | 'warning' | 'info';

export const SPEC_ENTITY_ID_PATTERN = /^(actor|object|action|condition):[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const SPEC_ENTITY_ID_MESSAGE = 'entity ids look like actor:customer or condition:c1';
export const SPEC_FACT_ID_PATTERN = /^f[1-9][0-9]*$/;
export const SPEC_FACT_ID_MESSAGE = 'fact ids look like f1';
export const FACT_TYPES = ['performs', 'transition', 'guard', 'initial', 'final', 'forbidden'] as const;
export const ENTITY_KINDS = ['actor', 'object', 'action', 'condition'] as const;

export interface Finding {
  id: string;
  kind: FindingKind;
  code: string;
  severity: FindingSeverity;
  message: string;
  refs: string[];
}

export interface Sentence {
  id: string;
  text: string;
  span: [number, number];
  hash: string;
  section: string;
  origin: 'rule';
  status: SpecItemStatus;
  sources: string[];
}

export interface SentenceDraft {
  text: string;
  span: [number, number];
  hash: string;
  section: string;
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
}

export interface Entity {
  id: string;
  kind: EntityKind;
  name?: string;
  text?: string;
  sources: string[];
  origin: SpecOrigin;
  status: EntityStatus;
  /** Review to restore when a stale entity's sources come back. */
  review?: EntityReview;
  note?: string;
}

export interface Fact {
  id: string;
  type: FactType;
  actor?: string;
  action?: string;
  object?: string;
  from?: string | null;
  to?: string;
  condition?: string;
  state?: string;
  origin: SpecOrigin;
  confidence: number;
  sources: string[];
  status: SpecItemStatus;
  note?: string;
  /** Agent removed this fact. Propose must not recreate its signature. */
  removed?: boolean;
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
  entities?: Entity[];
  facts?: Fact[];
  graph?: DraftGraph;
}

export type FlowOrigin = 'rule' | 'agent';

/** One state of one object. `facts` are the initial, final, and transition facts that name it. */
export interface GraphState {
  id: string;
  object: string;
  initial?: true;
  final?: true;
  facts: string[];
}

/** One edge assembled from a transition fact. `fact` is that fact's id. */
export interface GraphTransition {
  id: string;
  from: string;
  event: string;
  to: string;
  actor?: string;
  guard?: string;
  object: string;
  fact: string;
  facts: string[];
}

/**
 * One named path through the graph.
 * Accepted paths list transition ids. A rejected path may list one transition,
 * or only `forbidden` when the refusal has no matching transition yet.
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
  | 'spec.spans.merge'
  | 'spec.spans.check'
  | 'spec.entities.list'
  | 'spec.entities.merge'
  | 'spec.entities.rename'
  | 'spec.entities.reject'
  | 'spec.entities.promote'
  | 'spec.facts.propose'
  | 'spec.facts.add'
  | 'spec.facts.edit'
  | 'spec.facts.remove'
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

export function currentSentences(sentences: readonly Sentence[]): Sentence[] {
  const current: Sentence[] = [];
  for (const sentence of sentences) {
    if (sentence.status === 'current') current.push(sentence);
  }
  return current;
}

export function sentenceIds(sentences: readonly Sentence[]): string[] {
  const ids: string[] = [];
  for (const sentence of currentSentences(sentences)) ids.push(sentence.id);
  return ids;
}

const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}]/u;
const CONDITION_WORD = /\b(if|when|unless)\b/i;

export function suspectsNonEnglish(text: string): boolean {
  return NON_LATIN.test(text);
}

export function initFindings(sentences: readonly Sentence[], emptySpans: readonly [number, number][]): Finding[] {
  const findings: Finding[] = [];
  const current = currentSentences(sentences);
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

export function staleFindings(sentences: readonly Sentence[]): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of sentences) {
    if (sentence.status !== 'stale') continue;
    findings.push({
      id: `stale:${sentence.id}`,
      kind: 'stale',
      code: 'stale-sentence',
      severity: 'warning',
      message: `${sentence.id} is stale because that sentence changed or was removed`,
      refs: [sentence.id],
    });
  }
  return findings;
}

export function tagFindings(sentenceId: string, text: string, tokens: readonly { tags: readonly string[] }[], clauses: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  let verb = false;
  let actor = false;
  for (const token of tokens) {
    for (const tag of token.tags) {
      if (tag === 'Verb') verb = true;
      if (tag === 'Actor') actor = true;
    }
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
  if (word !== undefined && clauses.length < 2) {
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

export function tokensFromTagging(sentence: Sentence, tagging: PosTagging): Token[] {
  const tokens: Token[] = [];
  let index = 1;
  for (const token of tagging.tokens) {
    const id = `${sentence.id}.t${index}`;
    index += 1;
    tokens.push({
      id,
      text: token.text,
      tags: token.tags.slice(),
      span: [sentence.span[0] + token.start, sentence.span[0] + token.end],
      origin: 'tagger',
      status: 'current',
      sources: [sentence.id],
    });
  }
  return tokens;
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
 * Match drafts to stored sentences by hash. Unchanged text keeps its id.
 * A sentence that disappeared becomes stale and is kept. Token spans shift
 * when the same text moves in the file.
 */
export function applySpecText(
  previousSentences: readonly Sentence[],
  previousTagged: readonly TaggedSentence[],
  drafts: readonly SentenceDraft[],
): { sentences: Sentence[]; tagged: TaggedSentence[] } {
  const pools = new Map<string, { current: Sentence[]; stale: Sentence[] }>();
  for (const sentence of previousSentences) {
    let pool = pools.get(sentence.hash);
    if (pool === undefined) {
      pool = { current: [], stale: [] };
      pools.set(sentence.hash, pool);
    }
    if (sentence.status === 'current') pool.current.push(sentence);
    else pool.stale.push(sentence);
  }
  const used = new Set<string>();
  for (const sentence of previousSentences) used.add(sentence.id);
  const revived = new Set<string>();
  const current: Sentence[] = [];
  for (const draft of drafts) {
    const pool = pools.get(draft.hash) ?? { current: [], stale: [] };
    let previous: Sentence | undefined;
    while (previous === undefined && pool.current.length > 0) {
      const candidate = pool.current.shift();
      if (candidate !== undefined && !revived.has(candidate.id)) previous = candidate;
    }
    while (previous === undefined && pool.stale.length > 0) {
      const candidate = pool.stale.shift();
      if (candidate !== undefined && !revived.has(candidate.id)) previous = candidate;
    }
    const id = previous === undefined ? freshSentenceId(used) : previous.id;
    used.add(id);
    revived.add(id);
    const sources: string[] = [];
    if (previous !== undefined) {
      for (const source of previous.sources) sources.push(source);
    }
    current.push({
      id,
      text: draft.text,
      span: [draft.span[0], draft.span[1]],
      hash: draft.hash,
      section: draft.section,
      origin: 'rule',
      status: 'current',
      sources,
    });
  }
  const stale: Sentence[] = [];
  for (const sentence of previousSentences) {
    if (revived.has(sentence.id)) continue;
    const sources: string[] = [];
    for (const source of sentence.sources) sources.push(source);
    stale.push({
      id: sentence.id,
      text: sentence.text,
      span: [sentence.span[0], sentence.span[1]],
      hash: sentence.hash,
      section: sentence.section,
      origin: 'rule',
      status: 'stale',
      sources,
    });
  }
  const sentences = [...current, ...stale];
  const nextById = new Map<string, Sentence>();
  const previousById = new Map<string, Sentence>();
  for (const sentence of sentences) nextById.set(sentence.id, sentence);
  for (const sentence of previousSentences) previousById.set(sentence.id, sentence);
  const tagged: TaggedSentence[] = [];
  for (const item of previousTagged) {
    const next = nextById.get(item.id);
    const prev = previousById.get(item.id);
    if (next === undefined || next.status === 'stale') {
      tagged.push(retarget(item, 'stale', 0));
      continue;
    }
    const delta = prev === undefined ? 0 : next.span[0] - prev.span[0];
    tagged.push(retarget(item, 'current', delta));
  }
  return { sentences, tagged };
}

export function sameSentences(left: readonly Sentence[], right: readonly Sentence[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.text !== b.text || a.hash !== b.hash || a.section !== b.section) return false;
    if (a.status !== b.status || a.origin !== b.origin) return false;
    if (a.span[0] !== b.span[0] || a.span[1] !== b.span[1]) return false;
    if (!sameStrings(a.sources, b.sources)) return false;
  }
  return true;
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
      if (leftToken.span[0] !== rightToken.span[0] || leftToken.span[1] !== rightToken.span[1]) return false;
      if (!sameStrings(leftToken.tags, rightToken.tags) || !sameStrings(leftToken.sources, rightToken.sources)) return false;
    }
  }
  return true;
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

function retarget(item: TaggedSentence, status: SpecItemStatus, delta: number): TaggedSentence {
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
      status,
      sources,
    };
    if (token.skipped === true) next.skipped = true;
    tokens.push(next);
  }
  return { id: item.id, status, clauses, tokens };
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
