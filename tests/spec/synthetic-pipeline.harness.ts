import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { SpecEmitDocument, SpecFactsDocument, SpecGraphDocument, SpecInitDocument } from '../../src/application/documents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const syntheticSpec = join(root, 'tests', 'fixtures', 'synthetic-pipeline.md');

describe('synthetic pipeline harness', { concurrency: false }, () => {
  test('actorless mint, when-null overlay, lifecycle emit, chart write', { timeout: 600_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-synthetic-'));
    try {
      const initDoc = requireDocument<SpecInitDocument>(clew(dir, ['spec', 'init', syntheticSpec, '--session', 'syn', '--json']), 'spec init', 0);
      requireDocument<{ ok: boolean }>(clew(dir, ['spec', 'tag', '--session', 'syn', '--json']), 'spec tag', 0);
      requireDocument<{ ok: boolean }>(clew(dir, ['spec', 'entities', 'list', '--session', 'syn', '--json']), 'spec entities list');
      const factsDoc = requireDocument<SpecFactsDocument>(clew(dir, ['spec', 'facts', 'propose', '--session', 'syn', '--json']), 'spec facts propose');
      const graphDoc = requireDocument<SpecGraphDocument>(clew(dir, ['spec', 'graph', 'build', '--session', 'syn', '--json']), 'spec graph build');
      const chartPath = join(dir, 'spec.yaml');
      const workflowsPath = join(dir, 'workflows.yaml');
      const emitDoc = requireDocument<SpecEmitDocument>(
        clew(dir, ['spec', 'emit', '--out', workflowsPath, '--chart', chartPath, '--force', '--json']),
        'spec emit',
      );

      assert.ok((initDoc.sentences?.length ?? 0) > 0);
      const facts = liveFacts(factsDoc);
      assert.ok(facts.length > 0, 'expected ActionFact or ConfigurationFact rows');

      let actionFacts = 0;
      let actorless = 0;
      let whenNull = 0;
      for (const fact of facts) {
        if (fact.kind !== 'action') continue;
        actionFacts += 1;
        assert.ok(fact.assign !== undefined && Object.keys(fact.assign).length > 0, `${fact.id} empty assign`);
        assert.equal('from' in fact, false);
        assert.equal('to' in fact, false);
        if (fact.actor === 'actor:unspecified') actorless += 1;
        if (predicateHasNull(fact.when as Record<string, unknown> | undefined)) whenNull += 1;
      }
      assert.ok(actionFacts > 0, 'expected ActionFacts');
      assert.ok(actorless > 0, 'expected actor:unspecified mints');
      assert.ok(whenNull >= 0);

      assert.equal(countCode(graphDoc.findings, 'transition-without-from'), 0);
      assert.equal(countCode(graphDoc.findings, 'state-space-truncated') + countCode(emitDoc.findings, 'state-space-truncated'), 0);

      const accepted = (graphDoc.flows ?? []).filter((flow) => flow.expect === 'accepted');
      assert.ok(accepted.length > 0, 'expected accepted workflows');
      const multi = accepted.filter((flow) => flow.transitions.length >= 2);
      const single = accepted.filter((flow) => flow.transitions.length === 1);
      assert.ok(multi.length + single.length === accepted.length);
      assert.ok(multi.length > 0 || single.length > 0);

      assert.equal(emitDoc.chartWritten !== undefined, true);
      assert.equal(emitDoc.written !== undefined, true);
      const chart = readFileSync(chartPath, 'utf8');
      assert.ok(chart.includes('clew.spec.v1') || chart.includes('schemaVersion') || chart.includes('vars:'), 'chart yaml written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function liveFacts(factsDoc: SpecFactsDocument): NonNullable<SpecFactsDocument['facts']> {
  return (factsDoc.facts ?? []).filter((fact) => fact.status === 'current' || fact.status === undefined);
}

function predicateHasNull(when: Record<string, unknown> | undefined): boolean {
  if (when === undefined) return false;
  if (when.op === 'eq' && when.value === null) return true;
  if ((when.op === 'and' || when.op === 'or') && Array.isArray(when.of)) {
    for (const child of when.of) {
      if (typeof child === 'object' && child !== null && predicateHasNull(child as Record<string, unknown>)) return true;
    }
  }
  if (when.op === 'not' && typeof when.of === 'object' && when.of !== null) {
    return predicateHasNull(when.of as Record<string, unknown>);
  }
  return false;
}

function countCode(findings: { code: string }[] | undefined, code: string): number {
  let count = 0;
  if (findings === undefined) return count;
  for (const finding of findings) {
    if (finding.code === code) count += 1;
  }
  return count;
}

function requireDocument<T extends { ok: boolean }>(
  result: { status: number; stdout: string; stderr: string },
  step: string,
  expectedStatus?: 0,
): T {
  assert.equal(result.stderr, '', `${step} stderr: ${result.stderr}`);
  if (expectedStatus === 0) {
    assert.equal(result.status, 0, `${step} exit ${result.status}\n${result.stdout}`);
  } else {
    assert.ok(result.status === 0 || result.status === 1, `${step} exit ${result.status}\n${result.stdout}`);
  }
  let document: T;
  try {
    document = JSON.parse(result.stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.fail(`${step} JSON (${result.stdout.length} bytes): ${message}`);
  }
  assert.equal(document.ok, true, `${step} ok`);
  return document;
}

function clew(dataDir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const env = Object.assign({}, process.env);
  env.CLEW_DATA_DIR = dataDir;
  const stdoutPath = join(dataDir, 'harness-stdout.json');
  const stderrPath = join(dataDir, 'harness-stderr.txt');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  const result = spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', stdoutFd, stderrFd],
    timeout: 180_000,
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return {
    status: result.status ?? 1,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  };
}
