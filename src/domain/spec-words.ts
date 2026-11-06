// Word-level helpers shared by concepts and frames: tag checks and canonical word forms.
import type { LiveSpan } from './spec.js';
import { WORKFLOW_WORD_PATTERN } from './workflow.js';

const AUXILIARY = new Set(['Copula', 'Auxiliary', 'Modal']);

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

export function isContentVerb(span: Pick<LiveSpan, 'tags'>): boolean {
  return hasTag(span.tags, 'Verb') && !isAuxiliary(span.tags);
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
