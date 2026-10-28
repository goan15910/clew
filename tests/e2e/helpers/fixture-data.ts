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
}

interface Token {
  id: string;
  text: string;
  tags?: string[];
}

interface TaggedSentence {
  id: string;
  tokens?: Token[];
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
const entitiesFile = loadJson<{ entities: Entity[] }>('entities.json');
const factsFile = loadJson<{ facts: Fact[] }>('facts.json');
const graph = loadJson<Graph>('graph.json');

export const fixture = {
  session,
  sentences: sentencesFile.sentences,
  tagged: tokensFile.sentences,
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

function taggedMap(): Map<string, TaggedSentence> {
  return new Map(fixture.tagged.map((row) => [row.id, row]));
}

function tokenMap(): Map<string, { token: Token; sentenceId: string }> {
  const map = new Map<string, { token: Token; sentenceId: string }>();
  for (const row of fixture.tagged) {
    for (const token of row.tokens ?? []) map.set(token.id, { token, sentenceId: row.id });
  }
  return map;
}

function sentenceById(id: string): Sentence | undefined {
  return fixture.sentences.find((sentence) => sentence.id === id);
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
  const tagged = taggedMap();
  return fixture.sentences
    .filter((sentence) => {
      const row = tagged.get(sentence.id);
      const tokenText = (row?.tokens ?? []).map((token) => token.text);
      const tokenIds = (row?.tokens ?? []).map((token) => token.id);
      return matchesText(
        [sentence.id, sentence.text, sentence.section, sentence.status, ...tokenText, ...tokenIds],
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
  const tokens = tokenMap();
  const rows: Array<{ layer: string; text: string }> = [];
  for (const field of ['actor', 'action', 'object', 'condition'] as const) {
    const id = fact[field];
    if (!id) continue;
    const entity = entities.get(id);
    const label = entity ? (entity.name || entity.text || id) : id;
    rows.push({ layer: 'entity', text: `${field} → ${id} (${label})` });
    if (entity) {
      for (const source of entity.sources ?? []) {
        const hit = tokens.get(source);
        if (hit) {
          rows.push({
            layer: 'token',
            text: `${source} “${hit.token.text}” [${(hit.token.tags ?? []).join('|')}]`,
          });
          const sentence = sentenceById(hit.sentenceId);
          if (sentence) rows.push({ layer: 'sentence', text: `${sentence.id} “${sentence.text}”` });
        } else {
          rows.push({ layer: 'source', text: source });
        }
      }
    }
  }
  for (const source of fact.sources ?? []) {
    if (/^s[1-9][0-9]*$/.test(source)) {
      const sentence = sentenceById(source);
      rows.push({ layer: 'sentence', text: source + (sentence ? ` “${sentence.text}”` : '') });
    } else if (/^s[1-9][0-9]*\.t[1-9][0-9]*$/.test(source)) {
      const hit = tokens.get(source);
      rows.push({ layer: 'token', text: source + (hit ? ` “${hit.token.text}”` : '') });
      if (hit) {
        const sentence = sentenceById(hit.sentenceId);
        if (sentence) rows.push({ layer: 'sentence', text: `${sentence.id} “${sentence.text}”` });
      }
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
  const tokens = tokenMap();
  const rows: Array<{ layer: string; text: string }> = [];
  for (const source of entity.sources ?? []) {
    const hit = tokens.get(source);
    if (hit) {
      rows.push({
        layer: 'token',
        text: `${source} “${hit.token.text}” [${(hit.token.tags ?? []).join('|')}]`,
      });
      const sentence = sentenceById(hit.sentenceId);
      if (sentence) {
        rows.push({
          layer: 'sentence',
          text: `${sentence.id} [${sentence.section}] “${sentence.text}”`,
        });
      }
    } else {
      rows.push({ layer: 'source', text: source });
    }
  }
  for (const fact of fixture.facts) {
    const refs = [fact.actor, fact.action, fact.object, fact.condition];
    if (refs.includes(entity.id)) rows.push({ layer: 'fact', text: `${fact.id} ${fact.type}` });
  }
  return rows;
}

export function expectedSentenceLineage(sentenceId: string): Array<{ layer: string; text: string }> {
  const sentence = sentenceById(sentenceId);
  if (!sentence) return [];
  const tagged = taggedMap().get(sentenceId);
  const rows: Array<{ layer: string; text: string }> = [];
  for (const token of tagged?.tokens ?? []) {
    rows.push({ layer: 'token', text: `${token.id} “${token.text}” [${(token.tags ?? []).join('|')}]` });
  }
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

export function expectedLineage(view: View, id: string): Array<{ layer: string; text: string }> {
  if (view === 'facts') return expectedFactLineage(id);
  if (view === 'entities') return expectedEntityLineage(id);
  return expectedSentenceLineage(id);
}

export function expectedMeta(): { id: string; sentences: number; entities: number; facts: number } {
  return {
    id: fixture.session.id,
    sentences: fixture.sentences.length,
    entities: fixture.entities.length,
    facts: fixture.facts.filter((fact) => fact.removed !== true).length,
  };
}
