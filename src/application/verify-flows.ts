// Use case: prove each selected named sub-graph against a spec by next-state replay.
import { DEFAULT_REACH_BOUND } from '../domain/valuation.js';
import { reachableFromInitial } from '../domain/spec-model.js';
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
  for (const item of result.trace) {
    trace.push({
      n: item.n,
      text: item.text,
      accepted: item.accepted,
      workflow: { from: item.workflowFrom, event: item.workflowEvent, to: item.workflowTo },
      chart: { from: item.from, event: item.event, to: item.to },
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
  const specFile = ports.specs.load(command.chartFile);
  const viewFile = ports.models.load(command.chartFile);
  const workflows = ports.workflows.load(command.workflowsFile);
  const issues: OutputIssue[] = [];
  if (!specFile.ok) issues.push(...tagIssues(command.chartFile, specFile.fault === 'unreadable' ? 'input' : specFile.fault, specFile.errors));
  if (!workflows.ok) issues.push(...tagIssues(command.workflowsFile, workflows.fault === 'unreadable' ? 'input' : workflows.fault, workflows.errors));
  if (!specFile.ok || !workflows.ok) {
    let fault: VerifyDocument['fault'] = 'invalid-workflows';
    if (!specFile.ok) fault = specFile.fault === 'unreadable' ? 'unreadable' : 'invalid-chart';
    else if (!workflows.ok) fault = workflows.fault === 'unreadable' ? 'unreadable' : 'invalid-workflows';
    return invalid(fault, issues);
  }
  if (!viewFile.ok) {
    issues.push(...tagIssues(command.chartFile, viewFile.fault === 'unreadable' ? 'input' : viewFile.fault, viewFile.errors));
    return invalid(viewFile.fault === 'unreadable' ? 'unreadable' : 'invalid-chart', issues);
  }

  const spec = specFile.value;
  const model = viewFile.value;
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
  const reach = reachableFromInitial(spec, DEFAULT_REACH_BOUND);
  if (reach.truncated) {
    issues.push({
      kind: 'graph',
      file: command.chartFile,
      path: '',
      message: `state space truncated at ${DEFAULT_REACH_BOUND} valuations`,
    });
    return invalid('invalid-chart', issues);
  }
  const reached = new Set(reach.nodes.map((node) => node.id));
  const flows: ChartFlow[] = [];
  let nameGap = false;
  for (const workflow of selected) {
    const aligned = alignChain(spec, workflow.chain);
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

  const results: WorkflowResult[] = [];
  for (const flow of flows) results.push(verifyFlow(spec, flow, reached));
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
    chartId: spec.id,
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
