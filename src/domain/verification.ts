// Reachability, dead ends, and workflow replay. The traversal port supplies the engine.
import type { MappedStep } from './mapping.js';
import type { Model } from './model.js';
import type { Traversal } from './traversal.js';

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
  steps: readonly MappedStep[];
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

function traceOf(step: MappedStep, from: string, to: string | null, accepted: boolean): TraceStep {
  return {
    n: step.n,
    text: step.text,
    event: step.chartEvent,
    from,
    to,
    accepted,
    workflowEvent: step.workflowEvent,
    workflowFrom: step.workflowFrom,
    workflowTo: accepted ? step.workflowTo : null,
  };
}

export function verifyFlow(model: Model, flow: ChartFlow, traversal: Traversal): WorkflowResult {
  const label = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  const first = flow.steps[0];
  if (first === undefined) {
    return {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      pass: false,
      reason: 'flow has no edges',
      trace: [],
      finalState: null,
      finalWorkflowState: null,
      provedBy: 'replay',
    };
  }

  let state = first.chartFrom;
  let workflowState: string | null = first.workflowFrom;
  const trace: TraceStep[] = [];
  for (const step of flow.steps) {
    if (state !== step.chartFrom) {
      return {
        id: flow.id,
        title: flow.title,
        expect: flow.expect,
        pass: false,
        reason: `step ${step.n} "${step.text}": previous step left the chart in ${label(state)}, not ${label(step.chartFrom)}`,
        trace,
        finalState: state,
        finalWorkflowState: workflowState,
        provedBy: 'replay',
      };
    }
    if (!traversal.can(state, step.chartEvent)) {
      const allowed = model.transitions().filter((edge) => edge.from === state).map((edge) => edge.event);
      trace.push(traceOf(step, state, null, false));
      const why = `step ${step.n} "${step.text}": ${label(state)} does not accept ${step.chartEvent} (workflow ${step.workflowEvent})` +
        (allowed.length ? ` (it accepts ${allowed.join(', ')})` : ' (it is a final state)');
      if (flow.expect === 'accepted') {
        return {
          id: flow.id,
          title: flow.title,
          expect: flow.expect,
          pass: false,
          reason: why,
          trace,
          finalState: state,
          finalWorkflowState: step.workflowFrom,
          provedBy: 'replay',
        };
      }
      const atRightStep = flow.rejectAt === step.n;
      return {
        id: flow.id,
        title: flow.title,
        expect: flow.expect,
        pass: atRightStep,
        reason: atRightStep ? `correctly refused: ${why}` : `refused at the wrong step (expected step ${flow.rejectAt}): ${why}`,
        trace,
        finalState: state,
        finalWorkflowState: step.workflowFrom,
        provedBy: 'replay',
      };
    }
    const next = traversal.step(state, step.chartEvent);
    if (next === null) throw new Error(`${flow.id}: ${state} accepted ${step.chartEvent} but step returned no state`);
    trace.push(traceOf(step, state, next, true));
    if (next !== step.chartTo) {
      return {
        id: flow.id,
        title: flow.title,
        expect: flow.expect,
        pass: false,
        reason: `step ${step.n} "${step.text}": ${step.chartEvent} lands in ${label(next)}, expected ${label(step.chartTo)} (workflow ${step.workflowTo})`,
        trace,
        finalState: next,
        finalWorkflowState: null,
        provedBy: 'replay',
      };
    }
    state = next;
    workflowState = step.workflowTo;
  }

  const finalState = state;
  if (flow.expect === 'rejected') {
    const refused = flow.steps[(flow.rejectAt ?? 1) - 1];
    return {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      pass: false,
      reason: `should have been refused at step ${flow.rejectAt} (${refused?.chartEvent ?? '?'}, workflow ${refused?.workflowEvent ?? '?'}) but the chart allows the whole sequence, ending in ${label(finalState)}`,
      trace,
      finalState,
      finalWorkflowState: workflowState,
      provedBy: 'replay',
    };
  }

  if (first.chartFrom !== model.initial) {
    return {
      id: flow.id,
      title: flow.title,
      expect: flow.expect,
      pass: true,
      reason: `replay from ${label(first.chartFrom)} ends in ${label(finalState)}`,
      trace,
      finalState,
      finalWorkflowState: workflowState,
      provedBy: 'replay',
    };
  }

  const events = flow.steps.map((step) => step.chartEvent);
  const paths = traversal.pathsFromEvents(events);
  const matched = paths.length === 1 ? paths[0] : undefined;
  const graphEnd = matched?.state ?? null;
  const graphEvents = matched?.events ?? [];
  const expectedEnd = flow.steps[flow.steps.length - 1]?.chartTo ?? null;
  const pass = graphEnd === finalState && graphEnd === expectedEnd && graphEvents.join() === events.join();
  return {
    id: flow.id,
    title: flow.title,
    expect: flow.expect,
    pass,
    trace,
    finalState,
    finalWorkflowState: workflowState,
    reason: pass
      ? `path found by @xstate/graph getPathsFromEvents, ends in ${label(finalState)}`
      : `all steps accepted but the graph proof does not confirm the ending ${label(expectedEnd ?? '?')} (replay ended in ${label(finalState)})`,
    provedBy: '@xstate/graph getPathsFromEvents',
  };
}

export function unusedTransitions(model: Model, results: readonly WorkflowResult[]): string[] {
  const usedEdges = new Set(results.flatMap((result) => result.trace.filter((step) => step.accepted).map((step) => `${step.from}|${step.event}`)));
  const unused: string[] = [];
  for (const edge of model.transitions()) {
    if (!usedEdges.has(`${edge.from}|${edge.event}`)) unused.push(`${edge.from} --${edge.event}--> ${edge.to}`);
  }
  return unused;
}
