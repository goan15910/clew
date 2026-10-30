// Chart models and workflow traces for one draft graph. Drawing stays in the adapter.
import { chartEventName, chartStateId, type Effect, type Model, type State, type Transition } from './model.js';
import type { DraftGraph, GraphState, GraphTransition } from './spec.js';
import type { WorkflowResult, TraceStep } from './verification.js';
import type { WorkflowDraft, WorkflowSetDraft } from './workflow.js';

/** A draft transition has no effect. The chart model still requires one. */
const NO_EFFECT: Effect = { name: 'none', sets: '' };

export interface DraftChart {
  object: string;
  model: Model;
}

export function draftCharts(graph: DraftGraph): DraftChart[] {
  const charts: DraftChart[] = [];
  for (const object of graph.objects) {
    const states = statesFor(graph.states, object);
    if (states.length === 0) continue;
    charts.push({ object, model: asModel(object, initialOf(graph.states, object), states, edgesFor(graph.transitions, object)) });
  }
  return charts;
}

/** One model whose states cover every object, so chain labels can show spec state names. */
export function draftLabelModel(graph: DraftGraph): Model {
  const states: State[] = [];
  const seen = new Set<string>();
  for (const state of graph.states) {
    const id = chartStateId(state.id);
    if (seen.has(id)) continue;
    seen.add(id);
    states.push(chartState(state));
  }
  const first = states[0];
  return asModel('draft', first === undefined ? '' : first.id, states, []);
}

export function draftChains(draft: WorkflowSetDraft): WorkflowResult[] {
  const results: WorkflowResult[] = [];
  for (const workflow of draft.workflows) results.push(chainOf(workflow));
  return results;
}

function chainOf(workflow: WorkflowDraft): WorkflowResult {
  const trace: TraceStep[] = [];
  for (let index = 0; index < workflow.edges.length; index += 1) {
    const edge = workflow.edges[index];
    if (edge === undefined) continue;
    const n = index + 1;
    const refused = workflow.expect === 'rejected' && workflow.rejectAt === n;
    const from = nodeState(workflow, edge.from);
    const to = nodeState(workflow, edge.to);
    trace.push({
      n,
      text: edge.text,
      event: edge.event,
      from,
      to: refused ? null : to,
      accepted: !refused,
      workflowEvent: edge.event,
      workflowFrom: edge.from,
      workflowTo: refused ? null : edge.to,
    });
    if (refused) break;
  }
  const last = trace[trace.length - 1];
  const landed = last !== undefined && last.accepted;
  return {
    id: workflow.id,
    title: workflow.title,
    expect: workflow.expect,
    pass: true,
    reason: '',
    trace,
    finalState: landed ? last.to : null,
    finalWorkflowState: landed ? last.workflowTo : null,
    provedBy: '',
  };
}

function nodeState(workflow: WorkflowDraft, id: string): string {
  for (const node of workflow.nodes) {
    if (node.id === id) return node.state;
  }
  return id;
}

function statesFor(states: readonly GraphState[], object: string): State[] {
  const built: State[] = [];
  const seen = new Set<string>();
  for (const state of states) {
    if (state.object !== object) continue;
    const id = chartStateId(state.id);
    if (seen.has(id)) continue;
    seen.add(id);
    built.push(chartState(state));
  }
  return built;
}

function chartState(state: GraphState): State {
  return {
    id: chartStateId(state.id),
    label: state.id,
    final: state.final === true,
    data: [],
  };
}

function initialOf(states: readonly GraphState[], object: string): string {
  for (const state of states) {
    if (state.object === object && state.initial === true) return chartStateId(state.id);
  }
  return '';
}

function edgesFor(transitions: readonly GraphTransition[], object: string): Transition[] {
  const edges: Transition[] = [];
  for (const transition of transitions) {
    if (transition.object !== object) continue;
    const edge: Transition = {
      from: chartStateId(transition.from),
      event: chartEventName(transition.event),
      to: chartStateId(transition.to),
      actor: transition.actor ?? 'unknown',
      effect: NO_EFFECT,
    };
    if (transition.guard !== undefined && transition.guard !== '') {
      edge.guard = { name: transition.guard, reads: '' };
    }
    edges.push(edge);
  }
  return edges;
}

function asModel(id: string, initial: string, states: readonly State[], transitions: readonly Transition[]): Model {
  return {
    id,
    initial,
    states() {
      return states;
    },
    transitions() {
      return transitions;
    },
  };
}
