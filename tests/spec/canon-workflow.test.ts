// English workflows: the same gate with the spec's concepts, the one-way reference rule, needs-instances (E13),
// the scenario monitor, and the CLI. Every example is synthetic (an order, and an order shipped in parts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chevrotainCanonParser } from '../../src/adapters/canon/chevrotain-parser.js';
import { readWorkflowMarkdown } from '../../src/application/canon-workflows.js';
import type { CanonLexicon } from '../../src/domain/canon-ast.js';
import { compileCanon } from '../../src/domain/canon-compile.js';
import { runGate } from '../../src/domain/canon-gate.js';
import { canonTlaFiles } from '../../src/domain/canon-tla.js';
import { SNAPSHOT_FILES } from '../../src/adapters/spec-store/milestone-store.js';
import { blocksVariables, checkWorkflows, grammarKey, parseWorkflowHeading, parseWorkflowSentence, stepOfName, workflowModule, type WorkflowExpect, type WorkflowMode } from '../../src/domain/canon-workflow.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const ORDER_LEXICON: CanonLexicon = { actors: ['customer', 'manager', 'warehouse'], terms: [], states: [], verbs: [], fixed: ['total'] };
const ORDER = [
  'The order starts as draft.',
  'The customer submits the draft order as submitted.',
  'The manager reviews the submitted order as approved when the total is small, or reviews the order as rejected when the total is large.',
  'The warehouse ships the order as shipped when the order is packed.',
  'The customer cancels the order as cancelled when the order is submitted or approved.',
  'The customer cannot cancel the order when the order is shipped.',
  'The order ends as shipped or rejected or cancelled.',
  'The order is never shipped when the total is large.',
  'The warehouse packs the order as packed when the order is approved.',
];

const SHIP_LEXICON: CanonLexicon = { actors: ['customer', 'warehouse', 'carrier'], terms: [], states: ['in transit'], verbs: [] };
const SHIPMENTS = [
  'The order starts as open.',
  'The warehouse packs the new shipment as packed.',
  'The carrier ships the packed shipment as in transit.',
  'The carrier delivers the shipment as delivered when the shipment is in transit.',
  'The customer closes the order as closed when the order is open.',
];

function specOf(texts: string[], lexicon: CanonLexicon) {
  const parser = chevrotainCanonParser.forLexicon(lexicon);
  const parse = (text: string) => parser.parse(text);
  const gate = runGate(texts.map((text, index) => ({ id: `s${index + 1}`, text })), lexicon, parse);
  const accepted = gate.sentences.filter((sentence) => sentence.statement !== undefined).map((sentence) => ({ id: sentence.id, text: sentence.text, statement: sentence.statement! }));
  return { spec: { lexicon, gate, model: compileCanon(accepted, lexicon) }, parse };
}

/** A workflow as stored: each sentence with its parse, made with the lexicon given. */
function workflow(id: string, texts: string[], expect: WorkflowExpect = 'possible', mode: WorkflowMode = 'loose', lexicon = ORDER_LEXICON) {
  const parser = chevrotainCanonParser.forLexicon(lexicon);
  return { id, title: id, expect, mode, sentences: texts.map((text, index) => ({ id: `${id}.s${index + 1}`, text, parsed: parseWorkflowSentence(text, lexicon, (input) => parser.parse(input)) })) };
}

function check(texts: string[], expect: WorkflowExpect = 'possible', mode: WorkflowMode = 'loose', base = ORDER, lexicon = ORDER_LEXICON) {
  const { spec, parse } = specOf(base, lexicon);
  const [result] = checkWorkflows(spec, [workflow('w1', texts, expect, mode, lexicon)], parse);
  return { result: result!, spec };
}

const codes = (findings: { code: string }[]): string[] => findings.map((finding) => finding.code);

describe('workflow gate and concepts', () => {
  test('a step is gated and its concepts are the spec\'s; it is not tied to a spec action', () => {
    const { result } = check(['The customer submits the order as submitted.', 'The manager reviews the order as rejected when the total is large.', 'The order ends as rejected.']);
    assert.equal(result.ready, true, JSON.stringify(result.findings));
    assert.deepEqual(result.sentences.map((sentence) => sentence.role), ['step', 'step', 'end']);
    assert.ok(!('cites' in result.sentences[0]!));
    assert.ok(result.sentences[1]?.concepts.includes('actor:manager'));
    assert.ok(result.sentences[1]?.concepts.includes('state:total/large'));
  });

  test('a step needs a result, like every spec sentence: the same gate, with a draft', () => {
    const { result } = check(['The customer submits the order.']);
    assert.equal(result.ready, false);
    assert.equal(result.sentences[0]?.status, 'dangling');
    assert.equal(result.sentences[0]?.diagnostics[0]?.code, 'missing-result');
    assert.deepEqual(codes(result.findings), ['step-dangling']);
  });

  test('a refusal, a choice, and an invariant are not steps', () => {
    const { result } = check(['The customer cannot cancel the order as cancelled.', 'The manager reviews the order as approved, or reviews the order as rejected.', 'The order is never shipped.']);
    const found = result.sentences.flatMap((sentence) => sentence.diagnostics.map((diagnostic) => diagnostic.code));
    assert.ok(found.includes('workflow-branches'), found.join());
    assert.ok(found.includes('workflow-invariant'), found.join());
    assert.ok(result.sentences.every((sentence) => sentence.status === 'dangling'));
  });

  test('a workflow cannot add a concept: an unknown noun or actor is a finding, not a new concept', () => {
    const { result, spec } = check(['The customer pays the invoice as paid.', 'The courier ships the order as shipped.']);
    assert.ok(codes(result.findings).includes('unknown-concept'));
    assert.ok(!codes(result.findings).includes('step-unmatched'), 'there is no step matching');
    assert.equal(result.ready, false);
    assert.ok(!spec.model.nouns.some((noun) => noun.noun === 'invoice'));
  });

  test('a known state the spec never gives that noun is a warning', () => {
    const { result } = check(['The customer submits the order as submitted when the total is shipped.']);
    assert.ok(codes(result.findings).includes('state-not-of-noun'), codes(result.findings).join());
  });

  test('a step no spec sentence states is still ready: TLC, not Clew, says whether the model can take it', () => {
    const { result } = check(['The manager reviews the order as cancelled.', 'The warehouse refunds the order as cancelled.']);
    assert.deepEqual(codes(result.findings), []);
    assert.equal(result.ready, true);
    assert.equal(result.monitor?.steps.length, 2);
  });

  test('the spec compiles the same with or without workflows: references go one way', () => {
    const { spec } = specOf(ORDER, ORDER_LEXICON);
    const before = canonTlaFiles({ name: 'Order', session: 'order', model: spec.model });
    checkWorkflows(spec, [workflow('w1', ['The customer pays the invoice as paid.'])], (text) => chevrotainCanonParser.forLexicon(ORDER_LEXICON).parse(text));
    const after = canonTlaFiles({ name: 'Order', session: 'order', model: spec.model });
    assert.equal(after.blocks.tla, before.blocks.tla);
    for (const file of ['canon-ast', 'canon-compile', 'canon-gate', 'canon-rules', 'canon-tla', 'spec-versions']) {
      assert.doesNotMatch(readFileSync(join(root, 'src', 'domain', `${file}.ts`), 'utf8'), /canon-workflow/, file);
    }
    assert.doesNotMatch(readFileSync(join(root, 'src', 'application', 'canon.ts'), 'utf8'), /canon-workflows?/);
    assert.doesNotMatch(readFileSync(join(root, 'src', 'application', 'versions.ts'), 'utf8'), /canon-workflows?|workflows\.json/);
  });

  test('a milestone freezes the spec only: workflows are data the spec is checked against', () => {
    assert.ok(!(SNAPSHOT_FILES as readonly string[]).includes('workflows.json'));
    assert.doesNotMatch(readFileSync(join(root, 'src', 'adapters', 'spec-store', 'milestone-store.ts'), 'utf8'), /workflow/i);
  });
});

describe('stored parses', () => {
  test('a stored parse is gated with the spec as it is now, and compiled on every check', () => {
    const parsed = workflow('w1', ['The manager reviews the order as approved when the total is small.']).sentences[0]!.parsed;
    assert.equal(parsed.statement?.kind, 'block');
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.grammar, grammarKey(ORDER_LEXICON));
    // Nothing of the spec is in it: no sentence id, action, or state the spec knows, only words and spans.
    assert.doesNotMatch(JSON.stringify(parsed), /"s[0-9]+"|_s[0-9]|Blocks|status/);
  });

  test('the key covers only the words the parser reads', () => {
    assert.equal(grammarKey({ ...ORDER_LEXICON, instances: { order: 3 }, fixed: [] }), grammarKey(ORDER_LEXICON));
    assert.equal(grammarKey({ ...ORDER_LEXICON, actors: ['warehouse', 'manager', 'customer'] }), grammarKey(ORDER_LEXICON));
    assert.notEqual(grammarKey({ ...ORDER_LEXICON, terms: ['gift card'] }), grammarKey(ORDER_LEXICON));
  });

  test('a parse made with other grammar words is not read: parse-stale blocks until it is parsed again', () => {
    const { spec, parse } = specOf(ORDER, { ...ORDER_LEXICON, terms: ['gift card'] });
    const [result] = checkWorkflows(spec, [workflow('w1', ['The customer submits the order as submitted.'])], parse);
    assert.deepEqual(codes(result!.findings), ['parse-stale']);
    assert.equal(result!.sentences[0]?.status, 'dangling');
    assert.equal(result!.monitor, undefined);
  });
});

describe('needs-instances (E13)', () => {
  const STEP = 'The customer closes the order as closed when some shipment is delivered and some shipment is in transit.';

  test('a quantified condition over a noun the spec models as one status variable is flagged before model checking', () => {
    const { result } = check([STEP], 'possible', 'loose', SHIPMENTS, SHIP_LEXICON);
    assert.deepEqual(codes(result.findings), ['needs-instances']);
    assert.match(result.findings[0]!.message, /"shipment" is one status variable in the spec, but this step counts over them/);
    assert.equal(result.monitor, undefined);
  });

  test('two conditions that need two instances in different states are flagged the same way', () => {
    const { result } = check(['The customer closes the order as closed when the shipment is delivered and the shipment is in transit.'], 'possible', 'loose', SHIPMENTS, SHIP_LEXICON);
    assert.deepEqual(codes(result.findings), ['needs-instances']);
    assert.match(result.findings[0]!.message, /needs two of them in different states/);
  });

  test('either state of one shipment is not flagged', () => {
    const { result } = check(['The customer closes the order as closed when the shipment is delivered or in transit.'], 'possible', 'loose', SHIPMENTS, SHIP_LEXICON);
    assert.ok(!codes(result.findings).includes('needs-instances'));
  });

  test('declaring shipments as an instance set in the spec clears the finding', () => {
    const { result } = check([STEP], 'possible', 'loose', SHIPMENTS, { ...SHIP_LEXICON, instances: { shipment: 2 } });
    assert.equal(result.ready, true, JSON.stringify(result.findings));
    assert.ok(result.monitor !== undefined);
  });
});

describe('scenario monitor', () => {
  test('the monitor declares the blocks variables and reads them directly; a step is its own formula', () => {
    const { spec, parse } = specOf(ORDER, ORDER_LEXICON);
    const checks = checkWorkflows(spec, [
      workflow('w1', ['The total starts as small.', 'The customer submits the order as submitted.', 'The manager reviews the order as approved when the total is small.', 'The order ends as approved.']),
      workflow('w2', ['The manager reviews the order as approved.'], 'refused', 'exact'),
    ], parse);
    const module = workflowModule({ name: 'Order', session: 'order', variables: blocksVariables(spec.model), workflows: checks });
    assert.equal(module.module, 'OrderWorkflows');
    assert.match(module.tla, /^EXTENDS Naturals, FiniteSets$/m);
    assert.doesNotMatch(module.tla, /^EXTENDS Order$/m, 'the monitor runs on the spec, not on the agent\'s model');
    assert.match(module.tla, /^VARIABLES order_status, total_status, actor$/m);
    assert.match(module.tla, /^Blocks == INSTANCE OrderBlocks WITH order_status <- order_status, total_status <- total_status, actor <- actor$/m);
    assert.doesNotMatch(module.tla, /Get_/);
    assert.match(module.tla, /^ {2}\/\\ Blocks!Init$/m);
    assert.match(module.tla, /^W1_Step2_Pre ==\n  \/\\ wf_pc = 1\n  \/\\ total_status = "small"/m);
    assert.match(module.tla, /^W1_Step2_Post ==\n  \/\\ actor' = "manager".*\n  \/\\ order_status # "approved" \/\\ order_status' = "approved".*\n  \/\\ wf_pc' = 2$/m);
    assert.match(module.tla, /^W1_Step2_ReviewOrder_s3_1 == W1_Step2_Pre \/\\ Blocks!Next \/\\ Blocks!ReviewOrder_s3_1 \/\\ W1_Step2_Post$/m, 'the name says which spec action the model took');
    assert.match(module.tla, /^W1_Step2_CancelOrder_s5 == /m, 'every spec action is a candidate: none is picked beforehand');
    assert.match(module.tla, /^W1_Step2_Unstated == W1_Step2_Pre \/\\ Blocks!Next \/\\ ~Blocks!Actions \/\\ W1_Step2_Post/m);
    assert.match(module.tla, /^W1_Other_CancelOrder_s5 == /m, 'loose: other spec actions may interleave');
    assert.doesNotMatch(module.tla, /^W2_Other_/m, 'exact: no other spec action');
    assert.match(module.tla, /^W2_Env == Blocks!Next \/\\ ~Blocks!Actions/m);
    assert.match(module.tla, /^W1_NotDone == ~W1_Done$/m);
    assert.deepEqual(module.configs.map((config) => config.file), ['OrderWorkflow_w1.cfg', 'OrderWorkflow_w2.cfg']);
    assert.match(module.configs[0]!.cfg, /SPECIFICATION W1_Spec\nINVARIANT W1_NotDone/);
    assert.deepEqual(stepOfName('W1_Step2_ReviewOrder_s3_1'), { workflow: 'w1', step: 2, action: 'ReviewOrder_s3_1' });
    assert.deepEqual(stepOfName('W1_Step2_Unstated'), { workflow: 'w1', step: 2 });
  });

  test('a noun the workflow names without a quantifier is one instance throughout', () => {
    const { spec, parse } = specOf(SHIPMENTS, { ...SHIP_LEXICON, instances: { shipment: 2 } });
    const lexicon = { ...SHIP_LEXICON, instances: { shipment: 2 } };
    const checks = checkWorkflows(spec, [workflow('w1', ['The warehouse packs the new shipment as packed.', 'The carrier ships the shipment as in transit.'], 'possible', 'loose', lexicon)], parse);
    const module = workflowModule({ name: 'Ship', session: 'ship', variables: blocksVariables(spec.model), workflows: checks });
    assert.match(module.tla, /^VARIABLES wf_pc, wf_shipment$/m);
    assert.match(module.tla, /shipment_status\[wf_shipment\] # "packed" \/\\ shipment_status'\[wf_shipment\] = "packed"/);
    assert.match(module.tla, /shipment_status'\[wf_shipment\] = "in-transit"/);
    assert.match(module.tla, /UNCHANGED wf_shipment/);
  });

  test('the blocks module has no accessor for the monitor: the mapping is the monitor\'s own', () => {
    const { spec } = specOf(ORDER, ORDER_LEXICON);
    const blocks = canonTlaFiles({ name: 'Order', session: 'order', model: spec.model }).blocks.tla;
    assert.doesNotMatch(blocks, /Get_/);
    assert.match(blocks, new RegExp(`^VARIABLES ${blocksVariables(spec.model).join(', ')}$`, 'm'), 'the monitor declares the same variables');
  });
});

describe('workflow files', () => {
  test('headings open workflows; prose under any other heading is listed, never a step', () => {
    const read = readWorkflowMarkdown('# Order\n\nNotes for the reader.\n\n## Happy (possible)\n\n1. The customer submits the order as submitted.\n2. The order ends as submitted.\n\n## First (refused, exact)\n\nThe manager reviews the order as approved.\n');
    assert.ok(read.ok);
    assert.deepEqual(read.workflows.map((item) => [item.title, item.expect, item.mode, item.sentences.length]), [['Happy', 'possible', 'loose', 2], ['First', 'refused', 'exact', 1]]);
    assert.deepEqual(read.skipped.map((item) => item.text), ['Notes for the reader.']);
    assert.deepEqual(parseWorkflowHeading('Ship it (Possible, Loose)'), { title: 'Ship it', expect: 'possible', mode: 'loose' });
    assert.equal(parseWorkflowHeading('Ship it'), undefined);
  });
});

function clew(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('clew spec workflow', { concurrency: false }, () => {
  test('add, check, edit, step, delete, set, accept, export, and verify end to end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-workflow-'));
    try {
      const env = { CLEW_DATA_DIR: join(dir, 'data') };
      writeFileSync(join(dir, 'order.md'), `# Order\n\n${ORDER.join('\n')}\n`);
      writeFileSync(join(dir, 'lexicon.json'), JSON.stringify(ORDER_LEXICON));
      writeFileSync(join(dir, 'workflows.md'), readFileSync(join(root, 'examples', 'canon', 'workflows.md'), 'utf8'));
      assert.equal(clew(['spec', 'init', join(dir, 'order.md'), '--json'], env).status, 0);
      const early = clew(['spec', 'workflow', 'add', '--file', join(dir, 'workflows.md'), '--reason', 'intent', '--json'], env);
      assert.equal(early.status, 2, 'workflows share the spec lexicon, so they need one');
      assert.equal(clew(['spec', 'canon', 'lexicon', '--file', join(dir, 'lexicon.json'), '--reason', 'order', '--json'], env).status, 0);
      const specBefore = readFileSync(join(dir, 'data', 'spec', 'order', 'sentences.json'), 'utf8');

      const added = clew(['spec', 'workflow', 'add', '--file', join(dir, 'workflows.md'), '--reason', 'intent from the brief', '--json'], env);
      assert.equal(added.status, 0, added.stderr);
      const document = JSON.parse(added.stdout) as { added: string[]; skipped: unknown[]; workflows: { id: string; ready: boolean }[] };
      assert.deepEqual(document.added, ['w1', 'w2', 'w3', 'w4']);
      assert.ok(document.skipped.length > 0);
      assert.ok(document.workflows.every((item) => item.ready));
      assert.equal(readFileSync(join(dir, 'data', 'spec', 'order', 'sentences.json'), 'utf8'), specBefore, 'adding workflows never writes the spec');
      assert.ok(existsSync(join(dir, 'data', 'spec', 'order', 'workflows.json')));

      assert.equal(clew(['spec', 'workflow', 'check'], env).status, 0);
      const step = clew(['spec', 'workflow', 'step', '--workflow', 'w1', '--text', 'The warehouse ships the order.', '--reason', 'probe', '--json'], env);
      assert.equal(step.status, 0, step.stderr);
      assert.equal((JSON.parse(step.stdout) as { sentence: string }).sentence, 'w1.s5');
      const dangling = clew(['spec', 'workflow', 'check', '--workflow', 'w1', '--json'], env);
      assert.equal(dangling.status, 1);
      const draft = (JSON.parse(dangling.stdout) as { workflows: { sentences: { id: string; draft?: { text: string; parses: boolean } }[] }[] }).workflows[0]?.sentences.find((sentence) => sentence.id === 'w1.s5')?.draft;
      assert.equal(draft?.parses, true);
      const accepted = clew(['spec', 'workflow', 'accept', '--id', 'w1.s5', '--reason', 'the draft keeps the meaning', '--json'], env);
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.equal((JSON.parse(accepted.stdout) as { accepted: { to: string } }).accepted.to, draft?.text);
      assert.equal(clew(['spec', 'workflow', 'delete', '--id', 'w1.s5', '--reason', 'probe done', '--json'], env).status, 0);
      assert.equal(clew(['spec', 'workflow', 'edit', '--id', 'w1.s3', '--text', 'The warehouse ships the order as shipped.', '--reason', 'same', '--json'], env).status, 2, 'unchanged text');
      assert.equal(clew(['spec', 'workflow', 'set', '--workflow', 'w2', '--mode', 'exact', '--reason', 'approve must come first', '--json'], env).status, 0);
      const stored = JSON.parse(readFileSync(join(dir, 'data', 'spec', 'order', 'workflows.json'), 'utf8')) as { workflows: { id: string; sentences: { id: string; latest: unknown; history: unknown[]; parsed: { grammar: string; statement: { kind: string } | null } | null }[]; history: unknown[] }[] };
      const w1 = stored.workflows.find((item) => item.id === 'w1')!;
      assert.equal(w1.sentences.find((sentence) => sentence.id === 'w1.s5')?.latest, null, 'a tombstone');
      assert.equal(w1.sentences.find((sentence) => sentence.id === 'w1.s5')?.parsed, null, 'a tombstone has no parse');
      assert.equal(w1.sentences.find((sentence) => sentence.id === 'w1.s2')?.parsed?.statement?.kind, 'block', 'the parse is stored');
      assert.deepEqual(Object.keys(w1.sentences[0]!).sort(), ['history', 'id', 'latest', 'original', 'parsed'], 'nothing compiled is stored');

      // The parse is kept until the grammar words change; then check blocks and parse refreshes it.
      writeFileSync(join(dir, 'lexicon2.json'), JSON.stringify({ ...ORDER_LEXICON, terms: ['gift card'] }));
      assert.equal(clew(['spec', 'canon', 'lexicon', '--file', join(dir, 'lexicon2.json'), '--reason', 'a new term', '--json'], env).status, 0);
      const stale = clew(['spec', 'workflow', 'check', '--json'], env);
      assert.equal(stale.status, 1);
      assert.ok((JSON.parse(stale.stdout) as { workflowFindings: { code: string }[] }).workflowFindings.every((finding) => finding.code === 'parse-stale'));
      const reparsed = clew(['spec', 'workflow', 'parse', '--json'], env);
      assert.equal(reparsed.status, 0, reparsed.stdout);
      assert.ok((JSON.parse(reparsed.stdout) as { reparsed: string[] }).reparsed.includes('w1.s1'));
      assert.deepEqual((JSON.parse(clew(['spec', 'workflow', 'parse', '--json'], env).stdout) as { reparsed: string[] }).reparsed, [], 'only stale parses are parsed again');

      // A milestone freezes the spec, not the workflows.
      const closed = clew(['spec', 'milestone', 'close', '--title', 'Order', '--goal', 'the order spec', '--json'], env);
      assert.equal(closed.status, 0, closed.stdout + closed.stderr);
      assert.ok(existsSync(join(dir, 'data', 'spec', 'order', 'milestones', 'm1', 'sentences.json')));
      assert.ok(!existsSync(join(dir, 'data', 'spec', 'order', 'milestones', 'm1', 'workflows.json')));
      assert.equal(w1.sentences.find((sentence) => sentence.id === 'w1.s5')?.history.length, 3, 'added, accepted, deleted');
      assert.equal(stored.workflows.find((item) => item.id === 'w2')?.history.length, 2);

      const out = join(dir, 'tla');
      mkdirSync(out);
      assert.equal(clew(['spec', 'workflow', 'export', '--dir', out, '--name', 'Order', '--json'], env).status, 2, 'canon export first');
      assert.equal(clew(['spec', 'canon', 'export', '--dir', out, '--name', 'Order', '--json'], env).status, 0);
      const exported = clew(['spec', 'workflow', 'export', '--dir', out, '--name', 'Order', '--json'], env);
      assert.equal(exported.status, 0, exported.stderr);
      assert.ok(existsSync(join(out, 'OrderWorkflows.tla')));
      assert.ok(existsSync(join(out, 'OrderWorkflow_w4.cfg')));

      const jar = process.env.TLA2TOOLS_JAR;
      if (jar !== undefined && jar !== '' && existsSync(jar)) {
        const verified = clew(['spec', 'workflow', 'verify', '--dir', out, '--name', 'Order', '--jar', jar, '--json'], env);
        const runs = (JSON.parse(verified.stdout) as { runs: { workflow: string; outcome: string; path?: { kind: string; specSentence?: string }[] }[] }).runs;
        assert.deepEqual(runs.map((run) => `${run.workflow}:${run.outcome}`), ['w1:holds', 'w2:holds', 'w3:fails', 'w4:holds'], verified.stdout);
        assert.equal(verified.status, 1, 'w3 goes through: branch 2 of s3 has no "submitted" guard');
        assert.deepEqual(runs[2]?.path?.map((step) => step.specSentence), ['s3']);
        assert.ok(runs[0]?.path?.some((step) => step.kind === 'other' && step.specSentence === 's9'), 'packing happens between the steps');

        const impossible = join(dir, 'impossible.md');
        writeFileSync(impossible, '## Ship before packing (possible, exact)\n\nThe customer submits the order as submitted.\nThe manager reviews the order as approved.\nThe warehouse ships the order as shipped.\n');
        assert.equal(clew(['spec', 'workflow', 'add', '--file', impossible, '--reason', 'probe', '--json'], env).status, 0);
        const stuck = JSON.parse(clew(['spec', 'workflow', 'verify', '--dir', out, '--name', 'Order', '--workflow', 'w5', '--jar', jar, '--json'], env).stdout) as { runs: { outcome: string; stopsAt?: { step: number; reached: number; asks: { words: string; tla: string }[] } }[] };
        assert.equal(stuck.runs[0]?.outcome, 'fails');
        assert.equal(stuck.runs[0]?.stopsAt?.step, 3);
        assert.equal(stuck.runs[0]?.stopsAt?.reached, 2);
        assert.deepEqual(stuck.runs[0]?.stopsAt?.asks.map((ask) => ask.words), ['warehouse', 'the order as shipped']);

        // Authorization: the spec lets the manager review, so a customer who reviews is a step TLC never finds.
        const wrongActor = join(dir, 'wrong-actor.md');
        writeFileSync(wrongActor, '## Customer approves (refused)\n\nThe customer submits the order as submitted.\nThe customer reviews the order as approved.\n\n## Manager approves (possible)\n\nThe customer submits the order as submitted.\nThe manager reviews the order as approved.\n');
        assert.equal(clew(['spec', 'workflow', 'add', '--file', wrongActor, '--reason', 'probe', '--json'], env).status, 0);
        for (const id of ['w6', 'w7']) {
          const ran = JSON.parse(clew(['spec', 'workflow', 'verify', '--dir', out, '--name', 'Order', '--workflow', id, '--jar', jar, '--json'], env).stdout) as { runs: { outcome: string }[] };
          assert.equal(ran.runs[0]?.outcome, 'holds', id);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
