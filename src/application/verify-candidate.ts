// One model against an already-loaded workflow list. Shared by verify and compare.
import { assessModel } from '../domain/verification.js';
import type { Workflow } from '../domain/workflow.js';
import { candidateName } from './candidate-name.js';
import type { Ports } from './ports.js';
import { verificationReport, type InvalidModelReport, type VerificationReport } from './report-document.js';

export type CandidateRun =
  | {
      name: string;
      schemaValid: false;
      passed: number;
      total: number;
      failures: { id: string; reason: string }[];
      report: InvalidModelReport;
    }
  | {
      name: string;
      schemaValid: true;
      passed: number;
      total: number;
      failures: { id: string; reason: string }[];
      report: VerificationReport;
    };

export function verifyCandidate(
  modelFile: string,
  workflows: readonly Workflow[],
  outDir: string,
  highlight: string | undefined,
  ports: Ports,
): CandidateRun {
  const name = candidateName(modelFile);
  const loaded = ports.models.load(modelFile);
  if (!loaded.ok) {
    const report: InvalidModelReport = { candidate: name, schemaValid: false, schemaErrors: loaded.errors };
    ports.reports.writeInvalidModel(report, outDir);
    return { name, schemaValid: false, passed: 0, total: 0, failures: [], report };
  }
  const model = loaded.model;
  const assessment = assessModel(model, workflows, ports.engine.open(model));
  const report = verificationReport(name, modelFile, model, assessment);
  ports.reports.writeVerification(report, model, outDir);
  ports.diagrams.render(model, name, assessment.results, assessment.passed, outDir, highlight);
  const failures = assessment.results.filter((result) => !result.pass).map((result) => ({ id: result.id, reason: result.reason }));
  return { name, schemaValid: true, passed: assessment.passed, total: assessment.results.length, failures, report };
}
