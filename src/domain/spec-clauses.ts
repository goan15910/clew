// Clause segmentation over one sentence's live spans. Compromise clauses are too coarse
// ("and then" and a leading "when" clause stay joined), so frames cut their own.
import type { ClauseBound, LiveSentence, LiveSpan } from './spec.js';
import { isContentVerb } from './spec-words.js';

export const CONDITION_MARKERS: ReadonlySet<string> = new Set(['when', 'if', 'unless', 'after', 'before', 'once']);
const MARKERS: ReadonlySet<string> = new Set([...CONDITION_MARKERS, 'then']);
const CONJUNCTIONS: ReadonlySet<string> = new Set(['and', 'or']);

export interface ClauseSegment {
  marker?: string;
  markerSpan?: LiveSpan;
  /** Live spans of the segment in text order. The marker is first, or second after `and`/`or`. */
  spans: LiveSpan[];
  clause: ClauseBound;
}

export function segmentClauses(sentence: LiveSentence, spans: readonly LiveSpan[]): ClauseSegment[] {
  const groups: LiveSpan[][] = [];
  let current: LiveSpan[] = [];
  const flush = (): void => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span === undefined) continue;
    const word = wordOf(span);
    const joined = CONJUNCTIONS.has(previousWord(current)) && MARKERS.has(word);
    if (CONJUNCTIONS.has(word) && opensClause(spans, index)) flush();
    else if (MARKERS.has(word) && !joined) flush();
    current.push(span);
    if (endsClause(sentence, span, spans[index + 1])) flush();
  }
  flush();
  const segments: ClauseSegment[] = [];
  for (const group of groups) {
    if (!group.some((span) => span.insignificant !== true)) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) continue;
    const start = first.range[0] - sentence.span[0];
    const end = last.range[1] - sentence.span[0];
    const segment: ClauseSegment = { spans: group, clause: { text: sentence.text.slice(start, end), start, end } };
    const lead = CONJUNCTIONS.has(wordOf(first)) ? group[1] : first;
    const marker = lead === undefined ? '' : wordOf(lead);
    if (lead !== undefined && MARKERS.has(marker)) {
      segment.marker = marker;
      segment.markerSpan = lead;
    }
    segments.push(segment);
  }
  return segments;
}

export function startsWithConjunction(segment: ClauseSegment): boolean {
  const first = segment.spans[0];
  return first !== undefined && CONJUNCTIONS.has(wordOf(first));
}

export function wordOf(span: LiveSpan): string {
  return span.surface.trim().toLowerCase().replace(/[,;.?!]+$/, '');
}

/** `and`/`or` opens a clause before a verb ("and ships it") or a marker ("and then archives"). */
function opensClause(spans: readonly LiveSpan[], index: number): boolean {
  const next = spans[index + 1];
  if (next !== undefined && MARKERS.has(wordOf(next))) return true;
  for (let after = index + 1; after < spans.length; after += 1) {
    const span = spans[after];
    if (span === undefined || span.insignificant === true) continue;
    return isContentVerb(span);
  }
  return false;
}

function previousWord(current: readonly LiveSpan[]): string {
  const last = current[current.length - 1];
  return last === undefined ? '' : wordOf(last);
}

/** Compromise keeps punctuation out of token text, so a break can sit between spans or end a surface. */
function endsClause(sentence: LiveSentence, span: LiveSpan, next: LiveSpan | undefined): boolean {
  if (/[,;.?!]$/.test(span.surface.trim())) return true;
  const from = span.range[1] - sentence.span[0];
  const to = next === undefined ? sentence.text.length : next.range[0] - sentence.span[0];
  return /[,;.?!]/.test(sentence.text.slice(from, to));
}
