// The canonical pipeline: the Chevrotain parser, the gate and its drafts, the compiler, the TLA+ text, and the CLI.
// Every example is synthetic (an order workflow).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chevrotainCanonParser } from '../../src/adapters/canon/chevrotain-parser.js';
import { readTlcOutput, sentenceOfName } from '../../src/application/canon.js';
import type { CanonLexicon } from '../../src/domain/canon-ast.js';
import { compileCanon } from '../../src/domain/canon-compile.js';
import { runGate } from '../../src/domain/canon-gate.js';
import { canonTlaFiles } from '../../src/domain/canon-tla.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const LEXICON: CanonLexicon = { actors: ['customer', 'manager', 'warehouse'], terms: [], states: [], verbs: [], fixed: ['total'] };

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

function gate(texts: string[], lexicon: CanonLexicon = LEXICON) {
  const parser = chevrotainCanonParser.forLexicon(lexicon);
  return runGate(texts.map((text, index) => ({ id: `s${index + 1}`, text })), lexicon, (text) => parser.parse(text));
}

function compiled(texts: string[]) {
  const result = gate(texts);
  const accepted = result.sentences.filter((sentence) => sentence.statement !== undefined).map((sentence) => ({ id: sentence.id, text: sentence.text, statement: sentence.statement! }));
  return { result, model: compileCanon(accepted, LEXICON) };
}

describe('canonical parser', () => {
  test('chevrotain is imported from one adapter only', () => {
    const imports: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/from ['"]chevrotain['"]/.test(readFileSync(path, 'utf8'))) imports.push(path);
      }
    };
    walk(join(root, 'src'));
    assert.deepEqual(imports, [join(root, 'src', 'adapters', 'canon', 'chevrotain-parser.ts')]);
  });

  test('a block with two branches parses into one statement with two branches', () => {
    const parsed = chevrotainCanonParser.forLexicon(LEXICON).parse(ORDER[2]!);
    assert.equal(parsed.diagnostics.length, 0);
    const statement = parsed.statement;
    assert.ok(statement !== null && statement.kind === 'block');
    assert.equal(statement.branches.length, 2);
  });

  test('marks and invariants are their own forms', () => {
    const parser = chevrotainCanonParser.forLexicon(LEXICON);
    assert.equal(parser.parse(ORDER[0]!).statement?.kind, 'mark');
    assert.equal(parser.parse(ORDER[7]!).statement?.kind, 'invariant');
  });

  test('a syntax error names what was found and what the grammar expected', () => {
    const parsed = chevrotainCanonParser.forLexicon(LEXICON).parse('The order ends as shipped, cancelled.');
    assert.equal(parsed.statement, null);
    const first = parsed.diagnostics[0]!;
    assert.equal(first.severity, 'syntax');
    assert.equal(first.found, ',');
    assert.ok(first.expected.includes('"or"'));
  });

  test('an empty lexicon still builds a lexer', () => {
    const parsed = chevrotainCanonParser.forLexicon({ actors: [], terms: [], states: [], verbs: [] }).parse('The order starts as draft.');
    assert.equal(parsed.diagnostics.length, 0);
  });
});

describe('canonical gate', () => {
  test('every sentence of the order example passes', () => {
    const result = gate(ORDER);
    assert.deepEqual(result.sentences.filter((sentence) => sentence.status === 'dangling').map((sentence) => sentence.id), []);
  });

  test('a sentence outside the grammar is dangling, with a draft that passes', () => {
    const result = gate([...ORDER, 'Once the order is approved, the warehouse must pack it.']);
    const dangling = result.sentences.find((sentence) => sentence.id === 's10')!;
    assert.equal(dangling.status, 'dangling');
    assert.equal(dangling.draft?.text, 'When the order is approved, the warehouse packs the order as packed.');
    assert.equal(dangling.draft?.parses, true);
    assert.equal(dangling.draft?.needsConfirm, true);
  });

  test('a comma in a list of states is drafted as "or", not dropped', () => {
    const result = gate([...ORDER.slice(0, 6), 'The order ends as shipped, rejected or cancelled.']);
    const draft = result.sentences.find((sentence) => sentence.id === 's7')!.draft!;
    assert.equal(draft.text, 'The order ends as shipped or rejected or cancelled.');
    assert.deepEqual(draft.dropped, []);
  });

  test('a refusal with a result is a rule violation', () => {
    const result = gate([...ORDER, 'The customer cannot cancel the order as cancelled.']);
    const dangling = result.sentences.find((sentence) => sentence.id === 's10')!;
    assert.equal(dangling.status, 'dangling');
    assert.ok(dangling.diagnostics.some((diagnostic) => diagnostic.severity === 'rule'));
  });

  test('"again" gives a draft with a placeholder to fill in', () => {
    const result = gate([...ORDER, 'The customer submits the order again.']);
    const draft = result.sentences.find((sentence) => sentence.id === 's10')!.draft!;
    assert.equal(draft.needsInput, true);
    assert.equal(draft.parses, false);
  });
});

describe('canonical compiler', () => {
  test('one action per branch, named after the sentence', () => {
    const { model } = compiled(ORDER);
    assert.deepEqual(model.actions.map((action) => action.name).sort(), ['CancelOrder_s5', 'PackOrder_s9', 'ReviewOrder_s3_1', 'ReviewOrder_s3_2', 'ShipOrder_s4', 'SubmitOrder_s2']);
    assert.equal(sentenceOfName('ReviewOrder_s3_2'), 's3');
  });

  test('a noun no sentence changes is abstract; the lexicon can fix it', () => {
    const { model } = compiled(ORDER);
    const total = model.nouns.find((noun) => noun.noun === 'total')!;
    assert.equal(total.abstract, true);
    assert.equal(total.fixed, true);
    const order = model.nouns.find((noun) => noun.noun === 'order')!;
    assert.deepEqual(order.initial, ['draft']);
    assert.deepEqual(order.finals, ['cancelled', 'rejected', 'shipped']);
  });

  test('the blocks module has the refusal, the invariant, NoStuck, and no Environment step for a fixed noun', () => {
    const { model } = compiled(ORDER);
    const files = canonTlaFiles({ name: 'Order', session: 'order', model });
    assert.equal(files.blocks.module, 'OrderBlocks');
    assert.match(files.blocks.tla, /^-+ MODULE OrderBlocks -+$/m);
    assert.match(files.blocks.tla, /NoStuck == \(~ENABLED Actions\) => Done/);
    assert.match(files.blocks.tla, /InvOrder_s8 ==/);
    assert.match(files.blocks.tla, /RefuseCancelOrder_s6 == \[\]\[\(CancelOrder_s5 => /);
    assert.doesNotMatch(files.blocks.tla, /Environment ==/);
    assert.match(files.blocks.cfg, /CHECK_DEADLOCK FALSE/);
    assert.match(files.model.tla, /Blocks == INSTANCE OrderBlocks/);
    assert.match(files.check.tla, /Cover_ShipOrder_s4/);
  });

  test('a state no sentence sets is a finding', () => {
    const { model } = compiled([...ORDER, 'The warehouse returns the order as returned when the order is lost.']);
    assert.ok(model.findings.some((finding) => finding.code === 'state-never-set'));
  });
});

describe('TLC output', () => {
  test('a violation, its trace, and coverage map back to sentences', () => {
    const output = [
      'Error: Invariant InvOrder_s8 is violated.',
      'Error: The behavior up to this point is:',
      'State 1: <Initial predicate>',
      '/\\ order_status = "draft"',
      '',
      'State 2: <ShipOrder_s4 line 40, col 1 to line 44, col 20 of module OrderBlocks>',
      '/\\ order_status = "shipped"',
      '',
      '<Cover_ShipOrder_s4 line 12, col 1 to line 12, col 30 of module OrderCheck>: 1:2',
      '14 states generated, 10 distinct states found, 0 states left on queue.',
    ].join('\n');
    const view = readTlcOutput({ exitCode: 12, timedOut: false, output, command: 'java tlc2.TLC' });
    assert.equal(view.status, 'violation');
    assert.equal(view.violation?.sentence, 's8');
    assert.equal(view.trace?.[1]?.sentence, 's4');
    assert.deepEqual(view.coverage, [{ action: 'ShipOrder_s4', sentence: 's4', distinct: 1, total: 2 }]);
    assert.deepEqual(view.states, { generated: 14, distinct: 10 });
  });

  test('a clean run passes', () => {
    const view = readTlcOutput({ exitCode: 0, timedOut: false, output: 'Model checking completed. No error has been found.', command: 'java' });
    assert.equal(view.status, 'pass');
  });
});

function clew(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('clew spec canon', { concurrency: false }, () => {
  test('lexicon, check, accept, export, and status end to end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-canon-'));
    try {
      const env = { CLEW_DATA_DIR: join(dir, 'data') };
      const spec = join(dir, 'order.md');
      writeFileSync(spec, `# Order\n\n${[...ORDER.slice(0, 8), 'Once the order is approved, the warehouse must pack it.'].join('\n')}\n`);
      writeFileSync(join(dir, 'lexicon.json'), JSON.stringify(LEXICON));
      assert.equal(clew(['spec', 'init', spec, '--json'], env).status, 0);

      const before = clew(['spec', 'canon', 'check', '--json'], env);
      assert.equal(before.status, 2, 'no lexicon yet');

      const lexicon = clew(['spec', 'canon', 'lexicon', '--file', join(dir, 'lexicon.json'), '--reason', 'order example', '--json'], env);
      assert.equal(lexicon.status, 0, lexicon.stderr);

      const check = clew(['spec', 'canon', 'check', '--json'], env);
      assert.equal(check.status, 1);
      const document = JSON.parse(check.stdout) as { dangling: { id: string; draft?: { parses: boolean } }[] };
      assert.deepEqual(document.dangling.map((item) => item.id), ['s9']);
      assert.equal(document.dangling[0]?.draft?.parses, true);

      const status = JSON.parse(clew(['spec', 'status', '--json'], env).stdout) as { canon?: { dangling: { id: string }[] } };
      assert.deepEqual(status.canon?.dangling.map((item) => item.id), ['s9']);

      const accept = clew(['spec', 'canon', 'accept', '--id', 's9', '--reason', 'packing follows approval', '--json'], env);
      assert.equal(accept.status, 0, accept.stderr);
      assert.equal(clew(['spec', 'canon', 'check'], env).status, 0);

      const history = readFileSync(join(dir, 'data', 'spec', 'order', 'canon.json'), 'utf8');
      assert.match(history, /"action": "accept"/);

      const out = join(dir, 'tla');
      mkdirSync(out);
      const exported = clew(['spec', 'canon', 'export', '--dir', out, '--name', 'Order', '--json'], env);
      assert.equal(exported.status, 0, exported.stderr);
      for (const file of ['OrderBlocks.tla', 'OrderBlocks.cfg', 'OrderCheck.tla', 'OrderCheck.cfg', 'OrderCoverage.cfg', 'Order.tla']) assert.ok(existsSync(join(out, file)), file);

      writeFileSync(join(out, 'Order.tla'), `${readFileSync(join(out, 'Order.tla'), 'utf8')}\\* edited\n`);
      const again = JSON.parse(clew(['spec', 'canon', 'export', '--dir', out, '--name', 'Order', '--json'], env).stdout) as { files: { module: string; kept?: boolean }[] };
      assert.equal(again.files.find((file) => file.module === 'Order')?.kept, true);

      const jar = process.env.TLA2TOOLS_JAR;
      if (jar !== undefined && jar !== '' && existsSync(jar)) {
        const tlc = clew(['spec', 'canon', 'tlc', join(out, 'OrderBlocks.tla'), '--jar', jar, '--json'], env);
        assert.equal(tlc.status, 0, tlc.stdout);
        const coverage = JSON.parse(clew(['spec', 'canon', 'tlc', join(out, 'OrderCheck.tla'), '--config', join(out, 'OrderCoverage.cfg'), '--coverage', '--jar', jar, '--json'], env).stdout) as { tlc: { coverage: { action: string }[] } };
        assert.ok(coverage.tlc.coverage.some((row) => row.action === 'ShipOrder_s4'));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tlc without a jar is exit 2 with a message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-canon-'));
    try {
      writeFileSync(join(dir, 'M.tla'), '---- MODULE M ----\n====\n');
      const result = clew(['spec', 'canon', 'tlc', join(dir, 'M.tla')], { TLA2TOOLS_JAR: '' });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /tla2tools\.jar/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
