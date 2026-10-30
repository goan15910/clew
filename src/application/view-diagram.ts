// Use case: render a chart and/or workflow set with the shared interactive Cytoscape path (no spec session).
import type { Model, State } from '../domain/model.js';
import { SPEC_SCHEMA_VERSION, type SpecSnapshot } from '../domain/spec.js';
import type { TraceStep, WorkflowResult } from '../domain/verification.js';
import type { LinkedWorkflow, WorkflowSet } from '../domain/workflow.js';
import {
  tagIssues,
  type DiagramViewChart,
  type DiagramViewDocument,
  type DiagramViewWorkflow,
  type Outcome,
} from './documents.js';
import { chartInteractive, workflowInteractive } from './interactive-graph.js';
import type { ModelLoader, WorkflowSetLoader } from './ports.js';

export interface ViewChartCommand {
  chartFile: string;
  workflowsFile?: string;
}

export interface ViewWorkflowsCommand {
  workflowsFile: string;
  chartFile?: string;
}

/** Snapshot with no lineage — standalone YAML views have no spec session. */
export function emptyViewSnapshot(id: string): SpecSnapshot {
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    id,
    specHash: '',
    created: '',
    updated: '',
    sentences: [],
    tagged: [],
  };
}

/** Turn an assembled linked-list workflow into the chain shape `workflowInteractive` expects. */
export function linkedWorkflowResult(workflow: LinkedWorkflow): WorkflowResult {
  const trace: TraceStep[] = [];
  for (const step of workflow.chain) {
    const refused = workflow.expect === 'rejected' && workflow.rejectAt === step.n;
    trace.push({
      n: step.n,
      text: step.text,
      event: step.event,
      from: step.stateFrom,
      to: refused ? null : step.stateTo,
      accepted: !refused,
      workflowEvent: step.event,
      workflowFrom: step.from,
      workflowTo: refused ? null : step.to,
    });
    if (refused) break;
  }
  const last = trace[trace.length - 1];
  const landed = last !== undefined && last.accepted;
  return {
    id: workflow.id,
    title: workflow.title,
    expect: workflow.expect,
    pass: true,
    reason: '',
    trace,
    finalState: landed ? last.to : null,
    finalWorkflowState: landed ? last.workflowTo : null,
    provedBy: '',
  };
}

/** Minimal model whose state ids/labels cover every workflow node state (when no chart is given). */
export function labelModelFromWorkflows(set: WorkflowSet): Model {
  const states: State[] = [];
  const seen = new Set<string>();
  for (const workflow of set.workflows) {
    for (const node of workflow.nodes) {
      if (seen.has(node.state)) continue;
      seen.add(node.state);
      states.push({ id: node.state, label: node.state, final: false, data: [] });
    }
  }
  const first = states[0];
  return {
    id: set.id,
    initial: first === undefined ? '' : first.id,
    states() {
      return states;
    },
    transitions() {
      return [];
    },
  };
}

export function viewChart(
  command: ViewChartCommand,
  models: ModelLoader,
  workflows: WorkflowSetLoader,
): Outcome<DiagramViewDocument> {
  const loadedChart = models.load(command.chartFile);
  if (!loadedChart.ok) {
    return chartLoadFailure('chart.view', command.chartFile, loadedChart);
  }
  const model = loadedChart.value;
  const snapshot = emptyViewSnapshot(model.id);
  const charts: DiagramViewChart[] = [
    { object: model.id, interactive: chartInteractive(model, model.id, snapshot) },
  ];
  const viewWorkflows: DiagramViewWorkflow[] = [];
  if (command.workflowsFile !== undefined) {
    const loadedFlows = workflows.load(command.workflowsFile);
    if (!loadedFlows.ok) {
      return workflowLoadFailure('chart.view', command.workflowsFile, loadedFlows, {
        chartFile: command.chartFile,
        workflowsFile: command.workflowsFile,
      });
    }
    for (const flow of loadedFlows.value.workflows) {
      const result = linkedWorkflowResult(flow);
      viewWorkflows.push({
        id: result.id,
        title: result.title,
        expect: result.expect === 'rejected' ? 'rejected' : 'accepted',
        interactive: workflowInteractive(model, result, snapshot),
      });
    }
  }
  return {
    exit: 'pass',
    document: {
      command: 'chart.view',
      ok: true,
      chartFile: command.chartFile,
      workflowsFile: command.workflowsFile,
      mode: 'standalone',
      charts,
      workflows: viewWorkflows,
      issues: [],
    },
  };
}

export function viewWorkflows(
  command: ViewWorkflowsCommand,
  models: ModelLoader,
  workflows: WorkflowSetLoader,
): Outcome<DiagramViewDocument> {
  const loadedFlows = workflows.load(command.workflowsFile);
  if (!loadedFlows.ok) {
    return workflowLoadFailure('workflows.view', command.workflowsFile, loadedFlows, {
      workflowsFile: command.workflowsFile,
      chartFile: command.chartFile,
    });
  }
  const set = loadedFlows.value;
  let model: Model;
  const charts: DiagramViewChart[] = [];
  if (command.chartFile !== undefined) {
    const loadedChart = models.load(command.chartFile);
    if (!loadedChart.ok) {
      return chartLoadFailure('workflows.view', command.chartFile, loadedChart, {
        workflowsFile: command.workflowsFile,
        chartFile: command.chartFile,
      });
    }
    model = loadedChart.value;
    const snapshot = emptyViewSnapshot(model.id);
    charts.push({ object: model.id, interactive: chartInteractive(model, model.id, snapshot) });
  } else {
    model = labelModelFromWorkflows(set);
  }
  const snapshot = emptyViewSnapshot(set.id);
  const viewWorkflows: DiagramViewWorkflow[] = [];
  for (const flow of set.workflows) {
    const result = linkedWorkflowResult(flow);
    viewWorkflows.push({
      id: result.id,
      title: result.title,
      expect: result.expect === 'rejected' ? 'rejected' : 'accepted',
      interactive: workflowInteractive(model, result, snapshot),
    });
  }
  return {
    exit: 'pass',
    document: {
      command: 'workflows.view',
      ok: true,
      chartFile: command.chartFile,
      workflowsFile: command.workflowsFile,
      mode: 'standalone',
      charts,
      workflows: viewWorkflows,
      issues: [],
    },
  };
}

function chartLoadFailure(
  command: DiagramViewDocument['command'],
  file: string,
  loaded: { ok: false; fault: 'unreadable' | 'schema' | 'graph'; errors: { path: string; message: string }[] },
  paths: { chartFile?: string; workflowsFile?: string } = {},
): Outcome<DiagramViewDocument> {
  const kind = loaded.fault === 'unreadable' ? 'input' : loaded.fault === 'schema' ? 'schema' : 'graph';
  return {
    exit: loaded.fault === 'unreadable' ? 'invalid' : 'fail',
    document: {
      command,
      ok: false,
      chartFile: paths.chartFile ?? file,
      workflowsFile: paths.workflowsFile,
      charts: [],
      workflows: [],
      fault: loaded.fault === 'unreadable' ? 'unreadable' : 'invalid-chart',
      issues: tagIssues(file, kind, loaded.errors),
    },
  };
}

function workflowLoadFailure(
  command: DiagramViewDocument['command'],
  file: string,
  loaded: { ok: false; fault: 'unreadable' | 'schema' | 'graph'; errors: { path: string; message: string }[] },
  paths: { chartFile?: string; workflowsFile?: string },
): Outcome<DiagramViewDocument> {
  const kind = loaded.fault === 'unreadable' ? 'input' : loaded.fault === 'schema' ? 'schema' : 'graph';
  return {
    exit: loaded.fault === 'unreadable' ? 'invalid' : 'fail',
    document: {
      command,
      ok: false,
      chartFile: paths.chartFile,
      workflowsFile: paths.workflowsFile ?? file,
      charts: [],
      workflows: [],
      fault: loaded.fault === 'unreadable' ? 'unreadable' : 'invalid-workflows',
      issues: tagIssues(file, kind, loaded.errors),
    },
  };
}
