// Workflows: event sequences and the expected accept or refusal.

export interface WorkflowStep {
  text: string;
  event: string;
}

export interface Workflow {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  end?: string;
  rejectAt?: number;
  steps: WorkflowStep[];
}

/** `accepted` names the state the sequence must finish in. `rejected` names the step that must be refused. */
export const EXPECTATION_MESSAGE = 'accepted needs `end`, rejected needs `rejectAt`';

export function expectationHolds(workflow: {
  expect: 'accepted' | 'rejected';
  end?: string;
  rejectAt?: number;
}): boolean {
  return workflow.expect === 'accepted' ? workflow.end !== undefined : workflow.rejectAt !== undefined;
}

export function workflowFromParts(parts: {
  id: string;
  title: string;
  expect: 'accepted' | 'rejected';
  end?: string;
  rejectAt?: number;
  steps: readonly { text: string; event: string }[];
}): Workflow {
  const steps: WorkflowStep[] = [];
  for (const step of parts.steps) steps.push({ text: step.text, event: step.event });
  const workflow: Workflow = { id: parts.id, title: parts.title, expect: parts.expect, steps };
  if (parts.end !== undefined) workflow.end = parts.end;
  if (parts.rejectAt !== undefined) workflow.rejectAt = parts.rejectAt;
  if (!expectationHolds(workflow)) throw new Error(EXPECTATION_MESSAGE);
  return workflow;
}
