import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type { SpecEmitDocument, SpecFactsDocument, SpecGraphDocument, SpecStatusDocument, SpecTraceDocument, VerifyDocument } from '../../src/application/documents.js';
import { chartEventName, chartStateId } from '../../src/domain/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');
const SUBMIT = 'The customer submits an order';

describe('spec graph and emit', { concurrency: false }, () => {
  test('build proposes one path per transition and status reports the graph layer', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      const before = run(dir, ['spec', 'status', '--json']);
      assert.equal(before.status, 0, before.stderr);
      assert.equal(before.stderr, '');
      const absent = json<SpecStatusDocument>(before);
      assert.equal(absent.layers?.graph, false);
      assert.equal(absent.findingsByLayer?.graph[0]?.code, 'graph-absent');
      assert.equal(absent.findingsByLayer?.graph[0]?.severity, 'info');
      assert.equal(absent.findings.some((finding) => finding.code === 'graph-absent'), true);
      const historyBefore = historyCount(dir, 'order-sentence');
      run(dir, ['spec', 'status', '--json']);
      assert.equal(historyCount(dir, 'order-sentence'), historyBefore);
      assert.equal(existsSync(sessionFile(dir, 'graph.json')), false);

      run(dir, ['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 1);
      assert.equal(built.stderr, '');
      const graph = json<SpecGraphDocument>(built);
      assert.equal(graph.command, 'spec.graph.build');
      assert.equal(graph.ok, true);
      assert.equal(graph.session, 'order-sentence');
      assert.deepEqual(graph.issues, []);
      assert.deepEqual(graph.graph?.objects, ['order']);
      assert.deepEqual(graph.graph?.states, [
        { id: 'draft', object: 'order', facts: ['f3', 'f6'], initial: true },
        { id: 'submitted', object: 'order', facts: ['f3', 'f4'] },
        { id: 'approved', object: 'order', facts: ['f4'] },
      ]);
      assert.deepEqual(graph.graph?.transitions, [
        { id: 'tr1', from: 'draft', event: 'submit', to: 'submitted', actor: 'customer', object: 'order', fact: 'f3', facts: ['f1', 'f3'] },
        {
          id: 'tr2', from: 'submitted', event: 'approve', to: 'approved', actor: 'manager', guard: 'condition:c1',
          object: 'order', fact: 'f4', facts: ['f2', 'f4', 'f5'],
        },
      ]);
      assert.deepEqual(graph.flows, [
        { id: 'W1', title: 'Submit order', expect: 'accepted', transitions: ['tr1'], origin: 'rule' },
      ]);
      const buildHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.graph.build');
      assert.deepEqual(buildHistory[0]?.before, []);
      assert.deepEqual(buildHistory[0]?.after, ['W1']);
      assert.deepEqual(codes(graph.findings), ['no-final-state', 'guard-without-else']);
      assert.equal(graph.findings[1]?.severity, 'blocking');
      assert.match(graph.findings[1]?.message ?? '', /nothing says what happens to a submitted order otherwise/);
      const afterBuild = historyCount(dir, 'order-sentence');
      const again = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(again.status, 1);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);
      assert.equal(existsSync(sessionFile(dir, 'graph.json')), true);

      const present = json<SpecStatusDocument>(run(dir, ['spec', 'status', '--json']));
      assert.equal(present.layers?.graph, true);
      assert.equal(present.findingsByLayer?.graph.some((finding) => finding.code === 'guard-without-else'), true);
      assert.equal(present.findings.some((finding) => finding.code === 'graph-absent'), false);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const traced = run(dir, ['spec', 'trace', 'tr1', '--json']);
      assert.equal(traced.status, 0, traced.stderr);
      const trace = json<SpecTraceDocument>(traced);
      assert.equal(trace.chain?.[0]?.layer, 'transition');
      assert.equal(trace.chain?.[0]?.id, 'tr1');
      assert.equal(trace.chain?.[0]?.text, 'draft → submitted');
      assert.deepEqual(trace.chain?.[0]?.refs, ['f1', 'f3']);

      const dry = run(dir, ['spec', 'emit', '--dry-run', '--json']);
      assert.equal(dry.status, 1);
      assert.equal(dry.stderr, '');
      const preview = json<SpecEmitDocument>(dry);
      assert.equal(preview.command, 'spec.emit');
      assert.equal(preview.ok, true);
      assert.equal(preview.dryRun, true);
      assert.equal(preview.id, 'orderFlows');
      assert.equal(preview.written, undefined);
      assert.match(preview.yaml ?? '', /id: orderFlows/);
      assert.match(preview.yaml ?? '', new RegExp(SUBMIT));
      assert.match(preview.yaml ?? '', /event: "SUBMIT"/);
      assert.doesNotMatch(preview.yaml ?? '', /approves/);
      assert.equal(preview.workflowSet?.id, 'orderFlows');
      assert.deepEqual(preview.workflowSet?.workflows.map((workflow) => workflow.id), ['W1']);
      assert.equal(preview.workflowSet?.workflows[0]?.edges[0]?.event, 'SUBMIT');
      assert.equal(preview.workflowSet?.workflows[0]?.edges[0]?.stateFrom, 'draft');
      assert.equal(preview.workflowSet?.workflows[0]?.edges[0]?.stateTo, 'submitted');
      assert.equal(codes(preview.findings).includes('guard-without-else'), true);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const out = join(dir, 'flows.yaml');
      const refused = run(dir, ['spec', 'emit', '--out', out, '--json']);
      assert.equal(refused.status, 1);
      assert.equal(refused.stderr, '');
      assert.equal(json<SpecEmitDocument>(refused).written, undefined);
      assert.equal(existsSync(out), false);

      const forced = run(dir, ['spec', 'emit', '--out', out, '--force', '--json']);
      assert.equal(forced.status, 1);
      assert.equal(forced.stderr, '');
      const wrote = json<SpecEmitDocument>(forced);
      assert.equal(wrote.forced, true);
      assert.equal(wrote.written, out);
      assert.equal(existsSync(out), true);
      const checked = run(dir, ['workflows', 'check', out, '--json']);
      assert.equal(checked.status, 0, checked.stderr);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const grouped = run(dir, ['spec', 'graph', 'group', '--id', 'W1', '--id', 'W2', '--title', 'Submit and approve an order', '--json']);
      assert.equal(grouped.status, 2);
      assert.match(grouped.stderr, /unknown flow "W2"/);
      const human = run(dir, ['spec', 'graph', 'build']);
      assert.match(human.stdout, /3 states, 2 transitions, 1 flows/);
    });
  });

  test('a final fact and a forbidden fact clear the gate, and the agent can split the path', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      run(dir, ['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'final', '--object', 'object:order', '--state', 'approved', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'forbidden', '--actor', 'actor:manager', '--action', 'action:approve', '--object', 'object:order', '--source', 's1', '--json']);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 0, built.stderr);
      assert.equal(built.stderr, '');
      const graph = json<SpecGraphDocument>(built);
      assert.equal(graph.findings.length, 0);
      const rejected = graph.flows?.find((flow) => flow.expect === 'rejected');
      assert.ok(rejected);
      assert.equal(rejected.title, 'Cannot approve order');
      assert.equal(rejected.rejectAt, 1);
      assert.deepEqual(rejected.transitions, ['tr2']);
      assert.equal(rejected.origin, 'rule');
      const approved = graph.graph?.states.find((state) => state.id === 'approved');
      assert.equal(approved?.final, true);
      assert.deepEqual(approved?.facts, ['f4', 'f7']);
      const lines = historyCount(dir, 'order-sentence');
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      assert.equal(historyCount(dir, 'order-sentence'), lines);

      const out = join(dir, 'flows.yaml');
      const emitted = run(dir, ['spec', 'emit', '--out', out, '--json']);
      assert.equal(emitted.status, 0, emitted.stderr);
      const emit = json<SpecEmitDocument>(emitted);
      assert.equal(emit.forced, undefined);
      assert.equal(emit.written, out);
      assert.equal(emit.workflowSet?.workflows.some((workflow) => workflow.expect === 'rejected' && workflow.rejectAt === 1), true);
      assert.match(readFileSync(out, 'utf8'), /expect: rejected/);
      assert.equal(run(dir, ['workflows', 'check', out, '--json']).status, 0);

      const patch = join(dir, 'group.json');
      writeFileSync(patch, `${JSON.stringify({ ids: ['W1', 'W2'], title: 'Submit and approve an order' })}\n`);
      const grouped = run(dir, ['spec', 'graph', 'group', '--from', patch, '--json']);
      assert.equal(grouped.status, 0, grouped.stderr);
      assert.equal(json<SpecGraphDocument>(grouped).flows?.[0]?.origin, 'agent');
      const groupHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.graph.group');
      assert.deepEqual(groupHistory.at(-1)?.before, ['W1', 'W2', 'W3']);
      assert.deepEqual(groupHistory.at(-1)?.after, ['W1', 'W3']);
      const kept = historyCount(dir, 'order-sentence');
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      assert.equal(historyCount(dir, 'order-sentence'), kept);
      const splitPatch = join(dir, 'split.json');
      writeFileSync(splitPatch, `${JSON.stringify({ id: 'W1', at: 'tr2' })}\n`);
      const split = run(dir, ['spec', 'graph', 'split', '--from', splitPatch, '--json']);
      assert.equal(split.status, 0, split.stderr);
      const paths = json<SpecGraphDocument>(split);
      assert.deepEqual(paths.changed, ['W1', 'W2']);
      assert.equal(paths.flows?.find((flow) => flow.id === 'W1')?.transitions.join(','), 'tr1');
      assert.equal(paths.flows?.find((flow) => flow.id === 'W2')?.transitions.join(','), 'tr2');
      assert.equal(paths.flows?.find((flow) => flow.id === 'W2')?.origin, 'agent');
      assert.equal(paths.flows?.some((flow) => flow.expect === 'rejected'), true);
      const splitHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.graph.split');
      assert.deepEqual(splitHistory.at(-1)?.before, ['W1', 'W3']);
      assert.deepEqual(splitHistory.at(-1)?.after, ['W1', 'W3', 'W2']);
      const flow = run(dir, ['spec', 'trace', 'W1', '--json']);
      assert.equal(json<SpecTraceDocument>(flow).chain?.[0]?.layer, 'flow');
      assert.equal(json<SpecTraceDocument>(flow).chain?.[0]?.id, 'W1');

      run(dir, ['spec', 'facts', 'edit', '--id', 'f4', '--from-state', 'draft', '--to-state', 'approved', '--json']);
      const stale = run(dir, ['spec', 'emit', '--dry-run', '--json']);
      assert.equal(stale.status, 1);
      assert.equal(stale.stderr, '');
      assert.equal(json<SpecEmitDocument>(stale).findings.some((finding) => finding.code === 'stale-graph' && finding.severity === 'blocking'), true);
      assert.equal(existsSync(join(dir, 'not-written.yaml')), false);
    });
  });

  test('a forbidden fact with no transition emits a rejected edge from the initial state', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'cancel.md', 'The customer cannot cancel a shipped order.\n');
      prepare(dir, file);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'shipped', '--json']);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
      const graph = json<SpecGraphDocument>(built);
      const flow = graph.flows?.find((item) => item.expect === 'rejected');
      assert.ok(flow);
      assert.deepEqual(flow.transitions, []);
      assert.equal(flow.rejectAt, 1);
      const dry = run(dir, ['spec', 'emit', '--dry-run', '--json']);
      assert.equal(dry.status, 0, dry.stdout);
      const yaml = json<SpecEmitDocument>(dry).yaml ?? '';
      assert.match(yaml, /start: shipped/);
      assert.match(yaml, /event: "CANCEL"/);
      assert.match(yaml, /to: "cancelled"/);
      assert.match(yaml, /The customer cannot cancel a shipped order/);
      assert.equal(codes(json<SpecEmitDocument>(dry).findings).includes('guard-without-else'), false);
    });
  });

  test('bad input is exit 2 and a bad edit does not write', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'early.md', 'When the customer submits an order, the manager approves the order if the total is under 500 dollars.\n');
      assert.equal(run(dir, ['spec', 'init', file, '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'tag', '--json']).status, 0);
      const early = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /entities/);
      assert.equal(json<SpecGraphDocument>(early).issues[0]?.kind, 'input');
      const usage = run(dir, ['spec', 'emit', '--json']);
      assert.equal(usage.status, 2);
      assert.equal(json<SpecEmitDocument>(usage).fault, 'usage');
      assert.match(usage.stderr, /--dry-run or --out/);
      const both = run(dir, ['spec', 'emit', '--dry-run', '--out', join(dir, 'flows.yaml'), '--json']);
      assert.equal(both.status, 2);
      assert.match(both.stderr, /not both/);
      const stdin = run(dir, ['spec', 'graph', 'split', '--from', '-', '--json']);
      assert.equal(stdin.status, 2);
      assert.match(stdin.stderr, /stdin/);
    });
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      run(dir, ['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'final', '--object', 'object:order', '--state', 'approved', '--json']);
      run(dir, ['spec', 'facts', 'add', '--type', 'forbidden', '--actor', 'actor:manager', '--action', 'action:approve', '--object', 'object:order', '--source', 's1', '--json']);
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      const lines = historyCount(dir, 'order-sentence');
      const unsplittable = run(dir, ['spec', 'graph', 'split', '--id', 'W1', '--at', '2', '--json']);
      assert.equal(unsplittable.status, 1);
      assert.equal(unsplittable.stderr, '');
      assert.equal(json<SpecGraphDocument>(unsplittable).findings.some((finding) => finding.code === 'unsplittable'), true);
      assert.equal(historyCount(dir, 'order-sentence'), lines);
      const rejected = json<SpecGraphDocument>(run(dir, ['spec', 'graph', 'build', '--json'])).flows?.find((flow) => flow.expect === 'rejected');
      assert.ok(rejected);
      const refused = run(dir, ['spec', 'graph', 'split', '--id', rejected.id, '--at', '1', '--json']);
      assert.equal(refused.status, 1);
      assert.equal(json<SpecGraphDocument>(refused).findings.some((finding) => finding.code === 'rejected-split'), true);
      assert.equal(historyCount(dir, 'order-sentence'), lines);
      const crooked = run(dir, ['spec', 'graph', 'group', '--id', 'W2', '--id', 'W1', '--json']);
      assert.equal(crooked.status, 1);
      assert.equal(json<SpecGraphDocument>(crooked).findings.some((finding) => finding.code === 'not-linear'), true);
      assert.equal(historyCount(dir, 'order-sentence'), lines);
      const unknown = run(dir, ['spec', 'graph', 'split', '--id', 'W9', '--at', '2', '--json']);
      assert.equal(unknown.status, 2);
      assert.match(unknown.stderr, /unknown flow "W9"/);
      assert.equal(json<SpecGraphDocument>(unknown).ok, false);
      const missing = run(dir, ['spec', 'emit', '--out', join(dir, 'missing', 'flows.yaml'), '--force', '--json']);
      assert.equal(missing.status, 2);
      assert.equal(json<SpecEmitDocument>(missing).fault, 'unreadable');
      const one = run(dir, ['spec', 'graph', 'group', '--id', 'W1', '--json']);
      assert.equal(one.status, 2);
      assert.match(one.stderr, /at least two/);
    });
  });

  test('chart name helpers keep a token that is already a chart id', () => {
    assert.equal(chartStateId('mark-shipped'), 'markShipped');
    assert.equal(chartStateId('in-progress'), 'inProgress');
    assert.equal(chartStateId('inProgress'), 'inProgress');
    assert.equal(chartStateId('draft'), 'draft');
    assert.equal(chartEventName('mark-shipped'), 'MARK_SHIPPED');
    assert.equal(chartEventName('submit'), 'SUBMIT');
    assert.equal(chartEventName('markShipped'), 'MARK_SHIPPED');
    assert.equal(chartEventName('MARK_SHIPPED'), 'MARK_SHIPPED');
  });

  test('an emitted workflow set verifies against a chart that uses the same names', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'ship.md', 'The customer submits an order.\n');
      prepare(dir, file);
      assert.equal(run(dir, ['spec', 'entities', 'list', '--json']).status, 0);
      const renamed = run(dir, ['spec', 'entities', 'rename', '--id', 'action:submit', '--name', 'mark-shipped', '--json']);
      assert.equal(renamed.status, 0, `${renamed.stderr}\n${renamed.stdout}`);
      const proposed = json<SpecFactsDocument>(run(dir, ['spec', 'facts', 'propose', '--json']));
      const transition = proposed.facts?.find((fact) => fact.type === 'transition');
      assert.ok(transition);
      const edited = run(dir, ['spec', 'facts', 'edit', '--id', transition.id, '--from-state', 'draft', '--to-state', 'in-progress', '--json']);
      assert.equal(edited.status, 0, `${edited.stderr}\n${edited.stdout}`);
      assert.equal(run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'facts', 'add', '--type', 'final', '--object', 'object:order', '--state', 'in-progress', '--json']).status, 0);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
      assert.equal(json<SpecGraphDocument>(built).graph?.transitions[0]?.event, 'mark-shipped');
      const flows = join(dir, 'flows.yaml');
      const dry = run(dir, ['spec', 'emit', '--out', flows, '--json']);
      assert.equal(dry.status, 0, `${dry.stderr}\n${dry.stdout}`);
      const yaml = readFileSync(flows, 'utf8');
      assert.match(yaml, /id: "in-progress"/);
      assert.match(yaml, /state: "inProgress"/);
      assert.match(yaml, /event: "MARK_SHIPPED"/);
      assert.doesNotMatch(yaml, /event: "mark-shipped"/);
      const chart = join(dir, 'chart.yaml');
      writeFileSync(chart, [
        'id: parcel',
        'initial: draft',
        'guards: []',
        'effects:',
        '  - { name: noteShipped, sets: shipped }',
        'states:',
        '  - id: draft',
        '    label: Draft',
        '    data:',
        '      title: string',
        '  - id: inProgress',
        '    label: In Progress',
        '    final: true',
        '    data:',
        '      title: string',
        '      shipped: boolean',
        'transitions:',
        '  - { from: draft, event: MARK_SHIPPED, to: inProgress, actor: customer, effect: noteShipped }',
        '',
      ].join('\n'));
      const proof = run(dir, ['verify', chart, flows, '--json']);
      assert.equal(proof.status, 0, `${proof.stderr}\n${proof.stdout}`);
      const verified = json<VerifyDocument>(proof);
      assert.equal(verified.ok, true);
      assert.equal(verified.summary?.failed, 0);
      assert.ok((verified.flows?.length ?? 0) > 0);
      assert.equal(verified.flows?.every((flow) => flow.pass), true);
      const step = verified.flows?.[0]?.trace[0];
      assert.equal(step?.workflow.from, 'draft');
      assert.equal(step?.workflow.event, 'MARK_SHIPPED');
      assert.equal(step?.workflow.to, 'inProgress');
      assert.equal(step?.chart.from, 'draft');
      assert.equal(step?.chart.event, 'MARK_SHIPPED');
      assert.equal(step?.chart.to, 'inProgress');
    });
  });

  test('help lists graph and emit', () => {
    const help = clew(['--help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec graph build/);
    assert.match(help.stdout, /spec graph split/);
    assert.match(help.stdout, /spec graph group/);
    assert.match(help.stdout, /spec emit/);
  });
});

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

function sessionFile(dir: string, name: string): string {
  return join(specSessionDir('order-sentence', { CLEW_DATA_DIR: dir }, root), name);
}

function historyCount(dir: string, session: string): number {
  return historyEntries(dir, session).length;
}

function historyEntries(dir: string, session: string): { command: string; before: string[]; after: string[] }[] {
  const file = join(specSessionDir(session, { CLEW_DATA_DIR: dir }, root), 'history.jsonl');
  const text = readFileSync(file, 'utf8').trim();
  if (text === '') return [];
  const entries: { command: string; before: string[]; after: string[] }[] = [];
  for (const line of text.split('\n')) entries.push(JSON.parse(line) as { command: string; before: string[]; after: string[] });
  return entries;
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function withData(runCase: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-graph-'));
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
