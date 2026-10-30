import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrateProjectSessions, specRoot } from '../../src/adapters/spec-store/data-dir.js';
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

  test('per-project sessions move into the global store without their origin path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-migrate-'));
    try {
      const data = join(dir, 'data');
      const legacy = join(data, 'old-repo-0123456789ab', 'spec');
      plantLegacy(dir, join(legacy, 'order'), 'The customer submits an order.\n');
      const doc = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir, data));
      assert.deepEqual(doc.sessions.map((session) => session.id), ['order']);
      assert.deepEqual(doc.sessions[0]?.summary, { sentences: 1, facts: 0, flows: 0 });
      assert.equal(existsSync(join(data, 'old-repo-0123456789ab')), false);
      const stored = JSON.parse(readFileSync(join(data, 'spec', 'order', 'session.json'), 'utf8')) as Record<string, unknown>;
      assert.equal('specPath' in stored, false);
      assert.equal(readFileSync(join(data, 'spec', 'order', 'history.jsonl'), 'utf8').includes('"spec"'), false);
      assert.equal(clew(['spec', 'tag', '--json'], dir, data).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migration does nothing when there are no per-project sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-noop-'));
    try {
      writeFileSync(join(dir, 'keep.txt'), 'keep');
      migrateProjectSessions(dir, join(dir, 'spec'));
      assert.deepEqual(readdirSync(dir), ['keep.txt']);
      migrateProjectSessions(join(dir, 'missing'), join(dir, 'missing', 'spec'));
      assert.equal(existsSync(join(dir, 'missing')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('when two projects share a session id, exactly one is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-global-collide-'));
    try {
      const data = join(dir, 'data');
      plantLegacy(dir, join(data, 'one-111111111111', 'spec', 'order'), 'The customer submits an order.\n');
      plantLegacy(dir, join(data, 'two-222222222222', 'spec', 'order'), 'The manager approves the order. The manager ships the order.\n');
      const doc = json<SpecSessionListDocument>(clew(['spec', 'session', 'list', '--json'], dir, data));
      assert.deepEqual(doc.sessions.map((session) => session.id), ['order']);
      assert.ok([1, 2].includes(doc.sessions[0]?.summary.sentences ?? 0));
      assert.deepEqual(readdirSync(data), ['spec']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function plantLegacy(dir: string, target: string, text: string): void {
  const scratch = mkdtempSync(join(dir, 'scratch-'));
  const spec = join(scratch, 'order.md');
  writeFileSync(spec, text);
  assert.equal(clew(['spec', 'init', spec, '--json'], scratch, join(scratch, 'data')).status, 0);
  const made = join(scratch, 'data', 'spec', 'order');
  const session = JSON.parse(readFileSync(join(made, 'session.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(made, 'session.json'), JSON.stringify({ ...session, specPath: spec }));
  writeFileSync(join(made, 'history.jsonl'), `${JSON.stringify({ at: session.created, command: 'spec.init', args: { spec, session: 'order' }, before: [], after: ['s1'] })}\n`);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(made, target, { recursive: true });
  rmSync(scratch, { recursive: true, force: true });
}

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
