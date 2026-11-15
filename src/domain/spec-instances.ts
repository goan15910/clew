// Guards and effects of an action that touches an object with several instances.
// A compiled spec keeps one variable per object, which is the one-instance reading. When a guard
// counts an object (`every`, `some`, `none`), the object's variable is a function over its
// instances, and this module writes the guard and the effect in that form, in both styles.
import type { GuardRead, InstanceSet } from './spec-actions.js';
import { valueText, type ExprStyle } from './spec-expr.js';
import type { Patch, Value } from './valuation.js';

/** The instance an action is about, when its object has several. */
export const SELF = 'self';

/** How many instances of a counted object the exported module has, per owner instance. */
export const INSTANCES_PER_OWNER = 2;

/** What a module calls an instance set, and the function from its instances to their owners. */
export interface InstanceNames {
  set(objectVar: string): string;
  owner(objectVar: string): string;
}

interface Symbols {
  all: string;
  any: string;
  member: string;
  outside: string;
  implies: string;
  and: string;
  neq: string;
  not: string;
}

const SYMBOLS: Record<ExprStyle, Symbols> = {
  math: { all: '∀', any: '∃', member: '∈', outside: '∉', implies: '⇒', and: '∧', neq: '≠', not: '¬' },
  tla: { all: '\\A', any: '\\E', member: '\\in', outside: '\\notin', implies: '=>', and: '/\\', neq: '#', not: '~' },
};

/** `order` → `Order`, `SIGN_UP` → `SignUp`, `order_status` → `OrderStatus`. */
export function pascalName(raw: string): string {
  let name = '';
  for (const part of raw.split(/[^A-Za-z0-9]+/)) {
    if (part === '') continue;
    name += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  if (name === '') return 'Model';
  return /^[A-Za-z]/.test(name) ? name : `M${name}`;
}

/** Names for a reader that defines nothing else: `Parcel`, `ParcelOwner`. */
export function plainInstanceNames(sets: readonly InstanceSet[]): InstanceNames {
  const name = (objectVar: string): string => pascalName(sets.find((set) => set.objectVar === objectVar)?.object ?? objectVar);
  return { set: name, owner: (objectVar) => `${name(objectVar)}Owner` };
}

/** `objectVar`, its owner, its owner's owner, and so on. Empty when the object has one instance. */
export function ownerChain(sets: readonly InstanceSet[], objectVar: string): string[] {
  const chain: string[] = [];
  let current: string | undefined = objectVar;
  while (current !== undefined && !chain.includes(current)) {
    const name: string = current;
    const set = sets.find((item) => item.objectVar === name);
    if (set === undefined) break;
    chain.push(name);
    current = set.owner;
  }
  return chain;
}

/** True when the item's object, or an object its guard reads, has several instances. */
export function touchesInstances(reads: readonly GuardRead[] | undefined, sets: readonly InstanceSet[]): boolean {
  if (reads === undefined || sets.length === 0) return false;
  return reads.some((read) => read.kind !== 'condition' && sets.some((set) => set.objectVar === read.var));
}

/** The variable of the item's own object, when that object has several instances. */
export function ownInstanceSet(reads: readonly GuardRead[] | undefined, sets: readonly InstanceSet[]): string | undefined {
  const own = reads?.find((read) => read.kind === 'own')?.var;
  return own !== undefined && sets.some((set) => set.objectVar === own) ? own : undefined;
}

/** One expression per guard conjunct. */
export function instanceGuardTexts(reads: readonly GuardRead[], sets: readonly InstanceSet[], names: InstanceNames, style: ExprStyle): string[] {
  const symbols = SYMBOLS[style];
  const own = reads.find((read) => read.kind === 'own')?.var;
  const chain = own === undefined ? [] : ownerChain(sets, own);
  const parts: string[] = [];
  for (const read of reads) {
    if (read.kind === 'condition') {
      const value = read.values[0];
      parts.push(value !== undefined && value.t === 'bool' && !value.v ? `${symbols.not}${read.var}` : read.var);
      continue;
    }
    const counted = sets.some((set) => set.objectVar === read.var);
    if (read.kind === 'own') {
      parts.push(test(counted ? `${read.var}[${SELF}]` : read.var, read.values, false, style));
      continue;
    }
    if (!counted) {
      parts.push(test(read.var, read.values, read.quant === 'none', style));
      continue;
    }
    if (read.quant === undefined && chain.includes(read.var)) {
      parts.push(test(`${read.var}[${upTo(chain, read.var, SELF, names)}]`, read.values, false, style));
      continue;
    }
    const quant = read.quant ?? 'some';
    const other = ownerChain(sets, read.var);
    const bound = boundName(sets, read.var);
    const shared = chain.find((item) => other.includes(item));
    const scope = shared === undefined ? undefined : `${upTo(other, shared, bound, names)} = ${upTo(chain, shared, SELF, names)}`;
    const term = `${read.var}[${bound}]`;
    const body = test(term, read.values, quant === 'none', style);
    const head = `${quant === 'some' ? symbols.any : symbols.all} ${bound} ${symbols.member} ${names.set(read.var)} :`;
    // `every` is about the instances that exist: one that is in no state yet does not hold the action back.
    const exists = quant === 'every' ? `${term} ${symbols.neq} ${valueText({ t: 'null' }, style)}` : undefined;
    const given = [scope, exists].filter((part) => part !== undefined).join(` ${symbols.and} `);
    if (given === '') parts.push(`${head} ${body}`);
    else parts.push(`${head} ${given} ${quant === 'some' ? symbols.and : symbols.implies} ${body}`);
  }
  return parts;
}

/** The primed half of an action: `parcel_status' = [parcel_status EXCEPT ![self] = "packed"]`. */
export function instanceEffectTexts(assign: Patch, own: string | undefined, style: ExprStyle): string[] {
  const parts: string[] = [];
  for (const key of Object.keys(assign)) {
    const value = assign[key];
    if (value === undefined) continue;
    if (key !== own) parts.push(`${key}' = ${valueText(value, style)}`);
    else if (style === 'tla') parts.push(`${key}' = [${key} EXCEPT ![${SELF}] = ${valueText(value, style)}]`);
    else parts.push(`${key}[${SELF}]' = ${valueText(value, style)}`);
  }
  return parts;
}

/** The instance ids of every set, owners before the sets they own, and each instance's owner. */
export function instanceUniverse(sets: readonly InstanceSet[]): { objectVar: string; ids: string[]; owners?: string[] }[] {
  const ordered = sets.slice().sort((left, right) => ownerChain(sets, left.objectVar).length - ownerChain(sets, right.objectVar).length);
  const universe: { objectVar: string; ids: string[]; owners?: string[] }[] = [];
  for (const set of ordered) {
    const base = set.objectVar.replace(/_status$/, '');
    const ownerIds = set.owner === undefined ? undefined : universe.find((entry) => entry.objectVar === set.owner)?.ids;
    const ids: string[] = [];
    const owners: string[] = [];
    const groups = ownerIds === undefined ? 1 : ownerIds.length;
    for (let group = 0; group < groups; group += 1) {
      for (let index = 0; index < INSTANCES_PER_OWNER; index += 1) {
        ids.push(`${base}${group * INSTANCES_PER_OWNER + index + 1}`);
        const owner = ownerIds?.[group];
        if (owner !== undefined) owners.push(owner);
      }
    }
    universe.push(ownerIds === undefined ? { objectVar: set.objectVar, ids } : { objectVar: set.objectVar, ids, owners });
  }
  return universe;
}

/** The bound variable a quantifier over `objectVar` uses: the first letter of the object's name. */
export function boundName(sets: readonly InstanceSet[], objectVar: string): string {
  const object = sets.find((set) => set.objectVar === objectVar)?.object ?? objectVar;
  const letter = object.charAt(0).toLowerCase();
  return /^[a-z]$/.test(letter) ? letter : 'x';
}

/** `start` climbed from the first set of `chain` to `target`: `CrateOwner[ParcelOwner[self]]`. */
function upTo(chain: readonly string[], target: string, start: string, names: InstanceNames): string {
  let text = start;
  for (const step of chain) {
    if (step === target) break;
    text = `${names.owner(step)}[${text}]`;
  }
  return text;
}

function test(term: string, values: readonly Value[], negated: boolean, style: ExprStyle): string {
  const symbols = SYMBOLS[style];
  const only = values[0];
  if (values.length === 1 && only !== undefined) return `${term} ${negated ? symbols.neq : '='} ${valueText(only, style)}`;
  return `${term} ${negated ? symbols.outside : symbols.member} {${values.map((value) => valueText(value, style)).join(', ')}}`;
}
