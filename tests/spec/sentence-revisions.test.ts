import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { SpecExportDocument, SpecInitDocument, SpecSentencesDocument } from '../../src/application/documents.js';
import { applySentenceEdit, renderSentences } from '../../src/domain/spec-sentences.js';
import type { Sentence } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const AT = '2026-11-06T00:00:00.000Z';
const SPEC = '# Orders\n\nThe customer submits an order. The manager approves the order.\n\nThe clerk ships the order.\n';

function stored(id: string, text: string, start: number, section = 'Orders'): Sentence {
  const version = { text, span: [start, start + text.length] as [number, number], hash: `hash:${text}`, section };
  return { id, original: version, latest: { ...version }, history: [] };
}

describe('sentence revisions in the domain', () => {
  test('edit, add, and delete keep original and append history', () => {
    const note = { at: AT, who: 'agent', reason: 'clearer verb' };
    const start = [stored('s1', 'The customer submits an order.', 10), stored('s2', 'The manager approves the order.', 41)];
    const edited = applied(start, { action: 'edit', id: 's2', text: 'The manager signs the order.', hash: 'hash:signs' }, note);
    const s2 = edited.sentences.find((sentence) => sentence.id === 's2');
    assert.equal(s2?.original?.text, 'The manager approves the order.');
    assert.equal(s2?.latest?.text, 'The manager signs the order.');
    assert.deepEqual(s2?.history.map((entry) => [entry.who, entry.reason]), [['agent', 'clearer verb']]);
    const added = applied(edited.sentences, { action: 'add', text: 'The clerk checks it.', hash: 'hash:checks', after: 's1' }, note);
    assert.deepEqual(added.sentences.map((sentence) => sentence.id), ['s1', 's3', 's2']);
    assert.equal(added.sentences[1]?.original, null);
    assert.equal(added.sentences[1]?.latest?.section, 'Orders');
    const deleted = applied(added.sentences, { action: 'delete', id: 's1' }, note);
    assert.equal(deleted.sentences[0]?.latest, null);
    assert.equal(deleted.sentences[0]?.original?.text, 'The customer submits an order.');
    assert.deepEqual(applySentenceEdit(deleted.sentences, { action: 'delete', id: 's1' }, note), { ok: false, message: 's1 is already deleted' });
    const same = { action: 'edit', id: 's1', text: 'The customer submits an order.', hash: 'hash:The customer submits an order.' } as const;
    assert.deepEqual(applySentenceEdit(start, same, note), { ok: false, message: 's1 already reads that text' });
  });

  test('render puts each sentence in its own paragraph under its section', () => {
    const sentences = [stored('s1', 'The customer submits an order.', 10), stored('s2', 'The clerk ships it.', 41, 'Orders / Shipping')];
    assert.deepEqual(renderSentences(sentences, 'latest'), {
      text: '# Orders\n\nThe customer submits an order.\n\n## Shipping\n\nThe clerk ships it.\n',
      count: 2,
    });
  });
});

describe('spec sentences and export', { concurrency: false }, () => {
  test('edits are recorded, survive re-init, and export round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-sentences-'));
    try {
      const file = join(dir, 'orders.md');
      writeFileSync(file, SPEC);
      assert.equal(clew(['spec', 'init', file, '--json'], dir).status, 0);

      const missing = clew(['spec', 'sentences', 'edit', '--id', 's2', '--text', 'The manager signs the order.', '--json'], dir);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /--reason/);
      const two = clew(['spec', 'sentences', 'edit', '--id', 's2', '--text', 'One. Two.', '--reason', 'x', '--json'], dir);
      assert.equal(two.status, 2);

      const edited = clew(['spec', 'sentences', 'edit', '--id', 's2', '--text', 'The manager signs the order.', '--reason', 'clearer verb', '--finding', 'unknown-action:s2', '--json'], dir);
      assert.equal(edited.status, 0, edited.stderr);
      const editDoc = json<SpecSentencesDocument>(edited);
      assert.equal(editDoc.sentence?.state, 'edited');
      assert.deepEqual(editDoc.sentence?.history.map((entry) => [entry.who, entry.reason, entry.finding]), [['agent', 'clearer verb', 'unknown-action:s2']]);

      const added = clew(['spec', 'sentences', 'add', '--text', 'The clerk packs the order.', '--after', 's2', '--reason', 'missing step', '--by', 'jeff', '--json'], dir);
      assert.equal(added.status, 0, added.stderr);
      assert.equal(json<SpecSentencesDocument>(added).sentence?.id, 's4');
      const deleted = clew(['spec', 'sentences', 'delete', '--id', 's1', '--reason', 'out of scope', '--json'], dir);
      assert.equal(json<SpecSentencesDocument>(deleted).sentence?.state, 'deleted');

      const reinit = clew(['spec', 'init', file, '--json'], dir);
      assert.equal(reinit.status, 0, reinit.stderr);
      assert.deepEqual(json<SpecInitDocument>(reinit).findings, []);

      const latest = json<SpecExportDocument>(clew(['spec', 'export', '--dry-run', '--json'], dir));
      assert.equal(latest.text, '# Orders\n\nThe manager signs the order.\n\nThe clerk packs the order.\n\nThe clerk ships the order.\n');
      const original = json<SpecExportDocument>(clew(['spec', 'export', '--version', 'original', '--dry-run', '--json'], dir));
      assert.equal(original.text, '# Orders\n\nThe customer submits an order.\n\nThe manager approves the order.\n\nThe clerk ships the order.\n');
      const neither = clew(['spec', 'export', '--json'], dir);
      assert.equal(neither.status, 2);

      const out = join(dir, 'latest.md');
      const written = clew(['spec', 'export', '--out', out, '--json'], dir);
      assert.equal(written.status, 0, written.stderr);
      assert.equal(readFileSync(out, 'utf8'), latest.text);

      writeFileSync(file, '# Orders\n\nThe customer submits an order. The manager rejects the order.\n\nThe clerk ships the order.\n');
      const changed = json<SpecInitDocument>(clew(['spec', 'init', file, '--json'], dir));
      assert.deepEqual(changed.findings.map((finding) => [finding.code, finding.refs]), [['original-changed', ['s2']]]);
      assert.equal(changed.sentences?.some((sentence) => sentence.text === 'The manager rejects the order.'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function applied(...args: Parameters<typeof applySentenceEdit>): { sentences: Sentence[]; sentence: Sentence } {
  const result = applySentenceEdit(...args);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function clew(args: string[], dataDir: string) {
  return spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
  });
}

function json<T>(result: ReturnType<typeof clew>): T {
  return JSON.parse(result.stdout) as T;
}
