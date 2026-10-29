// Live span partition: promote, lexicon merge, interactive merge, and read-only check.
// Pure data and rules. No files, no Zod, no CLI.

import type { LiveSpan, SpanOrigin, TaggedSentence, Token } from './spec.js';

/** Tags that select the case-sensitive lexicon path. ProperNoun alone does not. */
export const SPECIAL_CASE_TAGS = ['Person', 'Place', 'Organization', 'Acronym'] as const;

export interface LexiconEntry {
  id: string;
  /** Lexicon key as spelled (defines joiner and match spelling). */
  key: string;
  tags: string[];
}

export interface AutoPassOptions {
  forceAuto?: boolean;
}

export type SpanConflictKind = 'tag-conflict' | 'multi-entity';

export interface SpanConflictWindow {
  kind: SpanConflictKind;
  spanIds: string[];
  surfaces: string[];
  childTags: string[][];
  entityIds: (string | undefined)[];
  lexiconEntryId?: string;
  lexiconKey?: string;
}

export interface LexiconMergeResult {
  spans: LiveSpan[];
  merged: string[];
  skipped: SpanConflictWindow[];
  unchanged: boolean;
}

export interface InteractiveMergeCommand {
  spanIds: string[];
  /** Required when child tags are a non-trivial conflict. */
  tags?: string[];
  /** Explicit entity link. Use null for an explicit "none". */
  entityId?: string | null;
}

export type InteractiveMergeResult =
  | { ok: true; spans: LiveSpan[]; mergedId: string }
  | { ok: false; message: string };

const PUNCT_OR_SPACE = /[\s\p{P}]+/gu;

export function spanIdFor(firstTokenId: string, lastTokenId: string): string {
  return `sp:${firstTokenId}..${lastTokenId}`;
}

/** Strip whitespace and punctuation from one raw token surface before join/compare. */
export function normalizeTokenSurface(text: string): string {
  return text.replace(PUNCT_OR_SPACE, '');
}

export function lexiconJoiner(key: string): ' ' | '-' {
  if (key.includes('-') && !key.includes(' ')) return '-';
  return ' ';
}

export function hasSpecialCaseTag(tags: readonly string[]): boolean {
  for (const tag of tags) {
    for (const special of SPECIAL_CASE_TAGS) {
      if (tag === special) return true;
    }
  }
  return false;
}

/**
 * Build the match key for a run of raw token surfaces against one lexicon entry.
 * Joiner comes from the entry key. Case folding follows the entry's tags.
 */
export function matchKeyForTokens(tokenTexts: readonly string[], entry: LexiconEntry): string {
  const joiner = lexiconJoiner(entry.key);
  const parts: string[] = [];
  for (const text of tokenTexts) {
    const part = normalizeTokenSurface(text);
    if (part === '') continue;
    parts.push(part);
  }
  const joined = parts.join(joiner);
  return hasSpecialCaseTag(entry.tags) ? joined : joined.toLowerCase();
}

export function lexiconMatchKey(entry: LexiconEntry): string {
  return hasSpecialCaseTag(entry.tags) ? entry.key : entry.key.toLowerCase();
}

/** Display surface for a cover: original token texts joined with the lexicon joiner. */
export function displaySurfaceForTokens(tokens: readonly Token[], joiner: ' ' | '-'): string {
  const parts: string[] = [];
  for (const token of tokens) parts.push(token.text);
  return parts.join(joiner);
}

export function promoteTokensToSpans(tokens: readonly Token[]): LiveSpan[] {
  const spans: LiveSpan[] = [];
  for (const token of tokens) {
    if (token.status !== 'current') continue;
    const span: LiveSpan = {
      id: spanIdFor(token.id, token.id),
      firstTokenId: token.id,
      lastTokenId: token.id,
      surface: token.text,
      tags: token.tags.slice(),
      origin: 'promote',
      explicitlySet: false,
      entityLinkExplicitlySet: false,
    };
    // Skipped stop-word tokens promote to insignificant spans (still cover the token for merge glue).
    if (token.skipped === true) span.insignificant = true;
    spans.push(span);
  }
  return spans;
}

/** Dual-emit helper: 1:1 promote every current token across tagged sentences. */
export function promoteTaggedToSpans(tagged: readonly TaggedSentence[]): LiveSpan[] {
  const spans: LiveSpan[] = [];
  for (const item of tagged) {
    if (item.status !== 'current') continue;
    for (const span of promoteTokensToSpans(item.tokens)) spans.push(span);
  }
  return spans;
}

/**
 * Replace spans whose tokens belong to `sentenceIds` with a fresh 1:1 promote
 * of those sentences' current tokens. Other sentences' spans are kept.
 */
export function replaceSentenceSpans(
  existing: readonly LiveSpan[] | undefined,
  tagged: readonly TaggedSentence[],
  sentenceIds: ReadonlySet<string>,
): LiveSpan[] {
  const kept: LiveSpan[] = [];
  for (const span of existing ?? []) {
    const sentenceId = sentenceIdOfToken(span.firstTokenId);
    if (sentenceId !== undefined && sentenceIds.has(sentenceId)) continue;
    kept.push(span);
  }
  const promoted: LiveSpan[] = [];
  for (const item of tagged) {
    if (!sentenceIds.has(item.id) || item.status !== 'current') continue;
    for (const span of promoteTokensToSpans(item.tokens)) promoted.push(span);
  }
  return orderSpans([...kept, ...promoted], tagged);
}

export function sameSpans(left: readonly LiveSpan[] | undefined, right: readonly LiveSpan[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const leftSpan = a[index];
    const rightSpan = b[index];
    if (leftSpan === undefined || rightSpan === undefined) return false;
    if (!sameSpan(leftSpan, rightSpan)) return false;
  }
  return true;
}

export function sameSpan(left: LiveSpan, right: LiveSpan): boolean {
  if (left.id !== right.id) return false;
  if (left.firstTokenId !== right.firstTokenId || left.lastTokenId !== right.lastTokenId) return false;
  if (left.surface !== right.surface || left.origin !== right.origin) return false;
  if (left.explicitlySet !== right.explicitlySet || left.entityLinkExplicitlySet !== right.entityLinkExplicitlySet) return false;
  if (left.lexiconEntryId !== right.lexiconEntryId) return false;
  if (left.entityId !== right.entityId) return false;
  if (left.insignificant !== right.insignificant) return false;
  if (left.tags.length !== right.tags.length) return false;
  for (let index = 0; index < left.tags.length; index += 1) {
    if (left.tags[index] !== right.tags[index]) return false;
  }
  return true;
}

/**
 * Drop spans whose token cover is no longer present. Used when init retargets
 * sentences without a full re-tag.
 */
export function retainValidSpans(spans: readonly LiveSpan[] | undefined, tagged: readonly TaggedSentence[]): LiveSpan[] | undefined {
  if (spans === undefined) return undefined;
  const tokens = tokenIndex(tagged);
  const kept: LiveSpan[] = [];
  for (const span of spans) {
    if (!tokens.has(span.firstTokenId) || !tokens.has(span.lastTokenId)) continue;
    if (!coverIsContiguous(span.firstTokenId, span.lastTokenId, tokens, tagged)) continue;
    kept.push(cloneSpan(span));
  }
  return orderSpans(kept, tagged);
}

export function mergeLexicon(
  spans: readonly LiveSpan[],
  tagged: readonly TaggedSentence[],
  lexicon: readonly LexiconEntry[],
  options: AutoPassOptions = {},
): LexiconMergeResult {
  const forceAuto = options.forceAuto === true;
  const tokens = tokenIndex(tagged);
  let current = orderSpans(spans.map(cloneSpan), tagged);
  const merged: string[] = [];
  const skipped: SpanConflictWindow[] = [];
  const entries = [...lexicon].sort((left, right) => tokenCountInKey(right.key) - tokenCountInKey(left.key));

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const entry of entries) {
      const windows = findLexiconWindows(current, tagged, tokens, entry, forceAuto);
      for (const window of windows) {
        const children = window.spans;
        if (children.length < 1) continue;
        const first = children[0];
        const last = children[children.length - 1];
        if (first === undefined || last === undefined) continue;
        // Skip stale windows after an earlier merge in this pass.
        if (!children.every((child) => current.some((span) => span.id === child.id))) continue;
        const coverId = spanIdFor(first.firstTokenId, last.lastTokenId);
        if (children.length === 1 && first.lexiconEntryId === entry.id && first.id === coverId) continue;

        const tagDecision = mergeTags(children, entry.tags);
        if (tagDecision.kind === 'conflict') {
          skipped.push(conflictWindow('tag-conflict', children, entry));
          continue;
        }
        const entityDecision = mergeEntityLinks(children);
        if (entityDecision.kind === 'conflict') {
          skipped.push(conflictWindow('multi-entity', children, entry));
          continue;
        }

        const coverTokens = tokensInCover(first.firstTokenId, last.lastTokenId, tagged, tokens);
        const joiner = lexiconJoiner(entry.key);
        const nextSpan: LiveSpan = {
          id: coverId,
          firstTokenId: first.firstTokenId,
          lastTokenId: last.lastTokenId,
          surface: displaySurfaceForTokens(coverTokens, joiner),
          tags: tagDecision.tags,
          origin: 'lexicon',
          lexiconEntryId: entry.id,
          explicitlySet: false,
          entityLinkExplicitlySet: entityDecision.entityLinkExplicitlySet,
        };
        if (entityDecision.entityId !== undefined) nextSpan.entityId = entityDecision.entityId;

        const childIds = new Set<string>();
        for (const child of children) childIds.add(child.id);
        const replaced: LiveSpan[] = [];
        let inserted = false;
        for (const span of current) {
          if (childIds.has(span.id)) {
            if (!inserted) {
              replaced.push(nextSpan);
              inserted = true;
            }
            continue;
          }
          replaced.push(span);
        }
        current = orderSpans(replaced, tagged);
        merged.push(nextSpan.id);
        progressed = true;
        break;
      }
      if (progressed) break;
    }
  }

  return {
    spans: current,
    merged,
    skipped: uniqueConflicts(skipped),
    unchanged: merged.length === 0,
  };
}

export function checkSpanConflicts(
  spans: readonly LiveSpan[],
  tagged: readonly TaggedSentence[],
  lexicon: readonly LexiconEntry[],
): SpanConflictWindow[] {
  const forceAuto = true;
  const tokens = tokenIndex(tagged);
  const current = orderSpans(spans.map(cloneSpan), tagged);
  const skipped: SpanConflictWindow[] = [];
  const entries = [...lexicon].sort((left, right) => tokenCountInKey(right.key) - tokenCountInKey(left.key));
  for (const entry of entries) {
    const windows = findLexiconWindows(current, tagged, tokens, entry, forceAuto);
    for (const window of windows) {
      const children = window.spans;
      if (children.length < 2) continue;
      const tagDecision = mergeTags(children, entry.tags);
      const entityDecision = mergeEntityLinks(children);
      if (tagDecision.kind === 'conflict') skipped.push(conflictWindow('tag-conflict', children, entry));
      if (entityDecision.kind === 'conflict') skipped.push(conflictWindow('multi-entity', children, entry));
    }
  }
  return uniqueConflicts(skipped);
}

export function interactiveMerge(
  spans: readonly LiveSpan[],
  tagged: readonly TaggedSentence[],
  command: InteractiveMergeCommand,
): InteractiveMergeResult {
  if (command.spanIds.length < 2) return { ok: false, message: 'interactive merge needs at least two span ids' };
  const byId = new Map<string, LiveSpan>();
  for (const span of spans) byId.set(span.id, span);
  const children: LiveSpan[] = [];
  for (const id of command.spanIds) {
    const span = byId.get(id);
    if (span === undefined) return { ok: false, message: `unknown span "${id}"` };
    children.push(span);
  }
  const ordered = orderSpans(children, tagged);
  if (ordered.length !== children.length) return { ok: false, message: 'merge spans must be contiguous live spans' };
  if (!areConsecutive(ordered, spans, tagged)) {
    return { ok: false, message: 'merge spans must be consecutive in the live partition' };
  }

  const tagDecision = mergeTags(ordered, command.tags);
  if (tagDecision.kind === 'conflict') {
    if (command.tags === undefined || command.tags.length === 0) {
      return { ok: false, message: 'non-trivial tag conflict; pass --tags to resolve' };
    }
  }
  const tags = command.tags !== undefined && command.tags.length > 0 ? command.tags.slice() : tagDecision.tags;

  let entityId: string | undefined;
  let entityLinkExplicitlySet = false;
  if (command.entityId !== undefined) {
    entityLinkExplicitlySet = true;
    if (command.entityId !== null) entityId = command.entityId;
  } else {
    const entityDecision = mergeEntityLinks(ordered);
    if (entityDecision.kind === 'conflict') {
      return { ok: false, message: 'multi-entity window; pass --entity <id> or --link none' };
    }
    entityId = entityDecision.entityId;
    entityLinkExplicitlySet = entityDecision.entityLinkExplicitlySet;
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) return { ok: false, message: 'merge spans must be contiguous live spans' };
  const tokens = tokenIndex(tagged);
  const coverTokens = tokensInCover(first.firstTokenId, last.lastTokenId, tagged, tokens);
  const joiner: ' ' | '-' = ' ';
  const nextSpan: LiveSpan = {
    id: spanIdFor(first.firstTokenId, last.lastTokenId),
    firstTokenId: first.firstTokenId,
    lastTokenId: last.lastTokenId,
    surface: displaySurfaceForTokens(coverTokens, joiner),
    tags,
    origin: 'interactive',
    explicitlySet: true,
    entityLinkExplicitlySet,
  };
  if (entityId !== undefined) nextSpan.entityId = entityId;

  const childIds = new Set<string>();
  for (const child of ordered) childIds.add(child.id);
  const replaced: LiveSpan[] = [];
  let inserted = false;
  for (const span of spans) {
    if (childIds.has(span.id)) {
      if (!inserted) {
        replaced.push(nextSpan);
        inserted = true;
      }
      continue;
    }
    replaced.push(cloneSpan(span));
  }
  return { ok: true, spans: orderSpans(replaced, tagged), mergedId: nextSpan.id };
}

export function validatePartition(spans: readonly LiveSpan[], tagged: readonly TaggedSentence[]): string | undefined {
  const tokens = tokenIndex(tagged);
  const covered = new Set<string>();
  for (const span of spans) {
    if (span.id !== spanIdFor(span.firstTokenId, span.lastTokenId)) {
      return `span id ${span.id} does not match token cover`;
    }
    if (!tokens.has(span.firstTokenId) || !tokens.has(span.lastTokenId)) {
      return `span ${span.id} references unknown tokens`;
    }
    if (!coverIsContiguous(span.firstTokenId, span.lastTokenId, tokens, tagged)) {
      return `span ${span.id} is not a contiguous token run`;
    }
    if (span.insignificant === true && span.entityId !== undefined) {
      return `insignificant span ${span.id} must not carry entityId`;
    }
    const cover = tokensInCover(span.firstTokenId, span.lastTokenId, tagged, tokens);
    for (const token of cover) {
      if (covered.has(token.id)) return `token ${token.id} is covered by more than one live span`;
      covered.add(token.id);
    }
  }
  for (const item of tagged) {
    if (item.status !== 'current') continue;
    for (const token of item.tokens) {
      if (token.status !== 'current') continue;
      if (!covered.has(token.id)) return `token ${token.id} is not covered by a live span`;
    }
  }
  return undefined;
}

function findLexiconWindows(
  spans: readonly LiveSpan[],
  tagged: readonly TaggedSentence[],
  tokens: ReadonlyMap<string, Token>,
  entry: LexiconEntry,
  forceAuto: boolean,
): { spans: LiveSpan[] }[] {
  const bySentence = groupSpansBySentence(spans);
  const windows: { spans: LiveSpan[] }[] = [];
  const wanted = lexiconMatchKey(entry);
  const needed = tokenCountInKey(entry.key);
  if (needed < 1) return windows;

  for (const group of bySentence.values()) {
    for (let start = 0; start < group.length; start += 1) {
      let tokenCount = 0;
      const window: LiveSpan[] = [];
      for (let end = start; end < group.length; end += 1) {
        const span = group[end];
        if (span === undefined) break;
        if (!forceAuto && span.explicitlySet) break;
        const cover = tokensInCover(span.firstTokenId, span.lastTokenId, tagged, tokens);
        tokenCount += cover.length;
        window.push(span);
        if (tokenCount > needed) break;
        if (tokenCount < needed) continue;
        const texts: string[] = [];
        for (const child of window) {
          for (const token of tokensInCover(child.firstTokenId, child.lastTokenId, tagged, tokens)) {
            texts.push(token.text);
          }
        }
        if (matchKeyForTokens(texts, entry) === wanted) windows.push({ spans: window.slice() });
        break;
      }
    }
  }
  return windows;
}

function mergeTags(
  children: readonly LiveSpan[],
  lexiconTags: readonly string[] | undefined,
): { kind: 'ok'; tags: string[] } | { kind: 'conflict'; tags: string[] } {
  if (lexiconTags !== undefined && lexiconTags.length > 0) {
    const conflict = exclusiveTagConflict(children);
    if (conflict) return { kind: 'conflict', tags: [] };
    return { kind: 'ok', tags: lexiconTags.slice() };
  }
  const sets = children.map((child) => new Set(child.tags));
  if (sets.length === 0) return { kind: 'ok', tags: [] };
  const first = sets[0];
  if (first === undefined) return { kind: 'ok', tags: [] };
  let allEmpty = true;
  let allIdentical = true;
  for (const set of sets) {
    if (set.size > 0) allEmpty = false;
    if (!sameStringSet(first, set)) allIdentical = false;
  }
  if (allEmpty) return { kind: 'ok', tags: [] };
  if (allIdentical) return { kind: 'ok', tags: [...first] };
  if (exclusiveTagConflict(children)) return { kind: 'conflict', tags: [] };
  const union = new Set<string>();
  for (const set of sets) {
    for (const tag of set) union.add(tag);
  }
  return { kind: 'ok', tags: [...union] };
}

function exclusiveTagConflict(children: readonly LiveSpan[]): boolean {
  const exclusiveGroups: readonly (readonly string[])[] = [
    ['Noun', 'Verb', 'Adjective', 'Adverb'],
    ['Person', 'Place', 'Organization'],
  ];
  for (const group of exclusiveGroups) {
    const seen = new Set<string>();
    for (const child of children) {
      for (const tag of child.tags) {
        for (const exclusive of group) {
          if (tag === exclusive) seen.add(exclusive);
        }
      }
    }
    if (seen.size > 1) return true;
  }
  return false;
}

function mergeEntityLinks(
  children: readonly LiveSpan[],
):
  | { kind: 'ok'; entityId: string | undefined; entityLinkExplicitlySet: boolean }
  | { kind: 'conflict' } {
  const ids = new Set<string>();
  let anyExplicit = false;
  for (const child of children) {
    if (child.entityId !== undefined) ids.add(child.entityId);
    if (child.entityId !== undefined && child.entityLinkExplicitlySet) anyExplicit = true;
  }
  if (ids.size > 1) return { kind: 'conflict' };
  if (ids.size === 0) return { kind: 'ok', entityId: undefined, entityLinkExplicitlySet: false };
  const only = [...ids][0];
  return { kind: 'ok', entityId: only, entityLinkExplicitlySet: anyExplicit };
}

function conflictWindow(kind: SpanConflictKind, children: readonly LiveSpan[], entry: LexiconEntry): SpanConflictWindow {
  const spanIds: string[] = [];
  const surfaces: string[] = [];
  const childTags: string[][] = [];
  const entityIds: (string | undefined)[] = [];
  for (const child of children) {
    spanIds.push(child.id);
    surfaces.push(child.surface);
    childTags.push(child.tags.slice());
    entityIds.push(child.entityId);
  }
  return {
    kind,
    spanIds,
    surfaces,
    childTags,
    entityIds,
    lexiconEntryId: entry.id,
    lexiconKey: entry.key,
  };
}

function uniqueConflicts(windows: readonly SpanConflictWindow[]): SpanConflictWindow[] {
  const seen = new Set<string>();
  const out: SpanConflictWindow[] = [];
  for (const window of windows) {
    const key = `${window.kind}:${window.spanIds.join(',')}:${window.lexiconEntryId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(window);
  }
  return out;
}

function tokenCountInKey(key: string): number {
  const joiner = lexiconJoiner(key);
  const parts = joiner === '-' ? key.split('-') : key.split(/\s+/);
  let count = 0;
  for (const part of parts) {
    if (normalizeTokenSurface(part) !== '') count += 1;
  }
  return count;
}

function tokenIndex(tagged: readonly TaggedSentence[]): Map<string, Token> {
  const map = new Map<string, Token>();
  for (const item of tagged) {
    for (const token of item.tokens) map.set(token.id, token);
  }
  return map;
}

function tokensInCover(
  firstTokenId: string,
  lastTokenId: string,
  tagged: readonly TaggedSentence[],
  tokens: ReadonlyMap<string, Token>,
): Token[] {
  const first = tokens.get(firstTokenId);
  const last = tokens.get(lastTokenId);
  if (first === undefined || last === undefined) return [];
  const sentenceId = sentenceIdOfToken(firstTokenId);
  const out: Token[] = [];
  let inside = false;
  for (const item of tagged) {
    if (item.id !== sentenceId) continue;
    for (const token of item.tokens) {
      if (token.id === firstTokenId) inside = true;
      if (inside) out.push(token);
      if (token.id === lastTokenId) return out;
    }
  }
  return out;
}

function coverIsContiguous(
  firstTokenId: string,
  lastTokenId: string,
  tokens: ReadonlyMap<string, Token>,
  tagged: readonly TaggedSentence[],
): boolean {
  const cover = tokensInCover(firstTokenId, lastTokenId, tagged, tokens);
  if (cover.length === 0) return false;
  if (cover[0]?.id !== firstTokenId) return false;
  if (cover[cover.length - 1]?.id !== lastTokenId) return false;
  return true;
}

function groupSpansBySentence(spans: readonly LiveSpan[]): Map<string, LiveSpan[]> {
  const groups = new Map<string, LiveSpan[]>();
  for (const span of spans) {
    const sentenceId = sentenceIdOfToken(span.firstTokenId) ?? '';
    let group = groups.get(sentenceId);
    if (group === undefined) {
      group = [];
      groups.set(sentenceId, group);
    }
    group.push(span);
  }
  return groups;
}

function orderSpans(spans: readonly LiveSpan[], tagged: readonly TaggedSentence[]): LiveSpan[] {
  const order = new Map<string, number>();
  let index = 0;
  for (const item of tagged) {
    for (const token of item.tokens) {
      order.set(token.id, index);
      index += 1;
    }
  }
  const sorted = spans.slice();
  sorted.sort((left, right) => (order.get(left.firstTokenId) ?? 0) - (order.get(right.firstTokenId) ?? 0));
  return sorted;
}

function areConsecutive(children: readonly LiveSpan[], all: readonly LiveSpan[], tagged: readonly TaggedSentence[]): boolean {
  const orderedAll = orderSpans(all, tagged);
  const ids = new Set<string>();
  for (const child of children) ids.add(child.id);
  let started = false;
  let ended = false;
  let count = 0;
  for (const span of orderedAll) {
    if (ids.has(span.id)) {
      if (ended) return false;
      started = true;
      count += 1;
      continue;
    }
    if (started) ended = true;
  }
  if (!started || count !== children.length) return false;
  const orderedChildren = orderSpans(children, tagged);
  for (let index = 0; index < orderedChildren.length - 1; index += 1) {
    const left = orderedChildren[index];
    const right = orderedChildren[index + 1];
    if (left === undefined || right === undefined) return false;
    if (!adjacentCovers(left, right, tagged)) return false;
  }
  return true;
}

function adjacentCovers(left: LiveSpan, right: LiveSpan, tagged: readonly TaggedSentence[]): boolean {
  const tokens = tokenIndex(tagged);
  const leftCover = tokensInCover(left.firstTokenId, left.lastTokenId, tagged, tokens);
  const rightCover = tokensInCover(right.firstTokenId, right.lastTokenId, tagged, tokens);
  const lastLeft = leftCover[leftCover.length - 1];
  const firstRight = rightCover[0];
  if (lastLeft === undefined || firstRight === undefined) return false;
  const sentenceId = sentenceIdOfToken(lastLeft.id);
  for (const item of tagged) {
    if (item.id !== sentenceId) continue;
    for (let index = 0; index < item.tokens.length - 1; index += 1) {
      if (item.tokens[index]?.id === lastLeft.id && item.tokens[index + 1]?.id === firstRight.id) return true;
    }
  }
  return false;
}

function sentenceIdOfToken(tokenId: string): string | undefined {
  const dot = tokenId.indexOf('.');
  if (dot <= 0) return undefined;
  return tokenId.slice(0, dot);
}

function cloneSpan(span: LiveSpan): LiveSpan {
  const copy: LiveSpan = {
    id: span.id,
    firstTokenId: span.firstTokenId,
    lastTokenId: span.lastTokenId,
    surface: span.surface,
    tags: span.tags.slice(),
    origin: span.origin,
    explicitlySet: span.explicitlySet,
    entityLinkExplicitlySet: span.entityLinkExplicitlySet,
  };
  if (span.lexiconEntryId !== undefined) copy.lexiconEntryId = span.lexiconEntryId;
  if (span.entityId !== undefined) copy.entityId = span.entityId;
  if (span.insignificant !== undefined) copy.insignificant = span.insignificant;
  return copy;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export type { SpanOrigin };
