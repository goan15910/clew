// Short stdout for humans. `--json` skips this and prints the command document.
import type { CommandDocument } from '../../application/documents.js';
import { formatIssues } from '../../application/documents.js';

function list(ids: readonly string[]): string {
  return ids.length > 0 ? ` (${ids.join(', ')})` : '';
}

export function humanSummary(document: CommandDocument): string {
  if (document.command === 'chart.check') {
    if (document.ok && document.chart) {
      return `${document.chart.id}: schema valid, graph valid (${document.chart.states.length} states, ${document.chart.transitions.length} transitions)`;
    }
    const which = document.graphChecked ? 'graph' : 'schema';
    return [`invalid (${which})`, ...formatIssues(document.issues).map((line) => `  ${line}`)].join('\n');
  }
  if (document.command === 'chart.analyze') {
    if (!document.ok || document.structure === undefined || document.chartId === undefined) return '';
    const structure = document.structure;
    return `${document.chartId}: ${structure.reachable.length} reachable, ${structure.unreachable.length} unreachable${list(structure.unreachable)}, ${structure.deadEnds.length} dead ends${list(structure.deadEnds)}`;
  }
  if (document.command === 'workflows.check') {
    if (document.ok && document.workflowSet) {
      const names: string[] = [];
      for (const workflow of document.workflowSet.workflows) names.push(workflow.id);
      return `${document.workflowSet.id}: schema valid, graph valid (${names.length} workflows: ${names.join(', ')})`;
    }
    const which = document.graphChecked ? 'graph' : 'schema';
    const name = document.id ? `${document.id}: ` : '';
    return [`${name}invalid (${which})`, ...formatIssues(document.issues).map((line) => `  ${line}`)].join('\n');
  }
  if (document.command === 'verify') {
    if (document.fault !== undefined || document.summary === undefined) return '';
    const lines = [`${document.candidate} (${document.chartId}) × ${document.workflowSetId}: ${document.summary.passed}/${document.summary.total} pass`];
    for (const flow of document.flows ?? []) {
      if (!flow.pass) lines.push(`  FAIL ${flow.id}: ${flow.reason}`);
    }
    return lines.join('\n');
  }
  if (document.fault !== undefined) return '';
  const lines = [document.winner ? `winner: ${document.winner}` : 'no winner'];
  for (const candidate of document.candidates ?? []) {
    const failed = candidate.failures.map((failure) => failure.id).join(', ');
    lines.push(`  ${candidate.name}  ${candidate.passed}/${candidate.total}${failed ? `  failed ${failed}` : ''}`);
  }
  return lines.join('\n');
}
