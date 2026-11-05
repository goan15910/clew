// Use case: derive concepts from the live spans, link each span to its concept, and list them.
import { deriveConcepts, sameConcepts } from '../domain/spec-concepts.js';
import { rebuildLayers } from '../domain/spec-frames.js';
import { sameSpans } from '../domain/spec-spans.js';
import { liveSentences, type SpecSnapshot } from '../domain/spec.js';
import type { Outcome, SpecConceptsDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { conceptViews } from './spec-views.js';

export interface ListConceptsCommand {
  sessionId?: string;
}

export const NO_TOKENS = 'no tokens; run clew spec tag first';

export function listConcepts(command: ListConceptsCommand, store: SpecStore): Outcome<SpecConceptsDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if ((current.spans ?? []).length === 0) {
      problem = NO_TOKENS;
      return undefined;
    }
    const layers = current.frames === undefined
      ? deriveConcepts(current.spans ?? [])
      : rebuildLayers(liveSentences(current.sentences), current.spans ?? [], current);
    if (sameConcepts(current.concepts, layers.concepts) && sameSpans(current.spans, layers.spans)) return undefined;
    const now = new Date().toISOString();
    const snapshot = withLayers(current, now, layers);
    const ids: string[] = [];
    for (const concept of layers.concepts ?? []) ids.push(concept.id);
    return {
      snapshot,
      history: { at: now, command: 'spec.concepts.list', args: { session: current.id }, before: conceptIds(current), after: ids },
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  return {
    exit: 'pass',
    document: {
      command: 'spec.concepts.list',
      ok: true,
      session: result.snapshot.id,
      concepts: conceptViews(result.snapshot.concepts ?? [], result.snapshot.spans ?? []),
      findings: [],
      issues: [],
    },
  };
}

export function withLayers(
  current: SpecSnapshot,
  updated: string,
  layers: Pick<SpecSnapshot, 'concepts' | 'frames'> & { spans: NonNullable<SpecSnapshot['spans']> },
): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
    spans: layers.spans,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  const concepts = layers.concepts ?? current.concepts;
  if (concepts !== undefined) snapshot.concepts = concepts;
  const frames = layers.frames ?? current.frames;
  if (frames !== undefined) snapshot.frames = frames;
  if (current.graph !== undefined) snapshot.graph = current.graph;
  return snapshot;
}

function conceptIds(snapshot: SpecSnapshot): string[] {
  const ids: string[] = [];
  for (const concept of snapshot.concepts ?? []) ids.push(concept.id);
  return ids;
}

function invalid(fault: SpecConceptsDocument['fault'], message: string): Outcome<SpecConceptsDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.concepts.list', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
