// Short stdout for humans. `--json` skips this and prints the command document.
import type { SpecProjectionDocument } from '../../application/documents.js';
import { projectionSummary } from './projection-summary.js';
import type { CommandDocument, ConceptView, SpecCanonDocument, SpecWorkflowDocument, SpecDiffDocument, SpecMilestoneDocument, FrameReachView, FrameView, SpecShowDocument, SpecTokenReadingView } from '../../application/documents.js';
import type { ActionDiff, LexiconDiff, Milestone, VersionCounts } from '../../domain/spec-versions.js';
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
    const version = document.version ?? 'latest';
    const which = version === 'original' || version === 'latest' ? `${version} sentences` : `sentences as of ${version}`;
    return `session ${document.session}: exported ${document.sentences ?? 0} ${which}${where}`;
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
  if (document.command === 'spec.tla.export') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const todo = document.todo ?? [];
    const written = document.written ?? [];
    const head = written.length > 0
      ? `session ${document.session}: wrote ${written[0] ?? ''} (frames module ${document.module ?? ''})`
      : `session ${document.session}: dry run, frames module ${document.module ?? ''} not written`;
    const lines = [head, `  ${countPhrase(document.actions?.length ?? 0, 'frame action', 'frame actions')}, ${countPhrase(todo.length, 'frame does', 'frames do')} not compile${list(todo)}`];
    for (const file of written.slice(1)) lines.push(`  wrote ${file}`);
    const model = document.model;
    if (model?.written !== undefined) lines.push(`  wrote ${model.written} (model ${model.module}, yours to edit)`);
    if (model?.kept === true) lines.push(`  kept the existing model ${model.module}`);
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    if (written.length === 0 && document.tla !== undefined) {
      lines.push('', document.tla.trimEnd());
      if (model !== undefined) lines.push('', model.tla.trimEnd());
      if (document.check !== undefined) lines.push('', document.check.tla.trimEnd());
    }
    return lines.join('\n');
  }
  if (document.command === 'spec.tla.check') {
    if (document.fault !== undefined || document.session === undefined) return '';
    const stale = (document.files ?? []).filter((entry) => entry.state !== 'current').length;
    const head = document.framesModule === undefined
      ? `session ${document.session}: ${document.file ?? ''} (module ${document.module ?? ''}) is not tied to the frames`
      : `session ${document.session}: ${document.file ?? ''} (module ${document.module ?? ''}) maps onto ${document.framesModule}, ${stale === 0 ? 'export is current' : `${countPhrase(stale, 'file', 'files')} out of date`}`;
    const lines = [head];
    for (const entry of document.files ?? []) lines.push(`  ${entry.state.padEnd(7)}  ${entry.role.padEnd(15)}  ${entry.file}`);
    if (document.run !== undefined) {
      lines.push('  run TLC yourself:', `    ${document.run.refinement}`, `    ${document.run.coverage}`);
      lines.push('  TLC prints each line below as new states : steps taken; one that ends in :0 is a frame action the model never takes:');
    }
    for (const action of document.actions ?? []) {
      lines.push(`    ${action.cover ?? action.action}  ${[action.frame, ...action.restatedBy].join(', ')}  "${action.clause}"`);
    }
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    return lines.join('\n');
  }
  if (document.command.startsWith('spec.canon.')) return canonSummary(document as SpecCanonDocument);
  if (document.command.startsWith('spec.workflow.')) return workflowSummary(document as SpecWorkflowDocument);
  if (document.command.startsWith('spec.projection.')) return projectionSummary(document as SpecProjectionDocument);
  if (document.command.startsWith('spec.milestone.')) return milestoneSummary(document as SpecMilestoneDocument);
  if (document.command === 'spec.diff') return diffSummary(document);
  if (document.command === 'spec.status') {
    if (document.fault !== undefined || document.session === undefined || document.coverage === undefined) return '';
    const sentences = document.coverage.sentences;
    const lines = [`session ${document.session}: ${sentences.mapped.length} mapped, ${sentences.pending.length} pending, ${sentences.deleted.length} deleted`];
    for (const clause of document.clauses ?? []) lines.push(`  clause ${clause.frame} ${clause.event} ${reachText(clause)}`);
    for (const finding of document.findings) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
    if (document.canon !== undefined) {
      lines.push(`  canonical gate: ${document.canon.accepted.length} pass, ${document.canon.dangling.length} dangling`);
      canonDangling({ command: 'spec.canon.check', ok: true, dangling: document.canon.dangling, findings: [], issues: [] }, lines);
    }
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
      lines.push(`    when ${compiled.when}`);
    }
    if (frame.reach !== undefined) lines.push(`    ${reachText(frame.reach)}`);
  }
  return lines;
}

function reachText(reach: FrameReachView): string {
  if (reach.status === 'reachable') return `reachable via ${(reach.witness ?? []).join(' → ')}`;
  if (reach.status === 'unreachable') return `unreachable: ${(reach.blockedBy ?? []).length === 0 ? 'its guard never holds' : (reach.blockedBy ?? []).join(', ')}`;
  return 'unexplored: the search reached its state bound';
}

function canonDangling(document: SpecCanonDocument, lines: string[]): void {
  for (const view of document.dangling ?? []) {
    lines.push(`  dangling ${view.id}: "${view.text}"`);
    for (const diagnostic of view.diagnostics) lines.push(`    ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${diagnostic.found === '' ? '' : ` at "${diagnostic.found}"`}`);
    const draft = view.draft;
    if (draft !== undefined) {
      const tags = [draft.parses ? 'passes the gate' : 'does not pass yet', draft.needsConfirm ? 'guesses: confirm' : '', draft.needsInput ? 'fill in the placeholder' : '', draft.dropped.length > 0 ? `leaves out ${draft.dropped.join(', ')}` : ''].filter((tag) => tag !== '');
      lines.push(`    draft: "${draft.text}" (${tags.join('; ')})`);
    }
  }
}

function canonSummary(document: SpecCanonDocument): string {
  if (!document.ok && document.tlc === undefined) return '';
  const lines: string[] = [];
  const session = document.session === undefined ? '' : `session ${document.session}: `;
  switch (document.command) {
    case 'spec.canon.lexicon':
    case 'spec.canon.check': {
      const verb = document.command === 'spec.canon.lexicon' ? 'lexicon set; ' : '';
      lines.push(`${session}${verb}${countPhrase(document.accepted?.length ?? 0, 'sentence passes', 'sentences pass')} the gate, ${countPhrase(document.dangling?.length ?? 0, 'sentence is', 'sentences are')} dangling`);
      canonDangling(document, lines);
      for (const action of document.actions ?? []) lines.push(`  action ${action.name} (${action.sentence}): ${action.actor} ${action.event} ${action.object}`);
      for (const finding of document.canonFindings ?? []) lines.push(`  ${finding.severity} ${finding.code}${finding.sentence === undefined ? '' : ` ${finding.sentence}`}: ${finding.message}`);
      break;
    }
    case 'spec.canon.accept': {
      const sentence = document.sentence;
      if (sentence === undefined) return '';
      lines.push(`${session}${sentence.id} now reads "${sentence.to}"`, `  was "${sentence.from}"`);
      for (const note of sentence.notes) lines.push(`  note: ${note}`);
      break;
    }
    case 'spec.canon.merge': {
      if (document.merged === undefined) return '';
      lines.push(`${session}${document.merged.from.join(', ')} merged into ${document.merged.into}`);
      break;
    }
    case 'spec.canon.export': {
      const written = (document.files ?? []).filter((file) => file.written);
      lines.push(written.length > 0 ? `${session}wrote ${countPhrase(written.length, 'file', 'files')}` : `${session}dry run, nothing written`);
      for (const file of document.files ?? []) lines.push(`  ${file.written ? 'wrote' : 'kept '} ${file.path}`);
      lines.push(`  ${countPhrase(document.actions?.length ?? 0, 'action', 'actions')} from ${countPhrase(document.accepted?.length ?? 0, 'accepted sentence', 'accepted sentences')}; ${countPhrase(document.dangling?.length ?? 0, 'dangling sentence', 'dangling sentences')} left out`);
      for (const finding of document.canonFindings ?? []) lines.push(`  ${finding.severity} ${finding.code}${finding.sentence === undefined ? '' : ` ${finding.sentence}`}: ${finding.message}`);
      if (document.run !== undefined) lines.push('  run TLC:', `    ${document.run.blocks}`, `    ${document.run.refinement}`, `    ${document.run.coverage}`);
      if (document.tla !== undefined) lines.push('', document.tla.blocks.trimEnd());
      break;
    }
    case 'spec.canon.tlc': {
      const tlc = document.tlc;
      if (tlc === undefined) return '';
      const states = tlc.states === undefined ? '' : ` (${tlc.states.distinct} distinct states${tlc.states.depth === undefined ? '' : `, depth ${tlc.states.depth}`})`;
      lines.push(`TLC: ${tlc.status}${states}`);
      if (tlc.violation !== undefined) lines.push(`  ${tlc.violation.kind}${tlc.violation.name === undefined ? '' : ` ${tlc.violation.name}`}${tlc.violation.sentence === undefined ? '' : ` (sentence ${tlc.violation.sentence})`}: ${tlc.violation.message}`);
      for (const step of tlc.trace ?? []) lines.push(`  ${step.step}. ${step.action ?? 'Init'}${step.sentence === undefined ? '' : ` (${step.sentence})`}: ${step.state.join(', ')}`);
      for (const row of tlc.coverage ?? []) lines.push(`  cover ${row.action}${row.sentence === undefined ? '' : ` (${row.sentence})`}: ${row.distinct}:${row.total}${row.total === 0 ? '  never taken' : ''}`);
      for (const error of tlc.errors ?? []) lines.push(`  error: ${error}`);
      if (tlc.status === 'error' && tlc.output !== undefined) lines.push('', tlc.output);
      break;
    }
  }
  return lines.join('\n');
}

function arrow(before: number | undefined, after: number | undefined): string {
  return `${before === undefined ? '-' : String(before)} -> ${after === undefined ? '-' : String(after)}`;
}

/** The digest lines shared by a milestone and a diff: counts before and after, in the proposal's layout. */
function countLines(before: VersionCounts, after: VersionCounts, added: number, deleted: number, edited: number, lines: string[], actions?: ActionDiff): void {
  lines.push(`  sentences  ${arrow(before.live, after.live)} live (${added} added, ${deleted} deleted, ${edited} edited)`);
  if (before.accepted !== undefined || after.accepted !== undefined) {
    lines.push(`  gate       ${arrow(before.accepted, after.accepted)} pass, ${arrow(before.dangling, after.dangling)} dangling`);
    const changed = actions === undefined ? '' : ` (${actions.added.length} new, ${actions.removed.length} removed, ${actions.changed.length} changed)`;
    lines.push(`  actions    ${arrow(before.actions, after.actions)}${changed}`);
  }
  if (before.frames !== undefined || after.frames !== undefined) lines.push(`  frames     ${arrow(before.frames, after.frames)}`);
}

function lexiconLine(diff: LexiconDiff | undefined): string | undefined {
  if (diff === undefined) return undefined;
  const parts: string[] = [];
  for (const field of ['actors', 'terms', 'states', 'verbs', 'fixed'] as const) {
    const change = diff[field];
    if (change === undefined) continue;
    const quote = (word: string): string => (word.includes(' ') ? `"${word}"` : word);
    const words = [...change.added.map((word) => `+${quote(word)}`), ...change.removed.map((word) => `-${quote(word)}`)];
    parts.push(`${field} ${words.join(' ')}`);
  }
  const instances = (diff.instances ?? []).map((change) => `${change.noun} ${change.from ?? 'default'} -> ${change.to ?? 'default'}`);
  if (instances.length > 0) parts.push(`instances ${instances.join(', ')}`);
  return `  lexicon    ${parts.join('; ')}`;
}

function milestoneHead(milestone: Milestone): string {
  const count = milestone.history.to - milestone.history.from;
  const lines = count === 0 ? 'no history lines' : count === 1 ? `history line ${milestone.history.to}` : `history lines ${milestone.history.from + 1}-${milestone.history.to}`;
  const canon = milestone.canon.to > milestone.canon.from ? `, ${countPhrase(milestone.canon.to - milestone.canon.from, 'canonical change', 'canonical changes')}` : '';
  return `${milestone.id} "${milestone.title}" by ${milestone.who}, ${milestone.at} (${lines}${canon}, since ${milestone.previous})`;
}

function milestoneDigest(milestone: Milestone, lines: string[]): void {
  const digest = milestone.digest;
  countLines(digest.before, digest.after, digest.added.length, digest.deleted.length, digest.edited.length, lines, digest.actions);
  const lexicon = lexiconLine(digest.lexicon);
  if (lexicon !== undefined) lines.push(lexicon);
  const commands = Object.entries(digest.commands).map(([command, count]) => `${command.replace(/^spec\./, '')} ${count}`);
  if (commands.length > 0) lines.push(`  commands   ${commands.join(', ')}`);
}

function milestoneSummary(document: SpecMilestoneDocument): string {
  if (!document.ok) return '';
  const lines: string[] = [];
  const session = document.session === undefined ? '' : `session ${document.session}: `;
  if (document.command === 'spec.milestone.list') {
    const milestones = document.milestones ?? [];
    lines.push(`${session}${countPhrase(milestones.length, 'milestone', 'milestones')}`);
    for (const milestone of milestones) {
      const digest = milestone.digest;
      const gate = digest.after.accepted === undefined ? '' : `, ${digest.after.accepted} pass, ${digest.after.dangling ?? 0} dangling, ${digest.after.actions ?? 0} actions`;
      lines.push(`  ${milestone.id}  ${milestone.at}  ${milestone.title}  (${digest.after.live} live: +${digest.added.length} -${digest.deleted.length} ~${digest.edited.length}${gate})`);
    }
    const pending = document.pending;
    if (pending !== undefined) {
      lines.push(pending.history + pending.canon === 0
        ? `  nothing changed since ${pending.since}`
        : `  not in a milestone yet: ${countPhrase(pending.history, 'history line', 'history lines')} and ${countPhrase(pending.canon, 'canonical change', 'canonical changes')} since ${pending.since}`);
    }
    return lines.join('\n');
  }
  const milestone = document.milestone;
  if (milestone === undefined) return '';
  lines.push(`${session}${document.command === 'spec.milestone.close' ? 'closed ' : ''}${milestoneHead(milestone)}`);
  lines.push(`  goal: ${milestone.goal}`);
  for (const decision of milestone.decisions) lines.push(`  decision: ${decision}`);
  milestoneDigest(milestone, lines);
  const digest = milestone.digest;
  if (document.command === 'spec.milestone.show') {
    if (digest.added.length > 0) lines.push(`  added: ${digest.added.join(', ')}`);
    if (digest.deleted.length > 0) lines.push(`  deleted: ${digest.deleted.join(', ')}`);
    if (digest.edited.length > 0) lines.push(`  edited: ${digest.edited.join(', ')}`);
    if (digest.actions !== undefined) {
      for (const [label, names] of [['new actions', digest.actions.added], ['removed actions', digest.actions.removed], ['changed actions', digest.actions.changed]] as const) {
        if (names.length > 0) lines.push(`  ${label}: ${names.join(', ')}`);
      }
    }
  }
  for (const change of document.changes ?? []) {
    const where = change.log === 'history' ? `history ${change.line}` : `canon ${change.line}`;
    const ids = change.ids.length === 0 ? '' : ` ${change.ids.join(', ')}`;
    lines.push(`  ${where}  ${change.at}  ${change.command.replace(/^spec\./, '')}${ids}${change.who === undefined ? '' : ` by ${change.who}`}${change.reason === undefined ? '' : `: ${change.reason}`}`);
  }
  return lines.join('\n');
}

function diffSummary(document: SpecDiffDocument): string {
  if (!document.ok || document.counts === undefined || document.sentences === undefined) return '';
  const sentences = document.sentences;
  const lines = [`session ${document.session ?? ''}: ${document.from ?? ''} -> ${document.to ?? ''}`];
  countLines(document.counts.from, document.counts.to, sentences.added.length, sentences.deleted.length, sentences.edited.length, lines, document.actions);
  if (document.gatedWith?.from !== undefined) lines.push(`  (${document.from ?? ''} has no lexicon; gated with ${document.gatedWith.from}'s)`);
  if (document.gatedWith?.to !== undefined) lines.push(`  (${document.to ?? ''} has no lexicon; gated with ${document.gatedWith.to}'s)`);
  const lexicon = lexiconLine(document.lexicon);
  if (lexicon !== undefined) lines.push(lexicon);
  const why = (revisions: readonly { who: string; reason: string }[]): string[] => revisions.map((revision) => `      why (${revision.who}): ${revision.reason}`);
  for (const item of sentences.added) lines.push(`  + ${item.id}: "${item.text}"`, ...why(item.revisions));
  for (const item of sentences.deleted) lines.push(`  - ${item.id}: "${item.text}"`, ...why(item.revisions));
  for (const item of sentences.edited) {
    lines.push(`  ~ ${item.id}: "${item.from}"`, `      now "${item.to}"`);
    if (item.sections !== undefined) lines.push(`      moved from "${item.sections.from}" to "${item.sections.to}"`);
    lines.push(...why(item.revisions));
  }
  const actions = document.actions;
  if (actions !== undefined) {
    for (const [label, names] of [['new action', actions.added], ['removed action', actions.removed], ['changed action', actions.changed]] as const) {
      for (const name of names) lines.push(`  ${label} ${name}`);
    }
  }
  return lines.join('\n');
}

function workflowSummary(document: SpecWorkflowDocument): string {
  if (!document.ok) return '';
  const lines: string[] = [];
  const session = document.session === undefined ? '' : `session ${document.session}: `;
  const workflows = document.workflows ?? [];
  switch (document.command) {
    case 'spec.workflow.set': {
      const workflow = workflows[0];
      if (workflow === undefined) return '';
      lines.push(`${session}${workflow.id} "${workflow.title}" ${workflow.deleted === true ? 'deleted' : `must be ${workflow.expect} (${workflow.mode})`}`);
      return lines.join('\n');
    }
    case 'spec.workflow.add':
      lines.push(`${session}added ${(document.added ?? []).join(', ')}`);
      for (const note of document.skipped ?? []) lines.push(`  not a step (no workflow heading): "${note.text}"`);
      break;
    case 'spec.workflow.accept':
      if (document.accepted !== undefined) lines.push(`${session}${document.accepted.id} now reads "${document.accepted.to}"`, `  was "${document.accepted.from}"`);
      break;
    case 'spec.workflow.edit':
    case 'spec.workflow.step':
    case 'spec.workflow.delete':
      if (document.sentence !== undefined) lines.push(`${session}${document.sentence} ${document.command === 'spec.workflow.delete' ? 'deleted' : 'written'}`);
      break;
    default:
      lines.push(`${session}${countPhrase(workflows.filter((workflow) => workflow.ready).length, 'workflow is', 'workflows are')} ready, ${countPhrase(workflows.filter((workflow) => !workflow.ready).length, 'is', 'are')} not`);
  }
  if ((document.specDangling ?? []).length > 0) lines.push(`  the spec has dangling sentences the model leaves out: ${(document.specDangling ?? []).join(', ')}`);
  for (const workflow of workflows) {
    lines.push(`  ${workflow.id} "${workflow.title}" must be ${workflow.expect} (${workflow.mode}): ${workflow.ready ? 'ready' : 'not ready'}`);
    for (const sentence of workflow.sentences) {
      const role = sentence.step === undefined ? sentence.role : `step ${sentence.step}`;
      const cites = sentence.cites.length === 0 ? '' : `  cites ${sentence.cites.map((cite) => `${cite.action} (${cite.sentence})`).join(', ')}`;
      lines.push(`    ${sentence.id} ${role}${sentence.status === 'dangling' ? ' DANGLING' : ''}: "${sentence.text}"${cites}`);
      for (const diagnostic of sentence.diagnostics) lines.push(`      ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${diagnostic.found === '' ? '' : ` at "${diagnostic.found}"`}`);
      const draft = sentence.draft;
      if (draft !== undefined) lines.push(`      draft: "${draft.text}" (${draft.parses ? 'passes the gate' : 'does not pass yet'}${draft.needsConfirm ? '; guesses: confirm' : ''})`);
    }
    for (const finding of workflow.findings) lines.push(`    ${finding.severity} ${finding.code}${finding.sentence === undefined ? '' : ` ${finding.sentence}`}: ${finding.message}`);
  }
  for (const file of document.files ?? []) lines.push(`  wrote ${file.path}`);
  for (const run of document.run ?? []) lines.push(`  run ${run.workflow}: ${run.command}`);
  for (const run of document.runs ?? []) {
    lines.push(`  ${run.workflow} ${run.outcome.toUpperCase()}: ${run.message ?? ''}`);
    for (const step of run.path ?? []) {
      const label = step.kind === 'step' ? `step ${String(step.step)}` : step.kind;
      lines.push(`    ${String(step.state)}. ${label}${step.action === undefined ? '' : ` ${step.action}`}${step.specSentence === undefined ? '' : ` (${step.specSentence})`}: ${step.values.join(', ')}`);
    }
    if (run.stopsAt !== undefined) {
      lines.push(`    stops at ${run.stopsAt.sentence} step ${String(run.stopsAt.step)}: "${run.stopsAt.text}"`);
      for (const cite of run.stopsAt.cites) lines.push(`      ${cite.action} (${cite.sentence}) needs ${cite.guards.length === 0 ? 'nothing' : cite.guards.join(' /\\ ')}`);
    }
  }
  return lines.join('\n');
}
