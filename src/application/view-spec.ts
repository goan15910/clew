// Use case: install the HTML inspector for one spec session. Domain JSON stays read-only.
import type { Outcome, SpecFault, SpecViewDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecSessionViewer, SpecStore } from './ports.js';

export interface ViewSpecCommand {
  id: string;
}

export function viewSpecSession(
  command: ViewSpecCommand,
  store: SpecStore,
  viewer: SpecSessionViewer,
): Outcome<SpecViewDocument> {
  const result = store.update(command.id, { create: false }, () => undefined);
  if (!result.ok) {
    return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  }
  const installed = viewer.install(command.id);
  if (!installed.ok) {
    return invalid(installed.fault === 'missing' ? 'session' : installed.fault, installed.message);
  }
  return {
    exit: 'pass',
    document: {
      command: 'spec.view',
      ok: true,
      session: installed.session,
      htmlPath: installed.htmlPath,
      sessionDir: installed.sessionDir,
      mode: 'session-folder',
      findings: [],
      issues: [],
    },
  };
}

function invalid(fault: SpecFault, message: string): Outcome<SpecViewDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.view',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(undefined, message)],
    },
  };
}
