// Rules that sit above the grammar: which qualifiers and state words each position admits, known states,
// pronouns, the required result, and the block rules (a refusal stands alone, one step sets an object once).
// They run on the typed tree and report every violation, not the first. A violation carries a fix when
// the rewrite is mechanical; a fix that guesses is marked `confirm`.
import {
  condPreds,
  FORMS,
  lemma,
  nounOf,
  slotKey,
  slug,
  type Block,
  type Branch,
  type CanonLexicon,
  type Clause,
  type Diagnostic,
  type Fix,
  type Pred,
  type Ref,
  type Span,
  type Statement,
} from './canon-ast.js';

type Position = 'object' | 'of' | 'with' | 'for' | 'on' | 'after' | 'from' | 'via' | 'subject';

/** Which qualifiers a position accepts ('' is none), and after which of them a state word may stand. */
export const ADMITS: Record<Position, { quals: readonly string[]; state: readonly string[] }> = {
  object: { quals: ['', 'new', 'each', 'one'], state: ['', 'each', 'one'] },
  of: { quals: [''], state: [''] },
  with: { quals: ['', 'same', 'no'], state: [] },
  for: { quals: ['each', 'one', 'whole'], state: ['each'] },
  on: { quals: [''], state: [] },
  after: { quals: [''], state: [] },
  from: { quals: [''], state: [] },
  via: { quals: [''], state: [] },
  subject: { quals: ['', 'each', 'some', 'one', 'no'], state: [] },
};

const PRONOUN = /^(it|its|they|them|their|he|she|his|her|this|that|these|those)$/i;
/** Modals the grammar retired. Null: the word compiled to nothing and is dropped. */
const RETIRED_MODAL: Record<string, string | null> = { must: null, may: null, also: null, should: null, will: null, never: 'cannot' };
const RETIRED_QUANT: Record<string, string> = { every: 'each', all: 'each', any: 'some', single: 'one' };

export interface RuleContext {
  lexicon: CanonLexicon;
  /** Slugs of the states the spec assigns somewhere, plus the declared ones. */
  known: ReadonlySet<string>;
  text: string;
}

export function checkStatement(statement: Statement, context: RuleContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { text } = context;
  const say = (span: Span): string => text.slice(span[0], span[1]);
  const add = (code: string, span: Span, message: string, expected: string[], where: string, form: string, fix?: Fix): void => {
    const diagnostic: Diagnostic = { severity: 'rule', code, message, span, found: say(span), expected, form, where };
    if (fix !== undefined) diagnostic.fix = fix;
    out.push(diagnostic);
  };
  const drop = (span: Span, note?: string): Fix => ({
    edits: [{ at: span, put: '' }],
    dropped: say(span),
    note: note ?? `left out "${say(span)}": restate it in a slot, or mark it descriptive with a reason`,
  });

  const actors = new Set(context.lexicon.actors.map((actor) => actor.toLowerCase()));
  const nouns = collectRefs(statement)
    .map((ref) => ({ span: ref.span, noun: text.slice(ref.noun.span[0], ref.noun.span[1]).toLowerCase() }))
    .filter((item) => !actors.has(item.noun));
  const checkRef = (ref: Ref, position: Position, where: string, whole: Span, branch: Branch | null): void => {
    const admits = ADMITS[position];
    const shown = say(whole);
    for (const piece of say(ref.span).split(/\s+/)) {
      if (PRONOUN.test(piece)) {
        // One candidate noun named before the pronoun: the draft names it, and asks for confirmation.
        const before = nouns.filter((item) => item.span[1] <= ref.span[0] && !PRONOUN.test(item.noun));
        const candidates = [...new Set(before.map((item) => item.noun))];
        const only = candidates.length === 1 && /^(it|them|this|that|these|those)$/i.test(piece) && say(ref.span).trim().toLowerCase() === piece.toLowerCase() ? candidates[0] : undefined;
        const fix: Fix | undefined = only === undefined ? undefined : { edits: [{ at: ref.span, put: `the ${only}` }], note: `rewrote "${piece}" as "the ${only}": confirm it means that ${only}`, confirm: true };
        add('pronoun', ref.span, `"${shown}" uses "${piece}": name the thing itself`, ['NOUN'], where, FORMS.ref, fix);
        return;
      }
    }
    if (ref.noun.text.toLowerCase() === 'again') {
      // "the order again" reads "again" as the noun: it does not say which earlier state is meant.
      const period = text.lastIndexOf('.');
      const at = period >= 0 ? period : text.length;
      add('again', ref.noun.span, '"again" does not say which earlier state is meant', ['when the NOUN is STATE'], where, FORMS.ref, {
        edits: [{ at: [ref.noun.span[0] - 1, ref.noun.span[1]], put: '' }, { at: [at, at], put: ' when the NOUN is STATE' }],
        note: '"again" does not say which earlier state is meant: fill in the noun and its state',
        open: true,
      });
      return;
    }
    const qual = ref.qual?.text.toLowerCase() ?? '';
    const prefix = position === 'object' || position === 'subject' ? '' : `${position} `;
    const forms = admits.quals.map((item) => `${prefix}${item === 'same' || item === 'whole' ? 'the ' : ''}${item === '' ? '' : `${item} `}NOUN`);
    if (ref.state !== null) {
      const first = ref.state.text.split(/\s+/)[0]?.toLowerCase() ?? '';
      const by = RETIRED_QUANT[first];
      if (by !== undefined && ref.qual === null) {
        const span: Span = [ref.state.span[0], ref.state.span[0] + first.length];
        add('retired-word', span, `"${first}" is written "${by}"`, admits.quals.filter((item) => item !== ''), where, FORMS.ref, { edits: [{ at: span, put: by }], note: `rewrote "${first}" as "${by}"` });
        return;
      }
    }
    if (!admits.quals.includes(qual)) {
      if (qual === 'some' && admits.quals.includes('one') && ref.qual !== null) {
        add('qualifier', ref.qual.span, `"${shown}": "some" means at least one and only stands in a condition; here the action takes exactly one ("one") or all ("each")`, forms, where, FORMS.slot, {
          edits: [{ at: ref.qual.span, put: 'one' }],
          note: `rewrote "some" as "one" in "${shown}": confirm that exactly one is meant`,
          confirm: true,
        });
      } else if (position === 'for' && qual === '') {
        const key: Span = [whole[0], whole[0] + 3];
        add('qualifier', whole, `"${shown}" does not say which instances: "for" takes each, one or whole`, [...forms, 'with NOUN (a link, not a scope)'], where, FORMS.slot, {
          edits: [{ at: key, put: 'with' }],
          note: `drafted "${shown}" as a link ("with"): confirm it is not a scope`,
          confirm: true,
        });
      } else if (qual === 'new' && ref.qual !== null && position !== 'object') {
        add('qualifier', ref.qual.span, `"${shown}": "new" only creates the object of a clause`, forms, where, FORMS.slot, { edits: [{ at: ref.qual.span, put: '' }], note: `removed "new" from "${shown}"` });
      } else {
        add('qualifier', ref.qual?.span ?? whole, `"${shown}": "${qual}" is not accepted here`, forms, where, FORMS.slot, position === 'object' || position === 'subject' ? undefined : drop(whole));
      }
      return;
    }
    if (ref.state === null) return;
    const state = slug(ref.state.text);
    const unknown = !context.known.has(state);
    if (position === 'object' && !unknown && qual === 'new') {
      add('state-word', ref.state.span, `"${shown}": a new object has no earlier state`, ['new NOUN'], where, FORMS.ref, drop(ref.state.span, `removed "${ref.state.text}": a new object has no earlier state`));
      return;
    }
    if (unknown) {
      const expected = [...admits.quals.filter((item) => item !== ''), ...(admits.state.length > 0 ? ['a known state'] : []), 'nothing'];
      const message = `"${ref.state.text.toLowerCase()}" before "${ref.noun.text}" is not a qualifier and not a state the spec assigns`;
      if (position === 'object' && branch !== null) {
        const end = branch.span[1];
        const joiner = branch.guard === null ? ' when ' : ' and ';
        add('unknown-state', ref.state.span, message, expected, where, FORMS.ref, {
          edits: [{ at: ref.state.span, put: '' }, { at: [end, end], put: `${joiner}the ${ref.noun.text} is ${ref.state.text.toLowerCase()}` }],
          note: `moved "${ref.state.text}" into a condition: confirm it is a state, or declare it`,
          confirm: true,
        });
      } else {
        add('unknown-state', ref.state.span, message, expected, where, FORMS.ref, drop(ref.state.span));
      }
      return;
    }
    if (!admits.state.includes(qual)) {
      add('state-word', ref.state.span, `"${shown}": a state word is not accepted here`, [...admits.quals.filter((item) => item !== ''), 'nothing'], where, FORMS.ref, drop(ref.state.span));
    }
  };

  const checkPreds = (preds: readonly Pred[], where: string): void => {
    preds.forEach((pred, index) => {
      checkRef(pred.subject, 'subject', `${where}, predicate ${index + 1}`, pred.subject.span, null);
    });
  };

  if (statement.kind === 'mark') {
    if (statement.subject.state !== null) {
      add('mark-subject', statement.subject.span, `"${say(statement.subject.span)}": a ${statement.mark} mark names one noun (declare a multi-word noun as a term)`, ['NOUN starts as STATE'], 'mark', FORMS.mark);
    }
    return out;
  }
  if (statement.kind === 'invariant') {
    checkRef(statement.pred.subject, 'subject', 'invariant', statement.pred.subject.span, null);
    checkPreds(condPreds(statement.guard), 'invariant condition');
    return out;
  }

  const block: Block = statement;
  if (block.lead?.kind === 'after') checkRef(block.lead.ref, 'after', 'leading event', block.lead.span, null);
  if (block.lead?.kind === 'when') checkPreds(condPreds(block.lead.cond), 'leading condition');

  let actorSeen = false;
  const refusals = block.branches.some((branch) => branch.clauses.some((clause) => clause.modal?.text.toLowerCase() === 'cannot'));
  if (refusals && (block.branches.length > 1 || (block.branches[0]?.clauses.length ?? 0) > 1)) {
    add('refusal', block.span, 'a refusal stands alone: "cannot" does not combine with "and" or ", or"', ['ACTOR cannot VERB REF [when COND].'], 'block', FORMS.block);
  }
  block.branches.forEach((branch, branchIndex) => {
    const set = new Map<string, Clause>();
    branch.clauses.forEach((clause, clauseIndex) => {
      const where = `branch ${branchIndex + 1}, clause ${clauseIndex + 1}`;
      if (clause.actor !== null) actorSeen = true;
      const verb = clause.verb.text.toLowerCase();
      if (!actorSeen) {
        add('actor', clause.verb.span, `a block starts with a declared actor, and "${clause.verb.text}" is not one`, context.lexicon.actors.slice(), where, FORMS.clause);
        actorSeen = true;
      } else if (clause.extraVerbs.length > 0) {
        const last = clause.extraVerbs[clause.extraVerbs.length - 1];
        const lead: Span = [clause.verb.span[0], last?.span[0] ?? clause.verb.span[1]];
        if (verb in RETIRED_MODAL) {
          const by = RETIRED_MODAL[verb] ?? null;
          add('retired-word', clause.verb.span, by === null ? `"${verb}" has no modelled meaning: the only modals are "can" and "cannot"` : `"${verb}" is written "${by}"`, ['can', 'cannot', 'VERB'], where, FORMS.clause, by === null
            ? { edits: [{ at: clause.verb.span, put: '' }], note: `removed "${clause.verb.text}": it compiled to nothing` }
            : { edits: [{ at: clause.verb.span, put: by }], note: `rewrote "${clause.verb.text}" as "${by}"` });
        } else {
          const words = [clause.verb, ...clause.extraVerbs].map((item) => item.text).join(' ');
          add('extra-verb', lead, `exactly one verb goes between the actor and the object, found "${words}"`, ['VERB REF'], where, FORMS.clause, drop([lead[0], lead[1]], `left out "${say(lead).trim()}": an adverb has no slot`));
        }
      }
      checkRef(clause.object, 'object', `${where}, object`, clause.object.span, branch);
      const object = nounOf(clause.object, context.lexicon);
      clause.slots.forEach((slot, slotIndex) => {
        const key = slotKey(slot);
        const slotWhere = `${where}, slot ${slotIndex + 1} (${key})`;
        if (key === 'from' && !slot.ref.declared && slot.ref.state === null && slot.ref.qual === null && context.known.has(slug(slot.ref.noun.text))) {
          const noun = say(clause.object.noun.span);
          add('from-state', slot.span, `"${say(slot.span)}" names a state: an earlier state is written as a state word before the object`, [`the ${slot.ref.noun.text} ${noun}`, `when the ${noun} is ${slot.ref.noun.text}`], slotWhere, FORMS.ref, {
            edits: [{ at: slot.span, put: '' }, { at: [clause.object.noun.span[0], clause.object.noun.span[0]], put: `${slot.ref.noun.text} ` }],
            note: `rewrote "${say(slot.span)}" as a state word before the object`,
          });
          return;
        }
        checkRef(slot.ref, key, slotWhere, slot.span, branch);
      });
      const refusal = clause.modal?.text.toLowerCase() === 'cannot';
      if (clause.result === null && !refusal) {
        const stem = lemma(verb.split(/\s+/)[0] ?? verb);
        const guess = /e$/.test(stem) ? `${stem}d` : `${stem}ed`;
        const end = clause.span[1];
        add('missing-result', [end, end], 'the clause does not say which state the object ends in', ['as STATE'], `${where}, result`, FORMS.clause, {
          edits: [{ at: [end, end], put: ` as ${guess}` }],
          note: `guessed the state "${guess}" from the verb: confirm it`,
          confirm: true,
        });
      }
      if (clause.result !== null && refusal) {
        add('refusal', clause.result.span, 'a refusal names no result: it says what cannot happen, not where the object ends', ['ACTOR cannot VERB REF [when COND].'], `${where}, result`, FORMS.clause, {
          edits: [{ at: clause.result.span, put: '' }],
          note: `removed "${say(clause.result.span)}" from the refusal`,
        });
      }
      if (clause.result !== null && !refusal) {
        const earlier = set.get(object);
        const bulk = clause.object.qual?.text.toLowerCase() === 'each' || earlier?.object.qual?.text.toLowerCase() === 'each';
        if (earlier !== undefined && !bulk) {
          add('conflict', clause.span, `one step sets "${object}" twice, to "${earlier.result?.state.text ?? ''}" and "${clause.result.state.text}": alternatives are branches after ", or"`, ['CLAUSE, or CLAUSE'], where, FORMS.block);
        } else {
          set.set(object, clause);
        }
      }
    });
    checkPreds(condPreds(branch.guard), `branch ${branchIndex + 1}, condition`);
  });
  return out.sort((left, right) => left.span[0] - right.span[0]);
}

/** The states a statement assigns: the result of each clause, and the states of a mark. */
export function assignedStates(statement: Statement): string[] {
  const found: string[] = [];
  if (statement.kind === 'mark') {
    for (const state of statement.states) found.push(slug(state.text));
    return found;
  }
  if (statement.kind === 'invariant') return found;
  for (const branch of statement.branches) {
    for (const clause of branch.clauses) {
      if (clause.result !== null) found.push(slug(clause.result.state.text));
    }
  }
  return found;
}

/** Every noun reference in a statement, in no particular order. */
function collectRefs(value: unknown, out: Ref[] = []): Ref[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('noun' in record && 'declared' in record && 'span' in record) out.push(record as unknown as Ref);
    for (const key of Object.keys(record)) if (key !== 'noun') collectRefs(record[key], out);
  }
  return out;
}
