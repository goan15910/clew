// Use case: schema and graph validity of one spec. No workflows, no traversal.
import { jsonScalar, type Spec } from '../domain/spec-model.js';
import { tagIssues, type ChartCheckDocument, type ChartSketch, type Outcome } from './documents.js';
import type { SpecLoader } from './ports.js';

export function chartSketch(spec: Spec): ChartSketch {
  const vars: ChartSketch['vars'] = [];
  for (const decl of spec.vars) vars.push({ id: decl.id, type: decl.type });
  const initial: ChartSketch['initial'] = {};
  for (const [id, value] of spec.initial.entries()) initial[id] = jsonScalar(value);
  const actions: ChartSketch['actions'] = [];
  for (const action of spec.actions) actions.push({ event: action.event, actor: action.actor });
  const labels: ChartSketch['labels'] = [];
  for (const label of spec.labels) {
    const item: ChartSketch['labels'][number] = { text: label.text };
    if (label.id !== undefined) item.id = label.id;
    if (label.final === true) item.final = true;
    labels.push(item);
  }
  return { id: spec.id, vars, initial, actions, labels };
}

export function checkChart(file: string, specs: SpecLoader): Outcome<ChartCheckDocument> {
  const loaded = specs.load(file);
  if (!loaded.ok && loaded.fault === 'unreadable') {
    return {
      exit: 'invalid',
      document: {
        command: 'chart.check',
        ok: false,
        graphChecked: false,
        issues: tagIssues(file, 'input', loaded.errors),
      },
    };
  }
  if (!loaded.ok && loaded.fault === 'schema') {
    return {
      exit: 'fail',
      document: {
        command: 'chart.check',
        ok: false,
        graphChecked: false,
        issues: tagIssues(file, 'schema', loaded.errors),
      },
    };
  }
  if (!loaded.ok) {
    return {
      exit: 'fail',
      document: {
        command: 'chart.check',
        ok: false,
        graphChecked: true,
        issues: tagIssues(file, 'graph', loaded.errors),
      },
    };
  }
  return {
    exit: 'pass',
    document: {
      command: 'chart.check',
      ok: true,
      graphChecked: true,
      chart: chartSketch(loaded.value),
      issues: [],
    },
  };
}
