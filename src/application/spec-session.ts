// Pick the session a spec command should read. Shared by every spec use case.
import type { SpecStore } from './ports.js';

export function resolveSession(store: SpecStore, requested: string | undefined): { ok: true; id: string } | { ok: false; message: string } {
  const sessions = store.listSessions();
  if (requested !== undefined) {
    for (const session of sessions) {
      if (session.id === requested) return { ok: true, id: requested };
    }
    return { ok: false, message: `no spec session "${requested}"` };
  }
  const only = sessions[0];
  if (sessions.length === 0 || only === undefined) return { ok: false, message: 'no spec session; run clew spec init first' };
  if (sessions.length > 1) {
    const ids: string[] = [];
    for (const session of sessions) ids.push(session.id);
    return { ok: false, message: `more than one spec session; pass --session. Open sessions: ${ids.join(', ')}` };
  }
  return { ok: true, id: only.id };
}
