// Use cases of English workflows (clew spec workflow ...): add workflows from a Markdown file, gate and align them
// with the spec, edit their sentences with a reason, export their scenario monitors, and verify them with TLC.
//
// A workflow reads the spec (its sentences, lexicon, gate, and compiled model) and never writes it. The spec's
// use cases (canon.ts) and its versioning (milestones, diff) never read workflows.json: references go one way.
//
// workflows.json is data the spec is checked against, like a test fixture: each sentence keeps its text, its
// history, and its parse. Nothing deeper is stored. The gate's rules, the concepts, the citations, and the
// monitor are compiled from the stored parse and the spec as it is now, on every check, export, and verify.
import { canonTlaFiles } from '../domain/canon-tla.js';
import {
  blocksVariables,
  checkWorkflows,
  grammarKey,
  parseWorkflowHeading,
  parseWorkflowSentence,
  prefixInvariant,
  stepOfName,
  workflowConfig,
  workflowModule,
  CANON_WORKFLOW_ID_PATTERN,
  CANON_WORKFLOW_SENTENCE_ID_PATTERN,
  type WorkflowCheck,
  type WorkflowExpect,
  type WorkflowFinding,
  type WorkflowInput,
  type WorkflowMode,
  type ParsedSentence,
} from '../domain/canon-workflow.js';
import type { CanonLexicon } from '../domain/canon-ast.js';
import { applySentenceEdit, type SentenceEdit } from '../domain/spec-sentences.js';
import { splitSpec, type Revision, type Sentence, type SentenceText, type SpecSnapshot } from '../domain/spec.js';
import { compileGate, gateSession, readTlcOutput, sentenceOfName, type CanonStore, type TlcRunner } from './canon.js';
import { specInput, type Outcome, type SpecWorkflowDocument, type WorkflowRunView } from './documents.js';
import { DEFAULT_AUTHOR } from './edit-sentences.js';
import type { CanonParserFactory, SpecStore, SpecTextSource, TextFiles } from './ports.js';
import { resolveSession } from './spec-session.js';

/** One workflow as stored: its sentences keep their history, like the spec's, in their own namespace. */
export interface StoredWorkflow {
  id: string;
  title: string;
  expect: WorkflowExpect;
  mode: WorkflowMode;
  /** The Markdown file it came from, when it came from one. */
  source?: { path: string; hash: string };
  deleted?: true;
  /** Ids look like w1.s1. A deleted sentence stays as a tombstone; ids are never reused. */
  sentences: StoredWorkflowSentence[];
  /** Every write to the title, the expectation, or the mode, and the deletion, with who and why. */
  history: Revision<{ title: string; expect: WorkflowExpect; mode: WorkflowMode; deleted: boolean }>[];
}

/** A workflow sentence as stored: the spec's sentence shape, and the parse of its latest text (null for a tombstone). */
export type StoredWorkflowSentence = Sentence & { parsed: ParsedSentence | null };

export interface WorkflowState {
  schemaVersion: 1;
  workflows: StoredWorkflow[];
}

export interface WorkflowStore {
  read(session: string): { ok: true; state: WorkflowState | undefined } | { ok: false; message: string };
  write(session: string, state: WorkflowState): { ok: true } | { ok: false; message: string };
}

export interface WorkflowPorts {
  store: SpecStore;
  canon: CanonStore;
  workflows: WorkflowStore;
  parser: CanonParserFactory;
}

type Doc = SpecWorkflowDocument;

function invalid(command: Doc['command'], fault: NonNullable<Doc['fault']>, message: string): Outcome<Doc> {
  return { exit: 'invalid', document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] } };
}

interface Loaded {
  session: string;
  snapshot: SpecSnapshot;
  state: WorkflowState;
}

function load(command: Doc['command'], sessionId: string | undefined, ports: WorkflowPorts): { ok: true; value: Loaded } | { ok: false; outcome: Outcome<Doc> } {
  const resolved = resolveSession(ports.store, sessionId);
  if (!resolved.ok) return { ok: false, outcome: invalid(command, 'session', resolved.message) };
  const result = ports.store.update(resolved.id, { create: false }, () => undefined);
  if (!result.ok) return { ok: false, outcome: invalid(command, result.fault === 'missing' ? 'session' : result.fault, result.message) };
  const read = ports.workflows.read(resolved.id);
  if (!read.ok) return { ok: false, outcome: invalid(command, 'unreadable', read.message) };
  return { ok: true, value: { session: resolved.id, snapshot: result.snapshot, state: read.state ?? { schemaVersion: 1, workflows: [] } } };
}

/** The live workflows, as the checker reads them. */
export function workflowInputs(state: WorkflowState, only?: string): WorkflowInput[] {
  const out: WorkflowInput[] = [];
  for (const workflow of state.workflows) {
    if (workflow.deleted === true || (only !== undefined && workflow.id !== only)) continue;
    const sentences: WorkflowInput['sentences'] = [];
    for (const sentence of workflow.sentences) {
      if (sentence.latest === null) continue;
      // A live sentence without a parse cannot be read: it counts as parsed with no grammar, so check says to parse it.
      const parsed: ParsedSentence = sentence.parsed ?? { grammar: '', statement: null, diagnostics: [] };
      sentences.push({ id: sentence.id, text: sentence.latest.text, parsed });
    }
    out.push({ id: workflow.id, title: workflow.title, expect: workflow.expect, mode: workflow.mode, sentences });
  }
  return out;
}

/** The spec, read for the workflows: its gate and compiled model. Fails when the spec has no canonical lexicon. */
function specFor(command: Doc['command'], loaded: Loaded, ports: WorkflowPorts) {
  const canon = ports.canon.read(loaded.session);
  if (!canon.ok) return { ok: false as const, outcome: invalid(command, 'unreadable', canon.message) };
  if (canon.state === undefined) {
    return { ok: false as const, outcome: invalid(command, 'lexicon', 'the spec has no canonical lexicon yet; workflows share the spec\'s concepts, so run clew spec canon lexicon first') };
  }
  const lexicon = canon.state.lexicon;
  const gate = gateSession(loaded.snapshot, lexicon, ports.parser);
  const model = compileGate(gate, lexicon);
  const parse = ports.parser.forLexicon(lexicon);
  return { ok: true as const, spec: { lexicon, gate, model }, lexicon, parse: (text: string) => parse.parse(text), dangling: gate.sentences.filter((sentence) => sentence.status === 'dangling').map((sentence) => sentence.id) };
}

/**
 * Attach the parse of each live sentence. A sentence whose text is unchanged keeps the parse it has, even one made
 * with other lexicon words: re-parsing is clew spec workflow parse, never a side effect of another write.
 */
function withParses(sentences: readonly Sentence[], previous: readonly StoredWorkflowSentence[], lexicon: CanonLexicon, parse: (text: string) => ReturnType<Parameters<typeof parseWorkflowSentence>[2]>): StoredWorkflowSentence[] {
  const before = new Map(previous.map((sentence) => [sentence.id, sentence]));
  return sentences.map((sentence) => {
    if (sentence.latest === null) return { ...sentence, parsed: null };
    const old = before.get(sentence.id);
    if (old?.parsed != null && old.latest?.text === sentence.latest.text) return { ...sentence, parsed: old.parsed };
    return { ...sentence, parsed: parseWorkflowSentence(sentence.latest.text, lexicon, parse) };
  });
}

function allFindings(checks: readonly WorkflowCheck[]): WorkflowFinding[] {
  return checks.flatMap((check) => check.findings);
}

function nextWorkflowId(state: WorkflowState): string {
  const used = new Set(state.workflows.map((workflow) => workflow.id));
  let number = 1;
  while (used.has(`w${number}`)) number += 1;
  return `w${number}`;
}

/** Workflows from Markdown: a heading that ends in (possible) or (refused) opens one; its sentences are its steps. */
export function readWorkflowMarkdown(text: string): { ok: true; workflows: { title: string; expect: WorkflowExpect; mode: WorkflowMode; sentences: SentenceText[] }[]; skipped: { text: string; section: string }[] } | { ok: false; message: string } {
  const split = splitSpec(text);
  const workflows: { title: string; expect: WorkflowExpect; mode: WorkflowMode; section: string; sentences: SentenceText[] }[] = [];
  const skipped: { text: string; section: string }[] = [];
  for (const sentence of split.sentences) {
    const path = sentence.section === '' ? [] : sentence.section.split(' / ');
    const last = path[path.length - 1];
    const heading = last === undefined ? undefined : parseWorkflowHeading(last);
    if (heading === undefined) {
      // Prose under a heading that opens no workflow is a note for the reader: it is reported, never read as a step.
      skipped.push({ text: sentence.text, section: sentence.section });
      continue;
    }
    let current = workflows[workflows.length - 1];
    if (current === undefined || current.section !== sentence.section) {
      current = { ...heading, section: sentence.section, sentences: [] };
      workflows.push(current);
    }
    current.sentences.push({ text: sentence.text, span: sentence.span, hash: '', section: sentence.section });
  }
  if (workflows.length === 0) return { ok: false, message: 'no workflow found: start each with a heading that ends in (possible) or (refused)' };
  return { ok: true, workflows: workflows.map(({ section, ...rest }) => { void section; return rest; }), skipped };
}

function stamp(by: string | undefined, reason: string, extra: { finding?: string; comment?: string } = {}): { at: string; who: string; reason: string; finding?: string; comment?: string } {
  const note: { at: string; who: string; reason: string; finding?: string; comment?: string } = { at: new Date().toISOString(), who: by ?? DEFAULT_AUTHOR, reason };
  if (extra.finding !== undefined) note.finding = extra.finding;
  if (extra.comment !== undefined) note.comment = extra.comment;
  return note;
}

function checkDocument(command: Doc['command'], loaded: Loaded, checks: WorkflowCheck[], specDangling: string[]): Doc {
  return {
    command,
    ok: true,
    session: loaded.session,
    workflows: checks.map((check) => ({ id: check.id, title: check.title, expect: check.expect, mode: check.mode, ready: check.ready, sentences: check.sentences, findings: check.findings })),
    specDangling,
    workflowFindings: allFindings(checks),
    findings: [],
    issues: [],
  };
}

export function addWorkflows(
  command: { sessionId?: string; file: string; reason: string; by?: string; finding?: string; comment?: string },
  ports: WorkflowPorts,
  source: SpecTextSource,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.add';
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  // Workflows share the spec's concepts: without the spec's lexicon there is nothing to share.
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec.outcome;
  const read = source.read(command.file);
  if (!read.ok) return invalid(name, 'unreadable', read.message);
  const parsed = readWorkflowMarkdown(read.spec.text);
  if (!parsed.ok) return invalid(name, 'unreadable', `${command.file}: ${parsed.message}`);
  const state: WorkflowState = { schemaVersion: 1, workflows: [...loaded.value.state.workflows] };
  const added: string[] = [];
  const note = stamp(command.by, command.reason, command);
  for (const workflow of parsed.workflows) {
    const id = nextWorkflowId(state);
    const sentences: StoredWorkflowSentence[] = workflow.sentences.map((text, index) => {
      const latest: SentenceText = { ...text, hash: source.hash(text.text) };
      const revision: Revision<SentenceText | null> = { ...note, value: { ...latest, span: [latest.span[0], latest.span[1]] } };
      return { id: `${id}.s${index + 1}`, original: { ...latest, span: [latest.span[0], latest.span[1]] }, latest, history: [revision], parsed: parseWorkflowSentence(latest.text, spec.lexicon, spec.parse) };
    });
    state.workflows.push({
      id,
      title: workflow.title,
      expect: workflow.expect,
      mode: workflow.mode,
      source: { path: read.spec.path, hash: read.spec.hash },
      sentences,
      history: [{ ...note, value: { title: workflow.title, expect: workflow.expect, mode: workflow.mode, deleted: false } }],
    });
    added.push(id);
  }
  const wrote = ports.workflows.write(loaded.value.session, state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  const checks = checkWorkflows(spec.spec, workflowInputs(state).filter((input) => added.includes(input.id)), spec.parse);
  const document = checkDocument(name, { ...loaded.value, state }, checks, spec.dangling);
  document.added = added;
  if (parsed.skipped.length > 0) document.skipped = parsed.skipped;
  return { exit: 'pass', document };
}

export function checkWorkflowSet(command: { sessionId?: string; workflow?: string }, ports: WorkflowPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.check';
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  const inputs = workflowInputs(loaded.value.state, command.workflow);
  if (command.workflow !== undefined && inputs.length === 0) return invalid(name, 'session', `no live workflow "${command.workflow}"`);
  if (inputs.length === 0) return invalid(name, 'session', 'the session has no workflow; add some with clew spec workflow add --file workflows.md --reason "..."');
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec.outcome;
  const checks = checkWorkflows(spec.spec, inputs, spec.parse);
  return { exit: checks.every((check) => check.ready) ? 'pass' : 'fail', document: checkDocument(name, loaded.value, checks, spec.dangling) };
}

/**
 * Parse the live workflow sentences again with the spec's lexicon as it is now, and store the parses. Needed after
 * the lexicon's actors, terms, states, or verbs change (parse-stale). The text and its history are unchanged.
 */
export function parseWorkflowSet(command: { sessionId?: string; workflow?: string }, ports: WorkflowPorts): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.parse';
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec.outcome;
  const live = loaded.value.state.workflows.filter((workflow) => workflow.deleted !== true && (command.workflow === undefined || workflow.id === command.workflow));
  if (live.length === 0) return invalid(name, 'session', command.workflow === undefined ? 'the session has no workflow' : `no live workflow "${command.workflow}"`);
  const grammar = grammarKey(spec.lexicon);
  const reparsed: string[] = [];
  const state: WorkflowState = {
    schemaVersion: 1,
    workflows: loaded.value.state.workflows.map((workflow) => {
      if (!live.includes(workflow)) return workflow;
      return {
        ...workflow,
        sentences: workflow.sentences.map((sentence) => {
          if (sentence.latest === null) return { ...sentence, parsed: null };
          if (sentence.parsed?.grammar === grammar) return sentence;
          reparsed.push(sentence.id);
          return { ...sentence, parsed: parseWorkflowSentence(sentence.latest.text, spec.lexicon, spec.parse) };
        }),
      };
    }),
  };
  if (reparsed.length > 0) {
    const wrote = ports.workflows.write(loaded.value.session, state);
    if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  }
  const checks = checkWorkflows(spec.spec, workflowInputs(state, command.workflow), spec.parse);
  const document = checkDocument(name, { ...loaded.value, state }, checks, spec.dangling);
  document.reparsed = reparsed;
  return { exit: checks.every((check) => check.ready) ? 'pass' : 'fail', document };
}

/** Add, edit, or delete one workflow sentence. Ids stay in the workflow's namespace and are never reused. */
export function editWorkflowSentence(
  command: { sessionId?: string; action: 'add' | 'edit' | 'delete'; id?: string; workflow?: string; after?: string; text?: string; reason: string; by?: string; finding?: string; comment?: string },
  ports: WorkflowPorts,
  hash: Pick<SpecTextSource, 'hash'>,
): Outcome<Doc> {
  const name: Doc['command'] = command.action === 'add' ? 'spec.workflow.step' : `spec.workflow.${command.action}`;
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  const target = command.action === 'add'
    ? command.workflow ?? command.after?.split('.')[0]
    : command.id?.split('.')[0];
  if (command.action !== 'add' && (command.id === undefined || !CANON_WORKFLOW_SENTENCE_ID_PATTERN.test(command.id))) return invalid(name, 'session', 'workflow sentence ids look like w1.s2');
  if (command.after !== undefined && !CANON_WORKFLOW_SENTENCE_ID_PATTERN.test(command.after)) return invalid(name, 'session', '--after takes a workflow sentence id such as w1.s2');
  if (target === undefined || !CANON_WORKFLOW_ID_PATTERN.test(target)) return invalid(name, 'session', 'name the workflow with --workflow w1, or --after w1.s2');
  const state: WorkflowState = { schemaVersion: 1, workflows: loaded.value.state.workflows.map((workflow) => ({ ...workflow })) };
  const workflow = state.workflows.find((item) => item.id === target && item.deleted !== true);
  if (workflow === undefined) return invalid(name, 'session', `no live workflow "${target}"`);
  const local = (id: string): string => id.slice(target.length + 1);
  const edit: SentenceEdit | string = command.action === 'add'
    ? command.text === undefined ? 'add takes --text' : (() => {
      const value: SentenceEdit = { action: 'add', text: command.text, hash: hash.hash(command.text) };
      if (command.after !== undefined) value.after = local(command.after);
      return value;
    })()
    : command.action === 'edit'
      ? command.text === undefined ? 'edit takes --text' : { action: 'edit', id: local(command.id ?? ''), text: command.text, hash: hash.hash(command.text) }
      : { action: 'delete', id: local(command.id ?? '') };
  if (typeof edit === 'string') return invalid(name, 'session', edit);
  // The new text is parsed with the spec's lexicon before anything is written.
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec.outcome;
  const localized = workflow.sentences.map(({ parsed, ...sentence }) => { void parsed; return { ...sentence, id: local(sentence.id) }; });
  const applied = applySentenceEdit(localized, edit, stamp(command.by, command.reason, command));
  if (!applied.ok) return invalid(name, 'session', applied.message.replace(/"(s\d+)"/g, `"${target}.$1"`).replace(/^(s\d+)/, `${target}.$1`));
  workflow.sentences = withParses(applied.sentences.map((sentence) => ({ ...sentence, id: `${target}.${sentence.id}` })), workflow.sentences, spec.lexicon, spec.parse);
  const wrote = ports.workflows.write(loaded.value.session, state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  const checks = checkWorkflows(spec.spec, workflowInputs(state, target), spec.parse);
  const document = checkDocument(name, { ...loaded.value, state }, checks, spec.dangling);
  document.sentence = `${target}.${applied.sentence.id}`;
  return { exit: 'pass', document };
}

/** Change what a workflow expects, how strictly its steps follow each other, its title, or delete it. */
export function setWorkflow(
  command: { sessionId?: string; workflow: string; title?: string; expect?: WorkflowExpect; mode?: WorkflowMode; delete?: boolean; reason: string; by?: string; finding?: string; comment?: string },
  ports: WorkflowPorts,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.set';
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  const state: WorkflowState = { schemaVersion: 1, workflows: loaded.value.state.workflows.map((workflow) => ({ ...workflow, history: [...workflow.history] })) };
  const workflow = state.workflows.find((item) => item.id === command.workflow && item.deleted !== true);
  if (workflow === undefined) return invalid(name, 'session', `no live workflow "${command.workflow}"`);
  if (command.title === undefined && command.expect === undefined && command.mode === undefined && command.delete !== true) return invalid(name, 'session', 'set takes --title, --expect, --mode, or --delete');
  if (command.title !== undefined) workflow.title = command.title;
  if (command.expect !== undefined) workflow.expect = command.expect;
  if (command.mode !== undefined) workflow.mode = command.mode;
  if (command.delete === true) workflow.deleted = true;
  workflow.history.push({ ...stamp(command.by, command.reason, command), value: { title: workflow.title, expect: workflow.expect, mode: workflow.mode, deleted: workflow.deleted === true } });
  const wrote = ports.workflows.write(loaded.value.session, state);
  if (!wrote.ok) return invalid(name, 'unreadable', wrote.message);
  return { exit: 'pass', document: { command: name, ok: true, session: loaded.value.session, workflows: [{ id: workflow.id, title: workflow.title, expect: workflow.expect, mode: workflow.mode, ready: false, sentences: [], findings: [], deleted: workflow.deleted === true }], findings: [], issues: [] } };
}

/** Replace a dangling workflow sentence with its draft. Like spec canon accept: the sentence keeps its id and history. */
export function acceptWorkflowDraft(
  command: { sessionId?: string; id: string; reason: string; descriptive?: string; by?: string },
  ports: WorkflowPorts,
  hash: Pick<SpecTextSource, 'hash'>,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.accept';
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded.outcome;
  if (!CANON_WORKFLOW_SENTENCE_ID_PATTERN.test(command.id)) return invalid(name, 'session', 'workflow sentence ids look like w1.s2');
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec.outcome;
  const target = command.id.split('.')[0] ?? '';
  const checks = checkWorkflows(spec.spec, workflowInputs(loaded.value.state, target), spec.parse);
  const view = checks[0]?.sentences.find((sentence) => sentence.id === command.id);
  if (view === undefined) return invalid(name, 'session', `no live workflow sentence "${command.id}"`);
  if (view.status === 'accepted') return invalid(name, 'gate', `${command.id} already passes the gate`);
  const draft = view.draft;
  if (draft === undefined) return invalid(name, 'gate', `${command.id} has no draft rewrite: edit it with clew spec workflow edit`);
  if (!draft.parses) return invalid(name, 'gate', `the draft of ${command.id} does not pass the gate yet (${draft.needsInput ? 'it has a placeholder to fill in' : draft.remaining[0]?.message ?? 'it still fails'}): write it with clew spec workflow edit`);
  if (draft.dropped.length > 0 && command.descriptive === undefined) {
    return invalid(name, 'gate', `the draft of ${command.id} leaves out ${draft.dropped.map((word) => `"${word}"`).join(', ')}: restate it, or pass --descriptive with the reason it has no behaviour`);
  }
  const notes = [...draft.notes];
  if (command.descriptive !== undefined) notes.push(`left out as descriptive: ${command.descriptive}`);
  const edit: Parameters<typeof editWorkflowSentence>[0] = { action: 'edit', id: command.id, text: draft.text, reason: command.reason, comment: `canonical draft accepted. ${notes.join('; ')}` };
  if (command.sessionId !== undefined) edit.sessionId = command.sessionId;
  if (command.by !== undefined) edit.by = command.by;
  const edited = editWorkflowSentence(edit, ports, hash);
  if (edited.exit === 'invalid') return { ...edited, document: { ...edited.document, command: name } };
  edited.document.command = name;
  edited.document.accepted = { id: command.id, from: view.text, to: draft.text, notes, dropped: draft.dropped };
  return edited;
}

interface Exported {
  checks: WorkflowCheck[];
  module: string;
  modulePath: string;
  configs: { workflow: string; path: string; invariant: string }[];
}

function exportFiles(
  name: Doc['command'],
  command: { sessionId?: string; dir: string; name: string; workflow?: string },
  ports: WorkflowPorts,
  files: TextFiles & { join(dir: string, file: string): string },
): { ok: true; loaded: Loaded; exported: Exported; specDangling: string[] } | { ok: false; outcome: Outcome<Doc> } {
  const loaded = load(name, command.sessionId, ports);
  if (!loaded.ok) return loaded;
  const spec = specFor(name, loaded.value, ports);
  if (!spec.ok) return spec;
  const inputs = workflowInputs(loaded.value.state, command.workflow);
  if (inputs.length === 0) return { ok: false, outcome: invalid(name, 'session', command.workflow === undefined ? 'the session has no workflow' : `no live workflow "${command.workflow}"`) };
  // The monitor instances the blocks module and labels its steps by Blocks!<action>: the blocks module on disk must
  // be the one the spec compiles to now. The monitor is compiled here and only its TLA+ text is written.
  const tla = canonTlaFiles({ name: command.name, session: loaded.value.session, model: spec.spec.model });
  const blocksPath = files.join(command.dir, `${tla.blocks.module}.tla`);
  const blocks = files.read(blocksPath);
  if (!blocks.ok || blocks.text !== tla.blocks.tla) {
    return { ok: false, outcome: invalid(name, 'stale', `${blocksPath} is ${blocks.ok ? 'not what the spec compiles to now' : 'missing'}: run clew spec canon export --dir ${command.dir} --name ${command.name} first`) };
  }
  const checks = checkWorkflows(spec.spec, inputs, spec.parse);
  const module = workflowModule({ name: command.name, session: loaded.value.session, variables: blocksVariables(spec.spec.model), workflows: checks });
  const modulePath = files.join(command.dir, `${module.module}.tla`);
  const wrote = files.write(modulePath, module.tla);
  if (!wrote.ok) return { ok: false, outcome: invalid(name, 'unreadable', wrote.message) };
  const configs: Exported['configs'] = [];
  for (const config of module.configs) {
    const path = files.join(command.dir, config.file);
    const written = files.write(path, config.cfg);
    if (!written.ok) return { ok: false, outcome: invalid(name, 'unreadable', written.message) };
    configs.push({ workflow: config.workflow, path, invariant: config.invariant });
  }
  return { ok: true, loaded: loaded.value, exported: { checks, module: module.module, modulePath, configs }, specDangling: spec.dangling };
}

export function exportWorkflows(
  command: { sessionId?: string; dir: string; name: string; workflow?: string },
  ports: WorkflowPorts,
  files: TextFiles & { join(dir: string, file: string): string },
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.export';
  const done = exportFiles(name, command, ports, files);
  if (!done.ok) return done.outcome;
  const document = checkDocument(name, done.loaded, done.exported.checks, done.specDangling);
  document.files = [{ path: done.exported.modulePath, module: done.exported.module }, ...done.exported.configs.map((config) => ({ path: config.path, module: done.exported.module, workflow: config.workflow }))];
  document.run = done.exported.configs.map((config) => ({ workflow: config.workflow, command: `clew spec canon tlc ${done.exported.modulePath} --config ${config.path}` }));
  return { exit: done.exported.checks.every((check) => check.ready) ? 'pass' : 'fail', document };
}

/** Export, then run TLC on each ready workflow and read the result against what the workflow expects. */
export function verifyWorkflows(
  command: { sessionId?: string; dir: string; name: string; workflow?: string; jar?: string; workers: number; timeoutSeconds: number },
  ports: WorkflowPorts,
  files: TextFiles & { join(dir: string, file: string): string },
  runner: TlcRunner,
): Outcome<Doc> {
  const name: Doc['command'] = 'spec.workflow.verify';
  const done = exportFiles(name, command, ports, files);
  if (!done.ok) return done.outcome;
  const { checks, modulePath, configs, module } = done.exported;
  const runs: WorkflowRunView[] = [];
  const run = (config: string): ReturnType<typeof readTlcOutput> | { status: 'error'; command: string; errors: string[] } => {
    const request: Parameters<TlcRunner['run']>[0] = { file: modulePath, config, workers: command.workers, timeoutSeconds: command.timeoutSeconds, coverage: false };
    if (command.jar !== undefined) request.jar = command.jar;
    const ran = runner.run(request);
    if (!ran.ok) return { status: 'error', command: '', errors: [ran.message] };
    return readTlcOutput(ran.run);
  };
  for (const check of checks) {
    const view: WorkflowRunView = { workflow: check.id, title: check.title, expect: check.expect, mode: check.mode, outcome: 'not-ready' };
    runs.push(view);
    const config = configs.find((item) => item.workflow === check.id);
    if (!check.ready || config === undefined || check.monitor === undefined) {
      view.message = `${check.id} is not ready: ${check.findings.find((finding) => finding.severity === 'blocking')?.message ?? 'a sentence is dangling'}`;
      continue;
    }
    const result = run(config.path);
    view.tlc = result;
    if (result.status === 'error' || result.status === 'timeout') {
      view.outcome = result.status;
      view.message = result.status === 'timeout' ? 'TLC timed out' : (result.errors ?? []).join('; ');
      continue;
    }
    const completed = result.status === 'violation' && result.violation?.name === config.invariant;
    if (result.status === 'violation' && !completed) {
      view.outcome = 'error';
      view.message = `TLC reported ${result.violation?.message ?? 'a violation'} instead of the workflow's own invariant`;
      continue;
    }
    if (completed) view.path = tracePath(result.trace ?? []);
    if (check.expect === 'possible') {
      view.outcome = completed ? 'holds' : 'fails';
      view.message = completed
        ? `possible: TLC found a witness in ${String(view.path?.length ?? 0)} steps`
        : `not possible: no behaviour of ${command.name}Blocks takes the steps in order`;
    } else {
      view.outcome = completed ? 'fails' : 'holds';
      view.message = completed
        ? `goes through: ${command.name}Blocks takes every step of a workflow that must be refused`
        : `refused: no behaviour of ${command.name}Blocks takes the steps in order (${String(result.states?.distinct ?? 0)} states)`;
    }
    // Possible but not reached: find the last step the model can take, so the step that cannot happen is named.
    if (check.expect === 'possible' && !completed) {
      const steps = check.monitor.steps;
      let reached = 0;
      for (let upTo = check.monitor.ends.length > 0 ? steps.length : steps.length - 1; upTo >= 1; upTo -= 1) {
        const probe = files.join(command.dir, `${command.name}Workflow_${check.id}_before${upTo}.cfg`);
        const wrote = files.write(probe, workflowConfig(module, check.monitor.prefix, prefixInvariant(check.monitor.prefix, upTo)));
        if (!wrote.ok) break;
        const probed = run(probe);
        if (probed.status === 'violation') {
          reached = upTo;
          break;
        }
      }
      const blocked = steps[reached];
      const ends = check.monitor.ends.length > 0 && reached === steps.length;
      if (blocked !== undefined) {
        view.stopsAt = {
          step: blocked.number,
          sentence: blocked.sentence,
          text: blocked.text,
          asks: [...blocked.guards, ...blocked.effects].map((item) => ({ words: item.words, tla: item.tla })),
          reached,
        };
        view.message = `not possible: the spec takes steps 1 to ${String(reached)} but never step ${String(blocked.number)} ("${blocked.text}") after them`;
      } else if (ends) {
        view.message = 'not possible: the spec takes every step but never ends as the workflow says';
      }
    }
  }
  const failing = runs.filter((item) => item.outcome !== 'holds');
  const document = checkDocument(name, done.loaded, checks, done.specDangling);
  document.runs = runs;
  for (const item of runs) {
    if (item.outcome === 'fails') {
      document.workflowFindings?.push({
        id: `${item.workflow}.tlc`,
        code: item.expect === 'possible' ? 'workflow-not-possible' : 'workflow-goes-through',
        severity: 'blocking',
        message: item.message ?? '',
        workflow: item.workflow,
        ...(item.stopsAt === undefined ? {} : { sentence: item.stopsAt.sentence }),
      });
    }
  }
  const errors = runs.filter((item) => item.outcome === 'error');
  if (errors.length > 0 && errors.length === runs.length) return { exit: 'invalid', document: { ...document, ok: false, issues: errors.map((item) => specInput(modulePath, item.message ?? 'TLC failed')) } };
  return { exit: failing.length === 0 ? 'pass' : 'fail', document };
}

/** A TLC trace as the workflow's path: each state change named by its step, its spec action, and the spec sentence. */
function tracePath(trace: NonNullable<ReturnType<typeof readTlcOutput>['trace']>): NonNullable<WorkflowRunView['path']> {
  const path: NonNullable<WorkflowRunView['path']> = [];
  for (const step of trace) {
    if (step.action === undefined) continue;
    const ofStep = stepOfName(step.action);
    const other = /^W[1-9][0-9]*_Other_(.+)$/.exec(step.action)?.[1];
    const action = ofStep?.action ?? other;
    const entry: NonNullable<WorkflowRunView['path']>[number] = { state: step.step, kind: ofStep !== undefined ? 'step' : other !== undefined ? 'other' : 'environment', values: step.state.filter((line) => !/^wf_/.test(line)) };
    if (ofStep !== undefined) entry.step = ofStep.step;
    if (action !== undefined) {
      entry.action = action;
      const sentence = sentenceOfName(action);
      if (sentence !== undefined) entry.specSentence = sentence;
    }
    path.push(entry);
  }
  return path;
}
