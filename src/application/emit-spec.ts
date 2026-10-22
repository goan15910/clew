// Use case: render the chosen paths as a workflow set. Refuse while blocking findings remain.
import { nodesInWalkOrder, workflowSetIssues } from '../domain/workflow.js';
import { graphLayerFindings, toWorkflowSetDraft, workflowCheckFindings } from '../domain/spec-graph.js';
import { hasBlocking, type Finding } from '../domain/spec.js';
import type { Outcome, SpecEmitDocument, WorkflowEdgeView, WorkflowView } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore, WorkflowSetWriter } from './ports.js';
import { resolveSession } from './spec-session.js';

export interface EmitSpecCommand {
  sessionId?: string;
  dryRun: boolean;
  out?: string;
  force: boolean;
}

export function emitSpec(command: EmitSpecCommand, store: SpecStore, writer: WorkflowSetWriter): Outcome<SpecEmitDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.graph === undefined) {
      problem = 'no graph; run clew spec graph build first';
      return undefined;
    }
    return undefined;
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  const snapshot = result.snapshot;
  const graph = snapshot.graph;
  if (graph === undefined) return invalid('session', 'no graph; run clew spec graph build first');
  const findings: Finding[] = [];
  for (const finding of graphLayerFindings(snapshot)) findings.push(finding);
  const rendered = toWorkflowSetDraft(graph, snapshot.entities ?? [], snapshot.facts ?? [], snapshot.sentences, snapshot.tagged);
  for (const finding of rendered.findings) findings.push(finding);
  let yaml: string | undefined;
  let views: WorkflowView[] | undefined;
  if (rendered.draft !== undefined) {
    yaml = writer.render(rendered.draft);
    const issues = workflowSetIssues(rendered.draft);
    if (issues.length > 0) {
      for (const finding of workflowCheckFindings(issues, rendered.draft, graph, snapshot.facts ?? [])) findings.push(finding);
    } else {
      views = workflowViews(rendered.draft);
    }
  }
  const blocking = hasBlocking(findings);
  const document: SpecEmitDocument = {
    command: 'spec.emit',
    ok: true,
    session: snapshot.id,
    id: rendered.draft?.id,
    findings,
    issues: [],
  };
  if (rendered.draft !== undefined) document.id = rendered.draft.id;
  if (yaml !== undefined) document.yaml = yaml;
  if (views !== undefined && rendered.draft !== undefined) document.workflowSet = { id: rendered.draft.id, workflows: views };
  if (command.dryRun) {
    document.dryRun = true;
    return { exit: blocking ? 'fail' : 'pass', document };
  }
  if (yaml === undefined || command.out === undefined) {
    return { exit: 'fail', document };
  }
  if (blocking && !command.force) return { exit: 'fail', document };
  const wrote = writer.write(command.out, yaml);
  if (!wrote.ok) return invalid('unreadable', wrote.message);
  document.written = command.out;
  if (command.force) document.forced = true;
  return { exit: blocking ? 'fail' : 'pass', document };
}

function workflowViews(draft: NonNullable<ReturnType<typeof toWorkflowSetDraft>['draft']>): WorkflowView[] {
  const views: WorkflowView[] = [];
  for (const workflow of draft.workflows) {
    const edges: WorkflowEdgeView[] = [];
    for (const edge of workflow.edges) {
      const from = workflow.nodes.find((node) => node.id === edge.from);
      const to = workflow.nodes.find((node) => node.id === edge.to);
      edges.push({
        from: edge.from,
        event: edge.event,
        to: edge.to,
        text: edge.text,
        stateFrom: from?.state ?? edge.from,
        stateTo: to?.state ?? edge.to,
      });
    }
    // Walk order matches workflows check once the draft has no issues.
    const ordered = nodesInWalkOrder({
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      start: workflow.start,
      rejectAt: workflow.rejectAt,
      nodes: workflow.nodes,
      chain: edges.map((edge, index) => ({
        n: index + 1,
        from: edge.from,
        to: edge.to,
        event: edge.event,
        text: edge.text,
        stateFrom: edge.stateFrom,
        stateTo: edge.stateTo,
      })),
    });
    const view: WorkflowView = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      start: workflow.start,
      nodes: ordered,
      edges,
    };
    if (workflow.rejectAt !== undefined) view.rejectAt = workflow.rejectAt;
    views.push(view);
  }
  return views;
}

function invalid(fault: SpecEmitDocument['fault'], message: string): Outcome<SpecEmitDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.emit', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
