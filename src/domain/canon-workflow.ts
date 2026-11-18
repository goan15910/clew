// Workflows in English: an independent statement of intent, checked against the spec's model by TLC.
//
// A workflow is a list of sentences in the canonical grammar, marked as "must be possible" or "must be refused".
// It goes through the same parser and gate as the spec, with the spec's lexicon and the spec's known states, and
// its conditions compile through the same condition compiler. What it shares and what it owns:
//
//               spec                          workflows
//   concepts    shared (lexicon, nouns, states, actors, events)
//   sentences   s1, s2, ...                   w1.s1, w1.s2, ...  (own namespace per workflow)
//   clauses     <sentence>/b1/c1              <step>/b1/c1
//   frames      ReviewOrder_s3_1 (actions)    W1_Step2_ReviewOrder_s3_1 (step frames)
//   may cite    its own                       its own, and the spec's
//
// References go one way. A step cites the spec actions (frames) it matches, the spec sentences they came from,
// and the shared concepts it names. Nothing here is read by the spec's gate or compiler: a workflow cannot add a
// concept, a state, or a step to the spec. A step that needs one the spec lacks raises a finding instead.
//
// A workflow sentence is stored as its text and its parse (ParsedSentence): the deepest layer that names nothing
// of the spec. Everything below the parse (the gate's rules, the concepts, the citations, the monitor) is computed
// here on every run and never saved, because the spec it reads can change between versions.
//
// Each workflow compiles to a scenario monitor: a step counter that advances only on the named spec actions. The
// monitor declares the blocks module's variables itself and maps them one to one (Blocks == INSTANCE <Name>Blocks
// WITH v <- v), so it reads them directly. TLC returns a witness for a possible workflow, or shows a refused
// workflow going through.
import {
  condPreds,
  nounOf,
  slotKey,
  slug,
  verbOf,
  type Block,
  type CanonLexicon,
  type Clause,
  type Cond,
  type Diagnostic,
  type Pred,
  type Ref,
  type Span,
  type Statement,
} from './canon-ast.js';
import { checkStatement } from './canon-rules.js';
import {
  conditionExpressions,
  ident,
  type AcceptedSentence,
  type ActionModel,
  type CanonModel,
  type CondContext,
  type ConditionExpressions,
  type LinkModel,
  type NounModel,
} from './canon-compile.js';
import { draftRewrite, type DraftRewrite, type GateContext, type GateResult, type ParseSentence } from './canon-gate.js';
import type { FindingSeverity } from './spec.js';

export type WorkflowExpect = 'possible' | 'refused';
/**
 * loose: other spec actions may happen before, between, and after the steps; the steps happen in this order.
 * exact: no spec action happens but the steps, in this order; only the environment moves in between.
 */
export type WorkflowMode = 'loose' | 'exact';

export const CANON_WORKFLOW_ID_PATTERN = /^w[1-9][0-9]*$/;
export const CANON_WORKFLOW_SENTENCE_ID_PATTERN = /^w[1-9][0-9]*\.s[1-9][0-9]*$/;

/**
 * What a workflow sentence stores beside its text: the parser's output, and the grammar words it was parsed with.
 * It names no spec sentence, action, or state the spec knows, so it stays true when the spec changes; only a change
 * to the words the grammar reads (actors, multi-word terms, states, and verbs) makes it stale.
 */
export interface ParsedSentence {
  /** grammarKey of the lexicon the sentence was parsed with. */
  grammar: string;
  /** Null when the grammar rejects the sentence. */
  statement: Statement | null;
  /** Syntax diagnostics only: the gate's rules run on the statement on every check. */
  diagnostics: Diagnostic[];
}

/** One workflow as the checker reads it: the live sentences in order, each with its stored parse. */
export interface WorkflowInput {
  id: string;
  title: string;
  expect: WorkflowExpect;
  mode: WorkflowMode;
  sentences: { id: string; text: string; parsed: ParsedSentence }[];
}

/** The lexicon words the parser reads, as one key: a parse is current while its key matches. */
export function grammarKey(lexicon: CanonLexicon): string {
  const sorted = (words: readonly string[]): string[] => [...words].map((word) => word.toLowerCase()).sort();
  const text = JSON.stringify([sorted(lexicon.actors), sorted(lexicon.terms), sorted(lexicon.states), sorted(lexicon.verbs)]);
  // FNV-1a, 32 bits: a fingerprint to compare, not a security hash.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

/** Parse one workflow sentence for storage. */
export function parseWorkflowSentence(text: string, lexicon: CanonLexicon, parse: ParseSentence): ParsedSentence {
  const parsed = parse(text);
  return { grammar: grammarKey(lexicon), statement: parsed.statement, diagnostics: parsed.diagnostics };
}

/** The gate on a stored parse: the spec's rules, with the spec's lexicon and known states, as gateSentence runs them. */
function gateParsed(text: string, parsed: ParsedSentence, context: GateContext): { statement: Statement | null; diagnostics: Diagnostic[] } {
  if (parsed.statement === null) return { statement: null, diagnostics: parsed.diagnostics };
  const diagnostics = checkStatement(parsed.statement, { lexicon: context.lexicon, known: context.known, text });
  return { statement: diagnostics.length === 0 ? parsed.statement : null, diagnostics };
}

/** The blocks module's variables, in its order: the monitor declares the same ones and maps them one to one. */
export function blocksVariables(model: CanonModel): string[] {
  const vars: string[] = [];
  for (const noun of model.nouns) if (noun.statusVar !== undefined) vars.push(noun.statusVar);
  for (const link of model.links) vars.push(link.var);
  for (const condition of model.conditions) vars.push(condition.var);
  return vars;
}

export interface WorkflowFinding {
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  workflow: string;
  /** The workflow sentence, `w1.s2`. */
  sentence?: string;
  span?: Span;
  words?: string;
}

/** A spec frame a step cites: the action, the spec sentence it came from, and that action's guards. */
export interface StepCitation {
  action: string;
  sentence: string;
  branch: number;
  guards: string[];
}

export interface WorkflowSentenceView {
  id: string;
  text: string;
  /** step: something happens. start / end: a mark that pins the first or the last state. */
  role: 'step' | 'start' | 'end';
  /** The step's number, counting steps only. */
  step?: number;
  status: 'accepted' | 'dangling';
  diagnostics: Diagnostic[];
  draft?: DraftRewrite;
  /** The shared concepts the sentence names: `actor:customer`, `noun:order`, `state:order/approved`, `event:REVIEW/order`. */
  concepts: string[];
  /** The spec frames the step matches. Empty for a mark or a step that matches none. */
  cites: StepCitation[];
}

export interface WorkflowCheck {
  id: string;
  title: string;
  expect: WorkflowExpect;
  mode: WorkflowMode;
  sentences: WorkflowSentenceView[];
  findings: WorkflowFinding[];
  /** Every sentence passes, and no finding blocks the monitor. */
  ready: boolean;
  /** The monitor's pieces, when ready. */
  monitor?: WorkflowMonitor;
}

export interface MonitorStep {
  number: number;
  sentence: string;
  text: string;
  /** One alternative per matched spec action: `Blocks!ReviewOrder_s3_1(wf_order)`, with its bound variables. */
  alternatives: { action: string; sentence: string; call: string }[];
  /** Conditions the step adds over the action's guards, read in the state before the step. */
  guards: { tla: string; words: string }[];
}

export interface WorkflowMonitor {
  /** `W1`: the prefix of every definition of this workflow. */
  prefix: string;
  steps: MonitorStep[];
  starts: { tla: string; words: string; sentence: string }[];
  ends: { tla: string; words: string; sentence: string }[];
  /** The workflow's instance variables: one per noun with instances that the workflow names without a quantifier. */
  bound: { variable: string; noun: string; set: string }[];
  /** Loose mode: every spec action, so a step between the workflow's steps names its action in a TLC trace. */
  others: { action: string; sentence: string; call: string }[];
}

export interface WorkflowSpec {
  lexicon: CanonLexicon;
  /** The spec's gate: its known states, and its events for drafts. */
  gate: GateResult;
  model: CanonModel;
}

/** The prefix of a workflow's definitions: `w3` → `W3`. */
export function workflowPrefix(id: string): string {
  return id.toUpperCase();
}

/** The variable that holds the one instance of a noun a workflow names: `order` → `wf_order`. */
export function boundVariable(noun: string): string {
  return `wf_${ident(noun)}`;
}

/** The statements of a workflow that the gate would not refuse in a spec, but a workflow cannot hold. */
function workflowRules(statement: Statement, text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const say = (span: Span): string => text.slice(span[0], span[1]);
  if (statement.kind === 'invariant') {
    out.push({ severity: 'rule', code: 'workflow-invariant', message: 'a workflow is one path, and an invariant holds on every path: state it in the spec', span: statement.span, found: say(statement.span), expected: ['CLAUSE', 'NOUN starts as STATE', 'NOUN ends as STATE'], form: 'workflow step' });
    return out;
  }
  if (statement.kind !== 'block') return out;
  if (statement.branches.length > 1) {
    const second = statement.branches[1];
    const span: Span = second === undefined ? statement.span : second.span;
    out.push({ severity: 'rule', code: 'workflow-branches', message: 'a step is one thing that happens; ", or" offers a choice. Write one workflow per path', span, found: say(span), expected: ['"."'], form: 'workflow step' });
  }
  for (const branch of statement.branches) {
    for (const clause of branch.clauses) {
      if (clause.modal?.text.toLowerCase() === 'cannot') {
        out.push({ severity: 'rule', code: 'workflow-refusal', message: 'a step states what happens. To say a path must not happen, write the path and mark the workflow (refused)', span: clause.modal.span, found: say(clause.modal.span), expected: ['VERB'], form: 'workflow step' });
      }
    }
  }
  return out;
}

/** Every reference a statement makes, with whether the grammar position reads it as one instance. */
function refsOf(statement: Statement): { ref: Ref; position: 'object' | 'slot' | 'subject' | 'event' }[] {
  const out: { ref: Ref; position: 'object' | 'slot' | 'subject' | 'event' }[] = [];
  const preds = (cond: Cond | null): void => {
    for (const pred of condPreds(cond)) out.push({ ref: pred.subject, position: 'subject' });
  };
  if (statement.kind === 'mark') {
    out.push({ ref: statement.subject, position: 'subject' });
    return out;
  }
  if (statement.kind === 'invariant') {
    out.push({ ref: statement.pred.subject, position: 'subject' });
    preds(statement.guard);
    return out;
  }
  if (statement.lead?.kind === 'when') preds(statement.lead.cond);
  if (statement.lead?.kind === 'after') out.push({ ref: statement.lead.ref, position: 'event' });
  for (const branch of statement.branches) {
    for (const clause of branch.clauses) {
      out.push({ ref: clause.object, position: 'object' });
      for (const slot of clause.slots) {
        const key = slotKey(slot);
        out.push({ ref: slot.ref, position: key === 'on' || key === 'after' ? 'event' : 'slot' });
      }
    }
    preds(branch.guard);
  }
  return out;
}

const QUANTS = new Set(['each', 'some', 'one', 'no']);

function quantifier(ref: Ref): string {
  return ref.qual?.text.toLowerCase() ?? '';
}

/**
 * E13: a step that needs several instances of a noun the spec models as one status variable. Two conditions on
 * the same noun that hold together but name disjoint states need two of them; a quantifier counts over them.
 */
function needsInstances(cond: Cond | null, models: ReadonlyMap<string, NounModel>, lexicon: CanonLexicon): { noun: string; span: Span; why: 'disjoint' | 'quantifier' }[] {
  const out: { noun: string; span: Span; why: 'disjoint' | 'quantifier' }[] = [];
  if (cond === null) return out;
  const single = (noun: string): boolean => models.get(noun)?.instanceSet === undefined;
  for (const pred of condPreds(cond)) {
    const noun = nounOf(pred.subject, lexicon);
    if (QUANTS.has(quantifier(pred.subject)) && single(noun)) out.push({ noun, span: pred.span, why: 'quantifier' });
  }
  const conjuncts = (node: Cond): Pred[] => {
    if (node.type === 'pred') return [node.pred];
    if (node.type === 'and') return node.items.flatMap((item) => (item.type === 'or' ? [] : conjuncts(item)));
    return [];
  };
  const visit = (node: Cond): void => {
    if (node.type === 'pred') return;
    if (node.type === 'and') {
      const together = conjuncts(node).filter((pred) => !pred.negated && quantifier(pred.subject) === '');
      for (let left = 0; left < together.length; left += 1) {
        for (let right = left + 1; right < together.length; right += 1) {
          const a = together[left] as Pred;
          const b = together[right] as Pred;
          const noun = nounOf(a.subject, lexicon);
          if (noun !== nounOf(b.subject, lexicon) || !single(noun)) continue;
          const statesA = a.states.map((state) => slug(state.text));
          const statesB = b.states.map((state) => slug(state.text));
          if (!statesA.some((state) => statesB.includes(state))) out.push({ noun, span: [a.span[0], b.span[1]], why: 'disjoint' });
        }
      }
    }
    for (const item of node.items) visit(item);
  };
  visit(cond);
  return out;
}

/** The actor of a clause, or of the closest clause before it in the same block that names one. */
function actorOf(block: Block, clause: Clause): string {
  let actor = '';
  for (const branch of block.branches) {
    for (const item of branch.clauses) {
      if (item.actor !== null) actor = slug(item.actor.text);
      if (item === clause) return actor;
    }
  }
  return actor;
}

/** The pre-state conditions a step states, as predicates: its object's state, owner states, and its conditions. */
function stepPreds(block: Block): { pred: Pred; words: Span }[] {
  const out: { pred: Pred; words: Span }[] = [];
  const branch = block.branches[0];
  if (branch === undefined) return out;
  for (const clause of branch.clauses) {
    if (clause.object.state !== null && quantifier(clause.object) === '') {
      out.push({ pred: { span: clause.object.span, subject: { ...clause.object, state: null }, negated: false, states: [clause.object.state] }, words: clause.object.span });
    }
    for (const slot of clause.slots) {
      if (slotKey(slot) === 'of' && slot.ref.state !== null) {
        out.push({ pred: { span: slot.span, subject: { ...slot.ref, state: null }, negated: false, states: [slot.ref.state] }, words: slot.span });
      }
    }
  }
  return out;
}

/** Gate, align, and match every workflow against the spec. The spec is read, never written. */
export function checkWorkflows(spec: WorkflowSpec, workflows: readonly WorkflowInput[], parse: ParseSentence): WorkflowCheck[] {
  const { lexicon, model } = spec;
  const known = new Set(spec.gate.known);
  const events = new Map<string, string[]>();
  for (const action of model.actions) {
    for (const result of action.results) {
      const key = `${action.event}|${result.noun}`;
      const list = events.get(key) ?? [];
      if (!list.includes(result.state)) list.push(result.state);
      events.set(key, list);
    }
  }
  const context: GateContext = { lexicon, parse, known, events };
  const grammar = grammarKey(lexicon);
  const models = new Map(model.nouns.map((noun) => [noun.noun, noun]));
  const links = new Map<string, LinkModel>(model.links.map((link) => [`${link.object}|${link.target}`, link]));
  const conditions = new Set(model.conditions.map((condition) => condition.var));
  const actors = new Set(lexicon.actors.map((actor) => slug(actor)));
  return workflows.map((workflow) => {
    let findingNumber = 0;
    const findings: WorkflowFinding[] = [];
    const find = (code: string, severity: FindingSeverity, message: string, sentence?: { id: string; text: string }, span?: Span): void => {
      findingNumber += 1;
      const finding: WorkflowFinding = { id: `${workflow.id}.f${findingNumber}`, code, severity, message, workflow: workflow.id };
      if (sentence !== undefined) finding.sentence = sentence.id;
      if (sentence !== undefined && span !== undefined) {
        finding.span = span;
        finding.words = sentence.text.slice(span[0], span[1]);
      }
      findings.push(finding);
    };
    const prefix = workflowPrefix(workflow.id);
    const views: WorkflowSentenceView[] = [];
    const accepted: { view: WorkflowSentenceView; sentence: AcceptedSentence }[] = [];
    let stepNumber = 0;
    for (const input of workflow.sentences) {
      // A parse made with other grammar words may not be what the parser says now: it is not read until parsed again.
      const stale = input.parsed.grammar !== grammar;
      const gated = stale ? { statement: null, diagnostics: [] } : gateParsed(input.text, input.parsed, context);
      let statement = gated.statement;
      let diagnostics = gated.diagnostics;
      if (statement !== null) {
        const extra = workflowRules(statement, input.text);
        if (extra.length > 0) {
          statement = null;
          diagnostics = extra;
        }
      }
      const role: WorkflowSentenceView['role'] = statement?.kind === 'mark' ? (statement.mark === 'starts' ? 'start' : 'end') : 'step';
      const view: WorkflowSentenceView = { id: input.id, text: input.text, role, status: statement === null ? 'dangling' : 'accepted', diagnostics, concepts: [], cites: [] };
      if (role === 'step') {
        stepNumber += 1;
        view.step = stepNumber;
      }
      if (stale) {
        find('parse-stale', 'blocking', `${input.id} was parsed with other lexicon words (actors, terms, states, or verbs) than the spec has now: run clew spec workflow parse to parse it again`, input);
      } else if (statement === null) {
        const draft = draftRewrite(input.text, context);
        if (draft !== undefined) {
          // The draft must pass the workflow rules too, not only the spec's gate.
          const parsed = draft.parses ? parse(draft.text).statement : null;
          if (parsed !== null && workflowRules(parsed, draft.text).length > 0) draft.parses = false;
          view.draft = draft;
        }
        find('step-dangling', 'blocking', `${input.id} does not pass the gate, so the workflow cannot be checked: ${diagnostics[0]?.message ?? 'it does not parse'}`, input, diagnostics[0]?.span);
      } else {
        accepted.push({ view, sentence: { id: input.id, text: input.text, statement } });
      }
      views.push(view);
    }
    if (stepNumber === 0) find('no-steps', 'blocking', `${workflow.id} has no step: a workflow names at least one thing that happens`);

    // ---- Concept alignment: every noun, state, actor, and event is the spec's. ----
    const concepts = (view: WorkflowSentenceView, concept: string): void => {
      if (!view.concepts.includes(concept)) view.concepts.push(concept);
    };
    const unquantified = new Set<string>();
    for (const { view, sentence } of accepted) {
      const statement = sentence.statement;
      for (const { ref, position } of refsOf(statement)) {
        const noun = nounOf(ref, lexicon);
        if (position === 'event') {
          // An event is checked against the spec's event conditions below.
          concepts(view, `event:${noun}`);
          continue;
        }
        const known = models.get(noun);
        if (known === undefined) {
          find('unknown-concept', 'blocking', `the spec has no "${ref.noun.text}": a workflow uses the spec's concepts and cannot add one. Use the spec's word, or add a spec sentence that states it`, sentence, ref.noun.span);
          continue;
        }
        concepts(view, `noun:${noun}`);
        if (ref.state !== null) {
          const state = slug(ref.state.text);
          concepts(view, `state:${noun}/${state}`);
          if (!known.states.includes(state)) find('state-not-of-noun', 'warning', `the spec never has "${noun}" in "${state}"`, sentence, ref.state.span);
        }
        if (!QUANTS.has(quantifier(ref)) && known.instanceSet !== undefined) unquantified.add(noun);
      }
      const predStates: { pred: Pred }[] = [];
      if (statement.kind === 'mark') predStates.push({ pred: { span: statement.span, subject: statement.subject, negated: false, states: statement.states } });
      if (statement.kind === 'block') {
        if (statement.lead?.kind === 'when') for (const pred of condPreds(statement.lead.cond)) predStates.push({ pred });
        for (const branch of statement.branches) for (const pred of condPreds(branch.guard)) predStates.push({ pred });
      }
      for (const { pred } of predStates) {
        const noun = nounOf(pred.subject, lexicon);
        const known = models.get(noun);
        if (known === undefined) continue;
        for (const word of pred.states) {
          const state = slug(word.text);
          concepts(view, `state:${noun}/${state}`);
          if (!known.states.includes(state)) find('state-not-of-noun', 'warning', `the spec never has "${noun}" in "${state}"`, sentence, word.span);
        }
      }
      if (statement.kind !== 'block') continue;
      for (const branch of statement.branches) {
        for (const clause of branch.clauses) {
          const actor = actorOf(statement, clause);
          if (actor !== '') {
            if (actors.has(actor)) concepts(view, `actor:${actor}`);
            else find('unknown-concept', 'blocking', `the spec has no actor "${actor}"`, sentence, clause.actor?.span ?? clause.span);
          }
          const noun = nounOf(clause.object, lexicon);
          concepts(view, `event:${verbOf(clause.verb.text)}/${noun}`);
          if (clause.result !== null) {
            const state = slug(clause.result.state.text);
            concepts(view, `state:${noun}/${state}`);
            const known = models.get(noun);
            if (known !== undefined && !known.states.includes(state)) find('state-not-of-noun', 'warning', `the spec never has "${noun}" in "${state}"`, sentence, clause.result.state.span);
          }
          for (const slot of clause.slots) {
            const key = slotKey(slot);
            if ((key === 'on' || key === 'after') && !conditions.has(`${key}_${ident(nounOf(slot.ref, lexicon))}`)) {
              find('unknown-concept', 'blocking', `the spec has no event "${key} ${slot.ref.noun.text}": a step can only wait for an event the spec names`, sentence, slot.span);
            }
          }
        }
      }
      if (statement.lead?.kind === 'after' && !conditions.has(`after_${ident(nounOf(statement.lead.ref, lexicon))}`)) {
        find('unknown-concept', 'blocking', `the spec has no event "after ${statement.lead.ref.noun.text}"`, sentence, statement.lead.span);
      }
    }

    // ---- needs-instances (E13), before any model checking. ----
    for (const { sentence } of accepted) {
      const statement = sentence.statement;
      const conds: Cond[] = [];
      if (statement.kind === 'block') {
        if (statement.lead?.kind === 'when') conds.push(statement.lead.cond);
        for (const branch of statement.branches) {
          if (branch.guard !== null) conds.push(branch.guard);
          for (const clause of branch.clauses) {
            const noun = nounOf(clause.object, lexicon);
            if (quantifier(clause.object) === 'each' && models.get(noun) !== undefined && models.get(noun)?.instanceSet === undefined) {
              find('needs-instances', 'blocking', `"${noun}" is one status variable in the spec, but this step acts on each of them: declare "${noun}" with instances in the spec (lexicon "instances") if there can be several`, sentence, clause.object.span);
            }
          }
        }
      }
      if (statement.kind === 'mark' && QUANTS.has(quantifier(statement.subject))) {
        const noun = nounOf(statement.subject, lexicon);
        if (models.get(noun) !== undefined && models.get(noun)?.instanceSet === undefined) {
          find('needs-instances', 'blocking', `"${noun}" is one status variable in the spec, but this mark counts over them`, sentence, statement.subject.span);
        }
      }
      const reported = new Set<string>();
      for (const cond of conds) {
        for (const need of needsInstances(cond, models, lexicon)) {
          if (!models.has(need.noun) || reported.has(`${need.noun}|${need.why}`)) continue;
          reported.add(`${need.noun}|${need.why}`);
          find('needs-instances', 'blocking', `"${need.noun}" is one status variable in the spec, but this step ${need.why === 'disjoint' ? 'needs two of them in different states' : 'counts over them'}: declare "${need.noun}" with instances in the spec (lexicon "instances") if there can be several`, sentence, need.span);
        }
      }
    }

    // ---- Match each step to the spec actions it names: the frames it cites. ----
    for (const { view, sentence } of accepted) {
      const statement = sentence.statement;
      if (statement.kind !== 'block') continue;
      const branch = statement.branches[0];
      const first = branch?.clauses[0];
      if (branch === undefined || first === undefined) continue;
      const event = verbOf(first.verb.text);
      const object = nounOf(first.object, lexicon);
      const actor = actorOf(statement, first);
      const wanted = branch.clauses.filter((clause) => clause.result !== null).map((clause) => ({ noun: nounOf(clause.object, lexicon), state: slug(clause.result?.state.text ?? '') }));
      const sameEvent = model.actions.filter((action) => action.event === event && action.object === object);
      const matched = sameEvent.filter((action) => (actor === '' || action.actor === '' || action.actor === actor) && wanted.every((want) => action.results.some((result) => result.noun === want.noun && result.state === want.state)));
      if (matched.length === 0) {
        const near = sameEvent.length === 0
          ? 'no spec sentence states that step at all'
          : `the spec states "${first.verb.text} ${first.object.noun.text}" as ${sameEvent.map((action) => `${action.name} (${action.actor || 'no actor'}${action.results.length > 0 ? `, as ${action.results.map((result) => result.state).join(' and ')}` : ''})`).join(', ')}`;
        find('step-unmatched', 'blocking', `no spec action matches step ${view.step ?? ''}: ${near}. A workflow cannot add a step to the spec; add or fix the spec sentence, or the step`, sentence, first.span);
        continue;
      }
      if (matched.length > 1) find('step-ambiguous', 'info', `step ${view.step ?? ''} matches ${matched.map((action) => action.name).join(', ')}; the monitor takes any of them`, sentence, first.span);
      view.cites = matched.map((action) => ({ action: action.name, sentence: action.sentence, branch: action.branch, guards: action.guards.map((guard) => guard.tla) }));
    }

    const blocked = findings.some((finding) => finding.severity === 'blocking');
    const check: WorkflowCheck = { id: workflow.id, title: workflow.title, expect: workflow.expect, mode: workflow.mode, sentences: views, findings, ready: !blocked };
    if (!blocked) check.monitor = buildMonitor(prefix, accepted, [...unquantified].sort(), spec, models, links, find);
    return check;
  });
}

function buildMonitor(
  prefix: string,
  accepted: readonly { view: WorkflowSentenceView; sentence: AcceptedSentence }[],
  boundNouns: readonly string[],
  spec: WorkflowSpec,
  models: ReadonlyMap<string, NounModel>,
  links: ReadonlyMap<string, LinkModel>,
  find: (code: string, severity: FindingSeverity, message: string, sentence?: { id: string; text: string }, span?: Span) => void,
): WorkflowMonitor {
  const { lexicon, model } = spec;
  const bound = boundNouns.map((noun) => ({ variable: boundVariable(noun), noun, set: models.get(noun)?.instanceSet ?? 'BOOLEAN' }));
  const bindings = new Map(bound.map((item) => [item.noun, item.variable]));
  const expr: ConditionExpressions = conditionExpressions({
    models,
    links,
    ownership: model.ownership,
    lexicon,
    variable: (name) => name,
    definition: (name) => `Blocks!${name}`,
    quantPrefix: 'wfq_',
    warn: (ctx, code, message, span) => find(code, 'warning', message, ctx.sentence, span),
  });
  const ctxOf = (sentence: AcceptedSentence, primary: string): CondContext => ({ sentence, bindings: new Map(bindings), params: [], primary, findings: [] });
  const say = (sentence: AcceptedSentence, span: Span): string => sentence.text.slice(span[0], span[1]);
  const actionsByName = new Map<string, ActionModel>(model.actions.map((action) => [action.name, action]));
  const steps: MonitorStep[] = [];
  const starts: WorkflowMonitor['starts'] = [];
  const ends: WorkflowMonitor['ends'] = [];
  for (const { view, sentence } of accepted) {
    const statement = sentence.statement;
    if (statement.kind === 'mark') {
      const pred: Pred = { span: statement.span, subject: statement.subject, negated: false, states: statement.states };
      const tla = expr.predTla(pred, ctxOf(sentence, nounOf(statement.subject, lexicon)), 'mark');
      (statement.mark === 'starts' ? starts : ends).push({ tla, words: sentence.text, sentence: sentence.id });
      continue;
    }
    if (statement.kind !== 'block') continue;
    const branch = statement.branches[0];
    const first = branch?.clauses[0];
    if (branch === undefined || first === undefined) continue;
    const named = new Set(refsOf(statement).filter(({ ref, position }) => position !== 'event' && !QUANTS.has(quantifier(ref))).map(({ ref }) => nounOf(ref, lexicon)));
    const ctx = ctxOf(sentence, nounOf(first.object, lexicon));
    const guards: MonitorStep['guards'] = [];
    for (const { pred, words } of stepPreds(statement)) guards.push({ tla: expr.predTla(pred, ctx, 'object state'), words: say(sentence, words) });
    if (statement.lead?.kind === 'when') guards.push({ tla: expr.condTla(statement.lead.cond, ctx, 'leading condition'), words: say(sentence, statement.lead.span) });
    if (statement.lead?.kind === 'after') guards.push({ tla: `after_${ident(nounOf(statement.lead.ref, lexicon))}`, words: say(sentence, statement.lead.span) });
    for (const clause of branch.clauses) {
      for (const slot of clause.slots) {
        const key = slotKey(slot);
        if (key === 'on' || key === 'after') guards.push({ tla: `${key}_${ident(nounOf(slot.ref, lexicon))}`, words: say(sentence, slot.span) });
      }
    }
    if (branch.guard !== null) guards.push({ tla: expr.condTla(branch.guard, ctx, 'condition'), words: say(sentence, [branch.guard.type === 'pred' ? branch.guard.pred.span[0] : branch.guard.span[0], branch.span[1]]) });
    const alternatives: MonitorStep['alternatives'] = [];
    for (const cite of view.cites) {
      const action = actionsByName.get(cite.action);
      if (action === undefined) continue;
      const free: string[] = [];
      const args = action.params.map((param) => {
        const variable = bindings.get(param.noun);
        if (variable !== undefined && named.has(param.noun) && !param.name.endsWith('_src')) return variable;
        const name = `wfx_${param.name}`;
        free.push(`${name} \\in ${param.set === 'BOOLEAN' ? 'BOOLEAN' : `Blocks!${param.set}`}`);
        return name;
      });
      const head = `Blocks!${action.name}${args.length === 0 ? '' : `(${args.join(', ')})`}`;
      alternatives.push({ action: action.name, sentence: action.sentence, call: free.length === 0 ? head : `\\E ${free.join(', ')} : ${head}` });
    }
    steps.push({ number: view.step ?? steps.length + 1, sentence: sentence.id, text: sentence.text, alternatives, guards });
  }
  const others = model.actions.map((action) => {
    const free = action.params.map((param) => `wfx_${param.name} \\in ${param.set === 'BOOLEAN' ? 'BOOLEAN' : `Blocks!${param.set}`}`);
    const head = `Blocks!${action.name}${action.params.length === 0 ? '' : `(${action.params.map((param) => `wfx_${param.name}`).join(', ')})`}`;
    return { action: action.name, sentence: action.sentence, call: free.length === 0 ? head : `\\E ${free.join(', ')} : ${head}` };
  });
  return { prefix, steps, starts, ends, bound, others };
}

export interface WorkflowModuleInput {
  /** The spec's module name: the monitor instances `<name>Blocks` as `Blocks`. */
  name: string;
  session: string;
  /** The blocks module's variables (blocksVariables): the monitor declares them and maps each to itself. */
  variables: readonly string[];
  workflows: readonly WorkflowCheck[];
}

export interface WorkflowModuleFiles {
  module: string;
  tla: string;
  /** One TLC config per ready workflow. */
  configs: { workflow: string; file: string; cfg: string; invariant: string }[];
}

function comment(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\(\*/g, '( *').replace(/\*\)/g, '* )').trim();
}

/** The definition a TLC config names to check a workflow up to step k (`W1_Before3`), or to its end (`W1_NotDone`). */
export function prefixInvariant(prefix: string, upTo?: number): string {
  return upTo === undefined ? `${prefix}_NotDone` : `${prefix}_Before${upTo}`;
}

export function workflowConfig(module: string, prefix: string, invariant: string): string {
  return [
    `\\* Written by clew spec workflow export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -config <this file> ${module}.tla`,
    `SPECIFICATION ${prefix}_Spec`,
    `INVARIANT ${invariant}`,
    'CHECK_DEADLOCK FALSE',
    '',
  ].join('\n');
}

/** The scenario monitors of every ready workflow, as one module that extends the agent's model. */
export function workflowModule(input: WorkflowModuleInput): WorkflowModuleFiles {
  const module = `${input.name}Workflows`;
  const ready = input.workflows.filter((workflow): workflow is WorkflowCheck & { monitor: WorkflowMonitor } => workflow.monitor !== undefined);
  const boundAll = new Map<string, { variable: string; set: string }>();
  for (const workflow of ready) for (const item of workflow.monitor.bound) boundAll.set(item.variable, { variable: item.variable, set: item.set });
  const extra = [...boundAll.keys()].sort();
  const wfVars = ['wf_pc', ...extra];
  const lines: string[] = [];
  const title = ` MODULE ${module} `;
  const side = Math.max(4, Math.floor((76 - title.length) / 2));
  lines.push(`${'-'.repeat(side)}${title}${'-'.repeat(side)}`);
  lines.push('(*');
  lines.push('  Written by clew spec workflow export. Do not edit: export again instead.');
  lines.push('');
  lines.push(`  Scenario monitors for the workflows of Clew session "${comment(input.session)}", run on the spec's`);
  lines.push(`  blocks module ${input.name}Blocks. This module declares the blocks module's variables itself and maps`);
  lines.push('  each to itself (Blocks == INSTANCE ... WITH v <- v), so a step\'s conditions read them directly.');
  lines.push('  wf_pc counts the steps a behaviour has taken. A step advances it only when the spec takes the action');
  lines.push('  the step names (Blocks!<action>), under the step\'s own conditions. Steps that are no spec action');
  lines.push('  (the environment) may happen between steps; another spec action may not, unless the workflow is');
  lines.push('  loose. A noun the workflow names without a quantifier is one instance (wf_<noun>) throughout.');
  lines.push('');
  lines.push('  <W>_NotDone is violated when the workflow completes: for a possible workflow that is the witness,');
  lines.push('  for a refused one it is the path that should not exist.');
  lines.push('*)');
  lines.push('EXTENDS Naturals, FiniteSets');
  lines.push('');
  lines.push(`\\* The variables of ${input.name}Blocks, by the same names.`);
  if (input.variables.length > 0) {
    lines.push(`VARIABLES ${input.variables.join(', ')}`);
    lines.push(`vars == <<${input.variables.join(', ')}>>`);
  } else {
    lines.push('vars == <<>>');
  }
  lines.push(`Blocks == INSTANCE ${input.name}Blocks${input.variables.length === 0 ? '' : ` WITH ${input.variables.map((variable) => `${variable} <- ${variable}`).join(', ')}`}`);
  lines.push('');
  lines.push(`VARIABLES ${wfVars.join(', ')}`);
  lines.push(`wf_vars == <<${wfVars.join(', ')}>>`);
  lines.push('');
  const configs: WorkflowModuleFiles['configs'] = [];
  for (const workflow of ready) {
    const { monitor } = workflow;
    const p = monitor.prefix;
    const own = new Set(monitor.bound.map((item) => item.variable));
    const keep = (vars: readonly string[]): string => (vars.length === 0 ? 'TRUE' : vars.length === 1 ? `UNCHANGED ${vars[0]}` : `UNCHANGED <<${vars.join(', ')}>>`);
    const setOf = (set: string): string => (set === 'BOOLEAN' ? 'BOOLEAN' : `Blocks!${set}`);
    lines.push(`\\* ${workflow.id}: "${comment(workflow.title)}" must be ${workflow.expect} (${workflow.mode}).`);
    for (const sentence of workflow.sentences) lines.push(`\\*   ${sentence.id}${sentence.step === undefined ? ` (${sentence.role})` : ` step ${sentence.step}`}: "${comment(sentence.text)}"`);
    lines.push(`${p}_Init ==`);
    lines.push('  /\\ Blocks!Init');
    lines.push('  /\\ wf_pc = 0');
    for (const variable of extra) {
      const item = boundAll.get(variable);
      if (item === undefined) continue;
      lines.push(own.has(variable) ? `  /\\ ${variable} \\in ${setOf(item.set)}` : `  /\\ ${variable} = CHOOSE i \\in ${setOf(item.set)} : TRUE   \\* not named by ${workflow.id}`);
    }
    for (const start of monitor.starts) lines.push(`  /\\ ${wrap(start.tla)}   \\* ${start.sentence}: "${comment(start.words)}"`);
    lines.push('');
    const stepNames: string[] = [];
    monitor.steps.forEach((step, index) => {
      step.alternatives.forEach((alternative) => {
        const name = `${p}_Step${step.number}_${alternative.action}`;
        stepNames.push(name);
        lines.push(`\\* ${step.sentence} step ${step.number} cites ${alternative.sentence} (${alternative.action}): "${comment(step.text)}"`);
        lines.push(`${name} ==`);
        lines.push(`  /\\ wf_pc = ${index}`);
        for (const guard of step.guards) lines.push(`  /\\ ${wrap(guard.tla)}   \\* "${comment(guard.words)}"`);
        lines.push('  /\\ Blocks!Next');
        lines.push(`  /\\ ${wrap(alternative.call)}`);
        lines.push(`  /\\ wf_pc' = ${index + 1}`);
        if (extra.length > 0) lines.push(`  /\\ ${keep(extra)}`);
        lines.push('');
      });
    });
    const total = monitor.steps.length;
    const otherNames: string[] = [];
    if (workflow.mode === 'loose') {
      lines.push('\\* loose: any other spec action may happen before, between, or after the steps, and leaves wf_pc alone.');
      for (const other of monitor.others) {
        const name = `${p}_Other_${other.action}`;
        otherNames.push(name);
        lines.push(`${name} == Blocks!Next /\\ ${wrap(other.call)} /\\ ${keep(wfVars)}`);
      }
    } else {
      lines.push('\\* exact: no spec action happens but the steps, in order.');
    }
    lines.push('\\* A step of the spec that is no spec action: the environment.');
    lines.push(`${p}_Env == Blocks!Next /\\ ~Blocks!Actions /\\ ${keep(wfVars)}`);
    lines.push('');
    lines.push(`${p}_Next ==`);
    for (const name of stepNames) lines.push(`  \\/ ${name}`);
    for (const name of otherNames) lines.push(`  \\/ ${name}`);
    lines.push(`  \\/ ${p}_Env`);
    lines.push('');
    lines.push(`${p}_Spec == ${p}_Init /\\ [][${p}_Next]_<<vars, wf_vars>>`);
    lines.push('');
    lines.push(`${p}_Done ==`);
    lines.push(`  /\\ wf_pc = ${total}`);
    for (const end of monitor.ends) lines.push(`  /\\ ${wrap(end.tla)}   \\* ${end.sentence}: "${comment(end.words)}"`);
    lines.push(`${prefixInvariant(p)} == ~${p}_Done`);
    for (let upTo = 1; upTo < (monitor.ends.length > 0 ? total + 1 : total); upTo += 1) lines.push(`${prefixInvariant(p, upTo)} == wf_pc < ${upTo}`);
    lines.push('');
    configs.push({ workflow: workflow.id, file: `${input.name}Workflow_${workflow.id}.cfg`, cfg: workflowConfig(module, p, prefixInvariant(p)), invariant: prefixInvariant(p) });
  }
  if (ready.length === 0) lines.push('\\* No workflow is ready to check.');
  lines.push('='.repeat(77));
  return { module, tla: `${lines.join('\n')}\n`, configs };
}

/** One conjunct: a disjunction or a quantifier is wrapped so it cannot reach past its line. */
function wrap(text: string): string {
  if (/^\\[AE] /.test(text) || /^~\(/.test(text)) return `(${text})`;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (depth === 0 && text.startsWith('\\/', index)) return `(${text})`;
  }
  return text;
}

/** `W1_Step2_ReviewOrder_s3_1` → workflow `w1`, step 2, spec action `ReviewOrder_s3_1`. */
export function stepOfName(name: string): { workflow: string; step: number; action: string } | undefined {
  const match = /^W([1-9][0-9]*)_Step([1-9][0-9]*)_(.+)$/.exec(name);
  if (match === null) return undefined;
  return { workflow: `w${match[1] ?? ''}`, step: Number(match[2]), action: match[3] ?? '' };
}

/** A workflow heading: "Happy path (possible)", "Approve first (refused, exact)". */
export function parseWorkflowHeading(title: string): { title: string; expect: WorkflowExpect; mode: WorkflowMode } | undefined {
  const match = /^(.*?)\s*\((possible|refused)(?:\s*,\s*(exact|loose))?\)\s*$/i.exec(title.trim());
  if (match === null) return undefined;
  return { title: (match[1] ?? '').trim(), expect: (match[2] ?? '').toLowerCase() as WorkflowExpect, mode: (match[3] ?? 'loose').toLowerCase() as WorkflowMode };
}
