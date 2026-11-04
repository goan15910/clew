// Valuation kernel: a state is a total assignment of values to variables.
// A patch names primed variables. apply copies the rest (UNCHANGED).
// Identity is valuationId, not a label or location name.

export type VarId = string & { readonly __brand: 'VarId' };
export type ValuationId = string & { readonly __brand: 'ValuationId' };
export type EventName = string & { readonly __brand: 'EventName' };

export type ValueType = 'boolean' | 'number' | 'atom' | 'timestamp';

export type Value =
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'atom'; readonly v: string }
  | { readonly t: 'null' };

export interface VarDecl {
  readonly id: VarId;
  readonly type: ValueType;
}

export interface Valuation {
  readonly id: ValuationId;
  get(id: VarId): Value;
  entries(): readonly [VarId, Value][];
}

/** Primed vars only. Keys not present stay as they were. */
export type Patch = Readonly<Record<string, Value>>;

export type Predicate =
  | { readonly op: 'true' }
  | { readonly op: 'eq'; readonly var: VarId; readonly value: Value }
  | { readonly op: 'neq'; readonly var: VarId; readonly value: Value }
  | { readonly op: 'and'; readonly of: readonly Predicate[] }
  | { readonly op: 'or'; readonly of: readonly Predicate[] }
  | { readonly op: 'not'; readonly of: Predicate };

export interface ReachEdge {
  readonly from: ValuationId;
  readonly event: EventName;
  readonly to: ValuationId;
}

export interface ReachGraph {
  readonly nodes: readonly Valuation[];
  readonly edges: readonly ReachEdge[];
  readonly truncated: boolean;
}

const VAR_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function varId(raw: string): VarId {
  if (!VAR_ID_PATTERN.test(raw)) {
    throw new Error(`variable id "${raw}" must be lower_snake_case`);
  }
  return raw as VarId;
}

export function eventName(raw: string): EventName {
  if (!EVENT_PATTERN.test(raw)) {
    throw new Error(`event "${raw}" must be UPPER_SNAKE_CASE`);
  }
  return raw as EventName;
}

export function valueOf(type: ValueType, raw: unknown): Value {
  if (raw === null) return { t: 'null' };
  if (type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`expected boolean, got ${describe(raw)}`);
    return { t: 'bool', v: raw };
  }
  if (type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`expected finite number, got ${describe(raw)}`);
    }
    return { t: 'num', v: raw };
  }
  if (type === 'atom') {
    if (typeof raw !== 'string') throw new Error(`expected atom string, got ${describe(raw)}`);
    return { t: 'atom', v: raw };
  }
  // timestamp: null or a marker atom at the boundary
  if (typeof raw === 'string') return { t: 'atom', v: raw };
  throw new Error(`expected timestamp null or string, got ${describe(raw)}`);
}

export function valuationId(entries: readonly [VarId, Value][]): ValuationId {
  const sorted = entries.slice().sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const parts: string[] = [];
  for (const [id, value] of sorted) {
    parts.push(`${id}=${renderValue(value)}`);
  }
  return parts.join('|') as ValuationId;
}

export function makeValuation(vars: readonly VarDecl[], entries: ReadonlyMap<VarId, Value>): Valuation {
  const pairs: [VarId, Value][] = [];
  for (const decl of vars) {
    const value = entries.get(decl.id);
    if (value === undefined) {
      throw new Error(`valuation missing variable "${decl.id}"`);
    }
    assertType(decl.type, value, decl.id);
    pairs.push([decl.id, value]);
  }
  for (const key of entries.keys()) {
    if (!vars.some((decl) => decl.id === key)) {
      throw new Error(`valuation has unknown variable "${key}"`);
    }
  }
  const id = valuationId(pairs);
  const map = new Map<VarId, Value>(pairs);
  return {
    id,
    get(varName: VarId): Value {
      const value = map.get(varName);
      if (value === undefined) throw new Error(`unknown variable "${varName}"`);
      return value;
    },
    entries(): readonly [VarId, Value][] {
      return pairs;
    },
  };
}

export function apply(state: Valuation, patch: Patch): Valuation {
  const next = new Map<VarId, Value>(state.entries());
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    const id = key as VarId;
    if (!next.has(id)) {
      throw new Error(`patch names unknown variable "${key}"`);
    }
    next.set(id, value);
  }
  const pairs = [...next.entries()] as [VarId, Value][];
  const id = valuationId(pairs);
  return {
    id,
    get(varName: VarId): Value {
      const value = next.get(varName);
      if (value === undefined) throw new Error(`unknown variable "${varName}"`);
      return value;
    },
    entries(): readonly [VarId, Value][] {
      return pairs.slice().sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    },
  };
}

export function holds(predicate: Predicate, state: Valuation): boolean {
  if (predicate.op === 'true') return true;
  if (predicate.op === 'eq') return sameValue(state.get(predicate.var), predicate.value);
  if (predicate.op === 'neq') return !sameValue(state.get(predicate.var), predicate.value);
  if (predicate.op === 'and') {
    for (const child of predicate.of) {
      if (!holds(child, state)) return false;
    }
    return true;
  }
  if (predicate.op === 'or') {
    for (const child of predicate.of) {
      if (holds(child, state)) return true;
    }
    return false;
  }
  return !holds(predicate.of, state);
}

export function sameValuation(left: Valuation, right: Valuation): boolean {
  return left.id === right.id;
}

export function sameValue(left: Value, right: Value): boolean {
  if (left.t !== right.t) return false;
  if (left.t === 'null') return true;
  if (left.t === 'bool' && right.t === 'bool') return left.v === right.v;
  if (left.t === 'num' && right.t === 'num') return left.v === right.v;
  if (left.t === 'atom' && right.t === 'atom') return left.v === right.v;
  return false;
}

/**
 * Breadth-first reachability from Init under a Next relation.
 * `next` returns enabled (event, successor) pairs. Truncates at `bound` nodes.
 */
export function explore(
  initials: readonly Valuation[],
  next: (state: Valuation) => readonly { event: EventName; to: Valuation }[],
  bound: number,
): ReachGraph {
  const nodes: Valuation[] = [];
  const edges: ReachEdge[] = [];
  const index = new Map<ValuationId, Valuation>();
  const queue: Valuation[] = [];
  let truncated = false;

  for (const initial of initials) {
    if (index.has(initial.id)) continue;
    if (nodes.length >= bound) {
      truncated = true;
      break;
    }
    index.set(initial.id, initial);
    nodes.push(initial);
    queue.push(initial);
  }

  while (queue.length > 0) {
    const state = queue.shift();
    if (state === undefined) break;
    for (const step of next(state)) {
      edges.push({ from: state.id, event: step.event, to: step.to.id });
      if (index.has(step.to.id)) continue;
      if (nodes.length >= bound) {
        truncated = true;
        continue;
      }
      index.set(step.to.id, step.to);
      nodes.push(step.to);
      queue.push(step.to);
    }
  }

  return { nodes, edges, truncated };
}

/**
 * Shortest event path from any initial to a valuation that satisfies `goal`.
 * Returns undefined when none is reachable within `bound`.
 */
export function witness(
  initials: readonly Valuation[],
  next: (state: Valuation) => readonly { event: EventName; to: Valuation }[],
  goal: (state: Valuation) => boolean,
  bound: number,
): { valuation: Valuation; events: readonly EventName[] } | undefined {
  const parent = new Map<ValuationId, { from: ValuationId; event: EventName }>();
  const seen = new Map<ValuationId, Valuation>();
  const queue: Valuation[] = [];

  for (const initial of initials) {
    if (seen.has(initial.id)) continue;
    seen.set(initial.id, initial);
    queue.push(initial);
    if (goal(initial)) return { valuation: initial, events: [] };
  }

  while (queue.length > 0 && seen.size <= bound) {
    const state = queue.shift();
    if (state === undefined) break;
    for (const step of next(state)) {
      if (seen.has(step.to.id)) continue;
      seen.set(step.to.id, step.to);
      parent.set(step.to.id, { from: state.id, event: step.event });
      if (goal(step.to)) {
        const events: EventName[] = [];
        let cursor: ValuationId | undefined = step.to.id;
        while (cursor !== undefined) {
          const link = parent.get(cursor);
          if (link === undefined) break;
          events.push(link.event);
          cursor = link.from;
          if (initials.some((item) => item.id === cursor)) break;
        }
        events.reverse();
        return { valuation: step.to, events };
      }
      if (seen.size > bound) break;
      queue.push(step.to);
    }
  }
  return undefined;
}

function assertType(type: ValueType, value: Value, id: VarId): void {
  if (type === 'boolean' && value.t !== 'bool' && value.t !== 'null') {
    throw new Error(`variable "${id}" expects boolean, got ${value.t}`);
  }
  if (type === 'number' && value.t !== 'num' && value.t !== 'null') {
    throw new Error(`variable "${id}" expects number, got ${value.t}`);
  }
  if (type === 'atom' && value.t !== 'atom' && value.t !== 'null') {
    throw new Error(`variable "${id}" expects atom, got ${value.t}`);
  }
  if (type === 'timestamp' && value.t !== 'atom' && value.t !== 'null') {
    throw new Error(`variable "${id}" expects timestamp, got ${value.t}`);
  }
}

function renderValue(value: Value): string {
  if (value.t === 'null') return 'null';
  if (value.t === 'bool') return value.v ? 'true' : 'false';
  if (value.t === 'num') return String(value.v);
  return JSON.stringify(value.v);
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  return typeof raw;
}
