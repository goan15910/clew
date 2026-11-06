// Short stdout for humans. `--json` skips this and prints the command document.
import type { CommandDocument, ConceptView, FrameView, SpecShowDocument, SpecTokenReadingView } from '../../application/documents.js';
import { formatIssues } from '../../application/documents.js';
import { ROLE_NAMES } from '../../domain/spec-frames.js';
import { CLEW_AUTHOR } from '../../domain/spec.js';

function list(ids: readonly string[]): string {
  return ids.length > 0 ? ` (${ids.join(', ')})` : '';
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function humanSummary(document: CommandDocument): string {
  if (document.command === 'upgrade') {
    if (document.action === 'current') return `clew ${document.from}: ${document.note ?? 'up to date'}`;
    if (document.action === 'would-install') return `would upgrade clew ${document.from} -> ${document.to} (${document.channel} channel)`;
    return `upgraded clew ${document.from} -> ${document.to} (${document.channel} channel)`;
  }
  if (document.command === 'chart.check') {
    if (document.ok && document.chart) {
      return `${document.chart.id}: schema valid, graph valid (${document.chart.vars.length} vars, ${document.chart.actions.length} actions)`;
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
  if (document.command === 'spec.sentences.add' || document.command === 'spec.sentences.edit' || document.command === 'spec.sentences.delete') {
    if (document.fault !== undefined || document.session === undefined || document.sentence === undefined) return '';
    const sentence = document.sentence;
    const text = sentence.latest?.text ?? sentence.original?.text ?? '';
    const lines = [`session ${document.session}: ${sentence.id} (${sentence.state}) ${text}`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.export') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const where = document.written === undefined ? '' : ` to ${document.written}`;
    return `session ${document.session}: exported ${document.sentences ?? 0} ${document.version ?? 'latest'} sentences${where}`;
  }
  if (document.command === 'spec.tag') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const tagger = document.tagger === undefined ? '' : ` (${document.tagger.name} ${document.tagger.version})`;
    const spanCount = document.spans?.length;
    const spanNote = spanCount === undefined ? '' : `, ${spanCount} spans`;
    const lines = [`session ${document.session}: tagged ${document.sentences?.length ?? 0} sentences${spanNote}${tagger}`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.spans.merge' || document.command === 'spec.spans.check') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [
      document.command === 'spec.spans.merge'
        ? `session ${document.session}: ${document.merged?.length ?? 0} merged, ${document.skipped?.length ?? 0} skipped, ${document.spans?.length ?? 0} live spans`
        : `session ${document.session}: ${document.skipped?.length ?? 0} unresolved windows, ${document.spans?.length ?? 0} live spans`,
    ];
    for (const window of document.skipped ?? []) {
      lines.push(`  ${window.kind} ${window.surfaces.join(' + ')} (${window.spanIds.join(', ')})`);
    }
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.concepts.list' || document.command === 'spec.concepts.group') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${countPhrase(document.concepts?.length ?? 0, 'concept', 'concepts')}`];
    const grouping = document.grouping;
    if (grouping !== undefined) lines.push(`  ${grouping.span} -> ${grouping.latest ?? 'no concept'} (derived ${grouping.original ?? 'no concept'})`);
    else lines.push(...conceptLines(document.concepts ?? []));
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.frames.set' || document.command === 'spec.frames.not-transition') {
    if (document.fault !== undefined || document.session === undefined || document.frame === undefined) return '';
    const lines = [`session ${document.session}: ${document.frame.id}`, ...frameLines([document.frame])];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.impact') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const impact = document.impact ?? [];
    const refined = impact.filter((entry) => entry.refined).length;
    const lines = [`session ${document.session}: ${document.sentence ?? ''} cited by ${countPhrase(impact.length, 'field or grouping', 'fields or groupings')} (${refined} refined), ${countPhrase(document.frames?.length ?? 0, 'frame', 'frames')}`];
    for (const entry of impact) {
      const where = entry.kind === 'grouping' ? `${entry.span ?? ''} concept` : `${entry.frame ?? ''} ${entry.role ?? ''}`;
      const value = entry.value === null ? 'no concept' : entry.value === 'unknown' ? '?' : typeof entry.value === 'string' ? entry.value : entry.value.text;
      lines.push(`  ${entry.refined ? 'refined' : 'derived'} ${where} = ${value}  <- ${entry.dependsOn.join(', ')}`);
    }
    return lines.join('\n');
  }
  if (document.command === 'spec.frames.list') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const lines = [`session ${document.session}: ${countPhrase(document.frames?.length ?? 0, 'frame', 'frames')}`, ...frameLines(document.frames ?? [])];
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
    const lines = [`session ${document.session}: ${sentences.mapped.length} mapped, ${sentences.pending.length} pending, ${sentences.deleted.length} deleted`];
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command === 'spec.session.list') {
    if (document.sessions.length === 0) return 'no spec sessions';
    const lines: string[] = [];
    for (const session of document.sessions) {
      const counts = session.summary;
      lines.push(`${session.id}  ${countPhrase(counts.sentences, 'sentence', 'sentences')}, ${countPhrase(counts.frames, 'frame', 'frames')}, ${countPhrase(counts.flows, 'flow', 'flows')}  ${session.updated}`);
    }
    return lines.join('\n');
  }
  if (document.command === 'spec.session.remove') {
    if (document.fault !== undefined || document.session === undefined) return '';
    return `removed session ${document.session}`;
  }
  if (document.command === 'spec.view') {
    if (document.fault !== undefined || document.session === undefined || document.htmlPath === undefined) return '';
    if (document.url !== undefined) {
      return `session ${document.session}: viewer at ${document.url}\n  ${document.htmlPath}\n  serving until Ctrl+C; reload picks up the latest session JSON`;
    }
    return `session ${document.session}: wrote ${document.htmlPath}\n  open with: clew spec view ${document.session} --open`;
  }
  if (document.command === 'chart.view' || document.command === 'workflows.view') {
    if (!document.ok || document.htmlPath === undefined) return '';
    const label = document.command === 'chart.view' ? 'chart' : 'workflows';
    if (document.url !== undefined) {
      return `${label} view at ${document.url}\n  ${document.htmlPath}\n  serving until Ctrl+C`;
    }
    const openHint = document.command === 'chart.view'
      ? `clew chart view ${document.chartFile ?? '<chart.yaml>'} --open`
      : `clew workflows view ${document.workflowsFile ?? '<workflows.yaml>'} --open`;
    return `${label} view: wrote ${document.htmlPath}\n  open with: ${openHint}`;
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
  'spec.show.sentences': true,
  'spec.show.tagged': true,
  'spec.show.tokens': true,
  'spec.show.spans': true,
  'spec.show.concepts': true,
  'spec.show.frames': true,
} satisfies Record<SpecShowDocument['command'], true>;

function isSpecShow(document: CommandDocument): document is SpecShowDocument {
  return document.command in SPEC_SHOW_COMMANDS;
}

function showSummary(document: SpecShowDocument): string {
  if (document.fault !== undefined || document.session === undefined) return '';
  switch (document.command) {
    case 'spec.show.sentences': {
      const sentences = document.sentences ?? [];
      const lines = [`session ${document.session}: ${countPhrase(sentences.length, 'sentence', 'sentences')}`];
      for (const sentence of sentences) {
        const flows = sentence.workflows.map((flow) => flow.id).join(' ');
        const state = sentence.state === 'original' ? '' : ` (${sentence.state})`;
        lines.push(`  ${sentence.id}${state} [${sentence.section}] ${sentence.text}${flows === '' ? '' : `  <- ${flows}`}`);
      }
      return lines.join('\n');
    }
    case 'spec.show.spans': {
      const spans = document.spans ?? [];
      const lines = [`session ${document.session}: ${countPhrase(spans.length, 'span', 'spans')}`];
      for (const span of spans) lines.push(`  ${span.id}  ${span.sentence}  ${span.surface}/${span.tags.join('|')}`);
      return lines.join('\n');
    }
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
    case 'spec.show.concepts': {
      const concepts = document.concepts ?? [];
      return [`session ${document.session}: ${countPhrase(concepts.length, 'concept', 'concepts')}`, ...conceptLines(concepts)].join('\n');
    }
    case 'spec.show.frames': {
      const frames = document.frames ?? [];
      return [`session ${document.session}: ${countPhrase(frames.length, 'frame', 'frames')}`, ...frameLines(frames)].join('\n');
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

function conceptLines(concepts: readonly ConceptView[]): string[] {
  const lines: string[] = [];
  for (const concept of concepts) {
    const members = concept.members.map((member) => `${member.span} ${member.surface}`).join(', ');
    lines.push(`  ${concept.id}  ${concept.canonical}  <- ${members}`);
  }
  return lines;
}

function frameLines(frames: readonly FrameView[]): string[] {
  const lines: string[] = [];
  for (const frame of frames) {
    const flags: string[] = [];
    if (frame.marker !== undefined) flags.push(frame.marker);
    if (frame.negated === true) flags.push('negated');
    if (frame.notTransition !== undefined) flags.push(`not a transition: ${frame.notTransition.reason}`);
    lines.push(`  ${frame.id}  ${frame.sentence}  "${frame.clause.text}"${flags.length === 0 ? '' : `  (${flags.join(', ')})`}`);
    const roles: string[] = [];
    for (const name of ROLE_NAMES) {
      const field = frame.roles[name];
      const role = field.latest.value;
      const last = field.history[field.history.length - 1];
      const mark = last === undefined ? '' : last.who === CLEW_AUTHOR ? ' (dropped)' : ' (refined)';
      roles.push(`${name}=${role === 'unknown' ? '?' : role.text}${mark}`);
    }
    lines.push(`    ${roles.join(' ')}`);
    const compiled = frame.compiled;
    if (compiled !== undefined) {
      const verb = compiled.kind === 'forbidden' ? 'forbids' : 'compiles to';
      const from = compiled.from === undefined ? '' : `${compiled.from} -> `;
      lines.push(`    ${verb} ${compiled.event}: ${compiled.object} ${from}${compiled.to} by ${compiled.actor}`);
    }
  }
  return lines;
}
