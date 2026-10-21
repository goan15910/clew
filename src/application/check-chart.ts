// Use case: schema and graph validity of one state chart. No workflows, no traversal.
import type { Model } from '../domain/model.js';
import { tagIssues, type ChartCheckDocument, type ChartSketch, type Outcome } from './documents.js';
import type { ModelLoader } from './ports.js';

export function chartSketch(model: Model): ChartSketch {
  const states: ChartSketch['states'] = [];
  for (const state of model.states()) states.push({ id: state.id, label: state.label, final: state.final });
  const transitions: ChartSketch['transitions'] = [];
  for (const edge of model.transitions()) transitions.push({ from: edge.from, event: edge.event, to: edge.to });
  return { id: model.id, initial: model.initial, states, transitions };
}

export function checkChart(file: string, models: ModelLoader): Outcome<ChartCheckDocument> {
  const loaded = models.load(file);
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
