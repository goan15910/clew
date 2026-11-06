// Use case: derive entity candidates and list them.
import { hasBlocking, type Entity, type EntityKind, type EntityStatus, type Finding, type SpecSnapshot, liveSentences } from '../domain/spec.js';
import { deriveEntities, entityFindings, sameEntities } from '../domain/spec-entities.js';
import { rebuildFacts, sameFacts } from '../domain/spec-facts.js';
import { overlayGraph } from '../domain/spec-graph.js';
import type { Outcome, SpecEntitiesDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { entityViews } from './spec-views.js';

export interface ListEntitiesCommand {
  sessionId?: string;
  kind?: EntityKind;
  status?: EntityStatus;
}

export function listEntities(command: ListEntitiesCommand, store: SpecStore): Outcome<SpecEntitiesDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let input: string | undefined;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (!hasCurrentSpans(current)) {
      input = 'no spans; run clew spec tag first';
      return undefined;
    }
    const derived = deriveEntities(liveSentences(current.sentences), current.spans ?? [], current.entities ?? []);
    const rebuilt = rebuildFacts(liveSentences(current.sentences), current.spans ?? [], derived.entities, current.facts ?? []);
    findings = [...derived.findings, ...entityFindings(filterEntities(derived.entities, command))];
    if (sameEntities(current.entities, derived.entities) && sameFacts(current.facts, rebuilt.facts)) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.entities = derived.entities;
    snapshot.facts = rebuilt.facts;
    const ids: string[] = [];
    for (const entity of derived.entities) ids.push(entity.id);
    return {
      snapshot,
      history: { at: now, command: 'spec.entities.list', args: { session: current.id }, before: [], after: ids },
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (input !== undefined) return invalid('session', input);
  const entities = filterEntities(result.snapshot.entities ?? [], command);
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.entities.list',
      ok: true,
      session: result.snapshot.id,
      entities: entityViews(entities),
      findings,
      issues: [],
    },
  };
}

function filterEntities(entities: readonly Entity[], command: ListEntitiesCommand): Entity[] {
  const filtered: Entity[] = [];
  for (const entity of entities) {
    if (command.kind !== undefined && entity.kind !== command.kind) continue;
    if (command.status !== undefined && entity.status !== command.status) continue;
    filtered.push(entity);
  }
  return filtered;
}

function hasCurrentSpans(snapshot: SpecSnapshot): boolean {
  return (snapshot.spans ?? []).length > 0;
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  if (current.spans !== undefined) snapshot.spans = current.spans;
  const overlay = overlayGraph(current.graph);
  if (overlay !== undefined) snapshot.graph = overlay;
  return snapshot;
}

function invalid(fault: SpecEntitiesDocument['fault'], message: string): Outcome<SpecEntitiesDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.entities.list',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(undefined, message)],
    },
  };
}
