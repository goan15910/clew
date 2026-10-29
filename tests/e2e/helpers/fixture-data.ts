// Deterministic expectations for tests/fixtures/sessions/viewer-matrix.
// Mirrors viewer-page.ts filter + lineage rules so the matrix stays honest.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURE_SESSION_ID = 'viewer-matrix';
export const FIXTURE_DIR = join(root, 'tests', 'fixtures', 'sessions', FIXTURE_SESSION_ID);

export const VIEWS = ['facts', 'entities', 'sentences'] as const;
export type View = (typeof VIEWS)[number];

export const KINDS = ['', 'actor', 'object', 'action', 'condition'] as const;
export const TYPES = ['', 'performs', 'transition', 'guard', 'initial', 'final', 'forbidden'] as const;
export const STATUSES = ['', 'current', 'stale'] as const;
export const SEARCHES = ['', 'f1', 'customer', 's1', 'approve', 'zzzz-no-match'] as const;

export type Kind = (typeof KINDS)[number];
export type Type = (typeof TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type Search = (typeof SEARCHES)[number];

export interface FixtureFilters {
  text: string;
  kind: string;
  type: string;
  status: string;
}

interface Entity {
  id: string;
  kind: string;
  name?: string;
  text?: string;
  note?: string;
  sources?: string[];
  status: string;
  origin: string;
}

interface Fact {
  id: string;
  type: string;
  actor?: string;
  action?: string;
  object?: string;
  condition?: string;
  state?: string;
  from?: string | null;
  to?: string;
  note?: string;
  sources?: string[];
  status: string;
  origin: string;
  confidence: number;
  removed?: boolean;
}

interface Sentence {
  id: string;
  text: string;
  section: string;
  status: string;
  span?: [number, number];
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
}

interface Graph {
  transitions?: Array<{ id: string; from: string; event: string; to: string; fact?: string; facts?: string[] }>;
  states?: Array<{ id: string; object: string; facts?: string[] }>;
  flows?: Array<{ id: string; forbidden?: string }>;
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

const session = loadJson<{ id: string; specPath: string; updated: string }>('session.json');
const sentencesFile = loadJson<{ sentences: Sentence[] }>('sentences.json');
const tokensFile = loadJson<{ sentences: TaggedSentence[] }>('tokens.json');
const spansFile = loadJson<{ spans: Span[] }>('spans.json');
const entitiesFile = loadJson<{ entities: Entity[] }>('entities.json');
const factsFile = loadJson<{ facts: Fact[] }>('facts.json');
const graph = loadJson<Graph>('graph.json');

export const fixture = {
  session,
  sentences: sentencesFile.sentences,
  tagged: tokensFile.sentences,
  spans: spansFile.spans,
  entities: entitiesFile.entities,
  facts: factsFile.facts,
  graph,
};

function matchesText(haystacks: Array<string | null | undefined>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return haystacks.some((item) => item !== undefined && item !== null && String(item).toLowerCase().includes(needle));
}

function entityMap(): Map<string, Entity> {
  return new Map(fixture.entities.map((entity) => [entity.id, entity]));
}

function spanMap(): Map<string, Span> {
  return new Map(fixture.spans.map((span) => [span.id, span]));
}

function tokenMap(): Map<string, { token: Token; sentenceId: string }> {
  const map = new Map<string, { token: Token; sentenceId: string }>();
  for (const row of fixture.tagged) {
    for (const token of row.tokens ?? []) map.set(token.id, { token, sentenceId: row.id });
  }
  return map;
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

function spanSentenceRow(sentence: Sentence, marks: Span[]): { layer: string; text: string } {
  const ids = spanRangeLabel(marks);
  return { layer: 'span', text: `${ids} [${sentence.section}] “${sentence.text}”` };
}

function spanRow(span: Span, withTags: boolean): { layer: string; text: string } {
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

function appendSpanSources(rows: Array<{ layer: string; text: string }>, sources: string[]): void {
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

export function expectedFactIds(filters: FixtureFilters): string[] {
  const entities = entityMap();
  return fixture.facts
    .filter((fact) => {
      if (fact.removed === true) return false;
      if (filters.type && fact.type !== filters.type) return false;
      if (filters.status && fact.status !== filters.status) return false;
      if (filters.kind) {
        const ids = [fact.actor, fact.action, fact.object, fact.condition];
        const hit = ids.some((id) => {
          const entity = id ? entities.get(id) : undefined;
          return entity?.kind === filters.kind;
        });
        if (!hit) return false;
      }
      return matchesText(
        [
          fact.id,
          fact.type,
          fact.actor,
          fact.action,
          fact.object,
          fact.condition,
          fact.state,
          fact.from === null ? undefined : fact.from,
          fact.to,
          fact.note,
          ...(fact.sources ?? []),
        ],
        filters.text,
      );
    })
    .map((fact) => fact.id);
}

export function expectedEntityIds(filters: FixtureFilters): string[] {
  return fixture.entities
    .filter((entity) => {
      if (filters.kind && entity.kind !== filters.kind) return false;
      return matchesText(
        [entity.id, entity.kind, entity.name, entity.text, entity.note, ...(entity.sources ?? [])],
        filters.text,
      );
    })
    .map((entity) => entity.id);
}

export function expectedSentenceIds(filters: FixtureFilters): string[] {
  return fixture.sentences
    .filter((sentence) => {
      const spans = spansForSentence(sentence.id);
      const surfaces = spans.map((span) => span.surface);
      const ids = spans.map((span) => span.id);
      return matchesText(
        [sentence.id, sentence.text, sentence.section, sentence.status, ...surfaces, ...ids],
        filters.text,
      );
    })
    .map((sentence) => sentence.id);
}

export function expectedVisibleIds(view: View, filters: FixtureFilters): string[] {
  if (view === 'facts') return expectedFactIds(filters);
  if (view === 'entities') return expectedEntityIds(filters);
  return expectedSentenceIds(filters);
}

export function expectedFactLineage(factId: string): Array<{ layer: string; text: string }> {
  const fact = fixture.facts.find((row) => row.id === factId);
  if (!fact) return [];
  const entities = entityMap();
  const rows: Array<{ layer: string; text: string }> = [];
  for (const field of ['actor', 'action', 'object', 'condition'] as const) {
    const id = fact[field];
    if (!id) continue;
    const entity = entities.get(id);
    const label = entity ? (entity.name || entity.text || id) : id;
    rows.push({ layer: 'entity', text: `${field} → ${id} (${label})` });
    if (entity) appendSpanSources(rows, entity.sources ?? []);
  }
  for (const source of fact.sources ?? []) {
    if (/^s[1-9][0-9]*$/.test(source)) {
      const sentence = sentenceById(source);
      rows.push({ layer: 'sentence', text: source + (sentence ? ` “${sentence.text}”` : '') });
    } else if (/^s[1-9][0-9]*\.t[1-9][0-9]*$/.test(source) || /^sp:/.test(source)) {
      const hit = resolveSourceSpan(source);
      const sentence = hit ? sentenceById(hit.sentenceId) : undefined;
      if (sentence && hit) rows.push(spanSentenceRow(sentence, [hit.span]));
      else if (hit) rows.push(spanRow(hit.span, false));
      else rows.push({ layer: 'source', text: source });
    } else {
      rows.push({ layer: 'source', text: source });
    }
  }
  for (const transition of fixture.graph.transitions ?? []) {
    if (transition.fact === fact.id || (transition.facts ?? []).includes(fact.id)) {
      rows.push({
        layer: 'transition',
        text: `${transition.id} ${transition.from} -${transition.event}→ ${transition.to}`,
      });
    }
  }
  for (const graphState of fixture.graph.states ?? []) {
    if ((graphState.facts ?? []).includes(fact.id)) {
      rows.push({ layer: 'state', text: `${graphState.id} (${graphState.object})` });
    }
  }
  for (const flow of fixture.graph.flows ?? []) {
    if (flow.forbidden === fact.id) rows.push({ layer: 'flow', text: `${flow.id} forbidden ${fact.id}` });
  }
  return rows;
}

export function expectedEntityLineage(entityId: string): Array<{ layer: string; text: string }> {
  const entity = fixture.entities.find((row) => row.id === entityId);
  if (!entity) return [];
  const rows: Array<{ layer: string; text: string }> = [];
  appendSpanSources(rows, entity.sources ?? []);
  for (const fact of fixture.facts) {
    const refs = [fact.actor, fact.action, fact.object, fact.condition];
    if (refs.includes(entity.id)) rows.push({ layer: 'fact', text: `${fact.id} ${fact.type}` });
  }
  return rows;
}

export function expectedSentenceLineage(sentenceId: string): Array<{ layer: string; text: string }> {
  const sentence = sentenceById(sentenceId);
  if (!sentence) return [];
  const rows: Array<{ layer: string; text: string }> = [];
  for (const entity of fixture.entities) {
    for (const source of entity.sources ?? []) {
      if (source === sentence.id || source.startsWith(`${sentence.id}.`)) {
        rows.push({ layer: 'entity', text: `${entity.id} via ${source}` });
        break;
      }
    }
  }
  for (const fact of fixture.facts) {
    for (const source of fact.sources ?? []) {
      if (source === sentence.id || source.startsWith(`${sentence.id}.`)) {
        rows.push({ layer: 'fact', text: `${fact.id} ${fact.type} via ${source}` });
        break;
      }
    }
  }
  return rows;
}

/** Matches viewer-page.ts lineageBlock pane order. */
const LINEAGE_ORDER = ['span', 'sentence', 'entity', 'fact', 'source', 'transition', 'state', 'flow'];

function groupLineageRows(
  rows: Array<{ layer: string; text: string }>,
): Array<{ layer: string; text: string }> {
  const groups = new Map<string, Array<{ layer: string; text: string }>>();
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

export function expectedLineage(view: View, id: string): Array<{ layer: string; text: string }> {
  const rows =
    view === 'facts'
      ? expectedFactLineage(id)
      : view === 'entities'
        ? expectedEntityLineage(id)
        : expectedSentenceLineage(id);
  return groupLineageRows(rows);
}

export function expectedMeta(): { id: string; sentences: number; entities: number; facts: number } {
  return {
    id: fixture.session.id,
    sentences: fixture.sentences.length,
    entities: fixture.entities.length,
    facts: fixture.facts.filter((fact) => fact.removed !== true).length,
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
