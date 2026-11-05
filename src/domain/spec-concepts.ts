// Spans → concepts. A concept is a canonical word and the spans linked to it; it has no kind.
// The same word maps to the same concept unless an agent or human set the span's link.
import type { Concept, LiveSpan } from './spec.js';
import { cloneSpan } from './spec-spans.js';
import { hasTag, isContentVerb, normalizeWord, nounLemma, verbLemma } from './spec-words.js';

const NO_CONCEPT_TAGS = ['Value', 'Unit', 'Currency', 'Determiner', 'Preposition', 'Pronoun'] as const;
const CONCEPT_PREFIX = 'concept:';

export interface DerivedConcepts {
  concepts: Concept[];
  spans: LiveSpan[];
}

export function conceptId(canonical: string): string {
  return `${CONCEPT_PREFIX}${canonical}`;
}

export function deriveConcepts(spans: readonly LiveSpan[]): DerivedConcepts {
  const next: LiveSpan[] = [];
  const members = new Map<string, string[]>();
  for (const span of spans) {
    const copy = cloneSpan(span);
    if (!copy.entityLinkExplicitlySet) {
      const canonical = conceptCanonical(copy);
      if (canonical === undefined) delete copy.entityId;
      else copy.entityId = conceptId(canonical);
    }
    if (copy.entityId !== undefined) {
      const list = members.get(copy.entityId) ?? [];
      list.push(copy.id);
      members.set(copy.entityId, list);
    }
    next.push(copy);
  }
  const concepts: Concept[] = [];
  for (const [id, list] of members) concepts.push({ id, canonical: canonicalOf(id), members: list });
  concepts.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { concepts, spans: next };
}

/** The canonical word a span would get, or undefined when the span names no concept. */
export function conceptCanonical(span: LiveSpan): string | undefined {
  if (span.insignificant === true || span.surface.trim() === '') return undefined;
  for (const tag of NO_CONCEPT_TAGS) {
    if (hasTag(span.tags, tag)) return undefined;
  }
  let word: string | undefined;
  if (isContentVerb(span)) word = verbLemma(span);
  else if (hasTag(span.tags, 'Verb')) return undefined;
  else if (hasTag(span.tags, 'Noun')) word = nounPhraseLemma(span.surface);
  else if (hasTag(span.tags, 'Adjective')) word = span.surface.toLowerCase();
  if (word === undefined) return undefined;
  return normalizeWord(word).word;
}

export function findConcept(concepts: readonly Concept[], id: string): Concept | undefined {
  for (const concept of concepts) {
    if (concept.id === id) return concept;
  }
  return undefined;
}

export function sameConcepts(left: readonly Concept[] | undefined, right: readonly Concept[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.canonical !== b.canonical || a.members.length !== b.members.length) return false;
    for (let member = 0; member < a.members.length; member += 1) {
      if (a.members[member] !== b.members[member]) return false;
    }
  }
  return true;
}

export function copyConcept(concept: Concept): Concept {
  return { id: concept.id, canonical: concept.canonical, members: concept.members.slice() };
}

function nounPhraseLemma(surface: string): string {
  const words = surface.trim().split(/[\s-]+/);
  const last = words.pop() ?? '';
  words.push(nounLemma(last));
  return words.join(' ');
}

function canonicalOf(id: string): string {
  return id.startsWith(CONCEPT_PREFIX) ? id.slice(CONCEPT_PREFIX.length) : id;
}
