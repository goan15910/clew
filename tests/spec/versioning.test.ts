// Spec versioning: milestones over the history, versions (original, mN, latest), and the diff between two of them.
// Every example is synthetic (the order workflow in examples/canon).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Sentence, SentenceText } from '../../src/domain/spec.js';
import { diffActions, diffLexicon, diffSentences, isVersionRef, nextMilestoneId, versionRank, type Milestone } from '../../src/domain/spec-versions.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function text(value: string, section = 'Order'): SentenceText {
  return { text: value, span: [0, value.length], hash: `sha256:${'0'.repeat(64)}`, section };
}

function revision(reason: string, value: string | null): Sentence['history'][number] {
  return { at: '2026-11-17T00:00:00Z', who: 'agent', reason, value: value === null ? null : text(value) };
}

describe('version diffs', () => {
  const original: Sentence[] = [
    { id: 's1', original: text('A'), latest: text('A'), history: [] },
    { id: 's2', original: text('B'), latest: text('B'), history: [] },
    { id: 's3', original: text('C'), latest: text('C'), history: [] },
  ];
  const later: Sentence[] = [
    { id: 's1', original: text('A'), latest: text('A'), history: [] },
    { id: 's2', original: text('B'), latest: text('B2'), history: [revision('reword', 'B2')] },
    { id: 's3', original: text('C'), latest: null, history: [revision('duplicate of s1', null)] },
    { id: 's4', original: null, latest: text('D'), history: [revision('new rule', 'D')] },
  ];

  test('sentences are added, deleted, or edited, each with the reasons recorded between the versions', () => {
    const diff = diffSentences(original, later, true);
    assert.deepEqual(diff.added.map((item) => [item.id, item.text, item.revisions.map((note) => note.reason)]), [['s4', 'D', ['new rule']]]);
    assert.deepEqual(diff.deleted.map((item) => [item.id, item.text, item.revisions.map((note) => note.reason)]), [['s3', 'C', ['duplicate of s1']]]);
    assert.deepEqual(diff.edited.map((item) => [item.id, item.from, item.to, item.revisions.map((note) => note.reason)]), [['s2', 'B', 'B2', ['reword']]]);
  });

  test('a backward diff swaps added and deleted and still lists the reasons', () => {
    const diff = diffSentences(later, original, false);
    assert.deepEqual(diff.added.map((item) => item.id), ['s3']);
    assert.deepEqual(diff.deleted.map((item) => item.id), ['s4']);
    assert.deepEqual(diff.edited.map((item) => [item.from, item.to, item.revisions.length]), [['B2', 'B', 1]]);
  });

  test('only the revisions after the earlier version are listed', () => {
    const middle: Sentence[] = [{ id: 's2', original: text('B'), latest: text('B2'), history: [revision('reword', 'B2')] }];
    const last: Sentence[] = [{ id: 's2', original: text('B'), latest: text('B3'), history: [revision('reword', 'B2'), revision('again', 'B3')] }];
    assert.deepEqual(diffSentences(middle, last, true).edited[0]?.revisions.map((note) => note.reason), ['again']);
  });

  test('a moved sentence is an edit that names both headings', () => {
    const moved: Sentence[] = [{ id: 's1', original: text('A'), latest: text('A', 'Shipping'), history: [revision('move', 'A')] }];
    assert.deepEqual(diffSentences(original.slice(0, 1), moved, true).edited[0]?.sections, { from: 'Order', to: 'Shipping' });
  });

  test('the lexicon diff lists words per field and instance counts; no change is undefined', () => {
    const before = { actors: ['customer'], terms: [], states: [], verbs: [], instances: { order: 2 } };
    const after = { actors: ['customer', 'manager'], terms: ['purchase order'], states: [], verbs: [], instances: { order: 1, item: 2 }, fixed: ['total'] };
    assert.deepEqual(diffLexicon(before, after), {
      actors: { added: ['manager'], removed: [] },
      terms: { added: ['purchase order'], removed: [] },
      fixed: { added: ['total'], removed: [] },
      instances: [{ noun: 'item', to: 2 }, { noun: 'order', from: 2, to: 1 }],
    });
    assert.equal(diffLexicon(before, before), undefined);
    assert.equal(diffLexicon(undefined, undefined), undefined);
  });

  test('actions match by name; a changed guard or effect is a change', () => {
    const diff = diffActions(
      [{ name: 'Ship_s4', guards: ['a'], effects: ['b'] }, { name: 'Pack_s9', guards: [], effects: ['c'] }],
      [{ name: 'Ship_s4', guards: ['a', 'd'], effects: ['b'] }, { name: 'Cancel_s5', guards: [], effects: ['e'] }],
    );
    assert.deepEqual(diff, { added: ['Cancel_s5'], removed: ['Pack_s9'], changed: ['Ship_s4'] });
  });

  test('version names and milestone ids', () => {
    assert.ok(isVersionRef('original') && isVersionRef('latest') && isVersionRef('m12'));
    assert.ok(!isVersionRef('m0') && !isVersionRef('M1') && !isVersionRef('head'));
    assert.ok(versionRank('original') < versionRank('m1') && versionRank('m2') < versionRank('m10') && versionRank('m10') < versionRank('latest'));
    assert.equal(nextMilestoneId([]), 'm1');
    assert.equal(nextMilestoneId([{ id: 'm1' }, { id: 'm3' }] as Milestone[]), 'm4');
  });
});

function clew(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function json(result: { status: number | null; stdout: string; stderr: string }): any {
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout);
}

describe('clew spec milestone and spec diff', { concurrency: false }, () => {
  test('close milestones over the order example, then read them back at three levels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-versions-'));
    try {
      const env = { CLEW_DATA_DIR: join(dir, 'data') };
      const run = (...args: string[]) => clew([...args, '--json'], env);
      assert.equal(run('spec', 'init', 'examples/canon/order.md').status, 0);

      const empty = json(run('spec', 'milestone', 'list'));
      assert.deepEqual(empty.milestones, []);
      assert.deepEqual(empty.pending, { since: 'original', history: 1, canon: 0 });

      assert.equal(run('spec', 'canon', 'lexicon', '--file', 'examples/canon/lexicon.json', '--reason', 'order example').status, 0);
      assert.equal(run('spec', 'canon', 'accept', '--id', 's7', '--reason', 'a list of final states').status, 0);
      assert.equal(run('spec', 'canon', 'accept', '--id', 's9', '--confirm', '--reason', 'packing follows approval').status, 0);

      const first = run('spec', 'milestone', 'close', '--title', 'Gate pass', '--goal', 'every sentence passes the gate', '--decision', 'accept both drafts: they keep the meaning');
      assert.equal(first.status, 0, first.stderr);
      const m1 = json(first).milestone;
      assert.equal(m1.id, 'm1');
      assert.equal(m1.previous, 'original');
      assert.deepEqual(m1.decisions, ['accept both drafts: they keep the meaning']);
      assert.deepEqual(m1.history, { from: 0, to: 3 });
      assert.deepEqual(m1.canon, { from: 0, to: 3 });
      assert.deepEqual(m1.digest.edited, ['s7', 's9']);
      // The original has no lexicon, so it is gated with m1's: 2 dangling then, none now.
      assert.deepEqual([m1.digest.before.dangling, m1.digest.after.dangling], [2, 0]);
      assert.deepEqual(m1.digest.actions.added, ['PackOrder_s9']);
      assert.deepEqual(m1.digest.commands, { 'spec.init': 1, 'spec.sentences.edit': 2, 'spec.canon.lexicon': 1, 'spec.canon.accept': 2 });
      assert.deepEqual(m1.digest.lexicon.fixed, { added: ['total'], removed: [] });

      const again = run('spec', 'milestone', 'close', '--title', 'x', '--goal', 'y');
      assert.equal(again.status, 2);
      assert.match(JSON.parse(again.stdout).issues[0].message, /nothing to close/);

      const guard = 'The warehouse ships the order as shipped when the order is packed and the total is small.';
      assert.equal(run('spec', 'sentences', 'edit', '--id', 's4', '--text', guard, '--reason', 'large orders never ship').status, 0);

      const pending = json(run('spec', 'diff'));
      assert.equal(pending.from, 'm1');
      assert.equal(pending.to, 'latest');
      assert.deepEqual(pending.sentences.edited.map((item: any) => [item.id, item.to, item.revisions.map((note: any) => note.reason)]), [['s4', guard, ['large orders never ship']]]);
      assert.deepEqual(pending.actions, { added: [], removed: [], changed: ['ShipOrder_s4'] });

      const m2 = json(run('spec', 'milestone', 'close', '--title', 'Ship guard', '--goal', 'large orders never ship', '--by', 'Jeff')).milestone;
      assert.equal(m2.previous, 'm1');
      assert.equal(m2.who, 'Jeff');
      assert.deepEqual(m2.history, { from: 3, to: 4 });
      assert.deepEqual(m2.canon, { from: 3, to: 3 });

      const listed = json(run('spec', 'milestone', 'list'));
      assert.deepEqual(listed.milestones.map((item: any) => item.id), ['m1', 'm2']);
      assert.deepEqual(listed.pending, { since: 'm2', history: 0, canon: 0 });

      const shown = json(run('spec', 'milestone', 'show', 'm1', '--changes'));
      assert.deepEqual(shown.changes.map((change: any) => `${change.log}:${change.command}`), [
        'history:spec.init',
        'canon:spec.canon.lexicon',
        'history:spec.sentences.edit',
        'canon:spec.canon.accept',
        'history:spec.sentences.edit',
        'canon:spec.canon.accept',
      ]);

      // A milestone is frozen: the edit after m1 is not in m1's export, and is in latest's.
      const atM1 = json(run('spec', 'export', '--at', 'm1', '--dry-run'));
      assert.doesNotMatch(atM1.text, /total is small\./);
      assert.match(atM1.text, /packs the order as packed/);
      const atOriginal = json(run('spec', 'export', '--at', 'original', '--dry-run'));
      assert.match(atOriginal.text, /must pack it/);
      assert.match(json(run('spec', 'export', '--version', 'latest', '--dry-run')).text, /total is small\./);

      const whole = json(run('spec', 'diff', 'original', 'm2'));
      assert.deepEqual(whole.gatedWith, { from: 'm2' });
      assert.deepEqual(whole.sentences.edited.map((item: any) => item.id), ['s4', 's7', 's9']);

      const checked = json(run('spec', 'canon', 'check', '--at', 'm1'));
      assert.equal(checked.at, 'm1');
      assert.equal(checked.dangling.length, 0);
      const exported = json(run('spec', 'canon', 'export', '--at', 'm1', '--dry-run', '--name', 'Order'));
      const ship = (blocks: string): string => /ShipOrder_s4[^=\n]*==[\s\S]*?\n\n/.exec(blocks)?.[0] ?? '';
      const latestBlocks = json(run('spec', 'canon', 'export', '--dry-run', '--name', 'Order')).tla.blocks;
      assert.match(ship(latestBlocks), /small/);
      assert.doesNotMatch(ship(exported.tla.blocks), /small/);
      assert.notEqual(ship(exported.tla.blocks), '');
      assert.equal(run('spec', 'canon', 'export', '--at', 'original', '--dry-run', '--name', 'Order').status, 2);
      assert.equal(run('spec', 'diff', 'm9').status, 2);
      assert.equal(clew(['spec', 'diff', 'head'], env).status, 2);

      const session = join(dir, 'data', 'spec', 'order');
      assert.deepEqual(readdirSync(join(session, 'milestones')).sort(), ['m1', 'm2']);
      assert.ok(existsSync(join(session, 'milestones', 'm1', 'canon.json')));
      assert.ok(!existsSync(join(session, 'milestones', 'm1', 'history.jsonl')));
      assert.equal(JSON.parse(readFileSync(join(session, 'milestones.json'), 'utf8')).milestones.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
