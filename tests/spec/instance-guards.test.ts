import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import { specTextSource } from '../../src/adapters/spec-store/read-spec.js';
import { tlaTextFiles } from '../../src/adapters/tla/text-files.js';
import { exportTla } from '../../src/application/export-tla.js';
import { initSpec } from '../../src/application/init-spec.js';
import { listFrames } from '../../src/application/list-frames.js';
import { setFrameRole } from '../../src/application/refine-frames.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import type { GuardRead, InstanceSet } from '../../src/domain/spec-actions.js';
import { instanceEffectTexts, instanceGuardTexts, instanceUniverse, ownerChain, plainInstanceNames } from '../../src/domain/spec-instances.js';
import { predicateText } from '../../src/domain/spec-expr.js';
import { compileSnapshot } from '../../src/domain/spec-compile.js';
import type { Value } from '../../src/domain/valuation.js';

// A shipment holds crates and a crate holds parcels. The clerk works on the shipment, the picker on the rest.
const SPEC = [
  'The clerk opens the shipment as open.',
  'The picker adds the crate as empty.',
  'The picker loads the parcel as loose.',
  'The picker packs the parcel as packed.',
  'The picker closes the crate as closed.',
  'The clerk seals the shipment as sealed.',
  'The clerk blocks the shipment as late.',
  'The picker damages the parcel as damaged.',
].join('\n');

const OPEN = 'fr:s1.t1';
const ADD = 'fr:s2.t1';
const LOAD = 'fr:s3.t1';
const PACK = 'fr:s4.t1';
const CLOSE = 'fr:s5.t1';
const SEAL = 'fr:s6.t1';
const BLOCK = 'fr:s7.t1';
const DAMAGE = 'fr:s8.t1';

const atom = (v: string): Value => ({ t: 'atom', v });

/** Set to a tla2tools.jar to also run TLC on what Clew exports. Clew itself never runs TLC. */
const TLA2TOOLS = process.env.CLEW_TLA2TOOLS;

describe('guards that count instances', { concurrency: false }, () => {
  test('frames set reads every:, some:, and none: on a when ref, and stores the quantifier with the ref', () => {
    withSession(() => {
      const outcome = when(SEAL, [OPEN, `every:${CLOSE}`]);
      assert.equal(outcome.exit, 'pass');
      const role = outcome.document.frame?.roles.when.latest.value;
      assert.ok(role !== undefined && role !== 'unknown');
      assert.deepEqual(role.refs, [OPEN, CLOSE]);
      assert.deepEqual(role.quant, { [CLOSE]: 'every' });
      assert.match(role.text, /every: The picker closes the crate as closed/);
      // The store round-trips it: the next read still has the quantifier.
      const listed = listFrames({}, jsonSpecStore).document.frames?.find((frame) => frame.id === SEAL);
      const stored = listed?.roles.when.latest.value;
      assert.ok(stored !== undefined && stored !== 'unknown');
      assert.deepEqual(stored.quant, { [CLOSE]: 'every' });
      // Writing the same refs with another quantifier is a new value, not "already reads that".
      assert.equal(when(SEAL, [OPEN, `some:${CLOSE}`]).exit, 'pass');
    });
  });

  test('a quantifier needs a transition about another object, cited once', () => {
    withSession(() => {
      const own = when(SEAL, [`every:${BLOCK}`]);
      assert.equal(own.exit, 'invalid');
      assert.match(own.document.issues[0]?.message ?? '', /own object/);
      const twice = when(SEAL, [`every:${CLOSE}`, CLOSE]);
      assert.equal(twice.exit, 'invalid');
      assert.match(twice.document.issues[0]?.message ?? '', /listed twice/);
      assert.equal(when(SEAL, ['every:fr:s9.t1']).exit, 'invalid');
    });
  });

  test('a counted object is an instance set, and its owner is the counted object that counts it', () => {
    withSession(() => {
      wire();
      const compiled = compiledNow();
      // The shipment counts crates and parcels but is one shipment; the crate counts parcels and is counted itself.
      assert.deepEqual(compiled.instances, [
        { object: 'parcel', objectVar: 'parcel_status', owner: 'crate_status' },
        { object: 'crate', objectVar: 'crate_status' },
      ]);
      assert.deepEqual(ownerChain(compiled.instances ?? [], 'parcel_status'), ['parcel_status', 'crate_status']);
      assert.deepEqual(ownerChain(compiled.instances ?? [], 'shipment_status'), []);
      const close = compiled.items.find((item) => item.id === CLOSE);
      assert.ok(close?.kind === 'action');
      assert.deepEqual(close.reads, [
        { kind: 'own', var: 'crate_status', values: [atom('empty')] },
        { kind: 'object', var: 'parcel_status', values: [atom('packed')], quant: 'every' },
      ]);
      // The kernel keeps one variable per object. `every` holds for an instance that does not exist yet.
      assert.equal(predicateText(close.when, 'math'), 'crate_status = "empty" ∧ (parcel_status = "packed" ∨ parcel_status = null)');
      const block = compiled.items.find((item) => item.id === BLOCK);
      assert.ok(block?.kind === 'action');
      assert.equal(predicateText(block.when, 'math'), 'shipment_status = "open" ∧ parcel_status = "damaged"');
    });
  });

  test('frames list shows a counted guard as the frames state it', () => {
    withSession(() => {
      wire();
      const frames = listFrames({}, jsonSpecStore).document.frames ?? [];
      const text = (id: string): [string, string] => {
        const compiled = frames.find((frame) => frame.id === id)?.compiled;
        return [compiled?.when ?? '', compiled?.effect ?? ''];
      };
      assert.deepEqual(text(OPEN), ['shipment_status = null', 'shipment_status\' = "open"']);
      assert.deepEqual(text(LOAD), ['parcel_status[self] = null ∧ crate_status[ParcelOwner[self]] = "empty"', 'parcel_status[self]\' = "loose"']);
      assert.deepEqual(text(CLOSE), [
        'crate_status[self] = "empty" ∧ ∀ p ∈ Parcel : ParcelOwner[p] = self ∧ parcel_status[p] ≠ null ⇒ parcel_status[p] = "packed"',
        'crate_status[self]\' = "closed"',
      ]);
      assert.deepEqual(text(SEAL), ['shipment_status = "open" ∧ ∀ c ∈ Crate : crate_status[c] ≠ null ⇒ crate_status[c] = "closed"', 'shipment_status\' = "sealed"']);
      assert.deepEqual(text(BLOCK), ['shipment_status = "open" ∧ ∃ p ∈ Parcel : parcel_status[p] = "damaged"', 'shipment_status\' = "late"']);
    });
  });

  test('the frames module makes a counted object a function over its instances', () => {
    withSession(() => {
      wire();
      const outcome = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles);
      assert.equal(outcome.exit, 'pass');
      const tla = outcome.document.tla ?? '';
      assert.match(tla, /\nCrate == \{"crate1", "crate2"\}\nParcel == \{"parcel1", "parcel2", "parcel3", "parcel4"\}\n/);
      assert.match(tla, /ParcelOwner == \[p \\in Parcel \|-> CASE p \\in \{"parcel1", "parcel2"\} -> "crate1" \[\] p \\in \{"parcel3", "parcel4"\} -> "crate2"\]\n/);
      assert.match(tla, /TypeOK ==\n {2}\/\\ shipment_status \\in ShipmentStatus \\cup \{Null\}\n {2}\/\\ crate_status \\in \[Crate -> CrateStatus \\cup \{Null\}\]\n {2}\/\\ parcel_status \\in \[Parcel -> ParcelStatus \\cup \{Null\}\]\n/);
      assert.match(tla, /Init ==\n {2}\/\\ shipment_status = Null\n {2}\/\\ crate_status = \[c \\in Crate \|-> Null\]\n {2}\/\\ parcel_status = \[p \\in Parcel \|-> Null\]\n/);
      // An action on a counted object is about one instance, and its event is any instance taking it.
      assert.match(tla, /Close_at\(self\) ==\n {2}\/\\ crate_status\[self\] = "empty"\n {2}\/\\ \\A p \\in Parcel : ParcelOwner\[p\] = self \/\\ parcel_status\[p\] # Null => parcel_status\[p\] = "packed"\n {2}\/\\ crate_status' = \[crate_status EXCEPT !\[self\] = "closed"\]\n {2}\/\\ UNCHANGED <<shipment_status, parcel_status>>\nClose == \\E self \\in Crate : Close_at\(self\)\n/);
      // A parcel reads the one crate it belongs to.
      assert.match(tla, /Load_at\(self\) ==\n {2}\/\\ parcel_status\[self\] = Null\n {2}\/\\ crate_status\[ParcelOwner\[self\]\] = "empty"\n/);
      // The shipment is one object, so it counts every crate and any parcel.
      assert.match(tla, /Seal ==\n {2}\/\\ shipment_status = "open"\n {2}\/\\ \\A c \\in Crate : crate_status\[c\] # Null => crate_status\[c\] = "closed"\n {2}\/\\ shipment_status' = "sealed"\n/);
      assert.match(tla, /Block ==\n {2}\/\\ shipment_status = "open"\n {2}\/\\ \\E p \\in Parcel : parcel_status\[p\] = "damaged"\n/);
      assert.match(tla, /Next ==\n {2}\\\/ Open\n {2}\\\/ Add\n {2}\\\/ Load\n {2}\\\/ Pack\n {2}\\\/ Close\n {2}\\\/ Seal\n {2}\\\/ Block\n {2}\\\/ Damage\n/);
      // The check module still names the closed actions, so coverage reads the same.
      assert.match(outcome.document.check?.tla ?? '', /Cover_Close == Next \/\\ Frames!Close\n/);
      assert.deepEqual(outcome.document.findings, []);
    });
  });

  test('a plain read of a counted object that is not the reader\'s owner is reported, and read as some', () => {
    withSession(() => {
      wire();
      // The shipment is blocked "when the parcel is damaged": which parcel is not said.
      assert.equal(when(BLOCK, [OPEN, DAMAGE]).exit, 'pass');
      const outcome = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles);
      const finding = outcome.document.findings.find((item) => item.code === 'instance-read-unquantified');
      assert.deepEqual(finding?.refs, [BLOCK, 'parcel_status']);
      assert.match(outcome.document.tla ?? '', /Block ==\n {2}\/\\ shipment_status = "open"\n {2}\/\\ \\E p \\in Parcel : parcel_status\[p\] = "damaged"\n/);
    });
  });

  test('two objects that count each other own neither, and that is reported', () => {
    withSession(() => {
      wire();
      assert.equal(when(PACK, [LOAD, `none:${CLOSE}`]).exit, 'pass');
      const outcome = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles);
      const codes = outcome.document.findings.map((item) => item.id).sort();
      // A parcel no longer has one crate to read, so its plain read of the crate is reported too.
      assert.deepEqual(codes, ['instance-cycle:crate_status', 'instance-cycle:parcel_status', `instance-read-unquantified:${LOAD}:crate_status`]);
      // Without an owner, each side counts all of the other.
      assert.match(outcome.document.tla ?? '', /\/\\ \\A c \\in Crate : crate_status\[c\] # "closed"\n/);
      assert.doesNotMatch(outcome.document.tla ?? '', /ParcelOwner/);
    });
  });

  test('a spec with no quantifier compiles and exports as before', () => {
    withSession(() => {
      assert.equal(when(CLOSE, [ADD, PACK]).exit, 'pass');
      const compiled = compiledNow();
      assert.deepEqual(compiled.instances, []);
      const tla = exportTla({ dryRun: true, force: false }, jsonSpecStore, tlaTextFiles).document.tla ?? '';
      assert.match(tla, /Close ==\n {2}\/\\ crate_status = "empty"\n {2}\/\\ parcel_status = "packed"\n {2}\/\\ crate_status' = "closed"\n/);
      assert.doesNotMatch(tla, /_at\(self\)|\\A |\\E /);
    });
  });

  test('refs to several states of one object are alternatives, and none is their negation', () => {
    const sets: InstanceSet[] = [{ object: 'parcel', objectVar: 'parcel_status' }];
    const reads: GuardRead[] = [
      { kind: 'own', var: 'shipment_status', values: [atom('open')] },
      { kind: 'object', var: 'parcel_status', values: [atom('packed'), atom('damaged')], quant: 'every' },
      { kind: 'object', var: 'parcel_status', values: [atom('loose')], quant: 'none' },
      { kind: 'object', var: 'dock_status', values: [atom('free'), atom('idle')] },
      { kind: 'condition', var: 'cond_s1_t9', values: [{ t: 'bool', v: false }] },
    ];
    assert.deepEqual(instanceGuardTexts(reads, sets, plainInstanceNames(sets), 'tla'), [
      'shipment_status = "open"',
      '\\A p \\in Parcel : parcel_status[p] # Null => parcel_status[p] \\in {"packed", "damaged"}',
      '\\A p \\in Parcel : parcel_status[p] # "loose"',
      'dock_status \\in {"free", "idle"}',
      '~cond_s1_t9',
    ]);
    assert.deepEqual(instanceEffectTexts({ shipment_status: atom('sealed') }, undefined, 'tla'), ['shipment_status\' = "sealed"']);
    assert.deepEqual(instanceEffectTexts({ parcel_status: atom('packed') }, 'parcel_status', 'tla'), ['parcel_status\' = [parcel_status EXCEPT ![self] = "packed"]']);
  });

  test('siblings are counted inside the owner they share', () => {
    // A label and a parcel both belong to a crate; a label frame counts the parcels of its own crate.
    const sets: InstanceSet[] = [
      { object: 'crate', objectVar: 'crate_status' },
      { object: 'parcel', objectVar: 'parcel_status', owner: 'crate_status' },
      { object: 'label', objectVar: 'label_status', owner: 'crate_status' },
    ];
    const reads: GuardRead[] = [
      { kind: 'own', var: 'label_status', values: [{ t: 'null' }] },
      { kind: 'object', var: 'parcel_status', values: [atom('packed')], quant: 'some' },
    ];
    assert.deepEqual(instanceGuardTexts(reads, sets, plainInstanceNames(sets), 'tla'), [
      'label_status[self] = Null',
      '\\E p \\in Parcel : ParcelOwner[p] = LabelOwner[self] /\\ parcel_status[p] = "packed"',
    ]);
    assert.deepEqual(instanceUniverse(sets).map((entry) => [entry.objectVar, entry.ids.length, entry.owners]), [
      ['crate_status', 2, undefined],
      ['parcel_status', 4, ['crate1', 'crate1', 'crate2', 'crate2']],
      ['label_status', 4, ['crate1', 'crate1', 'crate2', 'crate2']],
    ]);
  });

  test('TLC accepts the export, and rejects a model that seals before every crate is closed', { skip: TLA2TOOLS === undefined ? 'set CLEW_TLA2TOOLS to a tla2tools.jar to run TLC' : false }, () => {
    withSession((dir) => {
      wire();
      const model = join(dir, 'Depot.tla');
      assert.equal(exportTla({ dryRun: false, out: join(dir, 'DepotFrames.tla'), model, force: false }, jsonSpecStore, tlaTextFiles).exit, 'pass');
      const tlc = (args: string[]): string => {
        const run = spawnSync('java', ['-cp', TLA2TOOLS ?? '', 'tlc2.TLC', ...args], { cwd: dir, encoding: 'utf8' });
        return `${run.stdout}${run.stderr}`;
      };
      const refinement = ['-config', 'DepotCheck.cfg', 'DepotCheck.tla'];
      assert.match(tlc(refinement), /Model checking completed\. No error has been found\./);
      const counted = tlc(['-coverage', '1', '-config', 'DepotCoverage.cfg', 'DepotCheck.tla']);
      assert.match(counted, /<Cover_Seal [^>]*>: \d+:[1-9]/);
      assert.match(counted, /<Cover_Close [^>]*>: \d+:[1-9]/);

      const text = tlaTextFiles.read(model);
      assert.ok(text.ok);
      const loose = text.text.replace('  /\\ \\A c \\in Crate : crate_status[c] # Null => crate_status[c] = "closed"\n', '');
      assert.notEqual(loose, text.text);
      writeFileSync(model, loose);
      const wrong = tlc(refinement);
      assert.match(wrong, /Action property .* of module DepotFrames is violated/);
      assert.match(wrong, /<Seal line/);
    });
  });
});

function when(frame: string, refs: string[]): ReturnType<typeof setFrameRole> {
  return setFrameRole({ frame, role: 'when', value: refs, reason: 'wire the guard' }, jsonSpecStore);
}

/** Every frame waits on the step before it; the crate counts its parcels and the shipment counts crates and parcels. */
function wire(): void {
  const writes: [string, string[]][] = [
    [ADD, [OPEN]],
    [LOAD, [ADD]],
    [PACK, [LOAD]],
    [CLOSE, [ADD, `every:${PACK}`]],
    [SEAL, [OPEN, `every:${CLOSE}`]],
    [BLOCK, [OPEN, `some:${DAMAGE}`]],
    [DAMAGE, [LOAD]],
  ];
  for (const [frame, refs] of writes) assert.equal(when(frame, refs).exit, 'pass', `${frame} ${refs.join(' ')}`);
}

function compiledNow(): ReturnType<typeof compileSnapshot> {
  let compiled: ReturnType<typeof compileSnapshot> | undefined;
  jsonSpecStore.update('depot', { create: false }, (current) => {
    if (current !== undefined) compiled = compileSnapshot(current);
    return undefined;
  });
  assert.ok(compiled !== undefined);
  return compiled;
}

function withSession(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-instances-'));
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
