// The plain-text summary of the clew spec projection commands. --json prints the whole document instead.
import type { ProjectionRecordView, SpecProjectionDocument, TlcResultView } from '../../application/documents.js';

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function tlcLines(tlc: TlcResultView | undefined, lines: string[]): void {
  if (tlc === undefined) return;
  const states = tlc.states === undefined ? '' : ` (${tlc.states.distinct} distinct states${tlc.states.depth === undefined ? '' : `, depth ${tlc.states.depth}`})`;
  lines.push(`  TLC: ${tlc.status}${states}`);
  if (tlc.violation !== undefined) lines.push(`  ${tlc.violation.kind}${tlc.violation.name === undefined ? '' : ` ${tlc.violation.name}`}: ${tlc.violation.message}`);
  for (const step of tlc.trace ?? []) lines.push(`  ${step.step}. ${step.action ?? 'Init'}${step.sentence === undefined ? '' : ` (${step.sentence})`}: ${step.state.join(', ')}`);
  for (const error of tlc.errors ?? []) lines.push(`  error: ${error}`);
}

function recordLines(record: ProjectionRecordView, lines: string[]): void {
  lines.push(`  ${record.name}  ${record.status}  keeps ${record.keep.join(', ')}${record.candidate === undefined ? '' : `  (candidate ${record.candidate})`}`);
  if (record.check !== undefined) {
    const never = record.check.neverTaken === undefined || record.check.neverTaken.length === 0 ? '' : `; never taken: ${record.check.neverTaken.join(', ')}`;
    lines.push(`    check ${record.check.at}: ${record.check.status}, ${record.check.view} against ${record.check.model}${record.check.states === undefined ? '' : `, ${record.check.states} states`}${never}${record.check.current ? '' : '; the files changed since: check again'}`);
  }
  for (const entry of record.history) lines.push(`    ${entry.at} ${entry.who} ${entry.action}: ${entry.reason}${entry.note === undefined ? '' : ` (${entry.note})`}`);
}

export function projectionSummary(document: SpecProjectionDocument): string {
  if (!document.ok && document.tlc === undefined) return '';
  const lines: string[] = [];
  switch (document.command) {
    case 'spec.projection.analyze': {
      const { analysis } = document;
      if (analysis === undefined) return '';
      lines.push(`${analysis.module}: ${analysis.variables.length} variables, ${analysis.actions.length} actions, ${analysis.components.length} independent ${analysis.components.length === 1 ? 'part' : 'parts'}`);
      lines.push('variables (writers / readers, depends on):');
      for (const variable of analysis.variables) lines.push(`  ${variable.name}  ${variable.writers.length} / ${variable.readers.length}${variable.dependsOn.length === 0 ? '' : `  <- ${variable.dependsOn.join(', ')}`}`);
      lines.push('candidates:');
      const scores = new Map((document.scored ?? []).map((score) => [score.candidate, score]));
      for (const candidate of analysis.candidates) {
        const score = scores.get(candidate.id);
        const size = score === undefined ? '' : `  [${count(score.states, 'state', 'states')}, ${count(score.edges, 'step', 'steps')}, ${percent(score.exactness)} certain]`;
        lines.push(`  ${candidate.id} ${candidate.kind} ${candidate.exact ? 'exact' : 'lossy'}: ${candidate.keep.join(', ')}${size}`);
        lines.push(`      ${candidate.why}`);
      }
      const { evaluation } = document;
      if (evaluation !== undefined) {
        lines.push(`keep ${evaluation.keep.join(', ')}: ${evaluation.closed ? 'exact' : 'lossy'}; ${evaluation.actions.length} actions stay, ${evaluation.invisible} vanish`);
        for (const entry of evaluation.weakened) lines.push(`  ${entry.action} reads hidden ${entry.hidden.join(', ')}`);
        const score = scores.get('keep');
        if (score !== undefined) lines.push(`  on the state graph: ${score.states} states, ${score.edges} steps, ${score.certain} certain (${percent(score.exactness)})`);
      }
      const { stats } = document;
      if (stats !== undefined) {
        lines.push(`state graph: ${stats.states} states, ${stats.edges} steps`);
        const parts = (document.scored ?? []).filter((score) => score.candidate.startsWith('part:'));
        if (parts.length > 0) {
          lines.push('one instance alone:');
          for (const part of parts) lines.push(`  ${part.keep.join(', ')}  [${count(part.states, 'state', 'states')}, ${count(part.edges, 'step', 'steps')}, ${percent(part.exactness)} certain]`);
        }
        lines.push('pairs (correlation over states, share of steps that change both):');
        for (const pair of stats.pairs.slice(0, 12)) {
          const never = pair.neverCount === 0 ? '' : `  never together: ${pair.never.slice(0, 2).map((entry) => `${entry.a} with ${entry.b}`).join('; ')}${pair.neverCount > 2 ? ` (+${pair.neverCount - 2})` : ''}`;
          lines.push(`  ${pair.a} ~ ${pair.b}  ${pair.correlation.toFixed(2)}  ${percent(pair.changeTogether)}${never}`);
        }
      }
      for (const note of analysis.notes) lines.push(`note: ${note}`);
      for (const file of document.files ?? []) lines.push(`  wrote ${file.path}`);
      break;
    }
    case 'spec.projection.draft': {
      const { draft } = document;
      if (draft === undefined) return '';
      lines.push(`${draft.module}: keeps ${draft.keep.join(', ')}; hides ${draft.hidden.length} ${draft.hidden.length === 1 ? 'variable' : 'variables'}`);
      lines.push(`  kept as written: ${draft.kept.length}; kept without a hidden guard: ${draft.weakened.length}; removed: ${draft.removed.length}`);
      for (const entry of draft.weakened) lines.push(`  weakened ${entry.action}: dropped ${entry.dropped.join('; ')}`);
      for (const entry of draft.needsInput) lines.push(`  needs input: ${entry}`);
      if (draft.omitted.length > 0) lines.push(`  omitted definitions: ${draft.omitted.join(', ')}`);
      for (const file of document.files ?? []) lines.push(`  wrote ${file.path}`);
      if (document.tla !== undefined) lines.push('', document.tla.view.trimEnd());
      break;
    }
    case 'spec.projection.check': {
      const { check } = document;
      if (check === undefined) return '';
      lines.push(`${check.model} ${check.implements ? 'implements' : 'does not implement'} the view ${check.view}`);
      const renamed = check.mapping.filter((entry) => entry.variable !== entry.expression);
      for (const entry of renamed) lines.push(`  ${entry.variable} <- ${entry.expression}`);
      tlcLines(document.tlc, lines);
      if (check.neverTaken !== undefined) {
        lines.push(check.neverTaken.length === 0 ? `  the model takes every one of the view's ${check.steps.length} steps` : `  the model never takes: ${check.neverTaken.join(', ')}`);
      }
      for (const record of document.projections ?? []) recordLines(record, lines);
      break;
    }
    case 'spec.projection.dump': {
      const { graph } = document;
      if (graph !== undefined) lines.push(`state graph: ${graph.states} states, ${graph.edges} steps, variables ${graph.variables.join(', ')}`);
      for (const file of document.files ?? []) lines.push(`  wrote ${file.path}`);
      tlcLines(document.tlc, lines);
      break;
    }
    case 'spec.projection.explore':
    case 'spec.projection.render': {
      const { view, graph } = document;
      if (view === undefined) return '';
      const hides = graph !== undefined && view.fullStates > view.states;
      lines.push(`view of ${view.variables.join(', ')}: ${view.states} states, ${view.edges} steps${hides ? ` (from ${view.fullStates} states, ${view.fullEdges} steps)` : ''}, ${percent(view.exactness)} certain`);
      for (const edge of view.possible) lines.push(`  possible: ${edge.from} -${edge.action}-> ${edge.to}  (${edge.sources} of ${edge.of} states)`);
      if (view.terminal.length > 0) lines.push(`  no step leaves: ${view.terminal.join('; ')}`);
      if (view.pathLength !== undefined) lines.push(`  highlighted path: ${view.pathLength} steps`);
      for (const file of document.files ?? []) lines.push(`  wrote ${file.path}`);
      break;
    }
    case 'spec.projection.propose':
    case 'spec.projection.finalize':
    case 'spec.projection.list': {
      lines.push(`session ${document.session ?? ''}: ${(document.projections ?? []).length} ${(document.projections ?? []).length === 1 ? 'projection' : 'projections'}`);
      for (const record of document.projections ?? []) recordLines(record, lines);
      break;
    }
  }
  return lines.join('\n');
}
