import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type {
  SpecEntitiesDocument,
  SpecFactsDocument,
  SpecInitDocument,
  SpecShowDocument,
  SpecTagDocument,
  SpecUniqueTokenView,
} from '../../src/application/documents.js';
import type { Sentence, TaggedSentence, Token } from '../../src/domain/spec.js';
import { uniqueTokens } from '../../src/domain/spec-query.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');

describe('spec show', { concurrency: false }, () => {
  test('init alone has no tag layer, and show does not write', () => {
    withData((dir) => {
      const init = run(dir, ['spec', 'init', sample, '--json']);
      assert.equal(init.status, 0, init.stderr);
      const id = json<SpecInitDocument>(init).session;
      assert.equal(id, 'order-sentence');
      const session = specSessionDir(id, { CLEW_DATA_DIR: dir }, root);
      assert.equal(existsSync(join(session, 'tokens.json')), true);
      const stored = JSON.parse(readFileSync(join(session, 'session.json'), 'utf8')) as { tagger?: unknown; updated: string };
      assert.equal(stored.tagger, undefined);
      const history = historyCount(dir, id);
      const updated = stored.updated;
      const tagged = run(dir, ['spec', 'show', 'tagged', '--json']);
      const tokens = run(dir, ['spec', 'show', 'tokens', '--json']);
      assert.equal(tagged.status, 2);
      assert.equal(tokens.status, 2);
      assert.match(tagged.stderr, /run clew spec tag first/);
      assert.match(tokens.stderr, /run clew spec tag first/);
      for (const result of [tagged, tokens]) {
        const document = json<SpecShowDocument>(result);
        assert.equal(document.ok, false);
        assert.equal(document.fault, 'session');
        assert.deepEqual(document.findings, []);
        assert.equal(document.issues.length, 1);
      }
      assert.equal(historyCount(dir, id), history);
      assert.equal(sessionUpdated(dir, id), updated);
    });
  });

  test('show tagged matches spec tag, and show tokens groups readings', () => {
    withData((dir) => {
      prepare(dir, sample);
      const tagged = run(dir, ['spec', 'tag', '--json']);
      const shown = run(dir, ['spec', 'show', 'tagged', '--json']);
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(shown.stderr, '');
      const tagDocument = json<SpecTagDocument>(tagged);
      const showDocument = json<SpecShowDocument>(shown);
      assert.equal(showDocument.command, 'spec.show.tagged');
      assert.equal(showDocument.ok, true);
      assert.deepEqual(showDocument.findings, []);
      if (showDocument.command !== 'spec.show.tagged') return;
      assert.deepEqual(showDocument.sentences, tagDocument.sentences);
      const tokenIds = idsInTagged(tagDocument);
      const tokens = run(dir, ['spec', 'show', 'tokens', '--json']);
      assert.equal(tokens.status, 0, tokens.stderr);
      const tokenDocument = json<SpecShowDocument>(tokens);
      assert.equal(tokenDocument.command, 'spec.show.tokens');
      if (tokenDocument.command !== 'spec.show.tokens') return;
      const listed = tokenDocument.tokens ?? [];
      assert.deepEqual(idsInUnique(listed).slice().sort(), tokenIds.slice().sort());
      assert.equal(new Set(idsInUnique(listed)).size, idsInUnique(listed).length);
      const order = listed.find((token) => token.text === 'order');
      assert.ok(order);
      assert.equal(order.count, 2);
      assert.deepEqual(order.forms, ['order']);
      assert.equal(order.readings.length, 1);
      assert.deepEqual(order.readings[0]?.tokens, tokenIds.filter((id) => taggedText(tagDocument, id) === 'order'));
      const history = historyCount(dir, 'order-sentence');
      const updated = sessionUpdated(dir, 'order-sentence');
      const again = run(dir, ['spec', 'show', 'tokens', '--json']);
      assert.equal(again.status, 0, again.stderr);
      assert.equal(historyCount(dir, 'order-sentence'), history);
      assert.equal(sessionUpdated(dir, 'order-sentence'), updated);
      const human = run(dir, ['spec', 'show', 'tokens']);
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /^session order-sentence: \d+ unique tokens? from \d+ tokens/m);
      assert.match(human.stdout, /s1\.t\d+/);
      assert.equal(historyCount(dir, 'order-sentence'), history);
    });
  });

  test('a word with two tag sets is two readings', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'order-verb.md', 'The order can order a review.\n');
      prepare(dir, file);
      const tagged = json<SpecTagDocument>(run(dir, ['spec', 'tag', '--json']));
      const orderIds = idsInTagged(tagged).filter((id) => taggedText(tagged, id)?.toLowerCase() === 'order');
      assert.equal(orderIds.length, 2);
      const shown = json<SpecShowDocument>(run(dir, ['spec', 'show', 'tokens', '--json']));
      assert.equal(shown.command, 'spec.show.tokens');
      if (shown.command !== 'spec.show.tokens') return;
      const order = shown.tokens?.find((token) => token.text === 'order');
      assert.ok(order);
      assert.equal(order.readings.length, 2);
      assert.equal(order.count, 2);
      assert.deepEqual(order.readings.map((reading) => reading.tokens), orderIds.map((id) => [id]));
      assert.notDeepEqual(order.readings[0]?.tags.slice().sort(), order.readings[1]?.tags.slice().sort());
    });
  });

  test('same tags in a different order are one reading, and stale rows are skipped', () => {
    const sentence = liveSentence('s1', 'Order order order.');
    const tagged: TaggedSentence = {
      id: 's1',
      status: 'current',
      clauses: ['Order order order.'],
      tokens: [
        token('s1.t1', 'Order', ['Noun', 'Singular']),
        token('s1.t2', 'order', ['Singular', 'Noun']),
        token('s1.t3', 'order', ['Verb']),
        token('s1.t4', ',', ['Punctuation']),
        token('s1.t5', 'order', ['Noun'], 'stale'),
      ],
    };
    const staleSentence = liveSentence('s2', 'order');
    staleSentence.status = 'stale';
    const staleRow: TaggedSentence = {
      id: 's2',
      status: 'stale',
      clauses: [],
      tokens: [token('s2.t1', 'order', ['Noun'])],
    };
    const currentWithStaleRow = liveSentence('s3', 'order');
    const staleOnCurrent: TaggedSentence = {
      id: 's3',
      status: 'stale',
      clauses: [],
      tokens: [token('s3.t1', 'order', ['Verb'])],
    };
    const grouped = uniqueTokens([sentence, staleSentence, currentWithStaleRow], [tagged, staleRow, staleOnCurrent]);
    const order = grouped.find((item) => item.text === 'order');
    assert.ok(order);
    assert.deepEqual(order.forms, ['Order', 'order']);
    assert.equal(order.count, 3);
    assert.deepEqual(order.readings, [
      { tags: ['Noun', 'Singular'], tokens: ['s1.t1', 's1.t2'] },
      { tags: ['Verb'], tokens: ['s1.t3'] },
    ]);
    const comma = grouped.find((item) => item.text === ',');
    assert.deepEqual(comma?.readings[0]?.tokens, ['s1.t4']);
    const ids = grouped.flatMap((item) => item.readings.flatMap((reading) => reading.tokens));
    assert.equal(ids.includes('s1.t5'), false);
    assert.equal(ids.includes('s2.t1'), false);
    assert.equal(ids.includes('s3.t1'), false);
  });

  test('entities and facts name the first missing layer, then match the written lists', () => {
    withData((dir) => {
      prepare(dir, sample);
      const beforeEntities = run(dir, ['spec', 'show', 'entities', '--json']);
      assert.equal(beforeEntities.status, 2);
      assert.match(beforeEntities.stderr, /spec entities list/);
      const beforeFacts = run(dir, ['spec', 'show', 'facts', '--json']);
      assert.equal(beforeFacts.status, 2);
      assert.match(beforeFacts.stderr, /spec entities list/);
      assert.doesNotMatch(beforeFacts.stderr, /spec facts propose/);
      assert.deepEqual(json<SpecShowDocument>(beforeFacts).findings, []);
      const listed = run(dir, ['spec', 'entities', 'list', '--json']);
      assert.equal(listed.status, 0, listed.stderr);
      const entities = json<SpecEntitiesDocument>(listed);
      const shownEntities = run(dir, ['spec', 'show', 'entities', '--json']);
      assert.equal(shownEntities.status, 0, shownEntities.stderr);
      const entityDocument = json<SpecShowDocument>(shownEntities);
      assert.equal(entityDocument.command, 'spec.show.entities');
      if (entityDocument.command !== 'spec.show.entities') return;
      assert.deepEqual(entityDocument.entities?.map((entity) => entity.id), entities.entities?.map((entity) => entity.id));
      const beforePropose = run(dir, ['spec', 'show', 'facts', '--json']);
      assert.equal(beforePropose.status, 2);
      assert.match(beforePropose.stderr, /spec facts propose/);
      const rejected = run(dir, ['spec', 'entities', 'reject', '--id', 'object:total', '--reason', 'not a thing with states', '--json']);
      assert.equal(rejected.status, 0, rejected.stderr);
      const afterReject = json<SpecShowDocument>(run(dir, ['spec', 'show', 'entities', '--json']));
      assert.equal(afterReject.command, 'spec.show.entities');
      if (afterReject.command !== 'spec.show.entities') return;
      assert.equal(afterReject.entities?.find((entity) => entity.id === 'object:total')?.status, 'rejected');
      const proposed = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(proposed.status, 0, proposed.stderr);
      const facts = json<SpecFactsDocument>(proposed);
      const shownFacts = json<SpecShowDocument>(run(dir, ['spec', 'show', 'facts', '--json']));
      assert.equal(shownFacts.command, 'spec.show.facts');
      if (shownFacts.command !== 'spec.show.facts') return;
      assert.deepEqual(shownFacts.facts?.map((fact) => fact.id), facts.facts?.map((fact) => fact.id));
      assert.deepEqual(shownFacts.findings, []);
      const removedId = facts.facts?.[0]?.id;
      assert.ok(removedId);
      const removed = run(dir, ['spec', 'facts', 'remove', '--id', removedId, '--json']);
      assert.equal(removed.status, 0, removed.stderr);
      const hidden = json<SpecShowDocument>(run(dir, ['spec', 'show', 'facts', '--json']));
      assert.equal(hidden.command, 'spec.show.facts');
      if (hidden.command !== 'spec.show.facts') return;
      assert.equal(hidden.facts?.some((fact) => fact.id === removedId), false);
      assert.deepEqual(hidden.facts?.map((fact) => fact.id), json<SpecFactsDocument>(removed).facts?.map((fact) => fact.id));
      const history = historyCount(dir, 'order-sentence');
      assert.equal(run(dir, ['spec', 'show', 'facts', '--json']).status, 0);
      assert.equal(historyCount(dir, 'order-sentence'), history);
    });
  });

  test('show spans lists each live span with its tags and sentence id', () => {
    withData((dir) => {
      const init = run(dir, ['spec', 'init', sample, '--json']);
      assert.equal(init.status, 0, init.stderr);
      const early = run(dir, ['spec', 'show', 'spans', '--json']);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /run clew spec tag first/);
      const tag = json<SpecTagDocument>(run(dir, ['spec', 'tag', '--json']));
      const shown = run(dir, ['spec', 'show', 'spans', '--json']);
      assert.equal(shown.status, 0, shown.stderr);
      const document = json<SpecShowDocument>(shown);
      assert.equal(document.command, 'spec.show.spans');
      if (document.command !== 'spec.show.spans') return;
      assert.deepEqual(document.spans, tag.spans);
      const first = document.spans?.[0];
      assert.ok(first);
      assert.equal(first.sentence, 's1');
      assert.equal(first.surface, tag.sentences?.[0]?.tokens[0]?.text);
      assert.deepEqual(first.tags, tag.sentences?.[0]?.tokens[0]?.tags);
      const human = run(dir, ['spec', 'show', 'spans']);
      assert.match(human.stdout, /^session order-sentence: \d+ spans/m);
      assert.match(human.stdout, /sp:s1\.t1\.\.s1\.t1 {2}s1 {2}\S+\/\S+/);
    });
  });

  test('show sentences gives each sentence its section and citing workflows', () => {
    withData((dir) => {
      const init = run(dir, ['spec', 'init', sample, '--json']);
      assert.equal(init.status, 0, init.stderr);
      const bare = json<SpecShowDocument>(run(dir, ['spec', 'show', 'sentences', '--json']));
      assert.equal(bare.command, 'spec.show.sentences');
      if (bare.command !== 'spec.show.sentences') return;
      const sentence = bare.sentences?.[0];
      assert.ok(sentence);
      assert.equal(sentence.id, 's1');
      assert.equal(sentence.status, 'current');
      assert.equal(sentence.section, json<SpecInitDocument>(init).sentences?.[0]?.section);
      assert.deepEqual(sentence.workflows, []);
      run(dir, ['spec', 'tag', '--json']);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      run(dir, ['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']);
      run(dir, ['spec', 'graph', 'build', '--json']);
      const built = json<SpecShowDocument>(run(dir, ['spec', 'show', 'sentences', '--json']));
      if (built.command !== 'spec.show.sentences') return;
      assert.deepEqual(built.sentences?.[0]?.workflows, [{ id: 'W1', title: 'Submit order' }]);
      const human = run(dir, ['spec', 'show', 'sentences']);
      assert.match(human.stdout, /^ {2}s1 \[.*\] .* {2}<- W1$/m);
    });
  });

  test('help lists spec show tagged', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec show sentences/);
    assert.match(help.stdout, /spec show spans/);
    assert.match(help.stdout, /spec show tagged/);
    assert.match(help.stdout, /spec show tokens/);
    assert.match(help.stdout, /spec show entities/);
    assert.match(help.stdout, /spec show facts/);
  });
});

function idsInTagged(document: SpecTagDocument): string[] {
  const ids: string[] = [];
  for (const sentence of document.sentences ?? []) {
    for (const token of sentence.tokens) ids.push(token.id);
  }
  return ids;
}

function idsInUnique(tokens: readonly SpecUniqueTokenView[]): string[] {
  const ids: string[] = [];
  for (const token of tokens) {
    for (const reading of token.readings) {
      for (const id of reading.tokens) ids.push(id);
    }
  }
  return ids;
}

function taggedText(document: SpecTagDocument, id: string): string | undefined {
  for (const sentence of document.sentences ?? []) {
    for (const token of sentence.tokens) {
      if (token.id === id) return token.text;
    }
  }
  return undefined;
}

function liveSentence(id: string, text: string): Sentence {
  return {
    id,
    text,
    span: [0, text.length],
    hash: 'sha256:test',
    section: 'Spec',
    origin: 'rule',
    status: 'current',
    sources: [],
  };
}

function token(id: string, text: string, tags: string[], status: Token['status'] = 'current'): Token {
  return { id, text, tags, span: [0, text.length], origin: 'tagger', status, sources: ['s1'] };
}

function prepare(dir: string, file: string): void {
  const init = run(dir, ['spec', 'init', file, '--json']);
  assert.equal(init.status, 0, init.stderr);
  const tag = run(dir, ['spec', 'tag', '--json']);
  assert.equal(tag.status, 0, tag.stderr);
}

function writeSpec(dir: string, name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

function historyCount(dir: string, session: string): number {
  const file = join(specSessionDir(session, { CLEW_DATA_DIR: dir }, root), 'history.jsonl');
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8').trim();
  if (text === '') return 0;
  return text.split('\n').length;
}

function sessionUpdated(dir: string, session: string): string {
  const file = join(specSessionDir(session, { CLEW_DATA_DIR: dir }, root), 'session.json');
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { updated: string };
  return stored.updated;
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function withData(runCase: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-show-'));
  try {
    runCase(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  return clew(args, dir);
}

function clew(args: string[], dataDir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
