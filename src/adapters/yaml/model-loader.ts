// YAML models. Zod accepts the file shape here, then the domain checks invariants.
import { z } from 'zod';
import type { ModelLoader } from '../../application/ports.js';
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
  type ModelDraft,
} from '../../domain/model.js';
import { issueLines } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

const FieldTypeSchema = z.enum(FIELD_TYPES);
const FieldNameSchema = z.string().regex(FIELD_NAME_PATTERN, FIELD_NAME_MESSAGE);
const NameSchema = z.string().regex(NAME_PATTERN, NAME_MESSAGE);
const EventSchema = z.string().regex(EVENT_PATTERN, EVENT_MESSAGE);

const StateSchema = z.strictObject({
  id: NameSchema,
  label: z.string().min(1),
  workflowState: z.string().min(1),
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
}).superRefine((file, ctx) => {
  for (const issue of modelInvariantIssues(toModelDraft(file))) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

function toModelDraft(file: z.infer<typeof ModelFileSchema>): ModelDraft {
  const guards: { name: string; reads: string }[] = [];
  for (const guard of file.guards) guards.push({ name: guard.name, reads: guard.reads });
  const effects: { name: string; sets: string }[] = [];
  for (const effect of file.effects) effects.push({ name: effect.name, sets: effect.sets });
  const states: {
    id: string;
    label: string;
    workflowState: string;
    final: boolean;
    data: Record<string, FieldType>;
  }[] = [];
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
      workflowState: state.workflowState,
      final: state.final,
      data,
    });
  }
  const transitions: {
    from: string;
    event: string;
    to: string;
    actor: string;
    guard?: string;
    effect: string;
  }[] = [];
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

export function loadModel(input: unknown): ReturnType<ModelLoader['load']> {
  const parsed = ModelFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error.issues) };
  return { ok: true, model: assembleModel(toModelDraft(parsed.data)) };
}

export const yamlModelLoader: ModelLoader = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, errors: [read.error] };
    return loadModel(read.value);
  },
};
