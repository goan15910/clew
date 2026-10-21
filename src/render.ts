// Graphviz DOT and Mermaid text. File output and `dot` live in cli.ts.
import type { Model, State } from './model.js';
import type { WorkflowResult } from './verify.js';

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'Helvetica';
const PASS = '#1a7f37';
const FAIL = '#cf222e';
const HL = '#0969da';

function stateLabel(state: State): string {
  const fields = state.data.map((field) => `${esc(field.name)}: ${esc(field.type)}`);
  if (fields.length === 0) return `<<B>${esc(state.label)}</B>>`;
  return `<<B>${esc(state.label)}</B><BR/><FONT POINT-SIZE="10" COLOR="#57606a">${fields.join('<BR/>')}</FONT>>`;
}

function edgeCaption(actor: string, guard: string | undefined): string {
  return guard === undefined ? actor : `${actor}; if ${guard}`;
}

/** Full state chart. If `highlight` is given, that workflow's path is numbered. */
export function chartDot(model: Model, title: string, highlight?: WorkflowResult): string {
  const used = new Map<string, number[]>();
  const visited = new Set<string>();
  if (highlight) {
    visited.add(model.initial);
    for (const step of highlight.trace) {
      if (step.accepted && step.to) {
        const key = `${step.from}|${step.event}`;
        const prior = used.get(key) ?? [];
        prior.push(step.n);
        used.set(key, prior);
        visited.add(step.to);
      }
    }
  }
  const lines: string[] = [];
  lines.push('digraph G {', '  rankdir=LR; pad=0.3; nodesep=0.5; ranksep=0.9; bgcolor="white";');
  lines.push(`  labelloc=t; fontname="${FONT}"; fontsize=18; label=<<B>${esc(title)}</B>>;`);
  lines.push('  node [shape=box style="rounded,filled" fillcolor="#f6f8fa" color="#57606a" fontname="' + FONT + '" fontsize=13 margin="0.18,0.08"];');
  lines.push('  edge [fontname="' + FONT + '" fontsize=11 color="#6e7781" fontcolor="#24292f" arrowsize=0.8];');
  lines.push('  __start [shape=circle label="" width=0.22 style=filled fillcolor=black];');
  for (const state of model.states()) {
    const extra: string[] = [];
    if (state.final) extra.push('peripheries=2');
    if (highlight && visited.has(state.id)) extra.push(`fillcolor="#ddf4ff" color="${HL}" penwidth=2`);
    lines.push(`  ${state.id} [label=${stateLabel(state)} ${extra.join(' ')}];`);
  }
  lines.push(`  __start -> ${model.initial} [label="new task"];`);
  for (const edge of model.transitions()) {
    const steps = used.get(`${edge.from}|${edge.event}`);
    const caption = edgeCaption(edge.actor, edge.guard?.name);
    let label = `<<B>${esc(edge.event)}</B><BR/><FONT POINT-SIZE="9" COLOR="#57606a">${esc(caption)}</FONT>>`;
    let attrs = '';
    if (steps) {
      label = `<<B><FONT COLOR="${HL}">${steps.map((n) => `(${n}) `).join('')}${esc(edge.event)}</FONT></B><BR/><FONT POINT-SIZE="9" COLOR="#57606a">${esc(caption)}</FONT>>`;
      attrs = ` color="${HL}" penwidth=3`;
    } else if (highlight) attrs = ' color="#c8ccd1" fontcolor="#8c959f"';
    lines.push(`  ${edge.from} -> ${edge.to} [label=${label}${attrs}];`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** One workflow (or several) as a straight left-to-right chain. `nodePrefix` keeps ids unique when several chains are packed. */
export function chainsDot(model: Model, title: string, results: readonly WorkflowResult[], nodePrefix = ''): string {
  const label = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  const lines: string[] = [];
  lines.push('digraph G {', '  rankdir=LR; pad=0.3; nodesep=0.25; ranksep=0.35; newrank=true;');
  if (title) lines.push(`  labelloc=t; fontname="${FONT}"; fontsize=18; label=<<B>${esc(title)}</B>>;`);
  lines.push('  node [shape=box style="rounded,filled" fillcolor="#f6f8fa" color="#57606a" fontname="' + FONT + '" fontsize=12 height=0.4];');
  lines.push('  edge [fontname="' + FONT + '" fontsize=10 color="#57606a"];');
  let prevHead = '';
  results.forEach((result, index) => {
    const col = result.pass ? PASS : FAIL;
    const mark = result.pass ? 'PASS' : 'FAIL';
    const head = `${nodePrefix}w${index}_h`;
    lines.push(`  subgraph cluster_${index} { style="rounded" color="${col}" penwidth=1.5; label=""; `);
    lines.push(`    ${head} [shape=plaintext style="" label=<<FONT COLOR="${col}"><B>${esc(result.id)} ${mark}</B></FONT><BR/><FONT POINT-SIZE="10">${esc(result.title)}</FONT>>];`);
    let prev = `${nodePrefix}w${index}_s0`;
    lines.push(`    ${prev} [label="${esc(label(result.trace[0]?.from ?? model.initial))}"];`);
    lines.push(`    ${head} -> ${prev} [style=invis];`);
    result.trace.forEach((step, stepIndex) => {
      const node = `${nodePrefix}w${index}_s${stepIndex + 1}`;
      const wrongAccept = step.accepted && result.expect === 'rejected' && !result.pass && step.n === result.trace.length;
      if (wrongAccept) {
        lines.push(`    ${node} [label="${esc(label(step.to!))} (should be refused)" fillcolor="#ffebe9" color="${FAIL}" fontcolor="${FAIL}"];`);
        lines.push(`    ${prev} -> ${node} [label=<<B>${esc(step.event)}</B>> color="${FAIL}" fontcolor="${FAIL}" penwidth=2];`);
      } else if (step.accepted) {
        lines.push(`    ${node} [label="${esc(label(step.to!))}"];`);
        lines.push(`    ${prev} -> ${node} [label=<<B>${esc(step.event)}</B>>];`);
      } else {
        const good = result.expect === 'rejected' && result.pass;
        const color = good ? PASS : FAIL;
        lines.push(`    ${node} [shape=box style="filled,dashed" fillcolor="${good ? '#dafbe1' : '#ffebe9'}" color="${color}" fontcolor="${color}" label="${good ? 'refused (as required)' : 'REFUSED'}"];`);
        lines.push(`    ${prev} -> ${node} [label=<<B>${esc(step.event)}</B>> color="${color}" fontcolor="${color}" style=dashed];`);
      }
      prev = node;
    });
    if (!result.pass) {
      const note = `${nodePrefix}w${index}_why`;
      lines.push(`    ${note} [shape=note style=filled fillcolor="#fff8c5" color="#bf8700" fontsize=10 label="${esc(result.reason).replace(/"/g, "'")}"];`);
      lines.push(`    ${prev} -> ${note} [style=dotted arrowhead=none];`);
    }
    lines.push('  }');
    if (prevHead) lines.push(`  ${prevHead} -> ${head} [style=invis weight=10];`);
    prevHead = head;
  });
  lines.push(`  { rank=same; ${results.map((_, index) => `${nodePrefix}w${index}_h`).join('; ')} }`);
  lines.push('}');
  return lines.join('\n');
}

export function chartMermaid(model: Model): string {
  const lines = ['stateDiagram-v2', '  direction LR'];
  for (const state of model.states()) lines.push(`  ${state.id}: ${state.label}`);
  lines.push(`  [*] --> ${model.initial}`);
  for (const edge of model.transitions()) lines.push(`  ${edge.from} --> ${edge.to}: ${edge.event}`);
  for (const state of model.states()) if (state.final) lines.push(`  ${state.id} --> [*]`);
  return lines.join('\n') + '\n';
}

export function chainMermaid(model: Model, result: WorkflowResult): string {
  const label = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  const lines = ['flowchart LR', `  %% ${result.id} ${result.pass ? 'PASS' : 'FAIL'}: ${result.title}`];
  lines.push(`  s0["${label(result.trace[0]?.from ?? model.initial)}"]`);
  result.trace.forEach((step, index) => {
    lines.push(step.accepted
      ? `  s${index} -- ${step.event} --> s${index + 1}["${label(step.to!)}"]`
      : `  s${index} -. ${step.event} .-> s${index + 1}{{"refused"}}`);
  });
  return lines.join('\n') + '\n';
}

/** Title band plus one chain per workflow, for `gvpack` to stack. */
export function proofColumnDots(model: Model, title: string, results: readonly WorkflowResult[]): string[] {
  const dots = [`digraph T { pad=0.2; t [shape=plaintext fontname="${FONT}" fontsize=20 label=<<B>${esc(title)}</B>>]; }`];
  results.forEach((result, index) => dots.push(chainsDot(model, '', [result], `c${index}`)));
  return dots;
}
