import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import type { SpecFactsDocument, SpecGraphDocument, SpecSessionListDocument, SpecSessionRemoveDocument } from '../../src/application/documents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');

describe('spec session list and remove', { concurrency: false }, () => {
  test('an empty list is not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-empty-'));
    try {
      const listed = clew(['spec', 'session', 'list', '--json'], dir);
      assert.equal(listed.status, 0);
      assert.equal(listed.stderr, '');
      const doc = json<SpecSessionListDocument>(listed);
      assert.equal(doc.command, 'spec.session.list');
      assert.equal(doc.ok, true);
      assert.deepEqual(doc.sessions, []);
      assert.deepEqual(doc.findings, []);
      assert.deepEqual(doc.issues, []);
      const human = clew(['spec', 'session', 'list'], dir);
      assert.equal(human.status, 0);
      assert.equal(human.stderr, '');
      assert.match(human.stdout, /no spec sessions/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('list shows this repo only, with path, last write, and live counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-list-'));
    try {
      const first = join(dir, 'a.md');
      const second = join(dir, 'b.md');
      writeFileSync(first, 'The customer submits an order. The manager approves the order.\n');
      writeFileSync(second, 'The manager ships the order.\n');
      assert.equal(clew(['spec', 'init', first, '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'init', second, '--json'], dir).status, 0);
      const ambiguous = clew(['spec', 'tag', '--json'], dir);
      assert.equal(ambiguous.status, 2);
      assert.match(ambiguous.stderr, /Open sessions: a, b/);
      const outside = plantOutside(dir);
      const listed = clew(['spec', 'session', 'list', '--json'], dir);
      assert.equal(listed.status, 0);
      assert.equal(listed.stderr, '');
      const doc = json<SpecSessionListDocument>(listed);
      assert.deepEqual(doc.sessions.map((session) => session.id), ['a', 'b']);
      const sessionA = doc.sessions[0];
      const sessionB = doc.sessions[1];
      assert.ok(sessionA);
      assert.ok(sessionB);
      assert.equal(sessionA.specPath, resolve(first));
      assert.equal(sessionB.specPath, resolve(second));
      assert.equal(sessionA.updated, storedUpdated(dir, 'a'));
      assert.equal(sessionB.updated, storedUpdated(dir, 'b'));
      assert.deepEqual(sessionA.summary, { sentences: 2, facts: 0, flows: 0 });
      assert.deepEqual(sessionB.summary, { sentences: 1, facts: 0, flows: 0 });
      assert.equal(doc.sessions.some((session) => session.specPath.includes('other-repo')), false);
      const human = clew(['spec', 'session', 'list'], dir);
      assert.match(human.stdout, /a {2}\S+ {2}2 sentences, 0 facts, 0 flows/);
      assert.match(human.stdout, /b {2}\S+ {2}1 sentence, 0 facts, 0 flows/);
      assert.equal(existsSync(outside.secret), true);
      assert.equal(existsSync(outside.other), true);

      writeFileSync(first, 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', first, '--session', 'a', '--json'], dir).status, 0);
      const stale = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir));
      assert.equal(stale.sessions[0]?.summary.sentences, 1);
      assert.equal(stale.sessions[0]?.updated, storedUpdated(dir, 'a'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('live fact and flow counts follow the store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-counts-'));
    try {
      assert.equal(clew(['spec', 'init', sample, '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'tag', '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'entities', 'list', '--json'], dir).status, 0);
      const proposed = clew(['spec', 'facts', 'propose', '--json'], dir);
      assert.equal(proposed.status, 0, proposed.stderr);
      const facts = json<SpecFactsDocument>(proposed);
      const afterPropose = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir));
      assert.equal(afterPropose.sessions[0]?.id, 'order-sentence');
      assert.equal(afterPropose.sessions[0]?.summary.facts, facts.facts?.length);
      assert.equal(afterPropose.sessions[0]?.summary.flows, 0);
      const factId = facts.facts?.[0]?.id;
      assert.ok(factId);
      const removed = clew(['spec', 'facts', 'remove', '--id', factId, '--json'], dir);
      assert.equal(removed.status, 0, removed.stderr);
      const afterRemove = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir));
      assert.equal(afterRemove.sessions[0]?.summary.facts, (facts.facts?.length ?? 0) - 1);

      assert.equal(clew(['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json'], dir).status, 0);
      const built = clew(['spec', 'graph', 'build', '--json'], dir);
      assert.equal(built.status, 1);
      assert.equal(built.stderr, '');
      const graph = json<SpecGraphDocument>(built);
      const afterBuild = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir));
      assert.equal(afterBuild.sessions[0]?.summary.flows, graph.flows?.length);
      assert.equal(afterBuild.sessions[0]?.summary.sentences, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('remove deletes that session and leaves everything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-remove-'));
    try {
      writeFileSync(join(dir, 'a.md'), 'The customer submits an order.\n');
      writeFileSync(join(dir, 'b.md'), 'The manager approves the order.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'a.md'), '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'init', join(dir, 'b.md'), '--json'], dir).status, 0);
      const outside = plantOutside(dir);
      const removed = clew(['spec', 'session', 'remove', 'a', '--json'], dir);
      assert.equal(removed.status, 0);
      assert.equal(removed.stderr, '');
      const doc = json<SpecSessionRemoveDocument>(removed);
      assert.equal(doc.command, 'spec.session.remove');
      assert.equal(doc.ok, true);
      assert.equal(doc.session, 'a');
      assert.deepEqual(doc.findings, []);
      assert.deepEqual(doc.issues, []);
      assert.equal(existsSync(specSessionDir('a', { CLEW_DATA_DIR: dir }, root)), false);
      assert.equal(existsSync(specSessionDir('b', { CLEW_DATA_DIR: dir }, root)), true);
      assert.equal(existsSync(outside.secret), true);
      assert.equal(existsSync(outside.project), true);
      assert.equal(existsSync(outside.other), true);
      const listed = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir));
      assert.deepEqual(listed.sessions.map((session) => session.id), ['b']);
      const human = clew(['spec', 'session', 'remove', 'b'], dir);
      assert.equal(human.status, 0);
      assert.match(human.stdout, /removed session b/);
      assert.equal(existsSync(specSessionDir('b', { CLEW_DATA_DIR: dir }, root)), false);
      const again = clew(['spec', 'session', 'remove', 'b', '--json'], dir);
      assert.equal(again.status, 2);
      assert.match(again.stderr, /no spec session "b"/);
      const missing = json<SpecSessionRemoveDocument>(again);
      assert.equal(missing.ok, false);
      assert.equal(missing.fault, 'session');
      assert.equal(missing.issues[0]?.kind, 'input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a live lock is kept and a stale lock is removed with the session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-lock-'));
    try {
      writeFileSync(join(dir, 'held.md'), 'The customer submits an order.\n');
      writeFileSync(join(dir, 'stale.md'), 'The manager approves the order.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'held.md'), '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'init', join(dir, 'stale.md'), '--json'], dir).status, 0);
      const held = specSessionDir('held', { CLEW_DATA_DIR: dir }, root);
      const stale = specSessionDir('stale', { CLEW_DATA_DIR: dir }, root);
      const before = readFileSync(join(held, 'session.json'), 'utf8');
      writeFileSync(join(held, '.lock'), JSON.stringify({ pid: process.pid }));
      const denied = clew(['spec', 'session', 'remove', 'held', '--json'], dir);
      assert.equal(denied.status, 2);
      assert.match(denied.stderr, /locked/);
      const locked = json<SpecSessionRemoveDocument>(denied);
      assert.equal(locked.ok, false);
      assert.equal(locked.fault, 'locked');
      assert.equal(readFileSync(join(held, 'session.json'), 'utf8'), before);
      assert.equal(existsSync(join(held, '.lock')), true);
      writeFileSync(join(stale, '.lock'), JSON.stringify({ pid: 2147483646 }));
      const taken = clew(['spec', 'session', 'remove', 'stale', '--json'], dir);
      assert.equal(taken.status, 0, taken.stderr);
      assert.equal(existsSync(stale), false);
      assert.equal(existsSync(held), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('path traversal does not delete outside the session directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-session-traverse-'));
    const previous = process.env.CLEW_DATA_DIR;
    process.env.CLEW_DATA_DIR = dir;
    try {
      writeFileSync(join(dir, 'a.md'), 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'a.md'), '--json'], dir).status, 0);
      const outside = plantOutside(dir);
      const session = specSessionDir('a', { CLEW_DATA_DIR: dir }, root);
      const attacks = ['..', '../secret', 'a/../../secret', '/tmp', 'a/../../../etc', '.', '1bad'];
      for (const id of attacks) {
        const removed = clew(['spec', 'session', 'remove', id, '--json'], dir);
        assert.equal(removed.status, 2, id);
        assert.equal(existsSync(session), true, id);
        assert.equal(existsSync(outside.secret), true, id);
        assert.equal(existsSync(outside.project), true, id);
        assert.equal(existsSync(outside.other), true, id);
        const direct = jsonSpecStore.removeSession(id);
        assert.equal(direct.ok, false, id);
        if (!direct.ok) assert.equal(direct.fault, 'unreadable', id);
        assert.equal(existsSync(session), true, id);
        assert.equal(existsSync(outside.secret), true, id);
        assert.equal(existsSync(outside.other), true, id);
      }
      const bad = json<SpecSessionRemoveDocument>(clew(['spec', 'session', 'remove', '../secret', '--json'], dir));
      assert.equal(bad.ok, false);
      assert.equal(bad.fault, 'usage');
      assert.match(bad.issues[0]?.message ?? '', /session ids start with a letter/);

      const target = join(dir, 'outside-target');
      mkdirSync(target);
      writeFileSync(join(target, 'keep.txt'), 'keep');
      const link = specSessionDir('Linked', { CLEW_DATA_DIR: dir }, root);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
      const linked = clew(['spec', 'session', 'remove', 'Linked', '--json'], dir);
      assert.equal(linked.status, 2);
      assert.equal(json<SpecSessionRemoveDocument>(linked).fault, 'unreadable');
      assert.equal(existsSync(link), true);
      assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'keep');
      const directLink = jsonSpecStore.removeSession('Linked');
      assert.equal(directLink.ok, false);
      assert.equal(existsSync(join(target, 'keep.txt')), true);
    } finally {
      if (previous === undefined) delete process.env.CLEW_DATA_DIR;
      else process.env.CLEW_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('help lists session list and remove', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec session list/);
    assert.match(help.stdout, /spec session remove/);
    const nested = clew(['spec', 'session', '--help'], tmpdir());
    assert.equal(nested.status, 0);
    assert.match(nested.stdout, /^  list /m);
    assert.match(nested.stdout, /^  remove /m);
  });
});

function plantOutside(dir: string): { secret: string; project: string; other: string } {
  const session = specSessionDir('a', { CLEW_DATA_DIR: dir }, root);
  const project = join(dirname(dirname(session)), 'keep.txt');
  const secret = join(dir, 'secret.txt');
  const other = join(dir, 'other-repo-000000000000', 'spec', 'order', 'marker.txt');
  writeFileSync(secret, 'secret');
  writeFileSync(project, 'project');
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, 'other');
  return { secret, project, other };
}

function storedUpdated(dir: string, id: string): string {
  const file = join(specSessionDir(id, { CLEW_DATA_DIR: dir }, root), 'session.json');
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { updated: string };
  return stored.updated;
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function clew(args: string[], dataDir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
