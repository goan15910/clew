import type { Fact } from '../../../src/domain/spec.js';
import { predicateFromScalars } from '../../../src/domain/spec-facts.js';
import { patchFromScalars, type JsonScalar } from '../../../src/domain/valuation.js';

export function storedFacts(raw: unknown[]): Fact[] {
  const facts: Fact[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const fact = storedFact(item as Record<string, unknown>);
    if (fact !== undefined) facts.push(fact);
  }
  return facts;
}

function storedFact(raw: Record<string, unknown>): Fact | undefined {
  const sources: string[] = [];
  if (Array.isArray(raw.sources)) {
    for (const source of raw.sources) {
      if (typeof source === 'string') sources.push(source);
    }
  }
  const origin = raw.origin;
  const status = raw.status;
  if (origin !== 'tagger' && origin !== 'rule' && origin !== 'agent') return undefined;
  if (status !== 'current' && status !== 'stale') return undefined;
  if (typeof raw.id !== 'string' || typeof raw.confidence !== 'number') return undefined;
  if (raw.kind === 'action') {
    if (typeof raw.event !== 'string' || typeof raw.actor !== 'string') return undefined;
    const when = predicateFromScalars(raw.when);
    if (when === undefined || raw.assign === null || typeof raw.assign !== 'object' || Array.isArray(raw.assign)) {
      return undefined;
    }
    const fact: Fact = {
      id: raw.id,
      kind: 'action',
      event: raw.event,
      actor: raw.actor,
      when,
      assign: patchFromScalars(raw.assign as Record<string, JsonScalar>),
      origin,
      confidence: raw.confidence,
      sources,
      status,
    };
    if (typeof raw.note === 'string') fact.note = raw.note;
    if (raw.removed === true) fact.removed = true;
    return fact;
  }
  if (raw.kind !== 'init' && raw.kind !== 'terminal' && raw.kind !== 'forbidden') return undefined;
  const fact: Fact = {
    id: raw.id,
    kind: raw.kind,
    origin,
    confidence: raw.confidence,
    sources,
    status,
  };
  if (typeof raw.actor === 'string') fact.actor = raw.actor;
  if (raw.when !== undefined) {
    const when = predicateFromScalars(raw.when);
    if (when === undefined) return undefined;
    fact.when = when;
  }
  if (raw.assign !== undefined) {
    if (raw.assign === null || typeof raw.assign !== 'object' || Array.isArray(raw.assign)) return undefined;
    fact.assign = patchFromScalars(raw.assign as Record<string, JsonScalar>);
  }
  if (typeof raw.note === 'string') fact.note = raw.note;
  if (raw.removed === true) fact.removed = true;
  return fact;
}
