// Use case: coverage of the session, and the findings still open on each layer.
import { hasBlocking } from '../domain/spec.js';
import { specStatus } from '../domain/spec-query.js';
import { gateSession, type CanonPorts } from './canon.js';
import type { DanglingView, Outcome, SpecStatusDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { clauseViews } from './spec-views.js';

export interface SpecStatusCommand {
  sessionId?: string;
}

/** With canon ports, status also lists the sentences the canonical gate leaves dangling (when the session has a lexicon). */
export function readSpecStatus(command: SpecStatusCommand, store: SpecStore, canon?: Pick<CanonPorts, 'canon' | 'parser'>): Outcome<SpecStatusDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  const status = specStatus(result.snapshot);
  let canonView: SpecStatusDocument['canon'];
  if (canon !== undefined) {
    const read = canon.canon.read(result.snapshot.id);
    if (read.ok && read.state !== undefined) {
      const gate = gateSession(result.snapshot, read.state.lexicon, canon.parser);
      canonView = {
        accepted: gate.sentences.filter((sentence) => sentence.status === 'accepted').map((sentence) => sentence.id),
        dangling: gate.sentences.filter((sentence) => sentence.status === 'dangling').map((sentence) => {
          const view: DanglingView = { id: sentence.id, text: sentence.text, diagnostics: sentence.diagnostics };
          if (sentence.draft !== undefined) view.draft = sentence.draft;
          return view;
        }),
      };
    }
  }
  const outcome: Outcome<SpecStatusDocument> = {
    exit: hasBlocking(status.findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.status',
      ok: true,
      session: result.snapshot.id,
      coverage: status.coverage,
      layers: status.layers,
      findingsByLayer: status.findingsByLayer,
      clauses: clauseViews(status.clauses, result.snapshot.frames ?? []),
      findings: status.findings,
      issues: [],
    },
  };
  if (canonView !== undefined) outcome.document.canon = canonView;
  return outcome;
}

function invalid(fault: SpecStatusDocument['fault'], message: string): Outcome<SpecStatusDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.status', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
