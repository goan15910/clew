// Clause reachability over the compiled spec: one breadth-first search from the initial valuation.
// A clause is reachable once its guard holds in a reached state. It is unreachable only when the
// search finished without that; a truncated search leaves it unexplored.
import { compiledSpec, type CompiledAction, type CompiledSpec } from './spec-actions.js';
import { nextStates } from './spec-model.js';
import type { Finding, Frame } from './spec.js';
import { DEFAULT_REACH_BOUND, holds, type EventName, type Predicate, type Valuation, type ValuationId, type Value, type VarId } from './valuation.js';

export type ClauseStatus = 'reachable' | 'unreachable' | 'unexplored';

export interface ClauseReach {
  frame: string;
  event: string;
  status: ClauseStatus;
  /** Events from the initial state to the first state that enables the clause, then its own event. */
  witness?: string[];
  /** Guard equalities that hold in no reached state. Set only when unreachable. */
  blockedBy?: string[];
}

export function clauseReach(compiled: CompiledSpec, bound = DEFAULT_REACH_BOUND): ClauseReach[] {
  const actions: CompiledAction[] = [];
  for (const item of compiled.items) {
    if (item.kind === 'action') actions.push(item);
  }
  if (actions.length === 0) return [];
  const spec = compiledSpec(compiled);
  if (spec === undefined) return actions.map((action) => ({ frame: action.id, event: action.event, status: 'unexplored' }));
  const parent = new Map<ValuationId, { from: ValuationId; event: EventName }>();
  const seen = new Set<ValuationId>([spec.initial.id]);
  const reached: Valuation[] = [spec.initial];
  const witnesses = new Map<string, string[]>();
  const visit = (state: Valuation): void => {
    let path: string[] | undefined;
    for (const action of actions) {
      if (witnesses.has(action.id) || !holds(action.when, state)) continue;
      path ??= pathTo(parent, state.id);
      witnesses.set(action.id, [...path, action.event]);
    }
  };
  visit(spec.initial);
  let truncated = false;
  for (let head = 0; head < reached.length && witnesses.size < actions.length; head += 1) {
    const state = reached[head];
    if (state === undefined) break;
    for (const step of nextStates(spec, state)) {
      if (seen.has(step.to.id)) continue;
      if (reached.length >= bound) {
        truncated = true;
        continue;
      }
      seen.add(step.to.id);
      parent.set(step.to.id, { from: state.id, event: step.event });
      reached.push(step.to);
      visit(step.to);
    }
  }
  const held = new Set<string>();
  if (!truncated) {
    for (const state of reached) {
      for (const [id, value] of state.entries()) held.add(conjunctText(id, value));
    }
  }
  const entries: ClauseReach[] = [];
  for (const action of actions) {
    const witness = witnesses.get(action.id);
    if (witness !== undefined) {
      entries.push({ frame: action.id, event: action.event, status: 'reachable', witness });
      continue;
    }
    if (truncated) {
      entries.push({ frame: action.id, event: action.event, status: 'unexplored' });
      continue;
    }
    const blockedBy: string[] = [];
    for (const check of equalities(action.when)) {
      const text = conjunctText(check.var, check.value);
      if (!held.has(text) && !blockedBy.includes(text)) blockedBy.push(text);
    }
    entries.push({ frame: action.id, event: action.event, status: 'unreachable', blockedBy });
  }
  return entries;
}

export function clauseFindings(reach: readonly ClauseReach[], frames: readonly Frame[]): Finding[] {
  const sentences = new Map<string, string>();
  for (const frame of frames) sentences.set(frame.id, frame.sentence);
  const findings: Finding[] = [];
  for (const entry of reach) {
    if (entry.status === 'reachable') continue;
    const refs = [entry.frame];
    const sentence = sentences.get(entry.frame);
    if (sentence !== undefined) refs.push(sentence);
    if (entry.status === 'unreachable') {
      const blocked = entry.blockedBy ?? [];
      findings.push({
        id: `clause-unreachable:${entry.frame}`,
        kind: 'gap',
        code: 'clause-unreachable',
        severity: 'warning',
        message: `${entry.frame} (${entry.event}) is never enabled from the initial state: ${blocked.length === 0 ? 'its guard' : blocked.join(', ')} never holds`,
        refs,
      });
      continue;
    }
    findings.push({
      id: `clause-unexplored:${entry.frame}`,
      kind: 'gap',
      code: 'clause-unexplored',
      severity: 'info',
      message: `${entry.frame} (${entry.event}) was not enabled before the search reached its state bound`,
      refs,
    });
  }
  return findings;
}

function pathTo(parent: ReadonlyMap<ValuationId, { from: ValuationId; event: EventName }>, id: ValuationId): string[] {
  const events: string[] = [];
  let link = parent.get(id);
  while (link !== undefined) {
    events.push(link.event);
    link = parent.get(link.from);
  }
  return events.reverse();
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

function conjunctText(name: string, value: Value): string {
  if (value.t === 'null') return `${name} = null`;
  if (value.t === 'atom') return `${name} = ${JSON.stringify(value.v)}`;
  return `${name} = ${String(value.v)}`;
}
