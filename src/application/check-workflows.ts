// Use case: schema and graph validity of a workflow set, including each named linked list.
import { nodesInWalkOrder } from '../domain/workflow.js';
import {
  tagIssues,
  type Outcome,
  type WorkflowCheckDocument,
  type WorkflowEdgeView,
  type WorkflowView,
} from './documents.js';
import type { WorkflowSetLoader } from './ports.js';

export function checkWorkflows(file: string, workflows: WorkflowSetLoader): Outcome<WorkflowCheckDocument> {
  const loaded = workflows.load(file);
  if (!loaded.ok && loaded.fault === 'unreadable') {
    return {
      exit: 'invalid',
      document: {
        command: 'workflows.check',
        ok: false,
        graphChecked: false,
        issues: tagIssues(file, 'input', loaded.errors),
      },
    };
  }
  if (!loaded.ok && loaded.fault === 'schema') {
    return {
      exit: 'fail',
      document: {
        command: 'workflows.check',
        ok: false,
        graphChecked: false,
        issues: tagIssues(file, 'schema', loaded.errors),
      },
    };
  }
  if (!loaded.ok) {
    return {
      exit: 'fail',
      document: {
        command: 'workflows.check',
        ok: false,
        graphChecked: true,
        issues: tagIssues(file, 'graph', loaded.errors),
      },
    };
  }
  const views: WorkflowView[] = [];
  for (const workflow of loaded.value.workflows) {
    const edges: WorkflowEdgeView[] = [];
    for (const step of workflow.chain) {
      edges.push({
        from: step.from,
        event: step.event,
        to: step.to,
        text: step.text,
        stateFrom: step.stateFrom,
        stateTo: step.stateTo,
      });
    }
    const view: WorkflowView = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      start: workflow.start,
      nodes: nodesInWalkOrder(workflow),
      edges,
    };
    if (workflow.rejectAt !== undefined) view.rejectAt = workflow.rejectAt;
    views.push(view);
  }
  return {
    exit: 'pass',
    document: {
      command: 'workflows.check',
      ok: true,
      graphChecked: true,
      id: loaded.value.id,
      workflowSet: { id: loaded.value.id, workflows: views },
      issues: [],
    },
  };
}
