import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specRoot } from '../../src/adapters/spec-store/data-dir.js';
import type { SpecSessionListDocument } from '../../src/application/documents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const cli = join(root, 'src', 'cli.ts');

describe('global spec store', { concurrency: false }, () => {
  test('one session is visible from two repos and from a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-'));
    try {
      const data = join(dir, 'data');
      const repoA = join(dir, 'repo-a');
      const repoB = join(dir, 'repo-b');
      const plain = join(dir, 'plain');
      for (const repo of [repoA, repoB]) mkdirSync(join(repo, '.git'), { recursive: true });
      mkdirSync(plain);
      writeFileSync(join(repoA, 'order.md'), 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', 'order.md', '--json'], repoA, data).status, 0);
      for (const cwd of [repoA, repoB, plain]) {
        const doc = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], cwd, data));
        assert.deepEqual(doc.sessions.map((session) => session.id), ['order'], cwd);
      }
      assert.equal(clew(['spec', 'tag', '--json'], plain, data).status, 0);
      assert.deepEqual(readdirSync(data), ['spec']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a registered session stores no origin directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-origin-'));
    try {
      const data = join(dir, 'data');
      const repo = join(dir, 'origin-repo');
      mkdirSync(join(repo, '.git'), { recursive: true });
      writeFileSync(join(repo, 'order.md'), 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', join(repo, 'order.md'), '--json'], repo, data).status, 0);
      const session = join(data, 'spec', 'order');
      for (const file of readdirSync(session)) {
        assert.equal(readFileSync(join(session, file), 'utf8').includes('origin-repo'), false, file);
      }
      const human = clew(['spec', 'session', 'list'], repo, data);
      assert.equal(human.stdout.includes('origin-repo'), false);
      const doc = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], repo, data));
      assert.deepEqual(Object.keys(doc.sessions[0] ?? {}).sort(), ['id', 'summary', 'updated']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLEW_DATA_DIR sets the store location', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-env-'));
    try {
      assert.equal(specRoot({ CLEW_DATA_DIR: dir }), join(dir, 'spec'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('schema 2 sessions are rejected without migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-schema-'));
    try {
      const data = join(dir, 'data');
      writeFileSync(join(dir, 'order.md'), 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', 'order.md', '--json'], dir, data).status, 0);
      const sessionPath = join(data, 'spec', 'order', 'session.json');
      const stored = JSON.parse(readFileSync(sessionPath, 'utf8')) as { schemaVersion: number };
      stored.schemaVersion = 2;
      writeFileSync(sessionPath, `${JSON.stringify(stored, null, 2)}\n`);
      const tagged = clew(['spec', 'tag', '--json'], dir, data);
      assert.equal(tagged.status, 2);
      assert.match(tagged.stderr, /schema 2/);
      assert.match(tagged.stderr, /no migration/);
      const after = JSON.parse(readFileSync(sessionPath, 'utf8')) as { schemaVersion: number };
      assert.equal(after.schemaVersion, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function clew(args: string[], cwd: string, dataDir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, [cli, ...args], {
    cwd,
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
