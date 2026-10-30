import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chartInteractive, workflowInteractive } from '../../src/application/interactive-graph.js';
import { draftChains, draftCharts, draftLabelModel } from '../../src/domain/spec-graph-view.js';
import { toWorkflowSetDraft } from '../../src/domain/spec-graph.js';
import type { DraftGraph, Entity, Fact, Sentence, SpecSnapshot, TaggedSentence } from '../../src/domain/spec.js';
import { SPEC_SCHEMA_VERSION } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const matrix = join(root, 'tests', 'fixtures', 'sessions', 'viewer-matrix');

describe('interactive graph', () => {
  test('chart hover details include condition text and sentence lineage', () => {
    const snapshot = loadSnapshot();
    const charts = draftCharts(snapshot.graph!);
    const order = charts.find((chart) => chart.object === 'order');
    assert.ok(order);
    const interactive = chartInteractive(order.model, order.object, snapshot);
    assert.ok(interactive.elements.some((el) => el.group === 'nodes'));
    assert.ok(interactive.elements.some((el) => el.group === 'edges' && el.classes === 'guarded'));
    const guarded = Object.values(interactive.details).find((detail) => detail.condition);
    assert.ok(guarded);
    assert.equal(guarded.condition, 'the total is under 500 dollars');
    assert.match(guarded.sentence ?? '', /customer submits an order/);
    assert.ok(guarded.lineage.some((link) => link.layer === 'transition'));
    assert.ok(guarded.lineage.some((link) => link.layer === 'fact'));
    assert.ok(guarded.lineage.some((link) => link.layer === 'entity'));
    assert.ok(guarded.lineage.some((link) => link.layer === 'sentence'));
  });

  test('workflow chain marks the happy path', () => {
    const snapshot = loadSnapshot();
    const built = toWorkflowSetDraft(
      snapshot.graph!,
      snapshot.entities ?? [],
      snapshot.facts ?? [],
      snapshot.sentences,
      snapshot.tagged,
    );
    assert.ok(built.draft);
    const labels = draftLabelModel(snapshot.graph!);
    const happy = draftChains(built.draft).find((flow) => flow.id === 'HappyPath');
    assert.ok(happy);
    const interactive = workflowInteractive(labels, happy, snapshot);
    assert.equal(interactive.expect, 'accepted');
    assert.ok(interactive.elements.some((el) => el.classes === 'path'));
    assert.ok(Object.values(interactive.details).some((detail) => detail.kind === 'step'));
  });
});

function loadSnapshot(): SpecSnapshot {
  const graph = readJson<DraftGraph>('graph.json');
  const session = readJson<{ id: string; specHash: string; created: string; updated: string }>('session.json');
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    id: session.id,
    specHash: session.specHash,
    created: session.created,
    updated: session.updated,
    sentences: readJson<{ sentences: Sentence[] }>('sentences.json').sentences,
    tagged: readJson<{ sentences: TaggedSentence[] }>('tokens.json').sentences,
    entities: readJson<{ entities: Entity[] }>('entities.json').entities,
    facts: readJson<{ facts: Fact[] }>('facts.json').facts,
    graph,
  };
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(matrix, name), 'utf8')) as T;
}
