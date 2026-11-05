import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadSpec } from '../../src/adapters/yaml/spec-loader.js';
import { yamlModelLoader } from '../../src/adapters/yaml/model-loader.js';
import { yamlSpecLoader } from '../../src/adapters/yaml/spec-loader.js';
import { checkChart } from '../../src/application/check-chart.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('clew.spec.v1 loader', () => {
  test('loads the todo spec and checkChart passes', () => {
    const outcome = checkChart(join(root, 'examples/todo/b-full.yaml'), yamlSpecLoader);
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.ok, true);
    assert.equal(outcome.document.chart?.id, 'todoTask');
    assert.equal(outcome.document.chart?.vars.length, 7);
    assert.equal(outcome.document.chart?.actions.length, 13);
    assert.equal(outcome.document.chart?.initial.phase, 'draft');
  });

  test('rejects a location-id chart with a migration hint', () => {
    const loaded = loadSpec({
      id: 'todoTask',
      initial: 'draft',
      guards: [],
      effects: [],
      states: [{ id: 'draft', label: 'Draft', data: { title: 'string' } }],
      transitions: [],
    });
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.fault, 'schema');
    assert.equal(loaded.errors.some((error) => error.message.includes('clew.spec.v1')), true);
  });

  test('projects labels so analyze and view still see location ids', () => {
    const loaded = yamlModelLoader.load(join(root, 'examples/todo/b-full.yaml'));
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const ids = loaded.value.states().map((state) => state.id);
    assert.deepEqual(ids, ['draft', 'todo', 'inProgress', 'snoozed', 'done', 'archived', 'deleted']);
    assert.equal(loaded.value.initial, 'draft');
    assert.equal(loaded.value.transitions().length, 13);
    assert.equal(
      loaded.value.transitions().some((edge) => edge.from === 'deleted' && edge.event === 'RESTORE' && edge.to === 'todo'),
      true,
    );
  });
});
