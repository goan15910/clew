// Use case: the agent splits or groups the proposed paths.
import { graphLayerFindings, groupFlows, sameGraph, splitFlow, type GroupRequest } from '../domain/spec-graph.js';
import { hasBlocking, type Finding, type SpecSnapshot } from '../domain/spec.js';
import type { Outcome, SpecGraphDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { flowViews, graphView } from './spec-views.js';

export type EditGraphCommand =
  | { action: 'split'; sessionId?: string; id: string; at: string }
  | ({ action: 'group'; sessionId?: string } & GroupRequest);

export function editGraph(command: EditGraphCommand, store: SpecStore): Outcome<SpecGraphDocument> {
  const commandName = `spec.graph.${command.action}` as SpecGraphDocument['command'];
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);
  let problem: string | undefined;
  let findings: Finding[] = [];
  let changed: string[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.graph === undefined) {
      problem = 'no graph; run clew spec graph build first';
      return undefined;
    }
    const edited = command.action === 'split'
      ? splitFlow(current.graph, command.id, command.at)
      : groupFlows(current.graph, command);
    if (edited.problem !== undefined) {
      problem = edited.problem;
      return undefined;
    }
    const next = edited.graph === undefined ? current : replaceGraph(current, edited.graph);
    findings = [...edited.findings, ...graphLayerFindings(next)];
    changed = edited.changed;
    if (edited.graph === undefined || sameGraph(current.graph, edited.graph)) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.graph = edited.graph;
    const args: { session: string; id?: string; ids?: string[]; into?: string; at?: string; title?: string } = { session: current.id };
    if (command.action === 'split') {
      args.id = command.id;
      args.at = command.at;
    } else {
      if (command.flowIds !== undefined && command.flowIds.length > 0) args.ids = command.flowIds.slice();
      else if (command.transitionIds !== undefined) args.ids = command.transitionIds.slice();
      if (command.into !== undefined) args.into = command.into;
      if (command.title !== undefined) args.title = command.title;
    }
    return {
      snapshot,
      history: { at: now, command: commandName, args, before: changed, after: changed },
    };
  });
  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(commandName, 'session', problem);
  const body: SpecGraphDocument = {
    command: commandName,
    ok: true,
    session: result.snapshot.id,
    findings,
    issues: [],
  };
  if (result.snapshot.graph !== undefined) {
    body.graph = graphView(result.snapshot.graph);
    body.flows = flowViews(result.snapshot.graph.flows);
  }
  if (changed.length > 0) body.changed = changed;
  return { exit: hasBlocking(findings) ? 'fail' : 'pass', document: body };
}

function replaceGraph(current: SpecSnapshot, graph: NonNullable<SpecSnapshot['graph']>): SpecSnapshot {
  return {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specPath: current.specPath,
    specHash: current.specHash,
    created: current.created,
    updated: current.updated,
    sentences: current.sentences,
    tagged: current.tagged,
    entities: current.entities,
    facts: current.facts,
    graph,
    tagger: current.tagger,
  };
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot = replaceGraph(current, current.graph ?? { objects: [], states: [], transitions: [], flows: [] });
  snapshot.updated = updated;
  if (current.graph !== undefined) snapshot.graph = current.graph;
  if (current.tagger === undefined) delete snapshot.tagger;
  if (current.entities === undefined) delete snapshot.entities;
  if (current.facts === undefined) delete snapshot.facts;
  return snapshot;
}

function invalid(command: SpecGraphDocument['command'], fault: SpecGraphDocument['fault'], message: string): Outcome<SpecGraphDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
