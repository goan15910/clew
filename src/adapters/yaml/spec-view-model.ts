// Label-flat Model for chart analyze/view and verify coverage diagrams.
// Verify itself uses Spec.step; this projection is not a proof.
import { chartStateId, type FieldType, type Guard, type Model, type State, type Transition } from '../../domain/model.js';
import { predicateText, predicateVars, withoutVar } from '../../domain/spec-expr.js';
import { matchHolds, type Label, type Spec } from '../../domain/spec-model.js';
import type { Patch, Predicate, ValueType, VarId } from '../../domain/valuation.js';

export function specViewModel(spec: Spec): Model {
  const states: State[] = [];
  const seen = new Set<string>();
  const data = fieldsOf(spec);
  for (const label of spec.labels) {
    const id = labelId(label);
    if (seen.has(id)) continue;
    seen.add(id);
    states.push({
      id,
      label: label.text,
      final: label.final === true,
      data,
    });
  }
  const control = controlVar(spec);
  const transitions: Transition[] = [];
  const edges = new Set<string>();
  const effectSets = data[0]?.name ?? spec.vars[0]?.id ?? 'value';
  if (control !== undefined) {
    for (const action of spec.actions) {
      const froms = atomEqs(action.when, control);
      for (const from of froms) {
        const to = atomAssign(action.assign, control) ?? from;
        const key = `${from}|${action.event}`;
        if (edges.has(key)) continue;
        edges.add(key);
        const built: Transition = {
          from,
          event: action.event,
          to,
          actor: action.actor,
          effect: { name: 'assign', sets: effectSets },
        };
        const guard = extraGuard(action.when, control);
        if (guard !== undefined) built.guard = guard;
        transitions.push(built);
      }
    }
  }
  const initial = initialId(spec, control);
  return {
    id: spec.id,
    initial,
    states: () => states,
    transitions: () => transitions,
  };
}

function fieldsOf(spec: Spec): { name: string; type: FieldType }[] {
  const fields: { name: string; type: FieldType }[] = [];
  for (const decl of spec.vars) {
    fields.push({ name: decl.id, type: fieldType(decl.type) });
  }
  return fields;
}

function fieldType(type: ValueType): FieldType {
  if (type === 'atom') return 'string';
  if (type === 'boolean') return 'boolean';
  if (type === 'number') return 'number';
  return 'timestamp';
}

function labelId(label: Label): string {
  if (label.id !== undefined) return label.id;
  const keys = Object.keys(label.match);
  if (keys.length === 1) {
    const value = label.match[keys[0]!];
    if (value?.t === 'atom') return value.v;
  }
  return chartStateId(label.text);
}

function controlVar(spec: Spec): VarId | undefined {
  const counts = new Map<string, number>();
  for (const label of spec.labels) {
    const keys = Object.keys(label.match);
    if (keys.length !== 1) continue;
    const key = keys[0];
    if (key === undefined) continue;
    const value = label.match[key];
    if (value?.t !== 'atom') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best as VarId | undefined;
}

function initialId(spec: Spec, control: VarId | undefined): string {
  for (const label of spec.labels) {
    if (matchHolds(label.match, spec.initial)) return labelId(label);
  }
  if (control !== undefined) {
    const value = spec.initial.get(control);
    if (value.t === 'atom') return value.v;
  }
  return spec.labels[0] !== undefined ? labelId(spec.labels[0]) : spec.id;
}

function atomEqs(predicate: Predicate, id: VarId): string[] {
  if (predicate.op === 'eq' && predicate.var === id && predicate.value.t === 'atom') {
    return [predicate.value.v];
  }
  if (predicate.op === 'and' || predicate.op === 'or') {
    const found: string[] = [];
    for (const child of predicate.of) found.push(...atomEqs(child, id));
    return found;
  }
  return [];
}

function atomAssign(patch: Patch, id: VarId): string | undefined {
  const value = patch[id];
  if (value?.t === 'atom') return value.v;
  return undefined;
}

/** What the action waits on besides the control state, as one expression: `title ≠ ""`. */
function extraGuard(predicate: Predicate, control: VarId): Guard | undefined {
  const extra = withoutVar(predicate, control);
  if (extra.op === 'true') return undefined;
  const reads = predicateVars(extra)[0];
  if (reads === undefined) return undefined;
  return { name: predicateText(extra, 'math'), reads };
}
