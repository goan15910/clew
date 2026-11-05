// Use case: list what an edit of one sentence would drop or rebuild. Read-only.
import { impactOf } from '../domain/spec-refine.js';
import { specInput, type Outcome, type SpecImpactDocument } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface SpecImpactCommand {
  sessionId?: string;
  sentenceId: string;
}

export function readSpecImpact(command: SpecImpactCommand, store: SpecStore): Outcome<SpecImpactDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (!result.snapshot.sentences.some((sentence) => sentence.id === command.sentenceId)) {
    return invalid('session', `unknown sentence "${command.sentenceId}"`);
  }
  const impact = impactOf(result.snapshot.frames ?? [], result.snapshot.groups ?? [], command.sentenceId);
  return {
    exit: 'pass',
    document: {
      command: 'spec.impact',
      ok: true,
      session: result.snapshot.id,
      sentence: command.sentenceId,
      impact: impact.entries,
      frames: impact.frames,
      findings: [],
      issues: [],
    },
  };
}

function invalid(fault: SpecImpactDocument['fault'], message: string): Outcome<SpecImpactDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.impact', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
