import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type { SpecEmitDocument, SpecGraphDocument, SpecStatusDocument, SpecTraceDocument, VerifyDocument } from '../../src/application/documents.js';
import { chartEventName, chartStateId } from '../../src/domain/model.js';
import type { CompiledAction, CompiledItem, CompiledSpec } from '../../src/domain/spec-actions.js';
import { buildGraph } from '../../src/domain/spec-graph.js';
import type { Action } from '../../src/domain/spec-model.js';
import { eventName, varId, valueOf, type Predicate, type Value } from '../../src/domain/valuation.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');
const SUBMIT = 'The customer submits an order';
const LIFECYCLE = 'The customer submits an order. When the customer submits an order, the manager approves the order.\n';

describe('spec graph and emit', { concurrency: false }, () => {
  test('build proposes one lifecycle path per object chain and status reports the graph layer', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'frames', 'list', '--json']);
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
      assert.equal(existsSync(sessionFile(dir, 'flows.json')), false);

      const leftover = sessionFile(dir, 'graph.json');
      writeFileSync(leftover, '{"schemaVersion":5,"objects":[],"states":[],"transitions":[],"flows":[]}\n');
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 0, built.stderr);
      assert.equal(built.stderr, '');
      const graph = json<SpecGraphDocument>(built);
      assert.equal(graph.command, 'spec.graph.build');
      assert.equal(graph.ok, true);
      assert.equal(graph.session, 'order-sentence');
      assert.deepEqual(graph.issues, []);
      assert.deepEqual(graph.graph?.objects, ['order']);
      assert.deepEqual(graph.graph?.states, [
        { id: 'null', object: 'order', frames: ['fr:s1.t1'] },
        { id: 'submitted', object: 'order', frames: ['fr:s1.t1', 'fr:s1.t7'] },
        { id: 'approved', object: 'order', frames: ['fr:s1.t7'] },
      ]);
      assert.deepEqual(graph.graph?.transitions, [
        { id: 'fr:s1.t1', from: 'null', event: 'SUBMIT', to: 'submitted', actor: 'customer', object: 'order', frame: 'fr:s1.t1', frames: ['fr:s1.t1'] },
        {
          id: 'fr:s1.t7', from: 'submitted', event: 'APPROVE', to: 'approved', actor: 'manager', guard: 'condition:cond_s1_t12',
          object: 'order', frame: 'fr:s1.t7', frames: ['fr:s1.t7'],
        },
      ]);
      assert.deepEqual(graph.flows, [
        { id: 'W1', title: 'Order lifecycle', expect: 'accepted', transitions: ['fr:s1.t1', 'fr:s1.t7'], origin: 'rule' },
      ]);
      const buildHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.graph.build');
      assert.deepEqual(buildHistory[0]?.before, []);
      assert.deepEqual(buildHistory[0]?.after, ['W1']);
      assert.deepEqual(codes(graph.findings), ['no-initial-state', 'no-final-state']);
      const afterBuild = historyCount(dir, 'order-sentence');
      const again = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(again.status, 0);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);
      assert.equal(existsSync(leftover), false);
      assert.equal(existsSync(sessionFile(dir, 'flows.json')), true);

      const present = json<SpecStatusDocument>(run(dir, ['spec', 'status', '--json']));
      assert.equal(present.layers?.graph, true);
      assert.equal(present.findingsByLayer?.graph.some((finding) => finding.code === 'no-final-state'), true);
      assert.equal(present.findingsByLayer?.graph.some((finding) => finding.code === 'guard-without-else'), false);
      assert.equal(present.findings.some((finding) => finding.code === 'graph-absent'), false);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const traced = run(dir, ['spec', 'trace', 'fr:s1.t1', '--json']);
      assert.equal(traced.status, 0, traced.stderr);
      const trace = json<SpecTraceDocument>(traced);
      assert.equal(trace.chain?.[0]?.layer, 'transition');
      assert.equal(trace.chain?.[0]?.id, 'fr:s1.t1');
      assert.equal(trace.chain?.[0]?.text, 'null → submitted');
      assert.deepEqual(trace.chain?.[0]?.refs, ['fr:s1.t1']);
      assert.equal(trace.chain?.[1]?.layer, 'frame');

      const dry = run(dir, ['spec', 'emit', '--dry-run', '--json']);
      assert.equal(dry.status, 0, dry.stderr);
      assert.equal(dry.stderr, '');
      const preview = json<SpecEmitDocument>(dry);
      assert.equal(preview.command, 'spec.emit');
      assert.equal(preview.ok, true);
      assert.equal(preview.dryRun, true);
      assert.equal(preview.id, 'orderFlows');
      assert.equal(preview.written, undefined);
      assert.equal(preview.chartWritten, undefined);
      assert.match(preview.yaml ?? '', /id: orderFlows/);
      assert.match(preview.yaml ?? '', new RegExp(SUBMIT));
      assert.match(preview.yaml ?? '', /start: "null"/);
      assert.match(preview.yaml ?? '', /event: "SUBMIT"/);
      assert.match(preview.yaml ?? '', /event: "APPROVE"/);
      assert.match(preview.chartYaml ?? '', /kind: clew.spec.v1/);
      assert.match(preview.chartYaml ?? '', /event: SUBMIT/);
      assert.match(preview.chartYaml ?? '', /id: "null", match: \{ order_status: null \}/);
      assert.equal(preview.workflowSet?.id, 'orderFlows');
      assert.deepEqual(preview.workflowSet?.workflows.map((workflow) => workflow.id), ['W1']);
      const nodes = preview.workflowSet?.workflows[0]?.nodes ?? [];
      assert.deepEqual(nodes.map((node) => node.assign.order_status), [null, 'submitted', 'approved']);
      assert.deepEqual(nodes.map((node) => node.assign.cond_s1_t12), [false, false, true]);
      assert.equal(preview.workflowSet?.workflows[0]?.edges[0]?.event, 'SUBMIT');
      assert.equal(preview.workflowSet?.workflows[0]?.edges[0]?.stateTo, 'submitted');
      assert.equal(codes(preview.findings).includes('guard-without-else'), false);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const out = join(dir, 'flows.yaml');
      const wrote = json<SpecEmitDocument>(run(dir, ['spec', 'emit', '--out', out, '--json']));
      assert.equal(wrote.written, out);
      assert.equal(existsSync(out), true);
      const checked = run(dir, ['workflows', 'check', out, '--json']);
      assert.equal(checked.status, 0, checked.stderr);
      assert.equal(historyCount(dir, 'order-sentence'), afterBuild);

      const grouped = run(dir, ['spec', 'graph', 'group', '--id', 'W1', '--id', 'W9', '--title', 'Submit and approve an order', '--json']);
      assert.equal(grouped.status, 2);
      assert.match(grouped.stderr, /unknown flow "W9"/);
      const human = run(dir, ['spec', 'graph', 'build']);
      assert.match(human.stdout, /3 states, 2 transitions, 1 flows/);
    });
  });

  test('the agent can split the path, and the split survives a rebuild', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'frames', 'list', '--json']);
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      const kept = historyCount(dir, 'order-sentence');
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      assert.equal(historyCount(dir, 'order-sentence'), kept);
      const splitPatch = join(dir, 'split.json');
      writeFileSync(splitPatch, `${JSON.stringify({ id: 'W1', at: 'fr:s1.t7' })}\n`);
      const split = run(dir, ['spec', 'graph', 'split', '--from', splitPatch, '--json']);
      assert.equal(split.status, 0, split.stderr);
      const paths = json<SpecGraphDocument>(split);
      assert.deepEqual(paths.changed, ['W1', 'W2']);
      assert.equal(paths.flows?.find((flow) => flow.id === 'W1')?.transitions.join(','), 'fr:s1.t1');
      assert.equal(paths.flows?.find((flow) => flow.id === 'W2')?.transitions.join(','), 'fr:s1.t7');
      assert.equal(paths.flows?.find((flow) => flow.id === 'W2')?.origin, 'agent');
      const splitHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.graph.split');
      assert.deepEqual(splitHistory.at(-1)?.before, ['W1']);
      assert.deepEqual(splitHistory.at(-1)?.after, ['W1', 'W2']);
      const stored = JSON.parse(readFileSync(sessionFile(dir, 'flows.json'), 'utf8')) as { flows: { transitions: string[] }[] };
      assert.deepEqual(stored.flows.map((flow) => flow.transitions), [['fr:s1.t1'], ['fr:s1.t7']]);
      const flow = run(dir, ['spec', 'trace', 'W1', '--json']);
      assert.equal(json<SpecTraceDocument>(flow).chain?.[0]?.layer, 'flow');
      assert.equal(json<SpecTraceDocument>(flow).chain?.[0]?.id, 'W1');

      const rebuilt = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(rebuilt.status, 0, rebuilt.stderr);
      const overlay = json<SpecGraphDocument>(rebuilt);
      assert.equal(overlay.flows?.find((item) => item.id === 'W1')?.origin, 'agent');
      assert.equal(overlay.flows?.find((item) => item.id === 'W2')?.transitions.join(','), 'fr:s1.t7');
      assert.equal(existsSync(sessionFile(dir, 'graph.json')), false);
    });
  });

  test('a final mark and a forbidden step clear the gate and propose a rejected path', () => {
    const items: CompiledItem[] = [
      { kind: 'init', id: 'fr:s1.t1', sources: ['s1'], assign: { order: atom('draft') }, object: 'order', state: { object: 'order', value: 'draft' } },
      action('fr:s1.t2', 'SUBMIT', 'customer', 'draft', 'submit'),
      action('fr:s2.t1', 'APPROVE', 'manager', 'submit', 'approve'),
      { kind: 'terminal', id: 'fr:s3.t1', sources: ['s3'], assign: { order: atom('approve') }, object: 'order', state: { object: 'order', value: 'approve' } },
      {
        kind: 'forbidden', id: 'fr:s4.t1', sources: ['s4'], object: 'order', event: 'APPROVE', attempted: 'approve', actor: 'manager',
        when: eq('order', atom('submit')), assign: { order: atom('approve') },
      },
    ];
    const built = buildGraph(compiledOf(items, 'draft'), undefined, 5000);
    assert.deepEqual(codes(built.findings), []);
    const approved = built.graph.states.find((state) => state.id === 'approve');
    assert.equal(approved?.final, true);
    assert.ok(approved?.frames.includes('fr:s2.t1'));
    assert.equal(built.graph.states.find((state) => state.id === 'draft')?.initial, true);
    const rejected = built.graph.flows.find((flow) => flow.expect === 'rejected');
    assert.ok(rejected);
    assert.equal(rejected.title, 'Cannot approve order');
    assert.equal(rejected.rejectAt, 1);
    assert.deepEqual(rejected.transitions, ['fr:s2.t1']);
    assert.equal(rejected.forbidden, 'fr:s4.t1');
    assert.deepEqual(built.graph.flows.find((flow) => flow.expect === 'accepted')?.transitions, ['fr:s1.t2', 'fr:s2.t1']);
  });

  test('a forbidden step with no transition is rejected from the initial state', () => {
    const items: CompiledItem[] = [
      { kind: 'init', id: 'fr:s1.t1', sources: ['s1'], assign: { order: atom('shipped') }, object: 'order', state: { object: 'order', value: 'shipped' } },
      {
        kind: 'forbidden', id: 'fr:s2.t1', sources: ['s2'], object: 'order', event: 'CANCEL', attempted: 'cancel', actor: 'customer',
        when: eq('order', atom('shipped')), assign: { order: atom('cancel') },
      },
    ];
    const built = buildGraph(compiledOf(items, 'shipped'), undefined, 5000);
    const flow = built.graph.flows.find((item) => item.expect === 'rejected');
    assert.ok(flow);
    assert.deepEqual(flow.transitions, []);
    assert.equal(flow.rejectAt, 1);
    assert.equal(codes(built.findings).includes('forbidden-uncovered'), false);
  });

  test('a forbidden frame with no initial state is blocking', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'cancel.md', 'The customer must not cancel a shipped order.\n');
      prepare(dir, file);
      run(dir, ['spec', 'frames', 'list', '--json']);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 1, `${built.stderr}\n${built.stdout}`);
      const finding = json<SpecGraphDocument>(built).findings.find((item) => item.code === 'forbidden-uncovered');
      assert.equal(finding?.severity, 'blocking');
      assert.deepEqual(finding?.refs?.[0], 'fr:s1.t1');
    });
  });

  test('bad input is exit 2 and a bad edit does not write', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'early.md', 'When the customer submits an order, the manager approves the order if the total is under 500 dollars.\n');
      assert.equal(run(dir, ['spec', 'init', file, '--json']).status, 0);
      assert.equal(run(dir, ['spec', 'tag', '--json']).status, 0);
      const early = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /no frames; run clew spec frames list first/);
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
      const chartStdout = run(dir, ['spec', 'emit', '--dry-run', '--chart', '-', '--json']);
      assert.equal(chartStdout.status, 2);
      assert.match(chartStdout.stderr, /never writes the chart to stdout/);
      const oldId = run(dir, ['spec', 'graph', 'group', '--transition', 'f1', '--transition', 'f2', '--json']);
      assert.equal(oldId.status, 2);
      assert.match(oldId.stderr, /frame ids look like/);
    });
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'frames', 'list', '--json']);
      assert.equal(run(dir, ['spec', 'graph', 'build', '--json']).status, 0);
      const lines = historyCount(dir, 'order-sentence');
      const unsplittable = run(dir, ['spec', 'graph', 'split', '--id', 'W1', '--at', '1', '--json']);
      assert.equal(unsplittable.status, 1);
      assert.equal(unsplittable.stderr, '');
      assert.equal(json<SpecGraphDocument>(unsplittable).findings.some((finding) => finding.code === 'unsplittable'), true);
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

  test('an emitted workflow set verifies against the emitted chart, and a restated event adds no transition', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'ship.md', LIFECYCLE);
      prepare(dir, file);
      run(dir, ['spec', 'frames', 'list', '--json']);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
      assert.deepEqual(json<SpecGraphDocument>(built).graph?.transitions.map((transition) => transition.id), ['fr:s1.t1', 'fr:s2.t7']);
      const flows = join(dir, 'flows.yaml');
      const chart = join(dir, 'spec.yaml');
      const previewChart = join(dir, 'preview-spec.yaml');
      const preview = run(dir, ['spec', 'emit', '--dry-run', '--chart', previewChart, '--json']);
      assert.equal(preview.status, 0, `${preview.stderr}\n${preview.stdout}`);
      assert.equal(existsSync(previewChart), false);
      assert.equal(existsSync(flows), false);
      assert.match(json<SpecEmitDocument>(preview).chartYaml ?? '', /kind: clew.spec.v1/);
      const emitted = run(dir, ['spec', 'emit', '--out', flows, '--chart', chart, '--json']);
      assert.equal(emitted.status, 0, `${emitted.stderr}\n${emitted.stdout}`);
      const yaml = readFileSync(flows, 'utf8');
      assert.match(yaml, /order_status: "submitted"/);
      assert.match(yaml, /event: "APPROVE"/);
      assert.doesNotMatch(yaml, /phase:/);
      assert.equal(json<SpecEmitDocument>(emitted).chartWritten, chart);
      const spec = readFileSync(chart, 'utf8');
      assert.match(spec, /kind: clew.spec.v1/);
      assert.match(spec, /id: order/);
      assert.match(spec, /event: APPROVE/);
      const proof = run(dir, ['verify', chart, flows, '--json']);
      assert.equal(proof.status, 0, `${proof.stderr}\n${proof.stdout}`);
      const verified = json<VerifyDocument>(proof);
      assert.equal(verified.ok, true);
      assert.equal(verified.summary?.failed, 0);
      assert.ok((verified.flows?.length ?? 0) > 0);
      assert.equal(verified.flows?.every((flow) => flow.pass), true);
      const step = verified.flows?.[0]?.trace[1];
      assert.equal(step?.workflow.from, 'submitted');
      assert.equal(step?.workflow.event, 'APPROVE');
      assert.equal(step?.chart.to, 'approved');
    });
  });

  test('help lists graph and emit', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec graph build/);
    assert.match(help.stdout, /spec graph split/);
    assert.match(help.stdout, /spec graph group/);
    assert.match(help.stdout, /spec emit/);
    const emitHelp = clew(['help', 'spec', 'emit'], tmpdir());
    assert.equal(emitHelp.status, 0);
    assert.match(emitHelp.stdout, /--chart/);
    assert.match(emitHelp.stdout, /clew spec emit --out flows.yaml --chart spec.yaml --json/);
  });

  test('same-object branches fold into one lifecycle', () => {
    const built = buildGraph(compiledOf([
      action('fr:s1.t1', 'SUBMIT', 'customer', 'null', 'submit'),
      action('fr:s2.t1', 'APPROVE', 'manager', 'submit', 'approve'),
      action('fr:s3.t1', 'CANCEL', 'customer', 'submit', 'cancel'),
    ]), undefined, 5000);
    const accepted = built.graph.flows.filter((flow) => flow.expect === 'accepted');
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.title, 'Order lifecycle');
    assert.deepEqual(accepted[0]?.transitions, ['fr:s1.t1', 'fr:s2.t1', 'fr:s3.t1']);
  });

  test('paths follow sentence and then token order', () => {
    const built = buildGraph(compiledOf([
      action('fr:s10.t1', 'APPROVE', 'manager', 'submit', 'approve'),
      action('fr:s2.t5', 'SUBMIT', 'customer', 'null', 'submit'),
    ]), undefined, 5000);
    assert.deepEqual(built.graph.flows[0]?.transitions, ['fr:s2.t5', 'fr:s10.t1']);
  });

  test('a lone edge on an object stays a single-edge workflow', () => {
    const built = buildGraph(compiledOf([action('fr:s1.t1', 'SUBMIT', 'customer', 'null', 'submit')]), undefined, 5000);
    const accepted = built.graph.flows.filter((flow) => flow.expect === 'accepted');
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.title, 'Submit order');
    assert.deepEqual(accepted[0]?.transitions, ['fr:s1.t1']);
  });

  test('when null is the initial overlay from, not a missing source', () => {
    const open = buildGraph(compiledOf([action('fr:s1.t1', 'SUBMIT', 'customer', 'null', 'submit')]), undefined, 5000);
    assert.equal(open.findings.some((finding) => finding.code === 'transition-without-from'), false);
    assert.equal(open.graph.transitions[0]?.from, 'null');
    assert.equal(open.graph.transitions[0]?.to, 'submit');
  });

  test('emit --chart writes a spec when the workflow set is empty', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'empty.md', 'The customer is ready.\n');
      prepare(dir, file);
      assert.equal(run(dir, ['spec', 'frames', 'list', '--json']).status, 0);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(built.status === 0 || built.status === 1, true, `${built.stderr}\n${built.stdout}`);
      const out = join(dir, 'flows.yaml');
      const chart = join(dir, 'spec.yaml');
      const preview = run(dir, ['spec', 'emit', '--dry-run', '--chart', chart, '--json']);
      assert.equal(preview.status === 0 || preview.status === 1, true, `${preview.stderr}\n${preview.stdout}`);
      assert.equal(existsSync(chart), false);
      assert.match(json<SpecEmitDocument>(preview).chartYaml ?? '', /kind: clew.spec.v1/);
      const emitted = run(dir, ['spec', 'emit', '--out', out, '--chart', chart, '--force', '--json']);
      assert.equal(emitted.status === 0 || emitted.status === 1, true, `${emitted.stderr}\n${emitted.stdout}`);
      const document = json<SpecEmitDocument>(emitted);
      assert.equal(document.chartWritten, chart);
      assert.equal(existsSync(chart), true);
      assert.match(readFileSync(chart, 'utf8'), /kind: clew.spec.v1/);
      assert.equal(document.written, undefined);
      assert.equal(existsSync(out), false);
    });
  });

  test('reach bound truncation is blocking', () => {
    const items: CompiledItem[] = [
      action('fr:s1.t1', 'SUBMIT', 'customer', 'draft', 'submit'),
      { kind: 'init', id: 'fr:s2.t1', sources: [], assign: { order: atom('draft') }, object: 'order', state: { object: 'order', value: 'draft' } },
    ];
    const truncated = buildGraph(compiledOf(items, 'draft'), undefined, 1);
    const hit = truncated.findings.find((finding) => finding.code === 'state-space-truncated');
    assert.ok(hit);
    assert.match(hit.message, /order truncated at 1 valuations/);
    const open = buildGraph(compiledOf(items, 'draft'), undefined, 5000);
    assert.equal(open.findings.some((finding) => finding.code === 'state-space-truncated'), false);
  });
});

function atom(value: string): Value {
  return valueOf('atom', value);
}

function eq(name: string, value: Value): Predicate {
  return { op: 'eq', var: varId(name), value };
}

function action(id: string, event: string, actor: string, from: string, to: string): CompiledAction {
  return {
    kind: 'action',
    id,
    sources: [id.slice(3, id.indexOf('.'))],
    event,
    when: eq('order', from === 'null' ? { t: 'null' } : atom(from)),
    assign: { order: atom(to) },
    overlay: { object: 'order', objectVar: 'order', from, to, actor },
    evidence: { event: [], object: [] },
  };
}

function compiledOf(items: CompiledItem[], initial?: string): CompiledSpec {
  const actions: Action[] = [];
  for (const item of items) {
    if (item.kind === 'action') actions.push({ event: eventName(item.event), actor: item.overlay?.actor ?? 'unspecified', when: item.when, assign: item.assign });
  }
  return {
    draft: { id: 'order', vars: [{ id: varId('order'), type: 'atom' }], initial: { order: initial === undefined ? { t: 'null' } : atom(initial) }, actions, labels: [] },
    items,
  };
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

function sessionFile(dir: string, name: string): string {
  return join(specSessionDir('order-sentence', { CLEW_DATA_DIR: dir }), name);
}

function historyCount(dir: string, session: string): number {
  return historyEntries(dir, session).length;
}

function historyEntries(dir: string, session: string): { command: string; before: string[]; after: string[] }[] {
  const file = join(specSessionDir(session, { CLEW_DATA_DIR: dir }), 'history.jsonl');
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
