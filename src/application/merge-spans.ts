// Use case: lexicon auto-merge or interactive merge of live spans.
import {
  interactiveMerge,
  mergeLexicon,
  validatePartition,
  type LexiconEntry,
  type SpanConflictWindow,
} from '../domain/spec-spans.js';
import { hasBlocking, type LiveSpan, type SpecSnapshot } from '../domain/spec.js';
import { specInput, type Outcome, type SpecSpanConflictView, type SpecSpansDocument } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { spanViews } from './spec-views.js';

export type MergeSpansCommand =
  | {
      mode: 'lexicon';
      sessionId?: string;
      lexiconPath: string;
      lexicon: readonly LexiconEntry[];
      forceAuto?: boolean;
    }
  | {
      mode: 'interactive';
      sessionId?: string;
      spanIds: string[];
      tags?: string[];
      /** Explicit entity id, or null for link none. */
      entityId?: string | null;
    };

export function mergeSpans(command: MergeSpansCommand, store: SpecStore): Outcome<SpecSpansDocument> {
  const commandName = 'spec.spans.merge' as const;
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);

  let problem: { fault: SpecSpansDocument['fault']; message: string } | undefined;
  let merged: string[] = [];
  let skipped: SpecSpanConflictView[] = [];
  let spansOut: LiveSpan[] = [];

  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.spans === undefined || current.spans.length === 0) {
      problem = { fault: 'session', message: 'no spans; run clew spec tag first' };
      return undefined;
    }
    if (command.mode === 'lexicon') {
      const pass = mergeLexicon(current.spans, current.tagged, command.lexicon, { forceAuto: command.forceAuto === true });
      const invalidPartition = validatePartition(pass.spans, current.tagged);
      if (invalidPartition !== undefined) {
        problem = { fault: 'session', message: invalidPartition };
        return undefined;
      }
      merged = pass.merged;
      skipped = conflictViews(pass.skipped);
      spansOut = pass.spans;
      if (pass.unchanged) return undefined;
      const now = new Date().toISOString();
      const snapshot = copySnapshot(current, now);
      snapshot.spans = pass.spans;
      return {
        snapshot,
        history: {
          at: now,
          command: commandName,
          args: {
            session: current.id,
            lexicon: command.lexiconPath,
            forceAuto: command.forceAuto === true,
          },
          before: beforeIds(current.spans, pass.spans),
          after: merged.slice(),
        },
      };
    }

    const edited = interactiveMerge(current.spans, current.tagged, {
      spanIds: command.spanIds,
      tags: command.tags,
      entityId: command.entityId,
    });
    if (!edited.ok) {
      problem = { fault: 'session', message: edited.message };
      return undefined;
    }
    const invalidPartition = validatePartition(edited.spans, current.tagged);
    if (invalidPartition !== undefined) {
      problem = { fault: 'session', message: invalidPartition };
      return undefined;
    }
    merged = [edited.mergedId];
    spansOut = edited.spans;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.spans = edited.spans;
    const args: {
      session: string;
      ids: string[];
      tags?: string[];
      entity?: string;
      link?: string;
    } = { session: current.id, ids: command.spanIds.slice() };
    if (command.tags !== undefined) args.tags = command.tags.slice();
    if (command.entityId === null) args.link = 'none';
    else if (command.entityId !== undefined) args.entity = command.entityId;
    return {
      snapshot,
      history: {
        at: now,
        command: commandName,
        args,
        before: command.spanIds.slice(),
        after: [edited.mergedId],
      },
    };
  });

  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(commandName, problem.fault, problem.message);
  const live = spansOut.length > 0 ? spansOut : result.snapshot.spans ?? [];
  return {
    exit: hasBlocking([]) ? 'fail' : 'pass',
    document: {
      command: commandName,
      ok: true,
      session: result.snapshot.id,
      spans: spanViews(live),
      merged,
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

function beforeIds(previous: readonly LiveSpan[], next: readonly LiveSpan[]): string[] {
  const nextIds = new Set<string>();
  for (const span of next) nextIds.add(span.id);
  const removed: string[] = [];
  for (const span of previous) {
    if (!nextIds.has(span.id)) removed.push(span.id);
  }
  return removed;
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specPath: current.specPath,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  if (current.spans !== undefined) snapshot.spans = current.spans;
  if (current.entities !== undefined) snapshot.entities = current.entities;
  if (current.facts !== undefined) snapshot.facts = current.facts;
  if (current.graph !== undefined) snapshot.graph = current.graph;
  return snapshot;
}

function invalid(command: SpecSpansDocument['command'], fault: SpecSpansDocument['fault'], message: string): Outcome<SpecSpansDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
