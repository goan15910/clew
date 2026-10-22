// Read a fact patch file. Zod stays at this boundary; the use case receives a plain draft.
import { z } from 'zod';
import { FACT_TYPES, SPEC_FACT_ID_PATTERN, type FactType } from '../../domain/spec.js';
import type { FactDraft } from '../../domain/spec-facts.js';
import { readJson } from '../json/read-json.js';

const FactFields = z.strictObject({
  id: z.string().regex(SPEC_FACT_ID_PATTERN).optional(),
  ids: z.array(z.string().regex(SPEC_FACT_ID_PATTERN)).optional(),
  type: z.enum(FACT_TYPES).optional(),
  actor: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  object: z.string().min(1).optional(),
  from: z.string().nullable().optional(),
  to: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  sources: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const AddFileSchema = z.union([
  FactFields.extend({ type: z.enum(FACT_TYPES) }),
  z.strictObject({ facts: z.array(FactFields.extend({ type: z.enum(FACT_TYPES) })).min(1) }),
]);

export function loadAddedFacts(file: string): { ok: true; drafts: FactDraft[] } | { ok: false; message: string } {
  const read = readPatch(file);
  if (!read.ok) return read;
  const parsed = AddFileSchema.safeParse(read.value);
  if (!parsed.success) return { ok: false, message: patchMessage(file, parsed.error) };
  if ('facts' in parsed.data) {
    const drafts: FactDraft[] = [];
    for (const fact of parsed.data.facts) drafts.push(toDraft(fact));
    return { ok: true, drafts };
  }
  return { ok: true, drafts: [toDraft(parsed.data)] };
}

export function loadFactEdit(file: string): { ok: true; id?: string; draft: FactDraft } | { ok: false; message: string } {
  const read = readPatch(file);
  if (!read.ok) return read;
  const parsed = FactFields.safeParse(read.value);
  if (!parsed.success) return { ok: false, message: patchMessage(file, parsed.error) };
  return { ok: true, id: parsed.data.id, draft: toDraft(parsed.data) };
}

export function loadRemovedFacts(file: string): { ok: true; ids: string[] } | { ok: false; message: string } {
  const read = readPatch(file);
  if (!read.ok) return read;
  const parsed = z.union([
    z.strictObject({ id: z.string().regex(SPEC_FACT_ID_PATTERN) }),
    z.strictObject({ ids: z.array(z.string().regex(SPEC_FACT_ID_PATTERN)).min(1) }),
  ]).safeParse(read.value);
  if (!parsed.success) return { ok: false, message: patchMessage(file, parsed.error) };
  if ('ids' in parsed.data) return { ok: true, ids: parsed.data.ids.slice() };
  return { ok: true, ids: [parsed.data.id] };
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
  const message = issue?.message ?? 'invalid fact patch';
  return path === '' ? `invalid fact patch in ${file}: ${message}` : `invalid fact patch in ${file}: ${path}: ${message}`;
}

function toDraft(raw: z.infer<typeof FactFields> & { type?: FactType }): FactDraft {
  const draft: FactDraft = {};
  if (raw.type !== undefined) draft.type = raw.type;
  if (raw.actor !== undefined) draft.actor = raw.actor;
  if (raw.action !== undefined) draft.action = raw.action;
  if (raw.object !== undefined) draft.object = raw.object;
  if (raw.from !== undefined) draft.from = raw.from;
  if (raw.to !== undefined) draft.to = raw.to;
  if (raw.condition !== undefined) draft.condition = raw.condition;
  if (raw.state !== undefined) draft.state = raw.state;
  if (raw.sources !== undefined) draft.sources = raw.sources.slice();
  if (raw.note !== undefined) draft.note = raw.note;
  if (raw.confidence !== undefined) draft.confidence = raw.confidence;
  return draft;
}
