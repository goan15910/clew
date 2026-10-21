// Ports the use cases need. Adapters implement these; the use cases do not import adapters.
import type { Comparison } from '../domain/comparison.js';
import type { Model } from '../domain/model.js';
import type { Traversal } from '../domain/traversal.js';
import type { WorkflowResult } from '../domain/verification.js';
import type { Workflow } from '../domain/workflow.js';
import type { InvalidModelReport, VerificationReport } from './report-document.js';

export interface ModelLoader {
  load(file: string): { ok: true; model: Model } | { ok: false; errors: string[] };
}

export interface WorkflowLoader {
  load(file: string): { ok: true; machineId: string; workflows: Workflow[] } | { ok: false; errors: string[] };
}

export interface TraversalEngine {
  open(model: Model): Traversal;
}

export interface ComparisonRun {
  name: string;
  schemaValid: boolean;
  passed: number;
  total: number;
  failures: readonly { id: string; reason: string }[];
}

export interface ReportWriter {
  writeVerification(report: VerificationReport, model: Model, outDir: string): void;
  writeInvalidModel(report: InvalidModelReport, outDir: string): void;
  writeComparison(comparison: Comparison, runs: readonly ComparisonRun[], outDir: string): void;
}

export interface DiagramRenderer {
  render(model: Model, name: string, results: readonly WorkflowResult[], passed: number, outDir: string, highlight: string | undefined): void;
}

export interface Ports {
  models: ModelLoader;
  workflows: WorkflowLoader;
  engine: TraversalEngine;
  reports: ReportWriter;
  diagrams: DiagramRenderer;
}
