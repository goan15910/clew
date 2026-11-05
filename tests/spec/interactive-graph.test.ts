import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chartInteractive, workflowInteractive } from '../../src/application/interactive-graph.js';
import { draftChains, draftCharts, draftLabelModel } from '../../src/domain/spec-graph-view.js';
import { compileSnapshot } from '../../src/domain/spec-compile.js';
import { toWorkflowSetDraft } from '../../src/domain/spec-graph.js';
import { liveSentences, type SpecSnapshot } from '../../src/domain/spec.js';
import { buildFramesSession, loadFramesSnapshot } from './helpers/frames-session.js';

describe('interactive graph', () => {
  let dir = '';
  let snapshot: SpecSnapshot;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'clew-interactive-'));
    buildFramesSession(dir, 'guarded', { graph: true });
    snapshot = loadFramesSnapshot(dir, 'guarded');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('chart hover details include condition text and sentence lineage', () => {
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
    assert.ok(guarded.lineage.some((link) => link.layer === 'frame'));
    assert.ok(guarded.lineage.some((link) => link.layer === 'concept'));
    assert.ok(guarded.lineage.some((link) => link.layer === 'sentence'));
  });

  test('workflow chain marks the happy path', () => {
    const built = toWorkflowSetDraft(
      snapshot.graph!,
      compileSnapshot(snapshot),
      liveSentences(snapshot.sentences),
      snapshot.tagged,
    );
    assert.ok(built.draft);
    const labels = draftLabelModel(snapshot.graph!);
    const happy = draftChains(built.draft).find((flow) => flow.id === 'W1');
    assert.ok(happy);
    const interactive = workflowInteractive(labels, happy, snapshot);
    assert.equal(interactive.expect, 'accepted');
    assert.ok(interactive.elements.some((el) => el.classes === 'path'));
    assert.ok(Object.values(interactive.details).some((detail) => detail.kind === 'step'));
  });
});
