import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { actorStroke, chainsDot, chartDot } from '../../src/adapters/diagram/diagrams.js';
import { assembleModel } from '../../src/domain/model.js';
import type { WorkflowResult } from '../../src/domain/verification.js';

const model = assembleModel({
  id: 'demo',
  initial: 'draft',
  guards: [{ name: 'ready', reads: 'title' }],
  effects: [
    { name: 'mark', sets: 'flag' },
    { name: 'seal', sets: 'flag' },
  ],
  states: [
    { id: 'draft', label: 'Draft', final: false, data: { title: 'string' } },
    { id: 'open', label: 'Open', final: false, data: { flag: 'boolean' } },
    { id: 'closed', label: 'Closed', final: true, data: { flag: 'boolean' } },
  ],
  transitions: [
    { from: 'draft', event: 'OPEN', to: 'open', actor: 'user', guard: 'ready', effect: 'mark' },
    { from: 'open', event: 'CLOSE', to: 'closed', actor: 'timer', effect: 'seal' },
  ],
});

const opened: WorkflowResult = {
  id: 'W1',
  title: 'Open it',
  expect: 'accepted',
  pass: true,
  reason: '',
  trace: [{
    n: 1,
    text: 'Open',
    event: 'OPEN',
    from: 'draft',
    to: 'open',
    accepted: true,
    workflowEvent: 'open',
    workflowFrom: 'draft',
    workflowTo: 'open',
  }],
  finalState: 'open',
  finalWorkflowState: 'open',
  provedBy: 'replay',
};

function edgeLine(dot: string, from: string, to: string): string {
  const line = dot.split('\n').find((item) => item.includes(`${from} -> ${to} [`));
  assert.ok(line, `missing edge ${from} -> ${to}`);
  return line;
}

describe('state chart dot', () => {
  test('states are attribute tables, grouped by who leaves them', () => {
    const dot = chartDot(model, 'Demo');
    assert.match(dot, /<TABLE\b/);
    assert.match(dot, />title<\/FONT>/);
    assert.match(dot, />string<\/FONT>/);
    assert.match(dot, />flag<\/FONT>/);
    assert.match(dot, />boolean<\/FONT>/);
    assert.match(dot, /subgraph cluster_user \{/);
    assert.match(dot, /label="user"/);
    assert.match(dot, /subgraph cluster_timer \{/);
    assert.match(dot, /subgraph cluster_final \{/);
    assert.match(dot, /label="final"/);
    assert.match(dot, /peripheries=2/);
  });

  test('edges take the actor color, and a guard is dashed', () => {
    const dot = chartDot(model, 'Demo');
    const open = edgeLine(dot, 'draft', 'open');
    const close = edgeLine(dot, 'open', 'closed');
    assert.match(open, new RegExp(`color="${actorStroke('user', ['user', 'timer'])}"`));
    assert.match(open, /style=dashed/);
    assert.match(open, /guard: ready/);
    assert.equal(close.includes('style=dashed'), false);
    assert.match(close, new RegExp(`color="${actorStroke('timer', ['user', 'timer'])}"`));
    assert.notEqual(actorStroke('user', ['user', 'timer']), actorStroke('timer', ['user', 'timer']));
  });

  test('tooltips and links point at the target state', () => {
    const dot = chartDot(model, 'Demo');
    assert.match(dot, /tooltip="Draft\\nid: draft\\ntitle: string"/);
    assert.match(dot, /URL="#draft"/);
    assert.match(dot, /tooltip="OPEN\\ndraft -> open\\nactor: user\\nguard: ready\\neffect: mark"/);
    const open = edgeLine(dot, 'draft', 'open');
    assert.match(open, /URL="#open"/);
  });

  test('a highlighted path stays numbered and the rest fades', () => {
    const dot = chartDot(model, 'Demo', opened);
    const open = edgeLine(dot, 'draft', 'open');
    const close = edgeLine(dot, 'open', 'closed');
    assert.match(open, /\(1\) /);
    assert.match(open, /color="#0969da"/);
    assert.match(open, /penwidth=3/);
    assert.match(open, /style=dashed/);
    assert.match(close, /color="#d0d7de"/);
    assert.match(close, /fontcolor="#8c959f"/);
    assert.equal(close.includes('#bc4c00'), false);
    assert.match(dot, /closed \[label=.*color="#d8dee4"/);
    assert.match(dot, /draft \[label=.*color="#0969da" penwidth=2/);
    assert.match(dot, /__start -> draft \[label="new task".*color="#d0d7de"/);
  });

  test('dot 16.1.0 writes the tooltip and the link into the svg', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-chart-'));
    const dotPath = join(dir, 'chart.dot');
    const svgPath = join(dir, 'chart.svg');
    writeFileSync(dotPath, chartDot(model, 'Demo', opened));
    execFileSync('dot', ['-Tsvg', dotPath, '-o', svgPath]);
    const svg = readFileSync(svgPath, 'utf8');
    assert.match(svg, /graphviz version 16\.1\.0/);
    assert.match(svg, /xlink:title="Draft&#10;id: draft&#10;title: string"/);
    assert.match(svg, /xlink:href="#open"/);
    assert.match(svg, /stroke-dasharray/);
    assert.match(svg, /cluster_user/);
  });
});

describe('workflow chain dot', () => {
  test('each workflow is a cluster, and a refusal is dashed', () => {
    const refused: WorkflowResult = {
      ...opened,
      id: 'W9',
      title: 'Refuse the close',
      expect: 'rejected',
      pass: true,
      reason: '',
      trace: [{
        n: 1,
        text: 'Close',
        event: 'CLOSE',
        from: 'open',
        to: null,
        accepted: false,
        workflowEvent: 'close',
        workflowFrom: 'open',
        workflowTo: null,
      }],
    };
    const dot = chainsDot(model, 'W9', [refused]);
    assert.match(dot, /subgraph cluster_0 \{/);
    assert.match(dot, /style=dashed/);
    assert.match(dot, /refused \(as required\)/);
  });
});
