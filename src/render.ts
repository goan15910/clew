// Human-facing outputs: Graphviz DOT (rendered to PNG/SVG) and Mermaid text.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Contract } from './contract.js';
import type { WorkflowResult } from './verify.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'Helvetica';
const PASS = '#1a7f37', FAIL = '#cf222e', HL = '#0969da';

function stateLabel(c: Contract, id: string) {
  const s = c.states.find((x) => x.id === id)!;
  return `<<B>${esc(s.label)}</B><BR/><FONT POINT-SIZE="10" COLOR="#57606a">${esc(s.data)}</FONT>>`;
}

/** Full state chart. If `hl` is given, that workflow's path is highlighted with numbered steps. */
export function chartDot(c: Contract, title: string, hl?: WorkflowResult): string {
  const used = new Map<string, number[]>();
  const visited = new Set<string>();
  if (hl) {
    visited.add(c.initial);
    for (const t of hl.trace) if (t.accepted && t.to) { const k = `${t.from}|${t.event}`; used.set(k, [...(used.get(k) ?? []), t.n]); visited.add(t.to); }
  }
  const L: string[] = [];
  L.push(`digraph G {`, `  rankdir=LR; pad=0.3; nodesep=0.5; ranksep=0.9; bgcolor="white";`);
  L.push(`  labelloc=t; fontname="${FONT}"; fontsize=18; label=<<B>${esc(title)}</B>>;`);
  L.push(`  node [shape=box style="rounded,filled" fillcolor="#f6f8fa" color="#57606a" fontname="${FONT}" fontsize=13 margin="0.18,0.08"];`);
  L.push(`  edge [fontname="${FONT}" fontsize=11 color="#6e7781" fontcolor="#24292f" arrowsize=0.8];`);
  L.push(`  __start [shape=circle label="" width=0.22 style=filled fillcolor=black];`);
  for (const s of c.states) {
    const extra: string[] = [];
    if (s.final) extra.push('peripheries=2');
    if (hl && visited.has(s.id)) extra.push(`fillcolor="#ddf4ff" color="${HL}" penwidth=2`);
    L.push(`  ${s.id} [label=${stateLabel(c, s.id)} ${extra.join(' ')}];`);
  }
  L.push(`  __start -> ${c.initial} [label="new task"];`);
  for (const t of c.transitions) {
    const steps = used.get(`${t.from}|${t.event}`);
    const sub = `${t.actor}${t.guard ? `; if ${t.guard}` : ''}`;
    let lbl = `<<B>${esc(t.event)}</B><BR/><FONT POINT-SIZE="9" COLOR="#57606a">${esc(sub)}</FONT>>`;
    let attrs = '';
    if (steps) {
      lbl = `<<B><FONT COLOR="${HL}">${steps.map((n) => `(${n}) `).join('')}${esc(t.event)}</FONT></B><BR/><FONT POINT-SIZE="9" COLOR="#57606a">${esc(sub)}</FONT>>`;
      attrs = ` color="${HL}" penwidth=3`;
    } else if (hl) attrs = ` color="#c8ccd1" fontcolor="#8c959f"`;
    L.push(`  ${t.from} -> ${t.to} [label=${lbl}${attrs}];`);
  }
  L.push(`}`);
  return L.join('\n');
}

/** One workflow (or several) as a straight left-to-right chain. */
export function chainsDot(c: Contract, title: string, results: WorkflowResult[]): string {
  const label = (id: string) => c.states.find((s) => s.id === id)?.label ?? id;
  const L: string[] = [];
  L.push(`digraph G {`, `  rankdir=LR; pad=0.3; nodesep=0.25; ranksep=0.35; newrank=true;`);
  if (title) L.push(`  labelloc=t; fontname="${FONT}"; fontsize=18; label=<<B>${esc(title)}</B>>;`);
  L.push(`  node [shape=box style="rounded,filled" fillcolor="#f6f8fa" color="#57606a" fontname="${FONT}" fontsize=12 height=0.4];`);
  L.push(`  edge [fontname="${FONT}" fontsize=10 color="#57606a"];`);
  let prevHead = '';
  results.forEach((r, i) => {
    const col = r.pass ? PASS : FAIL;
    const mark = r.pass ? 'PASS' : 'FAIL';
    const head = `w${i}_h`;
    L.push(`  subgraph cluster_${i} { style="rounded" color="${col}" penwidth=1.5; label=""; `);
    L.push(`    ${head} [shape=plaintext style="" label=<<FONT COLOR="${col}"><B>${esc(r.id)} ${mark}</B></FONT><BR/><FONT POINT-SIZE="10">${esc(r.title)}</FONT>>];`);
    let prev = `w${i}_s0`;
    L.push(`    ${prev} [label="${esc(label(r.trace[0]?.from ?? c.initial))}"];`);
    L.push(`    ${head} -> ${prev} [style=invis];`);
    r.trace.forEach((t, j) => {
      const node = `w${i}_s${j + 1}`;
      const wrongAccept = t.accepted && r.expect === 'rejected' && !r.pass && t.n === r.trace.length;
      if (wrongAccept) {
        L.push(`    ${node} [label="${esc(label(t.to!))} (should be refused)" fillcolor="#ffebe9" color="${FAIL}" fontcolor="${FAIL}"];`);
        L.push(`    ${prev} -> ${node} [label=<<B>${esc(t.event)}</B>> color="${FAIL}" fontcolor="${FAIL}" penwidth=2];`);
      } else if (t.accepted) {
        L.push(`    ${node} [label="${esc(label(t.to!))}"];`);
        L.push(`    ${prev} -> ${node} [label=<<B>${esc(t.event)}</B>>];`);
      } else {
        const good = r.expect === 'rejected' && r.pass;
        const c2 = good ? PASS : FAIL;
        L.push(`    ${node} [shape=box style="filled,dashed" fillcolor="${good ? '#dafbe1' : '#ffebe9'}" color="${c2}" fontcolor="${c2}" label="${good ? 'refused (as required)' : 'REFUSED'}"];`);
        L.push(`    ${prev} -> ${node} [label=<<B>${esc(t.event)}</B>> color="${c2}" fontcolor="${c2}" style=dashed];`);
      }
      prev = node;
    });
    if (!r.pass) {
      const note = `w${i}_why`;
      L.push(`    ${note} [shape=note style=filled fillcolor="#fff8c5" color="#bf8700" fontsize=10 label="${esc(r.reason).replace(/"/g, "'")}"];`);
      L.push(`    ${prev} -> ${note} [style=dotted arrowhead=none];`);
    }
    L.push(`  }`);
    if (prevHead) L.push(`  ${prevHead} -> ${head} [style=invis weight=10];`);
    prevHead = head;
  });
  // stack the chains vertically: put all heads in one rank
  L.push(`  { rank=same; ${results.map((_, i) => `w${i}_h`).join('; ')} }`);
  L.push(`}`);
  return L.join('\n');
}

export function chartMermaid(c: Contract): string {
  const L = ['stateDiagram-v2', '  direction LR'];
  for (const s of c.states) L.push(`  ${s.id}: ${s.label}`);
  L.push(`  [*] --> ${c.initial}`);
  for (const t of c.transitions) L.push(`  ${t.from} --> ${t.to}: ${t.event}`);
  for (const s of c.states) if (s.final) L.push(`  ${s.id} --> [*]`);
  return L.join('\n') + '\n';
}

export function chainMermaid(c: Contract, r: WorkflowResult): string {
  const label = (id: string) => c.states.find((s) => s.id === id)?.label ?? id;
  const L = ['flowchart LR', `  %% ${r.id} ${r.pass ? 'PASS' : 'FAIL'}: ${r.title}`];
  L.push(`  s0["${label(r.trace[0]?.from ?? c.initial)}"]`);
  r.trace.forEach((t, j) => {
    L.push(t.accepted ? `  s${j} -- ${t.event} --> s${j + 1}["${label(t.to!)}"]` : `  s${j} -. ${t.event} .-> s${j + 1}{{"refused"}}`);
  });
  return L.join('\n') + '\n';
}

export function render(dot: string, base: string) {
  writeFileSync(`${base}.dot`, dot);
  execFileSync('dot', ['-Tsvg', `${base}.dot`, '-o', `${base}.svg`]);
  execFileSync('dot', ['-Tpng', '-Gdpi=150', `${base}.dot`, '-o', `${base}.png`]);
}

/** Stack several workflow chains in one column under a title (graphviz gvpack, no extra deps). */
export function renderStacked(c: Contract, title: string, results: WorkflowResult[], base: string) {
  const titleDot = `digraph T { pad=0.2; t [shape=plaintext fontname="${FONT}" fontsize=20 label=<<B>${esc(title)}</B>>]; }`;
  const laid = [titleDot, ...results.map((r) => chainsDot(c, '', [r]))].map((d) => execFileSync('dot', [], { input: d }).toString());
  const tmp = `${base}.parts.gv`;
  writeFileSync(tmp, laid.join('\n'));
  const packed = execFileSync('gvpack', ['-array_il1', '-m12', tmp], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  writeFileSync(`${base}.dot`, packed);
  execFileSync('neato', ['-n2', '-Tsvg', `${base}.dot`, '-o', `${base}.svg`]);
  execFileSync('neato', ['-n2', '-Tpng', '-Gdpi=130', `${base}.dot`, '-o', `${base}.png`]);
  execFileSync('rm', ['-f', tmp]);
}
