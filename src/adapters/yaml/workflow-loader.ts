// Workflow files. Zod accepts the file shape here; the expectation rule lives in the domain.
import { z } from 'zod';
import type { WorkflowLoader } from '../../application/ports.js';
import { EXPECTATION_MESSAGE, expectationHolds, workflowFromParts } from '../../domain/workflow.js';
import { issueLines } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

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
}).refine((workflow) => expectationHolds(workflow), EXPECTATION_MESSAGE);

const WorkflowFileSchema = z.strictObject({
  machineId: z.string().min(1),
  workflows: z.array(WorkflowSchema).min(1),
});

export const yamlWorkflowLoader: WorkflowLoader = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, errors: [read.error] };
    const parsed = WorkflowFileSchema.safeParse(read.value);
    if (!parsed.success) {
      return { ok: false, errors: issueLines(parsed.error.issues).map((error) => `${file}: ${error}`) };
    }
    const workflows = [];
    for (const item of parsed.data.workflows) workflows.push(workflowFromParts(item));
    return { ok: true, machineId: parsed.data.machineId, workflows };
  },
};
