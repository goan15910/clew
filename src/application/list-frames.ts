// Use case: derive one clause frame per clause, store them, and list them with what they compile to.
import { compileFrames } from '../domain/spec-compile.js';
import { sameFrames } from '../domain/spec-frames.js';
import { clauseReach } from '../domain/spec-kernel.js';
import { refinementFindings, refreshConcepts, refreshFrames, sameGroups, type RefinementDrop } from '../domain/spec-refine.js';
import { sameSpans } from '../domain/spec-spans.js';
import { liveSentences, type Finding, type SpecSnapshot } from '../domain/spec.js';
import type { Outcome, SpecFramesDocument } from './documents.js';
import { specInput } from './documents.js';
import { NO_TOKENS, withLayers } from './list-concepts.js';
import type { SpecStore } from './ports.js';
import { dropFindings, dropHistory } from './refinement-drops.js';
import { resolveSession } from './spec-session.js';
import { frameViews } from './spec-views.js';

export interface ListFramesCommand {
  sessionId?: string;
  sentenceId?: string;
}

export function listFrames(command: ListFramesCommand, store: SpecStore): Outcome<SpecFramesDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  let drops: RefinementDrop[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    const sentences = liveSentences(current.sentences);
    if (command.sentenceId !== undefined && !sentences.some((sentence) => sentence.id === command.sentenceId)) {
      problem = `unknown sentence "${command.sentenceId}"`;
      return undefined;
    }
    if ((current.spans ?? []).length === 0) {
      problem = NO_TOKENS;
      return undefined;
    }
    const derived = current.concepts === undefined
      ? refreshConcepts(current.spans ?? [], current.groups ?? [])
      : { spans: current.spans ?? [], concepts: current.concepts, groups: current.groups ?? [], drops: [] };
    const refreshed = refreshFrames(sentences, derived.spans, derived.concepts, current.frames ?? []);
    const frames = refreshed.frames;
    if (
      sameFrames(current.frames, frames)
      && current.concepts !== undefined
      && sameGroups(current.groups, derived.groups)
      && sameSpans(current.spans, derived.spans)
    ) {
      return undefined;
    }
    drops = [...derived.drops, ...refreshed.drops];
    const now = new Date().toISOString();
    const snapshot = withLayers(current, now, { spans: derived.spans, concepts: derived.concepts, groups: derived.groups, frames });
    return {
      snapshot,
      history: [
        { at: now, command: 'spec.frames.list', args: { session: current.id }, before: frameIds(current), after: frameIds(snapshot) },
        ...dropHistory('spec.frames.list', current.id, now, drops),
      ],
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  const all = result.snapshot.frames ?? [];
  const compilation = compileFrames(all, result.snapshot.concepts ?? []);
  const frames = command.sentenceId === undefined ? all : all.filter((frame) => frame.sentence === command.sentenceId);
  const found = [...compilation.findings, ...refinementFindings(all, result.snapshot.groups ?? []), ...dropFindings(drops)];
  const findings = command.sentenceId === undefined ? found : relevant(found, command.sentenceId, frames.map((frame) => frame.id));
  return {
    exit: 'pass',
    document: {
      command: 'spec.frames.list',
      ok: true,
      session: result.snapshot.id,
      frames: frameViews(frames, compilation.compiled.items, compilation.restated, clauseReach(compilation.compiled)),
      findings,
      issues: [],
    },
  };
}

export function relevant(findings: readonly Finding[], sentenceId: string, frameIds: readonly string[]): Finding[] {
  return findings.filter((finding) => (finding.refs ?? []).some((ref) => ref === sentenceId || frameIds.includes(ref)));
}

function frameIds(snapshot: SpecSnapshot): string[] {
  const ids: string[] = [];
  for (const frame of snapshot.frames ?? []) ids.push(frame.id);
  return ids;
}

function invalid(fault: SpecFramesDocument['fault'], message: string): Outcome<SpecFramesDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.frames.list', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
