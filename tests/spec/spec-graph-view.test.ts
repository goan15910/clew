import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { draftChains, draftCharts, draftLabelModel } from '../../src/domain/spec-graph-view.js';
import { compileSnapshot } from '../../src/domain/spec-compile.js';
import { toWorkflowSetDraft } from '../../src/domain/spec-graph.js';
import { liveSentences, type SpecSnapshot } from '../../src/domain/spec.js';
import { buildFramesSession, loadFramesSnapshot } from './helpers/frames-session.js';

describe('draft graph view', () => {
  let dir = '';
  let snapshot: SpecSnapshot;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'clew-graph-view-'));
    buildFramesSession(dir, 'guarded', { graph: true });
    snapshot = loadFramesSnapshot(dir, 'guarded');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('the order chart uses chart state ids and events, and the lifecycle is an accepted trace', () => {
    const graph = snapshot.graph;
    assert.ok(graph);
    const charts = draftCharts(graph);
    const order = charts.find((chart) => chart.object === 'order');
    assert.ok(order);
    assert.deepEqual(order.model.states().map((state) => state.id), ['null', 'submitted', 'approved']);
    assert.deepEqual(order.model.states().map((state) => state.label), ['null', 'submitted', 'approved']);
    assert.deepEqual(order.model.transitions().map((edge) => edge.event), ['SUBMIT', 'APPROVE']);
    assert.equal(order.model.transitions()[0]?.actor, 'customer');
    assert.equal(order.model.transitions()[1]?.actor, 'manager');
    assert.deepEqual(order.model.transitions()[1]?.guard, { name: 'condition:cond_s1_t12', reads: '' });
    assert.deepEqual(order.model.transitions()[0]?.effect, { name: 'none', sets: '' });

    const labels = draftLabelModel(graph);
    assert.deepEqual(labels.states().map((state) => [state.id, state.label]), [
      ['null', 'null'],
      ['submitted', 'submitted'],
      ['approved', 'approved'],
    ]);

    assert.equal(charts.some((chart) => chart.object === 'package'), false);

    const built = toWorkflowSetDraft(graph, compileSnapshot(snapshot), liveSentences(snapshot.sentences), snapshot.tagged);
    assert.ok(built.draft);
    const results = draftChains(built.draft);
    const lifecycle = results.find((result) => result.id === 'W1');
    assert.ok(lifecycle);
    assert.equal(lifecycle.expect, 'accepted');
    assert.equal(lifecycle.pass, true);
    assert.equal(lifecycle.reason, '');
    assert.equal(lifecycle.trace.length, 2);
    assert.equal(lifecycle.trace[0]?.accepted, true);
    assert.equal(lifecycle.trace[0]?.event, 'SUBMIT');
    assert.equal(lifecycle.trace[0]?.to, 'submitted');
    assert.equal(lifecycle.trace[1]?.accepted, true);
    assert.equal(lifecycle.trace[1]?.from, 'submitted');
    assert.equal(lifecycle.trace[1]?.event, 'APPROVE');
    assert.equal(lifecycle.trace[1]?.to, 'approved');
    assert.equal(results.some((result) => result.expect === 'rejected'), false);
  });
});
