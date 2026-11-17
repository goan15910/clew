// Use cases of the canonical pipeline: a lexicon per session, the parse gate over the live sentences, accepting a
// draft rewrite, merging sentences into one action block, exporting the blocks as TLA+, and running TLC.
// Sentences stay where they are (the session's sentence history); this pipeline reads the latest text of each.
// A sentence that does not pass the gate is dangling: it never reaches the model.
import { emptyLexicon, type CanonLexicon } from '../domain/canon-ast.js';
import { compileCanon, type CanonModel } from '../domain/canon-compile.js';
import { runGate, type GateResult } from '../domain/canon-gate.js';
import { canonTlaFiles, CANON_MODULE_PATTERN } from '../domain/canon-tla.js';
import { liveSentences, type SpecSnapshot } from '../domain/spec.js';
import { specInput, type CanonActionView, type DanglingView, type Outcome, type SpecCanonDocument, type TlcResultView } from './documents.js';
import { DEFAULT_AUTHOR, editSentence } from './edit-sentences.js';
import type { CanonParserFactory, CanonHistoryEntry, CanonState, CanonStore, MilestoneStore, PosTaggerPort, SpecStore, SpecTextSource, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';
import { resolveVersion } from './versions.js';

export type { CanonHistoryEntry, CanonState, CanonStore } from './ports.js';

export interface CanonLexiconSource {
  load(file: string): { ok: true; lexicon: CanonLexicon } | { ok: false; message: string };
}

export interface TlcRequest {
  file: string;
  config?: string;
  jar?: string;
  workers: number;
  timeoutSeconds: number;
  coverage: boolean;
  /** Write the reachable state graph to this file (`-dump dot,actionlabels`). */
  dump?: string;
}

export interface TlcRun {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  command: string;
}

export interface TlcRunner {
  run(request: TlcRequest): { ok: true; run: TlcRun } | { ok: false; message: string };
}

export interface CanonPorts {
  store: SpecStore;
  canon: CanonStore;
  parser: CanonParserFactory;
  /** Needed only to read an earlier version (--at). */
  milestones?: MilestoneStore;
}

type Doc = SpecCanonDocument;

function invalid(command: Doc['command'], fault: NonNullable<Doc['fault']>, message: string): Outcome<Doc> {
  return { exit: 'invalid', document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] } };
}

interface Loaded {
  snapshot: SpecSnapshot;
  state: CanonState;
}

function load(command: Doc['command'], sessionId: string | undefined, ports: CanonPorts, needLexicon: boolean, at?: string): { ok: true; value: Loaded } | { ok: false; outcome: Outcome<Doc> } {
  const resolved = resolveSession(ports.store, sessionId);
  if (!resolved.ok) return { ok: false, outcome: invalid(command, 'session', resolved.message) };
  let snapshot: SpecSnapshot;
  let state: CanonState | undefined;
  if (at !== undefined && at !== 'latest') {
    // An earlier version: the sentences and lexicon a milestone froze, or the original spec (which has no lexicon).
    if (ports.milestones === undefined) return { ok: false, outcome: invalid(command, 'version', '--at needs the milestone store') };
    const version = resolveVersion({ store: ports.store, canon: ports.canon, milestones: ports.milestones }, resolved.id, at);
    if (!version.ok) return { ok: false, outcome: invalid(command, version.fault, version.message) };
    snapshot = version.version.snapshot;
    state = version.version.canon;
    if (state === undefined && needLexicon) {
      return { ok: false, outcome: invalid(command, 'lexicon', at === 'original' ? 'the original spec has no canonical lexicon; name a milestone closed after clew spec canon lexicon ran' : `milestone ${at} has no canonical lexicon: it was closed before clew spec canon lexicon ran`) };
    }
  } else {
    const result = ports.store.update(resolved.id, { create: false }, () => undefined);
    if (!result.ok) return { ok: false, outcome: invalid(command, result.fault === 'missing' ? 'session' : result.fault, result.message) };
    const read = ports.canon.read(resolved.id);
    if (!read.ok) return { ok: false, outcome: invalid(command, 'unreadable', read.message) };
    if (read.state === undefined && needLexicon) {
      return { ok: false, outcome: invalid(command, 'lexicon', 'no canonical lexicon in this session; run clew spec canon lexicon --file lexicon.json --reason "..." first') };
    }
    snapshot = result.snapshot;
    state = read.state;
  }
  return { ok: true, value: { snapshot, state: state ?? { schemaVersion: 1, lexicon: emptyLexicon(), history: [] } } };
}

/** The gate over every live sentence of the session. */
export function gateSession(snapshot: SpecSnapshot, lexicon: CanonLexicon, parser: CanonParserFactory): GateResult {
  const parse = parser.forLexicon(lexicon);
  return runGate(liveSentences(snapshot.sentences).map((sentence) => ({ id: sentence.id, text: sentence.text })), lexicon, (text) => parse.parse(text));
}

export function compileGate(gate: GateResult, lexicon: CanonLexicon): CanonModel {
  const accepted = [];
  for (const sentence of gate.sentences) {
    if (sentence.status === 'accepted' && sentence.statement !== undefined) accepted.push({ id: sentence.id, text: sentence.text, statement: sentence.statement });
  }
  return compileCanon(accepted, lexicon);
}

function danglingViews(gate: GateResult): DanglingView[] {
  const views: DanglingView[] = [];
  for (const sentence of gate.sentences) {
    if (sentence.status !== 'dangling') continue;
    const view: DanglingView = { id: sentence.id, text: sentence.text, diagnostics: sentence.diagnostics };
    if (sentence.draft !== undefined) view.draft = sentence.draft;
    views.push(view);
  }
  return views;
}

function actionViews(model: CanonModel): CanonActionView[] {
  return model.actions.map((action) => ({
    name: action.name,
    sentence: action.sentence,
    branch: action.branch,
    actor: action.actor,
    event: action.event,
    object: action.object,
    guards: action.guards.map((item) => ({ tla: item.tla, from: item.from, words: item.words, span: item.span })),
    effects: action.effects.map((item) => ({ tla: item.tla, from: item.from, words: item.words, span: item.span })),
  }));
}

export function setCanonLexicon(
  command: { sessionId?: string; file: string; reason: string; by?: string },
  ports: CanonPorts,
  source: CanonLexiconSource,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.lexicon';
  const loaded = load(name, command.sessionId, ports, false);
  if (!loaded.ok) return loaded.outcome;
  const lexicon = source.load(command.file);
  if (!lexicon.ok) return invalid(name, 'lexicon', lexicon.message);
  const state: CanonState = {
    schemaVersion: 1,
    lexicon: lexicon.lexicon,
    history: [...loaded.value.state.history, { at: new Date().toISOString(), who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'lexicon' }],
  };
  const wrote = ports.canon.write(loaded.value.snapshot.id, state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  const gate = gateSession(loaded.value.snapshot, state.lexicon, ports.parser);
  return {
    exit: 'pass',
    document: {
      command: name,
      ok: true,
      session: loaded.value.snapshot.id,
      parser: ports.parser.name,
      lexicon: state.lexicon,
      accepted: gate.sentences.filter((sentence) => sentence.status === 'accepted').map((sentence) => sentence.id),
      dangling: danglingViews(gate),
      findings: [],
      issues: [],
    },
  };
}

export function checkCanon(command: { sessionId?: string; sentence?: string; at?: string }, ports: CanonPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.check';
  const loaded = load(name, command.sessionId, ports, true, command.at);
  if (!loaded.ok) return loaded.outcome;
  const { snapshot, state } = loaded.value;
  const gate = gateSession(snapshot, state.lexicon, ports.parser);
  if (command.sentence !== undefined && !gate.sentences.some((sentence) => sentence.id === command.sentence)) {
    return invalid(name, 'session', `no live sentence "${command.sentence}"`);
  }
  const model = compileGate(gate, state.lexicon);
  const only = (id: string): boolean => command.sentence === undefined || id === command.sentence;
  const dangling = danglingViews(gate).filter((view) => only(view.id));
  const blocking = model.findings.some((finding) => finding.severity === 'blocking');
  return {
    exit: dangling.length > 0 || blocking ? 'fail' : 'pass',
    document: {
      command: name,
      ok: true,
      session: snapshot.id,
      ...(command.at === undefined ? {} : { at: command.at }),
      parser: ports.parser.name,
      accepted: gate.sentences.filter((sentence) => sentence.status === 'accepted' && only(sentence.id)).map((sentence) => sentence.id),
      dangling,
      knownStates: gate.known,
      actions: actionViews(model).filter((action) => only(action.sentence)),
      model: {
        nouns: model.nouns,
        links: model.links,
        conditions: model.conditions,
        refusals: model.refusals.map((refusal) => refusal.name),
        invariants: model.invariants.map((invariant) => invariant.name),
      },
      canonFindings: model.findings.filter((finding) => finding.sentence === undefined || only(finding.sentence)),
      findings: [],
      issues: [],
    },
  };
}

/** Replace a dangling sentence with its draft. The sentence keeps its id and history, so the draft links to its original. */
export function acceptCanonDraft(
  command: { sessionId?: string; id: string; reason: string; descriptive?: string; by?: string },
  ports: CanonPorts,
  tagger: PosTaggerPort,
  text: Pick<SpecTextSource, 'hash'>,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.accept';
  const loaded = load(name, command.sessionId, ports, true);
  if (!loaded.ok) return loaded.outcome;
  const { snapshot, state } = loaded.value;
  const gate = gateSession(snapshot, state.lexicon, ports.parser);
  const sentence = gate.sentences.find((item) => item.id === command.id);
  if (sentence === undefined) return invalid(name, 'session', `no live sentence "${command.id}"`);
  if (sentence.status === 'accepted') return invalid(name, 'gate', `${command.id} already passes the gate`);
  const draft = sentence.draft;
  if (draft === undefined) return invalid(name, 'gate', `${command.id} has no draft rewrite: edit it with clew spec sentences edit`);
  if (!draft.parses) {
    return invalid(name, 'gate', `the draft of ${command.id} does not pass the gate yet (${draft.needsInput ? 'it has a placeholder to fill in' : draft.remaining[0]?.message ?? 'it still fails'}): write the sentence with clew spec sentences edit`);
  }
  if (draft.dropped.length > 0 && command.descriptive === undefined) {
    return invalid(name, 'gate', `the draft of ${command.id} leaves out ${draft.dropped.map((word) => `"${word}"`).join(', ')}: restate it in a slot with clew spec sentences edit, or pass --descriptive with the reason it has no behaviour`);
  }
  const notes = [...draft.notes];
  if (command.descriptive !== undefined) notes.push(`left out as descriptive: ${command.descriptive}`);
  const edit: Parameters<typeof editSentence>[0] = {
    action: 'edit',
    id: command.id,
    text: draft.text,
    reason: command.reason,
    comment: `canonical draft accepted. ${notes.join('; ')}`,
  };
  if (command.sessionId !== undefined) edit.sessionId = command.sessionId;
  if (command.by !== undefined) edit.by = command.by;
  const edited = editSentence(edit, ports.store, tagger, text);
  if (edited.exit === 'invalid') return invalid(name, 'session', edited.document.issues[0]?.message ?? 'the sentence edit failed');
  const entry: CanonHistoryEntry = { at: new Date().toISOString(), who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'accept', sentence: command.id, from: sentence.text, to: draft.text, notes, dropped: draft.dropped };
  if (command.descriptive !== undefined) entry.descriptive = command.descriptive;
  const wrote = ports.canon.write(snapshot.id, { ...state, history: [...state.history, entry] });
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  return {
    exit: 'pass',
    document: { command: name, ok: true, session: snapshot.id, sentence: { id: command.id, from: sentence.text, to: draft.text, notes, dropped: draft.dropped }, findings: [], issues: [] },
  };
}

/** Restate several sentences as one action block: add the block, then delete each source with a reason that names it. */
export function mergeCanon(
  command: { sessionId?: string; ids: string[]; text: string; reason: string; by?: string },
  ports: CanonPorts,
  tagger: PosTaggerPort,
  hash: Pick<SpecTextSource, 'hash'>,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.merge';
  const loaded = load(name, command.sessionId, ports, true);
  if (!loaded.ok) return loaded.outcome;
  const { snapshot, state } = loaded.value;
  const live = new Set(liveSentences(snapshot.sentences).map((sentence) => sentence.id));
  for (const id of command.ids) if (!live.has(id)) return invalid(name, 'session', `no live sentence "${id}"`);
  if (command.ids.length < 2) return invalid(name, 'gate', 'merge takes at least two sentences');
  const parse = ports.parser.forLexicon(state.lexicon);
  const probe = runGate([...liveSentences(snapshot.sentences).filter((sentence) => !command.ids.includes(sentence.id)).map((sentence) => ({ id: sentence.id, text: sentence.text })), { id: 'merged', text: command.text }], state.lexicon, (text) => parse.parse(text));
  const merged = probe.sentences.find((sentence) => sentence.id === 'merged');
  if (merged === undefined || merged.status !== 'accepted') {
    const first = merged?.diagnostics[0];
    return invalid(name, 'gate', `the block does not pass the gate${first === undefined ? '' : `: ${first.message} at "${first.found}"`}${merged?.draft?.parses === true ? `; draft: ${merged.draft.text}` : ''}`);
  }
  const base: { sessionId?: string; by?: string } = {};
  if (command.sessionId !== undefined) base.sessionId = command.sessionId;
  if (command.by !== undefined) base.by = command.by;
  const added = editSentence({ ...base, action: 'add', text: command.text, after: command.ids[0], reason: command.reason, comment: `action block merging ${command.ids.join(', ')}` }, ports.store, tagger, hash);
  if (added.exit === 'invalid' || added.document.sentence === undefined) return invalid(name, 'session', added.document.issues[0]?.message ?? 'adding the block failed');
  const into = added.document.sentence.id;
  for (const id of command.ids) {
    const removed = editSentence({ ...base, action: 'delete', id, reason: `merged into ${into}: ${command.reason}` }, ports.store, tagger, hash);
    if (removed.exit === 'invalid') return invalid(name, 'session', removed.document.issues[0]?.message ?? `deleting ${id} failed`);
  }
  const wrote = ports.canon.write(snapshot.id, { ...state, history: [...state.history, { at: new Date().toISOString(), who: command.by ?? DEFAULT_AUTHOR, reason: command.reason, action: 'merge', sentence: into, to: command.text, merged: command.ids }] });
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  return { exit: 'pass', document: { command: name, ok: true, session: snapshot.id, merged: { into, from: command.ids }, findings: [], issues: [] } };
}

export function exportCanon(
  command: { sessionId?: string; dir?: string; name: string; dryRun: boolean; force: boolean; at?: string },
  ports: CanonPorts,
  files: TextFiles & { join(dir: string, file: string): string },
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.export';
  if (!CANON_MODULE_PATTERN.test(command.name)) return invalid(name, 'unreadable', `--name "${command.name}": a TLA+ module name starts with a letter and then uses letters, digits, or underscores`);
  const loaded = load(name, command.sessionId, ports, true, command.at);
  if (!loaded.ok) return loaded.outcome;
  const { snapshot, state } = loaded.value;
  const gate = gateSession(snapshot, state.lexicon, ports.parser);
  const model = compileGate(gate, state.lexicon);
  if (model.actions.length === 0) return invalid(name, 'gate', 'no accepted sentence states an action yet; run clew spec canon check');
  const tla = canonTlaFiles({ name: command.name, session: snapshot.id, model });
  const dangling = danglingViews(gate);
  const document: Doc = {
    command: name,
    ok: true,
    session: snapshot.id,
    ...(command.at === undefined ? {} : { at: command.at }),
    accepted: gate.sentences.filter((sentence) => sentence.status === 'accepted').map((sentence) => sentence.id),
    dangling,
    actions: actionViews(model),
    canonFindings: model.findings,
    findings: [],
    issues: [],
  };
  const out = (file: string): string => (command.dir === undefined ? file : files.join(command.dir, file));
  const owned: [string, string, string][] = [
    [`${tla.blocks.module}.tla`, tla.blocks.module, tla.blocks.tla],
    [`${tla.blocks.module}.cfg`, tla.blocks.module, tla.blocks.cfg],
    [`${tla.check.module}.tla`, tla.check.module, tla.check.tla],
    [`${tla.check.module}.cfg`, tla.check.module, tla.check.cfg],
    [`${command.name}Coverage.cfg`, tla.check.module, tla.check.coverageCfg],
  ];
  document.run = {
    blocks: `clew spec canon tlc ${out(`${tla.blocks.module}.tla`)}`,
    refinement: `clew spec canon tlc ${out(`${tla.check.module}.tla`)}`,
    coverage: `clew spec canon tlc ${out(`${tla.check.module}.tla`)} --config ${out(`${command.name}Coverage.cfg`)} --coverage`,
  };
  if (command.dryRun || command.dir === undefined) {
    document.tla = { blocks: tla.blocks.tla, cfg: tla.blocks.cfg, model: tla.model.tla, check: tla.check.tla, checkCfg: tla.check.cfg, coverageCfg: tla.check.coverageCfg };
    return { exit: dangling.length > 0 ? 'fail' : 'pass', document };
  }
  document.files = [];
  for (const [file, module, text] of owned) {
    const wrote = files.write(out(file), text);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
    document.files.push({ path: out(file), module, written: true });
  }
  const modelFile = out(`${command.name}.tla`);
  if (files.exists(modelFile) && !command.force) {
    document.files.push({ path: modelFile, module: command.name, written: false, kept: true });
  } else {
    const wrote = files.write(modelFile, tla.model.tla);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
    document.files.push({ path: modelFile, module: command.name, written: true });
  }
  return { exit: dangling.length > 0 ? 'fail' : 'pass', document };
}

/** Run TLC on a module and read the result back: the violation, its trace mapped to sentences, coverage, and counts. */
export function runCanonTlc(request: TlcRequest, runner: TlcRunner): Outcome<Doc> {
  const name: Doc['command'] = 'spec.canon.tlc';
  const ran = runner.run(request);
  if (!ran.ok) return invalid(name, 'unreadable', ran.message);
  const tlc = readTlcOutput(ran.run);
  return { exit: tlc.status === 'pass' ? 'pass' : tlc.status === 'error' ? 'invalid' : 'fail', document: { command: name, ok: tlc.status !== 'error', tlc, findings: [], issues: tlc.status === 'error' ? [specInput(request.file, (tlc.errors ?? []).join('\n') || 'TLC failed')] : [] } };
}

/** The sentence an action, invariant, or refusal name was compiled from: `ApproveOrder_s3_2` → `s3`. */
export function sentenceOfName(name: string): string | undefined {
  const match = /_(s[1-9][0-9]*)(?:_[0-9]+)?$/.exec(name);
  return match?.[1];
}

export function readTlcOutput(run: TlcRun): TlcResultView {
  const lines = run.output.split(/\r?\n/).filter((line) => !line.startsWith('Picked up JAVA_TOOL_OPTIONS'));
  const view: TlcResultView = { status: 'pass', command: run.command };
  const errors: string[] = [];
  let violation: TlcResultView['violation'];
  for (const line of lines) {
    let match = /^Error: Invariant (\S+) is violated/.exec(line);
    if (match !== null) {
      const name = match[1] ?? '';
      violation = { kind: 'invariant', name, message: line.replace(/^Error: /, '') };
      const sentence = sentenceOfName(name);
      if (sentence !== undefined) violation.sentence = sentence;
      continue;
    }
    match = /^Error: (?:Action property|Temporal properties were violated|Property) ?(\S+)?/.exec(line);
    if (match !== null && violation === undefined) {
      const named = /property (\S+) of module/.exec(line)?.[1] ?? /^Error: Action property (\S+)/.exec(line)?.[1];
      violation = { kind: 'property', message: line.replace(/^Error: /, '') };
      if (named !== undefined) {
        violation.name = named;
        const sentence = sentenceOfName(named);
        if (sentence !== undefined) violation.sentence = sentence;
      }
      continue;
    }
    if (/^Error: Deadlock reached/.test(line)) {
      violation = { kind: 'deadlock', message: 'deadlock reached' };
      continue;
    }
    if (/^Error: The behavior up to this point is:/.test(line)) continue;
    if (/^Error: /.test(line) && violation === undefined) errors.push(line.replace(/^Error: /, ''));
    if (/^(Semantic errors|Parse Error|\*\*\* Parse Error|Fatal error|Encountered)/.test(line)) errors.push(line);
  }
  // The trace: "State N: <Action line ...>" followed by "/\ var = value" lines.
  const trace: NonNullable<TlcResultView['trace']> = [];
  let current: NonNullable<TlcResultView['trace']>[number] | undefined;
  for (const line of lines) {
    const head = /^State (\d+): <(.*)>/.exec(line);
    if (head !== null) {
      current = { step: Number(head[1]), state: [] };
      const label = head[2] ?? '';
      const action = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(label)?.[1];
      if (action !== undefined && action !== 'Initial') {
        current.action = action;
        const sentence = sentenceOfName(action);
        if (sentence !== undefined) current.sentence = sentence;
      }
      trace.push(current);
      continue;
    }
    if (current !== undefined && /^\/\\ /.test(line)) current.state.push(line.slice(3));
    else if (current !== undefined && line.trim() === '') current = undefined;
  }
  // Coverage: TLC prints a table more than once; the last one is final.
  const coverage = new Map<string, { action: string; sentence?: string; distinct: number; total: number }>();
  for (const line of lines) {
    const match = /^<(\w+) line \d+, col \d+ to line \d+, col \d+ of module \w+>: (\d+):(\d+)/.exec(line);
    if (match === null) continue;
    const action = (match[1] ?? '').replace(/^Cover_/, '');
    const row: { action: string; sentence?: string; distinct: number; total: number } = { action, distinct: Number(match[2]), total: Number(match[3]) };
    const sentence = sentenceOfName(action);
    if (sentence !== undefined) row.sentence = sentence;
    coverage.set(action, row);
  }
  for (const line of lines) {
    const match = /^([\d,]+) states generated, ([\d,]+) distinct states found/.exec(line);
    if (match !== null) view.states = { generated: Number((match[1] ?? '0').replace(/,/g, '')), distinct: Number((match[2] ?? '0').replace(/,/g, '')) };
    const depth = /^The depth of the complete state graph search is (\d+)/.exec(line);
    if (depth !== null && view.states !== undefined) view.states.depth = Number(depth[1]);
  }
  if (trace.length > 0) view.trace = trace;
  if (coverage.size > 0) view.coverage = [...coverage.values()];
  if (run.timedOut) view.status = 'timeout';
  else if (violation !== undefined) {
    view.status = 'violation';
    view.violation = violation;
  } else if (errors.length > 0 || (run.exitCode !== 0 && !lines.some((line) => /Model checking completed. No error has been found/.test(line)))) {
    view.status = 'error';
    view.errors = errors.length > 0 ? errors : [`TLC exited with ${String(run.exitCode)}`];
    view.output = lines.slice(-40).join('\n');
  }
  return view;
}
