// Use case: prove each selected named sub-graph against a chart, through an explicit mapping.
import { mapChain } from '../domain/mapping.js';
import { unusedTransitions, verifyFlow, type ChartFlow, type WorkflowResult } from '../domain/verification.js';
import type { LinkedWorkflow, WorkflowSet } from '../domain/workflow.js';
import { candidateName } from './candidate-name.js';
import {
  tagIssues,
  type Outcome,
  type OutputIssue,
  type VerifyDocument,
  type VerifyFlowDocument,
  type VerifyTraceStep,
} from './documents.js';
import type { VerifyPorts } from './ports.js';

export interface VerifyFlowsCommand {
  chartFile: string;
  workflowsFile: string;
  mappingFile: string;
  flowIds: readonly string[];
  selectFile?: string;
  highlight?: string;
  outDir?: string;
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
  const mapping = ports.mappings.load(command.mappingFile);
  const issues: OutputIssue[] = [];
  if (!chart.ok) issues.push(...tagIssues(command.chartFile, chart.fault === 'unreadable' ? 'input' : chart.fault, chart.errors));
  if (!workflows.ok) issues.push(...tagIssues(command.workflowsFile, workflows.fault === 'unreadable' ? 'input' : workflows.fault, workflows.errors));
  if (!mapping.ok) issues.push(...tagIssues(command.mappingFile, mapping.fault === 'unreadable' ? 'input' : mapping.fault, mapping.errors));
  if (!chart.ok || !workflows.ok || !mapping.ok) {
    let fault: VerifyDocument['fault'] = 'invalid-mapping';
    if (!chart.ok) fault = chart.fault === 'unreadable' ? 'unreadable' : 'invalid-chart';
    else if (!workflows.ok) fault = workflows.fault === 'unreadable' ? 'unreadable' : 'invalid-workflows';
    else if (!mapping.ok) fault = mapping.fault === 'unreadable' ? 'unreadable' : 'invalid-mapping';
    return invalid(fault, issues);
  }

  const model = chart.value;
  const set = workflows.value;
  const map = mapping.value;
  if (map.chart !== model.id) {
    issues.push({
      kind: 'mapping',
      file: command.mappingFile,
      path: 'chart',
      message: `mapping chart "${map.chart}" does not match chart id "${model.id}"`,
    });
  }
  if (map.workflowSet !== set.id) {
    issues.push({
      kind: 'mapping',
      file: command.mappingFile,
      path: 'workflowSet',
      message: `mapping workflowSet "${map.workflowSet}" does not match workflow set id "${set.id}"`,
    });
  }

  const ids = collectIds(command, set, ports, issues);
  if (ids === undefined) return invalid(issues.some((issue) => issue.kind === 'mapping') ? 'mismatch' : 'selection', issues);

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
  for (const workflow of selected) {
    const mapped = mapChain(map, workflow.chain, states);
    if (!mapped.ok) {
      for (const gap of mapped.gaps) {
        issues.push({ kind: 'mapping', file: command.mappingFile, path: workflow.id, message: gap });
      }
      continue;
    }
    const flow: ChartFlow = {
      id: workflow.id,
      title: workflow.title,
      expect: workflow.expect,
      steps: mapped.steps,
    };
    if (workflow.rejectAt !== undefined) flow.rejectAt = workflow.rejectAt;
    flows.push(flow);
  }
  if (issues.length > 0) {
    const fault = issues.some((issue) => issue.kind === 'mapping' && (issue.path === 'chart' || issue.path === 'workflowSet'))
      ? 'mismatch'
      : issues.some((issue) => issue.kind === 'mapping')
        ? 'mapping-gap'
        : 'selection';
    return invalid(fault, issues);
  }

  const traversal = ports.engine.open(model);
  const results: WorkflowResult[] = [];
  for (const flow of flows) results.push(verifyFlow(model, flow, traversal));
  const documents: VerifyFlowDocument[] = [];
  for (const result of results) documents.push(flowDocument(result));
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  const document: VerifyDocument = {
    command: 'verify',
    ok: failed === 0,
    candidate: candidateName(command.chartFile),
    chartId: model.id,
    workflowSetId: set.id,
    selected: ids,
    summary: { passed, failed, total: results.length },
    flows: documents,
    unusedTransitions: unusedTransitions(model, results),
    issues: [],
  };
  if (command.outDir !== undefined) {
    ports.reports.writeVerification(document, model, command.outDir);
    ports.diagrams.render(model, candidateName(command.chartFile), results, passed, command.outDir, command.highlight);
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
