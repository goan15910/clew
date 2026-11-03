import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yamlSpecLoader } from '../../src/adapters/yaml/spec-loader.js';
import { yamlWorkflowLoader } from '../../src/adapters/yaml/workflow-loader.js';
import { yamlModelLoader } from '../../src/adapters/yaml/model-loader.js';
import { verifyFlows } from '../../src/application/verify-flows.js';
import type { VerifyPorts } from '../../src/application/ports.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

const ports: VerifyPorts = {
  specs: yamlSpecLoader,
  models: yamlModelLoader,
  workflows: yamlWorkflowLoader,
  selections: { load: () => ({ ok: false, errors: [{ path: '', message: 'unused' }] }) },
  reports: {
    writeVerification() {},
    writeComparison() {},
  },
  diagrams: {
    render() {},
    writeHeatmap() { return ''; },
    writeReplays() { return []; },
  },
};

describe('next-state verify', () => {
  test('b-full accepts every todo flow', () => {
    const outcome = verifyFlows({
      chartFile: join(root, 'examples/todo/b-full.yaml'),
      workflowsFile: join(root, 'examples/todo/workflows.yaml'),
      flowIds: [],
    }, ports);
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.ok, true);
    assert.equal(outcome.document.summary?.passed, 8);
    assert.equal(outcome.document.summary?.failed, 0);
    assert.equal(outcome.document.flows?.every((flow) => flow.provedBy === 'next-state'), true);
  });

  test('a-basic fails W6 W7 W8 and keeps the other five', () => {
    const outcome = verifyFlows({
      chartFile: join(root, 'examples/todo/a-basic.yaml'),
      workflowsFile: join(root, 'examples/todo/workflows.yaml'),
      flowIds: [],
    }, ports);
    assert.equal(outcome.exit, 'fail');
    assert.equal(outcome.document.summary?.passed, 5);
    assert.equal(outcome.document.summary?.failed, 3);
    const failed = (outcome.document.flows ?? []).filter((flow) => !flow.pass).map((flow) => flow.id);
    assert.deepEqual(failed, ['W6', 'W7', 'W8']);
  });

  test('an unreachable start fails the flow', () => {
    const outcome = verifyFlows({
      chartFile: join(root, 'examples/todo/b-full.yaml'),
      workflowsFile: join(root, 'tests/fixtures/workflows/unreachable-start.yaml'),
      flowIds: [],
    }, ports);
    assert.equal(outcome.exit, 'fail');
    assert.equal(outcome.document.flows?.[0]?.pass, false);
    assert.match(outcome.document.flows?.[0]?.reason ?? '', /not reachable from initial/);
    assert.equal(outcome.document.flows?.[0]?.provedBy, 'next-state');
  });

  test('a wrong next valuation fails the flow', () => {
    const outcome = verifyFlows({
      chartFile: join(root, 'examples/todo/b-full.yaml'),
      workflowsFile: join(root, 'tests/fixtures/workflows/bad-assign.yaml'),
      flowIds: [],
    }, ports);
    assert.equal(outcome.exit, 'fail');
    assert.equal(outcome.document.flows?.[0]?.pass, false);
    assert.match(outcome.document.flows?.[0]?.reason ?? '', /lands in/);
  });

  test('an incomplete assign is a name gap', () => {
    const outcome = verifyFlows({
      chartFile: join(root, 'tests/fixtures/gap/chart.yaml'),
      workflowsFile: join(root, 'tests/fixtures/gap/workflows.yaml'),
      flowIds: [],
    }, ports);
    assert.equal(outcome.exit, 'invalid');
    assert.equal(outcome.document.fault, 'name-gap');
    assert.equal(outcome.document.flows, undefined);
  });
});
