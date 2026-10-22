// Plain document views. Built field by field from domain objects.
import type { SpecEntityView, SpecFactView } from './documents.js';
import type { Entity, Fact } from '../domain/spec.js';
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
