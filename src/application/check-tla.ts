// Use case: line a TLA+ module's @frame comments up against the session's frames. Read-only.
import { compileFrames } from '../domain/spec-compile.js';
import { hasBlocking } from '../domain/spec.js';
import { parseTlaModule, tlaAlignment, type TlaAlignmentStatus } from '../domain/spec-tla-check.js';
import type { Outcome, SpecTlaCheckDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface CheckTlaCommand {
  sessionId?: string;
  file: string;
}

export function checkTla(command: CheckTlaCommand, store: SpecStore, files: TextFiles): Outcome<SpecTlaCheckDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const text = files.read(command.file);
  if (!text.ok) return invalid('unreadable', text.message, command.file);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  const frames = result.snapshot.frames;
  if (frames === undefined) return invalid('session', 'no frames; run clew spec frames list first');
  const module = parseTlaModule(text.text);
  if (module.name === undefined) return invalid('unreadable', 'not a TLA+ module: no ---- MODULE Name ---- line', command.file);
  const alignment = tlaAlignment(frames, compileFrames(frames, result.snapshot.concepts ?? []), module);
  const counts: Record<TlaAlignmentStatus, number> = { modelled: 0, skipped: 0, changed: 0, missing: 0 };
  for (const row of alignment.rows) counts[row.status] += 1;
  return {
    exit: hasBlocking(alignment.findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.tla.check',
      ok: true,
      session: result.snapshot.id,
      file: command.file,
      module: module.name,
      names: module.names,
      alignment: alignment.rows,
      counts,
      findings: alignment.findings,
      issues: [],
    },
  };
}

function invalid(fault: SpecTlaCheckDocument['fault'], message: string, file?: string): Outcome<SpecTlaCheckDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.tla.check', ok: false, fault, findings: [], issues: [specInput(file, message)] },
  };
}
