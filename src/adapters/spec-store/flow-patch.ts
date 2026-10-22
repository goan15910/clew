// JSON patches for spec graph split and group. Zod stops at this file.
import { z } from 'zod';
import type { GroupRequest } from '../../domain/spec-graph.js';
import { WORKFLOW_ID_MESSAGE, WORKFLOW_ID_PATTERN } from '../../domain/workflow.js';
import { readJson } from '../json/read-json.js';

const TRANSITION_ID = /^tr[1-9][0-9]*$/;
const FlowId = z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE);

const SplitPatch = z.strictObject({
  id: FlowId,
  at: z.union([z.number().int().positive(), z.string().regex(/^[A-Za-z0-9_-]+$/, 'split at a transition id or a 1-based edge number')]),
});

const GroupPatch = z.strictObject({
  ids: z.array(FlowId).min(2).optional(),
  transitions: z.array(z.string().regex(TRANSITION_ID, 'transition ids look like tr1')).min(2).optional(),
  title: z.string().min(1).optional(),
  into: FlowId.optional(),
}).superRefine((value, context) => {
  const hasFlows = value.ids !== undefined;
  const hasTransitions = value.transitions !== undefined;
  if (hasFlows && hasTransitions) {
    context.addIssue({ code: 'custom', message: 'group file needs ids or transitions, not both', path: ['ids'] });
  }
  if (!hasFlows && !hasTransitions) {
    context.addIssue({ code: 'custom', message: 'group file needs ids or transitions', path: ['ids'] });
  }
});

export function loadSplitPatch(file: string): { ok: true; id: string; at: string } | { ok: false; message: string } {
  const read = readPatch(file);
  if (!read.ok) return read;
  const parsed = SplitPatch.safeParse(read.value);
  if (!parsed.success) return { ok: false, message: patchMessage(file, parsed.error) };
  return { ok: true, id: parsed.data.id, at: String(parsed.data.at) };
}

export function loadGroupPatch(file: string): { ok: true; request: GroupRequest } | { ok: false; message: string } {
  const read = readPatch(file);
  if (!read.ok) return read;
  const parsed = GroupPatch.safeParse(read.value);
  if (!parsed.success) return { ok: false, message: patchMessage(file, parsed.error) };
  const request: GroupRequest = {};
  if (parsed.data.ids !== undefined) request.flowIds = parsed.data.ids.slice();
  if (parsed.data.transitions !== undefined) request.transitionIds = parsed.data.transitions.slice();
  if (parsed.data.title !== undefined) request.title = parsed.data.title;
  if (parsed.data.into !== undefined) request.into = parsed.data.into;
  return { ok: true, request };
}

function readPatch(file: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (file === '-') return { ok: false, message: 'Clew never reads stdin' };
  const read = readJson(file);
  if (!read.ok) return { ok: false, message: read.error };
  return { ok: true, value: read.value };
}

function patchMessage(file: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join('.') ?? '';
  const message = issue?.message ?? 'invalid graph patch';
  return path === '' ? `invalid graph patch in ${file}: ${message}` : `invalid graph patch in ${file}: ${path}: ${message}`;
}
