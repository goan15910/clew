// Entity candidates from live spans, and the agent edits that refine them.
// Spans → entities. Same-lemma nouns merge. Agent-owned entities are kept.
import { WORKFLOW_WORD_PATTERN } from './workflow.js';
import type {
  ClauseBound,
  Entity,
  EntityKind,
  EntityReview,
  Finding,
  LiveSpan,
  LiveSentence,
} from './spec.js';

const AUXILIARY = new Set(['Copula', 'Auxiliary', 'Modal']);
const SKIP_OBJECT = new Set(['Actor', 'Pronoun', 'Currency', 'Unit', 'Determiner', 'Value']);

const IRREGULAR_NOUN: Readonly<Record<string, string>> = {
  people: 'person', men: 'man', women: 'woman', children: 'child',
  mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose',
};

export function hasTag(tags: readonly string[], tag: string): boolean {
  for (const item of tags) {
    if (item === tag) return true;
  }
  return false;
}

export function isAuxiliary(tags: readonly string[]): boolean {
  for (const tag of tags) {
    if (AUXILIARY.has(tag)) return true;
  }
  return false;
}

export function normalizeWord(value: string): { word?: string; changed: boolean } {
  const word = value.trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!WORKFLOW_WORD_PATTERN.test(word)) return { changed: true };
  return { word, changed: word !== value };
}

/**
 * Verb base form from the span's stored compromise infinitive.
 * Falls back to the lowercased surface when no lemma was stored (synthetic fixtures).
 */
export function verbLemma(span: Pick<LiveSpan, 'surface' | 'lemma'> | string): string {
  if (typeof span === 'string') return span.toLowerCase();
  if (span.lemma !== undefined && span.lemma !== '') return span.lemma.toLowerCase();
  return span.surface.toLowerCase();
}

export function nounLemma(text: string): string {
  const word = text.toLowerCase();
  const irregular = IRREGULAR_NOUN[word];
  if (irregular !== undefined) return irregular;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

const PARTICIPLE: Readonly<Record<string, string>> = {
  submit: 'submitted',
  commit: 'committed',
  admit: 'admitted',
  permit: 'permitted',
  omit: 'omitted',
  prefer: 'preferred',
  refer: 'referred',
  occur: 'occurred',
  cancel: 'cancelled',
};

export function pastParticiple(lemma: string, surface?: string): string {
  const shown = surface?.toLowerCase();
  if (shown !== undefined && shown !== lemma && /ed$/.test(shown) && WORKFLOW_WORD_PATTERN.test(shown)) return shown;
  const irregular = PARTICIPLE[lemma];
  if (irregular !== undefined) return irregular;
  if (lemma.endsWith('e')) return `${lemma}d`;
  if (isSingleSyllableCvc(lemma)) return `${lemma}${lemma[lemma.length - 1] ?? ''}ed`;
  return `${lemma}ed`;
}

interface PlacedSpan {
  span: LiveSpan;
  sentence: LiveSentence;
  ordinal: number;
}

export interface DerivedEntities {
  entities: Entity[];
  findings: Finding[];
}

export function deriveEntities(
  sentences: readonly LiveSentence[],
  spans: readonly LiveSpan[],
  existing: readonly Entity[],
): DerivedEntities {
  const placed = placeSpans(sentences, spans);
  const extracted = extractEntities(placed);
  return mergeDerived(existing, extracted, placed);
}

export function entityFindings(entities: readonly Entity[]): Finding[] {
  const findings: Finding[] = [];
  const live: Entity[] = [];
  for (const entity of entities) {
    if (entity.status === 'rejected' || entity.status === 'stale') continue;
    live.push(entity);
    if (entity.status === 'candidate') {
      findings.push({
        id: `unreviewed:${entity.id}`,
        kind: 'coverage',
        code: 'unreviewed',
        severity: 'warning',
        message: `${entity.id} is an unreviewed candidate`,
        refs: [entity.id],
      });
    }
  }
  for (let left = 0; left < live.length; left += 1) {
    for (let right = left + 1; right < live.length; right += 1) {
      const a = live[left];
      const b = live[right];
      if (a === undefined || b === undefined || a.kind !== b.kind) continue;
      const aName = a.name ?? '';
      const bName = b.name ?? '';
      if (aName.length < 4 || bName.length < 4) continue;
      if (editDistance(aName, bName) !== 1) continue;
      const ids = [a.id, b.id].sort();
      findings.push({
        id: `near-duplicate:${ids[0] ?? ''}:${ids[1] ?? ''}`,
        kind: 'coverage',
        code: 'near-duplicate',
        severity: 'warning',
        message: `${a.id} and ${b.id} are near-duplicate names`,
        refs: [a.id, b.id],
      });
    }
  }
  return findings;
}

export function reconcileEntities(
  sentences: readonly LiveSentence[],
  spans: readonly LiveSpan[],
  entities: readonly Entity[],
): Entity[] {
  const current = new Set<string>();
  const bySentence = new Set<string>();
  for (const sentence of sentences) {
    bySentence.add(sentence.id);
  }
  for (const span of spans) {
    const sentenceId = sentenceIdOf(span.firstTokenId);
    if (sentenceId !== undefined && bySentence.has(sentenceId)) current.add(span.id);
  }
  const next: Entity[] = [];
  for (const entity of entities) {
    next.push(reconcileEntity(entity, current));
  }
  return next;
}

export function sameEntities(left: readonly Entity[] | undefined, right: readonly Entity[] | undefined): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.kind !== b.kind || a.name !== b.name || a.text !== b.text) return false;
    if (a.origin !== b.origin || a.status !== b.status || a.review !== b.review || a.note !== b.note) return false;
    if (!sameList(a.sources, b.sources)) return false;
  }
  return true;
}

export function copyEntity(entity: Entity): Entity {
  const copy: Entity = {
    id: entity.id,
    kind: entity.kind,
    sources: entity.sources.slice(),
    origin: entity.origin,
    status: entity.status,
  };
  if (entity.name !== undefined) copy.name = entity.name;
  if (entity.text !== undefined) copy.text = entity.text;
  if (entity.review !== undefined) copy.review = entity.review;
  if (entity.note !== undefined) copy.note = entity.note;
  return copy;
}

export function entityReview(entity: Entity): EntityReview {
  if (entity.status === 'stale') return entity.review ?? 'candidate';
  return entity.status;
}

/** Condition marker check using the span's stored clause (no indexOf re-find). */
export function isConditionMarker(
  span: LiveSpan,
  index: number,
  spans: readonly LiveSpan[],
): boolean {
  const word = span.surface.toLowerCase();
  if (word === 'if' || word === 'unless' || hasTag(span.tags, 'Condition')) return true;
  if (word !== 'when') return false;
  if (index !== 0) return true;
  return !clauseHasContentVerb(spans, span.clause);
}

function extractEntities(placed: readonly PlacedSpan[]): Entity[] {
  const buckets = new Map<string, { entity: Entity; ordinal: number }>();
  const order: string[] = [];
  for (let index = 0; index < placed.length; index += 1) {
    const item = placed[index];
    if (item === undefined) continue;
    if (item.span.insignificant === true) continue;
    if (isAdjectivalVerb(placed, index)) continue;
    const kind = spanKind(item.span);
    if (kind === undefined || kind === 'condition') continue;
    const lemma = kind === 'action' ? verbLemma(item.span) : nounLemma(item.span.surface);
    const normalized = normalizeWord(lemma);
    if (normalized.word === undefined) continue;
    const id = `${kind}:${normalized.word}`;
    let bucket = buckets.get(id);
    if (bucket === undefined) {
      const entity: Entity = {
        id,
        kind,
        name: normalized.word,
        sources: [],
        origin: 'tagger',
        status: 'candidate',
      };
      bucket = { entity, ordinal: item.ordinal };
      buckets.set(id, bucket);
      order.push(id);
    }
    bucket.entity.sources.push(item.span.id);
  }
  const entities: Entity[] = [];
  for (const id of order) {
    const bucket = buckets.get(id);
    if (bucket === undefined) continue;
    if (bucket.entity.sources.length > 1) bucket.entity.origin = 'rule';
    entities.push(bucket.entity);
  }
  const conditions = extractConditions(placed);
  for (const condition of conditions) entities.push(condition);
  return entities;
}

function extractConditions(placed: readonly PlacedSpan[]): Entity[] {
  const bySentence = new Map<string, PlacedSpan[]>();
  for (const item of placed) {
    const list = bySentence.get(item.sentence.id) ?? [];
    list.push(item);
    bySentence.set(item.sentence.id, list);
  }
  const conditions: Entity[] = [];
  let number = 1;
  for (const [sentenceId, spans] of bySentence) {
    const sentence = spans[0]?.sentence;
    if (sentence === undefined) continue;
    for (let index = 0; index < spans.length; index += 1) {
      const placedSpan = spans[index];
      if (placedSpan === undefined || !isConditionMarker(placedSpan.span, index, spans.map((item) => item.span))) continue;
      const clause = placedSpan.span.clause;
      const markerRelative = placedSpan.span.range[0] - sentence.span[0];
      const text = sentence.text
        .slice(markerRelative + placedSpan.span.surface.length, clause.end)
        .replace(/^[\s,;:]+/, '')
        .replace(/[.?!,"']+$/g, '')
        .trim();
      if (text === '') continue;
      const sources: string[] = [];
      const absStart = placedSpan.span.range[0];
      const absEnd = sentence.span[0] + clause.end;
      for (const candidate of spans) {
        if (candidate.span.range[0] >= absStart && candidate.span.range[0] < absEnd) {
          sources.push(candidate.span.id);
        }
      }
      conditions.push({
        id: `condition:c${number}`,
        kind: 'condition',
        text,
        sources,
        origin: 'rule',
        status: 'candidate',
      });
      number += 1;
      void sentenceId;
    }
  }
  return conditions;
}

function clauseHasContentVerb(spans: readonly LiveSpan[], clause: ClauseBound): boolean {
  for (const span of spans) {
    if (!sameClauseKey(span.clause, clause)) continue;
    if (!hasTag(span.tags, 'Verb')) continue;
    if (isAuxiliary(span.tags)) continue;
    return true;
  }
  return false;
}

function isAdjectivalVerb(spans: readonly PlacedSpan[], index: number): boolean {
  const item = spans[index];
  if (item === undefined || !hasTag(item.span.tags, 'Verb') || isAuxiliary(item.span.tags)) return false;
  const previous = spans[index - 1];
  const next = spans[index + 1];
  if (previous === undefined || next === undefined) return false;
  if (previous.sentence.id !== item.sentence.id || next.sentence.id !== item.sentence.id) return false;
  return hasTag(previous.span.tags, 'Determiner') && hasTag(next.span.tags, 'Noun');
}

function spanKind(span: LiveSpan): EntityKind | undefined {
  if (span.surface === '') return undefined;
  if (span.insignificant === true) return undefined;
  if (hasTag(span.tags, 'Actor')) return 'actor';
  if (hasTag(span.tags, 'Verb')) {
    if (isAuxiliary(span.tags)) return undefined;
    return 'action';
  }
  if (!hasTag(span.tags, 'Noun')) return undefined;
  for (const tag of span.tags) {
    if (SKIP_OBJECT.has(tag)) return undefined;
  }
  return 'object';
}

function mergeDerived(existing: readonly Entity[], derived: readonly Entity[], placed: readonly PlacedSpan[]): DerivedEntities {
  const findings: Finding[] = [];
  const derivedById = new Map<string, Entity>();
  for (const entity of derived) {
    if (entity.kind !== 'condition') derivedById.set(entity.id, entity);
  }
  const claimed = new Set<string>();
  const kept: Entity[] = [];
  const seen = new Set<string>();

  for (const entity of existing) {
    if (entity.origin !== 'agent') continue;
    const match = matchDerived(entity, derived, claimed);
    if (match !== undefined) {
      claimed.add(match.id);
      if (match.kind !== entity.kind || (match.name !== undefined && match.name !== entity.name) || (match.text !== undefined && entity.text !== undefined && match.text !== entity.text)) {
        findings.push(agentConflict(entity.id));
      }
    } else if (entity.kind !== 'condition') {
      const sameId = derivedById.get(entity.id);
      if (sameId !== undefined) {
        claimed.add(sameId.id);
        findings.push(agentConflict(entity.id));
      }
    }
    kept.push(settle(entity, placed));
    seen.add(entity.id);
  }

  const conditionPool = existing.filter((entity) => entity.kind === 'condition' && entity.origin !== 'agent');
  const usedConditions = new Set<string>();
  for (const entity of derived) {
    if (entity.kind !== 'condition') continue;
    const previous = takeCondition(conditionPool, usedConditions, entity.sources);
    if (previous === undefined) continue;
    claimed.add(entity.id);
    const keptEntity = copyEntity(previous);
    keptEntity.sources = entity.sources.slice();
    keptEntity.text = entity.text;
    if (previous.status === 'stale') {
      keptEntity.status = entityReview(previous);
      delete keptEntity.review;
    }
    kept.push(settle(keptEntity, placed));
    seen.add(keptEntity.id);
  }

  for (const entity of derived) {
    if (claimed.has(entity.id)) continue;
    if (entity.kind === 'condition') {
      const id = freshConditionId(seen);
      const created = copyEntity(entity);
      created.id = id;
      kept.push(created);
      seen.add(id);
      continue;
    }
    const previous = findEntity(existing, entity.id);
    if (previous !== undefined && previous.origin === 'agent') continue;
    if (previous === undefined) {
      kept.push(copyEntity(entity));
      seen.add(entity.id);
      continue;
    }
    const next = copyEntity(entity);
    if (previous.status === 'confirmed' || previous.status === 'rejected') {
      next.status = previous.status;
      next.origin = previous.origin;
      if (previous.note !== undefined) next.note = previous.note;
    } else if (previous.status === 'stale') {
      next.status = entityReview(previous);
      if (previous.note !== undefined) next.note = previous.note;
    } else if (previous.note !== undefined) {
      next.note = previous.note;
    }
    kept.push(next);
    seen.add(next.id);
  }

  for (const entity of existing) {
    if (seen.has(entity.id) || entity.origin === 'agent') continue;
    const copy = settle(entity, placed);
    if (copy.status !== 'stale' && copy.status !== 'confirmed' && copy.status !== 'rejected') {
      copy.review = entityReview(entity);
      copy.status = 'stale';
      delete copy.note;
      if (entity.note !== undefined) copy.note = entity.note;
    }
    kept.push(copy);
    seen.add(copy.id);
  }

  const kindOrder: Record<Entity['kind'], number> = { actor: 0, object: 1, action: 2, condition: 3 };
  kept.sort((left, right) => {
    const kind = kindOrder[left.kind] - kindOrder[right.kind];
    if (kind !== 0) return kind;
    const ordinal = entityOrdinal(left, placed) - entityOrdinal(right, placed);
    if (ordinal !== 0) return ordinal;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return { entities: kept, findings };
}

function matchDerived(entity: Entity, derived: readonly Entity[], claimed: ReadonlySet<string>): Entity | undefined {
  for (const candidate of derived) {
    if (claimed.has(candidate.id) || candidate.kind !== entity.kind) continue;
    if (sameList(sorted(candidate.sources), sorted(entity.sources))) return candidate;
  }
  return undefined;
}

function takeCondition(pool: readonly Entity[], used: Set<string>, sources: readonly string[]): Entity | undefined {
  const key = sorted(sources).join(',');
  for (const entity of pool) {
    if (used.has(entity.id)) continue;
    if (sorted(entity.sources).join(',') === key) {
      used.add(entity.id);
      return entity;
    }
  }
  return undefined;
}

function freshConditionId(used: ReadonlySet<string>): string {
  let number = 1;
  while (used.has(`condition:c${number}`)) number += 1;
  return `condition:c${number}`;
}

function settle(entity: Entity, placed: readonly PlacedSpan[]): Entity {
  const copy = copyEntity(entity);
  if (copy.sources.length === 0) return copy;
  let live = false;
  const known = new Set<string>();
  for (const item of placed) known.add(item.span.id);
  for (const source of copy.sources) {
    if (known.has(source)) live = true;
  }
  if (!live) {
    copy.review = entityReview(entity);
    copy.status = 'stale';
  }
  return copy;
}

function reconcileEntity(entity: Entity, current: ReadonlySet<string>): Entity {
  const copy = copyEntity(entity);
  if (copy.sources.length === 0) return copy;
  let live = false;
  for (const source of copy.sources) {
    if (current.has(source)) live = true;
  }
  const review = entityReview(entity);
  if (!live) {
    copy.status = 'stale';
    copy.review = review;
    return copy;
  }
  copy.status = review;
  delete copy.review;
  return copy;
}

function agentConflict(id: string): Finding {
  return {
    id: `conflict:${id}`,
    kind: 'conflict',
    code: 'agent-entity',
    severity: 'warning',
    message: `${id} is agent-owned; extraction did not overwrite it`,
    refs: [id],
  };
}

function placeSpans(sentences: readonly LiveSentence[], spans: readonly LiveSpan[]): PlacedSpan[] {
  const byId = new Map<string, LiveSentence>();
  for (const sentence of sentences) byId.set(sentence.id, sentence);
  const placed: PlacedSpan[] = [];
  let ordinal = 0;
  for (const span of spans) {
    const sentenceId = sentenceIdOf(span.firstTokenId);
    if (sentenceId === undefined) continue;
    const sentence = byId.get(sentenceId);
    if (sentence === undefined) continue;
    ordinal += 1;
    placed.push({ span, sentence, ordinal });
  }
  return placed;
}

function entityOrdinal(entity: Entity, placed: readonly PlacedSpan[]): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const source of entity.sources) {
    for (const item of placed) {
      if (item.span.id === source && item.ordinal < best) best = item.ordinal;
    }
  }
  return best;
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function sameClauseKey(left: ClauseBound, right: ClauseBound): boolean {
  return left.start === right.start && left.end === right.end;
}

function sentenceIdOf(tokenId: string): string | undefined {
  const dot = tokenId.indexOf('.');
  if (dot <= 0) return undefined;
  return tokenId.slice(0, dot);
}

function isSingleSyllableCvc(lemma: string): boolean {
  // A leading consonant cluster still doubles: ship -> shipped, not shiped.
  return /^[^aeiou]+[aeiou][^aeiouwxy]$/.test(lemma);
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 1) return 2;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let col = 0; col < cols; col += 1) line.push(0);
    grid.push(line);
  }
  for (let row = 0; row < rows; row += 1) {
    const line = grid[row];
    if (line !== undefined) line[0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    const line = grid[0];
    if (line !== undefined) line[col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      const current = grid[row];
      const up = grid[row - 1];
      if (current === undefined || up === undefined) continue;
      const del = (up[col] ?? 0) + 1;
      const ins = (current[col - 1] ?? 0) + 1;
      const sub = (up[col - 1] ?? 0) + cost;
      current[col] = Math.min(del, ins, sub);
    }
  }
  return grid[left.length]?.[right.length] ?? 2;
}

function sorted(values: readonly string[]): string[] {
  return values.slice().sort();
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
