// Versions of a spec session. A milestone is a record written when a batch of work is closed: what it was for,
// what was decided, who closed it, the range of log entries it covers, and a digest of what changed. The log
// itself (history.jsonl, and the canonical pipeline's history in canon.json) stays as it is underneath.
// Everything here is pure: the stores freeze and read the session files, the use cases gate and compile.
import type { CanonLexicon } from './canon-ast.js';
import type { Revision, Sentence, SentenceText } from './spec.js';

export const MILESTONE_ID_PATTERN = /^m[1-9][0-9]*$/;
export const MILESTONE_ID_MESSAGE = 'a milestone id is m and a number, for example m1';
export const VERSION_REF_MESSAGE = 'a version is original, latest, or a milestone id such as m1';

/** `original` is the spec as `spec init` read it, `latest` the session now, `mN` the session when milestone N was closed. */
export function isVersionRef(ref: string): boolean {
  return ref === 'original' || ref === 'latest' || MILESTONE_ID_PATTERN.test(ref);
}

/** Entries `from` (inclusive) to `to` (exclusive) of one append-only log, counted from 0. */
export interface LogRange {
  from: number;
  to: number;
}

/** Counts of one version. The gate counts are absent when no lexicon applies; frames when the frames layer was never written. */
export interface VersionCounts {
  live: number;
  frames?: number;
  accepted?: number;
  dangling?: number;
  actions?: number;
}

export interface WordsDiff {
  added: string[];
  removed: string[];
}

export interface LexiconDiff {
  actors?: WordsDiff;
  terms?: WordsDiff;
  states?: WordsDiff;
  verbs?: WordsDiff;
  fixed?: WordsDiff;
  /** A noun whose instance count changed; an absent side means the default. */
  instances?: { noun: string; from?: number; to?: number }[];
}

/** One compiled action, reduced to what a reader compares: its name, guards, and effects as TLA+. */
export interface ActionSummary {
  name: string;
  guards: string[];
  effects: string[];
}

export interface ActionDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** What a milestone changed, against the milestone before it (or the original spec). */
export interface MilestoneDigest {
  before: VersionCounts;
  after: VersionCounts;
  added: string[];
  deleted: string[];
  edited: string[];
  lexicon?: LexiconDiff;
  actions?: ActionDiff;
  /** How many log entries of each command the milestone covers. */
  commands: Record<string, number>;
}

export interface Milestone {
  id: string;
  title: string;
  goal: string;
  /** Each decision taken in the batch, with its rationale, as the author wrote it. */
  decisions: string[];
  who: string;
  at: string;
  /** The version the digest is measured from: `original` or the previous milestone's id. */
  previous: string;
  /** The history.jsonl lines the milestone covers. */
  history: LogRange;
  /** The canon.json history entries the milestone covers (lexicon, accept, merge). */
  canon: LogRange;
  digest: MilestoneDigest;
}

/** One reason recorded on a sentence between two versions. */
export interface RevisionNoteView {
  at: string;
  who: string;
  reason: string;
  comment?: string;
}

export interface SentenceChange {
  id: string;
  text: string;
  section: string;
  revisions: RevisionNoteView[];
}

export interface SentenceEditView {
  id: string;
  from: string;
  to: string;
  /** Present when the heading path changed. */
  sections?: { from: string; to: string };
  revisions: RevisionNoteView[];
}

export interface SentenceDiff {
  added: SentenceChange[];
  deleted: SentenceChange[];
  edited: SentenceEditView[];
}

/**
 * Sentences that are live in `after` and not in `before` are added, the reverse deleted, and a sentence live in both
 * with another text or heading is edited. `forward` says `after` is the later version; the revisions listed for a
 * change are the ones the later version has beyond the earlier one, so a diff run backwards still shows the reasons.
 */
export function diffSentences(before: readonly Sentence[], after: readonly Sentence[], forward: boolean): SentenceDiff {
  const earlier = new Map<string, Sentence>();
  const later = new Map<string, Sentence>();
  for (const sentence of forward ? before : after) earlier.set(sentence.id, sentence);
  for (const sentence of forward ? after : before) later.set(sentence.id, sentence);
  const notes = (id: string): RevisionNoteView[] => {
    const late = later.get(id);
    if (late === undefined) return [];
    const skip = earlier.get(id)?.history.length ?? 0;
    return late.history.slice(skip).map(noteView);
  };
  const beforeLive = new Map<string, SentenceText>();
  for (const sentence of before) if (sentence.latest !== null) beforeLive.set(sentence.id, sentence.latest);
  const diff: SentenceDiff = { added: [], deleted: [], edited: [] };
  const seen = new Set<string>();
  for (const sentence of after) {
    const now = sentence.latest;
    if (now === null) continue;
    seen.add(sentence.id);
    const was = beforeLive.get(sentence.id);
    if (was === undefined) {
      diff.added.push({ id: sentence.id, text: now.text, section: now.section, revisions: notes(sentence.id) });
      continue;
    }
    if (was.text === now.text && was.section === now.section) continue;
    const edit: SentenceEditView = { id: sentence.id, from: was.text, to: now.text, revisions: notes(sentence.id) };
    if (was.section !== now.section) edit.sections = { from: was.section, to: now.section };
    diff.edited.push(edit);
  }
  for (const sentence of before) {
    const was = sentence.latest;
    if (was === null || seen.has(sentence.id)) continue;
    diff.deleted.push({ id: sentence.id, text: was.text, section: was.section, revisions: notes(sentence.id) });
  }
  return diff;
}

function noteView(revision: Revision<unknown>): RevisionNoteView {
  const view: RevisionNoteView = { at: revision.at, who: revision.who, reason: revision.reason };
  if (revision.comment !== undefined) view.comment = revision.comment;
  return view;
}

function words(before: readonly string[], after: readonly string[]): WordsDiff | undefined {
  const was = new Set(before);
  const now = new Set(after);
  const added = [...now].filter((word) => !was.has(word));
  const removed = [...was].filter((word) => !now.has(word));
  return added.length === 0 && removed.length === 0 ? undefined : { added, removed };
}

/** What changed in the canonical lexicon. A version without a lexicon reads as an empty one. Undefined when nothing did. */
export function diffLexicon(before: CanonLexicon | undefined, after: CanonLexicon | undefined): LexiconDiff | undefined {
  if (before === undefined && after === undefined) return undefined;
  const diff: LexiconDiff = {};
  for (const field of ['actors', 'terms', 'states', 'verbs'] as const) {
    const changed = words(before?.[field] ?? [], after?.[field] ?? []);
    if (changed !== undefined) diff[field] = changed;
  }
  const fixed = words(before?.fixed ?? [], after?.fixed ?? []);
  if (fixed !== undefined) diff.fixed = fixed;
  const was = before?.instances ?? {};
  const now = after?.instances ?? {};
  const instances: NonNullable<LexiconDiff['instances']> = [];
  for (const noun of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
    if (was[noun] === now[noun]) continue;
    const change: NonNullable<LexiconDiff['instances']>[number] = { noun };
    if (was[noun] !== undefined) change.from = was[noun];
    if (now[noun] !== undefined) change.to = now[noun];
    instances.push(change);
  }
  if (instances.length > 0) diff.instances = instances;
  return Object.keys(diff).length === 0 ? undefined : diff;
}

/** Actions are matched by name, which carries the sentence id and branch; a matched action changed when its guards or effects did. */
export function diffActions(before: readonly ActionSummary[], after: readonly ActionSummary[]): ActionDiff {
  const was = new Map<string, ActionSummary>();
  for (const action of before) was.set(action.name, action);
  const now = new Set<string>();
  const diff: ActionDiff = { added: [], removed: [], changed: [] };
  for (const action of after) {
    now.add(action.name);
    const old = was.get(action.name);
    if (old === undefined) diff.added.push(action.name);
    else if (!sameList(old.guards, action.guards) || !sameList(old.effects, action.effects)) diff.changed.push(action.name);
  }
  for (const action of before) if (!now.has(action.name)) diff.removed.push(action.name);
  return diff;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function countCommands(commands: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const command of commands) counts[command] = (counts[command] ?? 0) + 1;
  return counts;
}

export function liveCount(sentences: readonly Sentence[]): number {
  let count = 0;
  for (const sentence of sentences) if (sentence.latest !== null) count += 1;
  return count;
}

/** The next free milestone id. Ids are never reused. */
export function nextMilestoneId(milestones: readonly Milestone[]): string {
  let highest = 0;
  for (const milestone of milestones) highest = Math.max(highest, Number(milestone.id.slice(1)));
  return `m${highest + 1}`;
}

/**
 * The order of versions: original first, then milestones by number, latest last. A milestone's number is its rank,
 * so `m2` is later than `m1` even when two milestones were closed in the same millisecond.
 */
export function versionRank(ref: string): number {
  if (ref === 'original') return 0;
  if (ref === 'latest') return Number.MAX_SAFE_INTEGER;
  return Number(ref.slice(1));
}
