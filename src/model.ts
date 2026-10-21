// YAML state models. Parsed once at this boundary, then executed as a flat XState machine.
import { createMachine, transition, type AnyStateMachine } from 'xstate';
import { getPathsFromEvents, getShortestPaths } from '@xstate/graph';
import { z } from 'zod';

const FIELD_TYPES = ['string', 'boolean', 'number', 'timestamp'] as const;
const FieldTypeSchema = z.enum(FIELD_TYPES);
const FieldNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'field names are lower_snake_case');
const NameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'names are camelCase');
const EventSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'events are UPPER_SNAKE_CASE');

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

export const ModelFileSchema = z.strictObject({
  id: NameSchema,
  initial: NameSchema,
  guards: z.array(GuardSchema),
  effects: z.array(EffectSchema),
  states: z.array(StateSchema).min(1),
  transitions: z.array(TransitionSchema),
}).superRefine((file, ctx) => {
  const stateIndex = new Map<string, number>();
  for (let index = 0; index < file.states.length; index += 1) {
    const state = file.states[index]!;
    const previous = stateIndex.get(state.id);
    if (previous !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['states', index, 'id'],
        message: `duplicate state id "${state.id}" (also declared at states.${previous})`,
      });
      continue;
    }
    stateIndex.set(state.id, index);
  }
  if (!stateIndex.has(file.initial)) {
    ctx.addIssue({
      code: 'custom',
      path: ['initial'],
      message: `initial state "${file.initial}" is not defined`,
    });
  }

  const guards = new Map<string, { name: string; reads: string }>();
  for (let index = 0; index < file.guards.length; index += 1) {
    const guard = file.guards[index]!;
    if (guards.has(guard.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['guards', index, 'name'],
        message: `duplicate guard "${guard.name}"`,
      });
      continue;
    }
    guards.set(guard.name, { name: guard.name, reads: guard.reads });
  }

  const effects = new Map<string, { name: string; sets: string }>();
  for (let index = 0; index < file.effects.length; index += 1) {
    const effect = file.effects[index]!;
    if (effects.has(effect.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['effects', index, 'name'],
        message: `duplicate effect "${effect.name}"`,
      });
      continue;
    }
    effects.set(effect.name, { name: effect.name, sets: effect.sets });
  }

  const seenEdges = new Set<string>();
  for (let index = 0; index < file.transitions.length; index += 1) {
    const edge = file.transitions[index]!;
    const where = `${edge.from} --${edge.event}--> ${edge.to}`;
    const source = file.states[stateIndex.get(edge.from) ?? -1];
    const target = file.states[stateIndex.get(edge.to) ?? -1];
    if (source === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'from'],
        message: `transition ${where}: unknown source state "${edge.from}"`,
      });
    } else if (source.final) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'from'],
        message: `final state "${edge.from}" must not have outgoing transitions`,
      });
    }
    if (target === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'to'],
        message: `transition ${where}: unknown state "${edge.to}"`,
      });
    }
    const edgeKey = `${edge.from}|${edge.event}`;
    if (seenEdges.has(edgeKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'event'],
        message: `duplicate event ${edge.event} from state "${edge.from}"`,
      });
    }
    seenEdges.add(edgeKey);

    if (edge.guard !== undefined) {
      const guard = guards.get(edge.guard);
      if (guard === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'guard'],
          message: `transition ${where}: unknown guard "${edge.guard}"`,
        });
      } else if (source !== undefined && !Object.hasOwn(source.data, guard.reads)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'guard'],
          message: `transition ${where}: guard "${guard.name}" reads "${guard.reads}", which is not declared on source state "${edge.from}"`,
        });
      }
    }

    const effect = effects.get(edge.effect);
    if (effect === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'effect'],
        message: `transition ${where}: unknown effect "${edge.effect}"`,
      });
    } else if (target !== undefined && !Object.hasOwn(target.data, effect.sets)) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions', index, 'effect'],
        message: `transition ${where}: effect "${effect.name}" sets "${effect.sets}", which is not declared on target state "${edge.to}"`,
      });
    }
  }
});

export type FieldType = z.infer<typeof FieldTypeSchema>;

export interface StateField {
  name: string;
  type: FieldType;
}
export interface State {
  id: string;
  label: string;
  workflowState: string;
  final: boolean;
  data: readonly StateField[];
}
export interface Transition {
  from: string;
  event: string;
  to: string;
  actor: string;
  guard?: { name: string; reads: string };
  effect: { name: string; sets: string };
}
export interface EventPath {
  state: string;
  events: readonly string[];
}

/** The machine and its checked declarations, as one surface. */
export interface Model {
  readonly id: string;
  readonly initial: string;
  states(): readonly State[];
  transitions(): readonly Transition[];
  can(state: string, event: string): boolean;
  step(state: string, event: string): string | null;
  shortestPaths(): Readonly<Record<string, readonly string[]>>;
  pathsFromEvents(events: readonly string[]): readonly EventPath[];
}

export type LoadResult = { ok: true; model: Model } | { ok: false; errors: string[] };

type ModelFile = z.infer<typeof ModelFileSchema>;

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

function fieldsOf(data: Readonly<Record<string, FieldType>>): StateField[] {
  const fields: StateField[] = [];
  for (const name of Object.keys(data)) {
    const type = data[name];
    if (type === undefined) continue;
    fields.push({ name, type });
  }
  return fields;
}

function buildMachine(id: string, initial: string, states: readonly State[], transitions: readonly Transition[]): AnyStateMachine {
  const configStates: Record<string, { type: 'final' } | { on: Record<string, { target: string }> }> = {};
  for (const state of states) {
    if (state.final) {
      configStates[state.id] = { type: 'final' };
      continue;
    }
    const on: Record<string, { target: string }> = {};
    for (const edge of transitions) {
      if (edge.from === state.id) on[edge.event] = { target: edge.to };
    }
    configStates[state.id] = { on };
  }
  // The state map is built key by key above. createMachine's generics cannot name that map.
  return createMachine({ id, initial, states: configStates } as Parameters<typeof createMachine>[0]);
}

function eventsOf(steps: readonly { event: { type: string } }[]): string[] {
  const events: string[] = [];
  for (const step of steps) {
    if (step.event.type !== 'xstate.init') events.push(step.event.type);
  }
  return events;
}

class XStateModel implements Model {
  readonly id: string;
  readonly initial: string;
  readonly #states: readonly State[];
  readonly #transitions: readonly Transition[];
  readonly #ids: ReadonlySet<string>;
  readonly #machine: AnyStateMachine;
  readonly #events: readonly { type: string }[];

  constructor(file: ModelFile) {
    const guards = new Map<string, { name: string; reads: string }>();
    for (const guard of file.guards) guards.set(guard.name, { name: guard.name, reads: guard.reads });
    const effects = new Map<string, { name: string; sets: string }>();
    for (const effect of file.effects) effects.set(effect.name, { name: effect.name, sets: effect.sets });

    const states: State[] = [];
    for (const state of file.states) {
      states.push({
        id: state.id,
        label: state.label,
        workflowState: state.workflowState,
        final: state.final,
        data: fieldsOf(state.data),
      });
    }
    const transitions: Transition[] = [];
    for (const edge of file.transitions) {
      const effect = effects.get(edge.effect);
      if (effect === undefined) throw new Error(`unknown effect "${edge.effect}" passed validation`);
      const built: Transition = {
        from: edge.from,
        event: edge.event,
        to: edge.to,
        actor: edge.actor,
        effect: { name: effect.name, sets: effect.sets },
      };
      if (edge.guard !== undefined) {
        const guard = guards.get(edge.guard);
        if (guard === undefined) throw new Error(`unknown guard "${edge.guard}" passed validation`);
        built.guard = { name: guard.name, reads: guard.reads };
      }
      transitions.push(built);
    }

    const eventTypes: string[] = [];
    const seen = new Set<string>();
    for (const edge of transitions) {
      if (seen.has(edge.event)) continue;
      seen.add(edge.event);
      eventTypes.push(edge.event);
    }

    this.id = file.id;
    this.initial = file.initial;
    this.#states = states;
    this.#transitions = transitions;
    this.#ids = new Set(states.map((state) => state.id));
    this.#events = eventTypes.map((type) => ({ type }));
    this.#machine = buildMachine(file.id, file.initial, states, transitions);
  }

  #snapshot(state: string) {
    // AnyStateMachine's resolveState requires context in its public type. Flat models have none.
    return this.#machine.resolveState({ value: state, context: {} });
  }

  states(): readonly State[] {
    return this.#states;
  }

  transitions(): readonly Transition[] {
    return this.#transitions;
  }

  can(state: string, event: string): boolean {
    if (!this.#ids.has(state)) return false;
    return this.#snapshot(state).can({ type: event });
  }

  step(state: string, event: string): string | null {
    if (!this.can(state, event)) return null;
    const [next] = transition(this.#machine, this.#snapshot(state), { type: event });
    if (typeof next.value !== 'string') throw new Error('nested and parallel states are out of scope');
    return next.value;
  }

  shortestPaths(): Readonly<Record<string, readonly string[]>> {
    const paths = getShortestPaths(this.#machine, { events: this.#events });
    const shortest: Record<string, readonly string[]> = {};
    for (const path of paths) {
      if (typeof path.state.value !== 'string') throw new Error('nested and parallel states are out of scope');
      shortest[path.state.value] = eventsOf(path.steps);
    }
    return shortest;
  }

  pathsFromEvents(events: readonly string[]): readonly EventPath[] {
    const paths = getPathsFromEvents(this.#machine, events.map((type) => ({ type })));
    const found: EventPath[] = [];
    for (const path of paths) {
      if (typeof path.state.value !== 'string') throw new Error('nested and parallel states are out of scope');
      found.push({ state: path.state.value, events: eventsOf(path.steps) });
    }
    return found;
  }
}

/** Validate `input` once and return the XState-backed model. */
export function loadModel(input: unknown): LoadResult {
  const parsed = ModelFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error.issues) };
  return { ok: true, model: new XStateModel(parsed.data) };
}
