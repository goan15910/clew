// Use case: coverage of the session, and the findings still open on each layer.
import { hasBlocking } from '../domain/spec.js';
import { specStatus } from '../domain/spec-query.js';
import type { Outcome, SpecStatusDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface SpecStatusCommand {
  sessionId?: string;
}

export function readSpecStatus(command: SpecStatusCommand, store: SpecStore): Outcome<SpecStatusDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  const status = specStatus(result.snapshot);
  return {
    exit: hasBlocking(status.findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.status',
      ok: true,
      session: result.snapshot.id,
      coverage: status.coverage,
      layers: status.layers,
      findingsByLayer: status.findingsByLayer,
      findings: status.findings,
      issues: [],
    },
  };
}

function invalid(fault: SpecStatusDocument['fault'], message: string): Outcome<SpecStatusDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.status', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
