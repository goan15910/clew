import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clewDataDir } from '../../src/adapters/spec-store/data-dir.js';
import {
  applySpecText,
  initFindings,
  splitSpec,
  suspectsNonEnglish,
  tagFindings,
  type Sentence,
  type SentenceDraft,
  type TaggedSentence,
} from '../../src/domain/spec.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SAMPLE = 'When the customer submits an order, the manager approves the order if the total is under 500 dollars.';

test('the sample sentence is one slice with a stable span', () => {
  const split = splitSpec(`${SAMPLE}\n`);
  assert.equal(split.sentences.length, 1);
  assert.equal(split.emptySpans.length, 0);
  const sentence = split.sentences[0];
  assert.ok(sentence);
  assert.equal(sentence.text, SAMPLE);
  assert.deepEqual(sentence.span, [0, SAMPLE.length]);
  assert.equal(sentence.section, '');
  assert.equal(SAMPLE.length, 101);
  assert.equal(SAMPLE.indexOf('500'), 89);
});

test('a sentence can end before non-Latin text', () => {
  const split = splitSpec('The customer submits an order. 顾客提交订单。');
  assert.deepEqual(split.sentences.map((sentence) => sentence.text), [
    'The customer submits an order.',
    '顾客提交订单。',
  ]);
});

test('abbreviations, decimals, and a following sentence stay apart', () => {
  const text = 'Dr. Smith approves order no. 12 when the total is 500.00 dollars. The clerk ships it.';
  const split = splitSpec(text);
  assert.deepEqual(split.sentences.map((sentence) => sentence.text), [
    'Dr. Smith approves order no. 12 when the total is 500.00 dollars.',
    'The clerk ships it.',
  ]);
});

test('headings are section provenance and fences are skipped', () => {
  const text = [
    '# Orders',
    '## Refunds',
    '',
    'The customer requests a refund.',
    '',
    '```',
    'not a sentence',
    '```',
    '',
    '---',
    '',
    '- The clerk accepts the refund.',
  ].join('\n');
  const split = splitSpec(text);
  assert.deepEqual(split.sentences.map((sentence) => sentence.section), ['Orders / Refunds', 'Orders / Refunds']);
  assert.deepEqual(split.sentences.map((sentence) => sentence.text), [
    'The customer requests a refund.',
    'The clerk accepts the refund.',
  ]);
  assert.equal(text.slice(split.sentences[1]?.span[0], split.sentences[1]?.span[1]), 'The clerk accepts the refund.');
});

test('a punctuation-only block is an empty span, not a sentence', () => {
  const split = splitSpec('The customer submits an order.\n\n...\n');
  assert.equal(split.sentences.length, 1);
  assert.equal(split.emptySpans.length, 1);
});

test('non-Latin text is suspected and plain English is not', () => {
  assert.equal(suspectsNonEnglish('顾客提交订单。'), true);
  assert.equal(suspectsNonEnglish(SAMPLE), false);
  assert.equal(suspectsNonEnglish('Le client soumet une commande.'), false);
});

test('init findings cover an empty spec, duplicates, and non-English text', () => {
  assert.equal(initFindings([], [])[0]?.code, 'no-sentences');
  assert.equal(initFindings([], [])[0]?.severity, 'blocking');
  const sentences = [
    draftSentence('s1', 'The customer submits an order.', 'current'),
    draftSentence('s2', 'the customer submits an order.', 'current'),
    draftSentence('s3', '顾客提交订单。', 'current'),
  ];
  const codes = initFindings(sentences, [[4, 7]]).map((finding) => finding.code);
  assert.deepEqual(codes, ['empty-sentence', 'duplicate-sentence', 'non-english']);
});

test('a condition word without a second clause is a warning', () => {
  const findings = tagFindings('s1', 'Approve when ready.', [{ tags: ['Verb'] }], ['Approve when ready.']);
  assert.deepEqual(findings.map((finding) => finding.code), ['no-actor', 'condition-without-clause']);
  assert.equal(findings.every((finding) => finding.severity === 'warning'), true);
});

test('unchanged text keeps its id and a removed sentence becomes stale', () => {
  const previous = [
    draftSentence('s1', 'The customer submits an order.', 'current', [0, 32]),
    draftSentence('s2', 'The manager approves it.', 'current', [33, 57]),
  ];
  const tagged: TaggedSentence[] = [{
    id: 's1',
    status: 'current',
    clauses: ['The customer submits an order.'],
    tokens: [{
      id: 's1.t1',
      text: 'customer',
      tags: ['Noun', 'Actor'],
      span: [4, 12],
      origin: 'tagger',
      status: 'current',
      sources: ['s1'],
    }],
  }];
  const moved: SentenceDraft = {
    text: 'The customer submits an order.',
    span: [10, 42],
    hash: previous[0]?.hash ?? '',
    section: 'Orders',
  };
  const applied = applySpecText(previous, tagged, [moved]);
  assert.deepEqual(applied.sentences.map((sentence) => [sentence.id, sentence.status, sentence.span[0]]), [
    ['s1', 'current', 10],
    ['s2', 'stale', 33],
  ]);
  assert.equal(applied.tagged[0]?.status, 'current');
  assert.deepEqual(applied.tagged[0]?.tokens[0]?.span, [14, 22]);
  const again = applySpecText(applied.sentences, applied.tagged, [moved]);
  assert.deepEqual(again.sentences.map((sentence) => [sentence.id, sentence.status]), [
    ['s1', 'current'],
    ['s2', 'stale'],
  ]);
  assert.deepEqual(again.tagged[0]?.tokens[0]?.span, [14, 22]);
});

test('data dir follows XDG, LOCALAPPDATA, and CLEW_DATA_DIR', () => {
  assert.equal(clewDataDir({}, 'linux', '/home/a'), join('/home/a', '.local', 'share', 'clew'));
  assert.equal(clewDataDir({ XDG_DATA_HOME: '/xdg' }, 'darwin', '/home/a'), join('/xdg', 'clew'));
  assert.equal(clewDataDir({ LOCALAPPDATA: '/local' }, 'win32', '/home/a'), join('/local', 'clew'));
  assert.equal(clewDataDir({}, 'win32', '/home/a'), join('/home/a', 'AppData', 'Local', 'clew'));
  assert.equal(clewDataDir({ CLEW_DATA_DIR: '/override', XDG_DATA_HOME: '/xdg' }, 'linux', '/home/a'), '/override');
});

function draftSentence(id: string, text: string, status: Sentence['status'], span: [number, number] = [0, text.length]): Sentence {
  return {
    id,
    text,
    span,
    hash: `hash:${text}`,
    section: '',
    origin: 'rule',
    status,
    sources: [],
  };
}
