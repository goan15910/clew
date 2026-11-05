// Use case: derive one clause frame per clause, store them, and list them with what they compile to.
import { compileFrames } from '../domain/spec-compile.js';
import { deriveConcepts } from '../domain/spec-concepts.js';
import { deriveFrames, sameFrames } from '../domain/spec-frames.js';
import { sameSpans } from '../domain/spec-spans.js';
import { liveSentences, type Finding, type SpecSnapshot } from '../domain/spec.js';
import type { Outcome, SpecFramesDocument } from './documents.js';
import { specInput } from './documents.js';
import { NO_TOKENS, withLayers } from './list-concepts.js';
import type { SpecStore } from './ports.js';
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
      ? deriveConcepts(current.spans ?? [])
      : { spans: current.spans ?? [], concepts: current.concepts };
    const frames = deriveFrames(sentences, derived.spans, derived.concepts);
    if (sameFrames(current.frames, frames) && current.concepts !== undefined && sameSpans(current.spans, derived.spans)) return undefined;
    const now = new Date().toISOString();
    const snapshot = withLayers(current, now, { spans: derived.spans, concepts: derived.concepts, frames });
    return {
      snapshot,
      history: { at: now, command: 'spec.frames.list', args: { session: current.id }, before: frameIds(current), after: frameIds(snapshot) },
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  const all = result.snapshot.frames ?? [];
  const compilation = compileFrames(all, result.snapshot.concepts ?? []);
  const frames = command.sentenceId === undefined ? all : all.filter((frame) => frame.sentence === command.sentenceId);
  const findings = command.sentenceId === undefined ? compilation.findings : relevant(compilation.findings, command.sentenceId, frames.map((frame) => frame.id));
  return {
    exit: 'pass',
    document: {
      command: 'spec.frames.list',
      ok: true,
      session: result.snapshot.id,
      frames: frameViews(frames, compilation.compiled.items, compilation.restated),
      findings,
      issues: [],
    },
  };
}

function relevant(findings: readonly Finding[], sentenceId: string, frameIds: readonly string[]): Finding[] {
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
