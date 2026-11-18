// The canonical sentence grammar's syntax tree. A parser (an adapter) builds it; everything above it
// (rules, drafts, actions, the TLA+ export) reads only this shape. Every node keeps the [start, end)
// character span of the words it came from, so each compiled guard and effect traces back to them.
//
//   statement = block | mark | invariant ;
//   block     = [ lead "," ] branch { "," "or" branch } "." ;
//   lead      = "when" cond | "after" plain ;
//   branch    = clause { "and" clause } [ "when" cond ] ;
//   clause    = [ [ art ] ACTOR [ "can" | "cannot" ] ] VERB ref { slot } [ "as" [ art ] STATE ] { slot } ;
//   slot      = ( "of" | "with" | "to" | "for" | "on" | "after" | "from" | "via" ) ref ;
//   cond      = all { "or" all } ;   all = unit { "and" unit } ;
//   unit      = pred | "either" pred "or" pred { "or" pred } ;
//   pred      = ref "is" [ "not" ] STATE { "or" STATE } ;
//   ref       = [ art ] [ qual ] [ STATE ] NOUN ;
//   mark      = [ art ] NOUN ( "starts" | "ends" ) "as" [ art ] STATE { "or" STATE } "." ;
//   invariant = ref "is" ( "always" [ "not" ] | "never" ) STATE { "or" STATE } [ "when" cond ] "." ;

export type Span = [start: number, end: number];

/** One token or one multi-word lexicon entry, as written. */
export interface Word {
  text: string;
  span: Span;
}

/** `[art] [qual] [STATE] NOUN`. `state` is every word between the qualifier and the noun. */
export interface Ref {
  span: Span;
  art: Word | null;
  qual: Word | null;
  state: Word | null;
  noun: Word;
  /** True when the noun is a declared multi-word term. */
  declared: boolean;
}

export interface Slot {
  span: Span;
  key: Word;
  ref: Ref;
}

export interface Pred {
  span: Span;
  subject: Ref;
  negated: boolean;
  states: Word[];
}

export type Cond =
  | { type: 'pred'; pred: Pred }
  | { type: 'and' | 'or'; span: Span; items: Cond[]; either?: boolean };

export interface Clause {
  span: Span;
  /** Null when the clause reuses the actor of an earlier clause. */
  actor: Word | null;
  modal: Word | null;
  verb: Word;
  /** Words between the verb and the object that the grammar has no place for. Always a rule violation. */
  extraVerbs: Word[];
  object: Ref;
  result: { span: Span; state: Word } | null;
  slots: Slot[];
}

export interface Branch {
  span: Span;
  clauses: Clause[];
  guard: Cond | null;
}

export type Lead = { kind: 'when'; span: Span; cond: Cond } | { kind: 'after'; span: Span; ref: Ref };

/** One sentence that states a whole action: one atomic step per branch. */
export interface Block {
  kind: 'block';
  span: Span;
  lead: Lead | null;
  branches: Branch[];
}

/** "The order starts as draft." / "The order ends as closed or cancelled." */
export interface Mark {
  kind: 'mark';
  span: Span;
  mark: 'starts' | 'ends';
  subject: Ref;
  states: Word[];
}

/** "The invoice is always paid when the order is shipped." */
export interface Invariant {
  kind: 'invariant';
  span: Span;
  pred: Pred;
  guard: Cond | null;
}

export type Statement = Block | Mark | Invariant;

/** One proposed change to the sentence text. Edits never overlap inside one fix. */
export interface TextEdit {
  at: Span;
  put: string;
}

export interface Fix {
  edits: TextEdit[];
  note: string;
  /** The rewrite guesses something the writer must confirm. */
  confirm?: true;
  /** The rewrite leaves a placeholder (an upper-case word) the writer must fill in. */
  open?: true;
  /** Words the rewrite leaves out. They must be restated in a slot or marked descriptive. */
  dropped?: string;
}

export interface Diagnostic {
  /** `syntax`: the grammar stopped here. `rule`: the tree parsed, and a rule above the grammar rejects it. */
  severity: 'syntax' | 'rule';
  code: string;
  message: string;
  span: Span;
  /** The words at the span. */
  found: string;
  /** What the parser or the rule would have accepted here. */
  expected: string[];
  /** The nearest grammar form. */
  form?: string;
  /** Where in the block: `branch 1, clause 2, object`. */
  where?: string;
  fix?: Fix;
}

/** What a spec declares so the grammar can read it. A state word needs no entry: the slot after "as" is the state. */
export interface CanonLexicon {
  actors: string[];
  /** Multi-word nouns. */
  terms: string[];
  /** Multi-word states. */
  states: string[];
  /** Multi-word verbs, in the base form: "sign off". */
  verbs: string[];
  /** Instances the exported module gives a noun. Default 2 for a noun with instances. */
  instances?: Record<string, number>;
  /** Abstract conditions that keep the state they start with: an attribute picked once, such as an order's total. */
  fixed?: string[];
}

export interface ParseOutput {
  /** Null when the grammar rejects the sentence. */
  statement: Statement | null;
  /** Syntax diagnostics only. Rules run on the tree afterwards. */
  diagnostics: Diagnostic[];
  /** The lexer's tokens, in order: the token type's name ("ACTOR", "TERM", "when", "Comma", ...) and its span. */
  tokens?: { type: string; span: Span }[];
}

export const KEYWORDS = {
  modal: ['can', 'cannot'],
  result: ['as'],
  article: ['the', 'a', 'an'],
  qualifier: ['new', 'same', 'each', 'some', 'one', 'no', 'whole'],
  slot: ['of', 'with', 'to', 'for', 'on', 'after', 'from', 'via'],
  logic: ['when', 'and', 'or', 'either', 'is', 'not'],
  declaration: ['starts', 'ends', 'always', 'never'],
} as const;

export const FORMS = {
  block: '[When COND,] CLAUSE {and CLAUSE} [when COND] {, or CLAUSE {and CLAUSE} [when COND]}.',
  clause: '[[The] ACTOR [can|cannot]] VERB REF {SLOT} as STATE {SLOT}',
  ref: '[the|a] [QUALIFIER] [STATE] NOUN, where NOUN is one word or a declared term and STATE is a state the spec assigns somewhere',
  slot: 'of [STATE] NOUN; with|to [the same|no] NOUN; for each [STATE] NOUN; for one NOUN; for the whole NOUN; on NOUN; after NOUN; from NOUN; via NOUN',
  pred: '[each|some|one|no] NOUN is [not] STATE {or STATE}',
  cond: 'PRED {and PRED} {or PRED {and PRED}}, or PRED and either PRED or PRED',
  mark: '[The] NOUN starts as STATE. | [The] NOUN ends as STATE {or STATE}.',
  invariant: '[The|each|no] NOUN is always [not] STATE {or STATE} [when COND]. | ... is never STATE ...',
} as const;

export function emptyLexicon(): CanonLexicon {
  return { actors: [], terms: [], states: [], verbs: [] };
}

/** `On Hold` → `on-hold`. The id of a noun, a state, or an actor. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** `approves` → `approve`, `tries` → `try`, `passes` → `pass`. Only the third-person ending is removed. */
export function lemma(verb: string): string {
  const low = verb.toLowerCase();
  if (/ies$/.test(low)) return `${low.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(low)) return low.slice(0, -2);
  if (/s$/.test(low) && !/ss$/.test(low)) return low.slice(0, -1);
  return low;
}

export function singular(word: string): string {
  return word !== word.toUpperCase() && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word;
}

/** The noun a reference names: a declared term as declared, any other word in the singular. */
export function nounOf(ref: Ref, lexicon: CanonLexicon): string {
  if (!ref.declared) return slug(singular(ref.noun.text));
  const text = ref.noun.text.toLowerCase().replace(/\s+/g, ' ');
  for (const term of lexicon.terms) {
    if (term.toLowerCase() === text || `${term.toLowerCase()}s` === text) return slug(term);
  }
  return slug(text);
}

/** `splits out` → `SPLIT_OUT`. */
export function verbOf(text: string): string {
  const words = text.toLowerCase().split(/\s+/);
  const first = words[0];
  if (first !== undefined) words[0] = lemma(first);
  return words.join('_').toUpperCase();
}

export function condSpan(cond: Cond): Span {
  return cond.type === 'pred' ? cond.pred.span : cond.span;
}

/** Every predicate of a condition, left to right. */
export function condPreds(cond: Cond | null): Pred[] {
  if (cond === null) return [];
  if (cond.type === 'pred') return [cond.pred];
  const found: Pred[] = [];
  for (const item of cond.items) {
    for (const pred of condPreds(item)) found.push(pred);
  }
  return found;
}

/** The slot keyword's meaning: "to" is a second spelling of "with". */
export function slotKey(slot: Slot): 'of' | 'with' | 'for' | 'on' | 'after' | 'from' | 'via' {
  const key = slot.key.text.toLowerCase();
  if (key === 'to') return 'with';
  if (key === 'of' || key === 'with' || key === 'for' || key === 'on' || key === 'after' || key === 'from' || key === 'via') return key;
  return 'with';
}

/** Apply edits right to left, skipping any that overlap one already applied, and tidy the spacing. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = edits.slice().sort((left, right) => right.at[0] - left.at[0] || right.at[1] - left.at[1]);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (edit.at[1] > floor) continue;
    out = out.slice(0, edit.at[0]) + edit.put + out.slice(edit.at[1]);
    floor = edit.at[0];
  }
  return out.replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1').replace(/,(\S)/g, ', $1').trim();
}
