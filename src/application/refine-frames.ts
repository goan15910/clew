// Use case: an agent or a human sets one frame role, or marks a frame as not a transition, with a reason.
// Values must come from live spans, concepts, or frames; the write keeps the derived `original`.
import { compileFrames } from '../domain/spec-compile.js';
import { sameVersion } from '../domain/spec-frames.js';
import { agentNotTransition, refinementFindings, refreshFrames, roleVersion, writeField, writeNotTransition } from '../domain/spec-refine.js';
import type { RevisionNote } from '../domain/spec-sentences.js';
import { liveSentences, type Frame, type RoleName, type SpecHistoryArgs, type SpecSnapshot } from '../domain/spec.js';
import { specInput, type Outcome, type SpecFrameRefineDocument } from './documents.js';
import { DEFAULT_AUTHOR } from './edit-sentences.js';
import { withLayers } from './list-concepts.js';
import { relevant } from './list-frames.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { frameViews } from './spec-views.js';

export const NO_FRAMES = 'no frames; run clew spec frames list first';

interface RefineBase {
  sessionId?: string;
  frame: string;
  reason: string;
  finding?: string;
  comment?: string;
  by?: string;
}

export interface SetRoleCommand extends RefineBase {
  role: RoleName;
  /** Refs by role: one concept id, one span id (event), or frame ids (when). */
  value: string[] | 'unknown';
  dependsOn?: string[];
}

export interface NotTransitionCommand extends RefineBase {
  clear: boolean;
}

type Write = (current: SpecSnapshot, frame: Frame, note: RevisionNote) => { ok: true; frame: Frame; args: SpecHistoryArgs } | { ok: false; message: string };

export function setFrameRole(command: SetRoleCommand, store: SpecStore): Outcome<SpecFrameRefineDocument> {
  return refine('spec.frames.set', command, store, (current, frame, note) => {
    const scope = {
      sentences: liveSentences(current.sentences),
      spans: current.spans ?? [],
      concepts: current.concepts ?? [],
      frames: current.frames ?? [],
    };
    const version = roleVersion(scope, frame, command.role, command.value, command.dependsOn);
    if (!version.ok) return version;
    if (sameVersion(frame.roles[command.role].latest, version.value)) return { ok: false, message: `${frame.id} ${command.role} already reads that value` };
    const args: SpecHistoryArgs = { session: current.id, frame: frame.id, role: command.role, reason: command.reason, dependsOn: version.value.dependsOn.slice() };
    args.values = command.value === 'unknown' ? ['unknown'] : command.value.slice();
    return { ok: true, frame: writeField(frame, command.role, version.value, note), args };
  });
}

export function markNotTransition(command: NotTransitionCommand, store: SpecStore): Outcome<SpecFrameRefineDocument> {
  return refine('spec.frames.not-transition', command, store, (current, frame, note) => {
    const agent = agentNotTransition(frame);
    const value = command.clear ? null : { reason: command.reason };
    const unchanged = command.clear ? agent === undefined || agent === null : agent !== undefined && agent !== null && agent.reason === command.reason;
    if (unchanged) return { ok: false, message: `${frame.id} notTransition already reads that value` };
    const args: SpecHistoryArgs = { session: current.id, frame: frame.id, reason: command.reason };
    if (command.clear) args.clear = true;
    return { ok: true, frame: writeNotTransition(frame, value, note), args };
  });
}

function refine(
  name: SpecFrameRefineDocument['command'],
  command: RefineBase,
  store: SpecStore,
  write: Write,
): Outcome<SpecFrameRefineDocument> {
  if (command.reason.trim() === '') return invalid(name, 'session', 'a frame write needs --reason');
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(name, 'session', resolved.message);
  let problem: string | undefined;
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.frames === undefined) {
      problem = NO_FRAMES;
      return undefined;
    }
    const frame = current.frames.find((item) => item.id === command.frame);
    if (frame === undefined) {
      problem = `unknown frame "${command.frame}"`;
      return undefined;
    }
    const now = new Date().toISOString();
    const note: RevisionNote = { at: now, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason };
    if (command.finding !== undefined) note.finding = command.finding;
    if (command.comment !== undefined) note.comment = command.comment;
    const written = write(current, frame, note);
    if (!written.ok) {
      problem = written.message;
      return undefined;
    }
    if (command.finding !== undefined) written.args.finding = command.finding;
    if (command.by !== undefined) written.args.by = command.by;
    const previous = current.frames.map((item) => (item.id === frame.id ? written.frame : item));
    const refreshed = refreshFrames(liveSentences(current.sentences), current.spans ?? [], current.concepts ?? [], previous);
    return {
      snapshot: withLayers(current, now, { spans: current.spans ?? [], frames: refreshed.frames }),
      history: { at: now, command: name, args: written.args, before: [frame.id], after: [frame.id] },
    };
  });
  if (!result.ok) return invalid(name, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(name, 'session', problem);
  const all = result.snapshot.frames ?? [];
  const frame = all.find((item) => item.id === command.frame);
  const compilation = compileFrames(all, result.snapshot.concepts ?? []);
  const findings = frame === undefined
    ? []
    : relevant([...compilation.findings, ...refinementFindings(all, result.snapshot.groups ?? [])], '', [frame.id]);
  const document: SpecFrameRefineDocument = { command: name, ok: true, session: result.snapshot.id, findings, issues: [] };
  const view = frame === undefined ? undefined : frameViews([frame], compilation.compiled.items, compilation.restated)[0];
  if (view !== undefined) document.frame = view;
  return { exit: 'pass', document };
}

function invalid(command: SpecFrameRefineDocument['command'], fault: SpecFrameRefineDocument['fault'], message: string): Outcome<SpecFrameRefineDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
