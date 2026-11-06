// Plain document views. Built field by field from domain objects.
import type { UniqueToken } from '../domain/spec-query.js';
import type { CompiledItem } from '../domain/spec-actions.js';
import type { ClauseReach } from '../domain/spec-kernel.js';
import { sentenceState, type Concept, type DraftGraph, type Frame, type Grouping, type LiveSentence, type LiveSpan, type Sentence, type SpecFlow, type TaggedSentence, type Token } from '../domain/spec.js';
import { copyFrame } from '../domain/spec-frames.js';
import { copyGrouping } from '../domain/spec-refine.js';
import { sentenceIdOfToken } from '../domain/spec-spans.js';
import type {
  ClauseReachView,
  ConceptView,
  FrameCompiledView,
  FrameReachView,
  FrameView,
  SpecSentenceContextView,
  SpecFlowView,
  SpecGraphView,
  SpecSpanView,
  SpecTaggedView,
  SpecTokenReadingView,
  SpecTokenView,
  SpecUniqueTokenView,
} from './documents.js';

export function taggedViews(sentences: readonly LiveSentence[], tagged: readonly TaggedSentence[]): SpecTaggedView[] {
  const byId = new Map<string, TaggedSentence>();
  for (const item of tagged) byId.set(item.id, item);
  const views: SpecTaggedView[] = [];
  for (const sentence of sentences) {
    const item = byId.get(sentence.id);
    const clauses: string[] = [];
    const tokens: SpecTokenView[] = [];
    if (item !== undefined) {
      for (const clause of item.clauses) clauses.push(clause);
      for (const token of item.tokens) tokens.push(tokenView(token));
    }
    views.push({
      id: sentence.id,
      text: sentence.text,
      section: sentence.section,
      clauses,
      tokens,
    });
  }
  return views;
}

export function sentenceContextViews(
  sentences: readonly Sentence[],
  workflows: ReadonlyMap<string, readonly SpecFlow[]>,
): SpecSentenceContextView[] {
  const views: SpecSentenceContextView[] = [];
  for (const sentence of sentences) {
    const flows: { id: string; title: string }[] = [];
    for (const flow of workflows.get(sentence.id) ?? []) flows.push({ id: flow.id, title: flow.title });
    const shown = sentence.latest ?? sentence.original;
    const state = sentenceState(sentence);
    const view: SpecSentenceContextView = { id: sentence.id, text: shown?.text ?? '', section: shown?.section ?? '', state, workflows: flows };
    if (state === 'edited' && sentence.original !== null) view.original = sentence.original.text;
    views.push(view);
  }
  return views;
}

function tokenView(token: Token): SpecTokenView {
  const tags: string[] = [];
  for (const tag of token.tags) tags.push(tag);
  const view: SpecTokenView = {
    id: token.id,
    text: token.text,
    tags,
    span: [token.span[0], token.span[1]],
    origin: token.origin,
  };
  if (token.skipped === true) view.skipped = true;
  return view;
}

export function spanViews(spans: readonly LiveSpan[]): SpecSpanView[] {
  const views: SpecSpanView[] = [];
  for (const span of spans) {
    const tags: string[] = [];
    for (const tag of span.tags) tags.push(tag);
    const view: SpecSpanView = {
      id: span.id,
      sentence: sentenceIdOfToken(span.firstTokenId) ?? '',
      firstTokenId: span.firstTokenId,
      lastTokenId: span.lastTokenId,
      range: [span.range[0], span.range[1]],
      surface: span.surface,
      tags,
      origin: span.origin,
      explicitlySet: span.explicitlySet,
      entityLinkExplicitlySet: span.entityLinkExplicitlySet,
      clause: { text: span.clause.text, start: span.clause.start, end: span.clause.end },
    };
    if (span.lexiconEntryId !== undefined) view.lexiconEntryId = span.lexiconEntryId;
    if (span.entityId !== undefined) view.entityId = span.entityId;
    if (span.insignificant !== undefined) view.insignificant = span.insignificant;
    if (span.lemma !== undefined) view.lemma = span.lemma;
    views.push(view);
  }
  return views;
}

export function uniqueTokenViews(tokens: readonly UniqueToken[]): SpecUniqueTokenView[] {
  const views: SpecUniqueTokenView[] = [];
  for (const token of tokens) {
    const forms: string[] = [];
    for (const form of token.forms) forms.push(form);
    const readings: SpecTokenReadingView[] = [];
    for (const reading of token.readings) {
      const tags: string[] = [];
      for (const tag of reading.tags) tags.push(tag);
      const ids: string[] = [];
      for (const id of reading.tokens) ids.push(id);
      readings.push({ tags, tokens: ids });
    }
    views.push({ text: token.text, count: token.count, forms, readings });
  }
  return views;
}

export function conceptViews(concepts: readonly Concept[], spans: readonly LiveSpan[]): ConceptView[] {
  const byId = new Map<string, LiveSpan>();
  for (const span of spans) byId.set(span.id, span);
  const views: ConceptView[] = [];
  for (const concept of concepts) {
    const members: ConceptView['members'] = [];
    for (const id of concept.members) {
      const span = byId.get(id);
      members.push({ span: id, surface: span?.surface ?? '', sentence: sentenceIdOfToken(span?.firstTokenId ?? '') ?? '' });
    }
    views.push({ id: concept.id, canonical: concept.canonical, members });
  }
  return views;
}

export function groupViews(groups: readonly Grouping[]): Grouping[] {
  return groups.map(copyGrouping);
}

export function frameViews(
  frames: readonly Frame[],
  items: readonly CompiledItem[],
  restated: Readonly<Record<string, string>>,
  reach: readonly ClauseReach[] = [],
): FrameView[] {
  const reached = new Map<string, FrameReachView>();
  for (const entry of reach) reached.set(entry.frame, reachView(entry));
  const compiled = new Map<string, FrameCompiledView>();
  for (const item of items) {
    if (item.kind === 'action' && item.overlay !== undefined) {
      const view: FrameCompiledView = { event: item.event, object: item.overlay.object, to: item.overlay.to, actor: item.overlay.actor ?? '', kind: 'action' };
      if (item.overlay.from !== undefined) view.from = item.overlay.from;
      compiled.set(item.id, view);
    } else if (item.kind === 'forbidden' && item.event !== undefined && item.object !== undefined && item.attempted !== undefined) {
      compiled.set(item.id, { event: item.event, object: item.object, to: item.attempted, actor: item.actor ?? '', kind: 'forbidden' });
    }
  }
  const views: FrameView[] = [];
  for (const frame of frames) {
    const view: FrameView = copyFrame(frame);
    const item = compiled.get(restated[frame.id] ?? frame.id);
    if (item !== undefined) view.compiled = item;
    const found = reached.get(restated[frame.id] ?? frame.id);
    if (found !== undefined) view.reach = found;
    views.push(view);
  }
  return views;
}

export function clauseViews(reach: readonly ClauseReach[], frames: readonly Frame[]): ClauseReachView[] {
  const sentences = new Map<string, string>();
  for (const frame of frames) sentences.set(frame.id, frame.sentence);
  const views: ClauseReachView[] = [];
  for (const entry of reach) {
    views.push({ frame: entry.frame, sentence: sentences.get(entry.frame) ?? '', event: entry.event, ...reachView(entry) });
  }
  return views;
}

function reachView(entry: ClauseReach): FrameReachView {
  const view: FrameReachView = { status: entry.status };
  if (entry.witness !== undefined) view.witness = entry.witness.slice();
  if (entry.blockedBy !== undefined) view.blockedBy = entry.blockedBy.slice();
  return view;
}

export function graphView(graph: DraftGraph): SpecGraphView {
  const objects: string[] = [];
  for (const object of graph.objects) objects.push(object);
  const states: SpecGraphView['states'] = [];
  for (const state of graph.states) {
    const frames: string[] = [];
    for (const frame of state.frames) frames.push(frame);
    const view: SpecGraphView['states'][number] = { id: state.id, object: state.object, frames };
    if (state.initial === true) view.initial = true;
    if (state.final === true) view.final = true;
    states.push(view);
  }
  const transitions: SpecGraphView['transitions'] = [];
  for (const transition of graph.transitions) {
    const frames: string[] = [];
    for (const frame of transition.frames) frames.push(frame);
    const view: SpecGraphView['transitions'][number] = {
      id: transition.id,
      from: transition.from,
      event: transition.event,
      to: transition.to,
      object: transition.object,
      frame: transition.frame,
      frames,
    };
    if (transition.actor !== undefined) view.actor = transition.actor;
    if (transition.guard !== undefined) view.guard = transition.guard;
    transitions.push(view);
  }
  return { objects, states, transitions };
}

export function flowViews(flows: readonly SpecFlow[]): SpecFlowView[] {
  const views: SpecFlowView[] = [];
  for (const flow of flows) {
    const transitions: string[] = [];
    for (const id of flow.transitions) transitions.push(id);
    const view: SpecFlowView = {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      transitions,
      origin: flow.origin,
    };
    if (flow.rejectAt !== undefined) view.rejectAt = flow.rejectAt;
    if (flow.forbidden !== undefined) view.forbidden = flow.forbidden;
    views.push(view);
  }
  return views;
}
