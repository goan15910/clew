// Agent edits to entities. Facts that cite a changed id are retargeted or marked stale.
import type { Entity, EntityKind, Fact, Finding } from './spec.js';
import { copyEntity, normalizeWord } from './spec-entities.js';
import { copyFact } from './spec-facts.js';

export interface EntityChange {
  entities: Entity[];
  facts: Fact[];
  findings: Finding[];
  changed: string[];
  removed: string[];
  affected: string[];
  blocked: boolean;
  unknown?: string;
  input?: string;
}

export function mergeEntities(entities: readonly Entity[], facts: readonly Fact[], intoId: string, sourceIds: readonly string[]): EntityChange {
  const into = findEntity(entities, intoId);
  if (into === undefined) return missing(entities, facts, intoId);
  const sources: Entity[] = [];
  for (const id of sourceIds) {
    if (id === intoId) continue;
    const entity = findEntity(entities, id);
    if (entity === undefined) return missing(entities, facts, id);
    sources.push(entity);
  }
  if (sources.length === 0) return { ...blank(entities, facts), input: 'merge needs an entity id different from --into' };
  const findings: Finding[] = [];
  if (into.status === 'rejected') {
    findings.push({
      id: `rejected-target:${into.id}`,
      kind: 'gap',
      code: 'rejected-entity',
      severity: 'blocking',
      message: `${into.id} is rejected; promote it before merging into it`,
      refs: [into.id],
    });
  }
  for (const source of sources) {
    if (source.kind === into.kind) continue;
    findings.push({
      id: `merge-across-kinds:${source.id}`,
      kind: 'gap',
      code: 'merge-across-kinds',
      severity: 'blocking',
      message: `cannot merge ${source.kind} ${source.id} into ${into.kind} ${into.id}`,
      refs: [into.id, source.id],
    });
  }
  if (findings.some((finding) => finding.severity === 'blocking')) {
    return { entities: cloneEntities(entities), facts: cloneFacts(facts), findings, changed: [], removed: [], affected: [], blocked: true };
  }
  const merged = copyEntity(into);
  merged.origin = 'agent';
  const removed: string[] = [];
  for (const source of sources) {
    for (const item of source.sources) {
      if (!merged.sources.includes(item)) merged.sources.push(item);
    }
    if (merged.text === undefined && source.text !== undefined) merged.text = source.text;
    removed.push(source.id);
  }
  const nextEntities: Entity[] = [];
  for (const entity of entities) {
    if (removed.includes(entity.id)) continue;
    nextEntities.push(entity.id === into.id ? merged : copyEntity(entity));
  }
  const replaced = retarget(facts, removed, into.id);
  return {
    entities: nextEntities,
    facts: replaced.facts,
    findings,
    changed: [into.id],
    removed,
    affected: replaced.affected,
    blocked: false,
  };
}

export function renameEntity(entities: readonly Entity[], facts: readonly Fact[], id: string, name: string | undefined, text: string | undefined): EntityChange {
  const entity = findEntity(entities, id);
  if (entity === undefined) return missing(entities, facts, id);
  if (entity.kind === 'condition') {
    if (text === undefined || text.trim() === '') return { ...blank(entities, facts), input: `rename of ${id} needs --text` };
    const next = copyEntity(entity);
    next.text = text.trim();
    next.origin = 'agent';
    return replaceEntity(entities, facts, next, [], []);
  }
  if (name === undefined) return { ...blank(entities, facts), input: `rename of ${id} needs --name` };
  const normalized = normalizeWord(name);
  if (normalized.word === undefined) {
    return {
      entities: cloneEntities(entities),
      facts: cloneFacts(facts),
      findings: [{
        id: `vocabulary:${id}`,
        kind: 'vocabulary',
        code: 'vocabulary',
        severity: 'blocking',
        message: `name "${name}" is not workflow vocabulary`,
        refs: [id],
      }],
      changed: [],
      removed: [],
      affected: [],
      blocked: true,
    };
  }
  const nextId = `${entity.kind}:${normalized.word}`;
  if (nextId !== id && findEntity(entities, nextId) !== undefined) {
    return {
      entities: cloneEntities(entities),
      facts: cloneFacts(facts),
      findings: [{
        id: `duplicate-entity:${nextId}`,
        kind: 'conflict',
        code: 'duplicate-entity',
        severity: 'blocking',
        message: `${nextId} already exists`,
        refs: [id, nextId],
      }],
      changed: [],
      removed: [],
      affected: [],
      blocked: true,
    };
  }
  const next = copyEntity(entity);
  next.id = nextId;
  next.name = normalized.word;
  next.origin = 'agent';
  const findings: Finding[] = [];
  if (normalized.changed) {
    findings.push({
      id: `normalized-name:${nextId}`,
      kind: 'vocabulary',
      code: 'normalized-name',
      severity: 'info',
      message: `name normalized to ${normalized.word}`,
      refs: [nextId],
    });
  }
  const replaced = replaceEntity(entities, facts, next, nextId === id ? [] : [id], findings);
  if (nextId !== id) {
    const retargeted = retarget(replaced.facts, [id], nextId);
    replaced.facts = retargeted.facts;
    replaced.affected = retargeted.affected;
    replaced.removed = [id];
    replaced.changed = [nextId];
  }
  return replaced;
}

export function rejectEntity(entities: readonly Entity[], facts: readonly Fact[], id: string, reason: string | undefined): EntityChange {
  const entity = findEntity(entities, id);
  if (entity === undefined) return missing(entities, facts, id);
  const next = copyEntity(entity);
  next.status = 'rejected';
  delete next.review;
  next.origin = entity.origin;
  if (reason !== undefined && reason.trim() !== '') {
    const trimmed = reason.trim();
    next.note = trimmed.startsWith('agent:') ? trimmed : `agent: ${trimmed}`;
  }
  const updated = replaceEntity(entities, facts, next, [], []);
  const affected: string[] = [];
  const nextFacts: Fact[] = [];
  for (const fact of updated.facts) {
    if (fact.removed === true || !factRefs(fact).includes(id)) {
      nextFacts.push(fact);
      continue;
    }
    const stale = copyFact(fact);
    stale.status = 'stale';
    nextFacts.push(stale);
    affected.push(stale.id);
  }
  updated.facts = nextFacts;
  updated.affected = affected;
  if (affected.length > 0) {
    updated.findings.push({
      id: `stale-fact:${id}`,
      kind: 'stale',
      code: 'stale-fact',
      severity: 'warning',
      message: `facts citing ${id} are stale because it was rejected`,
      refs: [id, ...affected],
    });
  }
  return updated;
}

export function promoteEntity(entities: readonly Entity[], facts: readonly Fact[], id: string, kind: EntityKind | undefined): EntityChange {
  const entity = findEntity(entities, id);
  if (entity === undefined) return missing(entities, facts, id);
  const next = copyEntity(entity);
  next.status = 'confirmed';
  delete next.review;
  if (kind === undefined || kind === entity.kind) {
    return replaceEntity(entities, facts, next, [], []);
  }
  if (entity.kind === 'condition' || kind === 'condition' || next.name === undefined) {
    return {
      entities: cloneEntities(entities),
      facts: cloneFacts(facts),
      findings: [{
        id: `merge-across-kinds:${id}`,
        kind: 'gap',
        code: 'merge-across-kinds',
        severity: 'blocking',
        message: `cannot promote ${entity.kind} ${id} to ${kind}`,
        refs: [id],
      }],
      changed: [],
      removed: [],
      affected: [],
      blocked: true,
    };
  }
  const nextId = `${kind}:${next.name}`;
  if (findEntity(entities, nextId) !== undefined) {
    return {
      entities: cloneEntities(entities),
      facts: cloneFacts(facts),
      findings: [{
        id: `duplicate-entity:${nextId}`,
        kind: 'conflict',
        code: 'duplicate-entity',
        severity: 'blocking',
        message: `${nextId} already exists`,
        refs: [id, nextId],
      }],
      changed: [],
      removed: [],
      affected: [],
      blocked: true,
    };
  }
  next.id = nextId;
  next.kind = kind;
  next.origin = 'agent';
  const replaced = replaceEntity(entities, facts, next, [id], []);
  const retargeted = retarget(replaced.facts, [id], nextId);
  replaced.facts = retargeted.facts;
  replaced.affected = retargeted.affected;
  replaced.removed = [id];
  replaced.changed = [nextId];
  return replaced;
}

function replaceEntity(entities: readonly Entity[], facts: readonly Fact[], next: Entity, drop: readonly string[], findings: Finding[]): EntityChange {
  const nextEntities: Entity[] = [];
  for (const entity of entities) {
    if (drop.includes(entity.id)) continue;
    if (entity.id === next.id || entity.id === drop[0]) nextEntities.push(next);
    else nextEntities.push(copyEntity(entity));
  }
  if (!nextEntities.some((entity) => entity.id === next.id)) nextEntities.push(next);
  return {
    entities: nextEntities,
    facts: cloneFacts(facts),
    findings,
    changed: [next.id],
    removed: [],
    affected: [],
    blocked: false,
  };
}

function retarget(facts: readonly Fact[], fromIds: readonly string[], toId: string): { facts: Fact[]; affected: string[] } {
  const affected: string[] = [];
  const next: Fact[] = [];
  for (const fact of facts) {
    const copy = copyFact(fact);
    let changed = false;
    if (copy.actor !== undefined && fromIds.includes(copy.actor)) { copy.actor = toId; changed = true; }
    if (copy.action !== undefined && fromIds.includes(copy.action)) { copy.action = toId; changed = true; }
    if (copy.object !== undefined && fromIds.includes(copy.object)) { copy.object = toId; changed = true; }
    if (copy.condition !== undefined && fromIds.includes(copy.condition)) { copy.condition = toId; changed = true; }
    if (changed) affected.push(copy.id);
    next.push(copy);
  }
  return { facts: next, affected };
}

function missing(entities: readonly Entity[], facts: readonly Fact[], id: string): EntityChange {
  return { ...blank(entities, facts), unknown: id };
}

function blank(entities: readonly Entity[], facts: readonly Fact[]): EntityChange {
  return {
    entities: cloneEntities(entities),
    facts: cloneFacts(facts),
    findings: [],
    changed: [],
    removed: [],
    affected: [],
    blocked: false,
  };
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function cloneEntities(entities: readonly Entity[]): Entity[] {
  const clone: Entity[] = [];
  for (const entity of entities) clone.push(copyEntity(entity));
  return clone;
}

function cloneFacts(facts: readonly Fact[]): Fact[] {
  const clone: Fact[] = [];
  for (const fact of facts) clone.push(copyFact(fact));
  return clone;
}

function factRefs(fact: Fact): string[] {
  const refs: string[] = [];
  if (fact.actor !== undefined) refs.push(fact.actor);
  if (fact.action !== undefined) refs.push(fact.action);
  if (fact.object !== undefined) refs.push(fact.object);
  if (fact.condition !== undefined) refs.push(fact.condition);
  return refs;
}
