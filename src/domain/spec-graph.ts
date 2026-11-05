// Unfold from Spec/facts, path cover, and the workflow-set draft.
// One accepted flow covers every transition on an object. Cross-object stitch is a short scenario.
// Flows overlay is keyed by fact id so split/group survive a rebuild.
// Gap findings are recomputed, not stored. There is no stale-graph.
import type { Issue } from './issue.js';
import { chartEventName, chartStateId } from './model.js';
import type {
  DraftGraph,
  Entity,
  Fact,
  Finding,
  GraphState,
  GraphTransition,
  Sentence,
  SpecFlow,
  SpecSnapshot,
  TaggedSentence,
  Token,
} from './spec.js';
import { assembleSpecFromFacts, eventFromAction, isActionFact, overlayOf, specFromFacts, varNameForEntity, visibleFacts } from './spec-facts.js';
import type { Spec, SpecDraft } from './spec-model.js';
import { exploreSpecComponents } from './spec-model.js';
import {
  apply,
  DEFAULT_REACH_BOUND,
  holds,
  type Patch,
  type Predicate,
  type Valuation,
  type Value,
} from './valuation.js';
import {
  copyPatch,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_WORD_PATTERN,
  type WorkflowNodeDraft,
  type WorkflowSetDraft,
} from './workflow.js';

export interface GraphBuild {
  graph: DraftGraph;
  findings: Finding[];
}

export interface GraphEdit {
  graph?: DraftGraph;
  findings: Finding[];
  problem?: string;
  changed: string[];
}

interface Assembled {
  objects: string[];
  states: GraphState[];
  transitions: GraphTransition[];
  findings: Finding[];
}

export function buildGraph(
  entities: readonly Entity[],
  facts: readonly Fact[],
  existing: DraftGraph | undefined,
  bound = DEFAULT_REACH_BOUND,
): GraphBuild {
  const assembled = assembleGraph(entities, facts);
  const covered = proposeFlows(assembled, entities, facts, existing);
  const graph: DraftGraph = {
    objects: assembled.objects,
    states: assembled.states,
    transitions: assembled.transitions,
    flows: covered.flows,
  };
  return {
    graph,
    findings: [...assembled.findings, ...truncationFindings(entities, facts, bound), ...covered.findings, ...flowCoverage(graph, facts, entities)],
  };
}

export function graphLayerFindings(snapshot: SpecSnapshot, bound = DEFAULT_REACH_BOUND): Finding[] {
  if (snapshot.graph === undefined) return [absentGraph()];
  const entities = snapshot.entities ?? [];
  const facts = snapshot.facts ?? [];
  const fresh = assembleGraph(entities, facts);
  const graph: DraftGraph = {
    objects: fresh.objects,
    states: fresh.states,
    transitions: fresh.transitions,
    flows: snapshot.graph.flows,
  };
  return [...fresh.findings, ...truncationFindings(entities, facts, bound), ...flowCoverage(graph, facts, entities)];
}

/** Persistable overlay: flows keyed by fact id. States and transitions are recomputed on read. */
export function overlayGraph(graph: DraftGraph | undefined): DraftGraph | undefined {
  if (graph === undefined) return undefined;
  const flows: SpecFlow[] = [];
  for (const flow of graph.flows) flows.push(copyFlow(flow));
  return { objects: [], states: [], transitions: [], flows };
}

/** Recompute states and transitions from facts. Keep the stored flow overlay as-is. */
export function attachOverlay(entities: readonly Entity[], facts: readonly Fact[], flows: readonly SpecFlow[]): DraftGraph {
  const assembled = assembleGraph(entities, facts);
  const kept: SpecFlow[] = [];
  for (const flow of flows) kept.push(copyFlow(flow));
  return {
    objects: assembled.objects,
    states: assembled.states,
    transitions: assembled.transitions,
    flows: kept,
  };
}

export function chartDraftFromFacts(entities: readonly Entity[], facts: readonly Fact[]): SpecDraft {
  const draft = specFromFacts(entities, facts);
  return {
    id: draft.id,
    vars: draft.vars,
    initial: draft.initial,
    actions: draft.actions,
    labels: labelsFromFacts(entities, facts, draft),
  };
}

export function splitFlow(graph: DraftGraph, flowId: string, at: string): GraphEdit {
  const flow = findFlow(graph.flows, flowId);
  if (flow === undefined) return { findings: [], problem: `unknown flow "${flowId}"`, changed: [] };
  if (flow.expect === 'rejected') {
    return { findings: [blocked('rejected-split', `${flowId} is a rejected flow; split an accepted path`, [flowId])], changed: [] };
  }
  const point = splitIndex(flow, graph.transitions, at);
  if (point.problem !== undefined) return { findings: [], problem: point.problem, changed: [] };
  if (point.index === undefined || point.index < 1 || point.index >= flow.transitions.length) {
    return {
      findings: [blocked('unsplittable', `${flowId} cannot be split at ${at}; the second path needs at least one edge and the first must keep one`, [flowId])],
      changed: [],
    };
  }
  const head = flow.transitions.slice(0, point.index);
  const tail = flow.transitions.slice(point.index);
  const used = flowIds(graph.flows);
  const nextId = freshFlowId(used);
  const headFlow = acceptedFlow(flow.id, head, graph.transitions, 'agent');
  const tailFlow = acceptedFlow(nextId, tail, graph.transitions, 'agent');
  const flows: SpecFlow[] = [];
  for (const item of graph.flows) {
    if (item.id === flow.id) flows.push(headFlow);
    else flows.push(copyFlow(item));
  }
  flows.push(tailFlow);
  return { graph: replaceFlows(graph, flows), findings: [], changed: [flow.id, nextId] };
}

export interface GroupRequest {
  flowIds?: string[];
  transitionIds?: string[];
  title?: string;
  into?: string;
}

export function groupFlows(graph: DraftGraph, request: GroupRequest): GraphEdit {
  if (request.flowIds !== undefined && request.flowIds.length > 0) return groupByFlows(graph, request.flowIds, request.title, request.into);
  if (request.transitionIds !== undefined && request.transitionIds.length > 0) return groupByTransitions(graph, request.transitionIds, request.title, request.into);
  return { findings: [], problem: 'group needs flows or transitions', changed: [] };
}

export function toWorkflowSetDraft(
  graph: DraftGraph,
  entities: readonly Entity[],
  facts: readonly Fact[],
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
): { draft?: WorkflowSetDraft; findings: Finding[] } {
  const spec = assembleSpecFromFacts(entities, facts);
  const workflows: WorkflowSetDraft['workflows'][number][] = [];
  const findings: Finding[] = [];
  for (const flow of graph.flows) {
    const built = flowDraft(flow, graph, entities, facts, sentences, tagged, spec);
    if (built.problem !== undefined) {
      findings.push(blocked('path-not-linear', built.problem, [flow.id, ...flow.transitions]));
      continue;
    }
    if (built.workflow !== undefined) workflows.push(built.workflow);
  }
  if (workflows.length === 0) return { findings };
  return { draft: { id: workflowSetId(graph.objects), workflows }, findings };
}

export function workflowCheckFindings(issues: readonly Issue[], draft: WorkflowSetDraft, graph: DraftGraph, facts: readonly Fact[]): Finding[] {
  const findings: Finding[] = [];
  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index];
    if (issue === undefined) continue;
    const workflowIndex = typeof issue.path[1] === 'number' ? issue.path[1] : undefined;
    const workflow = workflowIndex === undefined ? undefined : draft.workflows[workflowIndex];
    const refs: string[] = [];
    if (workflow !== undefined) {
      refs.push(workflow.id);
      const flow = findFlow(graph.flows, workflow.id);
      if (flow !== undefined) {
        for (const transitionId of flow.transitions) {
          refs.push(transitionId);
          const transition = findTransition(graph.transitions, transitionId);
          if (transition === undefined) continue;
          for (const factId of transition.facts) {
            refs.push(factId);
            const fact = findFact(facts, factId);
            if (fact === undefined) continue;
            for (const source of fact.sources) refs.push(source);
          }
        }
        if (flow.forbidden !== undefined) refs.push(flow.forbidden);
      }
    }
    findings.push({
      id: `workflow-check:${index}`,
      kind: 'gap',
      code: 'workflow-check',
      severity: 'blocking',
      message: issue.message,
      refs: unique(refs),
    });
  }
  return findings;
}

export function sameGraph(left: DraftGraph | undefined, right: DraftGraph | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameStructure(left, right) && sameFlows(left.flows, right.flows);
}

export function workflowSetId(objects: readonly string[]): string {
  const first = objects[0];
  if (first === undefined) return 'flows';
  let id = first;
  for (let index = 1; index < objects.length; index += 1) {
    const name = objects[index];
    if (name === undefined) continue;
    id += `And${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  return `${id}Flows`;
}

function assembleGraph(entities: readonly Entity[], facts: readonly Fact[]): Assembled {
  const live = currentFacts(facts);
  const findings: Finding[] = [];
  const initial = specFromFacts(entities, facts).initial;
  const actionFacts: Fact[] = [];
  for (const fact of live) {
    if (!isActionFact(fact)) continue;
    if (!readyAction(fact, entities, initial, findings)) continue;
    actionFacts.push(fact);
  }
  const transitions: GraphTransition[] = [];
  for (const fact of actionFacts) {
    if (!isActionFact(fact)) continue;
    const built = makeTransition(fact, live, entities, initial, fact.id);
    if (built === undefined) continue;
    transitions.push(built.transition);
    for (const finding of built.findings) findings.push(finding);
  }
  const states: GraphState[] = [];
  const objects: string[] = [];
  for (const transition of transitions) {
    rememberObject(objects, transition.object);
    ensureState(states, transition.object, transition.from);
    ensureState(states, transition.object, transition.to);
  }
  for (const fact of live) {
    if (fact.kind !== 'init' && fact.kind !== 'terminal') continue;
    const named = namedState(fact, entities, findings);
    if (named === undefined) continue;
    rememberObject(objects, named.object);
    const state = ensureState(states, named.object, named.state);
    if (fact.kind === 'init') state.initial = true;
    else state.final = true;
  }
  for (const state of states) state.facts = factsForState(state, live, entities, transitions);
  for (const finding of reachability(states, transitions, objects)) findings.push(finding);
  for (const finding of guardFindings(transitions, live, entities)) findings.push(finding);
  for (const finding of sameStateNames(states)) findings.push(finding);
  return { objects, states, transitions, findings };
}

function proposeFlows(assembled: Assembled, entities: readonly Entity[], facts: readonly Fact[], existing: DraftGraph | undefined): { flows: SpecFlow[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const live = currentFacts(facts);
  const covered = new Set<string>();
  const keptForbidden = new Set<string>();
  const validAgent = new Set<string>();
  for (const flow of existing?.flows ?? []) {
    if (flow.origin !== 'agent') continue;
    if (flow.expect === 'rejected') {
      if (!rejectedFlowHolds(flow, assembled.transitions, live)) {
        findings.push(staleFlow(flow.id));
        continue;
      }
      validAgent.add(flow.id);
      if (flow.forbidden !== undefined) keptForbidden.add(flow.forbidden);
      findings.push(agentFlow(flow.id));
      continue;
    }
    if (!acceptedChain(flow, assembled.transitions)) {
      findings.push(staleFlow(flow.id));
      continue;
    }
    validAgent.add(flow.id);
    for (const id of flow.transitions) covered.add(id);
    findings.push(agentFlow(flow.id));
  }
  const flows: SpecFlow[] = [];
  const used = new Set<string>();
  for (const flow of existing?.flows ?? []) {
    if (flow.origin === 'agent') {
      if (!validAgent.has(flow.id)) continue;
      flows.push(copyFlow(flow));
      used.add(flow.id);
      continue;
    }
    const kept = keepRuleFlow(flow, assembled, entities, live, covered, keptForbidden);
    if (kept === undefined) continue;
    flows.push(kept);
    used.add(kept.id);
    if (kept.expect === 'accepted') {
      for (const id of kept.transitions) covered.add(id);
    } else if (kept.forbidden !== undefined) keptForbidden.add(kept.forbidden);
  }
  for (const flow of coverAcceptedPaths(assembled.transitions, live, entities, covered, used)) {
    flows.push(flow);
  }
  for (const fact of live) {
    if (fact.kind !== 'forbidden' || keptForbidden.has(fact.id)) continue;
    const rejected = rejectedFlow(fact, assembled, entities, used);
    if (rejected !== undefined) flows.push(rejected);
  }
  return { flows, findings };
}

function coverAcceptedPaths(
  transitions: readonly GraphTransition[],
  live: readonly Fact[],
  entities: readonly Entity[],
  covered: Set<string>,
  used: Set<string>,
): SpecFlow[] {
  const uncovered: GraphTransition[] = [];
  for (const transition of transitions) {
    if (transition.from === transition.to || covered.has(transition.id)) continue;
    if (!provableTransition(transition, transitions, live, entities)) continue;
    uncovered.push(transition);
  }
  const byObject = new Map<string, GraphTransition[]>();
  for (const transition of uncovered) {
    const list = byObject.get(transition.object) ?? [];
    list.push(transition);
    byObject.set(transition.object, list);
  }
  const flows: SpecFlow[] = [];
  for (const locals of byObject.values()) {
    locals.sort((left, right) => factNumber(left.fact) - factNumber(right.fact));
    const path = coverObjectLifecycle(locals);
    if (path.length === 0) continue;
    for (const id of path) covered.add(id);
    flows.push(acceptedFlow(freshFlowId(used), path, transitions, 'rule'));
  }
  return stitchScenarios(flows, transitions, used);
}

function coverObjectLifecycle(locals: readonly GraphTransition[]): string[] {
  const open = new Set<string>();
  for (const transition of locals) open.add(transition.id);
  const path: string[] = [];
  while (open.size > 0) {
    const start = pickLifecycleStart(locals, open);
    if (start === undefined) {
      for (const transition of locals) {
        if (!open.has(transition.id)) continue;
        path.push(transition.id);
        open.delete(transition.id);
      }
      break;
    }
    const grown = growLifecycle(start, locals, open);
    for (const id of grown) {
      path.push(id);
      open.delete(id);
    }
  }
  return path;
}

function pickLifecycleStart(
  locals: readonly GraphTransition[],
  remaining: ReadonlySet<string>,
): GraphTransition | undefined {
  const tos = new Set<string>();
  for (const transition of locals) {
    if (remaining.has(transition.id)) tos.add(transition.to);
  }
  let fallback: GraphTransition | undefined;
  for (const transition of locals) {
    if (!remaining.has(transition.id)) continue;
    if (fallback === undefined) fallback = transition;
    if (!tos.has(transition.from)) return transition;
  }
  return fallback;
}

function growLifecycle(
  start: GraphTransition,
  locals: readonly GraphTransition[],
  remaining: ReadonlySet<string>,
): string[] {
  const path = [start.id];
  const used = new Set<string>([start.id]);
  let cursor = start.to;
  while (true) {
    const next: GraphTransition[] = [];
    for (const transition of locals) {
      if (!remaining.has(transition.id) || used.has(transition.id)) continue;
      if (transition.from === cursor) next.push(transition);
    }
    if (next.length !== 1) break;
    const step = next[0];
    if (step === undefined) break;
    path.push(step.id);
    used.add(step.id);
    cursor = step.to;
  }
  return path;
}

function stitchScenarios(
  flows: readonly SpecFlow[],
  transitions: readonly GraphTransition[],
  used: Set<string>,
): SpecFlow[] {
  const accepted: SpecFlow[] = [];
  const rest: SpecFlow[] = [];
  for (const flow of flows) {
    if (flow.expect === 'accepted' && flow.origin === 'rule') accepted.push(flow);
    else rest.push(flow);
  }
  accepted.sort((left, right) => minFactNumber(left, transitions) - minFactNumber(right, transitions));
  const merged: SpecFlow[] = [];
  let index = 0;
  while (index < accepted.length) {
    const head = accepted[index];
    if (head === undefined) break;
    const path = head.transitions.slice();
    let cursor = index;
    while (cursor + 1 < accepted.length && path.length < 4) {
      const next = accepted[cursor + 1];
      if (next === undefined) break;
      if (!canStitch(path, next.transitions, transitions)) break;
      for (const id of next.transitions) path.push(id);
      cursor += 1;
    }
    if (cursor === index) merged.push(head);
    else merged.push(acceptedFlow(head.id, path, transitions, 'rule'));
    index = cursor + 1;
  }
  const keptIds = new Set<string>();
  for (const flow of merged) keptIds.add(flow.id);
  for (const flow of accepted) {
    if (keptIds.has(flow.id)) continue;
    used.delete(flow.id);
  }
  return [...merged, ...rest];
}

function canStitch(
  leftIds: readonly string[],
  rightIds: readonly string[],
  transitions: readonly GraphTransition[],
): boolean {
  const left = lastTransition(leftIds, transitions);
  const right = firstTransition(rightIds, transitions);
  if (left === undefined || right === undefined) return false;
  if (left.object === right.object) return false;
  if (left.actor === undefined || right.actor === undefined) return false;
  if (left.actor === 'unspecified' || right.actor === 'unspecified') return false;
  return left.actor === right.actor;
}

function firstTransition(
  ids: readonly string[],
  transitions: readonly GraphTransition[],
): GraphTransition | undefined {
  const id = ids[0];
  return id === undefined ? undefined : findTransition(transitions, id);
}

function lastTransition(
  ids: readonly string[],
  transitions: readonly GraphTransition[],
): GraphTransition | undefined {
  const id = ids[ids.length - 1];
  return id === undefined ? undefined : findTransition(transitions, id);
}

function minFactNumber(flow: SpecFlow, transitions: readonly GraphTransition[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const id of flow.transitions) {
    const transition = findTransition(transitions, id);
    if (transition === undefined) continue;
    const number = factNumber(transition.fact);
    if (number < min) min = number;
  }
  return min;
}

function keepRuleFlow(
  flow: SpecFlow,
  assembled: Assembled,
  entities: readonly Entity[],
  live: readonly Fact[],
  covered: ReadonlySet<string>,
  keptForbidden: ReadonlySet<string>,
): SpecFlow | undefined {
  if (flow.expect === 'accepted' && flow.transitions.length > 0) {
    for (const id of flow.transitions) {
      if (covered.has(id)) return undefined;
      const transition = findTransition(assembled.transitions, id);
      if (transition === undefined || transition.from === transition.to) return undefined;
      if (!provableTransition(transition, assembled.transitions, live, entities)) return undefined;
    }
    if (!chainTransitions(flow.transitions, assembled.transitions)) return undefined;
    return acceptedFlow(flow.id, flow.transitions, assembled.transitions, 'rule');
  }
  if (flow.expect !== 'rejected' || flow.forbidden === undefined || keptForbidden.has(flow.forbidden)) return undefined;
  const fact = findFact(live, flow.forbidden);
  if (fact === undefined) return undefined;
  const refreshed = rejectedFlow(fact, assembled, entities, new Set());
  if (refreshed === undefined) return undefined;
  refreshed.id = flow.id;
  return refreshed;
}

function rejectedFlowHolds(flow: SpecFlow, transitions: readonly GraphTransition[], live: readonly Fact[]): boolean {
  if (flow.forbidden === undefined || findFact(live, flow.forbidden)?.kind !== 'forbidden') return false;
  for (const id of flow.transitions) {
    if (findTransition(transitions, id) === undefined) return false;
  }
  return true;
}

function flowCoverage(graph: DraftGraph, facts: readonly Fact[], entities: readonly Entity[]): Finding[] {
  const findings: Finding[] = [];
  const accepted = new Map<string, string[]>();
  for (const flow of graph.flows) {
    if (flow.expect !== 'accepted') continue;
    if (!acceptedChain(flow, graph.transitions)) {
      findings.push(blocked('path-not-linear', `${flow.id} is not a linear path`, [flow.id, ...flow.transitions]));
    }
    for (const id of flow.transitions) {
      const list = accepted.get(id) ?? [];
      list.push(flow.id);
      accepted.set(id, list);
    }
  }
  for (const transition of graph.transitions) {
    if (transition.from === transition.to) continue;
    const owners = accepted.get(transition.id) ?? [];
    if (owners.length === 0) {
      if (!provableTransition(transition, graph.transitions, currentFacts(facts), entities)) continue;
      findings.push(blocked('uncovered-transition', `${transition.id} is not on an accepted path`, [transition.id]));
    } else if (owners.length > 1) {
      findings.push(blocked('overlap', `${transition.id} is on ${owners.join(' and ')}`, [transition.id, ...owners]));
    }
  }
  for (const flow of graph.flows) {
    for (const id of flow.transitions) {
      if (findTransition(graph.transitions, id) === undefined) {
        findings.push(blocked('missing-transition', `${flow.id} cites missing transition ${id}`, [flow.id, id]));
      }
    }
    if (flow.expect !== 'rejected') continue;
    const edges = flow.transitions.length === 0 && flow.forbidden !== undefined ? 1 : flow.transitions.length;
    if (flow.rejectAt === undefined || flow.rejectAt < 1 || flow.rejectAt > edges) {
      findings.push(blocked('missing-reject-at', `${flow.id} is rejected and needs rejectAt on its path`, [flow.id]));
    }
  }
  for (const fact of currentFacts(facts)) {
    if (fact.kind !== 'forbidden') continue;
    let covered = false;
    for (const flow of graph.flows) {
      if (flow.expect === 'rejected' && flow.forbidden === fact.id) covered = true;
    }
    if (covered) continue;
    const object = objectLabel(fact, entities);
    findings.push(blocked(
      'forbidden-uncovered',
      object === undefined
        ? `${fact.id} has no rejected path`
        : `${fact.id} has no rejected path; ${object} needs an initial state or a matching transition`,
      [fact.id],
    ));
  }
  if (graph.flows.length === 0) {
    findings.push(blocked('no-workflows', 'the graph has no flows to emit', []));
  }
  return findings;
}

function groupByFlows(graph: DraftGraph, ids: readonly string[], title: string | undefined, into: string | undefined): GraphEdit {
  if (ids.length < 2) return { findings: [], problem: 'group needs at least two flows', changed: [] };
  const chosen: SpecFlow[] = [];
  for (const id of ids) {
    const flow = findFlow(graph.flows, id);
    if (flow === undefined) return { findings: [], problem: `unknown flow "${id}"`, changed: [] };
    if (flow.expect === 'rejected') {
      return { findings: [blocked('rejected-group', `${id} is rejected; group accepted paths only`, [id])], changed: [] };
    }
    chosen.push(flow);
  }
  const transitions: string[] = [];
  for (const flow of chosen) {
    for (const id of flow.transitions) transitions.push(id);
  }
  if (!chainTransitions(transitions, graph.transitions)) {
    return { findings: [blocked('not-linear', `${ids.join(' then ')} do not form one linear path`, [...ids])], changed: [] };
  }
  const survivor = into ?? chosen[0]?.id ?? 'W1';
  if (!WORKFLOW_ID_PATTERN.test(survivor)) return { findings: [], problem: `flow id "${survivor}" is not a workflow id`, changed: [] };
  const occupied = findFlow(graph.flows, survivor);
  if (occupied !== undefined && !ids.includes(survivor)) {
    return { findings: [blocked('duplicate-flow', `${survivor} already exists`, [survivor])], changed: [] };
  }
  const titles: string[] = [];
  for (const flow of chosen) titles.push(flow.title);
  const flow = acceptedFlow(survivor, transitions, graph.transitions, 'agent');
  flow.title = title ?? titles.join(' and ');
  const drop = new Set(ids);
  const flows: SpecFlow[] = [];
  let placed = false;
  for (const item of graph.flows) {
    if (item.id === survivor) {
      flows.push(flow);
      placed = true;
      continue;
    }
    if (drop.has(item.id)) continue;
    flows.push(copyFlow(item));
  }
  if (!placed) flows.push(flow);
  return { graph: replaceFlows(graph, flows), findings: [], changed: [survivor] };
}

function groupByTransitions(graph: DraftGraph, transitionIds: readonly string[], title: string | undefined, into: string | undefined): GraphEdit {
  if (transitionIds.length < 2) return { findings: [], problem: 'group needs at least two transitions', changed: [] };
  for (const id of transitionIds) {
    if (findTransition(graph.transitions, id) === undefined) return { findings: [], problem: `unknown transition "${id}"`, changed: [] };
  }
  if (!chainTransitions(transitionIds, graph.transitions)) {
    return { findings: [blocked('not-linear', `${transitionIds.join(' then ')} do not form one linear path`, [...transitionIds])], changed: [] };
  }
  const subset: SpecFlow[] = [];
  for (const flow of graph.flows) {
    if (flow.expect !== 'accepted') continue;
    if (isSubset(flow.transitions, transitionIds)) subset.push(flow);
    else if (overlaps(flow.transitions, transitionIds)) {
      return { findings: [blocked('overlap', `${flow.id} shares some transitions and keeps others`, [flow.id, ...transitionIds])], changed: [] };
    }
  }
  const survivor = into ?? subset[0]?.id ?? freshFlowId(flowIds(graph.flows));
  if (!WORKFLOW_ID_PATTERN.test(survivor)) return { findings: [], problem: `flow id "${survivor}" is not a workflow id`, changed: [] };
  const occupied = findFlow(graph.flows, survivor);
  const replacing = subset.some((flow) => flow.id === survivor);
  if (occupied !== undefined && !replacing) {
    return { findings: [blocked('duplicate-flow', `${survivor} already exists`, [survivor])], changed: [] };
  }
  const flow = acceptedFlow(survivor, transitionIds, graph.transitions, 'agent');
  if (title !== undefined) flow.title = title;
  const drop = new Set<string>();
  for (const item of subset) drop.add(item.id);
  const flows: SpecFlow[] = [];
  let placed = false;
  for (const item of graph.flows) {
    if (item.id === survivor) {
      flows.push(flow);
      placed = true;
      continue;
    }
    if (drop.has(item.id)) continue;
    flows.push(copyFlow(item));
  }
  if (!placed) flows.push(flow);
  return { graph: replaceFlows(graph, flows), findings: [], changed: [survivor] };
}

function rejectedFlow(fact: Fact, assembled: Assembled, entities: readonly Entity[], used: Set<string>): SpecFlow | undefined {
  const object = objectLabel(fact, entities);
  const event = actionLabel(fact, entities);
  if (object === undefined || event === undefined) return undefined;
  const matched = assembled.transitions.find((transition) => transition.object === object && transition.event === event);
  const id = freshFlowId(used);
  if (matched !== undefined) {
    return {
      id,
      title: `Cannot ${eventWords(event)} ${object}`,
      expect: 'rejected',
      rejectAt: 1,
      transitions: [matched.id],
      forbidden: fact.id,
      origin: 'rule',
    };
  }
  const initial = assembled.states.find((state) => state.object === object && state.initial === true);
  if (initial === undefined) return undefined;
  return {
    id,
    title: `Cannot ${eventWords(event)} ${object}`,
    expect: 'rejected',
    rejectAt: 1,
    transitions: [],
    forbidden: fact.id,
    origin: 'rule',
  };
}

function flowDraft(
  flow: SpecFlow,
  graph: DraftGraph,
  entities: readonly Entity[],
  facts: readonly Fact[],
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  spec: Spec | undefined,
): { workflow?: WorkflowSetDraft['workflows'][number]; problem?: string } {
  if (flow.expect === 'rejected' && flow.transitions.length === 0) {
    return syntheticRejected(flow, graph, entities, facts, sentences, tagged, spec);
  }
  const transitions: GraphTransition[] = [];
  for (const id of flow.transitions) {
    const transition = findTransition(graph.transitions, id);
    if (transition === undefined) return { problem: `${flow.id} cites missing transition ${id}` };
    transitions.push(transition);
  }
  if (transitions.length === 0) return { problem: `${flow.id} has no transitions` };
  if (!chainObjects(transitions)) return { problem: `${flow.id} is not a linear path` };
  const walked = walkValuations(spec, transitions, facts);
  if (walked.problem !== undefined) return { problem: `${flow.id} ${walked.problem}` };
  const nodes: WorkflowNodeDraft[] = [];
  const used = new Set<string>();
  const first = transitions[0];
  if (first === undefined || walked.assigns[0] === undefined) return { problem: `${flow.id} has no transitions` };
  const start = addNode(nodes, used, first.from, walked.assigns[0]);
  const edges: { from: string; event: string; to: string; text: string }[] = [];
  let cursor = start;
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    const nextAssign = walked.assigns[index + 1];
    if (transition === undefined || nextAssign === undefined) return { problem: `${flow.id} breaks at ${transition?.id ?? 'end'}` };
    const current = nodes[nodes.length - 1];
    if (current === undefined) return { problem: `${flow.id} breaks at ${transition.id}` };
    const to = addNode(nodes, used, transition.to, nextAssign);
    edges.push({
      from: cursor,
      event: chartEventName(transition.event),
      to,
      text: transitionText(transition, flow, entities, facts, sentences, tagged),
    });
    cursor = to;
  }
  const workflow: WorkflowSetDraft['workflows'][number] = {
    id: flow.id,
    title: flow.title,
    expect: flow.expect,
    start,
    nodes,
    edges,
  };
  if (flow.expect === 'rejected' && flow.rejectAt !== undefined) workflow.rejectAt = flow.rejectAt;
  return { workflow };
}

function syntheticRejected(
  flow: SpecFlow,
  graph: DraftGraph,
  entities: readonly Entity[],
  facts: readonly Fact[],
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  spec: Spec | undefined,
): { workflow?: WorkflowSetDraft['workflows'][number]; problem?: string } {
  const fact = flow.forbidden === undefined ? undefined : findFact(facts, flow.forbidden);
  if (fact === undefined || fact.kind !== 'forbidden') return { problem: `${flow.id} has no forbidden fact` };
  const object = objectLabel(fact, entities);
  const event = actionLabel(fact, entities);
  if (object === undefined || event === undefined) return { problem: `${flow.id} has no object or action` };
  const initial = graph.states.find((state) => state.object === object && state.initial === true);
  if (initial === undefined) return { problem: `${flow.id} has no initial state on ${object}` };
  let to = attemptedAtom(fact) ?? event.toLowerCase().replace(/_/g, '-');
  if (!WORKFLOW_WORD_PATTERN.test(to)) return { problem: `${flow.id} has no workflow name for ${event}` };
  if (to === initial.id) to = `${to}-refused`;
  const actor = fact.actor === undefined ? undefined : findEntity(entities, fact.actor);
  const sentence = sentenceFor(fact, sentences, tagged);
  const text = sentence !== undefined
    ? cleanClause(sentence.text)
    : `The ${actor?.name ?? 'actor'} cannot ${event} the ${object}`;
  const startAssign = spec === undefined
    ? phaseAssign(initial.id)
    : patchFromValuation(startFromWhen(spec, fact.when));
  const endAssign = spec === undefined
    ? phaseAssign(to)
    : patchFromValuation(applyAttempt(spec, startFromWhen(spec, fact.when), fact.assign ?? {}));
  const workflow: WorkflowSetDraft['workflows'][number] = {
    id: flow.id,
    title: flow.title,
    expect: 'rejected',
    start: initial.id,
    rejectAt: flow.rejectAt ?? 1,
    nodes: [
      { id: initial.id, assign: startAssign },
      { id: to, assign: endAssign },
    ],
    edges: [{ from: initial.id, event: chartEventName(event), to, text }],
  };
  return { workflow };
}

function transitionText(
  transition: GraphTransition,
  flow: SpecFlow,
  entities: readonly Entity[],
  facts: readonly Fact[],
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
): string {
  if (flow.expect === 'rejected' && flow.forbidden !== undefined) {
    const forbidden = findFact(facts, flow.forbidden);
    const sentence = forbidden === undefined ? undefined : sentenceFor(forbidden, sentences, tagged);
    if (sentence !== undefined) return cleanClause(sentence.text);
    const actor = transition.actor ?? 'actor';
    return `The ${actor} cannot ${transition.event} the ${transition.object}`;
  }
  const fact = findFact(facts, transition.fact);
  const sentence = fact === undefined ? undefined : sentenceFor(fact, sentences, tagged);
  if (sentence === undefined) {
    const actor = transition.actor === undefined ? '' : `The ${transition.actor} `;
    return `${actor}${transition.event} ${transition.object}`.trim();
  }
  const item = findTagged(tagged, sentence.id);
  const action = findEntityByName(entities, 'action', transition.event);
  const object = findEntityByName(entities, 'object', transition.object);
  const actionToken = tokenFor(action, sentence, item);
  const objectToken = tokenAfter(object, sentence, item, actionToken);
  let text = sentence.text;
  if (item !== undefined && actionToken !== undefined) text = clauseSlice(sentence, item.clauses, actionToken, objectToken);
  text = cleanClause(text);
  if (transition.guard !== undefined) {
    const condition = findEntity(entities, transition.guard);
    if (condition?.text !== undefined && !text.toLowerCase().includes(condition.text.toLowerCase())) {
      text = `${text} if ${condition.text}`;
    }
  }
  return text;
}

function clauseSlice(sentence: Sentence, clauses: readonly string[], action: Token, object: Token | undefined): string {
  const spans: { text: string; start: number; end: number }[] = [];
  let search = 0;
  for (const clause of clauses) {
    const at = sentence.text.indexOf(clause, search);
    if (at < 0) continue;
    spans.push({ text: clause, start: at, end: at + clause.length });
    search = at + clause.length;
  }
  const origin = action.span[0] - sentence.span[0];
  let start = -1;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span !== undefined && origin >= span.start && origin < span.end) start = index;
  }
  if (start < 0) return sentence.text;
  let end = start;
  if (object !== undefined) {
    const target = object.span[0] - sentence.span[0];
    while (end < spans.length - 1) {
      const span = spans[end];
      if (span === undefined || target < span.end) break;
      end += 1;
    }
  }
  const parts: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const span = spans[index];
    if (span !== undefined) parts.push(span.text);
  }
  return parts.join(' ');
}

function cleanClause(text: string): string {
  let value = text.replace(/\s+/g, ' ').trim();
  value = value.replace(/[.?!]+$/g, '').replace(/[,:;]+$/g, '').trim();
  value = value.replace(/^(when|after|before|once)\s+/i, '');
  value = value.trim();
  if (value === '') return text.trim();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readyAction(fact: Fact, entities: readonly Entity[], initial: Patch, findings: Finding[]): boolean {
  if (!isActionFact(fact)) return false;
  const overlay = overlayOf(fact, entities, initial);
  if (overlay === undefined || overlay.to === '') {
    findings.push(blocked('type-mismatch', `${fact.id} has no target assign`, [fact.id]));
    return false;
  }
  if (overlay.from === undefined || overlay.from === '') {
    findings.push({
      id: `transition-without-from:${fact.id}`,
      kind: 'gap',
      code: 'transition-without-from',
      severity: 'blocking',
      message: `${fact.id} has no source valuation for ${overlay.object}`,
      refs: [fact.id, ...fact.sources],
    });
    return false;
  }
  if (!WORKFLOW_WORD_PATTERN.test(overlay.from) || !WORKFLOW_WORD_PATTERN.test(overlay.to)) {
    findings.push(blocked('vocabulary', `${fact.id} uses a state name that is not workflow vocabulary`, [fact.id]));
    return false;
  }
  return true;
}

function makeTransition(fact: Fact, _live: readonly Fact[], entities: readonly Entity[], initial: Patch, id: string): { transition: GraphTransition; findings: Finding[] } | undefined {
  if (!isActionFact(fact)) return undefined;
  const overlay = overlayOf(fact, entities, initial);
  if (overlay === undefined || overlay.from === undefined) return undefined;
  const findings: Finding[] = [];
  if (overlay.actor === undefined) {
    findings.push({
      id: `transition-without-actor:${id}`,
      kind: 'gap',
      code: 'transition-without-actor',
      severity: 'warning',
      message: `${id} has no actor`,
      refs: [id, fact.id],
    });
  }
  if (overlay.from === overlay.to) {
    findings.push(blocked('self-loop', `${id} links ${overlay.from} to itself`, [id, fact.id]));
  }
  const transition: GraphTransition = {
    id,
    from: overlay.from,
    event: overlay.event,
    to: overlay.to,
    object: overlay.object,
    fact: fact.id,
    facts: [fact.id],
  };
  if (overlay.actor !== undefined) transition.actor = overlay.actor;
  if (overlay.guard !== undefined) transition.guard = overlay.guard;
  return { transition, findings };
}

function namedState(fact: Fact, entities: readonly Entity[], findings: Finding[]): { object: string; state: string } | undefined {
  if (fact.assign === undefined) return undefined;
  for (const key of Object.keys(fact.assign)) {
    const value = fact.assign[key];
    if (value === undefined || value.t !== 'atom') continue;
    const entity = objectEntityNamed(key, entities);
    if (entity?.name === undefined) continue;
    if (!WORKFLOW_WORD_PATTERN.test(value.v)) {
      findings.push(blocked('vocabulary', `${fact.id} uses a state name that is not workflow vocabulary`, [fact.id]));
      return undefined;
    }
    return { object: entity.name, state: value.v };
  }
  return undefined;
}

function objectEntityNamed(varName: string, entities: readonly Entity[]): Entity | undefined {
  for (const entity of entities) {
    if (entity.kind !== 'object') continue;
    if (varNameForEntity(entity) === varName) return entity;
  }
  return undefined;
}

function attemptedAtom(fact: Fact): string | undefined {
  if (fact.assign === undefined) return undefined;
  for (const key of Object.keys(fact.assign)) {
    const value = fact.assign[key];
    if (value !== undefined && value.t === 'atom') return value.v;
  }
  return undefined;
}

function reachability(states: readonly GraphState[], transitions: readonly GraphTransition[], objects: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const object of objects) {
    const locals = states.filter((state) => state.object === object);
    const initials = locals.filter((state) => state.initial === true);
    if (initials.length === 0 && locals.length > 0) {
      findings.push({
        id: `no-initial-state:${object}`,
        kind: 'gap',
        code: 'no-initial-state',
        severity: 'warning',
        message: `${object} has no initial state`,
        refs: [object],
      });
    }
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const state of initials) {
      queue.push(state.id);
      seen.add(state.id);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const transition of transitions) {
        if (transition.object !== object || transition.from !== current || transition.from === transition.to) continue;
        if (seen.has(transition.to)) continue;
        seen.add(transition.to);
        queue.push(transition.to);
      }
    }
    if (initials.length > 0) {
      for (const state of locals) {
        if (seen.has(state.id)) continue;
        findings.push({
          id: `unreachable:${object}:${state.id}`,
          kind: 'gap',
          code: 'unreachable-state',
          severity: 'warning',
          message: `${state.id} is not reachable from an initial ${object} state`,
          refs: [state.id, object],
        });
      }
    }
    for (const state of locals) {
      let leaves = false;
      for (const transition of transitions) {
        if (transition.object === object && transition.from === state.id && transition.from !== transition.to) leaves = true;
      }
      if (leaves || state.final === true) continue;
      findings.push({
        id: `no-final-state:${object}:${state.id}`,
        kind: 'gap',
        code: 'no-final-state',
        severity: 'warning',
        message: `${state.id} has no outgoing transition and is not marked final`,
        refs: [state.id],
      });
    }
  }
  return findings;
}

function guardFindings(transitions: readonly GraphTransition[], live: readonly Fact[], entities: readonly Entity[]): Finding[] {
  const findings: Finding[] = [];
  for (const transition of transitions) {
    if (transition.guard === undefined) continue;
    // Condition entities are boolean vars, so false is the else value.
    if (transition.guard.startsWith('condition:')) continue;
    if (hasElse(transition, transitions, live, entities)) continue;
    const condition = findEntity(entities, transition.guard);
    const short = transition.guard.includes(':') ? transition.guard.split(':')[1] ?? transition.guard : transition.guard;
    const detail = condition?.text === undefined ? short : `${short} (${condition.text})`;
    findings.push(blocked(
      'guard-without-else',
      `${transition.event} is guarded by ${detail}; nothing says what happens to a ${transition.from} ${transition.object} otherwise`,
      [transition.id, transition.fact, transition.guard],
    ));
  }
  return findings;
}

function provableTransition(transition: GraphTransition, transitions: readonly GraphTransition[], live: readonly Fact[], entities: readonly Entity[]): boolean {
  if (transition.guard === undefined || transition.guard.startsWith('condition:')) return true;
  return hasElse(transition, transitions, live, entities);
}

function hasElse(transition: GraphTransition, transitions: readonly GraphTransition[], live: readonly Fact[], entities: readonly Entity[]): boolean {
  for (const other of transitions) {
    if (other.id === transition.id) continue;
    if (other.object !== transition.object || other.from !== transition.from || other.event !== transition.event) continue;
    if (other.guard !== transition.guard) return true;
  }
  for (const fact of live) {
    if (fact.kind !== 'forbidden') continue;
    if (objectLabel(fact, entities) === transition.object && actionLabel(fact, entities) === transition.event) return true;
  }
  return false;
}

function sameStateNames(states: readonly GraphState[]): Finding[] {
  const byName = new Map<string, string[]>();
  for (const state of states) {
    const list = byName.get(state.id) ?? [];
    if (!list.includes(state.object)) list.push(state.object);
    byName.set(state.id, list);
  }
  const findings: Finding[] = [];
  for (const [name, owners] of byName) {
    if (owners.length < 2) continue;
    findings.push({
      id: `same-state:${name}`,
      kind: 'gap',
      code: 'same-state-two-objects',
      severity: 'warning',
      message: `${name} is a state of ${owners.join(' and ')}`,
      refs: [name, ...owners],
    });
  }
  return findings;
}

function factsForState(state: GraphState, live: readonly Fact[], entities: readonly Entity[], transitions: readonly GraphTransition[]): string[] {
  const ids: string[] = [];
  for (const fact of live) {
    if ((fact.kind === 'init' || fact.kind === 'terminal') && objectLabel(fact, entities) === state.object) {
      const named = namedState(fact, entities, []);
      if (named?.state === state.id) ids.push(fact.id);
    }
  }
  for (const transition of transitions) {
    if (transition.object !== state.object) continue;
    if (transition.from === state.id || transition.to === state.id) ids.push(transition.fact);
  }
  return unique(sortIds(ids));
}

function acceptedFlow(id: string, transitions: readonly string[], all: readonly GraphTransition[], origin: SpecFlow['origin']): SpecFlow {
  const chosen: GraphTransition[] = [];
  for (const transitionId of transitions) {
    const transition = findTransition(all, transitionId);
    if (transition !== undefined) chosen.push(transition);
  }
  return {
    id,
    title: pathTitle(chosen),
    expect: 'accepted',
    transitions: transitions.slice(),
    origin,
  };
}

function pathTitle(chosen: readonly GraphTransition[]): string {
  const objects: string[] = [];
  for (const transition of chosen) {
    if (!objects.includes(transition.object)) objects.push(transition.object);
  }
  const first = chosen[0];
  if (first === undefined) return 'Workflow';
  if (chosen.length === 1) return `${capitalize(eventWords(first.event))} ${first.object}`;
  if (objects.length === 1) return `${capitalize(objects[0] ?? first.object)} lifecycle`;
  return `${objects.map((name) => capitalize(name)).join(' and ')} scenario`;
}

function acceptedChain(flow: SpecFlow, transitions: readonly GraphTransition[]): boolean {
  return flow.transitions.length > 0 && chainTransitions(flow.transitions, transitions);
}

function chainTransitions(ids: readonly string[], transitions: readonly GraphTransition[]): boolean {
  const chosen: GraphTransition[] = [];
  for (const id of ids) {
    const transition = findTransition(transitions, id);
    if (transition === undefined) return false;
    chosen.push(transition);
  }
  return chainObjects(chosen);
}

function chainObjects(transitions: readonly GraphTransition[]): boolean {
  return transitions.length > 0;
}

function splitIndex(flow: SpecFlow, transitions: readonly GraphTransition[], at: string): { index?: number; problem?: string } {
  if (/^[1-9][0-9]*$/.test(at)) return { index: Number(at) - 1 };
  const index = flow.transitions.indexOf(at);
  if (index < 0 || findTransition(transitions, at) === undefined) return { problem: `unknown split point "${at}"` };
  return { index };
}

function objectLabel(fact: Fact, entities: readonly Entity[]): string | undefined {
  if (isActionFact(fact)) return overlayOf(fact, entities, {})?.object;
  if (fact.assign === undefined) return undefined;
  for (const key of Object.keys(fact.assign)) {
    const entity = objectEntityNamed(key, entities);
    if (entity?.name !== undefined) return entity.name;
  }
  return undefined;
}

function actionLabel(fact: Fact, _entities: readonly Entity[]): string | undefined {
  if (isActionFact(fact)) return fact.event;
  if (fact.assign === undefined) return undefined;
  for (const key of Object.keys(fact.assign)) {
    const value = fact.assign[key];
    if (value !== undefined && value.t === 'atom') return value.v.replace(/-/g, '_').toUpperCase();
  }
  return undefined;
}

function sentenceFor(fact: Fact, sentences: readonly Sentence[], tagged: readonly TaggedSentence[]): Sentence | undefined {
  for (const source of fact.sources) {
    const direct = findSentence(sentences, source);
    if (direct !== undefined && direct.status === 'current') return direct;
    const tokenSentence = source.split('.')[0];
    if (tokenSentence === undefined) continue;
    const sentence = findSentence(sentences, tokenSentence);
    if (sentence !== undefined && sentence.status === 'current') {
      const item = findTagged(tagged, sentence.id);
      if (item === undefined) return sentence;
      for (const token of item.tokens) {
        if (token.id === source) return sentence;
      }
    }
  }
  return undefined;
}

function tokenFor(entity: Entity | undefined, sentence: Sentence, tagged: TaggedSentence | undefined): Token | undefined {
  if (entity === undefined || tagged === undefined) return undefined;
  for (const source of entity.sources) {
    for (const token of tagged.tokens) {
      if (token.id === source && token.span[0] >= sentence.span[0] && token.span[0] <= sentence.span[1]) return token;
    }
  }
  return undefined;
}

function tokenAfter(entity: Entity | undefined, sentence: Sentence, tagged: TaggedSentence | undefined, action: Token | undefined): Token | undefined {
  if (entity === undefined || tagged === undefined) return undefined;
  let fallback: Token | undefined;
  for (const source of entity.sources) {
    for (const token of tagged.tokens) {
      if (token.id !== source) continue;
      if (token.span[0] < sentence.span[0] || token.span[0] > sentence.span[1]) continue;
      if (action === undefined || token.span[0] >= action.span[0]) return token;
      fallback = token;
    }
  }
  return fallback;
}

function rememberObject(objects: string[], name: string): void {
  if (name !== '' && !objects.includes(name)) objects.push(name);
}

function ensureState(states: GraphState[], object: string, id: string): GraphState {
  for (const state of states) {
    if (state.object === object && state.id === id) return state;
  }
  const state: GraphState = { id, object, facts: [] };
  states.push(state);
  return state;
}

function phaseAssign(phase: string): Patch {
  return { phase: { t: 'atom', v: phase } };
}

function addNode(nodes: WorkflowNodeDraft[], used: Set<string>, state: string, assign: Patch): string {
  if (!used.has(state)) {
    used.add(state);
    nodes.push({ id: state, assign: copyPatch(assign) });
    return state;
  }
  let number = 2;
  while (used.has(`${state}-${number}`)) number += 1;
  const id = `${state}-${number}`;
  used.add(id);
  nodes.push({ id, assign: copyPatch(assign) });
  return id;
}

function replaceFlows(graph: DraftGraph, flows: SpecFlow[]): DraftGraph {
  return { objects: graph.objects.slice(), states: graph.states, transitions: graph.transitions, flows };
}

function sameStructure(left: { objects: readonly string[]; states: readonly GraphState[]; transitions: readonly GraphTransition[] }, right: { objects: readonly string[]; states: readonly GraphState[]; transitions: readonly GraphTransition[] }): boolean {
  if (!sameList(left.objects, right.objects) || left.states.length !== right.states.length || left.transitions.length !== right.transitions.length) return false;
  for (let index = 0; index < left.states.length; index += 1) {
    const a = left.states[index];
    const b = right.states[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.object !== b.object || a.initial !== b.initial || a.final !== b.final) return false;
    if (!sameList(a.facts, b.facts)) return false;
  }
  for (let index = 0; index < left.transitions.length; index += 1) {
    const a = left.transitions[index];
    const b = right.transitions[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.from !== b.from || a.event !== b.event || a.to !== b.to) return false;
    if (a.actor !== b.actor || a.guard !== b.guard || a.object !== b.object || a.fact !== b.fact) return false;
    if (!sameList(a.facts, b.facts)) return false;
  }
  return true;
}

function sameFlows(left: readonly SpecFlow[], right: readonly SpecFlow[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a.id !== b.id || a.title !== b.title || a.expect !== b.expect || a.rejectAt !== b.rejectAt) return false;
    if (a.forbidden !== b.forbidden || a.origin !== b.origin || !sameList(a.transitions, b.transitions)) return false;
  }
  return true;
}

function copyFlow(flow: SpecFlow): SpecFlow {
  const copy: SpecFlow = {
    id: flow.id,
    title: flow.title,
    expect: flow.expect,
    transitions: flow.transitions.slice(),
    origin: flow.origin,
  };
  if (flow.rejectAt !== undefined) copy.rejectAt = flow.rejectAt;
  if (flow.forbidden !== undefined) copy.forbidden = flow.forbidden;
  return copy;
}

function currentFacts(facts: readonly Fact[]): Fact[] {
  const live: Fact[] = [];
  for (const fact of visibleFacts(facts)) {
    if (fact.status === 'current') live.push(fact);
  }
  live.sort((left, right) => factNumber(left.id) - factNumber(right.id));
  return live;
}

function flowIds(flows: readonly SpecFlow[]): Set<string> {
  const used = new Set<string>();
  for (const flow of flows) used.add(flow.id);
  return used;
}

function freshFlowId(used: Set<string>): string {
  let number = 1;
  while (used.has(`W${number}`)) number += 1;
  const id = `W${number}`;
  used.add(id);
  return id;
}

function isSubset(values: readonly string[], universe: readonly string[]): boolean {
  if (values.length === 0) return false;
  for (const value of values) {
    if (!universe.includes(value)) return false;
  }
  return true;
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  for (const value of left) {
    if (right.includes(value)) return true;
  }
  return false;
}

function sortIds(ids: readonly string[]): string[] {
  return ids.slice().sort((left, right) => factNumber(left) - factNumber(right));
}

function factNumber(id: string): number {
  const number = Number(id.replace(/^[a-z]+/i, ''));
  return Number.isFinite(number) ? number : 0;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function capitalize(value: string): string {
  if (value === '') return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function absentGraph(): Finding {
  return {
    id: 'graph-absent',
    kind: 'coverage',
    code: 'graph-absent',
    severity: 'info',
    message: 'the graph layer has not been built',
    refs: [],
  };
}

function staleFlow(id: string): Finding {
  return {
    id: `stale:${id}`,
    kind: 'stale',
    code: 'stale-flow',
    severity: 'warning',
    message: `${id} is agent-owned but no longer matches the graph, so build dropped it`,
    refs: [id],
  };
}

function agentFlow(id: string): Finding {
  return {
    id: `conflict:${id}`,
    kind: 'conflict',
    code: 'agent-flow',
    severity: 'warning',
    message: `${id} is agent-owned; graph build did not overwrite it`,
    refs: [id],
  };
}

function blocked(code: string, message: string, refs: string[]): Finding {
  const suffix = refs[0];
  const id = suffix === undefined || suffix === code ? code : `${code}:${suffix}`;
  const kind = code === 'vocabulary'
    ? 'vocabulary'
    : code === 'uncovered-transition' || code === 'no-workflows' || code === 'forbidden-uncovered' || code === 'state-space-truncated'
      ? 'coverage'
      : 'gap';
  return { id, kind, code, severity: 'blocking', message, refs };
}

function truncationFindings(entities: readonly Entity[], facts: readonly Fact[], bound: number): Finding[] {
  const spec = assembleSpecFromFacts(entities, facts);
  if (spec === undefined) return [];
  const explored = exploreSpecComponents(spec, bound);
  const findings: Finding[] = [];
  for (const component of explored.components) {
    if (!component.reach.truncated) continue;
    findings.push(blocked(
      'state-space-truncated',
      `${component.key} truncated at ${component.reach.nodes.length} valuations`,
      [component.key],
    ));
  }
  if (findings.length === 0 && explored.globalCapHit) {
    findings.push(blocked('state-space-truncated', `state space truncated at ${bound} valuations`, []));
  }
  return findings;
}

function labelsFromFacts(entities: readonly Entity[], facts: readonly Fact[], draft: SpecDraft): SpecDraft['labels'] {
  const labels: SpecDraft['labels'][number][] = [];
  const used = new Set<string>();
  const terminals = new Set<string>();
  for (const fact of currentFacts(facts)) {
    if (fact.kind !== 'terminal' || fact.assign === undefined) continue;
    for (const key of Object.keys(fact.assign)) {
      const value = fact.assign[key];
      if (value?.t === 'atom') terminals.add(`${key}:${value.v}`);
    }
  }
  const atoms: { varName: string; atom: string }[] = [];
  for (const decl of draft.vars) {
    const initial = draft.initial[decl.id];
    if (initial?.t === 'atom') atoms.push({ varName: decl.id, atom: initial.v });
  }
  for (const fact of currentFacts(facts)) {
    if (!isActionFact(fact)) continue;
    const overlay = overlayOf(fact, entities, draft.initial);
    if (overlay === undefined) continue;
    const objectEntity = findEntityByName(entities, 'object', overlay.object);
    const name = objectEntity === undefined ? overlay.object.replace(/-/g, '_') : (varNameForEntity(objectEntity) ?? overlay.object.replace(/-/g, '_'));
    if (overlay.from !== undefined) atoms.push({ varName: name, atom: overlay.from });
    atoms.push({ varName: name, atom: overlay.to });
  }
  for (const item of atoms) {
    const key = `${item.varName}:${item.atom}`;
    const id = chartStateId(item.atom);
    if (used.has(id) || !WORKFLOW_WORD_PATTERN.test(item.atom)) continue;
    used.add(id);
    const match: Record<string, Value> = {};
    match[item.varName] = { t: 'atom', v: item.atom };
    labels.push({
      id,
      match,
      text: capitalize(item.atom.replace(/-/g, ' ')),
      final: terminals.has(key) ? true : undefined,
    });
  }
  return labels;
}

function walkValuations(
  spec: Spec | undefined,
  transitions: readonly GraphTransition[],
  facts: readonly Fact[],
): { assigns: Patch[]; problem?: string } {
  const actionFacts: Fact[] = [];
  for (const transition of transitions) {
    const fact = findFact(facts, transition.fact);
    if (fact === undefined || !isActionFact(fact)) return overlayAssigns(transitions);
    actionFacts.push(fact);
  }
  if (spec === undefined) return overlayAssigns(transitions);
  const first = actionFacts[0];
  const env = first !== undefined ? envEqs([first]) : {};
  let current = applySafe(spec.initial, env);
  if (first !== undefined && isActionFact(first) && !holds(first.when, current)) {
    current = applySafe(current, eqPatch(first.when));
  }
  const assigns: Patch[] = [patchFromValuation(current)];
  for (const fact of actionFacts) {
    if (!isActionFact(fact)) continue;
    if (!holds(fact.when, current)) current = applySafe(current, eqPatch(fact.when));
    current = applySafe(current, fact.assign);
    assigns.push(patchFromValuation(current));
  }
  return { assigns };
}

function overlayAssigns(transitions: readonly GraphTransition[]): { assigns: Patch[]; problem?: string } {
  const first = transitions[0];
  if (first === undefined) return { assigns: [], problem: 'has no transitions' };
  const assigns: Patch[] = [phaseAssign(first.from)];
  for (const transition of transitions) assigns.push(phaseAssign(transition.to));
  return { assigns };
}

function startFromWhen(spec: Spec, when: Predicate | undefined): Valuation {
  if (when === undefined) return spec.initial;
  return applySafe(spec.initial, eqPatch(when));
}

function applyAttempt(spec: Spec, from: Valuation, patch: Patch): Valuation {
  return applySafe(from, patch);
}

function applySafe(state: Valuation, patch: Patch): Valuation {
  try {
    return apply(state, patch);
  } catch {
    return state;
  }
}

function patchFromValuation(state: Valuation): Patch {
  const patch: Record<string, Value> = {};
  for (const [id, value] of state.entries()) patch[id] = value;
  return patch;
}

function eqPatch(predicate: Predicate): Patch {
  const patch: Record<string, Value> = {};
  collectEq(predicate, patch);
  return patch;
}

function collectEq(predicate: Predicate, patch: Record<string, Value>): void {
  if (predicate.op === 'eq') {
    patch[predicate.var] = predicate.value;
    return;
  }
  if (predicate.op === 'and') {
    for (const child of predicate.of) collectEq(child, patch);
  }
}

function envEqs(facts: readonly Fact[]): Patch {
  const assigned = new Set<string>();
  for (const fact of facts) {
    if (!isActionFact(fact)) continue;
    for (const key of Object.keys(fact.assign)) assigned.add(key);
  }
  const patch: Record<string, Value> = {};
  for (const fact of facts) {
    if (!isActionFact(fact)) continue;
    const eqs: Record<string, Value> = {};
    collectEq(fact.when, eqs);
    for (const key of Object.keys(eqs)) {
      const value = eqs[key];
      if (value === undefined || assigned.has(key)) continue;
      patch[key] = value;
    }
  }
  return patch;
}

function findFlow(flows: readonly SpecFlow[], id: string): SpecFlow | undefined {
  for (const flow of flows) {
    if (flow.id === id) return flow;
  }
  return undefined;
}

function findTransition(transitions: readonly GraphTransition[], id: string): GraphTransition | undefined {
  for (const transition of transitions) {
    if (transition.id === id) return transition;
  }
  return undefined;
}

function findFact(facts: readonly Fact[], id: string): Fact | undefined {
  for (const fact of facts) {
    if (fact.id === id) return fact;
  }
  return undefined;
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function findEntityByName(entities: readonly Entity[], kind: Entity['kind'], name: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.kind !== kind || entity.status === 'rejected' || entity.status === 'stale') continue;
    if (entity.name === name) return entity;
    if (kind === 'action' && eventFromAction(entity) === name) return entity;
  }
  return undefined;
}

function eventWords(event: string): string {
  return event.toLowerCase().replace(/_/g, ' ');
}

function findSentence(sentences: readonly Sentence[], id: string): Sentence | undefined {
  for (const sentence of sentences) {
    if (sentence.id === id) return sentence;
  }
  return undefined;
}

function findTagged(tagged: readonly TaggedSentence[], id: string): TaggedSentence | undefined {
  for (const item of tagged) {
    if (item.id === id) return item;
  }
  return undefined;
}
