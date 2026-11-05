// Use case: move one span into another concept, a new concept, or none, with a reason.
// Frames are re-derived after, because their roles read concepts; refined fields are kept.
import { copyGrouping, currentGrouping, groupingVersion, rebuildLayers, sameGrouping, writeGrouping } from '../domain/spec-refine.js';
import { liveSentences, type Finding, type Grouping, type SpecHistoryArgs } from '../domain/spec.js';
import { specInput, type Outcome, type SpecConceptsDocument } from './documents.js';
import { DEFAULT_AUTHOR } from './edit-sentences.js';
import { NO_TOKENS, withLayers } from './list-concepts.js';
import type { SpecStore } from './ports.js';
import { dropFindings, dropHistory } from './refinement-drops.js';
import { resolveSession } from './spec-session.js';
import { conceptViews, groupViews } from './spec-views.js';

export interface GroupConceptCommand {
  sessionId?: string;
  span: string;
  /** A concept id, or null for no concept. */
  into: string | null;
  dependsOn?: string[];
  reason: string;
  finding?: string;
  comment?: string;
  by?: string;
}

export function groupConcept(command: GroupConceptCommand, store: SpecStore): Outcome<SpecConceptsDocument> {
  if (command.reason.trim() === '') return invalid('session', 'a grouping write needs --reason');
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  let written: Grouping | undefined;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    const spans = current.spans ?? [];
    if (spans.length === 0) {
      problem = NO_TOKENS;
      return undefined;
    }
    const sentences = liveSentences(current.sentences);
    const base = rebuildLayers(sentences, spans, { concepts: current.concepts ?? [], groups: current.groups ?? [] });
    const version = groupingVersion(base.spans, base.concepts ?? [], command.span, command.into, command.dependsOn);
    if (!version.ok) {
      problem = version.message;
      return undefined;
    }
    if (sameGrouping(currentGrouping(base.spans, base.groups ?? [], command.span), version.value)) {
      problem = `${command.span} already reads that value`;
      return undefined;
    }
    const span = base.spans.find((item) => item.id === command.span);
    if (span === undefined) return undefined;
    const now = new Date().toISOString();
    const note: Parameters<typeof writeGrouping>[3] = { at: now, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason };
    if (command.finding !== undefined) note.finding = command.finding;
    if (command.comment !== undefined) note.comment = command.comment;
    const groups = writeGrouping(base.groups ?? [], span, version.value, note);
    const layers = rebuildLayers(sentences, spans, { concepts: current.concepts ?? [], groups, frames: current.frames });
    written = layers.groups?.find((item) => item.span === command.span);
    findings = dropFindings(layers.drops);
    const args: SpecHistoryArgs = {
      session: current.id,
      span: command.span,
      reason: command.reason,
      dependsOn: version.value.dependsOn.slice(),
    };
    if (command.into === null) args.link = 'none';
    else args.into = command.into;
    if (command.finding !== undefined) args.finding = command.finding;
    if (command.by !== undefined) args.by = command.by;
    const before = current.spans?.find((item) => item.id === command.span)?.entityId;
    return {
      snapshot: withLayers(current, now, layers),
      history: [
        { at: now, command: 'spec.concepts.group', args, before: before === undefined ? [] : [before], after: command.into === null ? [] : [command.into] },
        ...dropHistory('spec.concepts.group', current.id, now, layers.drops),
      ],
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  const document: SpecConceptsDocument = {
    command: 'spec.concepts.group',
    ok: true,
    session: result.snapshot.id,
    concepts: conceptViews(result.snapshot.concepts ?? [], result.snapshot.spans ?? []),
    groups: groupViews(result.snapshot.groups ?? []),
    findings,
    issues: [],
  };
  if (written !== undefined) document.grouping = copyGrouping(written);
  return { exit: 'pass', document };
}

function invalid(fault: SpecConceptsDocument['fault'], message: string): Outcome<SpecConceptsDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.concepts.group', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
