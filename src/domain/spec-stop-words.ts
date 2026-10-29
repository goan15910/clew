// Stop-word / insignificant-token policy for the span pipeline.
// Mark at the token stage (before 1:1 promote). Skipped tokens stay in
// tokens.json with positions, promote to insignificant live spans (merge glue),
// and are muted in the viewer — not deleted from the partition.
//
// Two classifiers mark skipped the same way:
//   1. Fixed lowercase stop-word list (membership fold is list-only; not lexicon case).
//   2. Compromise function POS tags.
// Keep-list / keep-tags win over both (negation, modals, condition/sequencing).

import type { Token } from './spec.js';

/** Function POS tags that mark a token skipped unless a keep rule applies. */
export const STOP_WORD_POS_TAGS: ReadonlySet<string> = new Set([
  'Determiner',
  'Preposition',
  'Conjunction',
  'Pronoun',
  'Copula',
  'Auxiliary',
]);

/**
 * Tags that always keep a token significant (never skipped).
 * Modal is intentionally not in STOP_WORD_POS_TAGS; listed here as defense in depth.
 */
export const STOP_WORD_KEEP_TAGS: ReadonlySet<string> = new Set([
  'Negative',
  'Modal',
  'Condition',
]);

/**
 * Surface forms that stay significant even when POS/list would skip.
 * Covers negation, modals, and condition/sequencing connectors used by facts.
 */
export const STOP_WORD_KEEP_WORDS: ReadonlySet<string> = new Set([
  // Negation
  'not', 'never', 'neither', 'nor', 'no', 'cannot', "can't", "won't", 'wont', "don't", 'dont',
  "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "aren't", 'arent', "wasn't", 'wasnt',
  "weren't", 'werent', "haven't", 'havent', "hasn't", 'hasnt', "hadn't", 'hadnt',
  // Modals
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
  // Condition / sequencing (fact framing)
  'if', 'unless', 'when', 'whenever', 'while', 'after', 'before', 'once', 'until',
  'whereas', 'although', 'though', 'because', 'then',
]);

/**
 * Curated function-word core (~60). Lowercase membership only.
 * Keep-words are omitted from this set so list and keep never fight.
 */
export const STOP_WORD_LIST: ReadonlySet<string> = new Set([
  // Determiners / articles
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'each', 'every', 'both', 'all', 'such',
  // Prepositions
  'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'upon', 'as', 'about', 'over',
  'under', 'through', 'between', 'among', 'against', 'without', 'within', 'during', 'via', 'per',
  // Pronouns
  'it', 'its', 'they', 'them', 'their', 'theirs', 'he', 'him', 'his', 'she', 'her', 'hers',
  'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'i', 'me', 'my', 'mine',
  // Be / do / have (tense support; content verbs stay)
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having',
  // Conjunctions / light glue (keep-list owns if/when/…)
  'and', 'or', 'but', 'so', 'than', 'also', 'just', 'only', 'very', 'too', 'here', 'there',
]);

export function foldStopWordSurface(text: string): string {
  return text.trim().toLowerCase().replace(/['’]/g, "'");
}

export function isKeptStopWordSurface(text: string): boolean {
  return STOP_WORD_KEEP_WORDS.has(foldStopWordSurface(text));
}

export function isKeptStopWordTags(tags: readonly string[]): boolean {
  for (const tag of tags) {
    if (STOP_WORD_KEEP_TAGS.has(tag)) return true;
  }
  return false;
}

export function matchesStopWordList(text: string): boolean {
  const folded = foldStopWordSurface(text);
  if (folded === '') return true;
  return STOP_WORD_LIST.has(folded);
}

export function matchesStopWordPos(tags: readonly string[]): boolean {
  for (const tag of tags) {
    if (STOP_WORD_POS_TAGS.has(tag)) return true;
  }
  return false;
}

/**
 * True when the token should be marked skipped before span promotion.
 * Keep rules win; then either the fixed list or function POS is enough.
 */
export function shouldSkipToken(text: string, tags: readonly string[]): boolean {
  if (foldStopWordSurface(text) === '') return true;
  if (isKeptStopWordSurface(text) || isKeptStopWordTags(tags)) return false;
  if (matchesStopWordList(text)) return true;
  if (matchesStopWordPos(tags)) return true;
  return false;
}

/** Mark stop-word tokens with `skipped: true` (positions and tags unchanged). */
export function markSkippedTokens(tokens: readonly Token[]): Token[] {
  const next: Token[] = [];
  for (const token of tokens) {
    const skipped = shouldSkipToken(token.text, token.tags);
    if (skipped) {
      next.push({ ...token, tags: token.tags.slice(), sources: token.sources.slice(), skipped: true });
    } else if (token.skipped === true) {
      const copy: Token = { ...token, tags: token.tags.slice(), sources: token.sources.slice() };
      delete copy.skipped;
      next.push(copy);
    } else {
      next.push({ ...token, tags: token.tags.slice(), sources: token.sources.slice() });
    }
  }
  return next;
}

export function tokenIsSkipped(token: Token): boolean {
  return token.skipped === true;
}
