// Use case: prove each selected named sub-graph against a chart. Names match directly.
import { alignChain, transitionCoverage, unusedTransitions, verifyFlow, type ChartFlow, type WorkflowResult } from '../domain/verification.js';
import type { LinkedWorkflow, WorkflowSet } from '../domain/workflow.js';
import { candidateName } from './candidate-name.js';
import {
  tagIssues,
  type Outcome,
  type OutputIssue,
  type VerifyDocument,
  type VerifyFlowDocument,
  type VerifyTraceStep,
  type VerifyViews,
} from './documents.js';
import type { VerifyPorts } from './ports.js';

export interface VerifyFlowsCommand {
  chartFile: string;
  workflowsFile: string;
  flowIds: readonly string[];
  selectFile?: string;
  highlight?: string;
  outDir?: string;
  heatmap?: boolean;
  replay?: boolean;
}

function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

function flowDocument(result: WorkflowResult): VerifyFlowDocument {
  const trace: VerifyTraceStep[] = [];
  for (const step of result.trace) {
    trace.push({
      n: step.n,
      text: step.text,
      accepted: step.accepted,
      workflow: { from: step.workflowFrom, event: step.workflowEvent, to: step.workflowTo },
      chart: { from: step.from, event: step.event, to: step.to },
    });
  }
  return {
    id: result.id,
    title: result.title,
    expect: result.expect,
    pass: result.pass,
    reason: result.reason,
    provedBy: result.provedBy,
    finalState: { chart: result.finalState, workflow: result.finalWorkflowState },
    trace,
  };
}

function invalid(fault: VerifyDocument['fault'], issues: OutputIssue[]): Outcome<VerifyDocument> {
  return { exit: 'invalid', document: { command: 'verify', ok: false, fault, issues } };
}

export function verifyFlows(command: VerifyFlowsCommand, ports: VerifyPorts): Outcome<VerifyDocument> {
  const chart = ports.models.load(command.chartFile);
  const workflows = ports.workflows.load(command.workflowsFile);
  const issues: OutputIssue[] = [];
  if (!chart.ok) issues.push(...tagIssues(command.chartFile, chart.fault === 'unreadable' ? 'input' : chart.fault, chart.errors));
  if (!workflows.ok) issues.push(...tagIssues(command.workflowsFile, workflows.fault === 'unreadable' ? 'input' : workflows.fault, workflows.errors));
  if (!chart.ok || !workflows.ok) {
    let fault: VerifyDocument['fault'] = 'invalid-workflows';
    if (!chart.ok) fault = chart.fault === 'unreadable' ? 'unreadable' : 'invalid-chart';
    else if (!workflows.ok) fault = workflows.fault === 'unreadable' ? 'unreadable' : 'invalid-workflows';
    return invalid(fault, issues);
  }

  const model = chart.value;
  const set = workflows.value;

  const ids = collectIds(command, set, ports, issues);
  if (ids === undefined) return invalid('selection', issues);

  if (command.highlight !== undefined && !ids.includes(command.highlight)) {
    issues.push({
      kind: 'input',
      path: 'highlight',
      message: `highlight "${command.highlight}" is not in the selected workflows`,
    });
  }

  const selected = selectWorkflows(set, ids, issues);
  const states = new Set(model.states().map((state) => state.id));
  const flows: ChartFlow[] = [];
  let nameGap = false;
  for (const workflow of selected) {
    const aligned = alignChain(workflow.chain, states);
    if (!aligned.ok) {
      nameGap = true;
      for (const gap of aligned.gaps) {
        issues.push({ kind: 'graph', file: command.workflowsFile, path: workflow.id, message: gap });
      }
      continue;
    }
    const flow: ChartFlow = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      steps: aligned.steps,
    };
    if (workflow.rejectAt !== undefined) flow.rejectAt = workflow.rejectAt;
    flows.push(flow);
  }
  if (issues.length > 0) return invalid(nameGap ? 'name-gap' : 'selection', issues);

  const traversal = ports.engine.open(model);
  const results: WorkflowResult[] = [];
  for (const flow of flows) results.push(verifyFlow(model, flow, traversal));
  const documents: VerifyFlowDocument[] = [];
  for (const result of results) documents.push(flowDocument(result));
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  const name = candidateName(command.chartFile);
  const coverage = command.heatmap === true ? transitionCoverage(model, results) : undefined;
  let views: VerifyViews | undefined;
  if (command.outDir !== undefined && (command.heatmap === true || command.replay === true)) {
    views = {};
    if (coverage !== undefined) views.heatmap = ports.diagrams.writeHeatmap(model, name, results.length, coverage, command.outDir);
    if (command.replay === true) views.replays = ports.diagrams.writeReplays(model, results, command.outDir);
  }
  const document: VerifyDocument = {
    command: 'verify',
    ok: failed === 0,
    candidate: name,
    chartId: model.id,
    workflowSetId: set.id,
    selected: ids,
    summary: { passed, failed, total: results.length },
    flows: documents,
    unusedTransitions: unusedTransitions(model, results),
    issues: [],
  };
  if (coverage !== undefined) document.transitionCoverage = coverage;
  if (views !== undefined) document.views = views;
  if (command.outDir !== undefined) {
    ports.reports.writeVerification(document, model, command.outDir);
    ports.diagrams.render(model, name, results, passed, command.outDir, command.highlight);
  }
  return { exit: failed === 0 ? 'pass' : 'fail', document };
}

function collectIds(command: VerifyFlowsCommand, set: WorkflowSet, ports: VerifyPorts, issues: OutputIssue[]): string[] | undefined {
  const requested: string[] = [];
  for (const id of command.flowIds) requested.push(id);
  if (command.selectFile !== undefined) {
    const selected = ports.selections.load(command.selectFile);
    if (!selected.ok) {
      issues.push(...tagIssues(command.selectFile, 'input', selected.errors));
      return undefined;
    }
    for (const id of selected.flows) requested.push(id);
  }
  if (requested.length === 0) {
    const all: string[] = [];
    for (const workflow of set.workflows) all.push(workflow.id);
    return all;
  }
  return unique(requested);
}

function selectWorkflows(set: WorkflowSet, ids: readonly string[], issues: OutputIssue[]): LinkedWorkflow[] {
  const byId = new Map<string, LinkedWorkflow>();
  for (const workflow of set.workflows) byId.set(workflow.id, workflow);
  const selected: LinkedWorkflow[] = [];
  for (const id of ids) {
    const workflow = byId.get(id);
    if (workflow === undefined) {
      issues.push({ kind: 'input', path: 'flow', message: `unknown workflow "${id}"` });
      continue;
    }
    selected.push(workflow);
  }
  return selected;
}
