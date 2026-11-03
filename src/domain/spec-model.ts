// A spec is a closed variable set, one total initial valuation, and guarded assign actions.
// Identity is the valuation, not a location name. Labels are display only.
import type { Issue } from './issue.js';
import {
  apply,
  eventName,
  explore,
  holds,
  makeValuation,
  sameValue,
  scalarFromValue,
  scalarsFromPatch,
  valueOf,
  varId,
  type EventName,
  type Patch,
  type Predicate,
  type ReachGraph,
  type Valuation,
  type Value,
  type ValueType,
  type VarDecl,
  type VarId,
} from './valuation.js';

export interface Action {
  readonly event: EventName;
  readonly actor: string;
  readonly when: Predicate;
  readonly assign: Patch;
}

export interface Label {
  readonly id?: string;
  readonly match: Patch;
  readonly text: string;
  readonly final?: boolean;
}

export interface SpecDraft {
  readonly id: string;
  readonly vars: readonly VarDecl[];
  readonly initial: Patch;
  readonly actions: readonly Action[];
  readonly labels: readonly Label[];
}

export interface Spec {
  readonly id: string;
  readonly vars: readonly VarDecl[];
  readonly initial: Valuation;
  readonly actions: readonly Action[];
  readonly labels: readonly Label[];
}

const LABEL_ID_PATTERN = /^[a-z][A-Za-z0-9]*$/;

export function specInvariantIssues(draft: SpecDraft): Issue[] {
  const issues: Issue[] = [];
  const vars = new Map<VarId, ValueType>();
  for (let index = 0; index < draft.vars.length; index += 1) {
    const decl = draft.vars[index];
    if (decl === undefined) continue;
    try {
      varId(decl.id);
    } catch (error) {
      issues.push({ path: ['vars', index, 'id'], message: messageOf(error) });
      continue;
    }
    if (vars.has(decl.id)) {
      issues.push({
        path: ['vars', index, 'id'],
        message: `duplicate variable "${decl.id}"`,
      });
      continue;
    }
    vars.set(decl.id, decl.type);
  }

  const initialKeys = Object.keys(draft.initial);
  for (const decl of draft.vars) {
    if (!Object.hasOwn(draft.initial, decl.id)) {
      issues.push({
        path: ['initial', decl.id],
        message: `initial valuation missing variable "${decl.id}"`,
      });
    }
  }
  for (const key of initialKeys) {
    if (!vars.has(key as VarId)) {
      issues.push({
        path: ['initial', key],
        message: `initial valuation has unknown variable "${key}"`,
      });
      continue;
    }
    const value = draft.initial[key];
    if (value === undefined) continue;
    const type = vars.get(key as VarId);
    if (type === undefined) continue;
    const mismatch = typeIssue(type, value, key);
    if (mismatch !== undefined) issues.push({ path: ['initial', key], message: mismatch });
  }

  for (let index = 0; index < draft.actions.length; index += 1) {
    const action = draft.actions[index];
    if (action === undefined) continue;
    try {
      eventName(action.event);
    } catch (error) {
      issues.push({ path: ['actions', index, 'event'], message: messageOf(error) });
    }
    if (action.actor.trim() === '') {
      issues.push({ path: ['actions', index, 'actor'], message: 'actor must not be empty' });
    }
    issues.push(...predicateIssues(action.when, vars, ['actions', index, 'when']));
    issues.push(...patchIssues(action.assign, vars, ['actions', index, 'assign']));
  }

  const labelIds = new Map<string, number>();
  for (let index = 0; index < draft.labels.length; index += 1) {
    const label = draft.labels[index];
    if (label === undefined) continue;
    if (label.text.trim() === '') {
      issues.push({ path: ['labels', index, 'text'], message: 'label text must not be empty' });
    }
    if (label.id !== undefined) {
      if (!LABEL_ID_PATTERN.test(label.id)) {
        issues.push({
          path: ['labels', index, 'id'],
          message: `label id "${label.id}" must be camelCase`,
        });
      } else if (labelIds.has(label.id)) {
        issues.push({
          path: ['labels', index, 'id'],
          message: `duplicate label id "${label.id}"`,
        });
      } else {
        labelIds.set(label.id, index);
      }
    }
    issues.push(...patchIssues(label.match, vars, ['labels', index, 'match']));
  }
  return issues;
}

export function assembleSpec(draft: SpecDraft): Spec {
  const issues = specInvariantIssues(draft);
  if (issues.length > 0) {
    throw new Error(`spec failed invariants after parsing: ${issues.map((issue) => issue.message).join('; ')}`);
  }
  const entries = new Map<VarId, Value>();
  for (const decl of draft.vars) {
    const value = draft.initial[decl.id];
    if (value === undefined) throw new Error(`initial missing "${decl.id}" after validation`);
    entries.set(decl.id, value);
  }
  return {
    id: draft.id,
    vars: draft.vars,
    initial: makeValuation(draft.vars, entries),
    actions: draft.actions,
    labels: draft.labels,
  };
}

export function enabled(spec: Spec, state: Valuation): readonly Action[] {
  const actions: Action[] = [];
  for (const action of spec.actions) {
    if (holds(action.when, state)) actions.push(action);
  }
  return actions;
}

export function can(spec: Spec, state: Valuation, event: string): boolean {
  for (const action of spec.actions) {
    if (action.event === event && holds(action.when, state)) return true;
  }
  return false;
}

/** First enabled action for `event`. Null if none. */
export function step(spec: Spec, state: Valuation, event: string): Valuation | null {
  for (const action of spec.actions) {
    if (action.event !== event) continue;
    if (!holds(action.when, state)) continue;
    return apply(state, action.assign);
  }
  return null;
}

export function nextStates(spec: Spec, state: Valuation): readonly { event: EventName; to: Valuation }[] {
  const out: { event: EventName; to: Valuation }[] = [];
  for (const action of enabled(spec, state)) {
    out.push({ event: action.event, to: apply(state, action.assign) });
  }
  return out;
}

export function reachableFromInitial(spec: Spec, bound: number): ReachGraph {
  return explore([spec.initial], (state) => nextStates(spec, state), bound);
}

export interface SpecComponent {
  readonly key: string;
  readonly vars: readonly VarId[];
  readonly actions: readonly Action[];
}

export interface ComponentReach {
  readonly key: string;
  readonly vars: readonly VarId[];
  readonly reach: ReachGraph;
}

export interface ComponentExplore {
  readonly components: readonly ComponentReach[];
  readonly visited: number;
  readonly globalCapHit: boolean;
}

/** Per-object (or joint multi-object) unfold. `bound` is each component's bound and the global cap. */
export function exploreSpecComponents(spec: Spec, bound: number): ComponentExplore {
  const parts = partitionSpec(spec);
  const components: ComponentReach[] = [];
  let visited = 0;
  let globalCapHit = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) continue;
    if (visited >= bound) {
      globalCapHit = true;
      components.push({
        key: part.key,
        vars: part.vars,
        reach: { nodes: [], edges: [], truncated: true },
      });
      continue;
    }
    const projected = projectSpec(spec, part);
    if (projected === undefined) {
      components.push({
        key: part.key,
        vars: part.vars,
        reach: { nodes: [], edges: [], truncated: true },
      });
      continue;
    }
    const reach = reachableFromInitial(projected, bound);
    visited += reach.nodes.length;
    if (visited >= bound && index < parts.length - 1) globalCapHit = true;
    components.push({ key: part.key, vars: part.vars, reach });
  }
  return { components, visited, globalCapHit };
}

function partitionSpec(spec: Spec): SpecComponent[] {
  const groups = new Map<string, { vars: Set<string>; actions: Action[] }>();
  for (const action of spec.actions) {
    const objects = objectAssignKeys(spec, action);
    const mentioned = actionVars(action);
    const key = objects.length === 0
      ? mentioned.slice().sort().join('+') || 'misc'
      : objects.join('+');
    const group = groups.get(key) ?? { vars: new Set<string>(), actions: [] };
    for (const name of mentioned) group.vars.add(name);
    for (const name of objects) group.vars.add(name);
    group.actions.push(action);
    groups.set(key, group);
  }
  const components: SpecComponent[] = [];
  for (const [key, group] of groups) {
    const vars: VarId[] = [];
    for (const name of [...group.vars].sort()) vars.push(name as VarId);
    components.push({ key, vars, actions: group.actions });
  }
  components.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return components;
}

function objectAssignKeys(spec: Spec, action: Action): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(action.assign)) {
    const decl = spec.vars.find((item) => item.id === key);
    if (decl === undefined || decl.type === 'boolean') continue;
    keys.push(key);
  }
  keys.sort();
  return keys;
}

function actionVars(action: Action): string[] {
  const names = new Set<string>();
  collectPredicateVars(action.when, names);
  for (const key of Object.keys(action.assign)) names.add(key);
  return [...names];
}

function collectPredicateVars(predicate: Predicate, into: Set<string>): void {
  if (predicate.op === 'true') return;
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    into.add(predicate.var);
    return;
  }
  if (predicate.op === 'not') {
    collectPredicateVars(predicate.of, into);
    return;
  }
  for (const child of predicate.of) collectPredicateVars(child, into);
}

function projectSpec(spec: Spec, part: SpecComponent): Spec | undefined {
  const allowed = new Set<string>();
  for (const id of part.vars) allowed.add(id);
  const vars = spec.vars.filter((decl) => allowed.has(decl.id));
  if (vars.length === 0) return undefined;
  const initial: Record<string, Value> = {};
  for (const decl of vars) initial[decl.id] = spec.initial.get(decl.id);
  try {
    return assembleSpec({
      id: spec.id,
      vars,
      initial,
      actions: part.actions,
      labels: [],
    });
  } catch {
    return undefined;
  }
}

export function valuationFromAssign(
  spec: Spec,
  assign: Patch,
): { ok: true; valuation: Valuation } | { ok: false; message: string } {
  const entries = new Map<VarId, Value>();
  for (const decl of spec.vars) {
    const value = assign[decl.id];
    if (value === undefined) {
      return { ok: false, message: `assign missing variable "${decl.id}"` };
    }
    entries.set(decl.id, value);
  }
  for (const key of Object.keys(assign)) {
    if (!spec.vars.some((decl) => decl.id === key)) {
      return { ok: false, message: `assign has unknown variable "${key}"` };
    }
  }
  try {
    return { ok: true, valuation: makeValuation(spec.vars, entries) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export function labelOf(spec: Spec, state: Valuation): Label | undefined {
  const hits: Label[] = [];
  for (const label of spec.labels) {
    if (matchHolds(label.match, state)) hits.push(label);
  }
  return hits.length === 1 ? hits[0] : undefined;
}

export function displayOf(spec: Spec, state: Valuation): string {
  const label = labelOf(spec, state);
  if (label?.id !== undefined) return label.id;
  if (label !== undefined) return label.text;
  return state.id;
}

export function jsonScalar(value: Value): boolean | number | string | null {
  return scalarFromValue(value);
}

export function patchScalars(patch: Patch): Record<string, boolean | number | string | null> {
  return scalarsFromPatch(patch);
}

export function matchHolds(match: Patch, state: Valuation): boolean {
  for (const key of Object.keys(match)) {
    const expected = match[key];
    if (expected === undefined) continue;
    if (!sameValue(state.get(key as VarId), expected)) return false;
  }
  return true;
}

function predicateIssues(predicate: Predicate, vars: Map<VarId, ValueType>, path: (string | number)[]): Issue[] {
  if (predicate.op === 'true') return [];
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    return valueRefIssues(predicate.var, predicate.value, vars, path);
  }
  if (predicate.op === 'not') return predicateIssues(predicate.of, vars, [...path, 'of']);
  const issues: Issue[] = [];
  for (let index = 0; index < predicate.of.length; index += 1) {
    const child = predicate.of[index];
    if (child === undefined) continue;
    issues.push(...predicateIssues(child, vars, [...path, 'of', index]));
  }
  return issues;
}

function patchIssues(patch: Patch, vars: Map<VarId, ValueType>, path: (string | number)[]): Issue[] {
  const issues: Issue[] = [];
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    issues.push(...valueRefIssues(key, value, vars, [...path, key]));
  }
  return issues;
}

function valueRefIssues(
  rawId: string,
  value: Value,
  vars: Map<VarId, ValueType>,
  path: (string | number)[],
): Issue[] {
  try {
    varId(rawId);
  } catch (error) {
    return [{ path, message: messageOf(error) }];
  }
  const type = vars.get(rawId as VarId);
  if (type === undefined) {
    return [{ path, message: `unknown variable "${rawId}"` }];
  }
  const mismatch = typeIssue(type, value, rawId);
  if (mismatch !== undefined) return [{ path, message: mismatch }];
  return [];
}

function typeIssue(type: ValueType, value: Value, id: string): string | undefined {
  try {
    valueOf(type, jsonScalar(value));
  } catch (error) {
    return messageOf(error);
  }
  if (type === 'boolean' && value.t !== 'bool' && value.t !== 'null') {
    return `variable "${id}" expects boolean, got ${value.t}`;
  }
  if (type === 'number' && value.t !== 'num' && value.t !== 'null') {
    return `variable "${id}" expects number, got ${value.t}`;
  }
  if (type === 'atom' && value.t !== 'atom' && value.t !== 'null') {
    return `variable "${id}" expects atom, got ${value.t}`;
  }
  if (type === 'timestamp' && value.t !== 'atom' && value.t !== 'null') {
    return `variable "${id}" expects timestamp, got ${value.t}`;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
