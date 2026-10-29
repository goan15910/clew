// Plain document views. Built field by field from domain objects.
import type { UniqueToken } from '../domain/spec-query.js';
import type { DraftGraph, Entity, Fact, LiveSpan, Sentence, SpecFlow, TaggedSentence, Token } from '../domain/spec.js';
import { visibleFacts } from '../domain/spec-facts.js';
import type {
  SpecEntityView,
  SpecFactView,
  SpecFlowView,
  SpecGraphView,
  SpecSpanView,
  SpecTaggedView,
  SpecTokenReadingView,
  SpecTokenView,
  SpecUniqueTokenView,
} from './documents.js';

export function taggedViews(sentences: readonly Sentence[], tagged: readonly TaggedSentence[]): SpecTaggedView[] {
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

function tokenView(token: Token): SpecTokenView {
  const tags: string[] = [];
  for (const tag of token.tags) tags.push(tag);
  return {
    id: token.id,
    text: token.text,
    tags,
    span: [token.span[0], token.span[1]],
    origin: token.origin,
  };
}

export function spanViews(spans: readonly LiveSpan[]): SpecSpanView[] {
  const views: SpecSpanView[] = [];
  for (const span of spans) {
    const tags: string[] = [];
    for (const tag of span.tags) tags.push(tag);
    const view: SpecSpanView = {
      id: span.id,
      firstTokenId: span.firstTokenId,
      lastTokenId: span.lastTokenId,
      surface: span.surface,
      tags,
      origin: span.origin,
      explicitlySet: span.explicitlySet,
      entityLinkExplicitlySet: span.entityLinkExplicitlySet,
    };
    if (span.lexiconEntryId !== undefined) view.lexiconEntryId = span.lexiconEntryId;
    if (span.entityId !== undefined) view.entityId = span.entityId;
    if (span.insignificant !== undefined) view.insignificant = span.insignificant;
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

export function entityView(entity: Entity): SpecEntityView {
  const sources: string[] = [];
  for (const source of entity.sources) sources.push(source);
  const view: SpecEntityView = {
    id: entity.id,
    kind: entity.kind,
    sources,
    origin: entity.origin,
    status: entity.status,
  };
  if (entity.name !== undefined) view.name = entity.name;
  if (entity.text !== undefined) view.text = entity.text;
  if (entity.status === 'stale' && entity.review !== undefined) view.review = entity.review;
  if (entity.note !== undefined) view.note = entity.note;
  return view;
}

export function entityViews(entities: readonly Entity[]): SpecEntityView[] {
  const views: SpecEntityView[] = [];
  for (const entity of entities) views.push(entityView(entity));
  return views;
}

export function factView(fact: Fact): SpecFactView {
  const sources: string[] = [];
  for (const source of fact.sources) sources.push(source);
  const view: SpecFactView = {
    id: fact.id,
    type: fact.type,
    origin: fact.origin,
    confidence: fact.confidence,
    sources,
    status: fact.status,
  };
  if (fact.actor !== undefined) view.actor = fact.actor;
  if (fact.action !== undefined) view.action = fact.action;
  if (fact.object !== undefined) view.object = fact.object;
  if (fact.from !== undefined) view.from = fact.from;
  if (fact.to !== undefined) view.to = fact.to;
  if (fact.condition !== undefined) view.condition = fact.condition;
  if (fact.state !== undefined) view.state = fact.state;
  if (fact.note !== undefined) view.note = fact.note;
  return view;
}

export function factViews(facts: readonly Fact[]): SpecFactView[] {
  const views: SpecFactView[] = [];
  for (const fact of visibleFacts(facts)) views.push(factView(fact));
  return views;
}

export function graphView(graph: DraftGraph): SpecGraphView {
  const objects: string[] = [];
  for (const object of graph.objects) objects.push(object);
  const states: SpecGraphView['states'] = [];
  for (const state of graph.states) {
    const facts: string[] = [];
    for (const fact of state.facts) facts.push(fact);
    const view: SpecGraphView['states'][number] = { id: state.id, object: state.object, facts };
    if (state.initial === true) view.initial = true;
    if (state.final === true) view.final = true;
    states.push(view);
  }
  const transitions: SpecGraphView['transitions'] = [];
  for (const transition of graph.transitions) {
    const facts: string[] = [];
    for (const fact of transition.facts) facts.push(fact);
    const view: SpecGraphView['transitions'][number] = {
      id: transition.id,
      from: transition.from,
      event: transition.event,
      to: transition.to,
      object: transition.object,
      fact: transition.fact,
      facts,
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
