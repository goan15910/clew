// Use cases of projected views (clew spec projection ...): analyse which variables of a TLA+ model belong together,
// draft a view that keeps some of them, check with TLC that the model implements the view, dump and draw state
// graphs, and record which views were proposed and finalized, by whom and why.
//
// The analysis recommends and the agent decides. A view is a TLA+ module the agent owns; Clew owns the check module
// that instances it. Nothing here reads or writes the spec's sentences, lexicon, or workflows.
import { analyzeProjection, dependencyDot, draftView, evaluateKeep, viewCheckModule, PROJECTION_MODULE_PATTERN, type ProjectionAnalysis } from '../domain/projection.js';
import { graphStats, plainValue, projectGraph, readTlcDot, shortestPath, stateLabel, viewDot, type GraphView, type StateGraph } from '../domain/state-graph.js';
import { readTlcOutput, type TlcRunner } from './canon.js';
import { specInput, type Outcome, type ProjectionRecordView, type SpecProjectionDocument, type TlcResultView } from './documents.js';
import { DEFAULT_AUTHOR } from './edit-sentences.js';
import type { SpecStore, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface ProjectionCheckRecord {
  at: string;
  status: 'implements' | 'violation' | 'error' | 'timeout';
  view: string;
  model: string;
  viewHash: string;
  modelHash: string;
  states?: number;
  /** Steps of the view the model never takes, when the check ran with coverage. */
  neverTaken?: string[];
}

export interface ProjectionRecord {
  name: string;
  keep: string[];
  /** The analysis candidate it came from, when it came from one. */
  candidate?: string;
  status: 'proposed' | 'final' | 'dropped';
  check?: ProjectionCheckRecord;
  /** Every write, with who and why. */
  history: { at: string; who: string; reason: string; action: 'propose' | 'check' | 'finalize' | 'drop'; keep?: string[]; note?: string }[];
}

export interface ProjectionState {
  schemaVersion: 1;
  projections: ProjectionRecord[];
}

export interface ProjectionStore {
  read(session: string): { ok: true; state: ProjectionState | undefined } | { ok: false; message: string };
  write(session: string, state: ProjectionState): { ok: true } | { ok: false; message: string };
}

/** Draws Graphviz text as an image file. The format follows the file name: .svg, .png, or .dot. */
export interface GraphImageWriter {
  write(file: string, dot: string): { ok: true } | { ok: false; message: string };
}

export interface ProjectionFiles extends TextFiles {
  join(dir: string, file: string): string;
  dirname(file: string): string;
  /** A file for a state graph TLC dumps and Clew reads once. */
  temporary(name: string): string;
  remove(file: string): void;
  hash(text: string): string;
}

export interface ProjectionPorts {
  files: ProjectionFiles;
  tlc: TlcRunner;
  images: GraphImageWriter;
  store: SpecStore;
  projections: ProjectionStore;
  now(): string;
}

export interface TlcOptions {
  jar?: string;
  workers: number;
  timeoutSeconds: number;
}

type Doc = SpecProjectionDocument;

function invalid(command: Doc['command'], fault: NonNullable<Doc['fault']>, message: string, file?: string): Outcome<Doc> {
  return { exit: 'invalid', document: { command, ok: false, fault, findings: [], issues: [specInput(file, message)] } };
}

/** `--keep a,b --keep c` → a, b, c. */
export function keepList(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    // A comma inside brackets belongs to a part name such as `owner[a, b]`; plain names split at commas.
    for (const part of value.split(/,(?![^[]*\])/)) {
      const name = part.trim();
      if (name !== '' && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function loadGraph(command: Doc['command'], file: string, options: TlcOptions & { config?: string }, ports: ProjectionPorts): { ok: true; graph: StateGraph; tlc?: TlcResultView } | { ok: false; outcome: Outcome<Doc> } {
  if (/\.dot$/i.test(file)) {
    const read = ports.files.read(file);
    if (!read.ok) return { ok: false, outcome: invalid(command, 'unreadable', read.message, file) };
    const parsed = readTlcDot(read.text);
    if (!parsed.ok) return { ok: false, outcome: invalid(command, 'unreadable', parsed.message, file) };
    return { ok: true, graph: parsed.graph };
  }
  const dump = ports.files.temporary('graph.dot');
  try {
    const request: Parameters<TlcRunner['run']>[0] = { file, workers: options.workers, timeoutSeconds: options.timeoutSeconds, coverage: false, dump };
    if (options.config !== undefined) request.config = options.config;
    if (options.jar !== undefined) request.jar = options.jar;
    const ran = ports.tlc.run(request);
    if (!ran.ok) return { ok: false, outcome: invalid(command, 'tlc', ran.message, file) };
    const tlc = readTlcOutput(ran.run);
    if (tlc.status === 'error' || tlc.status === 'timeout') {
      return { ok: false, outcome: { exit: 'invalid', document: { command, ok: false, fault: 'tlc', tlc, findings: [], issues: [specInput(file, tlc.status === 'timeout' ? `TLC did not finish in ${options.timeoutSeconds} s: the model is too large to dump whole; draft a view of fewer variables and dump that` : (tlc.errors ?? []).join('\n') || 'TLC failed')] } } };
    }
    const read = ports.files.read(dump);
    if (!read.ok) return { ok: false, outcome: invalid(command, 'tlc', `TLC wrote no state graph: ${read.message}`, file) };
    const parsed = readTlcDot(read.text);
    if (!parsed.ok) return { ok: false, outcome: invalid(command, 'tlc', parsed.message, file) };
    return { ok: true, graph: parsed.graph, tlc };
  } finally {
    ports.files.remove(dump);
  }
}

function graphSummary(graph: StateGraph): NonNullable<Doc['graph']> {
  return { states: graph.states.length, edges: graph.edges.length, variables: graph.variables, parts: graph.parts };
}

export interface AnalyzeCommand extends TlcOptions {
  file: string;
  next?: string;
  keep: string[];
  /** A TLC dump (.dot), or a module (.tla) for TLC to dump: adds what the reachable states say. */
  graph?: string;
  /** Draw the dependency map here: .svg, .png, or .dot. */
  out?: string;
  config?: string;
}

/** Read-only: what each action reads and writes, the variable groups that follow, and what a `--keep` set would cost. */
export function analyzeProjectionCase(command: AnalyzeCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.analyze';
  const read = ports.files.read(command.file);
  if (!read.ok) return invalid(name, 'unreadable', read.message, command.file);
  const options: { next?: string } = {};
  if (command.next !== undefined) options.next = command.next;
  const analyzed = analyzeProjection(read.text, options);
  if (!analyzed.ok) return invalid(name, 'model', analyzed.message, command.file);
  const { analysis } = analyzed;
  const document: Doc = { command: name, ok: true, module: analysis.module, analysis, findings: [], issues: [] };
  const declared = new Set(analysis.variables.map((variable) => variable.name));
  const wholeKeep = command.keep.map((entry) => entry.replace(/\[.*$/, ''));
  const unknown = wholeKeep.filter((entry) => !declared.has(entry));
  if (unknown.length > 0) return invalid(name, 'model', `${analysis.module} has no variable ${unknown.join(', ')}; it has ${[...declared].join(', ')}`, command.file);
  if (command.keep.length > 0) document.evaluation = evaluateKeep(analysis, [...new Set(wholeKeep)]);
  if (command.graph !== undefined) {
    const loaded = loadGraph(name, command.graph, command, ports);
    if (!loaded.ok) return loaded.outcome;
    const { graph } = loaded;
    document.graph = graphSummary(graph);
    // A function-valued variable is read one instance at a time, unless that makes too many names to pair up.
    const whole = new Set(graph.parts.map((part) => part.replace(/\[.*$/, '')));
    const names = graph.parts.length <= 24 ? [...graph.variables.filter((variable) => !whole.has(variable)), ...graph.parts] : graph.variables;
    document.stats = graphStats(graph, names);
    const scored: NonNullable<Doc['scored']> = [];
    const score = (id: string, keep: readonly string[]): void => {
      const projected = projectGraph(graph, keep);
      if (!projected.ok) return;
      scored.push({ candidate: id, keep: [...keep], states: projected.view.states.length, edges: projected.view.edges.length, certain: projected.view.edges.filter((edge) => edge.certain).length, exactness: projected.view.exactness });
    };
    for (const candidate of analysis.candidates) if (candidate.keep.every((entry) => graph.variables.includes(entry))) score(candidate.id, candidate.keep);
    for (const part of graph.parts) score(`part:${part}`, [part]);
    if (command.keep.length > 0) score('keep', command.keep);
    document.scored = scored;
  }
  if (command.out !== undefined) {
    if (!/\.(svg|png|dot)$/i.test(command.out)) return invalid(name, 'model', `--out ${command.out}: the file name must end in .svg, .png, or .dot`);
    const wrote = ports.images.write(command.out, dependencyDot(analysis, [...new Set(wholeKeep)]));
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message, command.out);
    document.files = [{ path: command.out, written: true }];
  }
  return { exit: 'pass', document };
}

export interface DraftCommand {
  file: string;
  name: string;
  keep: string[];
  next?: string;
  dir?: string;
  dryRun: boolean;
  force: boolean;
}

/** Write a starter view: the model with the hidden variables cut out. The view is the author's from then on. */
export function draftProjection(command: DraftCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.draft';
  if (!PROJECTION_MODULE_PATTERN.test(command.name)) return invalid(name, 'model', `"${command.name}" is not a TLA+ module name: use letters, digits, and _`);
  const read = ports.files.read(command.file);
  if (!read.ok) return invalid(name, 'unreadable', read.message, command.file);
  const options: Parameters<typeof draftView>[1] = { name: command.name, keep: command.keep };
  if (command.next !== undefined) options.next = command.next;
  const drafted = draftView(read.text, options);
  if (!drafted.ok) return invalid(name, 'model', drafted.message, command.file);
  const { tla, cfg, ...summary } = drafted.draft;
  const document: Doc = { command: name, ok: true, module: command.name, draft: summary, findings: [], issues: [] };
  if (command.dryRun) {
    document.tla = { view: tla, cfg };
    return { exit: summary.needsInput.length > 0 ? 'fail' : 'pass', document };
  }
  const dir = command.dir ?? ports.files.dirname(command.file);
  const files: NonNullable<Doc['files']> = [];
  const target = ports.files.join(dir, `${command.name}.tla`);
  if (ports.files.exists(target) && !command.force) return invalid(name, 'exists', `${target} exists and is yours: pass --force to replace it with a fresh draft, or pick another --name`);
  for (const [file, text] of [[`${command.name}.tla`, tla], [`${command.name}.cfg`, cfg]] as const) {
    const wrote = ports.files.write(ports.files.join(dir, file), text);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
    files.push({ path: ports.files.join(dir, file), module: command.name, written: true });
  }
  document.files = files;
  return { exit: summary.needsInput.length > 0 ? 'fail' : 'pass', document };
}

export interface CheckCommand extends TlcOptions {
  view: string;
  against: string;
  map: string[];
  spec?: string;
  next?: string;
  cover: boolean;
  /** Record the result on this projection of the session. */
  name?: string;
  sessionId?: string;
  by?: string;
}

function parseMap(entries: readonly string[]): { ok: true; map: Record<string, string> } | { ok: false; message: string } {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*<-\s*([\s\S]+)$/.exec(entry);
    if (match === null || match[1] === undefined || match[2] === undefined) return { ok: false, message: `--map "${entry}": write it as "viewVariable <- expression over the model's variables"` };
    map[match[1]] = match[2].trim();
  }
  return { ok: true, map };
}

/**
 * Ask TLC whether the model implements the view: write the check module beside the two, run TLC, and read the result.
 * With `cover`, TLC also counts how often the model takes each step of the view.
 */
export function checkProjection(command: CheckCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.check';
  const view = ports.files.read(command.view);
  if (!view.ok) return invalid(name, 'unreadable', view.message, command.view);
  const model = ports.files.read(command.against);
  if (!model.ok) return invalid(name, 'unreadable', model.message, command.against);
  const dir = ports.files.dirname(command.view);
  if (ports.files.dirname(command.against) !== dir) return invalid(name, 'model', `the view and the model must be in one directory, so TLC finds both: ${command.view} and ${command.against} are not`);
  const map = parseMap(command.map);
  if (!map.ok) return invalid(name, 'model', map.message);
  const input: Parameters<typeof viewCheckModule>[0] = { base: model.text, view: view.text, map: map.map };
  if (command.spec !== undefined) input.spec = command.spec;
  if (command.next !== undefined) input.next = command.next;
  const built = viewCheckModule(input);
  if (!built.ok) return invalid(name, 'model', built.message);
  const { check } = built;
  if (command.name !== undefined) {
    // Fail before the TLC run, not after it, when the projection was never proposed.
    const found = findRecord(name, command.sessionId, command.name, ports);
    if (!found.ok) return found.outcome;
  }
  const files: NonNullable<Doc['files']> = [];
  for (const [file, text] of [[`${check.module}.tla`, check.tla], [`${check.module}.cfg`, check.cfg], [`${check.module}Cover.cfg`, check.coverCfg]] as const) {
    const wrote = ports.files.write(ports.files.join(dir, file), text);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
    files.push({ path: ports.files.join(dir, file), module: check.module, written: true });
  }
  const request: Parameters<TlcRunner['run']>[0] = {
    file: ports.files.join(dir, `${check.module}.tla`),
    config: ports.files.join(dir, command.cover ? `${check.module}Cover.cfg` : `${check.module}.cfg`),
    workers: command.workers,
    timeoutSeconds: command.timeoutSeconds,
    coverage: command.cover,
  };
  if (command.jar !== undefined) request.jar = command.jar;
  const ran = ports.tlc.run(request);
  if (!ran.ok) return invalid(name, 'tlc', ran.message);
  const tlc = readTlcOutput(ran.run);
  const viewModule = /MODULE\s+(\w+)/.exec(view.text)?.[1] ?? command.view;
  const modelModule = /MODULE\s+(\w+)/.exec(model.text)?.[1] ?? command.against;
  const result: NonNullable<Doc['check']> = { view: viewModule, model: modelModule, mapping: check.mapping, implements: tlc.status === 'pass', steps: check.actions.map((action) => action.name) };
  if (command.cover && tlc.coverage !== undefined) {
    const taken = new Map(tlc.coverage.map((row) => [row.action, row.total]));
    result.neverTaken = check.actions.map((action) => action.name).filter((action) => taken.get(action) === 0);
    result.hiddenSteps = taken.get('Hidden') ?? 0;
    delete tlc.coverage;
  }
  const document: Doc = { command: name, ok: tlc.status !== 'error', module: viewModule, check: result, files, tlc, findings: [], issues: [] };
  if (tlc.status === 'error') document.issues.push(specInput(request.file, (tlc.errors ?? []).join('\n') || 'TLC failed'));
  // Read the record again now: a check runs for minutes, and another check may have written meanwhile.
  const record = command.name === undefined ? undefined : findRecord(name, command.sessionId, command.name, ports);
  if (record !== undefined && !record.ok) return record.outcome;
  if (record !== undefined) {
    const entry: ProjectionCheckRecord = {
      at: ports.now(),
      status: tlc.status === 'pass' ? 'implements' : tlc.status,
      view: command.view,
      model: command.against,
      viewHash: ports.files.hash(view.text),
      modelHash: ports.files.hash(model.text),
    };
    if (tlc.states !== undefined) entry.states = tlc.states.distinct;
    if (result.neverTaken !== undefined) entry.neverTaken = result.neverTaken;
    record.entry.check = entry;
    record.entry.history.push({ at: entry.at, who: command.by ?? DEFAULT_AUTHOR, reason: `TLC: ${entry.status}`, action: 'check' });
    // A view that changed after it was finalized is a proposal again.
    if (record.entry.status === 'final') record.entry.status = 'proposed';
    const wrote = ports.projections.write(record.session, record.state);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
    document.session = record.session;
    document.projections = [recordView(record.entry, ports)];
  }
  return { exit: tlc.status === 'pass' ? 'pass' : tlc.status === 'error' ? 'invalid' : 'fail', document };
}

export interface DumpCommand extends TlcOptions {
  file: string;
  config?: string;
  out: string;
}

/** Run TLC and keep the state graph it dumps, for `analyze --graph` and `render` to read again. */
export function dumpStateGraph(command: DumpCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.dump';
  const request: Parameters<TlcRunner['run']>[0] = { file: command.file, workers: command.workers, timeoutSeconds: command.timeoutSeconds, coverage: false, dump: command.out };
  if (command.config !== undefined) request.config = command.config;
  if (command.jar !== undefined) request.jar = command.jar;
  const ran = ports.tlc.run(request);
  if (!ran.ok) return invalid(name, 'tlc', ran.message, command.file);
  const tlc = readTlcOutput(ran.run);
  const document: Doc = { command: name, ok: tlc.status !== 'error', tlc, findings: [], issues: [] };
  if (tlc.status === 'error' || tlc.status === 'timeout') {
    document.ok = false;
    document.fault = 'tlc';
    document.issues.push(specInput(command.file, tlc.status === 'timeout' ? `TLC did not finish in ${command.timeoutSeconds} s` : (tlc.errors ?? []).join('\n') || 'TLC failed'));
    return { exit: 'invalid', document };
  }
  const read = ports.files.read(command.out);
  if (!read.ok) return invalid(name, 'tlc', `TLC wrote no state graph: ${read.message}`, command.file);
  const parsed = readTlcDot(read.text);
  if (!parsed.ok) return invalid(name, 'tlc', parsed.message, command.out);
  document.graph = graphSummary(parsed.graph);
  document.files = [{ path: command.out, written: true }];
  return { exit: tlc.status === 'pass' ? 'pass' : 'fail', document };
}

export interface RenderCommand extends TlcOptions {
  /** A TLC dump (.dot) or a module (.tla) for TLC to dump. */
  file: string;
  config?: string;
  keep: string[];
  out?: string;
  title?: string;
  /** `variable=value` conditions of the state a highlighted path leads to. */
  to: string[];
  maxStates: number;
  direction: 'LR' | 'TB';
}

function viewSummary(view: GraphView, pathLength: number | undefined): NonNullable<Doc['view']> {
  const byId = new Map(view.states.map((state) => [state.id, stateLabel(view, state).join(', ')]));
  const summary: NonNullable<Doc['view']> = {
    variables: view.variables,
    states: view.states.length,
    edges: view.edges.length,
    exactness: view.exactness,
    fullStates: view.fullStates,
    fullEdges: view.fullEdges,
    possible: view.edges.filter((edge) => !edge.certain).map((edge) => ({ from: byId.get(edge.from) ?? edge.from, action: edge.action, to: byId.get(edge.to) ?? edge.to, sources: edge.sources, of: view.states.find((state) => state.id === edge.from)?.members ?? 0 })),
    terminal: view.states.filter((state) => state.terminal).map((state) => byId.get(state.id) ?? state.id),
  };
  if (pathLength !== undefined) summary.pathLength = pathLength;
  return summary;
}

/** Draw a state graph, whole or projected onto `keep`, as SVG, PNG, or Graphviz text. */
export function renderProjection(command: RenderCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.render';
  if (command.out !== undefined && !/\.(svg|png|dot)$/i.test(command.out)) return invalid(name, 'model', `--out ${command.out}: the file name must end in .svg, .png, or .dot`);
  const loaded = loadGraph(name, command.file, command, ports);
  if (!loaded.ok) return loaded.outcome;
  const projected = projectGraph(loaded.graph, command.keep);
  if (!projected.ok) return invalid(name, 'model', projected.message, command.file);
  const { view } = projected;
  let path: string[] | undefined;
  if (command.to.length > 0) {
    const wanted: [string, string][] = [];
    for (const entry of command.to) {
      const at = entry.indexOf('=');
      if (at < 1) return invalid(name, 'model', `--to "${entry}": write it as variable=value`);
      wanted.push([entry.slice(0, at).trim(), entry.slice(at + 1).trim()]);
    }
    const strangers = wanted.filter(([variable]) => !view.variables.includes(variable)).map(([variable]) => variable);
    if (strangers.length > 0) return invalid(name, 'model', `--to names ${strangers.join(', ')}, which the view does not keep; it keeps ${view.variables.join(', ')}`);
    path = shortestPath(view, (state) => wanted.every(([variable, value]) => plainValue(state.values[variable] ?? '') === plainValue(value)));
    if (path === undefined) return invalid(name, 'model', `no reachable state of the view has ${command.to.join(' and ')}`);
  }
  const document: Doc = { command: name, ok: true, graph: graphSummary(loaded.graph), view: viewSummary(view, path?.length), findings: [], issues: [] };
  if (loaded.tlc !== undefined) document.tlc = loaded.tlc;
  if (command.out === undefined) return { exit: 'pass', document };
  if (view.states.length > command.maxStates && !/\.dot$/i.test(command.out)) {
    return invalid(name, 'too-large', `the view has ${view.states.length} states, more than a picture can show (--max-states ${command.maxStates}): keep fewer variables with --keep, or write .dot and lay it out yourself`, command.file);
  }
  const options: Parameters<typeof viewDot>[1] = { direction: command.direction };
  if (command.title !== undefined) options.title = command.title;
  if (path !== undefined) options.path = path;
  const wrote = ports.images.write(command.out, viewDot(view, options));
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message, command.out);
  document.files = [{ path: command.out, written: true }];
  return { exit: 'pass', document };
}

/**
 * The record as a document shows it. Whether the stored check still describes the files is worked out here, on every
 * read, and never stored: the check is current while the view and the model hash to what TLC was given.
 */
function recordView(record: ProjectionRecord, ports: ProjectionPorts): ProjectionRecordView {
  const view: ProjectionRecordView = { name: record.name, keep: record.keep, status: record.status, history: record.history };
  if (record.candidate !== undefined) view.candidate = record.candidate;
  if (record.check !== undefined) {
    const { check } = record;
    const same = (file: string, hash: string): boolean => {
      const read = ports.files.read(file);
      return read.ok && ports.files.hash(read.text) === hash;
    };
    view.check = { ...check, current: same(check.view, check.viewHash) && same(check.model, check.modelHash) };
  }
  return view;
}

function loadState(command: Doc['command'], sessionId: string | undefined, ports: ProjectionPorts): { ok: true; session: string; state: ProjectionState } | { ok: false; outcome: Outcome<Doc> } {
  const resolved = resolveSession(ports.store, sessionId);
  if (!resolved.ok) return { ok: false, outcome: invalid(command, 'session', resolved.message) };
  const read = ports.projections.read(resolved.id);
  if (!read.ok) return { ok: false, outcome: invalid(command, 'unreadable', read.message) };
  return { ok: true, session: resolved.id, state: read.state ?? { schemaVersion: 1, projections: [] } };
}

function findRecord(command: Doc['command'], sessionId: string | undefined, name: string, ports: ProjectionPorts): { ok: true; session: string; state: ProjectionState; entry: ProjectionRecord } | { ok: false; outcome: Outcome<Doc> } {
  const loaded = loadState(command, sessionId, ports);
  if (!loaded.ok) return loaded;
  const entry = loaded.state.projections.find((record) => record.name === name);
  if (entry === undefined) return { ok: false, outcome: invalid(command, 'projection', `session "${loaded.session}" has no projection "${name}"; propose it first with clew spec projection propose --name ${name} --keep ... --reason "..."`) };
  return { ok: true, session: loaded.session, state: loaded.state, entry };
}

export interface ProposeCommand {
  sessionId?: string;
  name: string;
  keep: string[];
  candidate?: string;
  reason: string;
  by?: string;
}

/** Record a view someone means to build: its name, the variables it keeps, and why. Proposing again changes the keep set. */
export function proposeProjection(command: ProposeCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.propose';
  if (!PROJECTION_MODULE_PATTERN.test(command.name)) return invalid(name, 'model', `"${command.name}" is not a TLA+ module name: use letters, digits, and _`);
  if (command.keep.length === 0) return invalid(name, 'model', 'a projection keeps at least one variable: pass --keep');
  const loaded = loadState(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  const at = ports.now();
  let entry = loaded.state.projections.find((record) => record.name === command.name);
  if (entry === undefined) {
    entry = { name: command.name, keep: command.keep, status: 'proposed', history: [] };
    loaded.state.projections.push(entry);
  } else {
    entry.keep = command.keep;
    entry.status = 'proposed';
    delete entry.check;
  }
  if (command.candidate !== undefined) entry.candidate = command.candidate;
  entry.history.push({ at, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'propose', keep: command.keep });
  const wrote = ports.projections.write(loaded.session, loaded.state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  return { exit: 'pass', document: { command: name, ok: true, session: loaded.session, projections: [recordView(entry, ports)], findings: [], issues: [] } };
}

export interface FinalizeCommand {
  sessionId?: string;
  name: string;
  reason: string;
  by?: string;
  drop: boolean;
}

/**
 * Finalize a projection: its last check must say the model implements the view, and neither file may have changed
 * since. `drop` records instead that the projection was given up, and why.
 */
export function finalizeProjection(command: FinalizeCommand, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.finalize';
  const found = findRecord(name, command.sessionId, command.name, ports);
  if (!found.ok) return found.outcome;
  const { entry } = found;
  const at = ports.now();
  if (command.drop) {
    entry.status = 'dropped';
    entry.history.push({ at, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'drop' });
  } else {
    const { check } = entry;
    if (check === undefined) return invalid(name, 'unchecked', `projection "${entry.name}" has no check: run clew spec projection check <View.tla> --against <Model.tla> --name ${entry.name}`);
    if (check.status !== 'implements') return invalid(name, 'unchecked', `the last check of "${entry.name}" ended in ${check.status}: the model does not implement the view yet`);
    for (const [file, hash, label] of [[check.view, check.viewHash, 'view'], [check.model, check.modelHash, 'model']] as const) {
      const read = ports.files.read(file);
      if (!read.ok) return invalid(name, 'unreadable', read.message, file);
      if (ports.files.hash(read.text) !== hash) return invalid(name, 'stale', `the ${label} ${file} changed since the last check of "${entry.name}": check again`);
    }
    entry.status = 'final';
    const note = check.neverTaken !== undefined && check.neverTaken.length > 0 ? `the model never takes ${check.neverTaken.join(', ')}` : undefined;
    const line: ProjectionRecord['history'][number] = { at, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'finalize' };
    if (note !== undefined) line.note = note;
    entry.history.push(line);
  }
  const wrote = ports.projections.write(found.session, found.state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  return { exit: 'pass', document: { command: name, ok: true, session: found.session, projections: [recordView(entry, ports)], findings: [], issues: [] } };
}

/** Read-only: every projection of the session, with its history. */
export function listProjections(command: { sessionId?: string }, ports: ProjectionPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.projection.list';
  const loaded = loadState(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  return { exit: 'pass', document: { command: name, ok: true, session: loaded.session, projections: loaded.state.projections.map((record) => recordView(record, ports)), findings: [], issues: [] } };
}

export type { ProjectionAnalysis };
