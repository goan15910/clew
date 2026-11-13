// Use case: line a TLA+ model's @frame comments up against the session's frames, and make sure the
// frames module it refines is the one the frames export now. Read-only; TLC is the user's to run.
import { dirname, join } from 'node:path';
import { compileFrames } from '../domain/spec-compile.js';
import { hasBlocking, type Finding } from '../domain/spec.js';
import { tlaFramesModule, TLA_FRAMES_MARKER } from '../domain/spec-tla.js';
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
  const compilation = compileFrames(frames, result.snapshot.concepts ?? []);
  const alignment = tlaAlignment(frames, compilation, module);
  const findings: Finding[] = [];
  let exported: SpecTlaCheckDocument['frames'];
  for (const name of module.instances) {
    const file = join(dirname(command.file), `${name}.tla`);
    const beside = files.exists(file) ? files.read(file) : undefined;
    if (beside === undefined || !beside.ok || !beside.text.includes(TLA_FRAMES_MARKER)) continue;
    const now = tlaFramesModule({ module: name, session: result.snapshot.id, frames, compilation });
    exported = { module: name, file, current: beside.text === now.tla };
    break;
  }
  if (exported === undefined) {
    findings.push({
      id: 'no-frames-instance',
      kind: 'gap',
      code: 'no-frames-instance',
      severity: 'blocking',
      message: `${command.file} instantiates no module exported by clew spec tla export, so TLC has nothing to check it against; export one beside it and add Frames == INSTANCE <module> WITH <mapping>`,
      refs: [module.name],
    });
  } else if (!exported.current) {
    findings.push({
      id: `frames-module-stale:${exported.module}`,
      kind: 'stale',
      code: 'frames-module-stale',
      severity: 'blocking',
      message: `${exported.file} is not what the frames export now, so a TLC run against it proves nothing about them; run clew spec tla export --out ${exported.file} and run TLC again`,
      refs: [exported.module],
    });
  }
  for (const finding of alignment.findings) findings.push(finding);
  const counts: Record<TlaAlignmentStatus, number> = { modelled: 0, skipped: 0, changed: 0, missing: 0 };
  for (const row of alignment.rows) counts[row.status] += 1;
  const document: SpecTlaCheckDocument = {
    command: 'spec.tla.check',
    ok: true,
    session: result.snapshot.id,
    file: command.file,
    module: module.name,
    alignment: alignment.rows,
    counts,
    findings,
    issues: [],
  };
  if (exported !== undefined) document.frames = exported;
  return { exit: hasBlocking(findings) ? 'fail' : 'pass', document };
}

function invalid(fault: SpecTlaCheckDocument['fault'], message: string, file?: string): Outcome<SpecTlaCheckDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.tla.check', ok: false, fault, findings: [], issues: [specInput(file, message)] },
  };
}
