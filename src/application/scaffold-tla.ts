// Use case: draft a TLA+ module and TLC config from the frames. The agent owns the file afterwards.
import { basename } from 'node:path';
import { compileFrames } from '../domain/spec-compile.js';
import { pascalName, tlaScaffold, TLA_MODULE_NAME_MESSAGE, TLA_MODULE_NAME_PATTERN } from '../domain/spec-tla.js';
import type { Outcome, SpecTlaScaffoldDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface ScaffoldTlaCommand {
  sessionId?: string;
  dryRun: boolean;
  out?: string;
  force: boolean;
}

export function scaffoldTla(command: ScaffoldTlaCommand, store: SpecStore, files: TextFiles): Outcome<SpecTlaScaffoldDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  const result = store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  const frames = result.snapshot.frames;
  if (frames === undefined) return invalid('session', 'no frames; run clew spec frames list first');
  const compilation = compileFrames(frames, result.snapshot.concepts ?? []);
  if (compilation.compiled.draft.vars.length === 0) {
    return invalid('session', 'no frame compiles to an action yet; refine the frames first (clew spec frames list)');
  }
  let module = pascalName(compilation.compiled.draft.id);
  if (command.out !== undefined) {
    if (!command.out.endsWith('.tla')) return invalid('unreadable', `${command.out}: a TLA+ module file ends in .tla`);
    module = basename(command.out, '.tla');
    if (!TLA_MODULE_NAME_PATTERN.test(module)) {
      return invalid('unreadable', `${command.out}: TLA+ names a module after its file, and ${TLA_MODULE_NAME_MESSAGE}`);
    }
  }
  const scaffold = tlaScaffold({ module, session: result.snapshot.id, frames, compilation });
  const document: SpecTlaScaffoldDocument = {
    command: 'spec.tla.scaffold',
    ok: true,
    session: result.snapshot.id,
    module,
    tla: scaffold.tla,
    cfg: scaffold.cfg,
    placed: scaffold.placed,
    todo: scaffold.todo,
    findings: compilation.findings,
    issues: [],
  };
  if (command.dryRun || command.out === undefined) {
    document.dryRun = true;
    return { exit: 'pass', document };
  }
  if (files.exists(command.out) && !command.force) {
    return invalid('exists', `${command.out} exists, and a model is the agent's to edit: check it with clew spec tla check ${command.out}, or pass --force to replace it`);
  }
  const wrote = files.write(command.out, scaffold.tla);
  if (!wrote.ok) return invalid('unreadable', wrote.message);
  document.written = command.out;
  if (command.force) document.forced = true;
  const cfgFile = `${command.out.slice(0, -'.tla'.length)}.cfg`;
  if (command.force || !files.exists(cfgFile)) {
    const wroteCfg = files.write(cfgFile, scaffold.cfg);
    if (!wroteCfg.ok) return invalid('unreadable', wroteCfg.message);
    document.cfgWritten = cfgFile;
  }
  return { exit: 'pass', document };
}

function invalid(fault: SpecTlaScaffoldDocument['fault'], message: string): Outcome<SpecTlaScaffoldDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.tla.scaffold', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
