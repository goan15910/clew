// Workflow sets. Zod accepts the file shape here; linked-list invariants live in the domain.
import { z } from 'zod';
import type { LocatedError } from '../../application/documents.js';
import type { FileLoad } from '../../application/ports.js';
import {
  assembleWorkflowSet,
  EXPECTATION_MESSAGE,
  expectationHolds,
  WORKFLOW_EVENT_MESSAGE,
  WORKFLOW_EVENT_PATTERN,
  WORKFLOW_ID_MESSAGE,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_STATE_MESSAGE,
  WORKFLOW_STATE_PATTERN,
  WORKFLOW_WORD_MESSAGE,
  WORKFLOW_WORD_PATTERN,
  workflowSetIssues,
  type WorkflowSet,
  type WorkflowSetDraft,
} from '../../domain/workflow.js';
import { locatedErrors, locatedFromIssues } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

const IdSchema = z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE);
const WordSchema = z.string().regex(WORKFLOW_WORD_PATTERN, WORKFLOW_WORD_MESSAGE);
const StateSchema = z.string().regex(WORKFLOW_STATE_PATTERN, WORKFLOW_STATE_MESSAGE);
const EventSchema = z.string().regex(WORKFLOW_EVENT_PATTERN, WORKFLOW_EVENT_MESSAGE);

const WorkflowSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  expect: z.enum(['accepted', 'rejected']),
  start: WordSchema,
  rejectAt: z.number().int().positive().optional(),
  nodes: z.array(z.strictObject({
    id: WordSchema,
    state: StateSchema,
  })).min(2),
  edges: z.array(z.strictObject({
    from: WordSchema,
    event: EventSchema,
    to: WordSchema,
    text: z.string().min(1),
  })).min(1),
}).superRefine((workflow, ctx) => {
  if (!expectationHolds(workflow)) ctx.addIssue({ code: 'custom', path: ['rejectAt'], message: EXPECTATION_MESSAGE });
});

const WorkflowFileSchema = z.strictObject({
  id: IdSchema,
  workflows: z.array(WorkflowSchema).min(1),
});

function toDraft(file: z.infer<typeof WorkflowFileSchema>): WorkflowSetDraft {
  const workflows: WorkflowSetDraft['workflows'][number][] = [];
  for (const workflow of file.workflows) {
    const nodes: { id: string; state: string }[] = [];
    for (const node of workflow.nodes) nodes.push({ id: node.id, state: node.state });
    const edges: { from: string; event: string; to: string; text: string }[] = [];
    for (const edge of workflow.edges) edges.push({ from: edge.from, event: edge.event, to: edge.to, text: edge.text });
    const draft: WorkflowSetDraft['workflows'][number] = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      start: workflow.start,
      nodes,
      edges,
    };
    if (workflow.rejectAt !== undefined) draft.rejectAt = workflow.rejectAt;
    workflows.push(draft);
  }
  return { id: file.id, workflows };
}

function workflowHints(value: unknown): LocatedError[] {
  if (typeof value !== 'object' || value === null) return [];
  const hints: LocatedError[] = [];
  if ('machineId' in value) {
    hints.push({
      path: 'machineId',
      message: 'machineId was removed and is not compared; set id on the workflow set',
    });
  }
  const workflows = 'workflows' in value ? value.workflows : undefined;
  if (Array.isArray(workflows)) {
    const legacy = workflows.some((workflow) => typeof workflow === 'object' && workflow !== null && ('steps' in workflow || 'end' in workflow));
    if (legacy) {
      hints.push({
        path: '',
        message: 'workflows are named linked lists of nodes and edges; steps and end were removed (see docs/agent-cli.md)',
      });
    }
  }
  return hints;
}

export function loadWorkflowSet(input: unknown): FileLoad<WorkflowSet> {
  const parsed = WorkflowFileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fault: 'schema', errors: [...workflowHints(input), ...locatedErrors(parsed.error.issues)] };
  }
  const draft = toDraft(parsed.data);
  const issues = workflowSetIssues(draft);
  if (issues.length > 0) return { ok: false, fault: 'graph', errors: locatedFromIssues(issues) };
  return { ok: true, value: assembleWorkflowSet(draft) };
}

export const yamlWorkflowLoader: { load(file: string): FileLoad<WorkflowSet> } = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, fault: 'unreadable', errors: [{ path: '', message: read.error }] };
    return loadWorkflowSet(read.value);
  },
};
