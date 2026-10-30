import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { promoteTokensToSpans } from '../../src/domain/spec-spans.js';
import {
  markSkippedTokens,
  matchesStopWordList,
  matchesStopWordPos,
  shouldSkipToken,
  STOP_WORD_KEEP_WORDS,
  STOP_WORD_LIST,
} from '../../src/domain/spec-stop-words.js';
import type { Token } from '../../src/domain/spec.js';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';

const root = join(fileURLToPath(new URL('../..', import.meta.url)));
const tsx = join(root, 'node_modules', '.bin', 'tsx');

describe('stop-word skip policy', () => {
  test('fixed list marks common function words skipped', () => {
    assert.equal(matchesStopWordList('the'), true);
    assert.equal(matchesStopWordList('THE'), true);
    assert.equal(matchesStopWordList('of'), true);
    assert.equal(shouldSkipToken('the', ['Determiner']), true);
    assert.equal(shouldSkipToken('customer', ['Noun', 'Actor']), false);
  });

  test('POS rule marks function tags skipped even when the surface is not on the list', () => {
    // "amidst" is not on the curated list; Preposition POS still skips.
    assert.equal(matchesStopWordList('amidst'), false);
    assert.equal(matchesStopWordPos(['Preposition']), true);
    assert.equal(shouldSkipToken('amidst', ['Preposition']), true);
    assert.equal(shouldSkipToken('weirdpronoun', ['Pronoun']), true);
  });

  test('keep list preserves negation, modals, and condition connectors', () => {
    for (const word of ['not', 'cannot', 'can', 'must', 'if', 'unless', 'when', 'after', 'before', 'once']) {
      assert.equal(STOP_WORD_KEEP_WORDS.has(word), true, word);
      assert.equal(shouldSkipToken(word, ['Conjunction']), false, word);
    }
    assert.equal(shouldSkipToken('never', ['Adverb', 'Negative']), false);
    assert.equal(shouldSkipToken('should', ['Modal', 'Verb']), false);
    assert.equal(STOP_WORD_LIST.has('if'), false);
    assert.equal(STOP_WORD_LIST.has('not'), false);
  });

  test('markSkippedTokens sets skipped without changing positions or deleting tokens', () => {
    const tokens = markSkippedTokens([
      token('s1.t1', 'When', ['Conjunction', 'Condition']),
      token('s1.t2', 'the', ['Determiner']),
      token('s1.t3', 'customer', ['Noun', 'Actor']),
      token('s1.t4', 'cannot', ['Modal', 'Negative']),
      token('s1.t5', 'amidst', ['Preposition']),
    ]);
    assert.equal(tokens.length, 5);
    assert.equal(tokens[0]!.skipped, undefined);
    assert.equal(tokens[1]!.skipped, true);
    assert.equal(tokens[1]!.span[0], 5);
    assert.equal(tokens[2]!.skipped, undefined);
    assert.equal(tokens[3]!.skipped, undefined);
    assert.equal(tokens[4]!.skipped, true);
  });

  test('promote copies skipped onto insignificant spans and keeps partition cover', () => {
    const tokens = markSkippedTokens([
      token('s1.t1', 'the', ['Determiner']),
      token('s1.t2', 'order', ['Noun']),
    ]);
    const spans = promoteTokensToSpans(tokens);
    assert.equal(spans.length, 2);
    assert.equal(spans[0]!.insignificant, true);
    assert.equal(spans[0]!.id, 'sp:s1.t1..s1.t1');
    assert.equal(spans[1]!.insignificant, undefined);
  });

  test('CLI tag writes skipped tokens and insignificant promote spans', () => {
    withData((dir) => {
      writeFileSync(join(dir, 'sample.md'), 'When the customer cannot edit the order after submit.\n');
      assert.equal(run(dir, ['spec', 'init', join(dir, 'sample.md'), '--session', 'skip', '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'tag', '--session', 'skip', '--json']).status, 0);
      const session = specSessionDir('skip', { CLEW_DATA_DIR: dir });
      const tokensDoc = JSON.parse(readFileSync(join(session, 'tokens.json'), 'utf8')) as {
        sentences: Array<{ tokens: Array<{ text: string; skipped?: boolean; span: [number, number] }> }>;
      };
      const spansDoc = JSON.parse(readFileSync(join(session, 'spans.json'), 'utf8')) as {
        spans: Array<{ surface: string; insignificant?: boolean; firstTokenId: string; lastTokenId: string }>;
      };
      const tokens = tokensDoc.sentences[0]!.tokens;
      const the = tokens.find((row) => row.text === 'the');
      const cannot = tokens.find((row) => row.text === 'cannot');
      const when = tokens.find((row) => row.text === 'When');
      const after = tokens.find((row) => row.text === 'after');
      assert.ok(the);
      assert.equal(the.skipped, true);
      assert.ok(typeof the.span[0] === 'number');
      assert.equal(cannot?.skipped, undefined);
      assert.equal(when?.skipped, undefined);
      assert.equal(after?.skipped, undefined);

      const theSpan = spansDoc.spans.find((span) => span.surface === 'the');
      const cannotSpan = spansDoc.spans.find((span) => span.surface === 'cannot');
      assert.equal(theSpan?.insignificant, true);
      assert.equal(cannotSpan?.insignificant, undefined);
      assert.equal(spansDoc.spans.length, tokens.length);
    });
  });
});

function token(id: string, text: string, tags: string[]): Token {
  return {
    id,
    text,
    tags,
    span: [5, 5 + text.length],
    origin: 'tagger',
    status: 'current',
    sources: ['s1'],
  };
}

function withData(runCase: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-stop-'));
  try {
    runCase(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(dir: string, args: string[]) {
  return spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLEW_DATA_DIR: dir },
  });
}
