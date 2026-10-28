// Short stdout for humans. `--json` skips this and prints the command document.
import type { CommandDocument, SpecFactView, SpecShowDocument, SpecTokenReadingView } from '../../application/documents.js';
import { formatIssues } from '../../application/documents.js';

function list(ids: readonly string[]): string {
  return ids.length > 0 ? ` (${ids.join(', ')})` : '';
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
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
    if (document.views?.heatmap !== undefined) lines.push(`  heatmap: ${document.views.heatmap}`);
    if (document.views?.replays !== undefined && document.views.replays.length > 0) {
      const files: string[] = [];
      for (const replay of document.views.replays) files.push(replay.file);
      lines.push(`  replay: ${files.join(', ')}`);
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
  if (document.command === 'spec.graph.build' || document.command === 'spec.graph.split' || document.command === 'spec.graph.group') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${document.graph?.states.length ?? 0} states, ${document.graph?.transitions.length ?? 0} transitions, ${document.flows?.length ?? 0} flows`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.emit') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const name = document.id ?? 'workflow set';
    const head = document.written !== undefined
      ? `session ${document.session}: wrote ${document.written} (${name})`
      : document.dryRun === true
        ? `session ${document.session}: dry run, ${name} not written`
        : `session ${document.session}: ${name} not written`;
    const lines = [head];
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
  if (document.command === 'spec.session.list') {
    if (document.sessions.length === 0) return 'no spec sessions';
    const lines: string[] = [];
    for (const session of document.sessions) {
      const counts = session.summary;
      lines.push(`${session.id}  ${session.specPath}  ${countPhrase(counts.sentences, 'sentence', 'sentences')}, ${countPhrase(counts.facts, 'fact', 'facts')}, ${countPhrase(counts.flows, 'flow', 'flows')}  ${session.updated}`);
    }
    return lines.join('\n');
  }
  if (document.command === 'spec.session.remove') {
    if (document.fault !== undefined || document.session === undefined) return '';
    return `removed session ${document.session}`;
  }
  if (isSpecShow(document)) return showSummary(document);
  if (document.command !== 'compare' || document.fault !== undefined) return '';
  const lines = [document.winner ? `winner: ${document.winner}` : 'no winner'];
  for (const candidate of document.candidates ?? []) {
    const failed = candidate.failures.map((failure) => failure.id).join(', ');
    lines.push(`  ${candidate.name}  ${candidate.passed}/${candidate.total}${failed ? `  failed ${failed}` : ''}`);
  }
  return lines.join('\n');
}

const SPEC_SHOW_COMMANDS = {
  'spec.show.tagged': true,
  'spec.show.tokens': true,
  'spec.show.entities': true,
  'spec.show.facts': true,
} satisfies Record<SpecShowDocument['command'], true>;

function isSpecShow(document: CommandDocument): document is SpecShowDocument {
  return document.command in SPEC_SHOW_COMMANDS;
}

function showSummary(document: SpecShowDocument): string {
  if (document.fault !== undefined || document.session === undefined) return '';
  switch (document.command) {
    case 'spec.show.tagged': {
      const sentences = document.sentences ?? [];
      const lines = [`session ${document.session}: ${countPhrase(sentences.length, 'tagged sentence', 'tagged sentences')}`];
      for (const sentence of sentences) {
        lines.push(`  ${sentence.id} [${sentence.section}] ${sentence.text}`);
        const tokens: string[] = [];
        for (const token of sentence.tokens) tokens.push(`${token.text}/${token.tags.join('|')}`);
        if (tokens.length > 0) lines.push(`    ${tokens.join(' ')}`);
      }
      return lines.join('\n');
    }
    case 'spec.show.tokens': {
      const tokens = document.tokens ?? [];
      let total = 0;
      for (const token of tokens) total += token.count;
      const lines = [`session ${document.session}: ${countPhrase(tokens.length, 'unique token', 'unique tokens')} from ${countPhrase(total, 'token', 'tokens')}`];
      for (const token of tokens) {
        const readings: string[] = [];
        for (const reading of token.readings) readings.push(readingText(reading));
        lines.push(`  ${token.text}  ${token.count}  ${readings.join('; ')}`);
      }
      return lines.join('\n');
    }
    case 'spec.show.entities': {
      const entities = document.entities ?? [];
      const lines = [`session ${document.session}: ${countPhrase(entities.length, 'entity', 'entities')}`];
      for (const entity of entities) {
        const label = entity.name ?? entity.text ?? '';
        lines.push(`  ${entity.id}  ${entity.status}  ${label}  <- ${entity.sources.join(' ')}`);
      }
      return lines.join('\n');
    }
    case 'spec.show.facts': {
      const facts = document.facts ?? [];
      const lines = [`session ${document.session}: ${countPhrase(facts.length, 'fact', 'facts')}`];
      for (const fact of facts) lines.push(factLine(fact));
      return lines.join('\n');
    }
    default: {
      const unexpected: never = document;
      return unexpected;
    }
  }
}

function readingText(reading: SpecTokenReadingView): string {
  return `${reading.tags.join('|')} ${reading.tokens.join(' ')}`;
}

function factLine(fact: SpecFactView): string {
  const fields: string[] = [];
  if (fact.actor !== undefined) fields.push(`actor=${fact.actor}`);
  if (fact.action !== undefined) fields.push(`action=${fact.action}`);
  if (fact.object !== undefined) fields.push(`object=${fact.object}`);
  if (fact.from !== undefined) fields.push(`from=${fact.from === null ? 'null' : fact.from}`);
  if (fact.to !== undefined) fields.push(`to=${fact.to}`);
  if (fact.condition !== undefined) fields.push(`condition=${fact.condition}`);
  if (fact.state !== undefined) fields.push(`state=${fact.state}`);
  if (fact.note !== undefined) fields.push(`note=${fact.note}`);
  const head = [fact.id, fact.type, ...fields, String(fact.confidence), fact.status].join(' ');
  return `  ${head} <- ${fact.sources.join(' ')}`;
}
