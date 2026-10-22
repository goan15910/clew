// DOT and Mermaid text. File output and the `dot` binary live in the Graphviz adapter.
import type { Model, State } from '../../domain/model.js';
import type { WorkflowResult } from '../../domain/verification.js';

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'Helvetica';
const PASS = '#1a7f37';
const FAIL = '#cf222e';
const HL = '#0969da';
const TEXT = '#24292f';
const MUTED = '#57606a';
const FADE_EDGE = '#d0d7de';
const FADE_FONT = '#8c959f';
const FADE_NODE = '#d8dee4';
const NODE_FILL = '#f6f8fa';

/** Palette for actor strokes. Sorted actor names pick the index, so the color is stable. */
export const ACTOR_PALETTE = ['#8250df', '#bc4c00', '#1a7f37', '#bf3989', '#0550ae', '#9a6700'] as const;

export function actorStroke(actor: string, actors: readonly string[]): string {
  const sorted = [...new Set(actors)].sort();
  const index = Math.max(0, sorted.indexOf(actor));
  return ACTOR_PALETTE[index % ACTOR_PALETTE.length]!;
}

function dotQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function edgeCaption(actor: string, guard: string | undefined): string {
  return guard === undefined ? actor : `${actor}; if ${guard}`;
}

function stateTable(state: State, text: string, muted: string): string {
  const rows = [`<TR><TD COLSPAN="2" ALIGN="CENTER"><FONT COLOR="${text}"><B>${esc(state.label)}</B></FONT></TD></TR>`];
  if (state.data.length > 0) rows.push('<HR/>');
  for (const field of state.data) {
    rows.push(`<TR><TD ALIGN="LEFT"><FONT POINT-SIZE="10" COLOR="${muted}">${esc(field.name)}</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="10" COLOR="${muted}">${esc(field.type)}</FONT></TD></TR>`);
  }
  return `<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2">${rows.join('')}</TABLE>>`;
}

function stateTooltip(state: State): string {
  const lines = [state.label, `id: ${state.id}`];
  if (state.final) lines.push('final');
  for (const field of state.data) lines.push(`${field.name}: ${field.type}`);
  return dotQuote(lines.join('\n'));
}

/** States share a cluster when the same actors leave them. A state with no exit is `final` or `terminal`. */
function clusterKey(state: State, outgoing: readonly { actor: string }[]): string {
  if (outgoing.length === 0) return state.final ? 'final' : 'terminal';
  return [...new Set(outgoing.map((edge) => edge.actor))].sort().join(', ');
}

function clusterSlug(key: string, used: Set<string>): string {
  const base = key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'group';
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}_${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

/** Full state chart. If `highlight` is given, that workflow's path is numbered and the rest is faded. */
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
  const actors = model.transitions().map((edge) => edge.actor);
  const lines: string[] = [];
  lines.push('digraph G {', '  rankdir=LR; pad=0.3; nodesep=0.5; ranksep=0.9; bgcolor="white";');
  lines.push(`  labelloc=t; fontname="${FONT}"; fontsize=18; label=<<B>${esc(title)}</B>>;`);
  lines.push('  node [shape=box style="rounded,filled" fillcolor="' + NODE_FILL + '" color="' + MUTED + '" fontname="' + FONT + '" fontsize=13 margin="0.18,0.08"];');
  lines.push('  edge [fontname="' + FONT + '" fontsize=11 color="#6e7781" fontcolor="' + TEXT + '" arrowsize=0.8];');
  lines.push(`  __start [shape=circle label="" width=0.22 style=filled fillcolor=black tooltip="start" URL=${dotQuote(`#${model.initial}`)}];`);

  const groups = new Map<string, State[]>();
  for (const state of model.states()) {
    const outgoing = model.transitions().filter((edge) => edge.from === state.id);
    const key = clusterKey(state, outgoing);
    const list = groups.get(key) ?? [];
    list.push(state);
    groups.set(key, list);
  }
  const slugs = new Set<string>();
  for (const key of [...groups.keys()].sort()) {
    lines.push(`  subgraph cluster_${clusterSlug(key, slugs)} {`);
    lines.push(`    label=${dotQuote(key)}; style="rounded"; color="#d0d7de"; fontname="${FONT}"; fontsize=11;`);
    for (const state of groups.get(key) ?? []) {
      const onPath = highlight !== undefined && visited.has(state.id);
      const faded = highlight !== undefined && !onPath;
      const extra: string[] = [];
      if (state.final) extra.push('peripheries=2');
      if (onPath) extra.push(`fillcolor="#ddf4ff" color="${HL}" penwidth=2`);
      else if (faded) extra.push(`fillcolor="${NODE_FILL}" color="${FADE_NODE}"`);
      const text = faded ? FADE_FONT : TEXT;
      const muted = faded ? FADE_FONT : MUTED;
      const attrs = [`label=${stateTable(state, text, muted)}`, `tooltip=${stateTooltip(state)}`, `URL=${dotQuote(`#${state.id}`)}`, ...extra];
      lines.push(`    ${state.id} [${attrs.filter((attr) => attr.length > 0).join(' ')}];`);
    }
    lines.push('  }');
  }

  const startFade = highlight ? ` color="${FADE_EDGE}" fontcolor="${FADE_FONT}"` : '';
  lines.push(`  __start -> ${model.initial} [label="new task" tooltip="new task" URL=${dotQuote(`#${model.initial}`)}${startFade}];`);
  for (const edge of model.transitions()) {
    const steps = used.get(`${edge.from}|${edge.event}`);
    const onPath = steps !== undefined;
    const faded = highlight !== undefined && !onPath;
    const color = onPath ? HL : faded ? FADE_EDGE : actorStroke(edge.actor, actors);
    const captionColor = faded ? FADE_FONT : MUTED;
    const caption = edgeCaption(edge.actor, edge.guard?.name);
    const eventHtml = onPath
      ? `<FONT COLOR="${HL}">${steps.map((n) => `(${n}) `).join('')}${esc(edge.event)}</FONT>`
      : faded
        ? `<FONT COLOR="${FADE_FONT}">${esc(edge.event)}</FONT>`
        : esc(edge.event);
    const label = `<<B>${eventHtml}</B><BR/><FONT POINT-SIZE="9" COLOR="${captionColor}">${esc(caption)}</FONT>>`;
    const tip = [`${edge.event}`, `${edge.from} -> ${edge.to}`, `actor: ${edge.actor}`];
    if (edge.guard) tip.push(`guard: ${edge.guard.name}`);
    tip.push(`effect: ${edge.effect.name}`);
    const attrs = [`label=${label}`, `color="${color}"`, `fontcolor="${faded ? FADE_FONT : TEXT}"`, `tooltip=${dotQuote(tip.join('\n'))}`, `URL=${dotQuote(`#${edge.to}`)}`];
    if (edge.guard) attrs.push('style=dashed');
    if (onPath) attrs.push('penwidth=3');
    lines.push(`  ${edge.from} -> ${edge.to} [${attrs.join(' ')}];`);
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
