// Verification: reachability, dead ends, and workflow replay via @xstate/graph.
import { initialTransition, transition, type AnyStateMachine } from 'xstate';
import { getPathsFromEvents, getShortestPaths } from '@xstate/graph';
import type { Contract } from './contract.js';

export interface WorkflowStep { text: string; event: string }
export interface Workflow { id: string; title: string; expect: 'accepted' | 'rejected'; end?: string; rejectAt?: number; steps: WorkflowStep[] }
export interface TraceStep { n: number; text: string; event: string; from: string; to: string | null; accepted: boolean }
export interface WorkflowResult {
  id: string; title: string; expect: string; pass: boolean; reason: string;
  trace: TraceStep[]; finalState: string | null; provedBy: string;
}

const valueOf = (s: any): string => (typeof s.value === 'string' ? s.value : JSON.stringify(s.value));

export function structuralChecks(machine: AnyStateMachine, c: Contract) {
  const events = [...new Set(c.transitions.map((t) => t.event))].map((type) => ({ type }));
  const paths = getShortestPaths(machine, { events });
  const reachable = new Set(paths.map((p) => valueOf(p.state)));
  const unreachable = c.states.map((s) => s.id).filter((id) => !reachable.has(id));
  const deadEnds = c.states.filter((s) => !s.final && !c.transitions.some((t) => t.from === s.id)).map((s) => s.id);
  const shortest = Object.fromEntries(
    paths.map((p) => [valueOf(p.state), p.steps.map((st: any) => st.event.type).filter((e: string) => e !== 'xstate.init')]),
  );
  return { reachable: [...reachable], unreachable, deadEnds, shortestPaths: shortest };
}

export function verifyWorkflow(machine: AnyStateMachine, c: Contract, wf: Workflow): WorkflowResult {
  const label = (id: string) => c.states.find((s) => s.id === id)?.label ?? id;
  // 1) Step-by-step replay: does each state accept the next event?
  let [snap] = initialTransition(machine);
  const trace: TraceStep[] = [];
  let rejectedAt: TraceStep | null = null;
  for (const [i, step] of wf.steps.entries()) {
    const from = valueOf(snap);
    if (!snap.can({ type: step.event })) {
      const allowed = c.transitions.filter((t) => t.from === from).map((t) => t.event);
      rejectedAt = { n: i + 1, text: step.text, event: step.event, from, to: null, accepted: false };
      trace.push(rejectedAt);
      const why = `step ${i + 1} "${step.text}": ${label(from)} does not accept ${step.event}` +
        (allowed.length ? ` (it accepts ${allowed.join(', ')})` : ' (it is a final state)');
      if (wf.expect === 'accepted') return { id: wf.id, title: wf.title, expect: wf.expect, pass: false, reason: why, trace, finalState: from, provedBy: 'replay' };
      const atRightStep = wf.rejectAt === undefined || wf.rejectAt === i + 1;
      return {
        id: wf.id, title: wf.title, expect: wf.expect, pass: atRightStep,
        reason: atRightStep ? `correctly refused: ${why}` : `refused at the wrong step (expected step ${wf.rejectAt}): ${why}`,
        trace, finalState: from, provedBy: 'replay',
      };
    }
    [snap] = transition(machine, snap, { type: step.event }) as any;
    trace.push({ n: i + 1, text: step.text, event: step.event, from, to: valueOf(snap), accepted: true });
  }
  const finalState = valueOf(snap);
  if (wf.expect === 'rejected') {
    return { id: wf.id, title: wf.title, expect: wf.expect, pass: false,
      reason: `should have been refused at step ${wf.rejectAt} (${wf.steps[(wf.rejectAt ?? 1) - 1]?.event}) but the model allows the whole sequence, ending in ${label(finalState)}`,
      trace, finalState, provedBy: 'replay' };
  }
  // 2) Native traversal proof: @xstate/graph must find a path for exactly these events ending in `end`.
  // (toState is not passed: it makes @xstate/graph stop exploring at the first match.)
  const paths = getPathsFromEvents(machine, wf.steps.map((s) => ({ type: s.event })) as any);
  const graphEnd = paths.length === 1 ? valueOf(paths[0].state) : null;
  const graphEvents = paths.length === 1 ? paths[0].steps.map((st: any) => st.event.type).filter((e: string) => e !== 'xstate.init') : [];
  const pass = graphEnd === wf.end && graphEnd === finalState && graphEvents.join() === wf.steps.map((s) => s.event).join();
  return {
    id: wf.id, title: wf.title, expect: wf.expect, pass, trace, finalState,
    reason: pass ? `path found by @xstate/graph getPathsFromEvents, ends in ${label(finalState)}` : `all steps accepted but it ends in ${label(finalState)}, expected ${label(wf.end ?? '?')}`,
    provedBy: '@xstate/graph getPathsFromEvents',
  };
}
