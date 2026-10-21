// Machine-readable command documents. The CLI prints these; it does not invent a second shape.
import type { Comparison } from '../domain/comparison.js';
import type { Structure } from '../domain/verification.js';

export interface OutputIssue {
  kind: 'schema' | 'graph' | 'input' | 'mapping';
  file?: string;
  path: string;
  message: string;
}

export interface LocatedError {
  path: string;
  message: string;
}

export function formatIssue(issue: OutputIssue): string {
  const parts: string[] = [];
  if (issue.file !== undefined && issue.file !== '') parts.push(issue.file);
  if (issue.path !== '') parts.push(issue.path);
  const where = parts.join(': ');
  return where === '' ? issue.message : `${where}: ${issue.message}`;
}

export function formatIssues(issues: readonly OutputIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) lines.push(formatIssue(issue));
  return lines;
}

export function tagIssues(file: string, kind: OutputIssue['kind'], errors: readonly LocatedError[]): OutputIssue[] {
  const issues: OutputIssue[] = [];
  for (const error of errors) issues.push({ kind, file, path: error.path, message: error.message });
  return issues;
}

export interface ChartSketch {
  id: string;
  initial: string;
  states: { id: string; label: string; final: boolean }[];
  transitions: { from: string; event: string; to: string }[];
}

export interface ChartCheckDocument {
  command: 'chart.check';
  ok: boolean;
  graphChecked: boolean;
  chart?: ChartSketch;
  issues: OutputIssue[];
}

export interface ChartAnalyzeDocument {
  command: 'chart.analyze';
  ok: boolean;
  clean?: boolean;
  chartId?: string;
  structure?: Structure;
  fault?: 'unreadable' | 'invalid-chart';
  issues: OutputIssue[];
}

export interface WorkflowNodeView {
  id: string;
  state: string;
}

export interface WorkflowEdgeView {
  from: string;
  event: string;
  to: string;
  text: string;
  stateFrom: string;
  stateTo: string;
}

export interface WorkflowView {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  rejectAt?: number;
  start: string;
  nodes: WorkflowNodeView[];
  edges: WorkflowEdgeView[];
}

export interface WorkflowCheckDocument {
  command: 'workflows.check';
  ok: boolean;
  graphChecked: boolean;
  id?: string;
  workflowSet?: { id: string; workflows: WorkflowView[] };
  issues: OutputIssue[];
}

export interface VerifyTraceStep {
  n: number;
  text: string;
  accepted: boolean;
  workflow: { from: string; event: string; to: string | null };
  chart: { from: string; event: string; to: string | null };
}

export interface VerifyFlowDocument {
  id: string;
  title: string;
  expect: string;
  pass: boolean;
  reason: string;
  provedBy: string;
  finalState: { chart: string | null; workflow: string | null };
  trace: VerifyTraceStep[];
}

export interface VerifyDocument {
  command: 'verify';
  ok: boolean;
  candidate?: string;
  chartId?: string;
  workflowSetId?: string;
  selected?: string[];
  summary?: { passed: number; failed: number; total: number };
  flows?: VerifyFlowDocument[];
  unusedTransitions?: string[];
  fault?: 'unreadable' | 'invalid-chart' | 'invalid-workflows' | 'invalid-mapping' | 'mismatch' | 'selection' | 'mapping-gap';
  issues: OutputIssue[];
}

/** Fields `compare` reads from a verify document. Built field by field at the JSON boundary. */
export interface ParsedVerifyResult {
  name: string;
  chartId: string;
  workflowSetId: string;
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  failures: { id: string; reason: string }[];
}

export interface CompareDocument {
  command: 'compare';
  ok: boolean;
  winner: string | null;
  candidates?: Comparison['candidates'];
  fault?: 'invalid-result';
  issues: OutputIssue[];
}

export type CommandDocument =
  | ChartCheckDocument
  | ChartAnalyzeDocument
  | WorkflowCheckDocument
  | VerifyDocument
  | CompareDocument;

export type ExitKind = 'pass' | 'fail' | 'invalid';

export interface Outcome<T> {
  exit: ExitKind;
  document: T;
}
