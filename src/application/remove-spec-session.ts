// Use case: delete one spec session for this repo. The store decides what is safe to delete.
import type { Outcome, SpecSessionRemoveDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';

export interface RemoveSpecSessionCommand {
  id: string;
}

export function removeSpecSession(command: RemoveSpecSessionCommand, store: SpecStore): Outcome<SpecSessionRemoveDocument> {
  const result = store.removeSession(command.id);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  return {
    exit: 'pass',
    document: {
      command: 'spec.session.remove',
      ok: true,
      session: command.id,
      findings: [],
      issues: [],
    },
  };
}

function invalid(fault: SpecSessionRemoveDocument['fault'], message: string): Outcome<SpecSessionRemoveDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.session.remove',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(undefined, message)],
    },
  };
}
