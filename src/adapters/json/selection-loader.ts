// A selection is either `{ "flows": ["W1"] }` or a passing `workflows.check` document.
// Extra fields are ignored. Only workflow ids are returned.
import { z } from 'zod';
import type { LocatedError } from '../../application/documents.js';
import { locatedErrors } from '../yaml/issue-lines.js';
import { readJson } from './read-json.js';

const FlowId = z.string().min(1);
const MinimalSelection = z.object({
  flows: z.array(FlowId).min(1),
});
const CheckSelection = z.object({
  command: z.literal('workflows.check'),
  ok: z.literal(true),
  workflowSet: z.object({
    workflows: z.array(z.object({
      id: FlowId,
    })).min(1),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function loadSelectionValue(input: unknown): { ok: true; flows: string[] } | { ok: false; errors: LocatedError[] } {
  const raw = isRecord(input) ? input : undefined;
  if (raw?.command === 'workflows.check' && raw.ok !== true) {
    return {
      ok: false,
      errors: [{ path: 'ok', message: 'workflows check document is not valid; fix the workflow set before selecting from it' }],
    };
  }
  if (raw?.command === 'workflows.check') {
    const parsed = CheckSelection.safeParse(input);
    if (!parsed.success) return { ok: false, errors: locatedErrors(parsed.error.issues) };
    const flows: string[] = [];
    for (const workflow of parsed.data.workflowSet.workflows) flows.push(workflow.id);
    return { ok: true, flows: unique(flows) };
  }
  const parsed = MinimalSelection.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        { path: '', message: 'selection must be { "flows": ["W1"] } or a passing workflows.check JSON document' },
        ...locatedErrors(parsed.error.issues),
      ],
    };
  }
  const flows: string[] = [];
  for (const id of parsed.data.flows) flows.push(id);
  return { ok: true, flows: unique(flows) };
}

export const jsonSelectionLoader = {
  load(file: string): { ok: true; flows: readonly string[] } | { ok: false; errors: LocatedError[] } {
    const read = readJson(file);
    if (!read.ok) return { ok: false, errors: [{ path: '', message: read.error }] };
    return loadSelectionValue(read.value);
  },
};
