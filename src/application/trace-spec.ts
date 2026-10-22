// Use case: follow an id back to the sentence that produced it.
import { hasBlocking } from '../domain/spec.js';
import { traceItem } from '../domain/spec-query.js';
import type { Outcome, SpecTraceDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface TraceSpecCommand {
  sessionId?: string;
  id: string;
}

export function traceSpec(command: TraceSpecCommand, store: SpecStore): Outcome<SpecTraceDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  const traced = traceItem(result.snapshot, command.id);
  if (traced === undefined) return invalid('session', `unknown id "${command.id}"`);
  return {
    exit: hasBlocking(traced.findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.trace',
      ok: true,
      session: result.snapshot.id,
      id: command.id,
      chain: traced.links,
      findings: traced.findings,
      issues: [],
    },
  };
}

function invalid(fault: SpecTraceDocument['fault'], message: string): Outcome<SpecTraceDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.trace', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
