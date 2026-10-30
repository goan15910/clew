// Use case: merge, rename, reject, or promote entities. The agent decides.
import { hasBlocking, type EntityKind, type SpecSnapshot } from '../domain/spec.js';
import { mergeEntities, promoteEntity, rejectEntity, renameEntity, type EntityChange } from '../domain/spec-entity-edit.js';
import type { Outcome, SpecEntitiesDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { entityViews } from './spec-views.js';

export type EditEntitiesCommand =
  | { action: 'merge'; sessionId?: string; into: string; ids: string[] }
  | { action: 'rename'; sessionId?: string; id: string; name?: string; text?: string }
  | { action: 'reject'; sessionId?: string; id: string; reason?: string }
  | { action: 'promote'; sessionId?: string; id: string; kind?: EntityKind };

export function editEntities(command: EditEntitiesCommand, store: SpecStore): Outcome<SpecEntitiesDocument> {
  const commandName = `spec.entities.${command.action}` as SpecEntitiesDocument['command'];
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);
  let problem: { fault: SpecEntitiesDocument['fault']; message: string } | undefined;
  let change: EntityChange | undefined;
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.entities === undefined) {
      problem = { fault: 'session', message: 'no entities; run clew spec entities list first' };
      return undefined;
    }
    change = applyEdit(command, current);
    if (change.unknown !== undefined) {
      problem = { fault: 'session', message: `unknown entity "${change.unknown}"` };
      return undefined;
    }
    if (change.input !== undefined) {
      problem = { fault: 'session', message: change.input };
      return undefined;
    }
    if (change.blocked) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.entities = change.entities;
    snapshot.facts = change.facts;
    const args: { session: string; id?: string; ids?: string[]; into?: string; name?: string; text?: string; kind?: string; reason?: string } = { session: current.id };
    if (command.action === 'merge') {
      args.into = command.into;
      args.ids = command.ids.slice();
    } else {
      args.id = command.id;
    }
    if (command.action === 'rename' && command.name !== undefined) args.name = command.name;
    if (command.action === 'rename' && command.text !== undefined) args.text = command.text;
    if (command.action === 'reject' && command.reason !== undefined) args.reason = command.reason;
    if (command.action === 'promote' && command.kind !== undefined) args.kind = command.kind;
    return {
      snapshot,
      history: {
        at: now,
        command: commandName,
        args,
        before: change.removed.length > 0 ? change.removed : change.changed,
        after: change.changed,
      },
    };
  });
  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(commandName, problem.fault, problem.message);
  const findings = change?.findings ?? [];
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: commandName,
      ok: true,
      session: result.snapshot.id,
      entities: entityViews(result.snapshot.entities ?? []),
      changed: change?.changed ?? [],
      removed: change?.removed ?? [],
      affected: change?.affected ?? [],
      findings,
      issues: [],
    },
  };
}

function applyEdit(command: EditEntitiesCommand, current: SpecSnapshot): EntityChange {
  const entities = current.entities ?? [];
  const facts = current.facts ?? [];
  if (command.action === 'merge') return mergeEntities(entities, facts, command.into, command.ids);
  if (command.action === 'rename') return renameEntity(entities, facts, command.id, command.name, command.text);
  if (command.action === 'reject') return rejectEntity(entities, facts, command.id, command.reason);
  return promoteEntity(entities, facts, command.id, command.kind);
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
  return snapshot;
}

function invalid(command: SpecEntitiesDocument['command'], fault: SpecEntitiesDocument['fault'], message: string): Outcome<SpecEntitiesDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
