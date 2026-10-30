import { currentSentences, type SpecSnapshot } from '../domain/spec.js';
import { sentenceWorkflows, uniqueTokens } from '../domain/spec-query.js';
import type { Outcome, SpecFault, SpecShowDocument, SpecShowLayer } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { entityViews, factViews, sentenceContextViews, spanViews, taggedViews, uniqueTokenViews } from './spec-views.js';

export interface ShowSpecCommand {
  layer: SpecShowLayer;
  sessionId?: string;
}

type Need = 'tag' | 'spans' | 'entities' | 'facts';

const NEEDS: Record<SpecShowLayer, readonly Need[]> = {
  sentences: [],
  tagged: ['tag'],
  tokens: ['tag'],
  spans: ['tag', 'spans'],
  entities: ['tag', 'entities'],
  facts: ['tag', 'entities', 'facts'],
};

const PRODUCER: Record<Need, string> = {
  tag: 'no tokens; run clew spec tag first',
  spans: 'no spans; run clew spec tag again to promote tokens into spans',
  entities: 'no entities; run clew spec entities list first',
  facts: 'no facts; run clew spec facts propose first',
};

export function showSpec(command: ShowSpecCommand, store: SpecStore): Outcome<SpecShowDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(command.layer, 'session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(command.layer, result.fault === 'missing' ? 'session' : result.fault, result.message);
  const problem = unmet(result.snapshot, command.layer);
  if (problem !== undefined) return invalid(command.layer, 'session', problem);
  return { exit: 'pass', document: shown(command.layer, result.snapshot) };
}

function unmet(snapshot: SpecSnapshot, layer: SpecShowLayer): string | undefined {
  for (const need of NEEDS[layer]) {
    if (!written(snapshot, need)) return PRODUCER[need];
  }
  return undefined;
}

function written(snapshot: SpecSnapshot, need: Need): boolean {
  switch (need) {
    case 'tag':
      return tagLayerWritten(snapshot);
    case 'spans':
      return snapshot.spans !== undefined;
    case 'entities':
      return snapshot.entities !== undefined;
    case 'facts':
      return snapshot.facts !== undefined;
  }
}

function tagLayerWritten(snapshot: SpecSnapshot): boolean {
  if (snapshot.tagger !== undefined) return true;
  for (const item of snapshot.tagged) {
    if (item.tokens.length > 0) return true;
  }
  return false;
}

function shown(layer: SpecShowLayer, snapshot: SpecSnapshot): SpecShowDocument {
  const base = { ok: true as const, session: snapshot.id, findings: [], issues: [] };
  switch (layer) {
    case 'sentences':
      return { ...base, command: 'spec.show.sentences', sentences: sentenceContextViews(snapshot.sentences, sentenceWorkflows(snapshot)) };
    case 'tagged':
      return { ...base, command: 'spec.show.tagged', sentences: taggedViews(currentSentences(snapshot.sentences), snapshot.tagged) };
    case 'tokens':
      return { ...base, command: 'spec.show.tokens', tokens: uniqueTokenViews(uniqueTokens(snapshot.sentences, snapshot.tagged)) };
    case 'spans':
      return { ...base, command: 'spec.show.spans', spans: spanViews(snapshot.spans ?? []) };
    case 'entities':
      return { ...base, command: 'spec.show.entities', entities: entityViews(snapshot.entities ?? []) };
    case 'facts':
      return { ...base, command: 'spec.show.facts', facts: factViews(snapshot.facts ?? []) };
  }
}

function invalid(layer: SpecShowLayer, fault: SpecFault, message: string): Outcome<SpecShowDocument> {
  const document = { ok: false as const, fault, findings: [], issues: [specInput(undefined, message)] };
  return { exit: 'invalid', document: { ...document, command: `spec.show.${layer}` } };
}
