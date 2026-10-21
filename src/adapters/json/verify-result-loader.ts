// Reads a verify JSON document down to the fields compare ranks. Traces are ignored.
import { z } from 'zod';
import type { LocatedError, ParsedVerifyResult } from '../../application/documents.js';
import type { VerifyResultLoader } from '../../application/ports.js';
import { locatedErrors } from '../yaml/issue-lines.js';
import { readJson } from './read-json.js';

const VerifyResultSchema = z.object({
  command: z.literal('verify'),
  ok: z.boolean(),
  candidate: z.string().min(1),
  chartId: z.string().min(1),
  workflowSetId: z.string().min(1),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  flows: z.array(z.object({
    id: z.string().min(1),
    pass: z.boolean(),
    reason: z.string(),
  })).min(1),
});

export function loadVerifyResultValue(
  input: unknown,
): { ok: true; result: ParsedVerifyResult } | { ok: false; errors: LocatedError[] } {
  const parsed = VerifyResultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: locatedErrors(parsed.error.issues) };
  const failures: { id: string; reason: string }[] = [];
  let passed = 0;
  for (const flow of parsed.data.flows) {
    if (flow.pass) {
      passed += 1;
      continue;
    }
    failures.push({ id: flow.id, reason: flow.reason });
  }
  const failed = parsed.data.flows.length - passed;
  const summary = parsed.data.summary;
  if (summary.passed !== passed || summary.failed !== failed || summary.total !== parsed.data.flows.length || parsed.data.ok !== (failed === 0)) {
    return { ok: false, errors: [{ path: '', message: 'verify document does not match its flow results' }] };
  }
  return {
    ok: true,
    result: {
      name: parsed.data.candidate,
      chartId: parsed.data.chartId,
      workflowSetId: parsed.data.workflowSetId,
      ok: parsed.data.ok,
      passed,
      failed,
      total: parsed.data.flows.length,
      failures,
    },
  };
}

export const jsonVerifyResultLoader: VerifyResultLoader = {
  load(file) {
    const read = readJson(file);
    if (!read.ok) return { ok: false as const, errors: [{ path: '', message: read.error }] };
    return loadVerifyResultValue(read.value);
  },
};
