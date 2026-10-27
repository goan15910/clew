// Use case: list spec sessions for this repo. An empty list is a successful result.
import type { Outcome, SpecSessionListDocument, SpecSessionListRow } from './documents.js';
import type { SpecStore } from './ports.js';

export function listSpecSessions(store: SpecStore): Outcome<SpecSessionListDocument> {
  const listed = store.listSessions();
  const sessions: SpecSessionListRow[] = [];
  for (const session of listed) {
    sessions.push({
      id: session.id,
      specPath: session.specPath,
      updated: session.updated,
      summary: {
        sentences: session.summary.sentences,
        facts: session.summary.facts,
        flows: session.summary.flows,
      },
    });
  }
  return {
    exit: 'pass',
    document: {
      command: 'spec.session.list',
      ok: true,
      sessions,
      findings: [],
      issues: [],
    },
  };
}
