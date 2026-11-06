// Spans + concepts → clause frames. Roles are read by position, because concepts carry no kind.
// One frame per clause segment: actor, event, object, result, and the conditions it waits on.
import type { ClauseBound, Concept, Field, FieldVersion, Frame, FrameVersion, LiveSentence, LiveSpan, NotTransition, Revision, Role, RoleName } from './spec.js';
import { CONDITION_MARKERS, segmentClauses, startsWithConjunction, wordOf, type ClauseSegment } from './spec-clauses.js';
import { findConcept } from './spec-concepts.js';
import { sentenceIdOfToken } from './spec-spans.js';
import { hasTag, isContentVerb, verbLemma } from './spec-words.js';

export const ROLE_NAMES: readonly RoleName[] = ['actor', 'event', 'object', 'result', 'when'];

const NEGATIONS: ReadonlySet<string> = new Set(['not', 'never', 'no']);
const RESULT_LINKS: ReadonlySet<string> = new Set(['as', 'into']);
const ANAPHORA: ReadonlySet<string> = new Set(['it', 'them']);

interface Placed {
  span: LiveSpan;
  concept: Concept;
}

interface Draft {
  frame: Frame;
  segment: ClauseSegment;
  event?: LiveSpan;
  /** First significant span after the marker: the evidence when the clause has no event. */
  lead?: LiveSpan;
}

interface WhenPart {
  ref: string;
  text: string;
  dependsOn: string[];
}

export function deriveFrames(
  sentences: readonly LiveSentence[],
  spans: readonly LiveSpan[],
  concepts: readonly Concept[],
): Frame[] {
  const bySentence = new Map<string, LiveSpan[]>();
  for (const span of spans) {
    const id = sentenceIdOfToken(span.firstTokenId);
    if (id === undefined) continue;
    const list = bySentence.get(id) ?? [];
    list.push(span);
    bySentence.set(id, list);
  }
  const frames: Frame[] = [];
  let previous: Draft | undefined;
  for (const sentence of sentences) {
    const sentenceSpans = bySentence.get(sentence.id) ?? [];
    const drafts: Draft[] = [];
    for (const segment of segmentClauses(sentence, sentenceSpans)) {
      drafts.push(draftFrame(sentence, segment, sentenceSpans, concepts, drafts[drafts.length - 1]));
    }
    const whens = new Map<Draft, WhenPart[]>();
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      if (draft === undefined) continue;
      const marker = draft.segment.markerSpan;
      if (draft.frame.marker === 'then' && marker !== undefined) {
        const before = drafts[index - 1] ?? previous;
        if (before !== undefined) pushWhen(whens, draft, whenPart(before, marker));
      }
      if (draft.frame.marker === undefined || !CONDITION_MARKERS.has(draft.frame.marker) || marker === undefined) continue;
      const target = conditionTarget(drafts, index);
      if (target !== undefined) pushWhen(whens, target, whenPart(draft, marker));
    }
    for (const draft of drafts) {
      draft.frame.roles.when = whenField(whens.get(draft) ?? []);
      frames.push(draft.frame);
      previous = draft;
    }
  }
  return frames;
}

export function roleValue(field: Field): Role {
  return field.latest.value;
}

export function isTransitionFrame(frame: Frame): boolean {
  return frame.notTransition === undefined;
}

export function sameFrames(left: readonly Frame[] | undefined, right: readonly Frame[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || !sameFrame(a, b)) return false;
  }
  return true;
}

export function copyFrame(frame: Frame): Frame {
  const roles: Record<RoleName, Field> = {
    actor: copyField(frame.roles.actor),
    event: copyField(frame.roles.event),
    object: copyField(frame.roles.object),
    result: copyField(frame.roles.result),
    when: copyField(frame.roles.when),
  };
  const history: Revision<FrameVersion>[] = [];
  for (const revision of frame.history) {
    const entry: Revision<FrameVersion> = { at: revision.at, who: revision.who, reason: revision.reason, value: copyFrameVersion(revision.value) };
    if (revision.finding !== undefined) entry.finding = revision.finding;
    if (revision.comment !== undefined) entry.comment = revision.comment;
    history.push(entry);
  }
  const copy: Frame = { id: frame.id, sentence: frame.sentence, clause: copyClause(frame.clause), roles, history };
  if (frame.marker !== undefined) copy.marker = frame.marker;
  if (frame.negated === true) copy.negated = true;
  if (frame.notTransition !== undefined) copy.notTransition = copyNotTransition(frame.notTransition);
  return copy;
}

export function copyNotTransition(value: NotTransition): NotTransition {
  const copy: NotTransition = { reason: value.reason };
  if (value.who !== undefined) copy.who = value.who;
  return copy;
}

export function copyFrameVersion(version: FrameVersion): FrameVersion {
  return { notTransition: version.notTransition === null ? null : { reason: version.notTransition.reason } };
}

export function unknownField(): Field {
  return field('unknown', []);
}

function draftFrame(
  sentence: LiveSentence,
  segment: ClauseSegment,
  sentenceSpans: readonly LiveSpan[],
  concepts: readonly Concept[],
  previous: Draft | undefined,
): Draft {
  const spans = segment.spans;
  const first = spans[0];
  const roles: Record<RoleName, Field> = {
    actor: unknownField(),
    event: unknownField(),
    object: unknownField(),
    result: unknownField(),
    when: unknownField(),
  };
  const frame: Frame = {
    id: `fr:${first?.firstTokenId ?? sentence.id}`,
    sentence: sentence.id,
    clause: copyClause(segment.clause),
    roles,
    history: [],
  };
  if (segment.marker !== undefined) frame.marker = segment.marker;
  const draft: Draft = { frame, segment };
  const lead = spans.find((span) => span.insignificant !== true && span !== segment.markerSpan);
  if (lead !== undefined) draft.lead = lead;
  const negations: string[] = [];
  for (const span of spans) {
    if (NEGATIONS.has(wordOf(span)) || hasTag(span.tags, 'Negative')) negations.push(span.id);
  }
  if (negations.length > 0) frame.negated = true;
  const eventIndex = spans.findIndex((span) => span.insignificant !== true && isContentVerb(span) && !isAdjectival(sentenceSpans, span));
  const event = spans[eventIndex];
  if (event === undefined) {
    frame.notTransition = { reason: 'no verb' };
    return draft;
  }
  draft.event = event;
  const lemma = verbLemma(event);
  roles.event = field({ text: lemma, refs: [event.id] }, [event.id, ...negations]);
  const before = spans.slice(0, eventIndex);
  const after = spans.slice(eventIndex + 1);
  let actor: Placed | undefined;
  let object: Placed | undefined;
  if (hasTag(event.tags, 'Passive')) {
    object = lastNoun(before, concepts);
    const by = after.findIndex((span) => wordOf(span) === 'by');
    if (by >= 0) actor = firstNoun(after.slice(by + 1), concepts);
  } else {
    actor = lastNoun(before, concepts);
    const window = objectWindow(after);
    object = firstNoun(window, concepts);
    const pronoun = object === undefined ? window.find((span) => ANAPHORA.has(wordOf(span))) : undefined;
    const antecedent = previous?.frame.roles.object;
    if (pronoun !== undefined && antecedent !== undefined && antecedent.latest.value !== 'unknown') {
      roles.object = field(copyRole(antecedent.latest.value), [...antecedent.latest.dependsOn, pronoun.id]);
    } else if (object === undefined && actor !== undefined) {
      object = actor;
      actor = undefined;
    }
  }
  if (object !== undefined) roles.object = conceptField(object);
  if (actor !== undefined) roles.actor = conceptField(actor);
  else if ((startsWithConjunction(segment) || segment.marker === 'then') && previous !== undefined && previous.frame.roles.actor.latest.value !== 'unknown') {
    roles.actor = copyField(previous.frame.roles.actor);
  }
  roles.result = resultField(event, after, concepts);
  return draft;
}

function resultField(event: LiveSpan, after: readonly LiveSpan[], concepts: readonly Concept[]): Field {
  const link = after.findIndex((span) => RESULT_LINKS.has(wordOf(span)));
  if (link >= 0) {
    for (const span of after.slice(link + 1)) {
      const concept = conceptOf(span, concepts);
      if (concept !== undefined) return conceptField({ span, concept });
    }
  }
  if (event.participle === undefined || event.participle === '') return unknownField();
  return field({ text: event.participle, refs: [] }, [event.id]);
}

function objectWindow(after: readonly LiveSpan[]): LiveSpan[] {
  const window: LiveSpan[] = [];
  for (const span of after) {
    const word = wordOf(span);
    if (RESULT_LINKS.has(word) || CONDITION_MARKERS.has(word) || word === 'then') break;
    window.push(span);
  }
  return window;
}

function conditionTarget(drafts: readonly Draft[], index: number): Draft | undefined {
  for (let next = index + 1; next < drafts.length; next += 1) {
    const draft = drafts[next];
    if (draft !== undefined && !isCondition(draft)) return draft;
  }
  for (let back = index - 1; back >= 0; back -= 1) {
    const draft = drafts[back];
    if (draft !== undefined && !isCondition(draft)) return draft;
  }
  return undefined;
}

function isCondition(draft: Draft): boolean {
  return draft.frame.marker !== undefined && CONDITION_MARKERS.has(draft.frame.marker);
}

function whenPart(source: Draft, marker: LiveSpan): WhenPart {
  const dependsOn = [marker.id];
  const evidence = source.event ?? source.lead;
  if (evidence !== undefined && evidence.id !== marker.id) dependsOn.push(evidence.id);
  return { ref: source.frame.id, text: source.frame.clause.text, dependsOn };
}

function pushWhen(whens: Map<Draft, WhenPart[]>, target: Draft, part: WhenPart): void {
  const list = whens.get(target) ?? [];
  list.push(part);
  whens.set(target, list);
}

function whenField(parts: readonly WhenPart[]): Field {
  if (parts.length === 0) return unknownField();
  const refs: string[] = [];
  const texts: string[] = [];
  const dependsOn: string[] = [];
  for (const part of parts) {
    refs.push(part.ref);
    texts.push(part.text);
    for (const id of part.dependsOn) {
      if (!dependsOn.includes(id)) dependsOn.push(id);
    }
  }
  return field({ text: texts.join(' and '), refs }, dependsOn);
}

function lastNoun(spans: readonly LiveSpan[], concepts: readonly Concept[]): Placed | undefined {
  let found: Placed | undefined;
  for (const span of spans) {
    const concept = nounConcept(span, concepts);
    if (concept !== undefined) found = { span, concept };
  }
  return found;
}

function firstNoun(spans: readonly LiveSpan[], concepts: readonly Concept[]): Placed | undefined {
  for (const span of spans) {
    const concept = nounConcept(span, concepts);
    if (concept !== undefined) return { span, concept };
  }
  return undefined;
}

function nounConcept(span: LiveSpan, concepts: readonly Concept[]): Concept | undefined {
  if (!hasTag(span.tags, 'Noun') || hasTag(span.tags, 'Pronoun')) return undefined;
  return conceptOf(span, concepts);
}

function conceptOf(span: LiveSpan, concepts: readonly Concept[]): Concept | undefined {
  if (span.insignificant === true || span.entityId === undefined) return undefined;
  return findConcept(concepts, span.entityId);
}

function conceptField(placed: Placed): Field {
  return field({ text: placed.concept.canonical, refs: [placed.concept.id] }, [placed.span.id]);
}

/** "a shipped package": a verb between a determiner and a noun reads as an adjective. */
function isAdjectival(spans: readonly LiveSpan[], span: LiveSpan): boolean {
  const index = spans.indexOf(span);
  const previous = spans[index - 1];
  const next = spans[index + 1];
  if (previous === undefined || next === undefined) return false;
  return hasTag(previous.tags, 'Determiner') && hasTag(next.tags, 'Noun');
}

function field(value: Role, dependsOn: string[]): Field {
  return { original: { value, dependsOn }, latest: { value: copyRole(value), dependsOn: dependsOn.slice() }, history: [] };
}

export function copyField(source: Field): Field {
  const history: Revision<FieldVersion>[] = [];
  for (const revision of source.history) {
    const entry: Revision<FieldVersion> = { at: revision.at, who: revision.who, reason: revision.reason, value: copyVersion(revision.value) };
    if (revision.finding !== undefined) entry.finding = revision.finding;
    if (revision.comment !== undefined) entry.comment = revision.comment;
    history.push(entry);
  }
  return { original: copyVersion(source.original), latest: copyVersion(source.latest), history };
}

export function copyVersion(version: FieldVersion): FieldVersion {
  return { value: copyRole(version.value), dependsOn: version.dependsOn.slice() };
}

export function copyRole(role: Role): Role {
  return role === 'unknown' ? 'unknown' : { text: role.text, refs: role.refs.slice() };
}

function copyClause(clause: ClauseBound): ClauseBound {
  return { text: clause.text, start: clause.start, end: clause.end };
}

function sameFrame(left: Frame, right: Frame): boolean {
  if (left.id !== right.id || left.sentence !== right.sentence || left.marker !== right.marker || left.negated !== right.negated) return false;
  if (left.notTransition?.reason !== right.notTransition?.reason || left.notTransition?.who !== right.notTransition?.who) return false;
  if (left.clause.text !== right.clause.text || left.clause.start !== right.clause.start || left.clause.end !== right.clause.end) return false;
  for (const name of ROLE_NAMES) {
    if (!sameField(left.roles[name], right.roles[name])) return false;
  }
  return sameHistory(left.history, right.history, (a, b) => a.notTransition?.reason === b.notTransition?.reason);
}

function sameField(left: Field, right: Field): boolean {
  if (!sameVersion(left.original, right.original) || !sameVersion(left.latest, right.latest)) return false;
  return sameHistory(left.history, right.history, sameVersion);
}

export function sameHistory<T>(left: readonly Revision<T>[], right: readonly Revision<T>[], same: (a: T, b: T) => boolean): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.at !== b.at || a.who !== b.who || a.reason !== b.reason || a.finding !== b.finding || a.comment !== b.comment) return false;
    if (!same(a.value, b.value)) return false;
  }
  return true;
}

export function sameVersion(left: FieldVersion, right: FieldVersion): boolean {
  return sameRole(left.value, right.value) && sameList(left.dependsOn, right.dependsOn);
}

function sameRole(left: Role, right: Role): boolean {
  if (left === 'unknown' || right === 'unknown') return left === right;
  return left.text === right.text && sameList(left.refs, right.refs);
}

export function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
