// The compiled spec the graph, emit, and status read. A producer compiles its own records
// (frames, through spec-compile) into this shape, so the graph layer never sees how the spec was extracted.
import { assembleSpec, type Spec, type SpecDraft } from './spec-model.js';
import type { Quantifier } from './spec.js';
import type { Patch, Predicate, Value } from './valuation.js';

/** Overlay location for the default atom initial (`{ t: 'null' }`). */
export const DEFAULT_INITIAL_ATOM = 'null';

export interface CompiledSpec {
  /** Signature (`id`, `vars`, `initial`) and kernel actions. `labels` is empty. */
  draft: SpecDraft;
  /** Live items in id order. */
  items: CompiledItem[];
  /** Objects that have several instances, because some guard counts them. Absent or empty for most specs. */
  instances?: InstanceSet[];
}

/**
 * An object some guard reads with `every`, `some`, or `none`. `draft` keeps one variable for it,
 * which is the one-instance reading; an exporter that can state instances reads this instead.
 */
export interface InstanceSet {
  object: string;
  objectVar: string;
  /** The instance set each instance belongs to, when its owner has instances too. */
  owner?: string;
}

/** One conjunct of a guard, as the frames state it. `when` is the same guard for one instance of everything. */
export interface GuardRead {
  /** `own`: the action's object. `object`: another object. `condition`: a boolean condition var. */
  kind: 'own' | 'object' | 'condition';
  var: string;
  /** The values that satisfy the read. A condition has one boolean. */
  values: Value[];
  quant?: Quantifier;
}

export type CompiledItem = CompiledAction | CompiledMark | CompiledForbidden;

interface CompiledBase {
  id: string;
  /** Sentence, token, or span ids the item was compiled from. */
  sources: string[];
}

/** Where an action sits on one object's lifecycle. Absent when no object var takes an atom. */
export interface ActionOverlay {
  object: string;
  objectVar: string;
  /** Undefined when the guard says nothing about the object's current value. */
  from?: string;
  to: string;
  actor?: string;
  guard?: string;
  guardText?: string;
}

export interface CompiledAction extends CompiledBase {
  kind: 'action';
  event: string;
  when: Predicate;
  /** `when`, one conjunct at a time, before it was narrowed to one instance. */
  reads?: GuardRead[];
  assign: Patch;
  overlay?: ActionOverlay;
  /** Span ids that name the event and the object, for workflow edge text. */
  evidence: { event: string[]; object: string[] };
}

export interface CompiledMark extends CompiledBase {
  kind: 'init' | 'terminal';
  assign?: Patch;
  object?: string;
  /** The first object atom the mark sets. The graph checks it against workflow vocabulary. */
  state?: { object: string; value: string };
}

export interface CompiledForbidden extends CompiledBase {
  kind: 'forbidden';
  object?: string;
  event?: string;
  /** The first atom the forbidden step would assign. */
  attempted?: string;
  actor?: string;
  when?: Predicate;
  reads?: GuardRead[];
  assign?: Patch;
}

export function compiledSpec(compiled: CompiledSpec): Spec | undefined {
  if (compiled.draft.vars.length === 0) return undefined;
  try {
    return assembleSpec(compiled.draft);
  } catch {
    return undefined;
  }
}

export function findItem(items: readonly CompiledItem[], id: string): CompiledItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
  }
  return undefined;
}

export function emptyCompiled(): CompiledSpec {
  return { draft: { id: 'spec', vars: [], initial: {}, actions: [], labels: [] }, items: [] };
}
