// Draft graph assembly, path cover, and the workflow-set draft.
// One accepted path per transition, plus one rejected path per forbidden fact.
// Agent-owned flows are kept. Gap findings are recomputed, not stored.
import type { Issue } from './issue.js';
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
import { pastParticiple } from './spec-entities.js';
import { visibleFacts } from './spec-facts.js';
import {
  WORKFLOW_ID_PATTERN,
  WORKFLOW_WORD_PATTERN,
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

export function buildGraph(entities: readonly Entity[], facts: readonly Fact[], existing: DraftGraph | undefined): GraphBuild {
  const assembled = assembleGraph(entities, facts, existing);
  const covered = proposeFlows(assembled, entities, facts, existing);
  const graph: DraftGraph = {
    objects: assembled.objects,
    states: assembled.states,
    transitions: assembled.transitions,
    flows: covered.flows,
  };
  return { graph, findings: [...assembled.findings, ...covered.findings, ...flowCoverage(graph, facts, entities)] };
}

export function graphLayerFindings(snapshot: SpecSnapshot): Finding[] {
  if (snapshot.graph === undefined) return [absentGraph()];
  const entities = snapshot.entities ?? [];
  const facts = snapshot.facts ?? [];
  const fresh = assembleGraph(entities, facts, snapshot.graph);
  if (!sameStructure(fresh, snapshot.graph)) {
    return [staleGraph(), ...fresh.findings];
  }
  return [...fresh.findings, ...flowCoverage(snapshot.graph, facts, entities)];
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
  const workflows: WorkflowSetDraft['workflows'][number][] = [];
  const findings: Finding[] = [];
  for (const flow of graph.flows) {
    const built = flowDraft(flow, graph, entities, facts, sentences, tagged);
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

function assembleGraph(entities: readonly Entity[], facts: readonly Fact[], existing: DraftGraph | undefined): Assembled {
  const live = currentFacts(facts);
  const findings: Finding[] = [];
  const transitionFacts: Fact[] = [];
  for (const fact of live) {
    if (fact.type !== 'transition') continue;
    if (!readyTransition(fact, entities, findings)) continue;
    transitionFacts.push(fact);
  }
  const ids = assignTransitionIds(transitionFacts, existing);
  const transitions: GraphTransition[] = [];
  for (const fact of transitionFacts) {
    const built = makeTransition(fact, live, entities, ids.get(fact.id) ?? 'tr1');
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
    if (fact.type !== 'initial' && fact.type !== 'final') continue;
    const named = namedState(fact, entities, findings);
    if (named === undefined) continue;
    rememberObject(objects, named.object);
    const state = ensureState(states, named.object, named.state);
    if (fact.type === 'initial') state.initial = true;
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
  for (const transition of assembled.transitions) {
    if (transition.from === transition.to || covered.has(transition.id)) continue;
    const id = freshFlowId(used);
    flows.push(acceptedFlow(id, [transition.id], assembled.transitions, 'rule'));
    covered.add(transition.id);
  }
  for (const fact of live) {
    if (fact.type !== 'forbidden' || keptForbidden.has(fact.id)) continue;
    const rejected = rejectedFlow(fact, assembled, entities, used);
    if (rejected !== undefined) flows.push(rejected);
  }
  return { flows, findings };
}

function keepRuleFlow(
  flow: SpecFlow,
  assembled: Assembled,
  entities: readonly Entity[],
  live: readonly Fact[],
  covered: ReadonlySet<string>,
  keptForbidden: ReadonlySet<string>,
): SpecFlow | undefined {
  if (flow.expect === 'accepted' && flow.transitions.length === 1) {
    const id = flow.transitions[0];
    if (id === undefined || covered.has(id)) return undefined;
    const transition = findTransition(assembled.transitions, id);
    if (transition === undefined || transition.from === transition.to) return undefined;
    return acceptedFlow(flow.id, [id], assembled.transitions, 'rule');
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
  if (flow.forbidden === undefined || findFact(live, flow.forbidden)?.type !== 'forbidden') return false;
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
    if (fact.type !== 'forbidden') continue;
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
      title: `Cannot ${event} ${object}`,
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
    title: `Cannot ${event} ${object}`,
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
): { workflow?: WorkflowSetDraft['workflows'][number]; problem?: string } {
  if (flow.expect === 'rejected' && flow.transitions.length === 0) return syntheticRejected(flow, graph, entities, facts, sentences, tagged);
  const transitions: GraphTransition[] = [];
  for (const id of flow.transitions) {
    const transition = findTransition(graph.transitions, id);
    if (transition === undefined) return { problem: `${flow.id} cites missing transition ${id}` };
    transitions.push(transition);
  }
  if (transitions.length === 0) return { problem: `${flow.id} has no transitions` };
  if (!chainObjects(transitions)) return { problem: `${flow.id} is not a linear path` };
  const nodes: { id: string; state: string }[] = [];
  const used = new Set<string>();
  const first = transitions[0];
  if (first === undefined) return { problem: `${flow.id} has no transitions` };
  const start = addNode(nodes, used, first.from);
  const edges: { from: string; event: string; to: string; text: string }[] = [];
  let cursor = start;
  for (const transition of transitions) {
    const current = nodes[nodes.length - 1];
    if (current === undefined || current.state !== transition.from) return { problem: `${flow.id} breaks at ${transition.id}` };
    const to = addNode(nodes, used, transition.to);
    edges.push({
      from: cursor,
      event: transition.event,
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
): { workflow?: WorkflowSetDraft['workflows'][number]; problem?: string } {
  const fact = flow.forbidden === undefined ? undefined : findFact(facts, flow.forbidden);
  if (fact === undefined || fact.type !== 'forbidden') return { problem: `${flow.id} has no forbidden fact` };
  const object = objectLabel(fact, entities);
  const event = actionLabel(fact, entities);
  if (object === undefined || event === undefined) return { problem: `${flow.id} has no object or action` };
  const initial = graph.states.find((state) => state.object === object && state.initial === true);
  if (initial === undefined) return { problem: `${flow.id} has no initial state on ${object}` };
  let to = pastParticiple(event, event);
  if (!WORKFLOW_WORD_PATTERN.test(to)) return { problem: `${flow.id} has no workflow name for ${event}` };
  if (to === initial.id) to = `${to}-refused`;
  const actor = fact.actor === undefined ? undefined : findEntity(entities, fact.actor);
  const sentence = sentenceFor(fact, sentences, tagged);
  const text = sentence !== undefined
    ? cleanClause(sentence.text)
    : `The ${actor?.name ?? 'actor'} cannot ${event} the ${object}`;
  const workflow: WorkflowSetDraft['workflows'][number] = {
    id: flow.id,
    title: flow.title,
    expect: 'rejected',
    start: initial.id,
    rejectAt: flow.rejectAt ?? 1,
    nodes: [
      { id: initial.id, state: initial.id },
      { id: to, state: to },
    ],
    edges: [{ from: initial.id, event, to, text }],
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

function readyTransition(fact: Fact, entities: readonly Entity[], findings: Finding[]): boolean {
  const object = resolveEntity(fact.object, 'object', entities, findings, fact.id);
  const action = resolveEntity(fact.action, 'action', entities, findings, fact.id);
  if (object === undefined || action === undefined || fact.to === undefined || fact.to === '') {
    if (fact.to === undefined || fact.to === '') {
      findings.push(blocked('type-mismatch', `${fact.id} has no target state`, [fact.id]));
    }
    return false;
  }
  if (fact.from === null || fact.from === undefined || fact.from === '') {
    findings.push({
      id: `transition-without-from:${fact.id}`,
      kind: 'gap',
      code: 'transition-without-from',
      severity: 'blocking',
      message: `${fact.id} has no source state`,
      refs: [fact.id, ...fact.sources],
    });
    return false;
  }
  if (!WORKFLOW_WORD_PATTERN.test(fact.from) || !WORKFLOW_WORD_PATTERN.test(fact.to)) {
    findings.push(blocked('vocabulary', `${fact.id} uses a state name that is not workflow vocabulary`, [fact.id]));
    return false;
  }
  if (object.name === undefined || action.name === undefined) return false;
  return true;
}

function makeTransition(fact: Fact, live: readonly Fact[], entities: readonly Entity[], id: string): { transition: GraphTransition; findings: Finding[] } {
  const findings: Finding[] = [];
  const object = findEntity(entities, fact.object ?? '');
  const action = findEntity(entities, fact.action ?? '');
  const performs = live.filter((item) => item.type === 'performs' && item.action === fact.action && item.status === 'current');
  const actorFact = performs[0];
  const actor = actorFact?.actor === undefined ? undefined : findEntity(entities, actorFact.actor);
  const guards = live.filter((item) => item.type === 'guard' && item.action === fact.action && item.status === 'current');
  const guardFact = guards[0];
  const guard = guardFact?.condition;
  if (actor?.name === undefined) {
    findings.push({
      id: `transition-without-actor:${id}`,
      kind: 'gap',
      code: 'transition-without-actor',
      severity: 'warning',
      message: `${id} has no actor`,
      refs: [id, fact.id],
    });
  }
  if (fact.from === fact.to) {
    findings.push(blocked('self-loop', `${id} links ${fact.from} to itself`, [id, fact.id]));
  }
  const factIds: string[] = [];
  for (const item of performs) factIds.push(item.id);
  factIds.push(fact.id);
  for (const item of guards) factIds.push(item.id);
  const transition: GraphTransition = {
    id,
    from: fact.from ?? '',
    event: action?.name ?? '',
    to: fact.to ?? '',
    object: object?.name ?? '',
    fact: fact.id,
    facts: unique(sortIds(factIds)),
  };
  if (actor?.name !== undefined) transition.actor = actor.name;
  if (guard !== undefined) transition.guard = guard;
  return { transition, findings };
}

function namedState(fact: Fact, entities: readonly Entity[], findings: Finding[]): { object: string; state: string } | undefined {
  const object = resolveEntity(fact.object, 'object', entities, findings, fact.id);
  if (object?.name === undefined || fact.state === undefined) return undefined;
  if (!WORKFLOW_WORD_PATTERN.test(fact.state)) {
    findings.push(blocked('vocabulary', `${fact.id} uses a state name that is not workflow vocabulary`, [fact.id]));
    return undefined;
  }
  return { object: object.name, state: fact.state };
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

function hasElse(transition: GraphTransition, transitions: readonly GraphTransition[], live: readonly Fact[], entities: readonly Entity[]): boolean {
  for (const other of transitions) {
    if (other.id === transition.id) continue;
    if (other.object !== transition.object || other.from !== transition.from || other.event !== transition.event) continue;
    if (other.guard !== transition.guard) return true;
  }
  for (const fact of live) {
    if (fact.type !== 'forbidden') continue;
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
    if ((fact.type === 'initial' || fact.type === 'final') && fact.state === state.id && objectLabel(fact, entities) === state.object) {
      ids.push(fact.id);
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
    title: chosen.map((transition) => `${capitalize(transition.event)} ${transition.object}`).join(' and '),
    expect: 'accepted',
    transitions: transitions.slice(),
    origin,
  };
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
  for (let index = 1; index < transitions.length; index += 1) {
    const previous = transitions[index - 1];
    const current = transitions[index];
    if (previous === undefined || current === undefined) return false;
    if (previous.object !== current.object || previous.to !== current.from) return false;
  }
  return transitions.length > 0;
}

function splitIndex(flow: SpecFlow, transitions: readonly GraphTransition[], at: string): { index?: number; problem?: string } {
  if (/^[1-9][0-9]*$/.test(at)) return { index: Number(at) - 1 };
  const index = flow.transitions.indexOf(at);
  if (index < 0 || findTransition(transitions, at) === undefined) return { problem: `unknown split point "${at}"` };
  return { index };
}

function assignTransitionIds(facts: readonly Fact[], existing: DraftGraph | undefined): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  for (const transition of existing?.transitions ?? []) used.add(transition.id);
  for (const fact of facts) {
    const previous = existing?.transitions.find((transition) => transition.fact === fact.id);
    if (previous === undefined) continue;
    assigned.set(fact.id, previous.id);
  }
  let max = 0;
  for (const id of used) {
    const number = Number(id.slice(2));
    if (Number.isInteger(number) && number > max) max = number;
  }
  for (const fact of facts) {
    if (assigned.has(fact.id)) continue;
    max += 1;
    const id = `tr${max}`;
    used.add(id);
    assigned.set(fact.id, id);
  }
  return assigned;
}

function resolveEntity(id: string | undefined, kind: Entity['kind'], entities: readonly Entity[], findings: Finding[], factId: string): Entity | undefined {
  if (id === undefined) {
    findings.push(blocked('type-mismatch', `${factId} needs ${kind}`, [factId]));
    return undefined;
  }
  const entity = findEntity(entities, id);
  if (entity === undefined) {
    findings.push(blocked('unknown-entity', `unknown entity ${id}`, [id, factId]));
    return undefined;
  }
  if (entity.status === 'rejected' || entity.status === 'stale') {
    findings.push(blocked('rejected-entity', `${id} is ${entity.status}`, [id, factId]));
    return undefined;
  }
  if (entity.kind !== kind) {
    findings.push(blocked('type-mismatch', `${id} is ${entity.kind}, not ${kind}`, [id, factId]));
    return undefined;
  }
  return entity;
}

function objectLabel(fact: Fact, entities: readonly Entity[]): string | undefined {
  const entity = fact.object === undefined ? undefined : findEntity(entities, fact.object);
  return entity?.status === 'rejected' || entity?.status === 'stale' ? undefined : entity?.name;
}

function actionLabel(fact: Fact, entities: readonly Entity[]): string | undefined {
  const entity = fact.action === undefined ? undefined : findEntity(entities, fact.action);
  return entity?.status === 'rejected' || entity?.status === 'stale' ? undefined : entity?.name;
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

function addNode(nodes: { id: string; state: string }[], used: Set<string>, state: string): string {
  if (!used.has(state)) {
    used.add(state);
    nodes.push({ id: state, state });
    return state;
  }
  let number = 2;
  while (used.has(`${state}-${number}`)) number += 1;
  const id = `${state}-${number}`;
  used.add(id);
  nodes.push({ id, state });
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

function staleGraph(): Finding {
  return blocked('stale-graph', 'the graph is stale because facts changed; run clew spec graph build', []);
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
    : code === 'stale-graph'
      ? 'stale'
      : code === 'uncovered-transition' || code === 'no-workflows' || code === 'forbidden-uncovered'
        ? 'coverage'
        : 'gap';
  return { id, kind, code, severity: 'blocking', message, refs };
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
    if (entity.kind === kind && entity.name === name && entity.status !== 'rejected' && entity.status !== 'stale') return entity;
  }
  return undefined;
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
