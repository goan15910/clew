// A workflow set is a meta-graph: many named sub-graphs, each a linked list.
// Cross-field invariants are checked here. Zod does not belong in this layer.
import type { Issue } from './issue.js';

export const WORKFLOW_WORD_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const WORKFLOW_WORD_MESSAGE = 'workflow names are lowercase words or kebab-case';
/** Chart state ids are camelCase. Kebab-case still loads; verify requires the exact chart id. */
export const WORKFLOW_STATE_PATTERN = /^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*$/;
export const WORKFLOW_STATE_MESSAGE = 'state names are camelCase chart ids, or lowercase kebab-case';
/** Chart events are UPPER_SNAKE_CASE. Kebab-case still loads; verify replays the exact event string. */
export const WORKFLOW_EVENT_PATTERN = /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$/;
export const WORKFLOW_EVENT_MESSAGE = 'event names are UPPER_SNAKE_CASE chart events, or lowercase kebab-case';
export const WORKFLOW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const WORKFLOW_ID_MESSAGE = 'ids start with a letter and then use letters, digits, underscores, or hyphens';

/** `accepted` must not set `rejectAt`. `rejected` must set it. The step it names is checked once the list is a chain. */
export const EXPECTATION_MESSAGE = 'accepted must not set rejectAt; rejected needs rejectAt';

export function expectationHolds(workflow: {
  expect: 'accepted' | 'rejected';
  rejectAt?: number;
}): boolean {
  return workflow.expect === 'accepted' ? workflow.rejectAt === undefined : workflow.rejectAt !== undefined;
}

export interface WorkflowNodeDraft {
  id: string;
  state: string;
}

export interface WorkflowEdgeDraft {
  from: string;
  event: string;
  to: string;
  text: string;
}

export interface WorkflowDraft {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  start: string;
  rejectAt?: number;
  nodes: readonly WorkflowNodeDraft[];
  edges: readonly WorkflowEdgeDraft[];
}

export interface WorkflowSetDraft {
  id: string;
  workflows: readonly WorkflowDraft[];
}

/** One edge of the linked list, in walk order from `start`. */
export interface ChainStep {
  n: number;
  from: string;
  to: string;
  event: string;
  text: string;
  stateFrom: string;
  stateTo: string;
}

export interface LinkedWorkflow {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  start: string;
  rejectAt?: number;
  nodes: readonly WorkflowNodeDraft[];
  chain: readonly ChainStep[];
}

export interface WorkflowSet {
  id: string;
  workflows: readonly LinkedWorkflow[];
}

interface ChainBuild {
  issues: Issue[];
  chain: ChainStep[];
}

function buildChain(workflow: WorkflowDraft, workflowIndex: number): ChainBuild {
  const issues: Issue[] = [];
  const label = `workflow ${workflow.id}`;
  const nodes = new Map<string, { state: string }>();
  for (let index = 0; index < workflow.nodes.length; index += 1) {
    const node = workflow.nodes[index]!;
    if (nodes.has(node.id)) {
      issues.push({
        path: ['workflows', workflowIndex, 'nodes', index, 'id'],
        message: `${label}: duplicate node id "${node.id}"`,
      });
      continue;
    }
    nodes.set(node.id, { state: node.state });
  }
  if (!nodes.has(workflow.start)) {
    issues.push({
      path: ['workflows', workflowIndex, 'start'],
      message: `${label}: start "${workflow.start}" is not a node`,
    });
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (let index = 0; index < workflow.edges.length; index += 1) {
    const edge = workflow.edges[index]!;
    const edgePath = ['workflows', workflowIndex, 'edges', index];
    if (edge.from === edge.to) {
      issues.push({
        path: [...edgePath, 'to'],
        message: `${label}: edge ${edge.event} links "${edge.from}" to itself`,
      });
    }
    if (!nodes.has(edge.from)) {
      issues.push({
        path: [...edgePath, 'from'],
        message: `${label}: edge ${edge.event} leaves unknown node "${edge.from}"`,
      });
    }
    if (!nodes.has(edge.to)) {
      issues.push({
        path: [...edgePath, 'to'],
        message: `${label}: edge ${edge.event} enters unknown node "${edge.to}"`,
      });
    }
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  for (const [id, count] of outgoing) {
    if (count > 1 && nodes.has(id)) {
      issues.push({
        path: ['workflows', workflowIndex, 'edges'],
        message: `${label}: node "${id}" has ${count} outgoing edges; a workflow is a linked list`,
      });
    }
  }
  for (const [id, count] of incoming) {
    if (count > 1 && nodes.has(id)) {
      issues.push({
        path: ['workflows', workflowIndex, 'edges'],
        message: `${label}: node "${id}" has ${count} incoming edges; a workflow is a linked list`,
      });
    }
  }

  const heads: string[] = [];
  for (const id of nodes.keys()) {
    if ((incoming.get(id) ?? 0) === 0) heads.push(id);
  }
  if (heads.length !== 1) {
    issues.push({
      path: ['workflows', workflowIndex, 'start'],
      message: heads.length === 0
        ? `${label}: linked list has no head`
        : `${label}: linked list has ${heads.length} heads (${heads.join(', ')}); expected one`,
    });
  } else if (nodes.has(workflow.start) && heads[0] !== workflow.start) {
    issues.push({
      path: ['workflows', workflowIndex, 'start'],
      message: `${label}: start "${workflow.start}" is not the head (head is "${heads[0]}")`,
    });
  }

  const chain: ChainStep[] = [];
  if (issues.length > 0) return { issues, chain };

  const edgeByFrom = new Map<string, WorkflowEdgeDraft>();
  for (const edge of workflow.edges) edgeByFrom.set(edge.from, edge);
  const seen = new Set<string>();
  let cursor = workflow.start;
  let n = 1;
  while (edgeByFrom.has(cursor)) {
    if (seen.has(cursor)) {
      issues.push({
        path: ['workflows', workflowIndex, 'edges'],
        message: `${label}: cycle at node "${cursor}"`,
      });
      break;
    }
    seen.add(cursor);
    const edge = edgeByFrom.get(cursor);
    const fromNode = nodes.get(edge?.from ?? '');
    const toNode = nodes.get(edge?.to ?? '');
    if (edge === undefined || fromNode === undefined || toNode === undefined) break;
    chain.push({
      n,
      from: edge.from,
      to: edge.to,
      event: edge.event,
      text: edge.text,
      stateFrom: fromNode.state,
      stateTo: toNode.state,
    });
    n += 1;
    cursor = edge.to;
  }
  seen.add(cursor);
  if (issues.length === 0 && seen.size !== nodes.size) {
    const missing: string[] = [];
    for (const id of nodes.keys()) if (!seen.has(id)) missing.push(id);
    issues.push({
      path: ['workflows', workflowIndex, 'nodes'],
      message: `${label}: nodes not on the list: ${missing.join(', ')}`,
    });
  }
  if (workflow.rejectAt !== undefined && issues.length === 0 && workflow.rejectAt > chain.length) {
    issues.push({
      path: ['workflows', workflowIndex, 'rejectAt'],
      message: `${label}: rejectAt ${workflow.rejectAt} is outside the list (${chain.length} edges)`,
    });
  }
  return { issues, chain };
}

export function workflowSetIssues(draft: WorkflowSetDraft): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < draft.workflows.length; index += 1) {
    const workflow = draft.workflows[index]!;
    const previous = seen.get(workflow.id);
    if (previous !== undefined) {
      issues.push({
        path: ['workflows', index, 'id'],
        message: `duplicate workflow id "${workflow.id}" (also declared at workflows.${previous})`,
      });
    } else {
      seen.set(workflow.id, index);
    }
    issues.push(...buildChain(workflow, index).issues);
  }
  return issues;
}

/** Node ids in linked-list order: the head, then each edge's target. */
export function nodesInWalkOrder(workflow: LinkedWorkflow): WorkflowNodeDraft[] {
  const byId = new Map<string, WorkflowNodeDraft>();
  for (const node of workflow.nodes) byId.set(node.id, { id: node.id, state: node.state });
  const ordered: WorkflowNodeDraft[] = [];
  const head = byId.get(workflow.start);
  if (head !== undefined) ordered.push(head);
  for (const step of workflow.chain) {
    const node = byId.get(step.to);
    if (node !== undefined) ordered.push({ id: node.id, state: node.state });
  }
  return ordered;
}

/** Build a set that already satisfied {@link workflowSetIssues}. */
export function assembleWorkflowSet(draft: WorkflowSetDraft): WorkflowSet {
  const issues = workflowSetIssues(draft);
  if (issues.length > 0) {
    throw new Error(`workflow set failed invariants after parsing: ${issues.map((issue) => issue.message).join('; ')}`);
  }
  const workflows: LinkedWorkflow[] = [];
  for (let index = 0; index < draft.workflows.length; index += 1) {
    const workflow = draft.workflows[index]!;
    const built = buildChain(workflow, index);
    const nodes: WorkflowNodeDraft[] = [];
    for (const node of workflow.nodes) nodes.push({ id: node.id, state: node.state });
    const linked: LinkedWorkflow = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      start: workflow.start,
      nodes,
      chain: built.chain,
    };
    if (workflow.rejectAt !== undefined) linked.rejectAt = workflow.rejectAt;
    workflows.push(linked);
  }
  return { id: draft.id, workflows };
}
