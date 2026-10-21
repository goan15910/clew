// Use case: verify several candidate models against one workflow file and rank them.
import { rankCandidates, type Comparison } from '../domain/comparison.js';
import { candidateName } from './candidate-name.js';
import type { Ports } from './ports.js';
import { verifyCandidate, type CandidateRun } from './verify-candidate.js';

export interface CompareModelsCommand {
  workflowsFile: string;
  modelFiles: readonly string[];
  outDir: string;
  highlight?: string;
}

export type CompareModelsResult =
  | { status: 'invalid-input'; errors: string[] }
  | { status: 'ran'; runs: CandidateRun[]; comparison: Comparison };

export function compareModels(command: CompareModelsCommand, ports: Ports): CompareModelsResult {
  const workflows = ports.workflows.load(command.workflowsFile);
  if (!workflows.ok) return { status: 'invalid-input', errors: workflows.errors };
  const runs: CandidateRun[] = [];
  for (const modelFile of command.modelFiles) {
    runs.push(verifyCandidate(modelFile, workflows.workflows, `${command.outDir}/${candidateName(modelFile)}`, command.highlight, ports));
  }
  const { comparison, ranked } = rankCandidates(runs);
  ports.reports.writeComparison(comparison, ranked, command.outDir);
  return { status: 'ran', runs, comparison };
}
