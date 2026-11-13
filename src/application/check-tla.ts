// Use case: make sure the files TLC will read beside a model are the ones the frames export now.
// Read-only. Clew does not run TLC; the document names the two runs and how to read the coverage.
import { dirname, join } from 'node:path';
import { compileFrames } from '../domain/spec-compile.js';
import { hasBlocking, type Finding } from '../domain/spec.js';
import { tlaCheckModule, tlaFramesModule, TLA_FRAMES_INSTANCE, TLA_MODEL_NAMES } from '../domain/spec-tla.js';
import { parseTlaModel } from '../domain/spec-tla-check.js';
import type { Outcome, SpecTlaCheckDocument, TlaOwnedFileView } from './documents.js';
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
  const model = parseTlaModel(text.text);
  if (model.name === undefined) return invalid('unreadable', 'not a TLA+ module: no ---- MODULE Name ---- line', command.file);
  const document: SpecTlaCheckDocument = {
    command: 'spec.tla.check',
    ok: true,
    session: result.snapshot.id,
    file: command.file,
    module: model.name,
    findings: [],
    issues: [],
  };
  const findings: Finding[] = document.findings;
  if (model.framesModule === undefined) {
    findings.push({
      id: 'no-frames-instance',
      kind: 'gap',
      code: 'no-frames-instance',
      severity: 'blocking',
      message: `${command.file} has no "${TLA_FRAMES_INSTANCE} == INSTANCE <frames module> WITH <mapping>", so nothing ties it to the frames`,
      refs: [model.name],
    });
    return { exit: 'fail', document };
  }
  const directory = dirname(command.file);
  const exported = tlaFramesModule({ module: model.framesModule, session: result.snapshot.id, frames, compilation: compileFrames(frames, result.snapshot.concepts ?? []) });
  const check = tlaCheckModule({ module: `${model.name}Check`, model: model.name, frames: exported });
  const framesFile = join(directory, `${model.framesModule}.tla`);
  const checkFile = join(directory, `${check.module}.tla`);
  const cfgFile = join(directory, `${check.module}.cfg`);
  const coverageFile = join(directory, `${model.name}Coverage.cfg`);
  const owned: TlaOwnedFileView[] = [
    ownedFile(files, 'frames', framesFile, exported.tla),
    ownedFile(files, 'check', checkFile, check.tla),
    ownedFile(files, 'check-config', cfgFile, check.cfg),
    ownedFile(files, 'coverage-config', coverageFile, check.coverageCfg),
  ];
  document.framesModule = model.framesModule;
  document.files = owned;
  const again = `clew spec tla export --out ${framesFile} --model ${command.file}`;
  for (const entry of owned) {
    if (entry.state === 'current') continue;
    const code = entry.role === 'frames' ? 'frames-module-stale' : 'check-files-stale';
    findings.push({
      id: `${code}:${entry.file}`,
      kind: 'stale',
      code,
      severity: 'blocking',
      message: entry.state === 'missing'
        ? `${entry.file} is missing; run ${again}, then run TLC`
        : `${entry.file} is not what the frames export now, so a TLC run with it proves nothing about them; run ${again}, then run TLC again`,
      refs: [entry.file],
    });
  }
  const absent = TLA_MODEL_NAMES.filter((name) => !model.defined.includes(name));
  if (absent.length > 0) {
    findings.push({
      id: 'model-names-missing',
      kind: 'gap',
      code: 'model-names-missing',
      severity: 'warning',
      message: `${command.file} does not seem to define ${absent.join(', ')}, which ${check.module}.tla needs; TLC will refuse to parse it unless an extended module defines them`,
      refs: absent,
    });
  }
  const covers = new Map<string, string>();
  for (const entry of check.cover) covers.set(entry.action, entry.name);
  document.actions = exported.actions.map((action) => ({
    frame: action.frame,
    restatedBy: action.restatedBy,
    sentence: action.sentence,
    clause: action.clause,
    event: action.event,
    action: action.action,
    cover: covers.get(action.action) ?? '',
  }));
  document.properties = exported.properties.map((property) => ({ frame: property.frame, name: `Frames_${property.name}` }));
  document.run = {
    refinement: `java -cp tla2tools.jar tlc2.TLC -config ${check.module}.cfg ${check.module}.tla`,
    coverage: `java -cp tla2tools.jar tlc2.TLC -coverage 1 -config ${model.name}Coverage.cfg ${check.module}.tla`,
  };
  return { exit: hasBlocking(findings) ? 'fail' : 'pass', document };
}

function ownedFile(files: TextFiles, role: TlaOwnedFileView['role'], file: string, expected: string): TlaOwnedFileView {
  if (!files.exists(file)) return { role, file, state: 'missing' };
  const found = files.read(file);
  return { role, file, state: found.ok && found.text === expected ? 'current' : 'stale' };
}

function invalid(fault: SpecTlaCheckDocument['fault'], message: string, file?: string): Outcome<SpecTlaCheckDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.tla.check', ok: false, fault, findings: [], issues: [specInput(file, message)] },
  };
}
