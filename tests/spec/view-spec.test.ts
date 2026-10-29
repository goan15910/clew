import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import { jsonSpecSessionViewer, serveSessionViewer } from '../../src/adapters/spec-store/session-viewer.js';
import { VIEWER_FILE, VIEWER_HTML } from '../../src/adapters/spec-store/viewer-page.js';
import type { SpecViewDocument } from '../../src/application/documents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');

describe('spec view', { concurrency: false }, () => {
  test('writes stable viewer.html without changing domain JSON or history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-view-'));
    try {
      assert.equal(clew(['spec', 'init', sample, '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'tag', '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'entities', 'list', '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'facts', 'propose', '--json'], dir).status, 0);
      const session = specSessionDir('order-sentence', { CLEW_DATA_DIR: dir }, root);
      const beforeSession = readFileSync(join(session, 'session.json'), 'utf8');
      const beforeFacts = readFileSync(join(session, 'facts.json'), 'utf8');
      const historyBefore = existsSync(join(session, 'history.jsonl'))
        ? readFileSync(join(session, 'history.jsonl'), 'utf8')
        : '';
      const viewed = clew(['spec', 'view', 'order-sentence', '--json'], dir);
      assert.equal(viewed.status, 0, viewed.stderr);
      assert.equal(viewed.stderr, '');
      const doc = json<SpecViewDocument>(viewed);
      assert.equal(doc.command, 'spec.view');
      assert.equal(doc.ok, true);
      assert.equal(doc.session, 'order-sentence');
      assert.equal(doc.mode, 'session-folder');
      assert.equal(doc.htmlPath, join(session, VIEWER_FILE));
      assert.equal(doc.sessionDir, session);
      assert.equal(doc.url, undefined);
      assert.deepEqual(doc.findings, []);
      assert.deepEqual(doc.issues, []);
      assert.equal(existsSync(join(session, VIEWER_FILE)), true);
      const html = readFileSync(join(session, VIEWER_FILE), 'utf8');
      assert.match(html, /data-tab="facts"/);
      assert.match(html, /data-tab="entities"/);
      assert.match(html, /data-tab="sentences"/);
      assert.match(html, /fetch\("\.\/"/);
      assert.equal(readFileSync(join(session, 'session.json'), 'utf8'), beforeSession);
      assert.equal(readFileSync(join(session, 'facts.json'), 'utf8'), beforeFacts);
      assert.equal(
        existsSync(join(session, 'history.jsonl')) ? readFileSync(join(session, 'history.jsonl'), 'utf8') : '',
        historyBefore,
      );
      const human = clew(['spec', 'view', 'order-sentence'], dir);
      assert.equal(human.status, 0);
      assert.match(human.stdout, /viewer\.html/);
      assert.match(human.stdout, /--open/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unknown session and unsafe ids are exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-view-miss-'));
    const previous = process.env.CLEW_DATA_DIR;
    process.env.CLEW_DATA_DIR = dir;
    try {
      writeFileSync(join(dir, 'a.md'), 'The customer submits an order.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'a.md'), '--json'], dir).status, 0);
      const missing = clew(['spec', 'view', 'nope', '--json'], dir);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /no spec session "nope"/);
      const doc = json<SpecViewDocument>(missing);
      assert.equal(doc.ok, false);
      assert.equal(doc.fault, 'session');
      const session = specSessionDir('a', { CLEW_DATA_DIR: dir }, root);
      const secret = join(dir, 'secret.txt');
      writeFileSync(secret, 'secret');
      const attacks = ['..', '../secret', 'a/../../secret', '/tmp', 'a/../../../etc', '.', '1bad'];
      for (const id of attacks) {
        const viewed = clew(['spec', 'view', id, '--json'], dir);
        assert.equal(viewed.status, 2, id);
        assert.equal(existsSync(session), true, id);
        assert.equal(existsSync(secret), true, id);
        assert.equal(existsSync(join(session, VIEWER_FILE)), false, id);
        const direct = jsonSpecSessionViewer.install(id);
        assert.equal(direct.ok, false, id);
      }
      const usage = json<SpecViewDocument>(clew(['spec', 'view', '../secret', '--json'], dir));
      assert.equal(usage.ok, false);
      assert.equal(usage.fault, 'usage');
      const target = join(dir, 'outside-target');
      mkdirSync(target);
      const plantedSession = JSON.parse(readFileSync(join(session, 'session.json'), 'utf8')) as { id: string };
      plantedSession.id = 'Linked';
      const planted = `${JSON.stringify(plantedSession, null, 2)}\n`;
      writeFileSync(join(target, 'session.json'), planted);
      writeFileSync(join(target, 'sentences.json'), readFileSync(join(session, 'sentences.json'), 'utf8'));
      writeFileSync(join(target, 'tokens.json'), readFileSync(join(session, 'tokens.json'), 'utf8'));
      const link = specSessionDir('Linked', { CLEW_DATA_DIR: dir }, root);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
      const linked = clew(['spec', 'view', 'Linked', '--json'], dir);
      assert.equal(linked.status, 2);
      assert.equal(json<SpecViewDocument>(linked).fault, 'unreadable');
      assert.equal(existsSync(join(target, VIEWER_FILE)), false);
      assert.equal(readFileSync(join(target, 'session.json'), 'utf8'), planted);
    } finally {
      if (previous === undefined) delete process.env.CLEW_DATA_DIR;
      else process.env.CLEW_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('localhost server serves viewer and live session JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-view-serve-'));
    try {
      assert.equal(clew(['spec', 'init', sample, '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'tag', '--json'], dir).status, 0);
      const installed = clew(['spec', 'view', 'order-sentence', '--json'], dir);
      assert.equal(installed.status, 0, installed.stderr);
      const session = json<SpecViewDocument>(installed).sessionDir;
      assert.ok(session);
      const server = await serveSessionViewer(session);
      try {
        const page = await fetch(server.url);
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.match(html, /<div class="brand">Clew<span class="version">v\d+\.\d+\.\d+[^<]*<\/span><\/div>/);
        assert.match(html, /filter-kind/);
        const sessionJson = await fetch(new URL('./session.json', server.url));
        assert.equal(sessionJson.status, 200);
        const body = await sessionJson.json() as { id: string };
        assert.equal(body.id, 'order-sentence');
        const leak = join(session, '..', 'leak.txt');
        writeFileSync(leak, 'leak');
        const port = new URL(server.url).port;
        const escape = await fetch(`http://127.0.0.1:${port}/../leak.txt`);
        assert.notEqual(await escape.text(), 'leak');
        assert.ok(escape.status === 400 || escape.status === 404);
        const encoded = await fetch(`http://127.0.0.1:${port}/..%2fleak.txt`);
        assert.equal(encoded.status, 400);
        assert.notEqual(await encoded.text(), 'leak');
      } finally {
        await server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('help lists spec view', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec view/);
    const full = clew(['help', 'spec', 'view'], tmpdir());
    assert.equal(full.status, 0);
    assert.match(full.stdout, /clew spec view order --open/);
    assert.match(full.stdout, /file:\/\//);
  });

  test('viewer.html inline script parses', () => {
    const start = VIEWER_HTML.indexOf('<script>');
    const end = VIEWER_HTML.indexOf('</script>', start);
    assert.ok(start >= 0 && end > start);
    const script = VIEWER_HTML.slice(start + '<script>'.length, end);
    assert.doesNotThrow(() => new Function(script));
  });
});

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
