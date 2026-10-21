// YAML state charts. Zod accepts the file shape here, then the domain checks graph invariants.
import { z } from 'zod';
import type { FileLoad } from '../../application/ports.js';
import type { LocatedError } from '../../application/documents.js';
import {
  assembleModel,
  EVENT_MESSAGE,
  EVENT_PATTERN,
  FIELD_NAME_MESSAGE,
  FIELD_NAME_PATTERN,
  FIELD_TYPES,
  modelInvariantIssues,
  NAME_MESSAGE,
  NAME_PATTERN,
  type FieldType,
  type Model,
  type ModelDraft,
} from '../../domain/model.js';
import { locatedErrors, locatedFromIssues } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

const FieldTypeSchema = z.enum(FIELD_TYPES);
const FieldNameSchema = z.string().regex(FIELD_NAME_PATTERN, FIELD_NAME_MESSAGE);
const NameSchema = z.string().regex(NAME_PATTERN, NAME_MESSAGE);
const EventSchema = z.string().regex(EVENT_PATTERN, EVENT_MESSAGE);

const StateSchema = z.strictObject({
  id: NameSchema,
  label: z.string().min(1),
  final: z.boolean().default(false),
  data: z.record(FieldNameSchema, FieldTypeSchema),
});
const GuardSchema = z.strictObject({
  name: NameSchema,
  reads: FieldNameSchema,
});
const EffectSchema = z.strictObject({
  name: NameSchema,
  sets: FieldNameSchema,
});
const TransitionSchema = z.strictObject({
  from: NameSchema,
  event: EventSchema,
  to: NameSchema,
  actor: z.string().min(1),
  guard: NameSchema.optional(),
  effect: NameSchema,
});

const ModelFileSchema = z.strictObject({
  id: NameSchema,
  initial: NameSchema,
  guards: z.array(GuardSchema),
  effects: z.array(EffectSchema),
  states: z.array(StateSchema).min(1),
  transitions: z.array(TransitionSchema),
});

function toModelDraft(file: z.infer<typeof ModelFileSchema>): ModelDraft {
  const guards: { name: string; reads: string }[] = [];
  for (const guard of file.guards) guards.push({ name: guard.name, reads: guard.reads });
  const effects: { name: string; sets: string }[] = [];
  for (const effect of file.effects) effects.push({ name: effect.name, sets: effect.sets });
  const states: ModelDraft['states'][number][] = [];
  for (const state of file.states) {
    const data: Record<string, FieldType> = {};
    for (const name of Object.keys(state.data)) {
      const type = state.data[name];
      if (type === undefined) continue;
      data[name] = type;
    }
    states.push({
      id: state.id,
      label: state.label,
      final: state.final,
      data,
    });
  }
  const transitions: ModelDraft['transitions'][number][] = [];
  for (const edge of file.transitions) {
    const item: ModelDraft['transitions'][number] = {
      from: edge.from,
      event: edge.event,
      to: edge.to,
      actor: edge.actor,
      effect: edge.effect,
    };
    if (edge.guard !== undefined) item.guard = edge.guard;
    transitions.push(item);
  }
  return { id: file.id, initial: file.initial, guards, effects, states, transitions };
}

function chartHints(value: unknown): LocatedError[] {
  if (typeof value !== 'object' || value === null) return [];
  const states = 'states' in value ? value.states : undefined;
  if (!Array.isArray(states)) return [];
  const legacy = states.some((state) => typeof state === 'object' && state !== null && 'workflowState' in state);
  if (!legacy) return [];
  return [{ path: '', message: 'workflowState was removed from chart states; put state correspondence in the mapping file' }];
}

export function loadModel(input: unknown): FileLoad<Model> {
  const parsed = ModelFileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fault: 'schema', errors: [...chartHints(input), ...locatedErrors(parsed.error.issues)] };
  }
  const draft = toModelDraft(parsed.data);
  const issues = modelInvariantIssues(draft);
  if (issues.length > 0) return { ok: false, fault: 'graph', errors: locatedFromIssues(issues) };
  return { ok: true, value: assembleModel(draft) };
}

export const yamlModelLoader: { load(file: string): FileLoad<Model> } = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, fault: 'unreadable', errors: [{ path: '', message: read.error }] };
    return loadModel(read.value);
  },
};
