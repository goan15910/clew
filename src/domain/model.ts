// A flat workflow model: states, transitions, typed fields, guards, and effects.
// Cross-field invariants are checked here. Zod does not belong in this layer.

export const FIELD_TYPES = ['string', 'boolean', 'number', 'timestamp'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
export const NAME_MESSAGE = 'names are camelCase';
export const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const EVENT_MESSAGE = 'events are UPPER_SNAKE_CASE';
export const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const FIELD_NAME_MESSAGE = 'field names are lower_snake_case';

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

export interface Guard {
  name: string;
  reads: string;
}

export interface Effect {
  name: string;
  sets: string;
}

export interface Transition {
  from: string;
  event: string;
  to: string;
  actor: string;
  guard?: Guard;
  effect: Effect;
}

/** Declarations after a successful parse, before guard and effect names are resolved. */
export interface ModelDraft {
  id: string;
  initial: string;
  guards: readonly Guard[];
  effects: readonly Effect[];
  states: readonly {
    id: string;
    label: string;
    workflowState: string;
    final: boolean;
    data: Readonly<Record<string, FieldType>>;
  }[];
  transitions: readonly {
    from: string;
    event: string;
    to: string;
    actor: string;
    guard?: string;
    effect: string;
  }[];
}

export interface InvariantIssue {
  path: (string | number)[];
  message: string;
}

/** The checked model. Traversal is a separate port, so this object stays free of the engine. */
export interface Model {
  readonly id: string;
  readonly initial: string;
  states(): readonly State[];
  transitions(): readonly Transition[];
}

export interface ModelDocument {
  id: string;
  initial: string;
  states: {
    id: string;
    label: string;
    workflowState: string;
    final: boolean;
    data: { name: string; type: FieldType }[];
  }[];
  transitions: {
    from: string;
    event: string;
    to: string;
    actor: string;
    effect: Effect;
    guard?: Guard;
  }[];
}

export function modelInvariantIssues(file: ModelDraft): InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const stateIndex = new Map<string, number>();
  for (let index = 0; index < file.states.length; index += 1) {
    const state = file.states[index]!;
    const previous = stateIndex.get(state.id);
    if (previous !== undefined) {
      issues.push({
        path: ['states', index, 'id'],
        message: `duplicate state id "${state.id}" (also declared at states.${previous})`,
      });
      continue;
    }
    stateIndex.set(state.id, index);
  }
  if (!stateIndex.has(file.initial)) {
    issues.push({
      path: ['initial'],
      message: `initial state "${file.initial}" is not defined`,
    });
  }

  const guards = new Map<string, Guard>();
  for (let index = 0; index < file.guards.length; index += 1) {
    const guard = file.guards[index]!;
    if (guards.has(guard.name)) {
      issues.push({
        path: ['guards', index, 'name'],
        message: `duplicate guard "${guard.name}"`,
      });
      continue;
    }
    guards.set(guard.name, { name: guard.name, reads: guard.reads });
  }

  const effects = new Map<string, Effect>();
  for (let index = 0; index < file.effects.length; index += 1) {
    const effect = file.effects[index]!;
    if (effects.has(effect.name)) {
      issues.push({
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
      issues.push({
        path: ['transitions', index, 'from'],
        message: `transition ${where}: unknown source state "${edge.from}"`,
      });
    } else if (source.final) {
      issues.push({
        path: ['transitions', index, 'from'],
        message: `final state "${edge.from}" must not have outgoing transitions`,
      });
    }
    if (target === undefined) {
      issues.push({
        path: ['transitions', index, 'to'],
        message: `transition ${where}: unknown state "${edge.to}"`,
      });
    }
    const edgeKey = `${edge.from}|${edge.event}`;
    if (seenEdges.has(edgeKey)) {
      issues.push({
        path: ['transitions', index, 'event'],
        message: `duplicate event ${edge.event} from state "${edge.from}"`,
      });
    }
    seenEdges.add(edgeKey);

    if (edge.guard !== undefined) {
      const guard = guards.get(edge.guard);
      if (guard === undefined) {
        issues.push({
          path: ['transitions', index, 'guard'],
          message: `transition ${where}: unknown guard "${edge.guard}"`,
        });
      } else if (source !== undefined && !Object.hasOwn(source.data, guard.reads)) {
        issues.push({
          path: ['transitions', index, 'guard'],
          message: `transition ${where}: guard "${guard.name}" reads "${guard.reads}", which is not declared on source state "${edge.from}"`,
        });
      }
    }

    const effect = effects.get(edge.effect);
    if (effect === undefined) {
      issues.push({
        path: ['transitions', index, 'effect'],
        message: `transition ${where}: unknown effect "${edge.effect}"`,
      });
    } else if (target !== undefined && !Object.hasOwn(target.data, effect.sets)) {
      issues.push({
        path: ['transitions', index, 'effect'],
        message: `transition ${where}: effect "${effect.name}" sets "${effect.sets}", which is not declared on target state "${edge.to}"`,
      });
    }
  }
  return issues;
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

class FlatModel implements Model {
  readonly id: string;
  readonly initial: string;
  readonly #states: readonly State[];
  readonly #transitions: readonly Transition[];

  constructor(file: ModelDraft) {
    const guards = new Map<string, Guard>();
    for (const guard of file.guards) guards.set(guard.name, { name: guard.name, reads: guard.reads });
    const effects = new Map<string, Effect>();
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

    this.id = file.id;
    this.initial = file.initial;
    this.#states = states;
    this.#transitions = transitions;
  }

  states(): readonly State[] {
    return this.#states;
  }

  transitions(): readonly Transition[] {
    return this.#transitions;
  }
}

/** Build a model that already satisfied {@link modelInvariantIssues}. */
export function assembleModel(draft: ModelDraft): Model {
  const issues = modelInvariantIssues(draft);
  if (issues.length > 0) {
    throw new Error(`model failed invariants after parsing: ${issues.map((issue) => issue.message).join('; ')}`);
  }
  return new FlatModel(draft);
}

/** Plain copy of the model, in the key order reports have always used. */
export function modelDocument(model: Model): ModelDocument {
  const states: ModelDocument['states'] = [];
  for (const state of model.states()) {
    const data: ModelDocument['states'][number]['data'] = [];
    for (const field of state.data) data.push({ name: field.name, type: field.type });
    states.push({
      id: state.id,
      label: state.label,
      workflowState: state.workflowState,
      final: state.final,
      data,
    });
  }
  const transitions: ModelDocument['transitions'] = [];
  for (const edge of model.transitions()) {
    const item: ModelDocument['transitions'][number] = {
      from: edge.from,
      event: edge.event,
      to: edge.to,
      actor: edge.actor,
      effect: { name: edge.effect.name, sets: edge.effect.sets },
    };
    if (edge.guard) item.guard = { name: edge.guard.name, reads: edge.guard.reads };
    transitions.push(item);
  }
  return { id: model.id, initial: model.initial, states, transitions };
}
