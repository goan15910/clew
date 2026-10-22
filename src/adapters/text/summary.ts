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
  if (document.command === 'spec.init') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${document.sentences?.length ?? 0} sentences`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.tag') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const tagger = document.tagger === undefined ? '' : ` (${document.tagger.name} ${document.tagger.version})`;
    const lines = [`session ${document.session}: tagged ${document.sentences?.length ?? 0} sentences${tagger}`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (
    document.command === 'spec.entities.list'
    || document.command === 'spec.entities.merge'
    || document.command === 'spec.entities.rename'
    || document.command === 'spec.entities.reject'
    || document.command === 'spec.entities.promote'
  ) {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${document.entities?.length ?? 0} entities`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (
    document.command === 'spec.facts.propose'
    || document.command === 'spec.facts.add'
    || document.command === 'spec.facts.edit'
    || document.command === 'spec.facts.remove'
  ) {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${document.facts?.length ?? 0} facts`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.trace') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: trace ${document.id ?? ''}`];
    for (const link of document.chain ?? []) {
      const label = link.text ?? link.name ?? link.type ?? link.kind ?? '';
      lines.push(`  ${link.layer} ${link.id}${label === '' ? '' : ` ${label}`}`);
    }
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.status') {
    if (document.fault !== undefined || document.session === undefined || document.coverage === undefined) return '';
    const sentences = document.coverage.sentences;
    const lines = [`session ${document.session}: ${sentences.mapped.length} mapped, ${sentences.pending.length} pending, ${sentences.stale.length} stale`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command !== 'compare' || document.fault !== undefined) return '';
  const lines = [document.winner ? `winner: ${document.winner}` : 'no winner'];
  for (const candidate of document.candidates ?? []) {
    const failed = candidate.failures.map((failure) => failure.id).join(', ');
    lines.push(`  ${candidate.name}  ${candidate.passed}/${candidate.total}${failed ? `  failed ${failed}` : ''}`);
  }
  return lines.join('\n');
}
