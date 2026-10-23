// Use case: assemble the draft graph and a deterministic path cover.
import { buildGraph, sameGraph } from '../domain/spec-graph.js';
import { hasBlocking, type Finding, type SpecSnapshot } from '../domain/spec.js';
import type { Outcome, SpecGraphDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { flowViews, graphView } from './spec-views.js';

export interface BuildGraphCommand {
  sessionId?: string;
}

export function buildSpecGraph(command: BuildGraphCommand, store: SpecStore): Outcome<SpecGraphDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.entities === undefined) {
      problem = 'no entities; run clew spec entities list first';
      return undefined;
    }
    if (current.facts === undefined) {
      problem = 'no facts; run clew spec facts propose first';
      return undefined;
    }
    const built = buildGraph(current.entities, current.facts, current.graph);
    findings = built.findings;
    if (sameGraph(current.graph, built.graph)) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.graph = built.graph;
    const before: string[] = [];
    for (const flow of current.graph?.flows ?? []) before.push(flow.id);
    const after: string[] = [];
    for (const flow of built.graph.flows) after.push(flow.id);
    return {
      snapshot,
      history: { at: now, command: 'spec.graph.build', args: { session: current.id }, before, after },
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  return document(result.snapshot, findings, []);
}

function document(snapshot: SpecSnapshot, findings: Finding[], changed: string[]): Outcome<SpecGraphDocument> {
  const body: SpecGraphDocument = {
    command: 'spec.graph.build',
    ok: true,
    session: snapshot.id,
    findings,
    issues: [],
  };
  if (snapshot.graph !== undefined) {
    body.graph = graphView(snapshot.graph);
    body.flows = flowViews(snapshot.graph.flows);
  }
  if (changed.length > 0) body.changed = changed;
  return { exit: hasBlocking(findings) ? 'fail' : 'pass', document: body };
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specPath: current.specPath,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  if (current.entities !== undefined) snapshot.entities = current.entities;
  if (current.facts !== undefined) snapshot.facts = current.facts;
  if (current.graph !== undefined) snapshot.graph = current.graph;
  return snapshot;
}

function invalid(fault: SpecGraphDocument['fault'], message: string): Outcome<SpecGraphDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.graph.build', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
