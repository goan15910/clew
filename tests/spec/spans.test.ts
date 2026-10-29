import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type { SpecSpansDocument, SpecTagDocument } from '../../src/application/documents.js';
import {
  interactiveMerge,
  mergeLexicon,
  promoteTokensToSpans,
  spanIdFor,
  validatePartition,
  type LexiconEntry,
} from '../../src/domain/spec-spans.js';
import type { LiveSpan, Token } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'span-merge-sample.md');
const lexiconPath = join(root, 'tests', 'fixtures', 'specs', 'span-lexicon.json');

describe('span live partition', { concurrency: false }, () => {
  test('domain promote is 1:1 with token-cover ids', () => {
    const tokens = [
      token('s1.t1', 'Create', ['Verb']),
      token('s1.t2', 'Ticket', ['Noun']),
    ];
    const spans = promoteTokensToSpans(tokens);
    assert.deepEqual(spans.map((span) => span.id), ['sp:s1.t1..s1.t1', 'sp:s1.t2..s1.t2']);
    assert.equal(spans[0]?.origin, 'promote');
    assert.equal(spans[0]?.explicitlySet, false);
    assert.equal(validatePartition(spans, [{ id: 's1', status: 'current', clauses: [], tokens }]), undefined);
  });

  test('lexicon merge joins consecutive spans with entry joiner and tags', () => {
    const tokens = [
      token('s1.t1', 'create', ['Noun']),
      token('s1.t2', 'ticket', ['Noun']),
      token('s1.t3', 'now', ['Adverb']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'create ticket', tags: ['Noun'] }];
    const result = mergeLexicon(spans, tagged, lexicon);
    assert.equal(result.merged.length, 1);
    assert.equal(result.spans.length, 2);
    const merged = result.spans[0];
    assert.ok(merged);
    assert.equal(merged.id, 'sp:s1.t1..s1.t2');
    assert.equal(merged.surface, 'create ticket');
    assert.deepEqual(merged.tags, ['Noun']);
    assert.equal(merged.origin, 'lexicon');
    assert.equal(merged.lexiconEntryId, 'create-ticket');
    assert.equal(merged.explicitlySet, false);
    assert.equal(validatePartition(result.spans, tagged), undefined);
  });

  test('case-sensitive Person path does not fold match keys', () => {
    const tokens = [
      token('s1.t1', 'jeff', ['Noun']),
      token('s1.t2', 'king', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    const lexicon: LexiconEntry[] = [{ id: 'jeff-king', key: 'Jeff King', tags: ['Person'] }];
    const missed = mergeLexicon(spans, tagged, lexicon);
    assert.equal(missed.merged.length, 0);

    const proper = [
      token('s1.t1', 'Jeff', ['Noun', 'Person']),
      token('s1.t2', 'King', ['Noun', 'Person']),
    ];
    const properTagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens: proper }];
    const hit = mergeLexicon(promoteTokensToSpans(proper), properTagged, lexicon);
    assert.equal(hit.merged.length, 1);
    assert.equal(hit.spans[0]?.surface, 'Jeff King');
    assert.deepEqual(hit.spans[0]?.tags, ['Person']);
  });

  test('non-trivial tag conflict is skipped and listed', () => {
    const tokens = [
      token('s1.t1', 'create', ['Verb']),
      token('s1.t2', 'ticket', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    // Force a conflict by giving children exclusive tags and an empty lexicon tag set so
    // parent tags would be derived from children — exclusive Noun vs Verb blocks merge.
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'create ticket', tags: [] }];
    const result = mergeLexicon(spans, tagged, lexicon);
    assert.equal(result.merged.length, 0);
    assert.equal(result.skipped.some((window) => window.kind === 'tag-conflict'), true);
  });

  test('multi-entity window is skipped; interactive merge needs explicit link', () => {
    const tokens = [
      token('s1.t1', 'create', ['Noun']),
      token('s1.t2', 'ticket', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    spans[0]!.entityId = 'object:create';
    spans[1]!.entityId = 'object:ticket';
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'create ticket', tags: ['Noun'] }];
    const auto = mergeLexicon(spans, tagged, lexicon);
    assert.equal(auto.merged.length, 0);
    assert.equal(auto.skipped.some((window) => window.kind === 'multi-entity'), true);

    const rejected = interactiveMerge(spans, tagged, {
      spanIds: [spans[0]!.id, spans[1]!.id],
      tags: ['Noun'],
    });
    assert.equal(rejected.ok, false);

    const linked = interactiveMerge(spans, tagged, {
      spanIds: [spans[0]!.id, spans[1]!.id],
      tags: ['Noun'],
      entityId: 'object:ticket',
    });
    assert.equal(linked.ok, true);
    if (linked.ok) {
      assert.equal(linked.spans[0]?.entityId, 'object:ticket');
      assert.equal(linked.spans[0]?.explicitlySet, true);
      assert.equal(linked.spans[0]?.entityLinkExplicitlySet, true);
      assert.equal(linked.spans[0]?.origin, 'interactive');
    }
  });

  test('explicitlySet spans are skipped unless forceAuto', () => {
    const tokens = [
      token('s1.t1', 'create', ['Noun']),
      token('s1.t2', 'ticket', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    spans[0]!.explicitlySet = true;
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'create ticket', tags: ['Noun'] }];
    const skipped = mergeLexicon(spans, tagged, lexicon);
    assert.equal(skipped.merged.length, 0);
    const forced = mergeLexicon(spans, tagged, lexicon, { forceAuto: true });
    assert.equal(forced.merged.length, 1);
    assert.equal(forced.spans[0]?.explicitlySet, false);
  });

  test('lexicon joiner comes from the entry key (hyphen)', () => {
    const tokens = [
      token('s1.t1', 'audit', ['Noun']),
      token('s1.t2', 'trail', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const lexicon: LexiconEntry[] = [{ id: 'audit-trail', key: 'audit-trail', tags: ['Noun'] }];
    const result = mergeLexicon(promoteTokensToSpans(tokens), tagged, lexicon);
    assert.equal(result.merged.length, 1);
    assert.equal(result.spans[0]?.surface, 'audit-trail');
    assert.equal(result.spans[0]?.lexiconEntryId, 'audit-trail');
  });

  test('ProperNoun follows case-insensitive normal match path', () => {
    const tokens = [
      token('s1.t1', 'create', ['Noun']),
      token('s1.t2', 'ticket', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'Create Ticket', tags: ['ProperNoun', 'Noun'] }];
    const result = mergeLexicon(promoteTokensToSpans(tokens), tagged, lexicon);
    assert.equal(result.merged.length, 1);
    assert.equal(result.spans[0]?.surface, 'create ticket');
    assert.deepEqual(result.spans[0]?.tags, ['ProperNoun', 'Noun']);
  });

  test('missing-mix entity links auto-merge to the sole set id', () => {
    const tokens = [
      token('s1.t1', 'create', ['Noun']),
      token('s1.t2', 'ticket', ['Noun']),
    ];
    const tagged = [{ id: 's1', status: 'current' as const, clauses: [], tokens }];
    const spans = promoteTokensToSpans(tokens);
    spans[1]!.entityId = 'object:ticket';
    spans[1]!.entityLinkExplicitlySet = true;
    const lexicon: LexiconEntry[] = [{ id: 'create-ticket', key: 'create ticket', tags: ['Noun'] }];
    const result = mergeLexicon(spans, tagged, lexicon);
    assert.equal(result.merged.length, 1);
    assert.equal(result.spans[0]?.entityId, 'object:ticket');
    assert.equal(result.spans[0]?.entityLinkExplicitlySet, true);
  });

  test('spec tag dual-emits spans.json and lexicon merge works through the CLI', () => {
    withData((dir) => {
      const init = run(dir, ['spec', 'init', sample, '--json']);
      assert.equal(init.status, 0, init.stderr);
      const tagged = run(dir, ['spec', 'tag', '--json']);
      assert.equal(tagged.status, 0, tagged.stderr);
      const tagDoc = json<SpecTagDocument>(tagged);
      assert.ok((tagDoc.spans?.length ?? 0) > 0);
      const session = specSessionDir('span-merge-sample', { CLEW_DATA_DIR: dir }, root);
      const spansFile = JSON.parse(readFileSync(join(session, 'spans.json'), 'utf8')) as {
        spans: LiveSpan[];
      };
      assert.ok(spansFile.spans.length > 0);
      assert.ok(spansFile.spans.every((span) => span.id === spanIdFor(span.firstTokenId, span.lastTokenId)));
      assert.ok(spansFile.spans.every((span) => span.origin === 'promote'));

      const merged = run(dir, ['spec', 'spans', 'merge', '--lexicon', lexiconPath, '--json']);
      assert.equal(merged.status, 0, merged.stderr);
      const mergeDoc = json<SpecSpansDocument>(merged);
      assert.equal(mergeDoc.command, 'spec.spans.merge');
      assert.ok((mergeDoc.merged?.length ?? 0) >= 1);
      assert.ok(mergeDoc.spans?.some((span) => span.origin === 'lexicon' && span.surface.toLowerCase().includes('support agent')));

      const checked = run(dir, ['spec', 'spans', 'check', '--lexicon', lexiconPath, '--json']);
      assert.equal(checked.status, 0, checked.stderr);
      const checkDoc = json<SpecSpansDocument>(checked);
      assert.equal(checkDoc.command, 'spec.spans.check');
      assert.ok(Array.isArray(checkDoc.skipped));
    });
  });

  test('interactive CLI merge sets explicitlySet and accepts operator tags', () => {
    withData((dir) => {
      writeFileSync(join(dir, 'short.md'), 'Create Ticket today.\n');
      assert.equal(run(dir, ['spec', 'init', join(dir, 'short.md'), '--session', 'short', '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'tag', '--session', 'short', '--json']).status, 0);
      const session = specSessionDir('short', { CLEW_DATA_DIR: dir }, root);
      const before = JSON.parse(readFileSync(join(session, 'spans.json'), 'utf8')) as { spans: LiveSpan[] };
      const create = before.spans.find((span) => span.surface === 'Create');
      const ticket = before.spans.find((span) => span.surface === 'Ticket');
      assert.ok(create);
      assert.ok(ticket);
      const merged = run(dir, [
        'spec', 'spans', 'merge',
        '--session', 'short',
        '--id', create.id,
        '--id', ticket.id,
        '--tags', 'Noun',
        '--json',
      ]);
      assert.equal(merged.status, 0, merged.stderr);
      const doc = json<SpecSpansDocument>(merged);
      assert.equal(doc.merged?.length, 1);
      const after = JSON.parse(readFileSync(join(session, 'spans.json'), 'utf8')) as { spans: LiveSpan[] };
      const cover = after.spans.find((span) => span.id === doc.merged?.[0]);
      assert.ok(cover);
      assert.equal(cover.explicitlySet, true);
      assert.equal(cover.origin, 'interactive');
      assert.deepEqual(cover.tags, ['Noun']);
    });
  });

  test('CLI spans check is read-only and force-auto / link none work', () => {
    withData((dir) => {
      writeFileSync(join(dir, 'short.md'), 'Create Ticket today.\n');
      assert.equal(run(dir, ['spec', 'init', join(dir, 'short.md'), '--session', 'short', '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'tag', '--session', 'short', '--json']).status, 0);
      const session = specSessionDir('short', { CLEW_DATA_DIR: dir }, root);
      const spansPath = join(session, 'spans.json');
      const beforeCheck = readFileSync(spansPath, 'utf8');
      const checked = run(dir, ['spec', 'spans', 'check', '--session', 'short', '--lexicon', lexiconPath, '--json']);
      assert.equal(checked.status, 0, checked.stderr);
      const checkDoc = json<SpecSpansDocument>(checked);
      assert.equal(checkDoc.command, 'spec.spans.check');
      assert.equal(readFileSync(spansPath, 'utf8'), beforeCheck);

      const before = JSON.parse(beforeCheck) as { spans: LiveSpan[] };
      const create = before.spans.find((span) => span.surface === 'Create');
      const ticket = before.spans.find((span) => span.surface === 'Ticket');
      assert.ok(create);
      assert.ok(ticket);

      const linkedNone = run(dir, [
        'spec', 'spans', 'merge',
        '--session', 'short',
        '--id', create.id,
        '--id', ticket.id,
        '--tags', 'Noun',
        '--link', 'none',
        '--json',
      ]);
      assert.equal(linkedNone.status, 0, linkedNone.stderr);
      const linkedDoc = json<SpecSpansDocument>(linkedNone);
      const afterLink = JSON.parse(readFileSync(spansPath, 'utf8')) as { spans: LiveSpan[] };
      const cover = afterLink.spans.find((span) => span.id === linkedDoc.merged?.[0]);
      assert.ok(cover);
      assert.equal(cover.entityId, undefined);
      assert.equal(cover.entityLinkExplicitlySet, true);
      assert.equal(cover.explicitlySet, true);

      const blocked = run(dir, ['spec', 'spans', 'merge', '--session', 'short', '--lexicon', lexiconPath, '--json']);
      assert.equal(blocked.status, 0, blocked.stderr);
      const blockedDoc = json<SpecSpansDocument>(blocked);
      assert.equal((blockedDoc.merged ?? []).includes(cover.id), false);
      assert.equal(
        (JSON.parse(readFileSync(spansPath, 'utf8')) as { spans: LiveSpan[] }).spans.find((span) => span.id === cover.id)?.origin,
        'interactive',
      );

      const forced = run(dir, [
        'spec', 'spans', 'merge',
        '--session', 'short',
        '--lexicon', lexiconPath,
        '--force-auto',
        '--json',
      ]);
      assert.equal(forced.status, 0, forced.stderr);
      const forcedDoc = json<SpecSpansDocument>(forced);
      assert.ok((forcedDoc.merged?.length ?? 0) >= 1);
      const afterForce = JSON.parse(readFileSync(spansPath, 'utf8')) as { spans: LiveSpan[] };
      const lexiconCover = afterForce.spans.find((span) => span.id === cover.id);
      assert.ok(lexiconCover);
      assert.equal(lexiconCover.origin, 'lexicon');
      assert.equal(lexiconCover.explicitlySet, false);
      assert.equal(lexiconCover.lexiconEntryId, 'create-ticket');
    });
  });
});

function token(id: string, text: string, tags: string[]): Token {
  return {
    id,
    text,
    tags,
    span: [0, text.length],
    origin: 'tagger',
    status: 'current',
    sources: ['s1'],
  };
}

function withData(runCase: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-spans-'));
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

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}
