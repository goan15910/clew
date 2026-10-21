// Use case: reachability, dead ends, and shortest paths. The chart must already be valid.
import { structuralChecks } from '../domain/verification.js';
import { tagIssues, type ChartAnalyzeDocument, type Outcome } from './documents.js';
import type { ModelLoader, TraversalEngine } from './ports.js';

export function analyzeChart(file: string, models: ModelLoader, engine: TraversalEngine): Outcome<ChartAnalyzeDocument> {
  const loaded = models.load(file);
  if (!loaded.ok && loaded.fault === 'unreadable') {
    return {
      exit: 'invalid',
      document: {
        command: 'chart.analyze',
        ok: false,
        fault: 'unreadable',
        issues: tagIssues(file, 'input', loaded.errors),
      },
    };
  }
  if (!loaded.ok) {
    return {
      exit: 'invalid',
      document: {
        command: 'chart.analyze',
        ok: false,
        fault: 'invalid-chart',
        issues: tagIssues(file, loaded.fault === 'schema' ? 'schema' : 'graph', loaded.errors),
      },
    };
  }
  const structure = structuralChecks(loaded.value, engine.open(loaded.value));
  const clean = structure.unreachable.length === 0 && structure.deadEnds.length === 0;
  return {
    exit: clean ? 'pass' : 'fail',
    document: {
      command: 'chart.analyze',
      ok: true,
      clean,
      chartId: loaded.value.id,
      structure,
      issues: [],
    },
  };
}
