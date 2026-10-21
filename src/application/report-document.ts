// The verification document written to disk and, with --json, to stdout.
import { modelDocument, type Model, type ModelDocument } from '../domain/model.js';
import type { Assessment, Structure, WorkflowResult } from '../domain/verification.js';

export interface VerificationReport {
  candidate: string;
  modelFile: string;
  schemaValid: true;
  model: ModelDocument;
  structure: Structure;
  unusedTransitions: string[];
  summary: { passed: number; total: number };
  workflows: WorkflowResult[];
}

export interface InvalidModelReport {
  candidate: string;
  schemaValid: false;
  schemaErrors: string[];
}

export function verificationReport(name: string, modelFile: string, model: Model, assessment: Assessment): VerificationReport {
  return {
    candidate: name,
    modelFile,
    schemaValid: true,
    model: modelDocument(model),
    structure: assessment.structure,
    unusedTransitions: assessment.unusedTransitions,
    summary: { passed: assessment.passed, total: assessment.results.length },
    workflows: assessment.results,
  };
}
