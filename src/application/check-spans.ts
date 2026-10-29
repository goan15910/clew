// Use case: read-only list of unresolved tag-conflict and multi-entity span windows.
import { checkSpanConflicts, type LexiconEntry, type SpanConflictWindow } from '../domain/spec-spans.js';
import { specInput, type Outcome, type SpecSpanConflictView, type SpecSpansDocument } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { spanViews } from './spec-views.js';

export interface CheckSpansCommand {
  sessionId?: string;
  lexicon: readonly LexiconEntry[];
  lexiconPath?: string;
}

export function checkSpans(command: CheckSpansCommand, store: SpecStore): Outcome<SpecSpansDocument> {
  const commandName = 'spec.spans.check' as const;
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (result.snapshot.spans === undefined || result.snapshot.spans.length === 0) {
    return invalid(commandName, 'session', 'no spans; run clew spec tag first');
  }
  const skipped = conflictViews(checkSpanConflicts(result.snapshot.spans, result.snapshot.tagged, command.lexicon));
  return {
    exit: 'pass',
    document: {
      command: commandName,
      ok: true,
      session: result.snapshot.id,
      spans: spanViews(result.snapshot.spans),
      skipped,
      findings: [],
      issues: [],
    },
  };
}

function conflictViews(windows: readonly SpanConflictWindow[]): SpecSpanConflictView[] {
  const views: SpecSpanConflictView[] = [];
  for (const window of windows) {
    const view: SpecSpanConflictView = {
      kind: window.kind,
      spanIds: window.spanIds.slice(),
      surfaces: window.surfaces.slice(),
      childTags: window.childTags.map((tags) => tags.slice()),
      entityIds: window.entityIds.slice(),
    };
    if (window.lexiconEntryId !== undefined) view.lexiconEntryId = window.lexiconEntryId;
    if (window.lexiconKey !== undefined) view.lexiconKey = window.lexiconKey;
    views.push(view);
  }
  return views;
}

function invalid(command: SpecSpansDocument['command'], fault: SpecSpansDocument['fault'], message: string): Outcome<SpecSpansDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
