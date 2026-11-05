// Agent and human refinements of concept groupings and frame fields, and how they survive re-derivation.
// `original` is always the fresh derivation. A record whose last revision is not by clew keeps its
// `latest`, unless its `dependsOn` cites a changed sentence: then it falls back, and clew records the drop.
import {
  CLEW_AUTHOR,
  type Concept,
  type Field,
  type FieldVersion,
  type Finding,
  type Frame,
  type FrameVersion,
  type Grouping,
  type GroupingVersion,
  type LiveSentence,
  type LiveSpan,
  type Revision,
  type Role,
  type RoleName,
} from './spec.js';
import { wordOf } from './spec-clauses.js';
import { conceptCanonical, conceptId, deriveConcepts, findConcept } from './spec-concepts.js';
import { copyField, copyFrame, copyFrameVersion, copyVersion, deriveFrames, ROLE_NAMES } from './spec-frames.js';
import type { RevisionNote } from './spec-sentences.js';
import { cloneSpan, sentenceIdOfToken } from './spec-spans.js';
import { isContentVerb, normalizeWord, verbLemma } from './spec-words.js';

export const REFINEMENT_DROPPED = 'refinement-dropped';
export const NOT_TRANSITION_ROLE = 'notTransition';
export const GROUPING_ROLE = 'concept';

/** Sentences that an add, edit, or delete just changed, and when. */
export interface ChangeContext {
  changed: ReadonlySet<string>;
  at: string;
}

/** One refinement that fell back to its derived value, or whose frame or span no longer derives. */
export interface RefinementDrop {
  target: string;
  role: string;
  reason: string;
  value: string;
  vanished: boolean;
  finding: Finding;
}

export interface RefinableLayers {
  concepts?: readonly Concept[];
  groups?: readonly Grouping[];
  frames?: readonly Frame[];
}

export interface RebuiltLayers {
  spans: LiveSpan[];
  concepts?: Concept[];
  groups?: Grouping[];
  frames?: Frame[];
  drops: RefinementDrop[];
}

/** Concepts, then frames, for every layer the session already has. Refinements are carried over. */
export function rebuildLayers(
  sentences: readonly LiveSentence[],
  spans: readonly LiveSpan[],
  layers: RefinableLayers,
  context?: ChangeContext,
): RebuiltLayers {
  if (layers.concepts === undefined && layers.frames === undefined) return { spans: spans.slice(), drops: [] };
  const concepts = refreshConcepts(spans, layers.groups ?? [], context);
  const rebuilt: RebuiltLayers = { spans: concepts.spans, concepts: concepts.concepts, groups: concepts.groups, drops: concepts.drops };
  if (layers.frames !== undefined) {
    const frames = refreshFrames(sentences, concepts.spans, concepts.concepts, layers.frames, context);
    rebuilt.frames = frames.frames;
    for (const drop of frames.drops) rebuilt.drops.push(drop);
  }
  return rebuilt;
}

/** Lexical concepts, then each refined grouping on top. A grouping whose span is gone is dropped. */
export function refreshConcepts(
  spans: readonly LiveSpan[],
  groups: readonly Grouping[],
  context?: ChangeContext,
): { spans: LiveSpan[]; concepts: Concept[]; groups: Grouping[]; drops: RefinementDrop[] } {
  const byId = new Map<string, LiveSpan>();
  for (const span of spans) byId.set(span.id, span);
  const next: Grouping[] = [];
  const drops: RefinementDrop[] = [];
  const owned = new Map<string, string | null>();
  for (const grouping of groups) {
    const span = byId.get(grouping.span);
    const refined = isRefined(grouping.history);
    if (span === undefined) {
      if (refined) drops.push(vanishedDrop(grouping.span, sentenceOfRef(grouping.span) ?? '', GROUPING_ROLE, groupingText(grouping.latest)));
      continue;
    }
    const original = lexicalConcept(span);
    const record: Grouping = { span: span.id, original, latest: original, dependsOn: [span.id], history: copyHistory(grouping.history, copyGroupingVersion) };
    if (refined) {
      const changed = citedChange(grouping.dependsOn, context);
      if (changed !== undefined && context !== undefined) {
        const old: GroupingVersion = { concept: grouping.latest, dependsOn: grouping.dependsOn.slice() };
        const drop = fallbackDrop(span.id, sentenceOfRef(span.id) ?? '', GROUPING_ROLE, changed, groupingText(grouping.latest));
        record.history.push(dropRevision(context.at, drop, old));
        drops.push(drop);
      } else {
        record.latest = grouping.latest;
        record.dependsOn = grouping.dependsOn.slice();
        owned.set(span.id, grouping.latest);
      }
    }
    next.push(record);
  }
  const listed = new Set<string>();
  for (const record of next) listed.add(record.span);
  const adjusted: LiveSpan[] = [];
  for (const span of spans) {
    const copy = cloneSpan(span);
    if (owned.has(span.id)) {
      const concept = owned.get(span.id) ?? null;
      copy.entityLinkExplicitlySet = true;
      if (concept === null) delete copy.entityId;
      else copy.entityId = concept;
    } else if (listed.has(span.id)) {
      copy.entityLinkExplicitlySet = false;
    }
    adjusted.push(copy);
  }
  const derived = deriveConcepts(adjusted);
  return { spans: derived.spans, concepts: derived.concepts, groups: next, drops };
}

/** Fresh frames. A frame that derives again keeps its refined fields and its not-transition note. */
export function refreshFrames(
  sentences: readonly LiveSentence[],
  spans: readonly LiveSpan[],
  concepts: readonly Concept[],
  previous: readonly Frame[],
  context?: ChangeContext,
): { frames: Frame[]; drops: RefinementDrop[] } {
  const frames = deriveFrames(sentences, spans, concepts);
  const drops: RefinementDrop[] = [];
  const before = new Map<string, Frame>();
  for (const frame of previous) before.set(frame.id, frame);
  const derived = new Set<string>();
  for (const frame of frames) {
    derived.add(frame.id);
    const old = before.get(frame.id);
    if (old === undefined) continue;
    for (const role of ROLE_NAMES) frame.roles[role] = mergeField(frame, role, frame.roles[role], old.roles[role], drops, context);
    mergeNotTransition(frame, old, drops, context);
  }
  for (const old of previous) {
    if (derived.has(old.id)) continue;
    for (const role of ROLE_NAMES) {
      const field = old.roles[role];
      if (isRefined(field.history)) drops.push(vanishedDrop(old.id, old.sentence, role, fieldText(field.latest)));
    }
    const agent = agentNotTransition(old);
    if (agent !== undefined && agent !== null) drops.push(vanishedDrop(old.id, old.sentence, NOT_TRANSITION_ROLE, notTransitionText(agent)));
  }
  return { frames, drops };
}

/** Open `refinement-dropped` findings: each record whose last revision is a clew drop. */
export function refinementFindings(frames: readonly Frame[], groups: readonly Grouping[]): Finding[] {
  const findings: Finding[] = [];
  for (const frame of frames) {
    for (const role of ROLE_NAMES) {
      const field = frame.roles[role];
      const last = droppedRevision(field.history, frame.id, role);
      if (last !== undefined) findings.push(dropFinding(frame.id, frame.sentence, role, last.reason, fieldText(last.value)));
    }
    const last = droppedRevision(frame.history, frame.id, NOT_TRANSITION_ROLE);
    if (last !== undefined) findings.push(dropFinding(frame.id, frame.sentence, NOT_TRANSITION_ROLE, last.reason, notTransitionText(last.value.notTransition)));
  }
  for (const grouping of groups) {
    const last = droppedRevision(grouping.history, grouping.span, GROUPING_ROLE);
    if (last !== undefined) findings.push(dropFinding(grouping.span, sentenceOfRef(grouping.span) ?? '', GROUPING_ROLE, last.reason, groupingText(last.value.concept)));
  }
  return findings;
}

/** True when an agent or a human wrote the record last. */
export function isRefined(history: readonly Revision<unknown>[]): boolean {
  const last = history[history.length - 1];
  return last !== undefined && last.who !== CLEW_AUTHOR;
}

/** The not-transition note an agent or human wrote last: undefined when none, null when they cleared it. */
export function agentNotTransition(frame: Frame): { reason: string } | null | undefined {
  const last = frame.history[frame.history.length - 1];
  if (last === undefined || last.who === CLEW_AUTHOR) return undefined;
  return last.value.notTransition;
}

export interface ImpactEntry {
  kind: 'field' | 'grouping';
  frame?: string;
  role?: string;
  span?: string;
  value: Role | string | null;
  dependsOn: string[];
  refined: boolean;
}

/**
 * Every field and grouping whose `latest.dependsOn` cites a span of the sentence, and the frames derived
 * from it. An agent's not-transition note depends on its frame's own sentence.
 */
export function impactOf(frames: readonly Frame[], groups: readonly Grouping[], sentence: string): { entries: ImpactEntry[]; frames: string[] } {
  const entries: ImpactEntry[] = [];
  const own: string[] = [];
  for (const frame of frames) {
    if (frame.sentence === sentence) own.push(frame.id);
    for (const role of ROLE_NAMES) {
      const field = frame.roles[role];
      if (!cites(field.latest.dependsOn, sentence)) continue;
      entries.push({ kind: 'field', frame: frame.id, role, value: copyVersion(field.latest).value, dependsOn: field.latest.dependsOn.slice(), refined: isRefined(field.history) });
    }
    const agent = agentNotTransition(frame);
    if (frame.sentence === sentence && agent !== undefined && agent !== null) {
      entries.push({ kind: 'field', frame: frame.id, role: NOT_TRANSITION_ROLE, value: { text: agent.reason, refs: [] }, dependsOn: [], refined: true });
    }
  }
  for (const grouping of groups) {
    if (!cites(grouping.dependsOn, sentence)) continue;
    entries.push({ kind: 'grouping', span: grouping.span, value: grouping.latest, dependsOn: grouping.dependsOn.slice(), refined: isRefined(grouping.history) });
  }
  return { entries, frames: own };
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; message: string };

export interface RefineScope {
  sentences: readonly LiveSentence[];
  spans: readonly LiveSpan[];
  concepts: readonly Concept[];
  frames: readonly Frame[];
}

/**
 * The version a `frames set` writes: the value read from its refs, and the spans that evidence it.
 * Explicit `dependsOn` must name live spans and may cross sentences.
 */
export function roleVersion(
  scope: RefineScope,
  frame: Frame,
  role: RoleName,
  refs: readonly string[] | 'unknown',
  dependsOn: readonly string[] | undefined,
): Resolved<FieldVersion> {
  const spans = new Map<string, LiveSpan>();
  for (const span of scope.spans) spans.set(span.id, span);
  for (const id of dependsOn ?? []) {
    if (!spans.has(id)) return { ok: false, message: `unknown span "${id}"` };
  }
  if (refs === 'unknown') return { ok: true, value: { value: 'unknown', dependsOn: (dependsOn ?? []).slice() } };
  let value: Role;
  let evidence: string[];
  if (role === 'event') {
    const only = refs[0];
    if (refs.length !== 1 || only === undefined) return { ok: false, message: '--role event takes exactly one span id' };
    const span = spans.get(only);
    if (span === undefined) return { ok: false, message: `unknown span "${only}"` };
    if (span.insignificant === true || !isContentVerb(span)) return { ok: false, message: `${only} is not a content verb` };
    value = { text: verbLemma(span), refs: [only] };
    evidence = [only];
  } else if (role === 'when') {
    if (refs.length === 0) return { ok: false, message: '--role when takes one or more frame ids' };
    const texts: string[] = [];
    evidence = [];
    for (const ref of refs) {
      if (ref === frame.id) return { ok: false, message: `${frame.id} cannot wait on itself` };
      const cited = scope.frames.find((item) => item.id === ref);
      if (cited === undefined) return { ok: false, message: `unknown frame "${ref}"` };
      texts.push(cited.clause.text);
      const lead = frameEvidence(scope, cited);
      if (lead !== undefined && !evidence.includes(lead)) evidence.push(lead);
    }
    value = { text: texts.join(' and '), refs: refs.slice() };
  } else {
    const only = refs[0];
    if (refs.length !== 1 || only === undefined) return { ok: false, message: `--role ${role} takes exactly one concept id` };
    const concept = findConcept(scope.concepts, only);
    if (concept === undefined) return { ok: false, message: `unknown concept "${only}"` };
    value = { text: concept.canonical, refs: [concept.id] };
    const local = concept.members.filter((member) => sentenceOfRef(member) === frame.sentence);
    evidence = local.length > 0 ? local : concept.members.slice();
  }
  return { ok: true, value: { value, dependsOn: dependsOn === undefined ? evidence : dependsOn.slice() } };
}

/** The concept a `concepts group` writes, checked against the live spans and concepts. */
export function groupingVersion(
  spans: readonly LiveSpan[],
  concepts: readonly Concept[],
  spanId: string,
  concept: string | null,
  dependsOn: readonly string[] | undefined,
): Resolved<GroupingVersion> {
  const span = spans.find((item) => item.id === spanId);
  if (span === undefined) return { ok: false, message: `unknown span "${spanId}"` };
  if (span.insignificant === true) return { ok: false, message: `${spanId} is not a significant span` };
  for (const id of dependsOn ?? []) {
    if (!spans.some((item) => item.id === id)) return { ok: false, message: `unknown span "${id}"` };
  }
  if (concept !== null && findConcept(concepts, concept) === undefined) {
    const word = concept.startsWith('concept:') ? concept.slice('concept:'.length) : '';
    if (normalizeWord(word).word !== word) return { ok: false, message: `"${concept}" is neither a concept nor concept:<kebab-case word>` };
  }
  return { ok: true, value: { concept, dependsOn: dependsOn === undefined ? [span.id] : dependsOn.slice() } };
}

/** What a span reads now: its refined grouping, or its lexical link with itself as evidence. */
export function currentGrouping(spans: readonly LiveSpan[], groups: readonly Grouping[], spanId: string): GroupingVersion {
  const grouping = groups.find((item) => item.span === spanId);
  if (grouping !== undefined && isRefined(grouping.history)) return { concept: grouping.latest, dependsOn: grouping.dependsOn.slice() };
  const span = spans.find((item) => item.id === spanId);
  return { concept: span?.entityId ?? null, dependsOn: [spanId] };
}

export function sameGrouping(left: GroupingVersion, right: GroupingVersion): boolean {
  if (left.concept !== right.concept || left.dependsOn.length !== right.dependsOn.length) return false;
  return left.dependsOn.every((id, index) => right.dependsOn[index] === id);
}

export function writeGrouping(groups: readonly Grouping[], span: LiveSpan, version: GroupingVersion, note: RevisionNote): Grouping[] {
  const next: Grouping[] = [];
  let written = false;
  for (const grouping of groups) {
    const copy = copyGrouping(grouping);
    if (copy.span === span.id) {
      apply(copy);
      written = true;
    }
    next.push(copy);
  }
  if (!written) {
    const original = lexicalConcept(span);
    const created: Grouping = { span: span.id, original, latest: original, dependsOn: [span.id], history: [] };
    apply(created);
    next.push(created);
  }
  return next;

  function apply(target: Grouping): void {
    target.latest = version.concept;
    target.dependsOn = version.dependsOn.slice();
    target.history.push(revision(note, copyGroupingVersion(version)));
  }
}

export function writeField(frame: Frame, role: RoleName, version: FieldVersion, note: RevisionNote): Frame {
  const copy = copyFrame(frame);
  const field = copy.roles[role];
  field.latest = copyVersion(version);
  field.history.push(revision(note, copyVersion(version)));
  return copy;
}

export function writeNotTransition(frame: Frame, notTransition: { reason: string } | null, note: RevisionNote): Frame {
  const copy = copyFrame(frame);
  copy.history.push(revision(note, { notTransition: notTransition === null ? null : { reason: notTransition.reason } }));
  return copy;
}

export function copyGrouping(grouping: Grouping): Grouping {
  return {
    span: grouping.span,
    original: grouping.original,
    latest: grouping.latest,
    dependsOn: grouping.dependsOn.slice(),
    history: copyHistory(grouping.history, copyGroupingVersion),
  };
}

export function sameGroups(left: readonly Grouping[] | undefined, right: readonly Grouping[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined || y === undefined) return false;
    if (x.span !== y.span || x.original !== y.original || !sameGrouping({ concept: x.latest, dependsOn: x.dependsOn }, { concept: y.latest, dependsOn: y.dependsOn })) return false;
    if (x.history.length !== y.history.length) return false;
    for (let item = 0; item < x.history.length; item += 1) {
      const p = x.history[item];
      const q = y.history[item];
      if (p === undefined || q === undefined) return false;
      if (p.at !== q.at || p.who !== q.who || p.reason !== q.reason || p.finding !== q.finding || p.comment !== q.comment) return false;
      if (!sameGrouping(p.value, q.value)) return false;
    }
  }
  return true;
}

/** Sentence id of a span id (`sp:s1.t2..s1.t3`) or a token id (`s1.t2`). */
export function sentenceOfRef(ref: string): string | undefined {
  return sentenceIdOfToken(ref.startsWith('sp:') ? ref.slice(3) : ref);
}

export function fieldText(version: FieldVersion): string {
  return version.value === 'unknown' ? 'unknown' : `"${version.value.text}"`;
}

function groupingText(concept: string | null): string {
  return concept ?? 'no concept';
}

function notTransitionText(value: { reason: string } | null): string {
  return value === null ? 'a transition' : `not a transition: ${value.reason}`;
}

function mergeField(frame: Frame, role: RoleName, fresh: Field, old: Field, drops: RefinementDrop[], context: ChangeContext | undefined): Field {
  const history = copyField(old).history;
  const derived: Field = { original: fresh.original, latest: copyVersion(fresh.original), history };
  if (!isRefined(old.history)) return derived;
  const changed = citedChange(old.latest.dependsOn, context);
  if (changed === undefined || context === undefined) return { original: fresh.original, latest: copyVersion(old.latest), history };
  const drop = fallbackDrop(frame.id, frame.sentence, role, changed, fieldText(old.latest));
  history.push(dropRevision(context.at, drop, copyVersion(old.latest)));
  drops.push(drop);
  return derived;
}

function mergeNotTransition(frame: Frame, old: Frame, drops: RefinementDrop[], context: ChangeContext | undefined): void {
  frame.history = copyHistory(old.history, copyFrameVersion);
  const agent = agentNotTransition(old);
  if (agent === undefined || agent === null) return;
  const last = old.history[old.history.length - 1];
  if (context !== undefined && context.changed.has(old.sentence)) {
    const drop = fallbackDrop(frame.id, frame.sentence, NOT_TRANSITION_ROLE, old.sentence, notTransitionText(agent));
    frame.history.push(dropRevision(context.at, drop, { notTransition: { reason: agent.reason } }));
    drops.push(drop);
    return;
  }
  frame.notTransition = { reason: agent.reason, who: last?.who ?? CLEW_AUTHOR };
}

/** Evidence for a `when` ref: the cited frame's event span, or its first significant span after the marker. */
function frameEvidence(scope: RefineScope, frame: Frame): string | undefined {
  const event = frame.roles.event.latest.value;
  if (event !== 'unknown' && event.refs[0] !== undefined) return event.refs[0];
  const sentence = scope.sentences.find((item) => item.id === frame.sentence);
  if (sentence === undefined) return undefined;
  const start = sentence.span[0] + frame.clause.start;
  const end = sentence.span[0] + frame.clause.end;
  let skippedMarker = frame.marker === undefined;
  for (const span of scope.spans) {
    if (sentenceIdOfToken(span.firstTokenId) !== frame.sentence || span.range[0] < start || span.range[1] > end) continue;
    if (!skippedMarker && wordOf(span) === frame.marker) {
      skippedMarker = true;
      continue;
    }
    if (span.insignificant !== true) return span.id;
  }
  return undefined;
}

function lexicalConcept(span: LiveSpan): string | null {
  const canonical = conceptCanonical(span);
  return canonical === undefined ? null : conceptId(canonical);
}

function cites(dependsOn: readonly string[], sentence: string): boolean {
  return dependsOn.some((ref) => sentenceOfRef(ref) === sentence);
}

function citedChange(dependsOn: readonly string[], context: ChangeContext | undefined): string | undefined {
  if (context === undefined) return undefined;
  for (const ref of dependsOn) {
    const sentence = sentenceOfRef(ref);
    if (sentence !== undefined && context.changed.has(sentence)) return sentence;
  }
  return undefined;
}

function findingId(target: string, role: string): string {
  return `${REFINEMENT_DROPPED}:${target}:${role}`;
}

function fallbackDrop(target: string, sentence: string, role: string, changed: string, value: string): RefinementDrop {
  const reason = `${changed} changed`;
  return { target, role, reason, value, vanished: false, finding: dropFinding(target, sentence, role, reason, value) };
}

function vanishedDrop(target: string, sentence: string, role: string, value: string): RefinementDrop {
  const reason = `${target} no longer derives`;
  return {
    target,
    role,
    reason,
    value,
    vanished: true,
    finding: {
      id: findingId(target, role),
      kind: 'stale',
      code: REFINEMENT_DROPPED,
      severity: 'warning',
      message: `${target} no longer derives; its refined ${role} read ${value}`,
      refs: [target, sentence],
    },
  };
}

function dropFinding(target: string, sentence: string, role: string, reason: string, value: string): Finding {
  return {
    id: findingId(target, role),
    kind: 'stale',
    code: REFINEMENT_DROPPED,
    severity: 'warning',
    message: `${target} ${role} fell back to its derived value (${reason}); it read ${value}`,
    refs: [target, sentence],
  };
}

function dropRevision<T>(at: string, drop: RefinementDrop, value: T): Revision<T> {
  return { at, who: CLEW_AUTHOR, reason: drop.reason, finding: drop.finding.id, value };
}

function droppedRevision<T>(history: readonly Revision<T>[], target: string, role: string): Revision<T> | undefined {
  const last = history[history.length - 1];
  if (last === undefined || last.who !== CLEW_AUTHOR || last.finding !== findingId(target, role)) return undefined;
  return last;
}

function revision<T>(note: RevisionNote, value: T): Revision<T> {
  const entry: Revision<T> = { at: note.at, who: note.who, reason: note.reason, value };
  if (note.finding !== undefined) entry.finding = note.finding;
  if (note.comment !== undefined) entry.comment = note.comment;
  return entry;
}

function copyHistory<T>(history: readonly Revision<T>[], copy: (value: T) => T): Revision<T>[] {
  const next: Revision<T>[] = [];
  for (const item of history) {
    const entry: Revision<T> = { at: item.at, who: item.who, reason: item.reason, value: copy(item.value) };
    if (item.finding !== undefined) entry.finding = item.finding;
    if (item.comment !== undefined) entry.comment = item.comment;
    next.push(entry);
  }
  return next;
}

function copyGroupingVersion(version: GroupingVersion): GroupingVersion {
  return { concept: version.concept, dependsOn: version.dependsOn.slice() };
}
