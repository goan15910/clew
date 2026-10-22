// Machine-readable command documents. The CLI prints these; it does not invent a second shape.
import type { Comparison } from '../domain/comparison.js';
import type { StatusCoverage, TraceLink } from '../domain/spec-query.js';
import type { EntityKind, EntityReview, EntityStatus, FactType, Finding, FlowOrigin, SpecOrigin } from '../domain/spec.js';
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

export function specInput(file: string | undefined, message: string): OutputIssue {
  const issue: OutputIssue = { kind: 'input', path: '', message };
  if (file !== undefined && file !== '') issue.file = file;
  return issue;
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

export interface SpecSentenceView {
  id: string;
  text: string;
  span: [number, number];
  hash: string;
  section: string;
}

export interface SpecTokenView {
  id: string;
  text: string;
  tags: string[];
  span: [number, number];
  origin: 'tagger' | 'rule' | 'agent';
}

export interface SpecTaggedView {
  id: string;
  text: string;
  section: string;
  clauses: string[];
  tokens: SpecTokenView[];
}

export type SpecFault = 'unreadable' | 'locked' | 'schema' | 'session';

export interface SpecInitDocument {
  command: 'spec.init';
  ok: boolean;
  session?: string;
  spec?: string;
  specHash?: string;
  sentences?: SpecSentenceView[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecTagDocument {
  command: 'spec.tag';
  ok: boolean;
  session?: string;
  tagger?: { name: string; version: string };
  sentences?: SpecTaggedView[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecEntityView {
  id: string;
  kind: EntityKind;
  name?: string;
  text?: string;
  sources: string[];
  origin: SpecOrigin;
  status: EntityStatus;
  review?: EntityReview;
  note?: string;
}

export interface SpecEntitiesDocument {
  command: 'spec.entities.list' | 'spec.entities.merge' | 'spec.entities.rename' | 'spec.entities.reject' | 'spec.entities.promote';
  ok: boolean;
  session?: string;
  entities?: SpecEntityView[];
  changed?: string[];
  removed?: string[];
  affected?: string[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecFactView {
  id: string;
  type: FactType;
  actor?: string;
  action?: string;
  object?: string;
  from?: string | null;
  to?: string;
  condition?: string;
  state?: string;
  origin: SpecOrigin;
  confidence: number;
  sources: string[];
  status: 'current' | 'stale';
  note?: string;
}

export interface SpecFactsDocument {
  command: 'spec.facts.propose' | 'spec.facts.add' | 'spec.facts.edit' | 'spec.facts.remove';
  ok: boolean;
  session?: string;
  facts?: SpecFactView[];
  changed?: string[];
  removed?: string[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecTraceDocument {
  command: 'spec.trace';
  ok: boolean;
  session?: string;
  id?: string;
  chain?: TraceLink[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecGraphStateView {
  id: string;
  object: string;
  initial?: true;
  final?: true;
  facts: string[];
}

export interface SpecGraphTransitionView {
  id: string;
  from: string;
  event: string;
  to: string;
  actor?: string;
  guard?: string;
  object: string;
  fact: string;
  facts: string[];
}

export interface SpecFlowView {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  rejectAt?: number;
  transitions: string[];
  forbidden?: string;
  origin: FlowOrigin;
}

export interface SpecGraphView {
  objects: string[];
  states: SpecGraphStateView[];
  transitions: SpecGraphTransitionView[];
}

export interface SpecGraphDocument {
  command: 'spec.graph.build' | 'spec.graph.split' | 'spec.graph.group';
  ok: boolean;
  session?: string;
  graph?: SpecGraphView;
  flows?: SpecFlowView[];
  changed?: string[];
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecEmitDocument {
  command: 'spec.emit';
  ok: boolean;
  session?: string;
  dryRun?: boolean;
  forced?: boolean;
  written?: string;
  id?: string;
  yaml?: string;
  workflowSet?: { id: string; workflows: WorkflowView[] };
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export interface SpecStatusDocument {
  command: 'spec.status';
  ok: boolean;
  session?: string;
  coverage?: StatusCoverage;
  layers?: { tokens: boolean; entities: boolean; facts: boolean; graph: boolean };
  findingsByLayer?: { sentences: Finding[]; tokens: Finding[]; entities: Finding[]; facts: Finding[]; graph: Finding[] };
  findings: Finding[];
  fault?: SpecFault;
  issues: OutputIssue[];
}

export type CommandDocument =
  | ChartCheckDocument
  | ChartAnalyzeDocument
  | WorkflowCheckDocument
  | VerifyDocument
  | CompareDocument
  | SpecInitDocument
  | SpecTagDocument
  | SpecEntitiesDocument
  | SpecFactsDocument
  | SpecTraceDocument
  | SpecStatusDocument
  | SpecGraphDocument
  | SpecEmitDocument;

export type ExitKind = 'pass' | 'fail' | 'invalid';

export interface Outcome<T> {
  exit: ExitKind;
  document: T;
}
