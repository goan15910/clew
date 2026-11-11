// Predicates and patches as one-line expressions. `math` is what a person reads in the viewer and
// the CLI; `tla` is the same expression in TLA+ ASCII, so a frame's guard reads the same in both.
import type { Patch, Predicate, Value } from './valuation.js';

export type ExprStyle = 'math' | 'tla';

interface Symbols {
  and: string;
  or: string;
  not: string;
  neq: string;
  truth: string;
  nil: string;
  yes: string;
  no: string;
}

const SYMBOLS: Record<ExprStyle, Symbols> = {
  math: { and: '∧', or: '∨', not: '¬', neq: '≠', truth: 'true', nil: 'null', yes: 'true', no: 'false' },
  tla: { and: '/\\', or: '\\/', not: '~', neq: '#', truth: 'TRUE', nil: 'Null', yes: 'TRUE', no: 'FALSE' },
};

export function valueText(value: Value, style: ExprStyle): string {
  const symbols = SYMBOLS[style];
  if (value.t === 'null') return symbols.nil;
  if (value.t === 'bool') return value.v ? symbols.yes : symbols.no;
  if (value.t === 'num') return String(value.v);
  return JSON.stringify(value.v);
}

/** `order_status = "submitted" ∧ ¬cond_s1_t12`. A boolean test reads as the bare variable. */
export function predicateText(predicate: Predicate, style: ExprStyle): string {
  return render(predicate, SYMBOLS[style], style, 'top');
}

/** Top-level conjuncts, one expression each. A predicate that is not a conjunction is one conjunct. */
export function conjunctTexts(predicate: Predicate, style: ExprStyle): string[] {
  if (predicate.op === 'true') return [];
  if (predicate.op !== 'and') return [render(predicate, SYMBOLS[style], style, 'and')];
  const parts: string[] = [];
  for (const child of predicate.of) {
    if (child.op === 'true') continue;
    if (child.op === 'and') {
      for (const part of conjunctTexts(child, style)) parts.push(part);
    } else {
      parts.push(render(child, SYMBOLS[style], style, 'and'));
    }
  }
  return parts;
}

/** The primed half of an action: `order_status' = "approved"`, one text per assigned variable. */
export function effectTexts(patch: Patch, style: ExprStyle): string[] {
  const parts: string[] = [];
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value !== undefined) parts.push(`${key}' = ${valueText(value, style)}`);
  }
  return parts;
}

export function effectText(patch: Patch, style: ExprStyle): string {
  return effectTexts(patch, style).join(` ${SYMBOLS[style].and} `);
}

/** The variables a predicate reads, in first-seen order. */
export function predicateVars(predicate: Predicate): string[] {
  const found: string[] = [];
  collectVars(predicate, found);
  return found;
}

/** `predicate` without its top-level equality tests on `name`. `{ op: 'true' }` when nothing is left. */
export function withoutVar(predicate: Predicate, name: string): Predicate {
  if (predicate.op === 'eq' && predicate.var === name) return { op: 'true' };
  if (predicate.op !== 'and') return predicate;
  const kept: Predicate[] = [];
  for (const child of predicate.of) {
    if (child.op === 'true' || (child.op === 'eq' && child.var === name)) continue;
    kept.push(child);
  }
  const only = kept[0];
  if (only === undefined) return { op: 'true' };
  return kept.length === 1 ? only : { op: 'and', of: kept };
}

function render(predicate: Predicate, symbols: Symbols, style: ExprStyle, parent: 'top' | 'and' | 'or' | 'not'): string {
  if (predicate.op === 'true') return symbols.truth;
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    if (predicate.value.t === 'bool') {
      const positive = (predicate.op === 'eq') === predicate.value.v;
      return positive ? predicate.var : `${symbols.not}${predicate.var}`;
    }
    const text = `${predicate.var} ${predicate.op === 'eq' ? '=' : symbols.neq} ${valueText(predicate.value, style)}`;
    return parent === 'not' ? `(${text})` : text;
  }
  if (predicate.op === 'not') return `${symbols.not}${render(predicate.of, symbols, style, 'not')}`;
  const only = predicate.of[0];
  if (only === undefined) return predicate.op === 'and' ? symbols.truth : symbols.no;
  if (predicate.of.length === 1) return render(only, symbols, style, parent);
  const parts: string[] = [];
  for (const child of predicate.of) parts.push(render(child, symbols, style, predicate.op));
  const text = parts.join(` ${predicate.op === 'and' ? symbols.and : symbols.or} `);
  return parent === 'top' || parent === predicate.op ? text : `(${text})`;
}

function collectVars(predicate: Predicate, found: string[]): void {
  if (predicate.op === 'true') return;
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    if (!found.includes(predicate.var)) found.push(predicate.var);
    return;
  }
  if (predicate.op === 'not') {
    collectVars(predicate.of, found);
    return;
  }
  for (const child of predicate.of) collectVars(child, found);
}
