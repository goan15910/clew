// Use case: verify one model file against one workflow file.
import type { Ports } from './ports.js';
import { verifyCandidate, type CandidateRun } from './verify-candidate.js';

export interface VerifyModelCommand {
  modelFile: string;
  workflowsFile: string;
  outDir: string;
  highlight?: string;
}

export type VerifyModelResult =
  | { status: 'invalid-input'; errors: string[] }
  | { status: 'ran'; run: CandidateRun };

export function verifyModel(command: VerifyModelCommand, ports: Ports): VerifyModelResult {
  const workflows = ports.workflows.load(command.workflowsFile);
  if (!workflows.ok) return { status: 'invalid-input', errors: workflows.errors };
  const run = verifyCandidate(command.modelFile, workflows.workflows, command.outDir, command.highlight, ports);
  return { status: 'ran', run };
}
