// Frames → the compiled spec. One variable per object; the event assigns the result value.
// `when` refs become guards: the object's own prior result, another object's result, or a
// boolean condition var for a clause with no verb. Missing roles are warnings, never blocking.
import type { Action, SpecDraft } from './spec-model.js';
import { DEFAULT_INITIAL_ATOM, type ActionOverlay, type CompiledAction, type CompiledForbidden, type CompiledItem, type CompiledSpec } from './spec-actions.js';
import { UNSPECIFIED_ACTOR_NAME, type Concept, type Finding, type Frame, type Role, type SpecSnapshot } from './spec.js';
import { findConcept } from './spec-concepts.js';
import { normalizeWord } from './spec-words.js';
import { eventName, type Patch, type Predicate, type Value, type VarDecl, type VarId } from './valuation.js';

const VAR_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export interface FrameCompilation {
  compiled: CompiledSpec;
  findings: Finding[];
  /** Frame id → the earlier frame it restates. A restatement adds no second action. */
  restated: Record<string, string>;
}

interface Target {
  frame: Frame;
  object: string;
  objectVar: string;
  event: string;
  result: string;
  actor: string;
  evidence: { event: string[]; object: string[] };
}

interface Guard {
  when: Predicate;
  from: string;
  guard?: string;
  guardText?: string;
}

export function compileSnapshot(snapshot: SpecSnapshot): CompiledSpec {
  return compileFrames(snapshot.frames ?? [], snapshot.concepts ?? []).compiled;
}

export function compileFrames(frames: readonly Frame[], concepts: readonly Concept[]): FrameCompilation {
  const findings: Finding[] = [];
  const byId = new Map<string, Frame>();
  for (const frame of frames) byId.set(frame.id, frame);
  const targets = new Map<string, Target>();
  const ordered: Target[] = [];
  for (const frame of frames) {
    if (frame.notTransition !== undefined) continue;
    const target = targetOf(frame, concepts, findings);
    if (target === undefined) continue;
    targets.set(frame.id, target);
    ordered.push(target);
  }
  const vars: VarDecl[] = [];
  const seen = new Set<string>();
  for (const target of ordered) declare(vars, seen, target.objectVar, 'atom');
  const conditions: string[] = [];
  const items: CompiledItem[] = [];
  const actions: Action[] = [];
  const restated: Record<string, string> = {};
  const stated = new Map<string, string>();
  for (const target of ordered) {
    const guard = guardOf(target, targets, byId, conditions);
    const key = [target.frame.negated === true ? 'forbidden' : 'action', target.objectVar, target.event, guard.from, target.result, guard.guard ?? ''].join('|');
    const earlier = stated.get(key);
    if (earlier !== undefined) {
      restated[target.frame.id] = earlier;
      continue;
    }
    stated.set(key, target.frame.id);
    const assign: Patch = { [target.objectVar]: { t: 'atom', v: target.result } };
    const sources = [target.frame.sentence, ...target.evidence.event, ...target.evidence.object];
    if (target.frame.negated === true) {
      const forbidden: CompiledForbidden = {
        kind: 'forbidden',
        id: target.frame.id,
        sources,
        object: target.object,
        event: target.event,
        attempted: target.result,
        actor: target.actor,
        when: guard.when,
        assign,
      };
      items.push(forbidden);
      continue;
    }
    const overlay: ActionOverlay = { object: target.object, objectVar: target.objectVar, from: guard.from, to: target.result, actor: target.actor };
    if (guard.guard !== undefined) overlay.guard = guard.guard;
    if (guard.guardText !== undefined) overlay.guardText = guard.guardText;
    const action: CompiledAction = {
      kind: 'action',
      id: target.frame.id,
      sources,
      event: target.event,
      when: guard.when,
      assign,
      overlay,
      evidence: { event: target.evidence.event.slice(), object: target.evidence.object.slice() },
    };
    items.push(action);
    actions.push({ event: eventName(target.event), actor: target.actor, when: guard.when, assign });
  }
  for (const name of conditions) declare(vars, seen, name, 'boolean');
  const initial: Record<string, Value> = {};
  for (const decl of vars) initial[decl.id] = decl.type === 'boolean' ? { t: 'bool', v: false } : { t: 'null' };
  const first = ordered[0];
  const draft: SpecDraft = { id: first === undefined ? 'spec' : camelId(first.object), vars, initial, actions, labels: [] };
  for (const finding of neverAssigned(items, conditions)) findings.push(finding);
  return { compiled: { draft, items }, findings, restated };
}

/** `fr:s1.t13` → `cond_s1_t13`. */
export function conditionVar(frameId: string): string {
  return `cond_${frameId.replace(/^fr:/, '').replace(/\./g, '_')}`;
}

function targetOf(frame: Frame, concepts: readonly Concept[], findings: Finding[]): Target | undefined {
  const event = known(frame.roles.event.latest.value);
  const object = known(frame.roles.object.latest.value);
  const result = known(frame.roles.result.latest.value);
  const eventLabel = event === undefined ? undefined : upperSnake(event.text);
  const objectName = object === undefined ? undefined : conceptName(object, concepts);
  const objectVar = objectName?.replace(/-/g, '_');
  const resultAtom = result === undefined ? undefined : resultName(result, concepts);
  if (eventLabel === undefined) findings.push(missing(frame, 'event'));
  if (objectName === undefined || objectVar === undefined || !VAR_ID_PATTERN.test(objectVar)) findings.push(missing(frame, 'object'));
  if (resultAtom === undefined) findings.push(missing(frame, 'result'));
  if (eventLabel === undefined || objectName === undefined || objectVar === undefined || !VAR_ID_PATTERN.test(objectVar) || resultAtom === undefined) return undefined;
  const actor = known(frame.roles.actor.latest.value);
  return {
    frame,
    object: objectName,
    objectVar: `${objectVar}_status`,
    event: eventLabel,
    result: resultAtom,
    actor: actor === undefined ? UNSPECIFIED_ACTOR_NAME : conceptName(actor, concepts) ?? UNSPECIFIED_ACTOR_NAME,
    evidence: { event: frame.roles.event.latest.dependsOn.slice(0, 1), object: frame.roles.object.latest.dependsOn.slice() },
  };
}

function guardOf(target: Target, targets: ReadonlyMap<string, Target>, frames: ReadonlyMap<string, Frame>, conditions: string[]): Guard {
  let own: string | undefined;
  const extra: Predicate[] = [];
  let guard: string | undefined;
  let guardText: string | undefined;
  const when = known(target.frame.roles.when.latest.value);
  for (const ref of when?.refs ?? []) {
    const other = targets.get(ref);
    if (other !== undefined) {
      if (other.objectVar === target.objectVar) own ??= other.result;
      else extra.push(eq(other.objectVar, { t: 'atom', v: other.result }));
      continue;
    }
    const condition = frames.get(ref);
    if (condition?.notTransition === undefined) continue;
    const name = conditionVar(ref);
    if (!conditions.includes(name)) conditions.push(name);
    extra.push(eq(name, { t: 'bool', v: condition.marker !== 'unless' }));
    if (guard === undefined) {
      guard = `condition:${name}`;
      guardText = conditionText(condition);
    }
  }
  const parts: Predicate[] = [eq(target.objectVar, own === undefined ? { t: 'null' } : { t: 'atom', v: own }), ...extra];
  const result: Guard = { when: parts.length === 1 && parts[0] !== undefined ? parts[0] : { op: 'and', of: parts }, from: own ?? DEFAULT_INITIAL_ATOM };
  if (guard !== undefined) result.guard = guard;
  if (guardText !== undefined) result.guardText = guardText;
  return result;
}

function neverAssigned(items: readonly CompiledItem[], conditions: readonly string[]): Finding[] {
  const assigned = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'action') continue;
    for (const key of Object.keys(item.assign)) {
      const value = item.assign[key];
      if (value !== undefined) assigned.add(valueKey(key, value));
    }
  }
  const checked = new Map<string, { name: string; value: string; frames: string[] }>();
  for (const item of items) {
    const when = item.kind === 'action' || item.kind === 'forbidden' ? item.when : undefined;
    if (when === undefined) continue;
    for (const check of equalities(when)) {
      if (check.value.t === 'null') continue;
      const value: Value = conditions.includes(check.var) ? { t: 'bool', v: true } : check.value;
      const key = valueKey(check.var, value);
      if (assigned.has(key)) continue;
      const entry = checked.get(key) ?? { name: check.var, value: shown(value), frames: [] };
      if (!entry.frames.includes(item.id)) entry.frames.push(item.id);
      checked.set(key, entry);
    }
  }
  const findings: Finding[] = [];
  for (const entry of checked.values()) {
    findings.push({
      id: `value-never-assigned:${entry.name}=${entry.value}`,
      kind: 'gap',
      code: 'value-never-assigned',
      severity: 'warning',
      message: `${entry.name} is checked for ${entry.value}, but no action assigns it`,
      refs: [entry.name, ...entry.frames],
    });
  }
  return findings;
}

function equalities(predicate: Predicate): { var: VarId; value: Value }[] {
  if (predicate.op === 'eq') return [{ var: predicate.var, value: predicate.value }];
  if (predicate.op !== 'and') return [];
  const found: { var: VarId; value: Value }[] = [];
  for (const child of predicate.of) {
    for (const check of equalities(child)) found.push(check);
  }
  return found;
}

function known(role: Role): Exclude<Role, 'unknown'> | undefined {
  return role === 'unknown' ? undefined : role;
}

function conceptName(role: Exclude<Role, 'unknown'>, concepts: readonly Concept[]): string | undefined {
  const ref = role.refs[0];
  const concept = ref === undefined ? undefined : findConcept(concepts, ref);
  return normalizeWord(concept?.canonical ?? role.text).word;
}

function resultName(role: Exclude<Role, 'unknown'>, concepts: readonly Concept[]): string | undefined {
  if (role.refs.length > 0) return conceptName(role, concepts);
  return normalizeWord(role.text).word;
}

function upperSnake(text: string): string | undefined {
  const event = text.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return EVENT_PATTERN.test(event) ? event : undefined;
}

function conditionText(frame: Frame): string {
  let text = frame.clause.text.trim();
  if (frame.marker !== undefined) text = text.replace(/^(?:(?:and|or)\s+)?\S+\s*/i, '');
  return text.replace(/[\s,;:.?!]+$/, '');
}

function missing(frame: Frame, role: 'event' | 'object' | 'result'): Finding {
  return {
    id: `frame-missing-${role}:${frame.id}`,
    kind: 'gap',
    code: `frame-missing-${role}`,
    severity: 'warning',
    message: `${frame.id} has no ${role}`,
    refs: [frame.id, frame.sentence],
  };
}

function declare(vars: VarDecl[], seen: Set<string>, name: string, type: VarDecl['type']): void {
  if (seen.has(name)) return;
  seen.add(name);
  vars.push({ id: name as VarId, type });
}

function eq(name: string, value: Value): Predicate {
  return { op: 'eq', var: name as VarId, value };
}

function valueKey(name: string, value: Value): string {
  return `${name}=${value.t}:${shown(value)}`;
}

function shown(value: Value): string {
  if (value.t === 'null') return 'null';
  return String(value.v);
}

function camelId(name: string): string {
  const parts = name.split('-');
  let id = parts[0] ?? 'spec';
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined || part === '') continue;
    id += part.charAt(0).toUpperCase() + part.slice(1);
  }
  return id;
}
