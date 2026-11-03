// Read a fact patch file. Zod stays at this boundary; the use case receives a plain draft.
import { z } from 'zod';
import { FACT_KINDS, SPEC_FACT_ID_PATTERN, type FactKind } from '../../domain/spec.js';
import { predicateFromScalars, type FactDraft } from '../../domain/spec-facts.js';
import { patchFromScalars } from '../../domain/valuation.js';
import { readJson } from '../json/read-json.js';

const ScalarSchema = z.union([z.boolean(), z.number(), z.string(), z.null()]);

type YamlPredicate =
  | { op: 'true' }
  | { op: 'eq'; var: string; value: z.infer<typeof ScalarSchema> }
  | { op: 'neq'; var: string; value: z.infer<typeof ScalarSchema> }
  | { op: 'and'; of: YamlPredicate[] }
  | { op: 'or'; of: YamlPredicate[] }
  | { op: 'not'; of: YamlPredicate };

const PredicateSchema: z.ZodType<YamlPredicate> = z.lazy(() =>
  z.union([
    z.strictObject({ op: z.literal('true') }),
    z.strictObject({ op: z.literal('eq'), var: z.string().min(1), value: ScalarSchema }),
    z.strictObject({ op: z.literal('neq'), var: z.string().min(1), value: ScalarSchema }),
    z.strictObject({ op: z.literal('and'), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal('or'), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal('not'), of: PredicateSchema }),
  ]),
);

const FactFields = z.strictObject({
  id: z.string().regex(SPEC_FACT_ID_PATTERN).optional(),
  ids: z.array(z.string().regex(SPEC_FACT_ID_PATTERN)).optional(),
  kind: z.enum(FACT_KINDS).optional(),
  event: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  when: PredicateSchema.optional(),
  assign: z.record(z.string(), ScalarSchema).optional(),
  sources: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const AddFileSchema = z.union([
  FactFields.extend({ kind: z.enum(FACT_KINDS) }),
  z.strictObject({ facts: z.array(FactFields.extend({ kind: z.enum(FACT_KINDS) })).min(1) }),
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

export function toDraft(raw: {
  kind?: FactKind;
  event?: string;
  actor?: string;
  when?: YamlPredicate;
  assign?: Record<string, z.infer<typeof ScalarSchema>>;
  sources?: string[];
  note?: string;
  confidence?: number;
}): FactDraft {
  const draft: FactDraft = {};
  if (raw.kind !== undefined) draft.kind = raw.kind;
  if (raw.event !== undefined) draft.event = raw.event;
  if (raw.actor !== undefined) draft.actor = raw.actor;
  if (raw.when !== undefined) {
    const when = predicateFromScalars(raw.when);
    if (when !== undefined) draft.when = when;
  }
  if (raw.assign !== undefined) draft.assign = patchFromScalars(raw.assign);
  if (raw.sources !== undefined) draft.sources = raw.sources.slice();
  if (raw.note !== undefined) draft.note = raw.note;
  if (raw.confidence !== undefined) draft.confidence = raw.confidence;
  return draft;
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
