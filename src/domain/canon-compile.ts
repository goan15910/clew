// Accepted canonical sentences → one behaviour model: variables, actions, refusals, invariants, and marks.
// Every branch of a block is one atomic action. Every guard and effect keeps the sentence and the words it
// came from. A part that has no compiled meaning yet is never dropped quietly: it raises a finding with its span.
//
// Variables:
//   <noun>_status   the state of a noun that some sentence gives a state, a function when the noun has instances
//   <noun>_<target> a link set by "with" / "to", Null until set
//   on_<noun>, after_<noun>   an event condition: a boolean the environment sets
// A noun no action changes and no mark starts is an abstract condition: the environment picks its state.
import {
  condPreds,
  nounOf,
  slotKey,
  slug,
  verbOf,
  type Block,
  type Branch,
  type CanonLexicon,
  type Clause,
  type Cond,
  type Invariant,
  type Mark,
  type Pred,
  type Ref,
  type Slot,
  type Span,
  type Statement,
} from './canon-ast.js';
import type { FindingSeverity } from './spec.js';

export interface AcceptedSentence {
  id: string;
  text: string;
  statement: Statement;
}

export interface CanonFinding {
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  sentence?: string;
  span?: Span;
  words?: string;
}

/** One compiled guard or effect, and the words it came from. */
export interface Traced {
  tla: string;
  from: string;
  sentence: string;
  span: Span;
  words: string;
}

export interface NounModel {
  noun: string;
  /** The status variable. Absent when no sentence gives the noun a state. */
  statusVar?: string;
  /** The name of the set of its states, when it has a status variable. */
  statesSet?: string;
  /** The instance set. Absent for a noun with one instance. */
  instanceSet?: string;
  instances: string[];
  states: string[];
  initial: string[];
  finals: string[];
  /** No action changes it and no mark starts it: the environment picks its state. */
  abstract: boolean;
  /** An abstract condition the lexicon fixes: picked at Init and never changed. */
  fixed: boolean;
  sentences: string[];
}

export interface LinkModel {
  var: string;
  object: string;
  target: string;
}

export interface ConditionModel {
  var: string;
  kind: 'on' | 'after';
  noun: string;
  sentences: string[];
}

export interface Param {
  name: string;
  set: string;
  noun: string;
}

export interface ActionModel {
  name: string;
  sentence: string;
  branch: number;
  text: string;
  actor: string;
  event: string;
  object: string;
  params: Param[];
  guards: Traced[];
  effects: Traced[];
  /** Updated variable → its primed expression. */
  updates: Record<string, string>;
  notes: Traced[];
  /** The states the step puts a noun in, one per result clause ("as STATE"). */
  results: { noun: string; state: string }[];
}

export interface RefusalModel {
  name: string;
  sentence: string;
  text: string;
  event: string;
  object: string;
  /** The actions the refusal constrains, each with the guard under which it must not happen. */
  over: { action: string; params: Param[]; when: string }[];
  guards: Traced[];
}

export interface InvariantModel {
  name: string;
  sentence: string;
  text: string;
  tla: string;
}

export interface CanonModel {
  nouns: NounModel[];
  links: LinkModel[];
  conditions: ConditionModel[];
  ownership: { name: string; object: string; owner: string; map: Record<string, string> }[];
  actions: ActionModel[];
  refusals: RefusalModel[];
  invariants: InvariantModel[];
  /** True when some noun has a final state, so a stuck state can be told from a finished one. */
  hasFinals: boolean;
  findings: CanonFinding[];
}

export const NULL = 'Null';
const DEFAULT_INSTANCES = 2;

const RESERVED = new Set([
  'ASSUME', 'ASSUMPTION', 'AXIOM', 'BOOLEAN', 'CASE', 'CHOOSE', 'CONSTANT', 'CONSTANTS', 'DOMAIN', 'ELSE', 'ENABLED', 'EXCEPT',
  'EXTENDS', 'FALSE', 'IF', 'IN', 'INSTANCE', 'LET', 'LOCAL', 'MODULE', 'OTHER', 'STRING', 'SUBSET', 'THEN', 'THEOREM', 'TRUE',
  'UNCHANGED', 'UNION', 'VARIABLE', 'VARIABLES', 'WITH', 'Init', 'Next', 'Spec', 'vars', 'TypeOK', 'Null', 'Done', 'NoStuck',
  'Stuck', 'Actions', 'Environment', 'Cardinality', 'IsFiniteSet', 'Nat', 'Int', 'Seq', 'Blocks', 'Frames',
]);

export function ident(text: string): string {
  const base = text.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (base === '') return 'x';
  return /^[A-Za-z]/.test(base) ? base : `n_${base}`;
}

export function pascal(text: string): string {
  let out = '';
  for (const part of text.split(/[^A-Za-z0-9]+/)) {
    if (part === '') continue;
    out += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  if (out === '') return 'X';
  return /^[A-Za-z]/.test(out) ? out : `N${out}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function setText(values: readonly string[]): string {
  return `{${values.map(quote).join(', ')}}`;
}

interface NounInfo {
  noun: string;
  text: string;
  states: Set<string>;
  assigned: boolean;
  starts: Set<string>;
  ends: Set<string>;
  instanced: boolean;
  /** Read with each, some, one, or no: how many instances there are matters. */
  counted: boolean;
  stateful: boolean;
  sentences: Set<string>;
}

/** What a condition is compiled about: the sentence, and the instances the step has already bound. */
export interface CondContext {
  sentence: AcceptedSentence;
  bindings: Map<string, string>;
  params: Param[];
  primary: string;
  findings: CanonFinding[];
}
type Ctx = CondContext;

export function compileCanon(sentences: readonly AcceptedSentence[], lexicon: CanonLexicon): CanonModel {
  const findings: CanonFinding[] = [];
  let findingNumber = 0;
  const say = (sentence: AcceptedSentence, span: Span): string => sentence.text.slice(span[0], span[1]);
  const find = (sentence: AcceptedSentence | undefined, code: string, severity: FindingSeverity, message: string, span?: Span): void => {
    findingNumber += 1;
    const finding: CanonFinding = { id: `cf${findingNumber}`, code, severity, message };
    if (sentence !== undefined) finding.sentence = sentence.id;
    if (sentence !== undefined && span !== undefined) {
      finding.span = span;
      finding.words = say(sentence, span);
    }
    findings.push(finding);
  };
  const noun = (ref: Ref): string => nounOf(ref, lexicon);

  // ---- 1. What each noun is: its states, whether it has instances, whether any action changes it. ----
  const nouns = new Map<string, NounInfo>();
  const info = (id: string, text: string, sentence: string): NounInfo => {
    let found = nouns.get(id);
    if (found === undefined) {
      found = { noun: id, text, states: new Set(), assigned: false, starts: new Set(), ends: new Set(), instanced: false, counted: false, stateful: false, sentences: new Set() };
      nouns.set(id, found);
    }
    found.sentences.add(sentence);
    return found;
  };
  const quantified = (ref: Ref): boolean => ref.qual !== null && ['each', 'some', 'one', 'no'].includes(ref.qual.text.toLowerCase());
  const linkPairs = new Map<string, LinkModel>();
  const ownerPairs = new Set<string>();
  const conditionVars = new Map<string, ConditionModel>();
  const condition = (kind: 'on' | 'after', id: string, sentence: string): string => {
    const name = `${kind}_${ident(id)}`;
    const existing = conditionVars.get(name);
    if (existing === undefined) conditionVars.set(name, { var: name, kind, noun: id, sentences: [sentence] });
    else if (!existing.sentences.includes(sentence)) existing.sentences.push(sentence);
    return name;
  };
  const notePred = (pred: Pred, sentence: string): void => {
    const item = info(noun(pred.subject), pred.subject.noun.text, sentence);
    item.stateful = true;
    if (quantified(pred.subject)) {
      item.instanced = true;
      item.counted = true;
    }
    for (const state of pred.states) item.states.add(slug(state.text));
  };
  for (const sentence of sentences) {
    const statement = sentence.statement;
    if (statement.kind === 'mark') {
      const item = info(noun(statement.subject), statement.subject.noun.text, sentence.id);
      item.stateful = true;
      for (const state of statement.states) {
        item.states.add(slug(state.text));
        (statement.mark === 'starts' ? item.starts : item.ends).add(slug(state.text));
      }
      continue;
    }
    if (statement.kind === 'invariant') {
      notePred(statement.pred, sentence.id);
      for (const pred of condPreds(statement.guard)) notePred(pred, sentence.id);
      continue;
    }
    if (statement.lead?.kind === 'when') for (const pred of condPreds(statement.lead.cond)) notePred(pred, sentence.id);
    if (statement.lead?.kind === 'after') condition('after', noun(statement.lead.ref), sentence.id);
    for (const branch of statement.branches) {
      for (const pred of condPreds(branch.guard)) notePred(pred, sentence.id);
      for (const clause of branch.clauses) {
        const object = noun(clause.object);
        const item = info(object, clause.object.noun.text, sentence.id);
        const refusal = clause.modal?.text.toLowerCase() === 'cannot';
        if (clause.object.qual !== null && ['each', 'one'].includes(clause.object.qual.text.toLowerCase())) item.instanced = true;
        if (clause.object.qual?.text.toLowerCase() === 'each') item.counted = true;
        if (clause.object.state !== null) {
          item.stateful = true;
          item.states.add(slug(clause.object.state.text));
        }
        if (clause.result !== null && !refusal) {
          item.stateful = true;
          item.assigned = true;
          item.states.add(slug(clause.result.state.text));
        }
        if (clause.object.qual?.text.toLowerCase() === 'new') {
          item.stateful = true;
          item.assigned = true;
        }
        for (const slot of clause.slots) {
          const key = slotKey(slot);
          const target = noun(slot.ref);
          if (key === 'of') {
            const owner = info(target, slot.ref.noun.text, sentence.id);
            if (slot.ref.state !== null) {
              owner.stateful = true;
              owner.states.add(slug(slot.ref.state.text));
            }
            ownerPairs.add(`${object}|${target}`);
          } else if (key === 'with') {
            const qual = slot.ref.qual?.text.toLowerCase() ?? '';
            const linked = info(target, slot.ref.noun.text, sentence.id);
            if (qual === '') linked.instanced = true;
            const name = `${ident(object)}_${ident(target)}`;
            if (!linkPairs.has(`${object}|${target}`)) linkPairs.set(`${object}|${target}`, { var: name, object, target });
          } else if (key === 'for') {
            const scoped = info(target, slot.ref.noun.text, sentence.id);
            scoped.instanced = true;
          } else if (key === 'on' || key === 'after') {
            condition(key, target, sentence.id);
          }
        }
      }
    }
  }
  for (const [id, count] of Object.entries(lexicon.instances ?? {})) {
    const item = nouns.get(slug(id));
    if (item !== undefined && count > 1) item.instanced = true;
  }
  // A link to a noun only makes sense if the noun has instances to point at.
  for (const link of linkPairs.values()) {
    const target = nouns.get(link.target);
    if (target !== undefined) target.instanced = true;
  }

  // ---- 2. Names. ----
  const used = new Set<string>(RESERVED);
  const claim = (wanted: string): string => {
    let name = wanted;
    for (let suffix = 2; used.has(name); suffix += 1) name = `${wanted}${suffix}`;
    used.add(name);
    return name;
  };
  const models = new Map<string, NounModel>();
  for (const item of nouns.values()) {
    const model: NounModel = {
      noun: item.noun,
      instances: [],
      states: [...item.states].sort(),
      initial: [...item.starts].sort(),
      finals: [...item.ends].sort(),
      abstract: item.stateful && !item.assigned && item.starts.size === 0,
      fixed: false,
      sentences: [...item.sentences].sort(sentenceOrder),
    };
    if (item.stateful) {
      model.statusVar = claim(`${ident(item.noun)}_status`);
      model.statesSet = claim(`${pascal(item.noun)}States`);
    }
    if (item.instanced) {
      model.instanceSet = claim(pascal(item.noun));
      // Two instances only where counting matters: a noun read with each, some, one, or no. One otherwise, so the
      // state space stays small; the lexicon raises it per noun.
      const fallback = item.counted ? DEFAULT_INSTANCES : 1;
      const count = Math.max(1, Math.min(8, lexicon.instances?.[item.noun] ?? lexicon.instances?.[item.text] ?? fallback));
      for (let index = 1; index <= count; index += 1) model.instances.push(`${ident(item.noun)}${index}`);
    }
    if (item.stateful && item.states.size === 0) {
      find(undefined, 'no-states', 'warning', `"${item.noun}" is created, but no sentence names a state it is in`);
      model.states = ['created'];
    }
    models.set(item.noun, model);
  }
  const links: LinkModel[] = [];
  for (const link of linkPairs.values()) {
    const named = { ...link, var: claim(link.var) };
    linkPairs.set(`${link.object}|${link.target}`, named);
    links.push(named);
  }
  for (const item of conditionVars.values()) used.add(item.var);
  const ownership: CanonModel['ownership'] = [];
  for (const pair of ownerPairs) {
    const [object, owner] = pair.split('|') as [string, string];
    if (linkPairs.has(pair)) continue;
    const objectModel = models.get(object);
    const ownerModel = models.get(owner);
    if (objectModel?.instanceSet === undefined || ownerModel?.instanceSet === undefined) continue;
    const map: Record<string, string> = {};
    objectModel.instances.forEach((instance, index) => {
      map[instance] = ownerModel.instances[index % ownerModel.instances.length] ?? '';
    });
    ownership.push({ name: claim(`${objectModel.instanceSet}Of${ownerModel.instanceSet}`), object, owner, map });
  }
  for (const item of models.values()) {
    if (item.abstract && item.states.length > 0) {
      item.fixed = (lexicon.fixed ?? []).some((noun) => slug(noun) === slug(item.noun));
      find(undefined, 'abstract-condition', 'info', item.fixed
        ? `no sentence changes "${item.noun}"; the lexicon fixes it, so it keeps the state (${item.states.join(', ')}) it starts with`
        : `no sentence changes "${item.noun}" and no mark starts it, so its state (${item.states.join(', ')}) is an abstract condition the environment picks and may change at any step; list it under "fixed" in the lexicon if it never changes`);
    }
  }

  // ---- 3. Expressions. ----
  const expr = conditionExpressions({
    models,
    links: linkPairs,
    ownership,
    lexicon,
    variable: (name) => name,
    definition: (name) => name,
    quantPrefix: '',
    warn: (ctx, code, message, span) => find(ctx.sentence, code, 'warning', message, span),
  });
  const { status, test, relation, resolve, predTla, condTla } = expr;
  const traced = (ctx: Ctx, tla: string, from: string, span: Span): Traced => ({ tla, from, sentence: ctx.sentence.id, span, words: say(ctx.sentence, span) });

  // ---- 4. Actions. ----
  const actions: ActionModel[] = [];
  const refusals: RefusalModel[] = [];
  const invariants: InvariantModel[] = [];
  const blockSentences = sentences.filter((sentence) => sentence.statement.kind === 'block');
  const bindName = (id: string, ctx: Ctx): string => {
    const existing = ctx.bindings.get(id);
    if (existing !== undefined) return existing;
    const model = models.get(id);
    const name = ident(id);
    let chosen = name;
    for (let suffix = 2; used.has(chosen) || [...ctx.bindings.values()].includes(chosen); suffix += 1) chosen = `${name}${suffix}`;
    ctx.bindings.set(id, chosen);
    ctx.params.push({ name: chosen, set: model?.instanceSet ?? 'BOOLEAN', noun: id });
    return chosen;
  };

  const compileBranch = (sentence: AcceptedSentence, block: Block, branch: Branch, branchIndex: number, guardsOnly: boolean): { ctx: Ctx; guards: Traced[]; effects: Traced[]; updates: Map<string, ((previous: string) => string)[]>; notes: Traced[]; results: ActionModel['results'] } => {
    const first = branch.clauses[0] as Clause;
    const ctx: Ctx = { sentence, bindings: new Map(), params: [], primary: noun(first.object), findings };
    const guards: Traced[] = [];
    const effects: Traced[] = [];
    const notes: Traced[] = [];
    const results: ActionModel['results'] = [];
    const updates = new Map<string, ((previous: string) => string)[]>();
    const update = (variable: string, change: (previous: string) => string): void => {
      const list = updates.get(variable) ?? [];
      list.push(change);
      updates.set(variable, list);
    };
    // Bind each object first, so a later clause or the condition can name the same instance.
    for (const clause of branch.clauses) {
      const id = noun(clause.object);
      const qual = clause.object.qual?.text.toLowerCase() ?? '';
      if (qual === 'each') continue;
      if (models.get(id)?.instanceSet !== undefined) bindName(id, ctx);
    }
    if (block.lead?.kind === 'when') guards.push(traced(ctx, condTla(block.lead.cond, ctx, 'leading condition'), 'leading condition', block.lead.span));
    if (block.lead?.kind === 'after') {
      const name = condition('after', noun(block.lead.ref), sentence.id);
      guards.push(traced(ctx, name, 'leading event', block.lead.span));
    }
    for (const clause of branch.clauses) {
      const id = noun(clause.object);
      const model = models.get(id);
      const qual = clause.object.qual?.text.toLowerCase() ?? '';
      const self = ctx.bindings.get(id);
      const refusal = clause.modal?.text.toLowerCase() === 'cannot';
      if (qual === 'each') {
        if (model?.instanceSet === undefined) continue;
        const variable = `${ident(id)}_e`;
        const filters: string[] = [];
        const filterWords: Span[] = [clause.object.span];
        if (clause.object.state !== null) filters.push(test(status(id, variable), [slug(clause.object.state.text)], false));
        for (const slot of clause.slots) {
          if (slotKey(slot) !== 'of') continue;
          const owner = noun(slot.ref);
          const via = relation(id, variable, owner);
          filterWords.push(slot.span);
          if (via === undefined) {
            find(sentence, 'owner-unknown', 'warning', `no link or ownership tells which "${slot.ref.noun.text}" a "${clause.object.noun.text}" belongs to, so "${say(sentence, slot.span)}" does not narrow the update`, slot.span);
            continue;
          }
          const ownerState = slot.ref.state === null ? undefined : slug(slot.ref.state.text);
          const ownerModel = models.get(owner);
          const term = ownerModel?.instanceSet !== undefined ? status(owner, via.expr) : status(owner, undefined);
          const parts: string[] = [];
          if (via.nullable) parts.push(`${via.expr} # ${NULL}`);
          if (ownerState !== undefined) parts.push(`${term} = ${quote(ownerState)}`);
          if (parts.length > 0) filters.push(parts.join(' /\\ '));
        }
        if (clause.result !== null && !refusal && model.statusVar !== undefined) {
          const value = quote(slug(clause.result.state.text));
          const filter = filters.length === 0 ? 'TRUE' : filters.join(' /\\ ');
          // The filter reads the state before the step; an earlier change in the same step is kept for the rest.
          update(model.statusVar, (previous) => `[${variable} \\in ${model.instanceSet} |-> IF ${filter} THEN ${value} ELSE ${previous === model.statusVar ? previous : `(${previous})`}[${variable}]]`);
          effects.push(traced(ctx, `each ${id}${filters.length > 0 ? ` where ${filters.join(' /\\ ')}` : ''} -> ${value}`, 'each object', [clause.object.span[0], clause.result.span[1]]));
          results.push({ noun: id, state: slug(clause.result.state.text) });
        }
        continue;
      }
      if (clause.object.state !== null) {
        guards.push(traced(ctx, test(status(id, self), [slug(clause.object.state.text)], false), 'object state', clause.object.state.span));
      }
      if (qual === 'new' && model?.statusVar !== undefined) {
        guards.push(traced(ctx, `${status(id, self)} = ${NULL}`, 'new object', clause.object.qual?.span ?? clause.object.span));
      }
      for (const slot of clause.slots) {
        const key = slotKey(slot);
        const target = noun(slot.ref);
        const slotQual = slot.ref.qual?.text.toLowerCase() ?? '';
        if (key === 'of') {
          const ownerModel = models.get(target);
          const via = ownerModel?.instanceSet === undefined ? { expr: undefined, nullable: false } : relation(id, self, target);
          if (via === undefined) {
            find(sentence, 'owner-unknown', 'warning', `no link or ownership tells which "${slot.ref.noun.text}" this "${clause.object.noun.text}" belongs to, so "${say(sentence, slot.span)}" is read as "some ${slot.ref.noun.text}"`, slot.span);
            if (slot.ref.state !== null && ownerModel?.instanceSet !== undefined) {
              guards.push(traced(ctx, `\\E o \\in ${ownerModel.instanceSet} : ${status(target, 'o')} = ${quote(slug(slot.ref.state.text))}`, 'owner', slot.span));
            }
            continue;
          }
          const parts: string[] = [];
          if (via.nullable && via.expr !== undefined) parts.push(`${via.expr} # ${NULL}`);
          if (slot.ref.state !== null) parts.push(`${status(target, via.expr)} = ${quote(slug(slot.ref.state.text))}`);
          if (parts.length > 0) guards.push(traced(ctx, parts.join(' /\\ '), 'owner', slot.span));
          else notes.push(traced(ctx, `belongs to ${target}`, 'owner', slot.span));
          continue;
        }
        if (key === 'with') {
          const link = linkPairs.get(`${id}|${target}`);
          if (link === undefined) continue;
          const at = (instance: string | undefined): string => (model?.instanceSet !== undefined && instance !== undefined ? `${link.var}[${instance}]` : link.var);
          const set = (value: string): void => {
            if (model?.instanceSet !== undefined && self !== undefined) update(link.var, (previous) => `[${previous} EXCEPT ![${self}] = ${value}]`);
            else update(link.var, () => value);
          };
          if (slotQual === 'no') {
            guards.push(traced(ctx, `${at(self)} # ${NULL}`, 'with no', slot.span));
            set(NULL);
            effects.push(traced(ctx, `${at(self)}' = ${NULL}`, 'with no', slot.span));
          } else if (slotQual === 'same') {
            if (model?.instanceSet === undefined || self === undefined) {
              find(sentence, 'same-on-single', 'info', `"${say(sentence, slot.span)}" copies the link from another "${clause.object.noun.text}", and the model has one; the link is kept as it is`, slot.span);
              continue;
            }
            const source = `${ident(id)}_src`;
            ctx.params.push({ name: source, set: model.instanceSet, noun: id });
            guards.push(traced(ctx, `${source} # ${self} /\\ ${status(id, source)} # ${NULL}`, 'with the same', slot.span));
            set(`${link.var}[${source}]`);
            effects.push(traced(ctx, `${at(self)}' = ${link.var}[${source}]`, 'with the same', slot.span));
          } else {
            const value = bindName(target, ctx);
            set(value);
            effects.push(traced(ctx, `${at(self)}' = ${value}`, 'with', slot.span));
          }
          continue;
        }
        if (key === 'for') {
          find(sentence, 'scope-not-compiled', 'warning', `"${say(sentence, slot.span)}" is a scope, and this prototype compiles a scope as one step on one instance: the bulk or per-pair meaning is not modelled yet`, slot.span);
          continue;
        }
        if (key === 'on' || key === 'after') {
          const name = condition(key, target, sentence.id);
          guards.push(traced(ctx, name, key, slot.span));
          continue;
        }
        if (key === 'from') {
          notes.push(traced(ctx, `copied from ${target}`, 'from', slot.span));
          find(sentence, 'copy-source', 'info', `"${say(sentence, slot.span)}" is a copy source: values are abstract, so the model keeps it as a note on the action`, slot.span);
          continue;
        }
        notes.push(traced(ctx, `via ${target}`, 'via', slot.span));
      }
      if (guardsOnly || refusal) continue;
      if (clause.result !== null && model?.statusVar !== undefined) {
        const value = quote(slug(clause.result.state.text));
        const statusVar = model.statusVar;
        if (model.instanceSet !== undefined && self !== undefined) update(statusVar, (previous) => `[${previous} EXCEPT ![${self}] = ${value}]`);
        else update(statusVar, () => value);
        effects.push(traced(ctx, `${status(id, self)}' = ${value}`, 'result', clause.result.span));
        results.push({ noun: id, state: slug(clause.result.state.text) });
      }
    }
    if (branch.guard !== null) guards.push(traced(ctx, condTla(branch.guard, ctx, 'condition'), 'condition', [branch.guard.type === 'pred' ? branch.guard.pred.span[0] : branch.guard.span[0], branch.span[1]]));
    void branchIndex;
    return { ctx, guards, effects, updates, notes, results };
  };

  const actionNames = new Map<string, string>();
  for (const sentence of blockSentences) {
    const block = sentence.statement as Block;
    const refusing = block.branches.some((branch) => branch.clauses.some((clause) => clause.modal?.text.toLowerCase() === 'cannot'));
    if (refusing) continue;
    block.branches.forEach((branch, index) => {
      const first = branch.clauses[0] as Clause;
      const compiled = compileBranch(sentence, block, branch, index, false);
      const event = verbOf(first.verb.text);
      const object = noun(first.object);
      const base = `${pascal(event)}${pascal(object)}_${sentence.id}${block.branches.length > 1 ? `_${index + 1}` : ''}`;
      const name = claim(base);
      actionNames.set(`${sentence.id}|${index}`, name);
      const updates: Record<string, string> = {};
      for (const [variable, changes] of compiled.updates) {
        let expression = variable;
        for (const change of changes) expression = change(expression);
        updates[variable] = expression;
      }
      let actor = '';
      for (const clause of branch.clauses) if (clause.actor !== null) { actor = slug(clause.actor.text); break; }
      if (actor === '') actor = lastActor(block, index);
      actions.push({
        name,
        sentence: sentence.id,
        branch: index + 1,
        text: sentence.text,
        actor,
        event,
        object,
        params: compiled.ctx.params,
        guards: compiled.guards,
        effects: compiled.effects,
        updates,
        notes: compiled.notes,
        results: compiled.results,
      });
    });
  }

  // ---- 5. Refusals: a property over every action that takes the refused step. ----
  for (const sentence of blockSentences) {
    const block = sentence.statement as Block;
    const branch = block.branches[0];
    const clause = branch?.clauses[0];
    if (branch === undefined || clause === undefined || clause.modal?.text.toLowerCase() !== 'cannot') continue;
    const event = verbOf(clause.verb.text);
    const object = noun(clause.object);
    const name = claim(`Refuse${pascal(event)}${pascal(object)}_${sentence.id}`);
    const over: RefusalModel['over'] = [];
    let guardTrace: Traced[] = [];
    for (const action of actions) {
      if (action.event !== event || action.object !== object) continue;
      // Compile the refusal's condition about the same instances the action binds.
      const compiled = compileBranch(sentence, block, branch, 0, true);
      const rename = new Map<string, string>();
      for (const param of compiled.ctx.params) {
        const match = action.params.find((item) => item.noun === param.noun);
        if (match !== undefined) rename.set(param.name, match.name);
      }
      const extra = compiled.ctx.params.filter((param) => !rename.has(param.name));
      const when = compiled.guards.map((guard) => renameIdents(guard.tla, rename));
      const condition = when.length === 0 ? 'TRUE' : when.map((part) => `(${part})`).join(' /\\ ');
      over.push({ action: action.name, params: action.params, when: extra.length === 0 ? condition : `\\E ${extra.map((param) => `${param.name} \\in ${param.set}`).join(', ')} : ${condition}` });
      guardTrace = compiled.guards;
    }
    if (over.length === 0) {
      find(sentence, 'refusal-unmatched', 'info', `no accepted sentence states "${clause.verb.text} ${clause.object.noun.text}", so this refusal holds trivially`, clause.span);
      continue;
    }
    refusals.push({ name, sentence: sentence.id, text: sentence.text, event, object, over, guards: guardTrace });
  }

  // ---- 6. Invariants. ----
  for (const sentence of sentences) {
    if (sentence.statement.kind !== 'invariant') continue;
    const statement: Invariant = sentence.statement;
    const id = noun(statement.pred.subject);
    const model = models.get(id);
    const ctx: Ctx = { sentence, bindings: new Map(), params: [], primary: id, findings };
    const qual = statement.pred.subject.qual?.text.toLowerCase() ?? '';
    const name = claim(`Inv${pascal(id)}_${sentence.id}`);
    let tla: string;
    if (qual === '' && model?.instanceSet !== undefined) {
      const variable = bindName(id, ctx);
      const body = test(status(id, variable), statement.pred.states.map((state) => slug(state.text)), statement.pred.negated);
      const guard = statement.guard === null ? undefined : condTla(statement.guard, ctx, 'condition');
      tla = `\\A ${variable} \\in ${model.instanceSet} : ${guard === undefined ? body : `(${guard}) => ${body}`}`;
    } else {
      const body = predTla(statement.pred, ctx, 'invariant');
      const guard = statement.guard === null ? undefined : condTla(statement.guard, ctx, 'condition');
      tla = guard === undefined ? body : `(${guard}) => (${body})`;
    }
    invariants.push({ name, sentence: sentence.id, text: sentence.text, tla });
  }

  // ---- 7. Cross-sentence findings. ----
  const marks = sentences.filter((sentence): sentence is AcceptedSentence & { statement: Mark } => sentence.statement.kind === 'mark');
  for (const mark of marks) {
    const model = models.get(noun(mark.statement.subject));
    if (mark.statement.mark === 'starts' && mark.statement.states.length > 1) {
      find(mark, 'many-starts', 'info', `"${mark.statement.subject.noun.text}" may start in any of ${mark.statement.states.length} states`, mark.statement.span);
    }
    if (model !== undefined && mark.statement.mark === 'ends') {
      for (const state of model.finals) {
        const leaves = actions.some((action) => action.guards.some((guard) => guard.from === 'object state' && guard.tla.endsWith(quote(state))) && action.object === model.noun);
        if (leaves) find(mark, 'final-has-exit', 'warning', `"${state}" is a final state of "${model.noun}", but some action starts from it`, mark.statement.span);
      }
    }
  }
  for (const model of models.values()) {
    if (model.statusVar === undefined || model.abstract) continue;
    const reached = new Set<string>(model.initial);
    for (const action of actions) {
      const update = model.statusVar === undefined ? undefined : action.updates[model.statusVar];
      if (update === undefined) continue;
      for (const match of update.matchAll(/"([^"]+)"/g)) if (match[1] !== undefined) reached.add(match[1]);
    }
    for (const state of model.states) {
      if (!reached.has(state)) find(undefined, 'state-never-set', 'warning', `a sentence reads "${model.noun}" as "${state}", but no action or mark puts it there`);
    }
  }
  if (!marks.some((mark) => mark.statement.mark === 'ends') && actions.length > 0) {
    find(undefined, 'no-final-states', 'warning', 'no sentence says where an object ends ("The NOUN ends as STATE."), so a step with no way on cannot be told from a finished object and dead ends are not checked');
  }
  const sameStep = new Map<string, ActionModel[]>();
  for (const action of actions) {
    const key = `${action.event}|${action.object}|${action.guards.map((guard) => guard.tla).sort().join('&')}`;
    const list = sameStep.get(key) ?? [];
    list.push(action);
    sameStep.set(key, list);
  }
  for (const list of sameStep.values()) {
    // Branches of one block are alternatives the writer stated together, on purpose.
    if (new Set(list.map((action) => action.sentence)).size < 2) continue;
    const results = new Set(list.map((action) => JSON.stringify(action.updates)));
    if (list.length > 1 && results.size > 1) {
      find(undefined, 'same-step-two-results', 'warning', `${list.map((action) => action.sentence).join(' and ')} take the same step "${list[0]?.event ?? ''} ${list[0]?.object ?? ''}" under the same guard to different results: if this is a choice, write it as one block with ", or" and a condition on each branch`);
    }
  }

  const ordered = [...models.values()].sort((left, right) => left.noun.localeCompare(right.noun));
  return {
    nouns: ordered,
    links,
    conditions: [...conditionVars.values()],
    ownership,
    actions,
    refusals,
    invariants,
    hasFinals: ordered.some((model) => model.finals.length > 0),
    findings,
  };
}

function lastActor(block: Block, upTo: number): string {
  let actor = '';
  for (let index = 0; index <= upTo; index += 1) {
    for (const clause of block.branches[index]?.clauses ?? []) if (clause.actor !== null) actor = slug(clause.actor.text);
  }
  return actor;
}

function renameIdents(text: string, rename: ReadonlyMap<string, string>): string {
  if (rename.size === 0) return text;
  return text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => rename.get(name) ?? name);
}

export function sentenceOrder(left: string, right: string): number {
  const a = Number(left.replace(/\D+/g, ''));
  const b = Number(right.replace(/\D+/g, ''));
  return a === b ? left.localeCompare(right) : a - b;
}

/** For callers that list a slot's meaning. Exported for tests. */
export function describeSlot(slot: Slot): string {
  return `${slotKey(slot)} ${slot.ref.noun.text}`;
}

/** What the condition compiler reads: the nouns, links, and ownership of a compiled model, and how to name them. */
export interface ExpressionEnv {
  models: ReadonlyMap<string, NounModel>;
  /** `object|target` → the link. */
  links: ReadonlyMap<string, LinkModel>;
  ownership: CanonModel['ownership'];
  lexicon: CanonLexicon;
  /** How a variable of the blocks module is written. The identity inside the blocks module. */
  variable(name: string): string;
  /** How a definition of the blocks module (a set, an ownership map, Null) is written. */
  definition(name: string): string;
  /** Prefix of the variables a quantifier binds, so they cannot shadow a name of the module that reads them. */
  quantPrefix: string;
  warn(ctx: CondContext, code: string, message: string, span: Span): void;
}

export interface ConditionExpressions {
  status(id: string, instance: string | undefined): string;
  test(expression: string, states: readonly string[], negated: boolean): string;
  relation(from: string, fromInstance: string | undefined, to: string): { expr: string; nullable: boolean } | undefined;
  resolve(id: string, ctx: CondContext): { expr: string | undefined; nullable: boolean } | undefined;
  predTla(pred: Pred, ctx: CondContext, from: string): string;
  condTla(cond: Cond, ctx: CondContext, from: string): string;
}

/**
 * One meaning for conditions. The blocks compiler and the workflow compiler both read a predicate through this,
 * so "the order is approved" compiles to the same test in a spec sentence and in a workflow step.
 */
export function conditionExpressions(env: ExpressionEnv): ConditionExpressions {
  const { models, links, ownership, lexicon } = env;
  const v = env.variable;
  const d = env.definition;
  const nul = d(NULL);
  const noun = (ref: Ref): string => nounOf(ref, lexicon);
  const say = (sentence: AcceptedSentence, span: Span): string => sentence.text.slice(span[0], span[1]);
  const status = (id: string, instance: string | undefined): string => {
    const model = models.get(id);
    const name = v(model?.statusVar ?? `${ident(id)}_status`);
    return model?.instanceSet !== undefined && instance !== undefined ? `${name}[${instance}]` : name;
  };
  const test = (expression: string, states: readonly string[], negated: boolean): string => {
    if (states.length === 1) return `${expression} ${negated ? '#' : '='} ${quote(states[0] ?? '')}`;
    return `${expression} ${negated ? '\\notin' : '\\in'} ${setText(states)}`;
  };
  /** How `to` is reached from an instance of `from`: through a link, or through a fixed ownership. */
  const relation = (from: string, fromInstance: string | undefined, to: string): { expr: string; nullable: boolean } | undefined => {
    const link = links.get(`${from}|${to}`);
    const fromModel = models.get(from);
    if (link !== undefined) {
      return { expr: fromModel?.instanceSet !== undefined && fromInstance !== undefined ? `${v(link.var)}[${fromInstance}]` : v(link.var), nullable: true };
    }
    const owned = ownership.find((item) => item.object === from && item.owner === to);
    if (owned !== undefined && fromInstance !== undefined) return { expr: `${d(owned.name)}[${fromInstance}]`, nullable: false };
    return undefined;
  };
  /** The instance of `id` this action is about, when there is exactly one way to tell. */
  const resolve = (id: string, ctx: CondContext): { expr: string | undefined; nullable: boolean } | undefined => {
    const model = models.get(id);
    if (model?.instanceSet === undefined) return { expr: undefined, nullable: false };
    const bound = ctx.bindings.get(id);
    if (bound !== undefined) return { expr: bound, nullable: false };
    const primary = ctx.bindings.get(ctx.primary);
    const viaPrimary = relation(ctx.primary, primary, id);
    if (viaPrimary !== undefined) return viaPrimary;
    for (const [other, instance] of ctx.bindings) {
      const via = relation(other, instance, id);
      if (via !== undefined) return via;
    }
    return undefined;
  };
  let quantNumber = 0;
  const scopeOf = (id: string, ctx: CondContext, variable: string): string => {
    const model = models.get(id);
    const set = model?.instanceSet === undefined ? 'BOOLEAN' : d(model.instanceSet);
    for (const [other, instance] of ctx.bindings) {
      const owned = relation(id, variable, other);
      if (owned !== undefined) return `{${variable} \\in ${set} : ${owned.expr} = ${instance}}`;
    }
    return set;
  };
  const predTla = (pred: Pred, ctx: CondContext, from: string): string => {
    const id = noun(pred.subject);
    const states = pred.states.map((state) => slug(state.text));
    const qual = pred.subject.qual?.text.toLowerCase() ?? '';
    const model = models.get(id);
    let resolved = qual === '' ? resolve(id, ctx) : undefined;
    if (qual === '' && resolved === undefined) {
      env.warn(ctx, 'unscoped-condition', `"${say(ctx.sentence, pred.subject.span)}" has several instances and this step names none of them, so the condition is read as "some ${pred.subject.noun.text}": say each, some, one or no to be exact`, pred.span);
    }
    if (model?.instanceSet !== undefined && (qual !== '' || resolved === undefined)) {
      quantNumber += 1;
      const variable = `${env.quantPrefix}${ident(id)}_q${quantNumber}`;
      const scope = scopeOf(id, ctx, variable);
      const term = status(id, variable);
      const body = test(term, states, pred.negated);
      if (qual === 'each') return `\\A ${variable} \\in ${scope} : ${term} # ${nul} => ${body}`;
      if (qual === 'one') return `Cardinality({${variable} \\in ${scope} : ${body}}) = 1`;
      if (qual === 'no') return `~(\\E ${variable} \\in ${scope} : ${body})`;
      return `\\E ${variable} \\in ${scope} : ${body}`;
    }
    resolved ??= { expr: undefined, nullable: false };
    const body = test(status(id, resolved.expr), states, pred.negated);
    void from;
    return resolved.nullable && resolved.expr !== undefined ? `(${resolved.expr} # ${nul} /\\ ${body})` : body;
  };
  const condTla = (cond: Cond, ctx: CondContext, from: string): string => {
    if (cond.type === 'pred') return predTla(cond.pred, ctx, from);
    const parts = cond.items.map((item) => {
      const text = condTla(item, ctx, from);
      return item.type === 'pred' ? text : `(${text})`;
    });
    return parts.map((part) => (/\\[AE] /.test(part) && parts.length > 1 ? `(${part})` : part)).join(cond.type === 'and' ? ' /\\ ' : ' \\/ ');
  };
  return { status, test, relation, resolve, predTla, condTla };
}
