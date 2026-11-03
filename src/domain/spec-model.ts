// A spec is a closed variable set, one total initial valuation, and guarded assign actions.
// Identity is the valuation, not a location name. Labels are display only.
import type { Issue } from './issue.js';
import {
  apply,
  eventName,
  holds,
  makeValuation,
  sameValue,
  valueOf,
  varId,
  type EventName,
  type Patch,
  type Predicate,
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

export function can(spec: Spec, state: Valuation, event: EventName): boolean {
  for (const action of spec.actions) {
    if (action.event === event && holds(action.when, state)) return true;
  }
  return false;
}

/** First enabled action for `event`. Null if none. */
export function step(spec: Spec, state: Valuation, event: EventName): Valuation | null {
  for (const action of spec.actions) {
    if (action.event !== event) continue;
    if (!holds(action.when, state)) continue;
    return apply(state, action.assign);
  }
  return null;
}

export function labelOf(spec: Spec, state: Valuation): Label | undefined {
  const hits: Label[] = [];
  for (const label of spec.labels) {
    if (matchHolds(label.match, state)) hits.push(label);
  }
  return hits.length === 1 ? hits[0] : undefined;
}

export function jsonScalar(value: Value): boolean | number | string | null {
  if (value.t === 'null') return null;
  return value.v;
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
