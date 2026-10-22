import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import { specTextSource } from '../../src/adapters/spec-store/read-spec.js';
import { initSpec } from '../../src/application/init-spec.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import type { SpecInitDocument, SpecTagDocument } from '../../src/application/documents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const specs = join(root, 'tests', 'fixtures', 'specs');
const goldens = join(specs, 'golden');
const SAMPLE = 'When the customer submits an order, the manager approves the order if the total is under 500 dollars.';

const SPEC_FILES = [
  'order-sentence.md',
  'order-approval.md',
  'todo-task.md',
  'refund.md',
  'hotel-booking.md',
  'pull-request.md',
  'expense-report.md',
  'library-loan.md',
  'support-ticket.md',
  'subscription.md',
  'account-signup.md',
  'shipment.md',
];

describe('spec commands', { concurrency: false }, () => {
  test('README title stays Clew', () => {
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8').split('\n')[0], '# 🧶 Clew');
  });

  test('compromise is bundled and imported from one adapter', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      bundleDependencies: string[];
      engines: { node: string };
    };
    assert.equal(pkg.dependencies.compromise, '14.19.0');
    assert.equal(pkg.bundleDependencies.includes('compromise'), true);
    assert.equal(pkg.engines.node, '>=22.12.0');
    const imports: string[] = [];
    for (const file of walk(join(root, 'src'))) {
      const source = readFileSync(file, 'utf8');
      if (/from ['"]compromise['"]|require\(['"]compromise['"]\)/.test(source)) imports.push(file);
    }
    assert.deepEqual(imports, [join(root, 'src', 'adapters', 'pos', 'compromise-tagger.ts')]);
  });

  test('golden tags for a dozen English specs', () => {
    if (process.env.UPDATE_GOLDENS === '1') mkdirSafe(goldens);
    for (const file of SPEC_FILES) {
      withData((dir) => {
        const actual = projectSpec(join(specs, file));
        for (const sentence of actual.sentences) {
          for (const token of sentence.tokens) {
            const relativeStart = token.span[0] - sentence.span[0];
            const relativeEnd = token.span[1] - sentence.span[0];
            assert.equal(sentence.text.slice(relativeStart, relativeEnd), token.text, `${file} ${token.id}`);
          }
        }
        const golden = join(goldens, file.replace(/\.md$/, '.json'));
        if (process.env.UPDATE_GOLDENS === '1') {
          writeFileSync(golden, `${JSON.stringify(actual, null, 2)}\n`);
          return;
        }
        assert.equal(existsSync(golden), true, golden);
        assert.deepEqual(actual, JSON.parse(readFileSync(golden, 'utf8')));
        assert.equal(dir.length > 0, true);
      });
    }
  });

  test('the design sample keeps compromise tags, clauses, and offsets', () => {
    withData(() => {
      const actual = projectSpec(join(specs, 'order-sentence.md'));
      const sentence = actual.sentences[0];
      assert.ok(sentence);
      assert.equal(actual.sentences.length, 1);
      assert.equal(sentence.text, SAMPLE);
      assert.deepEqual(sentence.span, [0, 101]);
      assert.equal(sentence.section, '');
      assert.deepEqual(sentence.clauses, [
        'When the customer submits an order,',
        'the manager approves',
        'the order if the total is under 500 dollars.',
      ]);
      assert.deepEqual(tokenAt(sentence, 'When', 0).tags, ['Connector', 'Conjunction']);
      assert.deepEqual(tokenAt(sentence, 'customer', 9).tags, ['Noun', 'Actor', 'Singular']);
      assert.deepEqual(tokenAt(sentence, 'submits', 18).tags, ['Verb', 'PresentTense']);
      assert.deepEqual(tokenAt(sentence, 'order', 29).tags, ['Noun', 'Singular']);
      assert.deepEqual(tokenAt(sentence, 'manager', 40).tags, ['Noun', 'Actor', 'Singular']);
      assert.deepEqual(tokenAt(sentence, 'approves', 48).tags, ['Verb', 'PresentTense']);
      assert.deepEqual(tokenAt(sentence, 'order', 61).tags, ['Noun', 'Singular']);
      assert.deepEqual(tokenAt(sentence, 'if', 67).tags, ['Connector', 'Conjunction', 'Condition']);
      assert.deepEqual(tokenAt(sentence, 'total', 74).tags, ['Noun', 'Singular']);
      assert.equal(sentence.text.indexOf('500'), 89);
      assert.deepEqual(tokenAt(sentence, '500', 89).tags, ['Value', 'Cardinal', 'NumericValue', 'Money']);
      assert.deepEqual(tokenAt(sentence, '500', 89).span, [89, 92]);
      assert.deepEqual(sentence.findings, []);
      assert.deepEqual(actual.tagger, { name: 'compromise', version: '14.19.0' });
    });
  });

  test('init is idempotent, keeps ids, and reports stale sentences', () => {
    withData((dir) => {
      const file = join(dir, 'flow.md');
      writeFileSync(file, 'The customer submits an order. The manager approves the order.\n');
      const first = initSpec({ file }, specTextSource, jsonSpecStore);
      assert.equal(first.exit, 'pass');
      assert.deepEqual(first.document.sentences?.map((sentence) => sentence.id), ['s1', 's2']);
      const tagged = tagSpec({}, jsonSpecStore, compromiseTagger);
      assert.equal(tagged.exit, 'pass');
      const session = specSessionDir('flow', { CLEW_DATA_DIR: dir }, root);
      const history = () => readFileSync(join(session, 'history.jsonl'), 'utf8').trim().split('\n');
      assert.equal(history().length, 2);
      const second = initSpec({ file }, specTextSource, jsonSpecStore);
      assert.equal(second.exit, 'pass');
      assert.equal(history().length, 2);
      const updated = readFileSync(join(session, 'session.json'), 'utf8');
      writeFileSync(file, 'The customer submits an order. The clerk rejects the order.\n');
      const edited = initSpec({ file }, specTextSource, jsonSpecStore);
      assert.equal(edited.exit, 'pass');
      assert.deepEqual(edited.document.sentences?.map((sentence) => sentence.id), ['s1', 's3']);
      assert.equal(edited.document.findings.some((finding) => finding.code === 'stale-sentence' && finding.refs.includes('s2')), true);
      assert.equal(existsSync(join(session, '.lock')), false);
      writeFileSync(file, 'The customer submits an order. The manager approves the order.\n');
      const restored = initSpec({ file }, specTextSource, jsonSpecStore);
      assert.deepEqual(restored.document.sentences?.map((sentence) => sentence.id), ['s1', 's2']);
      assert.equal(restored.document.findings.some((finding) => finding.id === 'stale:s3'), true);
      const tokens = JSON.parse(readFileSync(join(session, 'tokens.json'), 'utf8')) as { sentences: { id: string; status: string }[] };
      const revived = tokens.sentences.find((sentence) => sentence.id === 's1');
      assert.equal(revived?.status, 'current');
      assert.notEqual(readFileSync(join(session, 'session.json'), 'utf8'), updated);
    });
  });

  test('duplicate and non-English sentences are warnings', () => {
    withData((dir) => {
      const file = join(dir, 'notes.md');
      writeFileSync(file, 'The customer submits an order. The customer submits an order. 顾客提交订单。\n');
      const outcome = initSpec({ file }, specTextSource, jsonSpecStore);
      assert.equal(outcome.exit, 'pass');
      assert.equal(outcome.document.ok, true);
      const codes = outcome.document.findings.map((finding) => finding.code);
      assert.deepEqual(codes, ['duplicate-sentence', 'non-english']);
    });
  });

  test('agent-owned tokens are not overwritten', () => {
    withData((dir) => {
      const file = join(dir, 'owned.md');
      writeFileSync(file, `${SAMPLE}\n`);
      initSpec({ file }, specTextSource, jsonSpecStore);
      tagSpec({}, jsonSpecStore, compromiseTagger);
      const session = specSessionDir('owned', { CLEW_DATA_DIR: dir }, root);
      const tokensPath = join(session, 'tokens.json');
      const stored = JSON.parse(readFileSync(tokensPath, 'utf8')) as {
        schemaVersion: number;
        sentences: { tokens: { origin: string; text: string }[] }[];
      };
      const token = stored.sentences[0]?.tokens[0];
      assert.ok(token);
      token.origin = 'agent';
      token.text = 'Whenever';
      writeFileSync(tokensPath, `${JSON.stringify(stored, null, 2)}\n`);
      const tagged = tagSpec({}, jsonSpecStore, compromiseTagger);
      assert.equal(tagged.document.findings.some((finding) => finding.code === 'agent-tokens'), true);
      const after = JSON.parse(readFileSync(tokensPath, 'utf8')) as typeof stored;
      assert.equal(after.sentences[0]?.tokens[0]?.text, 'Whenever');
      assert.equal(after.sentences[0]?.tokens[0]?.origin, 'agent');
    });
  });

  test('a different tagger version is reported and then stored', () => {
    withData((dir) => {
      const file = join(dir, 'versioned.md');
      writeFileSync(file, `${SAMPLE}\n`);
      initSpec({ file }, specTextSource, jsonSpecStore);
      tagSpec({}, jsonSpecStore, compromiseTagger);
      const session = specSessionDir('versioned', { CLEW_DATA_DIR: dir }, root);
      const sessionPath = join(session, 'session.json');
      const stored = JSON.parse(readFileSync(sessionPath, 'utf8')) as { tagger: { name: string; version: string } };
      stored.tagger.version = '0.0.0';
      writeFileSync(sessionPath, `${JSON.stringify(stored, null, 2)}\n`);
      const tagged = tagSpec({}, jsonSpecStore, compromiseTagger);
      assert.equal(tagged.exit, 'pass');
      assert.equal(tagged.document.findings.some((finding) => finding.code === 'tagger-version' && finding.severity === 'info'), true);
      const after = JSON.parse(readFileSync(sessionPath, 'utf8')) as { tagger: { version: string } };
      assert.equal(after.tagger.version, '14.19.0');
    });
  });

  test('the CLI runs init and tag end to end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-cli-'));
    try {
      const init = clew(['spec', 'init', 'examples/spec/order.md', '--json'], dir);
      assert.equal(init.stderr, '');
      assert.equal(init.status, 0);
      const initDoc = JSON.parse(init.stdout) as SpecInitDocument;
      assert.equal(initDoc.command, 'spec.init');
      assert.equal(initDoc.ok, true);
      assert.equal(Array.isArray(initDoc.findings), true);
      assert.deepEqual(initDoc.issues, []);
      assert.equal(initDoc.sentences?.[0]?.section, 'Order approval');
      assert.equal(initDoc.sentences?.[0]?.text, SAMPLE);
      const tag = clew(['spec', 'tag', '--json'], dir);
      assert.equal(tag.stderr, '');
      assert.equal(tag.status, 0);
      const tagDoc = JSON.parse(tag.stdout) as SpecTagDocument;
      assert.equal(tagDoc.command, 'spec.tag');
      assert.equal(tagDoc.ok, true);
      assert.equal(tagDoc.tagger?.name, 'compromise');
      assert.equal(tagDoc.tagger?.version, '14.19.0');
      assert.equal(tagDoc.sentences?.[0]?.clauses.length, 3);
      const session = specSessionDir(initDoc.session ?? '', { CLEW_DATA_DIR: dir }, root);
      assert.equal(session.startsWith(dir), true);
      assert.equal(existsSync(join(session, 'session.json')), true);
      assert.equal(existsSync(join(session, 'sentences.json')), true);
      assert.equal(existsSync(join(session, 'tokens.json')), true);
      assert.equal(existsSync(join(session, 'history.jsonl')), true);
      assert.equal(existsSync(join(session, '.lock')), false);
      assert.equal(existsSync(join(root, 'session.json')), false);
      const one = clew(['spec', 'tag', '--sentence', 's1', '--json'], dir);
      assert.equal(one.status, 0);
      const oneDoc = JSON.parse(one.stdout) as SpecTagDocument;
      assert.deepEqual(oneDoc.sentences?.map((sentence) => sentence.id), ['s1']);
      const missing = clew(['spec', 'tag', '--sentence', 's9', '--json'], dir);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /unknown sentence "s9"/);
      assert.equal((JSON.parse(missing.stdout) as SpecTagDocument).fault, 'session');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exit codes distinguish blocking findings, warnings, and bad input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-exit-'));
    try {
      const empty = join(dir, 'empty.md');
      writeFileSync(empty, '\n');
      const noSentences = clew(['spec', 'init', empty, '--json'], dir);
      assert.equal(noSentences.status, 1);
      assert.equal(noSentences.stderr, '');
      const failed = JSON.parse(noSentences.stdout) as SpecInitDocument;
      assert.equal(failed.ok, true);
      assert.equal(failed.findings[0]?.code, 'no-sentences');
      assert.equal(failed.findings[0]?.severity, 'blocking');
      const absent = clew(['spec', 'init', join(dir, 'missing.md'), '--json'], dir);
      assert.equal(absent.status, 2);
      assert.match(absent.stderr, /cannot read/);
      assert.equal((JSON.parse(absent.stdout) as SpecInitDocument).ok, false);
      const stdin = clew(['spec', 'init', '-', '--json'], dir);
      assert.equal(stdin.status, 2);
      assert.match(stdin.stderr, /stdin/);
      const badId = clew(['spec', 'init', empty, '--session', '1bad', '--json'], dir);
      assert.equal(badId.status, 2);
      assert.equal((JSON.parse(badId.stdout) as { fault?: string }).fault, 'usage');
      const none = clew(['spec', 'tag', '--json'], mkdtempSync(join(dir, 'empty-data-')));
      assert.equal(none.status, 2);
      assert.match(none.stderr, /no spec session/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('more than one session requires --session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-many-'));
    try {
      writeFileSync(join(dir, 'a.md'), 'The customer submits an order.\n');
      writeFileSync(join(dir, 'b.md'), 'The manager approves the order.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'a.md'), '--json'], dir).status, 0);
      assert.equal(clew(['spec', 'init', join(dir, 'b.md'), '--json'], dir).status, 0);
      const tag = clew(['spec', 'tag', '--json'], dir);
      assert.equal(tag.status, 2);
      assert.match(tag.stderr, /pass --session/);
      const chosen = clew(['spec', 'tag', '--session', 'a', '--json'], dir);
      assert.equal(chosen.status, 0);
      assert.equal((JSON.parse(chosen.stdout) as SpecTagDocument).session, 'a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a live lock is exit 2 and a dead lock is taken over', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-lock-'));
    try {
      const file = join(dir, 'locked.md');
      writeFileSync(file, `${SAMPLE}\n`);
      assert.equal(clew(['spec', 'init', file, '--json'], dir).status, 0);
      const session = specSessionDir('locked', { CLEW_DATA_DIR: dir }, root);
      writeFileSync(join(session, '.lock'), JSON.stringify({ pid: process.pid }));
      const held = clew(['spec', 'tag', '--json'], dir);
      assert.equal(held.status, 2);
      assert.equal(held.stderr.includes('locked'), true);
      assert.equal((JSON.parse(held.stdout) as SpecTagDocument).fault, 'locked');
      writeFileSync(join(session, '.lock'), JSON.stringify({ pid: 2147483646 }));
      const stolen = clew(['spec', 'tag', '--json'], dir);
      assert.equal(stolen.stderr, '', stolen.stderr);
      assert.equal(stolen.status, 0);
      assert.equal(existsSync(join(session, '.lock')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a schema mismatch is exit 2 and does not rewrite the store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-schema-'));
    try {
      const file = join(dir, 'old.md');
      writeFileSync(file, `${SAMPLE}\n`);
      assert.equal(clew(['spec', 'init', file, '--json'], dir).status, 0);
      const session = specSessionDir('old', { CLEW_DATA_DIR: dir }, root);
      const sessionPath = join(session, 'session.json');
      const stored = JSON.parse(readFileSync(sessionPath, 'utf8')) as { schemaVersion: number };
      stored.schemaVersion = 2;
      writeFileSync(sessionPath, `${JSON.stringify(stored, null, 2)}\n`);
      const tag = clew(['spec', 'tag', '--json'], dir);
      assert.equal(tag.status, 2);
      assert.match(tag.stderr, /schema 2/);
      assert.match(tag.stderr, /schema 1/);
      const after = JSON.parse(readFileSync(sessionPath, 'utf8')) as { schemaVersion: number };
      assert.equal(after.schemaVersion, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('help lists spec init', () => {
    const help = clew(['--help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec init/);
    assert.match(help.stdout, /spec tag/);
  });
});

interface GoldenToken {
  id: string;
  text: string;
  tags: string[];
  span: [number, number];
  origin: string;
}

interface GoldenSentence {
  id: string;
  section: string;
  text: string;
  span: [number, number];
  hash: string;
  clauses: string[];
  tokens: GoldenToken[];
  findings: { id: string; kind: string; code: string; severity: string; message: string; refs: string[] }[];
}

interface GoldenFile {
  tagger: { name: string; version: string };
  sentences: GoldenSentence[];
  otherFindings: GoldenSentence['findings'];
}

function projectSpec(file: string): GoldenFile {
  const init = initSpec({ file }, specTextSource, jsonSpecStore);
  assert.equal(init.document.fault, undefined, init.document.issues.map((issue) => issue.message).join('\n'));
  const tag = tagSpec({}, jsonSpecStore, compromiseTagger);
  assert.equal(tag.document.ok, true);
  const hashes = new Map<string, { span: [number, number]; hash: string }>();
  for (const sentence of init.document.sentences ?? []) hashes.set(sentence.id, { span: [sentence.span[0], sentence.span[1]], hash: sentence.hash });
  const sentences: GoldenSentence[] = [];
  const used = new Set<string>();
  for (const sentence of tag.document.sentences ?? []) {
    const meta = hashes.get(sentence.id);
    assert.ok(meta);
    const findings = [];
    for (const finding of tag.document.findings) {
      if (!finding.refs.includes(sentence.id)) continue;
      used.add(finding.id);
      findings.push({
        id: finding.id,
        kind: finding.kind,
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        refs: finding.refs.slice(),
      });
    }
    const tokens: GoldenToken[] = [];
    for (const token of sentence.tokens) {
      tokens.push({
        id: token.id,
        text: token.text,
        tags: token.tags.slice(),
        span: [token.span[0], token.span[1]],
        origin: token.origin,
      });
    }
    sentences.push({
      id: sentence.id,
      section: sentence.section,
      text: sentence.text,
      span: [meta.span[0], meta.span[1]],
      hash: meta.hash,
      clauses: sentence.clauses.slice(),
      tokens,
      findings,
    });
  }
  const otherFindings = [];
  for (const finding of tag.document.findings) {
    if (used.has(finding.id)) continue;
    otherFindings.push({
      id: finding.id,
      kind: finding.kind,
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      refs: finding.refs.slice(),
    });
  }
  return {
    tagger: { name: tag.document.tagger?.name ?? '', version: tag.document.tagger?.version ?? '' },
    sentences,
    otherFindings,
  };
}

function tokenAt(sentence: GoldenSentence, text: string, relativeStart: number): GoldenToken {
  const start = sentence.span[0] + relativeStart;
  const found = sentence.tokens.find((token) => token.text === text && token.span[0] === start);
  assert.ok(found, `${text} at ${relativeStart}`);
  return found;
}

function withData(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-spec-'));
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

function clew(args: string[], dataDir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function mkdirSafe(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
