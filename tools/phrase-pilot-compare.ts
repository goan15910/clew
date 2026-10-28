#!/usr/bin/env npx tsx
/**
 * Compare word tokens (production tagger shape) vs phrase/chunk units.
 *
 *   npx tsx tools/phrase-pilot-compare.ts <spec.md> [--lexicon words.json] [--json-out out.json]
 *
 * Metrics only. Callers that pass private corpora must keep outputs out of the public repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { compromiseTagger } from '../src/adapters/pos/compromise-tagger.js';
import { createCompromisePhraseExtractor } from '../src/adapters/pos/compromise-phrases.js';
import type { PhraseLexicon } from '../src/application/ports.js';

interface Args {
  file?: string;
  jsonOut?: string;
  lexicon?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json-out') {
      args.jsonOut = argv[index + 1];
      index += 1;
      continue;
    }
    if (item === '--lexicon') {
      args.lexicon = argv[index + 1];
      index += 1;
      continue;
    }
    if (item !== undefined && !item.startsWith('-') && args.file === undefined) args.file = item;
  }
  return args;
}

function splitBodySentences(raw: string): { text: string; section: string }[] {
  const lines = raw.split(/\n/);
  const sentences: { text: string; section: string }[] = [];
  let section = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      section = trimmed.replace(/^#{1,6}\s+/, '');
      continue;
    }
    sentences.push({ text: trimmed, section });
  }
  return sentences;
}

function uniqueLower(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function loadLexicon(path: string): PhraseLexicon {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('lexicon must be a JSON object of word → tag');
  }
  const lexicon: Record<string, string> = {};
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const tag = (parsed as Record<string, unknown>)[key];
    if (typeof tag === 'string' && tag !== '') lexicon[key] = tag;
  }
  return lexicon;
}

function analyze(filePath: string, lexicon: PhraseLexicon | undefined) {
  const raw = readFileSync(filePath, 'utf8');
  const sentences = splitBodySentences(raw);
  const phrases = createCompromisePhraseExtractor(lexicon);
  let wordTokenCount = 0;
  let nounPhraseCount = 0;
  let verbPhraseCount = 0;
  let adjectiveCount = 0;
  let chunkCount = 0;
  let personCount = 0;
  const multiNouns: string[] = [];
  const multiVerbs: string[] = [];
  const multiChunks: string[] = [];
  const people: string[] = [];
  const patterns: string[] = [];
  const domainKeys = lexicon === undefined ? [] : Object.keys(lexicon);
  const domainIntact: string[] = [];
  const domainSplit: string[] = [];

  for (const sentence of sentences) {
    const tagging = compromiseTagger.tag(sentence.text);
    wordTokenCount += tagging.tokens.length;
    const wordTexts = tagging.tokens.map((token) => token.text);
    const extraction = phrases.extract(sentence.text);
    for (const unit of extraction.units) {
      if (unit.kind === 'noun') {
        nounPhraseCount += 1;
        if (unit.words > 1) multiNouns.push(unit.text);
      } else if (unit.kind === 'verb') {
        verbPhraseCount += 1;
        if (unit.words > 1) multiVerbs.push(unit.text);
      } else if (unit.kind === 'adjective') {
        adjectiveCount += 1;
      } else if (unit.kind === 'chunk') {
        chunkCount += 1;
        if (unit.words > 1) multiChunks.push(unit.text);
      } else if (unit.kind === 'person') {
        personCount += 1;
        people.push(unit.text);
      } else if (unit.kind === 'pattern') {
        patterns.push(unit.text);
      }
    }

    for (const term of domainKeys) {
      const lower = term.toLowerCase();
      if (!sentence.text.toLowerCase().includes(lower) && !sentence.text.includes(term)) continue;
      const asSingle = wordTexts.some((word) => word === term || word.toLowerCase() === lower);
      const nounHas = extraction.units.some(
        (unit) =>
          unit.kind === 'noun' &&
          (unit.text.toLowerCase() === lower || unit.text.toLowerCase().includes(lower)),
      );
      const parts = term.split(/\s+/);
      const split =
        parts.length > 1 &&
        parts.every((part) => wordTexts.some((word) => word.toLowerCase() === part.toLowerCase()));
      if (asSingle || nounHas) domainIntact.push(term);
      else if (split) domainSplit.push(term);
    }
  }

  return {
    file: basename(filePath),
    tagger: { name: compromiseTagger.name, version: compromiseTagger.version },
    phrases: { name: phrases.name, version: phrases.version },
    sentenceCount: sentences.length,
    wordTokenCount,
    nounPhraseCount,
    verbPhraseCount,
    adjectiveCount,
    chunkCount,
    personCount,
    multiWordNounUnique: uniqueLower(multiNouns).length,
    multiWordVerbUnique: uniqueLower(multiVerbs).length,
    multiWordChunkUnique: uniqueLower(multiChunks).length,
    peopleUnique: uniqueLower(people),
    sampleMultiWordNouns: uniqueLower(multiNouns).slice(0, 35),
    sampleMultiWordVerbs: uniqueLower(multiVerbs).slice(0, 20),
    sampleMultiWordChunks: uniqueLower(multiChunks).slice(0, 35),
    samplePatterns: uniqueLower(patterns).slice(0, 20),
    domainIntactMentions: domainIntact.length,
    domainSplitMentions: domainSplit.length,
    sampleDomainIntact: uniqueLower(domainIntact).slice(0, 25),
    sampleDomainSplit: uniqueLower(domainSplit).slice(0, 25),
  };
}

const args = parseArgs(process.argv);
if (args.file === undefined) {
  console.error('usage: npx tsx tools/phrase-pilot-compare.ts <spec.md> [--lexicon words.json] [--json-out out.json]');
  process.exit(2);
}

const lexicon = args.lexicon === undefined ? undefined : loadLexicon(resolve(args.lexicon));
const result = analyze(resolve(args.file), lexicon);
if (args.jsonOut !== undefined) writeFileSync(resolve(args.jsonOut), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
