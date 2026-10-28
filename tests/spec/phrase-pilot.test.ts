import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { createCompromisePhraseExtractor } from '../../src/adapters/pos/compromise-phrases.js';
import type { PhraseLexicon } from '../../src/application/ports.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const samplePath = join(root, 'tests/fixtures/specs/phrase-pilot-sample.md');
const lexiconPath = join(root, 'tests/fixtures/specs/phrase-pilot-lexicon.json');

function loadLexicon(): PhraseLexicon {
  const parsed: unknown = JSON.parse(readFileSync(lexiconPath, 'utf8'));
  assert.equal(typeof parsed, 'object');
  assert.ok(parsed !== null && !Array.isArray(parsed));
  const lexicon: Record<string, string> = {};
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const tag = (parsed as Record<string, unknown>)[key];
    if (typeof tag === 'string') lexicon[key] = tag;
  }
  return lexicon;
}

function bodySentences(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || /^#{1,6}\s/.test(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

describe('phrase-pilot (synthetic fixture only)', () => {
  test('word tokens stay single-word while phrases keep multi-word domain terms', () => {
    const raw = readFileSync(samplePath, 'utf8');
    const sentences = bodySentences(raw);
    assert.equal(sentences.length, 7);

    let wordTokens = 0;
    for (const sentence of sentences) {
      wordTokens += compromiseTagger.tag(sentence).tokens.length;
    }
    assert.ok(wordTokens > 40);

    const extractor = createCompromisePhraseExtractor(loadLexicon());
    const multiNouns = new Set<string>();
    const people = new Set<string>();
    for (const sentence of sentences) {
      const extraction = extractor.extract(sentence);
      for (const unit of extraction.units) {
        if (unit.kind === 'noun' && unit.words > 1) multiNouns.add(unit.text.toLowerCase());
        if (unit.kind === 'person') people.add(unit.text.toLowerCase());
      }
    }

    assert.ok([...multiNouns].some((phrase) => phrase.includes('support ticket')));
    assert.ok([...multiNouns].some((phrase) => phrase.includes('audit trail')));
    assert.ok([...people].some((person) => person.includes('support agent')));
  });

  test('production compromise tagger is unchanged for the sample opening sentence', () => {
    const sentence = 'When the support agent opens the case board, the system lists every open ticket.';
    const tagging = compromiseTagger.tag(sentence);
    assert.ok(tagging.tokens.length > 5);
    assert.ok(tagging.tokens.every((token) => !token.text.includes(' ')));
    assert.ok(tagging.clauses.length >= 1);
  });
});
