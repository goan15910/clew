// Use case: export the frames as a TLA+ module, and with --model the files that check a model
// against it. Clew owns the frames module, the check module, and the two configs, and rewrites
// them on every export. The model is the agent's: it is started once and then kept.
import { basename, dirname, join, resolve } from 'node:path';
import { compileFrames } from '../domain/spec-compile.js';
import { pascalName, tlaCheckModule, tlaFramesModule, tlaModelStarter, TLA_MODULE_NAME_MESSAGE, TLA_MODULE_NAME_PATTERN, type TlaModuleInput } from '../domain/spec-tla.js';
import type { Outcome, SpecTlaExportDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface ExportTlaCommand {
  sessionId?: string;
  dryRun: boolean;
  /** The frames module file. */
  out?: string;
  /** The model file. Started when it does not exist; its check module and configs are always rewritten. */
  model?: string;
  /** Replace an existing model with a fresh starter. */
  force: boolean;
}

export function exportTla(command: ExportTlaCommand, store: SpecStore, files: TextFiles): Outcome<SpecTlaExportDocument> {
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
  const base = pascalName(compilation.compiled.draft.id);
  let framesName = `${base}Frames`;
  let modelName = base;
  if (command.out !== undefined) {
    const named = moduleName(command.out);
    if (!named.ok) return invalid('unreadable', named.message);
    framesName = named.name;
  }
  if (command.model !== undefined) {
    const named = moduleName(command.model);
    if (!named.ok) return invalid('unreadable', named.message);
    modelName = named.name;
    if (command.out !== undefined && dirname(resolve(command.model)) !== dirname(resolve(command.out))) {
      return invalid('unreadable', `${command.model}: TLC looks for ${framesName}.tla beside the model, so write both into one directory`);
    }
  }
  const checkName = `${modelName}Check`;
  if (new Set([framesName, modelName, checkName]).size < 3) {
    return invalid('unreadable', `the frames module (${framesName}), the model (${modelName}), and its check module (${checkName}) need three different names`);
  }
  const input = (module: string): TlaModuleInput => ({ module, session: result.snapshot.id, frames, compilation });
  const exported = tlaFramesModule(input(framesName));
  const document: SpecTlaExportDocument = {
    command: 'spec.tla.export',
    ok: true,
    session: result.snapshot.id,
    module: framesName,
    tla: exported.tla,
    actions: exported.actions,
    todo: exported.todo,
    findings: compilation.findings,
    issues: [],
  };
  if (command.dryRun || command.model !== undefined) {
    const check = tlaCheckModule({ module: checkName, model: modelName, frames: exported });
    document.model = { module: modelName, tla: tlaModelStarter(input(modelName), framesName) };
    document.check = { module: checkName, tla: check.tla, cfg: check.cfg, coverageCfg: check.coverageCfg };
  }
  if (command.dryRun || command.out === undefined) {
    document.dryRun = true;
    return { exit: 'pass', document };
  }
  const wrote = files.write(command.out, exported.tla);
  if (!wrote.ok) return invalid('unreadable', wrote.message);
  document.written = [command.out];
  if (command.model === undefined || document.model === undefined || document.check === undefined) return { exit: 'pass', document };
  const directory = dirname(command.model);
  const owned: [string, string][] = [
    [join(directory, `${checkName}.tla`), document.check.tla],
    [join(directory, `${checkName}.cfg`), document.check.cfg],
    [join(directory, `${modelName}Coverage.cfg`), document.check.coverageCfg],
  ];
  for (const [file, text] of owned) {
    const wroteOwned = files.write(file, text);
    if (!wroteOwned.ok) return invalid('unreadable', wroteOwned.message);
    document.written.push(file);
  }
  if (files.exists(command.model) && !command.force) {
    document.model.kept = true;
    return { exit: 'pass', document };
  }
  const wroteModel = files.write(command.model, document.model.tla);
  if (!wroteModel.ok) return invalid('unreadable', wroteModel.message);
  document.model.written = command.model;
  if (command.force) document.forced = true;
  return { exit: 'pass', document };
}

function moduleName(file: string): { ok: true; name: string } | { ok: false; message: string } {
  if (!file.endsWith('.tla')) return { ok: false, message: `${file}: a TLA+ module file ends in .tla` };
  const name = basename(file, '.tla');
  if (!TLA_MODULE_NAME_PATTERN.test(name)) return { ok: false, message: `${file}: TLA+ names a module after its file, and ${TLA_MODULE_NAME_MESSAGE}` };
  return { ok: true, name };
}

function invalid(fault: SpecTlaExportDocument['fault'], message: string): Outcome<SpecTlaExportDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.tla.export', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
