import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import { specTextSource } from '../../src/adapters/spec-store/read-spec.js';
import type { SpecFramesDocument, SpecStatusDocument } from '../../src/application/documents.js';
import { initSpec } from '../../src/application/init-spec.js';
import { listFrames } from '../../src/application/list-frames.js';
import { setFrameRole } from '../../src/application/refine-frames.js';
import { readSpecStatus } from '../../src/application/spec-status.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import type { CompiledAction, CompiledSpec } from '../../src/domain/spec-actions.js';
import { compileSnapshot } from '../../src/domain/spec-compile.js';
import { clauseFindings, clauseReach } from '../../src/domain/spec-kernel.js';
import type { SpecSnapshot } from '../../src/domain/spec.js';
import { eventName, type Predicate, type Value, type VarId } from '../../src/domain/valuation.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const SPEC = [
  'The clerk packs the order.',
  'When the clerk packs the order, the courier ships the order.',
  'If the coupon is valid, the clerk discounts the order.',
].join('\n');

const PACK = 'fr:s1.t1';
const PACK_AGAIN = 'fr:s2.t1';
const SHIP = 'fr:s2.t7';
const DISCOUNT = 'fr:s3.t6';

describe('clause kernel', { concurrency: false }, () => {
  test('status reports a witness per reachable clause and clause-unreachable for a guard that never holds', () => {
    withSession(() => {
      const outcome = readSpecStatus({}, jsonSpecStore);
      assert.equal(outcome.exit, 'pass', 'kernel findings are warnings, not blocking');
      const status = outcome.document as SpecStatusDocument;
      assert.deepEqual(status.clauses, [
        { frame: PACK, sentence: 's1', event: 'PACK', status: 'reachable', witness: ['PACK'] },
        { frame: SHIP, sentence: 's2', event: 'SHIP', status: 'reachable', witness: ['PACK', 'SHIP'] },
        { frame: DISCOUNT, sentence: 's3', event: 'DISCOUNT', status: 'unreachable', blockedBy: ['cond_s3_t1 = true'] },
      ]);
      const kernel = status.findingsByLayer?.frames.filter((finding) => finding.code.startsWith('clause-')) ?? [];
      assert.deepEqual(kernel, [{
        id: `clause-unreachable:${DISCOUNT}`,
        kind: 'gap',
        code: 'clause-unreachable',
        severity: 'warning',
        message: `${DISCOUNT} (DISCOUNT) is never enabled from the initial state: cond_s3_t1 = true never holds`,
        refs: [DISCOUNT, 's3'],
      }]);
      assert.equal(status.findings.some((finding) => finding.id === `clause-unreachable:${DISCOUNT}`), true);
    });
  });

  test('frames list carries reach per frame; a restating frame shows the reach of the frame it restates', () => {
    withSession(() => {
      const listed = listFrames({}, jsonSpecStore).document as SpecFramesDocument;
      const reach = new Map((listed.frames ?? []).map((frame) => [frame.id, frame.reach]));
      assert.deepEqual(reach.get(PACK), { status: 'reachable', witness: ['PACK'] });
      assert.deepEqual(reach.get(PACK_AGAIN), { status: 'reachable', witness: ['PACK'] });
      assert.deepEqual(reach.get(SHIP), { status: 'reachable', witness: ['PACK', 'SHIP'] });
      assert.deepEqual(reach.get(DISCOUNT), { status: 'unreachable', blockedBy: ['cond_s3_t1 = true'] });
      assert.equal(reach.get('fr:s3.t1'), undefined, 'a not-transition frame compiles to no action');
      assert.equal(listed.findings.some((finding) => finding.code.startsWith('clause-')), false);
    });
  });

  test('a truncated search reports unexplored, never unreachable', () => {
    withSession(() => {
      const snapshot = loaded();
      const reach = clauseReach(compileSnapshot(snapshot), 1);
      assert.deepEqual(reach, [
        { frame: PACK, event: 'PACK', status: 'reachable', witness: ['PACK'] },
        { frame: SHIP, event: 'SHIP', status: 'unexplored' },
        { frame: DISCOUNT, event: 'DISCOUNT', status: 'unexplored' },
      ]);
      const findings = clauseFindings(reach, snapshot.frames ?? []);
      assert.deepEqual(findings.map((finding) => [finding.id, finding.kind, finding.severity, finding.refs]), [
        [`clause-unexplored:${SHIP}`, 'gap', 'info', [SHIP, 's2']],
        [`clause-unexplored:${DISCOUNT}`, 'gap', 'info', [DISCOUNT, 's3']],
      ]);
      assert.equal(findings.some((finding) => finding.code === 'clause-unreachable'), false);
    });
  });

  test('a frames set refinement that removes the when makes the clause reachable', () => {
    withSession(() => {
      const refined = setFrameRole({ frame: DISCOUNT, role: 'when', value: 'unknown', reason: 'the coupon is not a state' }, jsonSpecStore);
      assert.equal(refined.exit, 'pass', refined.document.issues.map((issue) => issue.message).join('; '));
      const status = readSpecStatus({}, jsonSpecStore).document as SpecStatusDocument;
      assert.deepEqual(status.clauses?.find((clause) => clause.frame === DISCOUNT), { frame: DISCOUNT, sentence: 's3', event: 'DISCOUNT', status: 'reachable', witness: ['DISCOUNT'] });
      assert.equal(status.findings.some((finding) => finding.code.startsWith('clause-')), false);
    });
  });

  test('blockedBy lists only conjuncts that never hold; a guard whose parts hold apart says so', () => {
    const reach = clauseReach(exclusiveSpec());
    assert.deepEqual(reach.map((entry) => [entry.frame, entry.status, entry.witness ?? entry.blockedBy]), [
      ['fr:s1.t1', 'reachable', ['OPEN']],
      ['fr:s1.t2', 'reachable', ['CLOSE']],
      ['fr:s1.t3', 'unreachable', []],
      ['fr:s1.t4', 'unreachable', ['door_status = "locked"']],
    ]);
    const messages = clauseFindings(reach, []).map((finding) => [finding.refs, finding.message]);
    assert.deepEqual(messages, [
      [['fr:s1.t3'], 'fr:s1.t3 (JAM) is never enabled from the initial state: its guard never holds'],
      [['fr:s1.t4'], 'fr:s1.t4 (UNLOCK) is never enabled from the initial state: door_status = "locked" never holds'],
    ]);
  });

  test('text summaries print the witness and the blocking guard', () => {
    withSession(() => {
      const status = clew(['spec', 'status']);
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /clause fr:s2\.t7 SHIP reachable via PACK → SHIP/);
      assert.match(status.stdout, /clause fr:s3\.t6 DISCOUNT unreachable: cond_s3_t1 = true/);
      assert.match(status.stdout, /warning clause-unreachable: fr:s3\.t6 \(DISCOUNT\) is never enabled/);
      const frames = clew(['spec', 'frames', 'list']);
      assert.equal(frames.status, 0, frames.stderr);
      assert.match(frames.stdout, /compiles to SHIP: order packed -> shipped by courier\n {4}reachable via PACK → SHIP/);
      assert.match(frames.stdout, /compiles to DISCOUNT: order null -> discounted by clerk\n {4}unreachable: cond_s3_t1 = true/);
    });
  });
});

let current: string | undefined;

function withSession(body: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-kernel-'));
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dir;
  current = dir;
  try {
    const file = join(dir, 'kernel.md');
    writeFileSync(file, `${SPEC}\n`);
    assert.equal(initSpec({ file }, specTextSource, jsonSpecStore).exit, 'pass');
    assert.equal(tagSpec({}, jsonSpecStore, compromiseTagger).exit, 'pass');
    assert.equal(listFrames({}, jsonSpecStore).exit, 'pass');
    body();
  } finally {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
    current = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
}

function loaded(): SpecSnapshot {
  const result = jsonSpecStore.update('kernel', { create: false }, () => undefined);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.snapshot;
}

/** OPEN and CLOSE each need the other object untouched, so their results never hold together. */
function exclusiveSpec(): CompiledSpec {
  const atom = (v: string): Value => ({ t: 'atom', v });
  const none: Value = { t: 'null' };
  const eq = (name: string, value: Value): Predicate => ({ op: 'eq', var: name as VarId, value });
  const and = (...of: Predicate[]): Predicate => ({ op: 'and', of });
  const action = (id: string, event: string, when: Predicate, name: string, to: string): CompiledAction => ({
    kind: 'action',
    id,
    sources: [],
    event,
    when,
    assign: { [name]: atom(to) },
    evidence: { event: [], object: [] },
  });
  const items = [
    action('fr:s1.t1', 'OPEN', and(eq('door_status', none), eq('gate_status', none)), 'door_status', 'open'),
    action('fr:s1.t2', 'CLOSE', and(eq('gate_status', none), eq('door_status', none)), 'gate_status', 'closed'),
    action('fr:s1.t3', 'JAM', and(eq('door_status', atom('open')), eq('gate_status', atom('closed'))), 'door_status', 'jammed'),
    action('fr:s1.t4', 'UNLOCK', eq('door_status', atom('locked')), 'door_status', 'open'),
  ];
  return {
    draft: {
      id: 'door',
      vars: [{ id: 'door_status' as VarId, type: 'atom' }, { id: 'gate_status' as VarId, type: 'atom' }],
      initial: { door_status: none, gate_status: none },
      actions: items.map((item) => ({ event: eventName(item.event), actor: 'someone', when: item.when, assign: item.assign })),
      labels: [],
    },
    items,
  };
}

function clew(args: string[]): { status: number; stdout: string; stderr: string } {
  const env = Object.assign({}, process.env);
  if (current !== undefined) env.CLEW_DATA_DIR = current;
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, env, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
