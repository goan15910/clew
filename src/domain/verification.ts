// Reachability, dead ends, and next-state workflow replay.
import type { Model } from './model.js';
import {
  can,
  displayOf,
  enabled,
  step,
  valuationFromAssign,
  type Spec,
} from './spec-model.js';
import type { Traversal } from './traversal.js';
import type { Valuation, ValuationId } from './valuation.js';
import { assignDisplay, type ChainStep } from './workflow.js';

export interface AlignedStep {
  n: number;
  text: string;
  event: string;
  from: Valuation;
  to: Valuation;
}

function remember(gaps: string[], seen: Set<string>, gap: string): void {
  if (seen.has(gap)) return;
  seen.add(gap);
  gaps.push(gap);
}

export function alignChain(
  spec: Spec,
  chain: readonly ChainStep[],
): { ok: true; steps: AlignedStep[] } | { ok: false; gaps: string[] } {
  const gaps: string[] = [];
  const seen = new Set<string>();
  const steps: AlignedStep[] = [];
  for (const item of chain) {
    const from = valuationFromAssign(spec, item.assignFrom);
    const to = valuationFromAssign(spec, item.assignTo);
    let missing = false;
    if (!from.ok) {
      remember(gaps, seen, `name gap: workflow node "${item.from}" (${assignDisplay(item.assignFrom)}) ${from.message}`);
      missing = true;
    }
    if (!to.ok) {
      remember(gaps, seen, `name gap: workflow node "${item.to}" (${assignDisplay(item.assignTo)}) ${to.message}`);
      missing = true;
    }
    if (missing || !from.ok || !to.ok) continue;
    steps.push({
      n: item.n,
      text: item.text,
      event: item.event,
      from: from.valuation,
      to: to.valuation,
    });
  }
  if (gaps.length > 0) return { ok: false, gaps };
  return { ok: true, steps };
}

export interface TraceStep {
  n: number;
  text: string;
  event: string;
  from: string;
  to: string | null;
  accepted: boolean;
  workflowEvent: string;
  workflowFrom: string;
  workflowTo: string | null;
}

export interface WorkflowResult {
  id: string;
  title: string;
  expect: string;
  pass: boolean;
  reason: string;
  trace: TraceStep[];
  finalState: string | null;
  finalWorkflowState: string | null;
  provedBy: string;
}

export interface Structure {
  reachable: string[];
  unreachable: string[];
  deadEnds: string[];
  shortestPaths: Readonly<Record<string, readonly string[]>>;
}

export interface ChartFlow {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  rejectAt?: number;
  steps: readonly AlignedStep[];
}

export function structuralChecks(model: Model, traversal: Traversal): Structure {
  const shortest = traversal.shortestPaths();
  const reachable = Object.keys(shortest);
  const reached = new Set(reachable);
  const unreachable = model.states().map((state) => state.id).filter((id) => !reached.has(id));
  const outgoing = new Set(model.transitions().map((edge) => edge.from));
  const deadEnds = model.states().filter((state) => !state.final && !outgoing.has(state.id)).map((state) => state.id);
  return { reachable, unreachable, deadEnds, shortestPaths: shortest };
}

function traceOf(item: AlignedStep, spec: Spec, from: Valuation, to: Valuation | null, accepted: boolean): TraceStep {
  const fromName = displayOf(spec, from);
  return {
    n: item.n,
    text: item.text,
    event: item.event,
    from: fromName,
    to: to === null ? null : displayOf(spec, to),
    accepted,
    workflowEvent: item.event,
    workflowFrom: displayOf(spec, item.from),
    workflowTo: accepted ? displayOf(spec, item.to) : null,
  };
}

function resultOf(
  flow: ChartFlow,
  pass: boolean,
  reason: string,
  trace: TraceStep[],
  finalState: string | null,
  finalWorkflowState: string | null,
): WorkflowResult {
  return {
    id: flow.id,
    title: flow.title,
    expect: flow.expect,
    pass,
    reason,
    trace,
    finalState,
    finalWorkflowState,
    provedBy: 'next-state',
  };
}

export function verifyFlow(
  spec: Spec,
  flow: ChartFlow,
  reached: ReadonlySet<ValuationId>,
): WorkflowResult {
  const first = flow.steps[0];
  if (first === undefined) {
    return resultOf(flow, false, 'flow has no edges', [], null, null);
  }

  if (!reached.has(first.from.id)) {
    return resultOf(
      flow,
      false,
      `start is not reachable from initial (${displayOf(spec, first.from)} ${first.from.id})`,
      [],
      displayOf(spec, first.from),
      displayOf(spec, first.from),
    );
  }

  let state = first.from;
  const trace: TraceStep[] = [];
  for (const item of flow.steps) {
    if (state.id !== item.from.id) {
      return resultOf(
        flow,
        false,
        `step ${item.n} "${item.text}": previous step left ${displayOf(spec, state)}, not ${displayOf(spec, item.from)}`,
        trace,
        displayOf(spec, state),
        displayOf(spec, state),
      );
    }
    if (!can(spec, state, item.event)) {
      const allowed = enabledEvents(spec, state);
      trace.push(traceOf(item, spec, state, null, false));
      const why = `step ${item.n} "${item.text}": ${displayOf(spec, state)} does not accept ${item.event}` +
        (allowed.length ? ` (it accepts ${allowed.join(', ')})` : ' (no action is enabled)');
      if (flow.expect === 'accepted') {
        return resultOf(flow, false, why, trace, displayOf(spec, state), displayOf(spec, item.from));
      }
      const atRightStep = flow.rejectAt === item.n;
      return resultOf(
        flow,
        atRightStep,
        atRightStep ? `correctly refused: ${why}` : `refused at the wrong step (expected step ${flow.rejectAt}): ${why}`,
        trace,
        displayOf(spec, state),
        displayOf(spec, item.from),
      );
    }
    const next = step(spec, state, item.event);
    if (next === null) throw new Error(`${flow.id}: ${state.id} accepted ${item.event} but step returned no valuation`);
    trace.push(traceOf(item, spec, state, next, true));
    if (next.id !== item.to.id) {
      return resultOf(
        flow,
        false,
        `step ${item.n} "${item.text}": ${item.event} lands in ${next.id}, expected ${item.to.id}`,
        trace,
        displayOf(spec, next),
        null,
      );
    }
    state = next;
  }

  const finalName = displayOf(spec, state);
  if (flow.expect === 'rejected') {
    const refused = flow.steps[(flow.rejectAt ?? 1) - 1];
    return resultOf(
      flow,
      false,
      `should have been refused at step ${flow.rejectAt} (${refused?.event ?? '?'}) but the spec allows the whole sequence, ending in ${finalName}`,
      trace,
      finalName,
      finalName,
    );
  }

  return resultOf(
    flow,
    true,
    `next-state replay from ${displayOf(spec, first.from)} ends in ${finalName}`,
    trace,
    finalName,
    finalName,
  );
}

function enabledEvents(spec: Spec, state: Valuation): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const action of enabled(spec, state)) {
    if (seen.has(action.event)) continue;
    seen.add(action.event);
    names.push(action.event);
  }
  return names;
}

export function unusedTransitions(model: Model, results: readonly WorkflowResult[]): string[] {
  const usedEdges = new Set(results.flatMap((result) => result.trace.filter((item) => item.accepted).map((item) => `${item.from}|${item.event}`)));
  const unused: string[] = [];
  for (const edge of model.transitions()) {
    if (!usedEdges.has(`${edge.from}|${edge.event}`)) unused.push(`${edge.from} --${edge.event}--> ${edge.to}`);
  }
  return unused;
}

/** One chart transition and how many selected workflows accepted it. A refused step is not coverage. */
export interface TransitionCoverage {
  from: string;
  event: string;
  to: string;
  count: number;
  flows: readonly string[];
}

export function transitionCoverage(model: Model, results: readonly WorkflowResult[]): TransitionCoverage[] {
  const hits = new Map<string, { count: number; flows: string[] }>();
  for (const result of results) {
    const seen = new Set<string>();
    for (const item of result.trace) {
      if (!item.accepted || item.to === null) continue;
      const key = `${item.from}|${item.event}|${item.to}`;
      const hit = hits.get(key) ?? { count: 0, flows: [] };
      hit.count += 1;
      if (!seen.has(key)) {
        seen.add(key);
        hit.flows.push(result.id);
      }
      hits.set(key, hit);
    }
  }
  const rows: TransitionCoverage[] = [];
  for (const edge of model.transitions()) {
    const hit = hits.get(`${edge.from}|${edge.event}|${edge.to}`);
    rows.push({
      from: edge.from,
      event: edge.event,
      to: edge.to,
      count: hit?.count ?? 0,
      flows: hit?.flows ?? [],
    });
  }
  return rows;
}
