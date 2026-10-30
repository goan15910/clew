import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { draftChains, draftCharts, draftLabelModel } from '../../src/domain/spec-graph-view.js';
import { toWorkflowSetDraft } from '../../src/domain/spec-graph.js';
import type { DraftGraph, Entity, Fact, Sentence, TaggedSentence } from '../../src/domain/spec.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sessions', 'viewer-matrix');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixture, name), 'utf8')) as T;
}

describe('draft graph view', () => {
  test('the order chart uses chart state ids and events, and HappyPath is an accepted trace', () => {
    const graph = readJson<DraftGraph>('graph.json');
    const charts = draftCharts(graph);
    const order = charts.find((chart) => chart.object === 'order');
    assert.ok(order);
    assert.deepEqual(order.model.states().map((state) => state.id), ['draft', 'submitted', 'approved']);
    assert.deepEqual(order.model.states().map((state) => state.label), ['draft', 'submitted', 'approved']);
    assert.equal(order.model.states()[2]?.final, true);
    assert.equal(order.model.initial, 'draft');
    assert.deepEqual(order.model.transitions().map((edge) => edge.event), ['SUBMIT', 'APPROVE']);
    assert.equal(order.model.transitions()[0]?.actor, 'customer');
    assert.equal(order.model.transitions()[1]?.actor, 'manager');
    assert.deepEqual(order.model.transitions()[1]?.guard, { name: 'condition:c1', reads: '' });
    assert.deepEqual(order.model.transitions()[0]?.effect, { name: 'none', sets: '' });

    const labels = draftLabelModel(graph);
    assert.deepEqual(labels.states().map((state) => [state.id, state.label]), [
      ['draft', 'draft'],
      ['submitted', 'submitted'],
      ['approved', 'approved'],
    ]);

    const packageChart = charts.find((chart) => chart.object === 'package');
    assert.ok(packageChart);
    assert.equal(packageChart.model.initial, '');
    assert.deepEqual(packageChart.model.states(), []);

    const entities = readJson<{ entities: Entity[] }>('entities.json').entities;
    const facts = readJson<{ facts: Fact[] }>('facts.json').facts;
    const sentences = readJson<{ sentences: Sentence[] }>('sentences.json').sentences;
    const tagged = readJson<{ sentences: TaggedSentence[] }>('tokens.json').sentences;
    const built = toWorkflowSetDraft(graph, entities, facts, sentences, tagged);
    assert.ok(built.draft);
    const results = draftChains(built.draft);
    const happy = results.find((result) => result.id === 'HappyPath');
    assert.ok(happy);
    assert.equal(happy.expect, 'accepted');
    assert.equal(happy.pass, true);
    assert.equal(happy.reason, '');
    assert.equal(happy.trace.length, 2);
    assert.equal(happy.trace[0]?.accepted, true);
    assert.equal(happy.trace[0]?.from, 'draft');
    assert.equal(happy.trace[0]?.event, 'SUBMIT');
    assert.equal(happy.trace[0]?.to, 'submitted');
    assert.equal(happy.trace[1]?.accepted, true);
    assert.equal(happy.trace[1]?.from, 'submitted');
    assert.equal(happy.trace[1]?.event, 'APPROVE');
    assert.equal(happy.trace[1]?.to, 'approved');
    assert.equal(results.some((result) => result.id === 'ForbidCancel'), false);
    const skipped = built.findings.find((finding) => finding.refs.includes('ForbidCancel'));
    assert.ok(skipped);
    assert.match(skipped.message, /ForbidCancel/);
    assert.match(skipped.message, /package/);
  });
});
