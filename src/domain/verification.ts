// Reachability, dead ends, and workflow replay. The traversal port supplies the engine.
import type { Model } from './model.js';
import type { Traversal } from './traversal.js';
import type { Workflow } from './workflow.js';

export interface TraceStep {
  n: number;
  text: string;
  event: string;
  from: string;
  to: string | null;
  accepted: boolean;
}

export interface WorkflowResult {
  id: string;
  title: string;
  expect: string;
  pass: boolean;
  reason: string;
  trace: TraceStep[];
  finalState: string | null;
  provedBy: string;
}

export interface Structure {
  reachable: string[];
  unreachable: string[];
  deadEnds: string[];
  shortestPaths: Readonly<Record<string, readonly string[]>>;
}

export interface Assessment {
  structure: Structure;
  results: WorkflowResult[];
  passed: number;
  unusedTransitions: string[];
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

export function verifyWorkflow(model: Model, workflow: Workflow, traversal: Traversal): WorkflowResult {
  const label = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  let state = model.initial;
  const trace: TraceStep[] = [];
  for (const [index, step] of workflow.steps.entries()) {
    const from = state;
    if (!traversal.can(from, step.event)) {
      const allowed = model.transitions().filter((edge) => edge.from === from).map((edge) => edge.event);
      trace.push({ n: index + 1, text: step.text, event: step.event, from, to: null, accepted: false });
      const why = `step ${index + 1} "${step.text}": ${label(from)} does not accept ${step.event}` +
        (allowed.length ? ` (it accepts ${allowed.join(', ')})` : ' (it is a final state)');
      if (workflow.expect === 'accepted') {
        return { id: workflow.id, title: workflow.title, expect: workflow.expect, pass: false, reason: why, trace, finalState: from, provedBy: 'replay' };
      }
      const atRightStep = workflow.rejectAt === undefined || workflow.rejectAt === index + 1;
      return {
        id: workflow.id,
        title: workflow.title,
        expect: workflow.expect,
        pass: atRightStep,
        reason: atRightStep ? `correctly refused: ${why}` : `refused at the wrong step (expected step ${workflow.rejectAt}): ${why}`,
        trace,
        finalState: from,
        provedBy: 'replay',
      };
    }
    const next = traversal.step(from, step.event);
    if (next === null) throw new Error(`${workflow.id}: ${from} accepted ${step.event} but step returned no state`);
    state = next;
    trace.push({ n: index + 1, text: step.text, event: step.event, from, to: state, accepted: true });
  }
  const finalState = state;
  if (workflow.expect === 'rejected') {
    return {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      pass: false,
      reason: `should have been refused at step ${workflow.rejectAt} (${workflow.steps[(workflow.rejectAt ?? 1) - 1]?.event}) but the model allows the whole sequence, ending in ${label(finalState)}`,
      trace,
      finalState,
      provedBy: 'replay',
    };
  }
  const paths = traversal.pathsFromEvents(workflow.steps.map((step) => step.event));
  const matched = paths.length === 1 ? paths[0] : undefined;
  const graphEnd = matched?.state ?? null;
  const graphEvents = matched?.events ?? [];
  const pass = graphEnd === workflow.end && graphEnd === finalState && graphEvents.join() === workflow.steps.map((step) => step.event).join();
  return {
    id: workflow.id,
    title: workflow.title,
    expect: workflow.expect,
    pass,
    trace,
    finalState,
    reason: pass
      ? `path found by @xstate/graph getPathsFromEvents, ends in ${label(finalState)}`
      : `all steps accepted but it ends in ${label(finalState)}, expected ${label(workflow.end ?? '?')}`,
    provedBy: '@xstate/graph getPathsFromEvents',
  };
}

export function assessModel(model: Model, workflows: readonly Workflow[], traversal: Traversal): Assessment {
  const structure = structuralChecks(model, traversal);
  const results = workflows.map((workflow) => verifyWorkflow(model, workflow, traversal));
  const passed = results.filter((result) => result.pass).length;
  const usedEdges = new Set(results.flatMap((result) => result.trace.filter((step) => step.accepted).map((step) => `${step.from}|${step.event}`)));
  const unusedTransitions = model.transitions()
    .filter((edge) => !usedEdges.has(`${edge.from}|${edge.event}`))
    .map((edge) => `${edge.from} --${edge.event}--> ${edge.to}`);
  return { structure, results, passed, unusedTransitions };
}
