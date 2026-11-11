// Deterministic expectations for tests/fixtures/sessions/viewer-matrix.
// Mirrors viewer-page.ts filter + lineage rules so the matrix stays honest.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFrames } from '../../../src/domain/spec-compile.js';
import { predicateText } from '../../../src/domain/spec-expr.js';
import { attachOverlay } from '../../../src/domain/spec-graph.js';
import { clauseReach, type ClauseReach } from '../../../src/domain/spec-kernel.js';
import type { Concept, DraftGraph, FieldVersion, Frame, RoleName, SpecFlow } from '../../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURE_SESSION_ID = 'viewer-matrix';
export const FIXTURE_DIR = join(root, 'tests', 'fixtures', 'sessions', FIXTURE_SESSION_ID);

export const VIEWS = ['frames', 'concepts', 'sentences'] as const;
export type View = (typeof VIEWS)[number];

export const FRAME_FILTERS = ['', 'transition', 'not-transition', 'negated', 'incomplete'] as const;
// Actor, two-member object, event-only (via the event span), and a concept cited by no frame role.
export const CONCEPT_FILTERS = ['', 'concept:customer', 'concept:order', 'concept:submit', 'concept:total'] as const;
export const SEARCHES = ['', 'fr:s1.t1', 'customer', 's2', 'approve', 'unknown', 'zzzz-no-match'] as const;

export interface FixtureFilters {
  text: string;
  frame: string;
  concept: string;
}

interface SentenceText {
  text: string;
  section: string;
  span: [number, number];
}

interface StoredSentence {
  id: string;
  original: SentenceText | null;
  latest: SentenceText | null;
}

interface Sentence extends SentenceText {
  id: string;
  state: string;
}

interface Token {
  id: string;
  text: string;
  tags?: string[];
  span?: [number, number];
  skipped?: boolean;
}

interface TaggedSentence {
  id: string;
  tokens?: Token[];
}

interface Span {
  id: string;
  firstTokenId: string;
  lastTokenId: string;
  surface: string;
  tags?: string[];
  insignificant?: boolean;
  lemma?: string;
  entityId?: string;
  clause?: { text: string; start: number; end: number };
}

function sentenceView(record: StoredSentence): Sentence {
  const shown = record.latest ?? record.original;
  if (shown === null) throw new Error(`${record.id} has no text`);
  return { id: record.id, ...shown, state: record.latest === null ? 'deleted' : 'original' };
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

const session = loadJson<{ id: string; updated: string }>('session.json');
const sentencesFile = loadJson<{ sentences: StoredSentence[] }>('sentences.json');
const tokensFile = loadJson<{ sentences: TaggedSentence[] }>('tokens.json');
const spansFile = loadJson<{ spans: Span[] }>('spans.json');
const conceptsFile = loadJson<{ concepts: Concept[] }>('concepts.json');
const framesFile = loadJson<{ frames: Frame[] }>('frames.json');
const flowsFile = loadJson<{ flows: SpecFlow[] }>('flows.json');
const graph: DraftGraph = attachOverlay(compileFrames(framesFile.frames, conceptsFile.concepts).compiled, flowsFile.flows);

export const fixture = {
  session,
  sentences: sentencesFile.sentences.map(sentenceView),
  tagged: tokensFile.sentences,
  spans: spansFile.spans,
  concepts: conceptsFile.concepts,
  frames: framesFile.frames,
  graph,
};

function matchesText(haystacks: Array<string | null | undefined>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return haystacks.some((item) => item !== undefined && item !== null && String(item).toLowerCase().includes(needle));
}

function spanMap(): Map<string, Span> {
  return new Map(fixture.spans.map((span) => [span.id, span]));
}

function tokenOrder(): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  for (const row of fixture.tagged) {
    for (const token of row.tokens ?? []) {
      order.set(token.id, index);
      index += 1;
    }
  }
  return order;
}

function sentenceIdOfToken(tokenId: string): string {
  const dot = tokenId.indexOf('.');
  return dot > 0 ? tokenId.slice(0, dot) : '';
}

function spanCoversToken(span: Span, tokenId: string, order: Map<string, number>): boolean {
  const first = order.get(span.firstTokenId);
  const last = order.get(span.lastTokenId);
  const at = order.get(tokenId);
  return first !== undefined && last !== undefined && at !== undefined && at >= first && at <= last;
}

function spanForToken(tokenId: string): Span | undefined {
  const order = tokenOrder();
  return fixture.spans.find((span) => spanCoversToken(span, tokenId, order));
}

function sentenceById(id: string): Sentence | undefined {
  return fixture.sentences.find((sentence) => sentence.id === id);
}

function consecutiveSpans(prev: Span, next: Span, order: Map<string, number>): boolean {
  const left = order.get(prev.lastTokenId);
  const right = order.get(next.firstTokenId);
  return left !== undefined && right === left + 1;
}

function spanRangeLabel(marks: Span[]): string {
  const first = marks[0]!.id;
  return marks.length > 1 ? `${first}–${marks[marks.length - 1]!.id}` : first;
}

function spanSentenceRow(sentence: Sentence, marks: Span[]): LineageRow {
  const ids = spanRangeLabel(marks);
  return { layer: 'span', text: `${ids} [${sentence.section}] “${sentence.text}”` };
}

function spanRow(span: Span, withTags: boolean): LineageRow {
  const tags = span.tags ?? [];
  const text = span.id + ` “${span.surface}”` + (withTags ? ` [${tags.join('|')}]` : '');
  return { layer: 'span', text };
}

function resolveSourceSpan(source: string): { span: Span; sentenceId: string } | null {
  if (/^sp:/.test(source)) {
    const span = spanMap().get(source);
    if (!span) return null;
    return { span, sentenceId: sentenceIdOfToken(span.firstTokenId) };
  }
  if (/^s[1-9][0-9]*\.t[1-9][0-9]*$/.test(source)) {
    const span = spanForToken(source);
    if (!span) return null;
    return { span, sentenceId: sentenceIdOfToken(source) };
  }
  return null;
}

function appendSpanSources(rows: LineageRow[], sources: string[]): void {
  const order = tokenOrder();
  let run: Array<{ span: Span; sentenceId: string }> = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const sentence = sentenceById(run[0]!.sentenceId);
    if (sentence) {
      rows.push(spanSentenceRow(sentence, run.map((hit) => hit.span)));
    } else {
      for (const hit of run) rows.push(spanRow(hit.span, true));
    }
    run = [];
  };
  for (const source of sources) {
    const hit = resolveSourceSpan(source);
    if (!hit) {
      flush();
      rows.push({ layer: 'source', text: source });
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && (prev.sentenceId !== hit.sentenceId || !consecutiveSpans(prev.span, hit.span, order))) flush();
    if (prev && prev.span.id === hit.span.id) continue;
    run.push(hit);
  }
  flush();
}

export interface LineageRow {
  layer: string;
  text: string;
}

const ROLES: RoleName[] = ['actor', 'event', 'object', 'result', 'when'];

function roleLatest(frame: Frame, role: RoleName): FieldVersion {
  return frame.roles[role].latest;
}

function roleKnown(frame: Frame, role: RoleName): boolean {
  return roleLatest(frame, role).value !== 'unknown';
}

export function roleText(frame: Frame, role: RoleName): string {
  const value = roleLatest(frame, role).value;
  return value === 'unknown' ? 'unknown' : value.text;
}

function roleRefs(frame: Frame, role: RoleName): string[] {
  const value = roleLatest(frame, role).value;
  return value === 'unknown' ? [] : [...value.refs];
}

function roleConcepts(frame: Frame, role: RoleName): string[] {
  const spans = spanMap();
  return roleRefs(frame, role)
    .map((ref) => (ref.startsWith('concept:') ? ref : (spans.get(ref)?.entityId ?? '')))
    .filter((id) => id !== '');
}

export function conceptRoles(frame: Frame, conceptId: string): RoleName[] {
  return (['actor', 'event', 'object', 'result'] as const).filter((role) => roleConcepts(frame, role).includes(conceptId));
}

export function frameIncomplete(frame: Frame): boolean {
  if (frame.notTransition) return false;
  return !roleKnown(frame, 'event') || !roleKnown(frame, 'object') || !roleKnown(frame, 'result');
}

function frameKind(frame: Frame): string {
  if (frame.notTransition) return 'not a transition';
  if (frame.negated === true) return 'negated';
  if (frameIncomplete(frame)) return 'incomplete';
  return 'transition';
}

export function frameFilterMatches(frame: Frame, value: string): boolean {
  if (value === 'transition') return !frame.notTransition;
  if (value === 'not-transition') return frame.notTransition !== undefined;
  if (value === 'negated') return frame.negated === true;
  if (value === 'incomplete') return frameIncomplete(frame);
  return true;
}

function sortedSpanIds(ids: readonly string[]): string[] {
  const spans = spanMap();
  const order = tokenOrder();
  const at = (id: string): number => {
    const span = spans.get(id);
    const index = span ? order.get(span.firstTokenId) : undefined;
    return index ?? Number.MAX_SAFE_INTEGER;
  };
  return [...ids].sort((left, right) => at(left) - at(right));
}

function frameDependsOn(frame: Frame): string[] {
  const ids: string[] = [];
  for (const role of ROLES) {
    for (const id of roleLatest(frame, role).dependsOn) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return sortedSpanIds(ids);
}

/** Kernel reach the Frames tab shows; a restating frame shows the reach of the frame it restates. */
export function frameReach(frameId: string): ClauseReach | undefined {
  const compilation = compileFrames(fixture.frames, fixture.concepts);
  const id = compilation.restated[frameId] ?? frameId;
  return clauseReach(compilation.compiled).find((entry) => entry.frame === id);
}

/** The guard expression the Frames tab shows in the `when` row; undefined when the frame compiles to nothing. */
export function frameWhen(frameId: string): string | undefined {
  const compilation = compileFrames(fixture.frames, fixture.concepts);
  const id = compilation.restated[frameId] ?? frameId;
  for (const item of compilation.compiled.items) {
    if (item.id === id && (item.kind === 'action' || item.kind === 'forbidden') && item.when !== undefined) return predicateText(item.when, 'math');
  }
  return undefined;
}

export function frameTransitions(frameId: string): DraftGraph['transitions'] {
  return fixture.graph.transitions.filter((transition) => transition.frame === frameId || transition.frames.includes(frameId));
}

function transitionRow(transition: DraftGraph['transitions'][number]): LineageRow {
  return { layer: 'transition', text: `${transition.id} ${transition.from} -${transition.event}→ ${transition.to}` };
}

function frameRow(frame: Frame, label: string): LineageRow {
  return { layer: 'frame', text: `${frame.id} ${label} “${frame.clause.text}”` };
}

function frameHaystacks(frame: Frame): string[] {
  const items = [frame.id, frame.sentence, frame.clause.text, frame.marker ?? '', frameKind(frame)];
  for (const role of ROLES) items.push(roleText(frame, role), ...roleRefs(frame, role), ...roleLatest(frame, role).dependsOn);
  return items;
}

function conceptMembers(concept: Concept): Array<{ span: string; surface: string; sentence: string }> {
  const spans = spanMap();
  return concept.members.map((id) => {
    const span = spans.get(id);
    return { span: id, surface: span ? span.surface : id, sentence: span ? sentenceIdOfToken(span.firstTokenId) : '' };
  });
}

export function expectedFrameIds(filters: FixtureFilters): string[] {
  return fixture.frames
    .filter((frame) => {
      if (filters.frame && !frameFilterMatches(frame, filters.frame)) return false;
      if (filters.concept && conceptRoles(frame, filters.concept).length === 0) return false;
      return matchesText(frameHaystacks(frame), filters.text);
    })
    .map((frame) => frame.id);
}

export function expectedConceptIds(filters: FixtureFilters): string[] {
  return fixture.concepts
    .filter((concept) => {
      if (filters.concept && concept.id !== filters.concept) return false;
      const members = conceptMembers(concept);
      return matchesText(
        [concept.id, concept.canonical, ...members.map((member) => member.span), ...members.map((member) => member.surface)],
        filters.text,
      );
    })
    .map((concept) => concept.id);
}

export function expectedSentenceIds(filters: FixtureFilters): string[] {
  return fixture.sentences
    .filter((sentence) => {
      const spans = spansForSentence(sentence.id);
      if (filters.concept && !spans.some((span) => span.entityId === filters.concept)) return false;
      if (
        filters.frame &&
        !fixture.frames.some((frame) => frame.sentence === sentence.id && frameFilterMatches(frame, filters.frame))
      ) {
        return false;
      }
      const surfaces = spans.map((span) => span.surface);
      const ids = spans.map((span) => span.id);
      return matchesText(
        [sentence.id, sentence.text, sentence.section, sentence.state, ...surfaces, ...ids],
        filters.text,
      );
    })
    .map((sentence) => sentence.id);
}

export function expectedVisibleIds(view: View, filters: FixtureFilters): string[] {
  if (view === 'frames') return expectedFrameIds(filters);
  if (view === 'concepts') return expectedConceptIds(filters);
  return expectedSentenceIds(filters);
}

export function expectedFrameLineage(frameId: string): LineageRow[] {
  const frame = fixture.frames.find((row) => row.id === frameId);
  if (!frame) return [];
  const rows: LineageRow[] = [];
  appendSpanSources(rows, frameDependsOn(frame));
  const sentence = sentenceById(frame.sentence);
  rows.push({ layer: 'sentence', text: frame.sentence + (sentence ? ` “${sentence.text}”` : '') });
  const concepts = new Map(fixture.concepts.map((concept) => [concept.id, concept]));
  for (const role of ['actor', 'event', 'object', 'result'] as const) {
    for (const id of roleConcepts(frame, role)) {
      rows.push({ layer: 'concept', text: `${role} → ${id} (${concepts.get(id)?.canonical ?? id})` });
    }
  }
  const frames = new Map(fixture.frames.map((row) => [row.id, row]));
  for (const id of roleRefs(frame, 'when')) {
    const cited = frames.get(id);
    rows.push(cited ? frameRow(cited, 'when →') : { layer: 'frame', text: `when → ${id}` });
  }
  for (const other of fixture.frames) {
    if (roleRefs(other, 'when').includes(frame.id)) rows.push(frameRow(other, 'when of →'));
  }
  const transitions = frameTransitions(frame.id);
  for (const transition of transitions) rows.push(transitionRow(transition));
  for (const graphState of fixture.graph.states) {
    if (graphState.frames.includes(frame.id)) rows.push({ layer: 'state', text: `${graphState.id} (${graphState.object})` });
  }
  for (const flow of fixture.graph.flows) {
    for (const transition of transitions) {
      if (flow.transitions.includes(transition.id)) rows.push({ layer: 'flow', text: `${flow.id} transition ${transition.id}` });
    }
  }
  for (const flow of fixture.graph.flows) {
    if (flow.forbidden === frame.id) rows.push({ layer: 'flow', text: `${flow.id} forbidden ${frame.id}` });
  }
  return rows;
}

export function expectedConceptLineage(conceptId: string): LineageRow[] {
  const concept = fixture.concepts.find((row) => row.id === conceptId);
  if (!concept) return [];
  const rows: LineageRow[] = [];
  appendSpanSources(rows, sortedSpanIds(concept.members));
  for (const frame of fixture.frames) {
    const roles = conceptRoles(frame, concept.id);
    if (roles.length) rows.push(frameRow(frame, roles.join(' · ')));
  }
  return rows;
}

function spanInSentence(spanId: string, sentenceId: string): boolean {
  const span = spanMap().get(spanId);
  return span !== undefined && sentenceIdOfToken(span.firstTokenId) === sentenceId;
}

export function expectedSentenceLineage(sentenceId: string): LineageRow[] {
  const sentence = sentenceById(sentenceId);
  if (!sentence) return [];
  const rows: LineageRow[] = [];
  for (const concept of fixture.concepts) {
    const member = sortedSpanIds(concept.members).find((id) => spanInSentence(id, sentence.id));
    if (member) rows.push({ layer: 'concept', text: `${concept.id} via ${member}` });
  }
  const frames = fixture.frames.filter((frame) => frame.sentence === sentence.id);
  for (const frame of frames) rows.push(frameRow(frame, frameKind(frame)));
  for (const frame of frames) {
    for (const transition of frameTransitions(frame.id)) rows.push(transitionRow(transition));
  }
  return rows;
}

/** Matches viewer-page.ts lineageBlock pane order. */
export const LINEAGE_ORDER = ['span', 'sentence', 'concept', 'frame', 'source', 'transition', 'state', 'flow'];

function groupLineageRows(rows: LineageRow[]): LineageRow[] {
  const groups = new Map<string, LineageRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.layer);
    if (bucket) bucket.push(row);
    else groups.set(row.layer, [row]);
  }
  const layers = Array.from(groups.keys()).sort((a, b) => {
    const left = LINEAGE_ORDER.indexOf(a);
    const right = LINEAGE_ORDER.indexOf(b);
    if (left === -1 && right === -1) return a < b ? -1 : a > b ? 1 : 0;
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });
  return layers.flatMap((layer) => groups.get(layer) ?? []);
}

export function expectedLineage(view: View, id: string): LineageRow[] {
  const rows =
    view === 'frames'
      ? expectedFrameLineage(id)
      : view === 'concepts'
        ? expectedConceptLineage(id)
        : expectedSentenceLineage(id);
  return groupLineageRows(rows);
}

export function expectedMeta(): { id: string; sentences: number; concepts: number; frames: number } {
  return {
    id: fixture.session.id,
    sentences: fixture.sentences.length,
    concepts: fixture.concepts.length,
    frames: fixture.frames.length,
  };
}

export function expectedSpanCount(): number {
  return fixture.spans.length;
}

export const PACKAGE_VERSION = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

const POS_ORDER = ['Verb', 'Noun', 'Pronoun', 'Adjective', 'Adverb', 'Determiner', 'Preposition', 'Conjunction', 'Value', 'Negative'];
const TAG_SKIP = ['Connector', 'TextValue', 'NumericValue'];

export function coarsePos(tags: string[]): string {
  return POS_ORDER.find((pos) => tags.includes(pos)) ?? tags[0] ?? '';
}

export function posLabel(tags: string[]): string {
  const pos = coarsePos(tags);
  const others = tags.filter((tag) => tag !== pos && !TAG_SKIP.includes(tag)).sort();
  return [...(pos ? [pos] : []), ...others].join(' · ');
}

export interface SpanFilterGroup {
  pos: string;
  options: Array<{ value: string; text: string }>;
}

export function expectedSpanFilterGroups(): SpanFilterGroup[] {
  const groups = new Map<string, { total: number; labels: Map<string, number> }>();
  for (const span of fixture.spans) {
    const tags = span.tags ?? [];
    const pos = coarsePos(tags);
    if (!pos) continue;
    const group = groups.get(pos) ?? { total: 0, labels: new Map<string, number>() };
    group.total += 1;
    const label = posLabel(tags);
    group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
    groups.set(pos, group);
  }
  const order = [
    ...POS_ORDER.filter((pos) => groups.has(pos)),
    ...[...groups.keys()].filter((pos) => !POS_ORDER.includes(pos)).sort(),
  ];
  return order.map((pos) => {
    const group = groups.get(pos)!;
    const labels = [...group.labels.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const options = [{ value: `pos:${pos}`, text: `${pos} · all (${group.total})` }];
    for (const [label, count] of labels) {
      if (label === pos && labels.length === 1) continue;
      options.push({ value: label, text: `${label} (${count})` });
    }
    return { pos, options };
  });
}

export function spanMatchesFilter(tags: string[], value: string): boolean {
  if (value.startsWith('pos:')) return coarsePos(tags) === value.slice(4);
  return posLabel(tags) === value;
}

export function expectedSpanFilterMatches(value: string): { sentences: string[]; spans: string[] } {
  const sentences: string[] = [];
  const spans: string[] = [];
  for (const sentence of fixture.sentences) {
    const hits = spansForSentence(sentence.id).filter((span) => spanMatchesFilter(span.tags ?? [], value));
    if (hits.length) sentences.push(sentence.id);
    spans.push(...hits.map((span) => span.id));
  }
  return { sentences, spans };
}

export function spansForSentence(sentenceId: string): Span[] {
  const order = tokenOrder();
  return fixture.spans
    .filter((span) => sentenceIdOfToken(span.firstTokenId) === sentenceId)
    .sort((left, right) => (order.get(left.firstTokenId) || 0) - (order.get(right.firstTokenId) || 0));
}

export function skippedSpansForSentence(sentenceId: string): Span[] {
  return spansForSentence(sentenceId).filter((span) => span.insignificant === true);
}

export function significantSpansForSentence(sentenceId: string): Span[] {
  return spansForSentence(sentenceId).filter((span) => span.insignificant !== true);
}

export function spanForSource(source: string): Span | undefined {
  return resolveSourceSpan(source)?.span;
}

export interface SpanTabEntry {
  key: string;
  surface: string;
  tags: string[];
  insignificant: boolean;
  count: number;
  pos: string;
}

function spanEntryKey(span: Span): string {
  return `${span.surface}\0${(span.tags ?? []).join('|')}`;
}

function isMultiTokenSpan(span: Span): boolean {
  return span.firstTokenId !== span.lastTokenId;
}

/** Mirrors viewer-page.ts uniqueSpanEntries + filters for the Span tab (all spans; multiTokenOnly mirrors the checkbox). */
export function expectedSpanTabEntries(options: {
  spans?: Span[];
  showInsignificant?: boolean;
  multiTokenOnly?: boolean;
  text?: string;
  spanFilter?: string;
} = {}): SpanTabEntry[] {
  const showInsignificant = options.showInsignificant === true;
  const text = options.text ?? '';
  const spanFilter = options.spanFilter ?? '';
  const source = options.spans ?? fixture.spans;
  const map = new Map<string, { surface: string; tags: string[]; insignificant: boolean; spans: Span[] }>();
  for (const span of source) {
    if (options.multiTokenOnly === true && !isMultiTokenSpan(span)) continue;
    const key = spanEntryKey(span);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        surface: span.surface,
        tags: [...(span.tags ?? [])],
        insignificant: span.insignificant === true,
        spans: [],
      };
      map.set(key, entry);
    }
    entry.spans.push(span);
    if (span.insignificant !== true) entry.insignificant = false;
  }
  const needle = text.trim().toLowerCase();
  return [...map.values()]
    .map((entry) => ({
      key: `${entry.surface}|${entry.tags.join('|')}`,
      surface: entry.surface,
      tags: entry.tags,
      insignificant: entry.insignificant,
      count: entry.spans.length,
      pos: coarsePos(entry.tags) || 'Untagged',
      mainPos: coarsePos(entry.tags),
      ids: entry.spans.map((span) => span.id),
    }))
    .filter((entry) => {
      if (!showInsignificant && entry.insignificant) return false;
      if (spanFilter && !spanMatchesFilter(entry.tags, spanFilter)) return false;
      if (needle === '') return true;
      const haystacks = [entry.surface, posLabel(entry.tags), ...entry.tags, ...entry.ids];
      return haystacks.some((item) => item.toLowerCase().includes(needle));
    })
    .sort((left, right) => {
      const leftIndex = POS_ORDER.indexOf(left.mainPos);
      const rightIndex = POS_ORDER.indexOf(right.mainPos);
      const leftOrder = leftIndex === -1 ? POS_ORDER.length : leftIndex;
      const rightOrder = rightIndex === -1 ? POS_ORDER.length : rightIndex;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.mainPos !== right.mainPos) return left.mainPos < right.mainPos ? -1 : 1;
      if (left.surface !== right.surface) return left.surface < right.surface ? -1 : 1;
      const leftLabel = posLabel(left.tags);
      const rightLabel = posLabel(right.tags);
      if (leftLabel !== rightLabel) return leftLabel < rightLabel ? -1 : 1;
      return 0;
    })
    .map(({ mainPos: _m, ids: _i, ...entry }) => entry);
}
