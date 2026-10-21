// Workflow files: event sequences plus the expected accept or refusal. Parsed only from the CLI.
import { z } from 'zod';

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

const WorkflowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  expect: z.enum(['accepted', 'rejected']),
  end: z.string().min(1).optional(),
  rejectAt: z.number().int().positive().optional(),
  steps: z.array(z.strictObject({
    text: z.string().min(1),
    event: z.string().min(1),
  })).min(1),
}).refine(
  (workflow) => (workflow.expect === 'accepted' ? workflow.end !== undefined : workflow.rejectAt !== undefined),
  'accepted needs `end`, rejected needs `rejectAt`',
);

export const WorkflowFileSchema = z.strictObject({
  machineId: z.string().min(1),
  workflows: z.array(WorkflowSchema).min(1),
});

export type WorkflowParse = { ok: true; machineId: string; workflows: Workflow[] } | { ok: false; errors: string[] };

function issueLines(issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const path: string[] = [];
    for (const part of issue.path) {
      if (typeof part === 'string' || typeof part === 'number') path.push(String(part));
    }
    lines.push(path.length > 0 ? `${path.join('.')}: ${issue.message}` : issue.message);
  }
  return lines;
}

export function parseWorkflows(input: unknown): WorkflowParse {
  const parsed = WorkflowFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error.issues) };
  const workflows: Workflow[] = [];
  for (const item of parsed.data.workflows) {
    const steps: WorkflowStep[] = [];
    for (const step of item.steps) steps.push({ text: step.text, event: step.event });
    const workflow: Workflow = { id: item.id, title: item.title, expect: item.expect, steps };
    if (item.end !== undefined) workflow.end = item.end;
    if (item.rejectAt !== undefined) workflow.rejectAt = item.rejectAt;
    workflows.push(workflow);
  }
  return { ok: true, machineId: parsed.data.machineId, workflows };
}
