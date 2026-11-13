import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import { specTextSource } from '../../src/adapters/spec-store/read-spec.js';
import { tlaTextFiles } from '../../src/adapters/tla/text-files.js';
import { yamlSpecLoader } from '../../src/adapters/yaml/spec-loader.js';
import { specViewModel } from '../../src/adapters/yaml/spec-view-model.js';
import { checkTla } from '../../src/application/check-tla.js';
import { exportTla } from '../../src/application/export-tla.js';
import type { SpecTlaCheckDocument, SpecTlaExportDocument } from '../../src/application/documents.js';
import { initSpec } from '../../src/application/init-spec.js';
import { listFrames } from '../../src/application/list-frames.js';
import { setFrameRole } from '../../src/application/refine-frames.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import { viewClauseReach } from '../../src/application/view-clause-reach.js';
import { conjunctTexts, effectText, predicateText, withoutVar } from '../../src/domain/spec-expr.js';
import { parseTlaModule } from '../../src/domain/spec-tla-check.js';
import type { Predicate, Value, VarId } from '../../src/domain/valuation.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const SPEC = [
  'When the customer submits an order, the manager approves the order if the total is under 500 dollars.',
  'The warehouse ships the order after the manager approves it.',
  'A clerk must not cancel a shipped package.',
].join('\n');

const SUBMIT = 'fr:s1.t1';
const APPROVE = 'fr:s1.t7';
const UNDER_500 = 'fr:s1.t12';
const SHIP = 'fr:s2.t1';
const APPROVE_AGAIN = 'fr:s2.t6';
const NEVER_CANCEL = 'fr:s3.t1';

const atom = (v: string): Value => ({ t: 'atom', v });
const eq = (name: string, value: Value): Predicate => ({ op: 'eq', var: name as VarId, value });
const neq = (name: string, value: Value): Predicate => ({ op: 'neq', var: name as VarId, value });

describe('guard expressions', () => {
  const guard: Predicate = {
    op: 'and',
    of: [
      eq('order_status', atom('submitted')),
      eq('paid', { t: 'bool', v: true }),
      { op: 'or', of: [neq('title', atom('')), eq('urgent', { t: 'bool', v: false })] },
      { op: 'not', of: eq('owner', { t: 'null' }) },
    ],
  };

  test('a predicate reads as one expression, in math and in TLA+', () => {
    assert.equal(predicateText(guard, 'math'), 'order_status = "submitted" ∧ paid ∧ (title ≠ "" ∨ ¬urgent) ∧ ¬(owner = null)');
    assert.equal(predicateText(guard, 'tla'), 'order_status = "submitted" /\\ paid /\\ (title # "" \\/ ~urgent) /\\ ~(owner = Null)');
    assert.equal(predicateText({ op: 'true' }, 'math'), 'true');
    assert.equal(predicateText({ op: 'not', of: { op: 'and', of: [eq('n', { t: 'num', v: 3 })] } }, 'tla'), '~(n = 3)');
  });

  test('conjuncts, effects, and the guard left once the control state is taken out', () => {
    assert.deepEqual(conjunctTexts(guard, 'tla'), ['order_status = "submitted"', 'paid', '(title # "" \\/ ~urgent)', '~(owner = Null)']);
    assert.deepEqual(conjunctTexts({ op: 'true' }, 'tla'), []);
    assert.equal(effectText({ order_status: atom('approved'), paid: { t: 'bool', v: false } }, 'math'), 'order_status\' = "approved" ∧ paid\' = false');
    assert.equal(predicateText(withoutVar(guard, 'order_status'), 'math'), 'paid ∧ (title ≠ "" ∨ ¬urgent) ∧ ¬(owner = null)');
    assert.deepEqual(withoutVar(eq('phase', atom('draft')), 'phase'), { op: 'true' });
  });

  test('chart view labels a guarded edge with the expression, not the word "when"', () => {
    const loaded = yamlSpecLoader.load(join(root, 'examples/todo/b-full.yaml'));
    assert.ok(loaded.ok);
    const submit = specViewModel(loaded.value).transitions().find((edge) => edge.event === 'SUBMIT');
    assert.deepEqual(submit?.guard, { name: 'title ≠ ""', reads: 'title' });
  });
});

describe('TLA+ export and check', { concurrency: false }, () => {
  test('the frames module names one action per frame, groups them by event, and cites every frame', () => {
    withSession((dir) => {
      const outcome = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass');
      const document = outcome.document;
      assert.equal(document.module, 'OrderFrames');
      assert.equal(document.dryRun, true);
      assert.equal(document.written, undefined);
      assert.deepEqual(document.todo, []);
      assert.deepEqual(document.placed, [
        { frame: UNDER_500, name: 'cond_s1_t12' },
        { frame: SUBMIT, name: 'Submit' },
        { frame: APPROVE, name: 'Approve_s1_t7' },
        { frame: APPROVE_AGAIN, name: 'Approve_s2_t6' },
        { frame: SHIP, name: 'Ship' },
        { frame: NEVER_CANCEL, name: 'NeverCancel' },
      ]);
      const tla = document.tla ?? '';
      assert.match(tla, /^-{4,} MODULE OrderFrames -{4,}\n\(\*\n {2}Exported by clew spec tla export\. Do not edit/);
      assert.match(tla, /\n={4,}\n$/);
      assert.match(tla, /vars == <<order_status, package_status, cond_s1_t12>>/);
      assert.match(tla, /OrderStatus == \{"submitted", "approved", "shipped"\}/);
      assert.match(tla, /Init ==\n {2}\/\\ order_status = Null\n {2}\/\\ package_status = Null\n {2}\/\\ cond_s1_t12 \\in BOOLEAN\n/);
      assert.match(tla, /\\\* @frame fr:s1\.t7 [0-9a-f]{8}\n\\\* {3}s1 "the manager approves the order"\n\\\* {3}actor manager; when "When the customer submits an order and if the total is under 500 dollars"\nApprove_s1_t7 ==\n {2}\/\\ order_status = "submitted"\n {2}\/\\ cond_s1_t12\n {2}\/\\ order_status' = "approved"\n {2}\/\\ UNCHANGED <<package_status, cond_s1_t12>>\n/);
      assert.match(tla, /Approve ==\n {2}\\\/ Approve_s1_t7\n {2}\\\/ Approve_s2_t6\n/);
      assert.match(tla, /ConditionsChange ==\n {2}\/\\ cond_s1_t12' \\in BOOLEAN\n {2}\/\\ UNCHANGED <<order_status, package_status>>\n/);
      assert.match(tla, /Next ==\n {2}\\\/ Submit\n {2}\\\/ Approve\n {2}\\\/ Ship\n {2}\\\/ ConditionsChange\n\nSpec == Init \/\\ \[\]\[Next\]_vars\n/);
      assert.match(tla, /NeverCancel ==\n {2}\[\]\[~\(\/\\ package_status = Null\n {7}\/\\ package_status' = "cancelled"\)\]_vars\n/);
      assert.doesNotMatch(tla, /INSTANCE|RefinesFrames/);
      assert.equal(existsSync(join(dir, 'OrderFrames.tla')), false);
    });
  });

  test('the starter model copies the frames module, instantiates it with an identity mapping, and asks TLC to check refinement', () => {
    withSession(() => {
      const model = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles).document.model;
      assert.equal(model?.module, 'Order');
      const tla = model?.tla ?? '';
      assert.match(tla, /^-{4,} MODULE Order -{4,}\n/);
      assert.doesNotMatch(tla, /Do not edit/);
      assert.match(tla, /Frames == INSTANCE OrderFrames WITH\n {2}order_status <- order_status,\n {2}package_status <- package_status,\n {2}cond_s1_t12 <- cond_s1_t12\n/);
      assert.match(tla, /\\\* @frame fr:s1\.t7 [0-9a-f]{8}\n(?:\\\*.*\n)*Approve_s1_t7 ==\n {2}\/\\ order_status = "submitted"\n/);
      assert.match(tla, /Next ==\n {2}\\\/ Submit\n {2}\\\/ Approve\n {2}\\\/ Ship\n\nSpec == /);
      assert.match(tla, /\\\* @frame fr:s3\.t1 [0-9a-f]{8}\n(?:\\\*.*\n)*NeverCancel == Frames!NeverCancel\n/);
      assert.match(tla, /RefinesFrames == Frames!Spec\n/);
      assert.deepEqual((model?.cfg ?? '').split('\n').filter((line) => line !== '' && !line.startsWith('\\*')), [
        'SPECIFICATION Spec',
        'INVARIANT TypeOK',
        'PROPERTY RefinesFrames',
        'PROPERTY NeverCancel',
        'CHECK_DEADLOCK FALSE',
      ]);
    });
  });

  test('export rewrites the frames module every time, and never replaces a model without --force', () => {
    withSession((dir) => {
      const out = join(dir, 'DepotFrames.tla');
      const model = join(dir, 'Depot.tla');
      const alone = exportTla({ dryRun: false, out, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(alone.exit, 'pass');
      assert.equal(alone.document.written, out);
      assert.equal(alone.document.model, undefined);
      assert.equal(existsSync(model), false);

      const first = exportTla({ dryRun: false, out, model, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(first.exit, 'pass');
      assert.equal(first.document.module, 'DepotFrames');
      assert.equal(first.document.model?.module, 'Depot');
      assert.equal(first.document.model?.written, model);
      assert.equal(first.document.model?.cfgWritten, join(dir, 'Depot.cfg'));
      assert.match(readFileSync(model, 'utf8'), /Frames == INSTANCE DepotFrames WITH/);

      writeFileSync(out, 'tampered\n');
      writeFileSync(model, `${readFileSync(model, 'utf8')}\\* edited by the agent\n`);
      writeFileSync(join(dir, 'Depot.cfg'), 'SPECIFICATION Spec\n');
      const again = exportTla({ dryRun: false, out, model, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(again.exit, 'pass');
      assert.equal(again.document.model?.kept, true);
      assert.equal(again.document.model?.written, undefined);
      assert.match(readFileSync(out, 'utf8'), / MODULE DepotFrames /);
      assert.match(readFileSync(model, 'utf8'), /edited by the agent/);
      assert.equal(readFileSync(join(dir, 'Depot.cfg'), 'utf8'), 'SPECIFICATION Spec\n');

      const forced = exportTla({ dryRun: false, out, model, force: true }, jsonSpecStore, tlaTextFiles);
      assert.equal(forced.exit, 'pass');
      assert.equal(forced.document.forced, true);
      assert.doesNotMatch(readFileSync(model, 'utf8'), /edited by the agent/);
      assert.match(readFileSync(join(dir, 'Depot.cfg'), 'utf8'), /PROPERTY RefinesFrames/);

      const refused = (command: { out: string; model?: string }, message: RegExp): void => {
        const outcome = exportTla({ dryRun: false, force: false, ...command }, jsonSpecStore, tlaTextFiles);
        assert.equal(outcome.exit, 'invalid');
        assert.match(outcome.document.issues[0]?.message ?? '', message);
      };
      refused({ out: join(dir, '9-lives.tla') }, /names a module after its file/);
      refused({ out: join(dir, 'Depot.txt') }, /ends in \.tla/);
      refused({ out, model: out }, /need different names/);
      refused({ out, model: join(tmpdir(), 'Depot.tla') }, /write both into one directory/);
    });
  });

  test('a fresh model checks clean, and each row puts the frame beside its definition', () => {
    withSession((dir) => {
      const out = scaffold(dir);
      const outcome = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass');
      const document = outcome.document;
      assert.equal(document.module, 'Order');
      assert.deepEqual(document.frames, { module: 'OrderFrames', file: join(dir, 'OrderFrames.tla'), current: true });
      assert.deepEqual(document.findings, []);
      assert.deepEqual(document.counts, { modelled: 6, skipped: 0, changed: 0, missing: 0 });
      const approve = rowOf(document, APPROVE);
      assert.equal(approve.kind, 'action');
      assert.equal(approve.status, 'modelled');
      assert.deepEqual(approve.expects, {
        event: 'APPROVE',
        actor: 'manager',
        when: 'order_status = "submitted" /\\ cond_s1_t12',
        effect: 'order_status\' = "approved"',
      });
      assert.deepEqual(approve.definitions.map((definition) => [definition.name, definition.kind]), [['Approve_s1_t7', 'definition']]);
      assert.equal(approve.definitions[0]?.text, [
        'Approve_s1_t7 ==',
        '  /\\ order_status = "submitted"',
        '  /\\ cond_s1_t12',
        '  /\\ order_status\' = "approved"',
        '  /\\ UNCHANGED <<package_status, cond_s1_t12>>',
      ].join('\n'));
      const condition = rowOf(document, UNDER_500);
      assert.equal(condition.kind, 'condition');
      assert.deepEqual(condition.definitions.map((definition) => [definition.name, definition.kind]), [['cond_s1_t12', 'variable']]);
      assert.equal(rowOf(document, NEVER_CANCEL).kind, 'forbidden');
      assert.equal(rowOf(document, NEVER_CANCEL).definitions[0]?.name, 'NeverCancel');
    });
  });

  test('the mapping is not strict: an agent may merge, rename, and skip, as long as every frame is cited', () => {
    withSession((dir) => {
      const out = scaffold(dir);
      const digest = digests(out);
      writeFileSync(out, [
        '---- MODULE Order ----',
        'EXTENDS Naturals',
        'VARIABLES',
        '  order,',
        `  total  \\* @frame ${UNDER_500} ${digest(UNDER_500)}`,
        'vars == <<order, total>>',
        '',
        'Frames == INSTANCE OrderFrames WITH',
        '  order_status <- IF order = "none" THEN "null" ELSE order,',
        '  package_status <- "null",',
        '  cond_s1_t12 <- total < 500',
        '',
        'Init == order = "none" /\\ total \\in 0..1000',
        '',
        `\\* @frame ${SUBMIT} ${digest(SUBMIT)}`,
        'Submit == order = "none" /\\ order\' = "submitted" /\\ UNCHANGED total',
        '',
        '(* One approval, whichever sentence asks for it.',
        `   @frame ${APPROVE} ${digest(APPROVE)}`,
        `   @frame ${APPROVE_AGAIN} *)`,
        'Approve ==',
        '  /\\ order = "submitted"',
        '  /\\ total < 500',
        '  /\\ order\' = "approved"',
        '  /\\ UNCHANGED total',
        '',
        `\\* @frame ${SHIP} ${digest(SHIP)}`,
        'Ship == order = "approved" /\\ order\' = "shipped" /\\ UNCHANGED total',
        '',
        'Next == Submit \\/ Approve \\/ Ship',
        'Spec == Init /\\ [][Next]_vars',
        'RefinesFrames == Frames!Spec',
        '',
        `\\* @frame ${NEVER_CANCEL} ${digest(NEVER_CANCEL)} skip: packages are out of scope for this model`,
        '====',
        '',
      ].join('\n'));
      const outcome = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass', JSON.stringify(outcome.document.findings));
      const document = outcome.document;
      assert.deepEqual(document.counts, { modelled: 5, skipped: 1, changed: 0, missing: 0 });
      assert.deepEqual(document.findings.map((finding) => [finding.code, finding.severity, finding.refs[0]]), [['frame-unstamped', 'info', APPROVE_AGAIN]]);
      assert.equal(rowOf(document, APPROVE).definitions[0]?.name, 'Approve');
      assert.equal(rowOf(document, APPROVE_AGAIN).definitions[0]?.name, 'Approve');
      assert.deepEqual(rowOf(document, UNDER_500).definitions.map((definition) => [definition.name, definition.kind, definition.text]), [['total', 'variable', 'total']]);
      assert.equal(rowOf(document, NEVER_CANCEL).status, 'skipped');
      assert.equal(rowOf(document, NEVER_CANCEL).skip, 'packages are out of scope for this model');
      assert.equal(document.frames?.current, true);

      writeFileSync(out, readFileSync(out, 'utf8').replace(/Frames == INSTANCE OrderFrames WITH\n(?: {2}.*\n)+/, '').replace('RefinesFrames == Frames!Spec\n', ''));
      const alone = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.equal(alone.exit, 'fail');
      assert.equal(alone.document.frames, undefined);
      assert.deepEqual(alone.document.findings.map((finding) => [finding.code, finding.severity]), [['no-frames-instance', 'blocking'], ['frame-unstamped', 'info']]);
    });
  });

  test('check blocks on a frame with no definition, a stale citation, and an unknown frame, and warns when Next misses an action', () => {
    withSession((dir) => {
      const out = scaffold(dir);
      const original = readFileSync(out, 'utf8');
      const edited = original
        .replace(new RegExp(`\\\\\\* @frame ${escapeRegExp(SHIP)} [0-9a-f]{8}\\n`), '')
        .replace('  \\/ Approve_s2_t6\n', '')
        .replace('NeverCancel ==', '\\* @frame fr:s9.t1\nNeverCancel ==');
      assert.notEqual(edited, original);
      writeFileSync(out, `${edited}\\* @frame ${SUBMIT} skip:\n\\* @frame ${APPROVE}\n`);
      const outcome = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'fail');
      const found = outcome.document.findings.map((finding) => [finding.code, finding.severity, finding.refs[0]]);
      assert.deepEqual(found, [
        ['skip-without-reason', 'blocking', SUBMIT],
        ['frame-unstamped', 'info', SUBMIT],
        ['annotation-without-definition', 'blocking', APPROVE],
        ['frame-unstamped', 'info', APPROVE],
        ['frame-not-modelled', 'blocking', SHIP],
        ['action-not-in-next', 'warning', APPROVE_AGAIN],
        ['unknown-frame', 'blocking', 'fr:s9.t1'],
      ]);
      assert.equal(rowOf(outcome.document, SHIP).status, 'missing');
      assert.deepEqual(outcome.document.counts, { modelled: 5, skipped: 0, changed: 0, missing: 1 });

      const missing = checkTla({ file: join(dir, 'Nope.tla') }, jsonSpecStore, tlaTextFiles);
      assert.equal(missing.exit, 'invalid');
      assert.equal(missing.document.fault, 'unreadable');
      writeFileSync(join(dir, 'notes.tla'), 'just some notes\n');
      const notModule = checkTla({ file: join(dir, 'notes.tla') }, jsonSpecStore, tlaTextFiles);
      assert.equal(notModule.exit, 'invalid');
      assert.match(notModule.document.issues[0]?.message ?? '', /not a TLA\+ module/);
    });
  });

  test('a frame refined after the export makes the frames module stale and its definition frame-changed', () => {
    withSession((dir) => {
      const out = scaffold(dir);
      const before = digests(out)(APPROVE);
      const refined = setFrameRole({ frame: APPROVE, role: 'actor', value: ['concept:warehouse'], reason: 'the warehouse signs off' }, jsonSpecStore);
      assert.equal(refined.exit, 'pass', JSON.stringify(refined.document.issues));
      const outcome = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'fail');
      const row = rowOf(outcome.document, APPROVE);
      assert.equal(row.status, 'changed');
      assert.equal(row.expects.actor, 'warehouse');
      assert.notEqual(row.digest, before);
      assert.equal(outcome.document.frames?.current, false);
      assert.deepEqual(outcome.document.findings.map((finding) => finding.code), ['frames-module-stale', 'frame-changed']);
      assert.match(outcome.document.findings[0]?.message ?? '', /OrderFrames\.tla is not what the frames export now.*run clew spec tla export --out \S+OrderFrames\.tla and run TLC again/);
      const changed = outcome.document.findings.filter((finding) => finding.code === 'frame-changed');
      assert.deepEqual(changed.map((finding) => finding.refs), [[APPROVE, 's1']]);
      assert.match(changed[0]?.message ?? '', new RegExp(`${before} then, ${row.digest} now\\): review Approve_s1_t7 against the frame, then write ${row.digest}`));
      writeFileSync(out, readFileSync(out, 'utf8').replace(`@frame ${APPROVE} ${before}`, `@frame ${APPROVE} ${row.digest}`));
      const restamped = checkTla({ file: out }, jsonSpecStore, tlaTextFiles);
      assert.deepEqual(restamped.document.findings.map((finding) => finding.code), ['frames-module-stale']);
      assert.equal(exportTla({ dryRun: false, out: join(dir, 'OrderFrames.tla'), model: out, force: false }, jsonSpecStore, tlaTextFiles).document.model?.kept, true);
      assert.equal(checkTla({ file: out }, jsonSpecStore, tlaTextFiles).exit, 'pass');
    });
  });

  test('the parser reads definitions, trailing comments, and what each definition names', () => {
    const module = parseTlaModule([
      '------ MODULE Sample ------',
      'VARIABLE door  \\* @frame fr:s1.t1 0123abcd',
      'Open(x) == door = "closed" /\\ door\' = "open"  \\* says "Close" in a string: "Close"',
      'Close == door = "open" /\\ door\' = "closed"',
      'Frames == INSTANCE SampleFrames WITH door_status <- door',
      '\\* a note that names Open, and INSTANCE Other',
      '',
      'Next ==',
      '  \\/ Open(1)  \\* @frame fr:s1.t2',
      '  \\/ Close',
      '======',
    ].join('\n'));
    assert.equal(module.name, 'Sample');
    assert.deepEqual(module.definitions.map((definition) => [definition.name, definition.kind, definition.line]), [
      ['door', 'variable', 2],
      ['Open', 'definition', 3],
      ['Close', 'definition', 4],
      ['Frames', 'definition', 5],
      ['Next', 'definition', 8],
    ]);
    assert.deepEqual(module.instances, ['SampleFrames']);
    assert.deepEqual(module.uses, { Open: [], Close: [], Frames: [], Next: ['Open', 'Close'] });
    assert.deepEqual(module.annotations, [
      { frame: 'fr:s1.t1', line: 2, digest: '0123abcd', target: 'door' },
      { frame: 'fr:s1.t2', line: 9, target: 'Next' },
    ]);
    assert.equal(module.definitions[2]?.text, 'Close == door = "open" /\\ door\' = "closed"');
  });

  test('the CLI prints the alignment, and the inspector reads each guard as an expression', () => {
    withSession((dir) => {
      const out = join(dir, 'Order.tla');
      const wrote = clew(dir, ['spec', 'tla', 'export', '--out', join(dir, 'OrderFrames.tla'), '--model', out, '--json']);
      assert.equal(wrote.status, 0, wrote.stderr);
      assert.equal((JSON.parse(wrote.stdout) as SpecTlaExportDocument).model?.written, out);
      const checked = clew(dir, ['spec', 'tla', 'check', out]);
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /models 6 of 6 frames, 0 skipped, 0 changed, 0 missing\n {2}refines OrderFrames \(\S+OrderFrames\.tla\), current\n/);
      assert.match(checked.stdout, /fr:s2\.t1 {2}modelled {2}action {2}[0-9a-f]{8} {2}"The warehouse ships the order"\n {4}frame {2}SHIP by warehouse: order_status = "approved" -> order_status' = "shipped"\n {4}model {2}Ship \(line \d+\)\n {6}\| Ship ==/);
      const usage = clew(dir, ['spec', 'tla', 'export', '--model', out, '--json']);
      assert.equal(usage.status, 2);
      assert.match(usage.stderr, /export needs --dry-run or --out/);

      const reach = viewClauseReach({ id: 'depot' }, jsonSpecStore);
      assert.equal(reach.compiled[APPROVE]?.when, 'order_status = "submitted" ∧ cond_s1_t12');
      assert.equal(reach.compiled[APPROVE]?.effect, 'order_status\' = "approved"');
      assert.equal(reach.compiled[NEVER_CANCEL]?.kind, 'forbidden');
      assert.equal(reach.compiled[UNDER_500], undefined);
    });
  });
});

/** Exports OrderFrames.tla and starts Order.tla beside it. Returns the model's path. */
function scaffold(dir: string): string {
  const out = join(dir, 'Order.tla');
  assert.equal(exportTla({ dryRun: false, out: join(dir, 'OrderFrames.tla'), model: out, force: false }, jsonSpecStore, tlaTextFiles).exit, 'pass');
  return out;
}

/** The digest the export stamped on each frame's `@frame` comment. */
function digests(file: string): (frame: string) => string {
  const text = readFileSync(file, 'utf8');
  return (frame) => {
    const match = new RegExp(`@frame ${escapeRegExp(frame)} ([0-9a-f]{8})`).exec(text);
    assert.ok(match?.[1] !== undefined, `no digest for ${frame}`);
    return match[1];
  };
}

function rowOf(document: SpecTlaCheckDocument, frame: string): NonNullable<SpecTlaCheckDocument['alignment']>[number] {
  const row = (document.alignment ?? []).find((entry) => entry.frame === frame);
  assert.ok(row !== undefined, `no row for ${frame}`);
  return row;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clew(dataDir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, env: { ...process.env, CLEW_DATA_DIR: dataDir }, encoding: 'utf8' });
}

function withSession(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-tla-'));
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dir;
  try {
    const file = join(dir, 'depot.md');
    writeFileSync(file, `${SPEC}\n`);
    assert.equal(initSpec({ file }, specTextSource, jsonSpecStore).exit, 'pass');
    assert.equal(tagSpec({}, jsonSpecStore, compromiseTagger).exit, 'pass');
    assert.equal(listFrames({}, jsonSpecStore).exit, 'pass');
    body(dir);
  } finally {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
