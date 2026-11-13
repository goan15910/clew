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
import type { SpecTlaExportDocument } from '../../src/application/documents.js';
import { initSpec } from '../../src/application/init-spec.js';
import { listFrames } from '../../src/application/list-frames.js';
import { setFrameRole } from '../../src/application/refine-frames.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import { viewClauseReach } from '../../src/application/view-clause-reach.js';
import { conjunctTexts, effectText, predicateText, withoutVar } from '../../src/domain/spec-expr.js';
import { parseTlaModel } from '../../src/domain/spec-tla-check.js';
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

/** Set to a tla2tools.jar to also run TLC on what Clew exports. Clew itself never runs TLC. */
const TLA2TOOLS = process.env.CLEW_TLA2TOOLS;

describe('TLA+ export and check', { concurrency: false }, () => {
  test('the frames module names one action per frame, groups them by event, and leaves conditions open', () => {
    withSession((dir) => {
      const outcome = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass');
      const document = outcome.document;
      assert.equal(document.module, 'OrderFrames');
      assert.equal(document.dryRun, true);
      assert.equal(document.written, undefined);
      assert.deepEqual(document.todo, []);
      assert.deepEqual(document.actions?.map((action) => [action.frame, action.event, action.action, action.clause]), [
        [SUBMIT, 'SUBMIT', 'Submit', 'When the customer submits an order'],
        [APPROVE, 'APPROVE', 'Approve_s1_t7', 'the manager approves the order'],
        [APPROVE_AGAIN, 'APPROVE', 'Approve_s2_t6', 'after the manager approves it'],
        [SHIP, 'SHIP', 'Ship', 'The warehouse ships the order'],
      ]);
      const tla = document.tla ?? '';
      assert.match(tla, /^-{4,} MODULE OrderFrames -{4,}\n\(\*\n {2}Written by clew spec tla export\. Do not edit/);
      assert.match(tla, /\n={4,}\n$/);
      assert.match(tla, /vars == <<order_status, package_status, cond_s1_t12>>/);
      assert.match(tla, /OrderStatus == \{"submitted", "approved", "shipped"\}/);
      assert.match(tla, /Init ==\n {2}\/\\ order_status = Null\n {2}\/\\ package_status = Null\n {2}\/\\ cond_s1_t12 \\in BOOLEAN\n/);
      assert.match(tla, /\\\* fr:s1\.t7 {2}s1 "the manager approves the order"\n\\\* {3}actor manager; when "When the customer submits an order and if the total is under 500 dollars"\nApprove_s1_t7 ==\n {2}\/\\ order_status = "submitted"\n {2}\/\\ cond_s1_t12\n {2}\/\\ order_status' = "approved"\n {2}\/\\ UNCHANGED <<package_status, cond_s1_t12>>\n/);
      assert.match(tla, /Approve ==\n {2}\\\/ Approve_s1_t7\n {2}\\\/ Approve_s2_t6\n/);
      assert.match(tla, /ConditionsChange ==\n {2}\/\\ cond_s1_t12' \\in BOOLEAN\n {2}\/\\ UNCHANGED <<order_status, package_status>>\n/);
      assert.match(tla, /Next ==\n {2}\\\/ Submit\n {2}\\\/ Approve\n {2}\\\/ Ship\n {2}\\\/ ConditionsChange\n\nSpec == Init \/\\ \[\]\[Next\]_vars\n/);
      assert.match(tla, /NeverCancel ==\n {2}\[\]\[~\(\/\\ package_status = Null\n {7}\/\\ package_status' = "cancelled"\)\]_vars\n/);
      assert.doesNotMatch(tla, /INSTANCE|RefinesFrames|@frame/);
      assert.equal(existsSync(join(dir, 'OrderFrames.tla')), false);
    });
  });

  test('the starter model copies the frames actions under an identity mapping, and carries none of the checks', () => {
    withSession(() => {
      const model = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles).document.model;
      assert.equal(model?.module, 'Order');
      const tla = model?.tla ?? '';
      assert.match(tla, /^-{4,} MODULE Order -{4,}\n/);
      assert.doesNotMatch(tla, /Do not edit/);
      assert.match(tla, /Frames == INSTANCE OrderFrames WITH\n {2}order_status <- order_status,\n {2}package_status <- package_status,\n {2}cond_s1_t12 <- cond_s1_t12\n/);
      assert.match(tla, /Approve_s1_t7 ==\n {2}\/\\ order_status = "submitted"\n/);
      assert.match(tla, /Next ==\n {2}\\\/ Submit\n {2}\\\/ Approve\n {2}\\\/ Ship\n\nSpec == /);
      assert.doesNotMatch(tla, /RefinesFrames ==|NeverCancel|ConditionsChange|Cover_/);
      const scanned = parseTlaModel(tla);
      assert.equal(scanned.framesModule, 'OrderFrames');
      for (const name of ['Frames', 'Init', 'Next', 'Spec', 'vars']) assert.ok(scanned.defined.includes(name), name);
    });
  });

  test('the check module extends the model with refinement, the forbidden steps, and one Cover_ action per frame action', () => {
    withSession(() => {
      const check = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles).document.check;
      assert.equal(check?.module, 'OrderCheck');
      const tla = check?.tla ?? '';
      assert.match(tla, /^-{4,} MODULE OrderCheck -{4,}\n\(\*\n {2}Written by clew spec tla export\. Do not edit/);
      assert.match(tla, /\nEXTENDS Order\n\nRefinesFrames == Frames!Spec\nFrames_NeverCancel == Frames!NeverCancel\n/);
      assert.match(tla, /\\\* fr:s1\.t7\nCover_Approve_s1_t7 == Next \/\\ Frames!Approve_s1_t7\n/);
      assert.match(tla, /Cover_ConditionsChange == Next \/\\ Frames!ConditionsChange\n/);
      assert.match(tla, /Cover_NoFrame == Next \/\\ ~Frames!Next\n/);
      assert.match(tla, /CoverNext ==\n {2}\\\/ Cover_Submit\n {2}\\\/ Cover_Approve_s1_t7\n {2}\\\/ Cover_Approve_s2_t6\n {2}\\\/ Cover_Ship\n {2}\\\/ Cover_ConditionsChange\n {2}\\\/ Cover_NoFrame\n\nCoverSpec == Init \/\\ \[\]\[CoverNext\]_vars\n/);
      const directives = (text: string): string[] => text.split('\n').filter((line) => line !== '' && !line.startsWith('\\*'));
      assert.deepEqual(directives(check?.cfg ?? ''), ['SPECIFICATION Spec', 'PROPERTY RefinesFrames', 'PROPERTY Frames_NeverCancel', 'CHECK_DEADLOCK FALSE']);
      assert.deepEqual(directives(check?.coverageCfg ?? ''), ['SPECIFICATION CoverSpec', 'CHECK_DEADLOCK FALSE']);
    });
  });

  test('export rewrites the files Clew owns every time, and never replaces a model without --force', () => {
    withSession((dir) => {
      const out = join(dir, 'DepotFrames.tla');
      const model = join(dir, 'Depot.tla');
      const owned = [out, join(dir, 'DepotCheck.tla'), join(dir, 'DepotCheck.cfg'), join(dir, 'DepotCoverage.cfg')];
      const alone = exportTla({ dryRun: false, out, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(alone.exit, 'pass');
      assert.deepEqual(alone.document.written, [out]);
      assert.equal(alone.document.model, undefined);
      assert.equal(existsSync(model), false);

      const first = exportTla({ dryRun: false, out, model, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(first.exit, 'pass');
      assert.equal(first.document.module, 'DepotFrames');
      assert.deepEqual(first.document.written, owned);
      assert.equal(first.document.model?.written, model);
      assert.equal(first.document.check?.module, 'DepotCheck');
      assert.match(readFileSync(model, 'utf8'), /Frames == INSTANCE DepotFrames WITH/);
      assert.match(readFileSync(owned[1] ?? '', 'utf8'), /EXTENDS Depot\n/);
      assert.equal(existsSync(join(dir, 'Depot.cfg')), false);

      for (const file of owned) writeFileSync(file, 'tampered\n');
      writeFileSync(model, `${readFileSync(model, 'utf8')}\\* edited by the agent\n`);
      const again = exportTla({ dryRun: false, out, model, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(again.exit, 'pass');
      assert.equal(again.document.model?.kept, true);
      assert.equal(again.document.model?.written, undefined);
      assert.deepEqual(again.document.written, owned);
      for (const file of owned) assert.notEqual(readFileSync(file, 'utf8'), 'tampered\n');
      assert.match(readFileSync(model, 'utf8'), /edited by the agent/);

      const forced = exportTla({ dryRun: false, out, model, force: true }, jsonSpecStore, tlaTextFiles);
      assert.equal(forced.exit, 'pass');
      assert.equal(forced.document.forced, true);
      assert.doesNotMatch(readFileSync(model, 'utf8'), /edited by the agent/);

      const refused = (command: { out: string; model?: string }, message: RegExp): void => {
        const outcome = exportTla({ dryRun: false, force: false, ...command }, jsonSpecStore, tlaTextFiles);
        assert.equal(outcome.exit, 'invalid');
        assert.match(outcome.document.issues[0]?.message ?? '', message);
      };
      refused({ out: join(dir, '9-lives.tla') }, /names a module after its file/);
      refused({ out: join(dir, 'Depot.txt') }, /ends in \.tla/);
      refused({ out, model: out }, /need three different names/);
      refused({ out: join(dir, 'DepotCheck.tla'), model }, /need three different names/);
      refused({ out, model: join(tmpdir(), 'Depot.tla') }, /write both into one directory/);
    });
  });

  test('a fresh export checks clean, names the two TLC runs, and maps each Cover_ line back to its frames', () => {
    withSession((dir) => {
      const model = exportBoth(dir);
      const outcome = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass');
      const document = outcome.document;
      assert.equal(document.module, 'Order');
      assert.equal(document.framesModule, 'OrderFrames');
      assert.deepEqual(document.findings, []);
      assert.deepEqual(document.files, [
        { role: 'frames', file: join(dir, 'OrderFrames.tla'), state: 'current' },
        { role: 'check', file: join(dir, 'OrderCheck.tla'), state: 'current' },
        { role: 'check-config', file: join(dir, 'OrderCheck.cfg'), state: 'current' },
        { role: 'coverage-config', file: join(dir, 'OrderCoverage.cfg'), state: 'current' },
      ]);
      assert.deepEqual(document.run, {
        refinement: 'java -cp tla2tools.jar tlc2.TLC -config OrderCheck.cfg OrderCheck.tla',
        coverage: 'java -cp tla2tools.jar tlc2.TLC -coverage 1 -config OrderCoverage.cfg OrderCheck.tla',
      });
      assert.deepEqual(document.actions?.map((action) => [action.cover, action.frame, action.sentence]), [
        ['Cover_Submit', SUBMIT, 's1'],
        ['Cover_Approve_s1_t7', APPROVE, 's1'],
        ['Cover_Approve_s2_t6', APPROVE_AGAIN, 's2'],
        ['Cover_Ship', SHIP, 's2'],
      ]);
      assert.deepEqual(document.properties, [{ frame: NEVER_CANCEL, name: 'Frames_NeverCancel' }]);
    });
  });

  test('the model is the agent\'s to rewrite: check only needs the Frames mapping and a current export', () => {
    withSession((dir) => {
      const model = exportBoth(dir);
      writeFileSync(model, agentModel());
      const outcome = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass', JSON.stringify(outcome.document.findings));
      assert.deepEqual(outcome.document.findings, []);

      writeFileSync(model, agentModel().replace('Next == Submit \\/ Approve \\/ Ship\n', 'Step == Submit \\/ Approve \\/ Ship\n'));
      const renamed = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(renamed.exit, 'pass');
      assert.deepEqual(renamed.document.findings.map((finding) => [finding.code, finding.severity, finding.refs]), [['model-names-missing', 'warning', ['Next']]]);

      writeFileSync(model, agentModel().replace(/Frames == INSTANCE OrderFrames WITH\n(?: {2}.*\n)+/, ''));
      const untied = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(untied.exit, 'fail');
      assert.equal(untied.document.framesModule, undefined);
      assert.deepEqual(untied.document.findings.map((finding) => [finding.code, finding.severity]), [['no-frames-instance', 'blocking']]);

      writeFileSync(model, agentModel().replace('Frames == INSTANCE', '\\* Frames == INSTANCE'));
      assert.equal(checkTla({ file: model }, jsonSpecStore, tlaTextFiles).document.findings[0]?.code, 'no-frames-instance');

      const missing = checkTla({ file: join(dir, 'Nope.tla') }, jsonSpecStore, tlaTextFiles);
      assert.equal(missing.exit, 'invalid');
      assert.equal(missing.document.fault, 'unreadable');
      writeFileSync(join(dir, 'notes.tla'), 'just some notes\n');
      const notModule = checkTla({ file: join(dir, 'notes.tla') }, jsonSpecStore, tlaTextFiles);
      assert.equal(notModule.exit, 'invalid');
      assert.match(notModule.document.issues[0]?.message ?? '', /not a TLA\+ module/);
    });
  });

  test('check blocks when a file Clew owns was edited, is missing, or predates a frame change, until the next export', () => {
    withSession((dir) => {
      const model = exportBoth(dir);
      const cfg = join(dir, 'OrderCheck.cfg');
      writeFileSync(cfg, readFileSync(cfg, 'utf8').replace('PROPERTY RefinesFrames\n', ''));
      rmSync(join(dir, 'OrderCoverage.cfg'));
      const edited = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(edited.exit, 'fail');
      assert.deepEqual(edited.document.files?.map((entry) => [entry.role, entry.state]), [['frames', 'current'], ['check', 'current'], ['check-config', 'stale'], ['coverage-config', 'missing']]);
      assert.deepEqual(edited.document.findings.map((finding) => [finding.code, finding.severity]), [['check-files-stale', 'blocking'], ['check-files-stale', 'blocking']]);
      assert.match(edited.document.findings[0]?.message ?? '', /OrderCheck\.cfg is not what the frames export now.*run clew spec tla export --out \S+OrderFrames\.tla --model \S+Order\.tla, then run TLC again/);
      assert.match(edited.document.findings[1]?.message ?? '', /OrderCoverage\.cfg is missing/);
      exportBoth(dir);
      assert.equal(checkTla({ file: model }, jsonSpecStore, tlaTextFiles).exit, 'pass');

      const refined = setFrameRole({ frame: SHIP, role: 'when', value: [SUBMIT], reason: 'ships once submitted' }, jsonSpecStore);
      assert.equal(refined.exit, 'pass', JSON.stringify(refined.document.issues));
      const stale = checkTla({ file: model }, jsonSpecStore, tlaTextFiles);
      assert.equal(stale.exit, 'fail');
      assert.deepEqual(stale.document.findings.map((finding) => finding.code), ['frames-module-stale']);
      assert.equal(exportBoth(dir), model);
      assert.equal(checkTla({ file: model }, jsonSpecStore, tlaTextFiles).exit, 'pass');
      assert.match(readFileSync(join(dir, 'OrderFrames.tla'), 'utf8'), /Ship ==\n {2}\/\\ order_status = "submitted"\n/);
    });
  });

  test('the model scan reads the name, the Frames instance, and what is defined, ignoring comments and strings', () => {
    const model = parseTlaModel([
      '------ MODULE Sample ------',
      '(* Frames == INSTANCE Wrong',
      '   Ghost == TRUE *)',
      'VARIABLES door,  \\* Hidden == 1',
      '  lamp',
      'Open(x) == door = "Frames == INSTANCE Wrong" /\\ door\' = "open"',
      'Frames ==',
      '  INSTANCE SampleFrames WITH door_status <- door',
      'Other == INSTANCE Elsewhere',
      'Next == Open(1)',
      '======',
    ].join('\n'));
    assert.equal(model.name, 'Sample');
    assert.equal(model.framesModule, 'SampleFrames');
    assert.deepEqual(model.defined, ['door', 'lamp', 'Open', 'Frames', 'Other', 'Next']);
    assert.equal(parseTlaModel('---- MODULE Bare ----\n====\n').framesModule, undefined);
  });

  test('the CLI exports and checks, and the inspector reads each guard as an expression', () => {
    withSession((dir) => {
      const model = join(dir, 'Order.tla');
      const wrote = clew(dir, ['spec', 'tla', 'export', '--out', join(dir, 'OrderFrames.tla'), '--model', model, '--json']);
      assert.equal(wrote.status, 0, wrote.stderr);
      assert.equal((JSON.parse(wrote.stdout) as SpecTlaExportDocument).model?.written, model);
      const checked = clew(dir, ['spec', 'tla', 'check', model]);
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /\(module Order\) maps onto OrderFrames, export is current\n {2}current {2}frames {11}\S+OrderFrames\.tla\n/);
      assert.match(checked.stdout, /run TLC yourself:\n {4}java -cp tla2tools\.jar tlc2\.TLC -config OrderCheck\.cfg OrderCheck\.tla\n {4}java -cp tla2tools\.jar tlc2\.TLC -coverage 1 -config OrderCoverage\.cfg OrderCheck\.tla\n/);
      assert.match(checked.stdout, /\n {4}Cover_Ship {2}fr:s2\.t1 {2}"The warehouse ships the order"/);
      const usage = clew(dir, ['spec', 'tla', 'export', '--model', model, '--json']);
      assert.equal(usage.status, 2);
      assert.match(usage.stderr, /export needs --dry-run or --out/);

      const reach = viewClauseReach({ id: 'depot' }, jsonSpecStore);
      assert.equal(reach.compiled[APPROVE]?.when, 'order_status = "submitted" ∧ cond_s1_t12');
      assert.equal(reach.compiled[APPROVE]?.effect, 'order_status\' = "approved"');
      assert.equal(reach.compiled[NEVER_CANCEL]?.kind, 'forbidden');
      assert.equal(reach.compiled[UNDER_500], undefined);
    });
  });

  test('TLC accepts the export, rejects a step the frames do not allow, and reports a frame action the model never takes', { skip: TLA2TOOLS === undefined ? 'set CLEW_TLA2TOOLS to a tla2tools.jar to run TLC' : false }, () => {
    withSession((dir) => {
      const model = exportBoth(dir);
      const tlc = (args: string[]): string => {
        const run = spawnSync('java', ['-cp', TLA2TOOLS ?? '', 'tlc2.TLC', ...args], { cwd: dir, encoding: 'utf8' });
        return `${run.stdout}${run.stderr}`;
      };
      const refinement = ['-config', 'OrderCheck.cfg', 'OrderCheck.tla'];
      const coverage = ['-coverage', '1', '-config', 'OrderCoverage.cfg', 'OrderCheck.tla'];
      assert.match(tlc(refinement), /Model checking completed\. No error has been found\./);
      assert.match(tlc(coverage), /<Cover_Ship [^>]*>: \d+:[1-9]/);

      writeFileSync(model, agentModel());
      assert.match(tlc(refinement), /Model checking completed\. No error has been found\./);
      const counted = tlc(coverage);
      assert.match(counted, /<Cover_Approve_s1_t7 [^>]*>: \d+:[1-9]/);
      assert.match(counted, /<Cover_Approve_s2_t6 [^>]*>: 0:0/);

      writeFileSync(model, agentModel().replace('Ship == order = "approved"', 'Ship == order \\in {"submitted", "approved"}'));
      const wrong = tlc(refinement);
      assert.match(wrong, /Action property .* of module OrderFrames is violated/);
      assert.match(wrong, /<Ship line/);
    });
  });
});

/** A model with its own names and data: one approval, and a real total behind the condition. */
function agentModel(): string {
  return [
    '---- MODULE Order ----',
    'EXTENDS Naturals',
    'VARIABLES order, total',
    'vars == <<order, total>>',
    '',
    'Frames == INSTANCE OrderFrames WITH',
    '  order_status <- IF order = "none" THEN "null" ELSE order,',
    '  package_status <- "null",',
    '  cond_s1_t12 <- total < 500',
    '',
    'Init == order = "none" /\\ total \\in {100, 900}',
    'Submit == order = "none" /\\ order\' = "submitted" /\\ UNCHANGED total',
    'Approve == order = "submitted" /\\ total < 500 /\\ order\' = "approved" /\\ UNCHANGED total',
    'Ship == order = "approved" /\\ order\' = "shipped" /\\ UNCHANGED total',
    '',
    'Next == Submit \\/ Approve \\/ Ship',
    'Spec == Init /\\ [][Next]_vars',
    '====',
    '',
  ].join('\n');
}

/** Exports OrderFrames.tla and the check files, and starts Order.tla when it is not there. Returns the model's path. */
function exportBoth(dir: string): string {
  const model = join(dir, 'Order.tla');
  assert.equal(exportTla({ dryRun: false, out: join(dir, 'OrderFrames.tla'), model, force: false }, jsonSpecStore, tlaTextFiles).exit, 'pass');
  return model;
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
