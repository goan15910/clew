// YAML specs. Zod accepts clew.spec.v1 here; the domain checks valuation invariants.
import { z } from 'zod';
import type { FileLoad } from '../../application/ports.js';
import type { LocatedError } from '../../application/documents.js';
import {
  assembleSpec,
  specInvariantIssues,
  type Action,
  type Label,
  type Spec,
  type SpecDraft,
} from '../../domain/spec-model.js';
import {
  eventName,
  valueOf,
  varId,
  type Patch,
  type Predicate,
  type Value,
  type ValueType,
  type VarDecl,
} from '../../domain/valuation.js';
import { NAME_MESSAGE, NAME_PATTERN } from '../../domain/model.js';
import { locatedErrors, locatedFromIssues } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

const VAR_TYPES = ['boolean', 'number', 'atom', 'timestamp'] as const;
const VAR_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const ScalarSchema = z.union([z.boolean(), z.number(), z.string(), z.null()]);
const VarIdSchema = z.string().regex(VAR_ID_PATTERN, 'variable ids are lower_snake_case');
const EventSchema = z.string().regex(EVENT_PATTERN, 'events are UPPER_SNAKE_CASE');
const NameSchema = z.string().regex(NAME_PATTERN, NAME_MESSAGE);

type YamlScalar = boolean | number | string | null;

type YamlPredicate =
  | { op: 'true' }
  | { op: 'eq'; var: string; value: YamlScalar }
  | { op: 'neq'; var: string; value: YamlScalar }
  | { op: 'and'; of: YamlPredicate[] }
  | { op: 'or'; of: YamlPredicate[] }
  | { op: 'not'; of: YamlPredicate };

const PredicateSchema: z.ZodType<YamlPredicate> = z.lazy(() =>
  z.union([
    z.strictObject({ op: z.literal('true') }),
    z.strictObject({ op: z.literal('eq'), var: VarIdSchema, value: ScalarSchema }),
    z.strictObject({ op: z.literal('neq'), var: VarIdSchema, value: ScalarSchema }),
    z.strictObject({ op: z.literal('and'), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal('or'), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal('not'), of: PredicateSchema }),
  ]),
);

const LabelSchema = z.strictObject({
  id: NameSchema.optional(),
  match: z.record(z.string(), ScalarSchema),
  text: z.string().min(1),
  final: z.boolean().optional(),
});

const ActionSchema = z.strictObject({
  event: EventSchema,
  actor: z.string().min(1),
  when: PredicateSchema.optional(),
  assign: z.record(z.string(), ScalarSchema).default({}),
});

const SpecFileSchema = z.strictObject({
  kind: z.literal('clew.spec.v1'),
  id: NameSchema,
  vars: z.array(z.strictObject({
    id: VarIdSchema,
    type: z.enum(VAR_TYPES),
  })).min(1),
  initial: z.record(z.string(), ScalarSchema),
  actions: z.array(ActionSchema),
  labels: z.array(LabelSchema).optional(),
});

const LOCATION_HINT =
  'location-id charts are no longer valid; rewrite as kind: clew.spec.v1 with vars, a total initial valuation, and guarded assign actions. See docs/tla-model-redesign.md';

export function locationChartHint(value: unknown): LocatedError[] {
  if (typeof value !== 'object' || value === null) return [];
  if ('kind' in value && value.kind === 'clew.spec.v1') return [];
  return [{ path: 'kind', message: LOCATION_HINT }];
}

function typeOf(vars: readonly VarDecl[], key: string): ValueType | undefined {
  for (const decl of vars) {
    if (decl.id === key) return decl.type;
  }
  return undefined;
}

function toValue(type: ValueType | undefined, raw: YamlScalar): Value {
  if (type !== undefined) return valueOf(type, raw);
  if (raw === null) return { t: 'null' };
  if (typeof raw === 'boolean') return { t: 'bool', v: raw };
  if (typeof raw === 'number') return { t: 'num', v: raw };
  return { t: 'atom', v: raw };
}

function toPatch(raw: Record<string, YamlScalar>, vars: readonly VarDecl[]): Patch {
  const patch: Record<string, Value> = {};
  for (const key of Object.keys(raw)) {
    const scalar = raw[key];
    if (scalar === undefined) continue;
    patch[key] = toValue(typeOf(vars, key), scalar);
  }
  return patch;
}

function toPredicate(raw: YamlPredicate, vars: readonly VarDecl[]): Predicate {
  if (raw.op === 'true') return { op: 'true' };
  if (raw.op === 'eq' || raw.op === 'neq') {
    const type = typeOf(vars, raw.var);
    return { op: raw.op, var: varId(raw.var), value: toValue(type, raw.value) };
  }
  if (raw.op === 'not') return { op: 'not', of: toPredicate(raw.of, vars) };
  const children: Predicate[] = [];
  for (const child of raw.of) children.push(toPredicate(child, vars));
  return { op: raw.op, of: children };
}

function toDraft(file: z.infer<typeof SpecFileSchema>): SpecDraft {
  const vars: VarDecl[] = [];
  for (const decl of file.vars) vars.push({ id: varId(decl.id), type: decl.type });
  const actions: Action[] = [];
  for (const action of file.actions) {
    actions.push({
      event: eventName(action.event),
      actor: action.actor,
      when: action.when === undefined ? { op: 'true' } : toPredicate(action.when, vars),
      assign: toPatch(action.assign, vars),
    });
  }
  const labels: Label[] = [];
  for (const label of file.labels ?? []) {
    labels.push({
      id: label.id,
      match: toPatch(label.match, vars),
      text: label.text,
      final: label.final === true ? true : undefined,
    });
  }
  return {
    id: file.id,
    vars,
    initial: toPatch(file.initial, vars),
    actions,
    labels,
  };
}

export function loadSpec(input: unknown): FileLoad<Spec> {
  const hints = locationChartHint(input);
  const parsed = SpecFileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fault: 'schema', errors: [...hints, ...locatedErrors(parsed.error.issues)] };
  }
  try {
    const draft = toDraft(parsed.data);
    const issues = specInvariantIssues(draft);
    if (issues.length > 0) return { ok: false, fault: 'graph', errors: locatedFromIssues(issues) };
    return { ok: true, value: assembleSpec(draft) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, fault: 'schema', errors: [{ path: '', message }] };
  }
}

export const yamlSpecLoader: { load(file: string): FileLoad<Spec> } = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, fault: 'unreadable', errors: [{ path: '', message: read.error }] };
    return loadSpec(read.value);
  },
};
