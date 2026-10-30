// Interactive Cytoscape payloads from the chart/chain model, with `clew spec trace` hover details.
// Shareable with a future `clew chart view` / `clew workflows view` (via adapters/diagram/interactive).
import { chartEventName, chartStateId, type Model } from '../domain/model.js';
import type { DraftGraph, Entity, GraphTransition, SpecSnapshot } from '../domain/spec.js';
import { traceItem, type TraceLink } from '../domain/spec-query.js';
import type { WorkflowResult } from '../domain/verification.js';
import type {
  DraftGraphCyElement,
  DraftGraphHoverDetail,
  DraftGraphInteractive,
} from './documents.js';

/** State chart elements. Layout is left→right via dagre in the client. */
export function chartInteractive(model: Model, title: string, snapshot: SpecSnapshot): DraftGraphInteractive {
  const elements: DraftGraphCyElement[] = [];
  const hasInitial = model.states().some((state) => state.id === model.initial);
  if (hasInitial) {
    elements.push({
      group: 'nodes',
      data: { id: '__start', label: '', kind: 'start', detail: 'detail:start' },
      classes: 'start',
    });
    elements.push({
      group: 'edges',
      data: {
        id: 'edge:start',
        source: '__start',
        target: model.initial,
        label: 'new',
        kind: 'transition',
        detail: 'detail:start-edge',
        event: 'new',
      },
      classes: 'start-edge',
    });
  }
  for (const state of model.states()) {
    const classes = [state.final ? 'final' : '', state.id === model.initial ? 'initial' : '']
      .filter((value) => value.length > 0)
      .join(' ');
    elements.push({
      group: 'nodes',
      data: {
        id: state.id,
        label: state.label,
        kind: 'state',
        detail: `detail:state:${state.id}`,
        initial: state.id === model.initial,
        final: state.final,
      },
      classes: classes || undefined,
    });
  }
  let edgeIndex = 0;
  for (const edge of model.transitions()) {
    const id = `edge:${edge.from}:${edge.event}:${edge.to}:${edgeIndex}`;
    edgeIndex += 1;
    const guard = edge.guard?.name;
    const label = guard === undefined ? edge.event : `${edge.event} / ${guard}`;
    elements.push({
      group: 'edges',
      data: {
        id,
        source: edge.from,
        target: edge.to,
        label,
        kind: 'transition',
        detail: `detail:edge:${edge.from}|${edge.event}|${edge.to}`,
        actor: edge.actor,
        event: edge.event,
        guard,
      },
      classes: guard === undefined ? undefined : 'guarded',
    });
  }
  return {
    id: model.id,
    title,
    kind: 'chart',
    elements,
    details: chartDetails(model, snapshot),
  };
}

/** One workflow as a left→right chain, matching `chainsDot(..., heads: 'expect')`. */
export function workflowInteractive(
  model: Model,
  result: WorkflowResult,
  snapshot: SpecSnapshot,
): DraftGraphInteractive {
  const labelOf = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  const elements: DraftGraphCyElement[] = [];
  const startId = 'n0';
  const startState = result.trace[0]?.from ?? model.initial;
  elements.push({
    group: 'nodes',
    data: {
      id: startId,
      label: labelOf(startState),
      kind: 'state',
      detail: 'detail:step-node:0',
    },
  });
  let prev = startId;
  result.trace.forEach((step, index) => {
    const nodeId = `n${index + 1}`;
    if (step.accepted && step.to) {
      elements.push({
        group: 'nodes',
        data: {
          id: nodeId,
          label: labelOf(step.to),
          kind: 'state',
          detail: `detail:step-node:${index + 1}`,
          path: true,
        },
        classes: 'path',
      });
      elements.push({
        group: 'edges',
        data: {
          id: `e${index}`,
          source: prev,
          target: nodeId,
          label: step.event,
          kind: 'step',
          detail: `detail:step:${step.n}`,
          event: step.event,
          path: true,
        },
        classes: 'path',
      });
      prev = nodeId;
      return;
    }
    elements.push({
      group: 'nodes',
      data: {
        id: nodeId,
        label: 'refused',
        kind: 'refused',
        detail: `detail:step-node:${index + 1}`,
      },
      classes: 'refused',
    });
    elements.push({
      group: 'edges',
      data: {
        id: `e${index}`,
        source: prev,
        target: nodeId,
        label: step.event,
        kind: 'step',
        detail: `detail:step:${step.n}`,
        event: step.event,
      },
      classes: 'refused',
    });
    prev = nodeId;
  });
  return {
    id: result.id,
    title: result.title,
    kind: 'workflow',
    expect: result.expect === 'rejected' ? 'rejected' : 'accepted',
    elements,
    details: workflowDetails(model, result, snapshot),
  };
}

function chartDetails(model: Model, snapshot: SpecSnapshot): Record<string, DraftGraphHoverDetail> {
  const details: Record<string, DraftGraphHoverDetail> = {
    'detail:start': {
      id: 'detail:start',
      kind: 'start',
      title: 'Start',
      summary: [`initial: ${model.initial || '(none)'}`],
      lineage: [],
    },
    'detail:start-edge': {
      id: 'detail:start-edge',
      kind: 'transition',
      title: 'new',
      summary: [`→ ${model.initial}`],
      lineage: [],
    },
  };
  for (const state of model.states()) {
    const key = `detail:state:${state.id}`;
    const lineage = lineageFor(snapshot, state.label) ?? lineageFor(snapshot, state.id) ?? [];
    details[key] = {
      id: key,
      kind: 'state',
      title: state.label,
      summary: [
        `id: ${state.label}`,
        state.id === model.initial ? 'initial' : '',
        state.final ? 'final' : '',
      ].filter((line) => line.length > 0),
      sentence: sentenceOf(lineage),
      lineage,
    };
  }
  for (const edge of model.transitions()) {
    const key = `detail:edge:${edge.from}|${edge.event}|${edge.to}`;
    const transition = findTransition(snapshot.graph, edge);
    const lineage = transition === undefined ? [] : lineageFor(snapshot, transition.id) ?? [];
    const condition = conditionText(snapshot, transition?.guard ?? edge.guard?.name);
    const summary = [
      `${edge.from} → ${edge.to}`,
      `event: ${edge.event}`,
      `actor: ${edge.actor}`,
    ];
    if (condition !== undefined) summary.push(`condition: ${condition}`);
    else if (edge.guard?.name) summary.push(`guard: ${edge.guard.name}`);
    details[key] = {
      id: key,
      kind: 'transition',
      title: edge.event,
      summary,
      condition,
      sentence: sentenceOf(lineage),
      lineage,
    };
  }
  return details;
}

function workflowDetails(
  model: Model,
  result: WorkflowResult,
  snapshot: SpecSnapshot,
): Record<string, DraftGraphHoverDetail> {
  const details: Record<string, DraftGraphHoverDetail> = {};
  const labelOf = (id: string) => model.states().find((state) => state.id === id)?.label ?? id;
  const startState = result.trace[0]?.from ?? model.initial;
  details['detail:step-node:0'] = stateStepDetail('detail:step-node:0', labelOf(startState), snapshot);
  result.trace.forEach((step, index) => {
    const nodeKey = `detail:step-node:${index + 1}`;
    if (step.accepted && step.to) {
      details[nodeKey] = stateStepDetail(nodeKey, labelOf(step.to), snapshot);
    } else {
      details[nodeKey] = {
        id: nodeKey,
        kind: 'refused',
        title: 'refused',
        summary: [`step ${step.n} refused`, `event: ${step.event}`],
        lineage: [],
      };
    }
    const edgeKey = `detail:step:${step.n}`;
    const transition = findTransitionByStep(snapshot.graph, step.from, step.event, step.to);
    const lineage = transition === undefined ? [] : lineageFor(snapshot, transition.id) ?? [];
    const condition = conditionText(snapshot, transition?.guard);
    const summary = [
      `step ${step.n}`,
      `${labelOf(step.from)} → ${step.to ? labelOf(step.to) : 'refused'}`,
      `event: ${step.event}`,
      step.text ? `text: ${step.text}` : '',
    ].filter((line) => line.length > 0);
    if (condition !== undefined) summary.push(`condition: ${condition}`);
    details[edgeKey] = {
      id: edgeKey,
      kind: 'step',
      title: step.event,
      summary,
      condition,
      sentence: sentenceOf(lineage) ?? (step.text || undefined),
      lineage,
    };
  });
  return details;
}

function stateStepDetail(id: string, label: string, snapshot: SpecSnapshot): DraftGraphHoverDetail {
  const lineage = lineageFor(snapshot, label) ?? [];
  return {
    id,
    kind: 'state',
    title: label,
    summary: [`state: ${label}`],
    sentence: sentenceOf(lineage),
    lineage,
  };
}

function lineageFor(snapshot: SpecSnapshot, id: string): TraceLink[] | undefined {
  return traceItem(snapshot, id)?.links;
}

function sentenceOf(lineage: readonly TraceLink[]): string | undefined {
  for (const link of lineage) {
    if (link.layer === 'sentence' && link.text) return link.text;
  }
  return undefined;
}

function conditionText(snapshot: SpecSnapshot, guard: string | undefined): string | undefined {
  if (guard === undefined || guard === '') return undefined;
  const entity = findEntity(snapshot.entities ?? [], guard);
  if (entity?.text) return entity.text;
  if (entity?.name) return entity.name;
  for (const fact of snapshot.facts ?? []) {
    if (fact.removed === true) continue;
    if (fact.type !== 'guard') continue;
    if (fact.condition === guard && fact.note) return fact.note;
  }
  return guard;
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function findTransition(
  graph: DraftGraph | undefined,
  edge: { from: string; event: string; to: string },
): GraphTransition | undefined {
  if (graph === undefined) return undefined;
  for (const transition of graph.transitions) {
    if (chartStateId(transition.from) !== edge.from) continue;
    if (chartStateId(transition.to) !== edge.to) continue;
    if (chartEventName(transition.event) !== edge.event && transition.event !== edge.event) continue;
    return transition;
  }
  return undefined;
}

function findTransitionByStep(
  graph: DraftGraph | undefined,
  from: string,
  event: string,
  to: string | null,
): GraphTransition | undefined {
  if (graph === undefined) return undefined;
  for (const transition of graph.transitions) {
    if (chartStateId(transition.from) !== chartStateId(from) && transition.from !== from) continue;
    if (chartEventName(transition.event) !== chartEventName(event) && transition.event !== event) continue;
    if (to !== null && chartStateId(transition.to) !== chartStateId(to) && transition.to !== to) continue;
    return transition;
  }
  return undefined;
}
