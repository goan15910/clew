// Plain document views. Built field by field from domain objects.
import type { SpecEntityView, SpecFactView, SpecFlowView, SpecGraphView } from './documents.js';
import type { DraftGraph, Entity, Fact, SpecFlow } from '../domain/spec.js';
import { visibleFacts } from '../domain/spec-facts.js';

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
