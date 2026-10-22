// One DOT frame of a workflow replay. Graphviz only draws it; the positions are fixed here.
import type { Model } from '../../domain/model.js';
import type { TraceStep, WorkflowResult } from '../../domain/verification.js';

const FONT = 'Helvetica';
const PASS = '#1a7f37';
const FAIL = '#cf222e';
const HL = '#0969da';
const PENDING = '#d0d7de';
const PENDING_INK = '#8c959f';
const GAP = 220;

type Mark = 'accepted' | 'refused' | 'wrong-accept' | 'wrong-refuse';
type Phase = 'past' | 'current' | 'pending';

function plainLabel(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function stateLabel(model: Model, id: string): string {
  return model.states().find((state) => state.id === id)?.label ?? id;
}

export function stepMark(result: WorkflowResult, step: TraceStep): Mark {
  if (!step.accepted) {
    if (result.expect === 'rejected' && result.pass) return 'refused';
    return 'wrong-refuse';
  }
  if (result.expect === 'rejected' && !result.pass && step.n === result.trace.length) return 'wrong-accept';
  return 'accepted';
}

function nodeText(model: Model, step: TraceStep, mark: Mark): string {
  if (mark === 'refused') return 'refused (as required)';
  if (mark === 'wrong-accept') return 'should be refused';
  if (mark === 'wrong-refuse') return 'REFUSED';
  return stateLabel(model, step.to ?? step.from);
}

export function frameCaption(result: WorkflowResult, frame: number): string {
  const title = `${result.id}  ${result.title}`;
  if (result.trace.length === 0) return `${title}  —  ${result.reason}`;
  if (frame <= 0) return `${title}  —  start`;
  const step = result.trace[frame - 1];
  if (step === undefined) return title;
  const mark = stepMark(result, step);
  const suffix = mark === 'accepted' ? '' : mark === 'refused' ? '  refused' : mark === 'wrong-accept' ? '  should be refused' : '  REFUSED';
  return `${title}  —  step ${frame}/${result.trace.length}  ${step.event}${suffix}`;
}

function nodeAttrs(mark: Mark | 'start', phase: Phase): string {
  if (phase === 'pending') {
    const dashed = mark === 'refused' || mark === 'wrong-refuse' ? ',dashed' : '';
    return `style="rounded,filled${dashed}" fillcolor="#f6f8fa" color="${PENDING}" fontcolor="${PENDING_INK}" penwidth=1`;
  }
  if (mark === 'refused') {
    const width = phase === 'current' ? 2.4 : 1.4;
    return `style="rounded,filled,dashed" fillcolor="#dafbe1" color="${PASS}" fontcolor="${PASS}" penwidth=${width}`;
  }
  if (mark === 'wrong-accept' || mark === 'wrong-refuse') {
    const dashed = mark === 'wrong-refuse' ? ',dashed' : '';
    const width = phase === 'current' ? 2.4 : 1.4;
    return `style="rounded,filled${dashed}" fillcolor="#ffebe9" color="${FAIL}" fontcolor="${FAIL}" penwidth=${width}`;
  }
  if (phase === 'current') return `style="rounded,filled" fillcolor="#ddf4ff" color="${HL}" penwidth=2.4`;
  return 'style="rounded,filled" fillcolor="#f6f8fa" color="#57606a" penwidth=1';
}

function edgeAttrs(mark: Mark, phase: Phase): string {
  if (phase === 'pending') return `color="${PENDING}" fontcolor="${PENDING_INK}"`;
  if (mark === 'refused') return `color="${PASS}" fontcolor="${PASS}" penwidth=2 style=dashed`;
  if (mark === 'wrong-accept') return `color="${FAIL}" fontcolor="${FAIL}" penwidth=2`;
  if (mark === 'wrong-refuse') return `color="${FAIL}" fontcolor="${FAIL}" penwidth=2 style=dashed`;
  if (phase === 'current') return `color="${HL}" penwidth=2`;
  return 'color="#57606a"';
}

function phaseOf(index: number, frame: number): Phase {
  if (index > frame) return 'pending';
  if (index === frame) return 'current';
  return 'past';
}

/** Frames of one workflow share this DOT shape. `frame` 0 is the start state; later frames light the next step. */
export function replayFrameDot(model: Model, result: WorkflowResult, frame: number): string {
  const steps = result.trace;
  const shown = Math.max(0, Math.min(frame, steps.length));
  const nodes = steps.length + 1;
  const lastX = Math.max(0, nodes - 1) * GAP;
  const lines = [
    'digraph G {',
    '  bgcolor="white"; pad="0.15"; splines=line;',
    `  node [shape=box fontname="${FONT}" fontsize=11 fixedsize=true width=1.95 height=0.52 pin=true];`,
    `  edge [fontname="${FONT}" fontsize=10];`,
  ];
  if (steps.length === 0) {
    lines.push(`  note [label=${plainLabel(result.reason || result.id)} pos="0,0!" style="rounded,filled" fillcolor="#fff8c5" color="#bf8700"];`);
    lines.push(`  cap [shape=plaintext style="" fixedsize=true width=8 height=0.4 fontsize=14 pin=true pos="0,78!" label=${plainLabel(frameCaption(result, 0))}];`);
    lines.push('}');
    return lines.join('\n');
  }
  const start = steps[0]?.from ?? model.initial;
  lines.push(`  s0 [label=${plainLabel(stateLabel(model, start))} pos="0,0!" ${nodeAttrs('start', phaseOf(0, shown))}];`);
  steps.forEach((step, index) => {
    const mark = stepMark(result, step);
    const phase = phaseOf(index + 1, shown);
    lines.push(`  s${index + 1} [label=${plainLabel(nodeText(model, step, mark))} pos="${(index + 1) * GAP},0!" ${nodeAttrs(mark, phase)}];`);
    lines.push(`  s${index} -> s${index + 1} [label=${plainLabel(step.event)} ${edgeAttrs(mark, phase)}];`);
  });
  lines.push(`  cap [shape=plaintext style="" fixedsize=true width=10 height=0.4 fontsize=14 pin=true pos="${lastX / 2},62!" label=${plainLabel(frameCaption(result, shown))}];`);
  lines.push(`  __sw [shape=point style=invis width=0.02 height=0.02 label="" pin=true pos="-20,-40!"];`);
  lines.push(`  __ne [shape=point style=invis width=0.02 height=0.02 label="" pin=true pos="${lastX + 20},96!"];`);
  lines.push('}');
  return lines.join('\n');
}
