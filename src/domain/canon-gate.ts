// The parse gate. A sentence either parses into a statement and passes every rule, or it is rejected with
// feedback: where parsing stopped, why, what was expected there, the nearest grammar form, and a draft
// rewrite. A rejected sentence is dangling: it never becomes an action, so it cannot reach the model.
// The draft is a proposal only. It is checked by the same gate and says what it guessed and what it left out.
import {
  applyEdits,
  lemma,
  nounOf,
  singular,
  slug,
  verbOf,
  type CanonLexicon,
  type Diagnostic,
  type Fix,
  type ParseOutput,
  type Statement,
  type TextEdit,
} from './canon-ast.js';
import { assignedStates, checkStatement } from './canon-rules.js';

export type ParseSentence = (text: string) => ParseOutput;

export interface GateInput {
  id: string;
  text: string;
}

export interface DraftRewrite {
  text: string;
  /** True when the draft passes the gate as it stands. */
  parses: boolean;
  rounds: number;
  notes: string[];
  /** Words the draft leaves out. Each must be restated in a slot or marked descriptive with a reason. */
  dropped: string[];
  /** The draft guesses something: read it before accepting it. */
  needsConfirm: boolean;
  /** The draft holds an upper-case placeholder to fill in. */
  needsInput: boolean;
  /** What still fails when the draft does not parse. */
  remaining: Diagnostic[];
}

export interface GateSentence {
  id: string;
  text: string;
  status: 'accepted' | 'dangling';
  statement?: Statement;
  diagnostics: Diagnostic[];
  draft?: DraftRewrite;
}

export interface GateResult {
  sentences: GateSentence[];
  /** Slugs of the states the spec assigns or declares. */
  known: string[];
}

export interface GateContext {
  lexicon: CanonLexicon;
  parse: ParseSentence;
  known: ReadonlySet<string>;
  /** `VERB|noun` → the states that step leaves the noun in, from the sentences that parse. */
  events: ReadonlyMap<string, readonly string[]>;
}

/** Parse and rule-check one sentence. Syntax failures come first; rules run only on a tree. */
export function gateSentence(text: string, context: GateContext): { statement: Statement | null; diagnostics: Diagnostic[] } {
  const parsed = context.parse(text);
  if (parsed.statement === null) return { statement: null, diagnostics: parsed.diagnostics };
  const diagnostics = checkStatement(parsed.statement, { lexicon: context.lexicon, known: context.known, text });
  return { statement: diagnostics.length === 0 ? parsed.statement : null, diagnostics };
}

/** The states a spec knows: declared ones, and every state some sentence assigns with "as". */
export function knownStates(texts: readonly string[], lexicon: CanonLexicon, parse: ParseSentence): Set<string> {
  const known = new Set<string>();
  for (const state of lexicon.states) known.add(slug(state));
  for (const text of texts) {
    const parsed = parse(text);
    if (parsed.statement !== null) {
      for (const state of assignedStates(parsed.statement)) known.add(state);
      continue;
    }
    // A sentence that does not parse yet still tells which words it uses as states.
    for (const match of text.matchAll(/ as (?:an? |the )?([A-Za-z][A-Za-z0-9-]*)/g)) {
      const word = match[1];
      if (word !== undefined) known.add(slug(word));
    }
  }
  return known;
}

export function runGate(inputs: readonly GateInput[], lexicon: CanonLexicon, parse: ParseSentence): GateResult {
  const known = knownStates(inputs.map((input) => input.text), lexicon, parse);
  const events = new Map<string, string[]>();
  const base: GateContext = { lexicon, parse, known, events };
  const first = inputs.map((input) => ({ input, result: gateSentence(input.text, base) }));
  for (const { result } of first) {
    if (result.statement?.kind !== 'block') continue;
    for (const branch of result.statement.branches) {
      for (const clause of branch.clauses) {
        if (clause.result === null) continue;
        const key = `${verbOf(clause.verb.text)}|${nounOf(clause.object, lexicon)}`;
        const states = events.get(key) ?? [];
        const state = clause.result.state.text;
        if (!states.includes(state)) states.push(state);
        events.set(key, states);
      }
    }
  }
  const sentences: GateSentence[] = [];
  for (const { input, result } of first) {
    if (result.statement !== null) {
      sentences.push({ id: input.id, text: input.text, status: 'accepted', statement: result.statement, diagnostics: [] });
      continue;
    }
    const sentence: GateSentence = { id: input.id, text: input.text, status: 'dangling', diagnostics: result.diagnostics };
    const draft = draftRewrite(input.text, base);
    if (draft !== undefined) sentence.draft = draft;
    sentences.push(sentence);
  }
  return { sentences, known: [...known].sort() };
}

const MAX_ROUNDS = 8;

/** One draft that applies every mechanical fix, round by round, until the gate accepts it or nothing more applies. */
export function draftRewrite(original: string, context: GateContext): DraftRewrite | undefined {
  let text = original;
  let rounds = 0;
  const notes: string[] = [];
  const dropped: string[] = [];
  let needsConfirm = false;
  let needsInput = false;
  let remaining: Diagnostic[] = [];
  let normalized = false;
  while (rounds < MAX_ROUNDS) {
    const result = gateSentence(text, context);
    remaining = result.diagnostics;
    if (remaining.length === 0) break;
    const fixes: Fix[] = [];
    const syntax = remaining.find((diagnostic) => diagnostic.severity === 'syntax');
    if (syntax !== undefined) {
      if (!normalized) {
        normalized = true;
        for (const fix of normalize(text, context)) fixes.push(fix);
      }
      if (fixes.length === 0) {
        const fix = syntaxFix(text, syntax, context);
        if (fix !== undefined) fixes.push(fix);
      }
    } else {
      for (const diagnostic of remaining) {
        if (diagnostic.fix !== undefined) fixes.push(diagnostic.fix);
      }
    }
    if (fixes.length === 0) break;
    const edits: TextEdit[] = [];
    for (const fix of fixes) {
      for (const edit of fix.edits) edits.push(edit);
    }
    const next = applyEdits(text, edits);
    if (next === text) break;
    for (const fix of fixes) {
      notes.push(fix.note);
      if (fix.dropped !== undefined && fix.dropped.trim() !== '') dropped.push(fix.dropped.trim());
      if (fix.confirm === true) needsConfirm = true;
      if (fix.open === true) needsInput = true;
    }
    text = next;
    rounds += 1;
    if (needsInput) {
      remaining = gateSentence(text, context).diagnostics;
      break;
    }
  }
  if (text === original) return undefined;
  const parses = !needsInput && remaining.length === 0;
  return { text, parses, rounds, notes, dropped, needsConfirm, needsInput, remaining: parses ? [] : remaining };
}

interface Rewrite {
  pattern: RegExp;
  put: (match: RegExpExecArray) => string;
  note: (match: RegExpExecArray) => string;
  confirm?: true;
}

/** Retired wording with a known replacement. Applied together, once, before any token-level repair. */
const REWRITES: readonly Rewrite[] = [
  { pattern: /\b(if|once)\b/gi, put: (m) => cased(m[0], 'when'), note: (m) => `rewrote "${m[0]}" as "when"` },
  { pattern: /\bunless\b([^,.]*?)\bis\b(?! not)/gi, put: (m) => `${cased(m[0], 'when')}${m[1] ?? ''}is not`, note: () => 'rewrote "unless ... is" as "when ... is not"' },
  { pattern: /\bare\b/gi, put: () => 'is', note: () => 'rewrote "are" as "is": a condition names one instance, or each, some, one or no instance' },
  { pattern: /\bevery\b/gi, put: (m) => cased(m[0], 'each'), note: () => 'rewrote "every" as "each"' },
  { pattern: /\bunder the same\b/gi, put: () => 'with the same', note: () => 'rewrote "under the same" as "with the same"' },
  { pattern: /\b(in|through)\b(?= (?:the |an? )?[A-Za-z])/gi, put: () => 'via', note: (m) => `rewrote "${m[0]}" as "via": confirm it names the system the action goes through`, confirm: true },
  { pattern: /\bat the\b/gi, put: () => 'for the whole', note: () => 'rewrote "at the" as "for the whole"' },
  { pattern: /\bfor a single\b/gi, put: () => 'for one', note: () => 'rewrote "for a single" as "for one"' },
  { pattern: /\bon a new\b/gi, put: () => 'on a', note: () => 'removed "new" after "on": an event is an occurrence not handled yet' },
  { pattern: /\b(must not|may not|can not|does not|do not|will not|should not)\b/gi, put: () => 'cannot', note: (m) => `rewrote "${m[0]}" as "cannot"` },
  { pattern: /\b(must|may|should|will) ([a-z]+)\b/gi, put: (m) => thirdPerson(m[2] ?? ''), note: (m) => `removed "${m[1] ?? ''}" and wrote "${thirdPerson(m[2] ?? '')}": the only modals are "can" and "cannot"` },
  { pattern: /\b(must|may|also|should|will)\b(?! not)/gi, put: () => '', note: (m) => `removed "${m[0]}": the only modals are "can" and "cannot"` },
];

/** `pack` → `packs`, `approve` → `approves`, `notify` → `notifies`, `be` stays. */
function thirdPerson(verb: string): string {
  if (/^(be|not|cannot|can)$/i.test(verb)) return verb;
  if (/(s|sh|ch|x|z|o)$/i.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

function cased(original: string, replacement: string): string {
  return /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

/** Spans of declared lexicon phrases. A rewrite never touches a word inside one. */
function protectedSpans(text: string, lexicon: CanonLexicon): [number, number][] {
  const spans: [number, number][] = [];
  const low = text.toLowerCase();
  for (const phrase of [...lexicon.states, ...lexicon.terms, ...lexicon.verbs, ...lexicon.actors]) {
    const needle = phrase.toLowerCase();
    if (needle === '') continue;
    let from = low.indexOf(needle);
    while (from >= 0) {
      spans.push([from, from + needle.length]);
      from = low.indexOf(needle, from + 1);
    }
  }
  return spans;
}

function normalize(text: string, context: GateContext): Fix[] {
  const fixes: Fix[] = [];
  const guarded = protectedSpans(text, context.lexicon);
  const taken: [number, number][] = [];
  const free = (start: number, end: number): boolean =>
    !guarded.some((span) => start < span[1] && end > span[0]) && !taken.some((span) => start < span[1] && end > span[0]);
  for (const fix of eventConditions(text, context)) {
    const edit = fix.edits[0];
    if (edit === undefined || !free(edit.at[0], edit.at[1])) continue;
    taken.push([edit.at[0], edit.at[1]]);
    fixes.push(fix);
  }
  for (const rewrite of REWRITES) {
    rewrite.pattern.lastIndex = 0;
    let match = rewrite.pattern.exec(text);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (free(start, end)) {
        taken.push([start, end]);
        const fix: Fix = { edits: [{ at: [start, end], put: rewrite.put(match) }], note: rewrite.note(match) };
        if (rewrite.confirm === true) fix.confirm = true;
        fixes.push(fix);
      }
      match = rewrite.pattern.exec(text);
    }
  }
  return fixes;
}

/**
 * "after the manager approves the order" names an event, and a condition is a state. The event is resolved
 * to the state that step leaves behind, when exactly one sentence states it; otherwise the draft asks for it.
 */
function eventConditions(text: string, context: GateContext): Fix[] {
  const fixes: Fix[] = [];
  if (context.lexicon.actors.length === 0) return fixes;
  const actors = context.lexicon.actors
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((actor) => actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pattern = new RegExp(`\\b(after|once|when|if)\\s+(?:the\\s+|an?\\s+)?(?:${actors})\\s+([A-Za-z-]+)\\s+(the\\s+|an?\\s+)?([A-Za-z][A-Za-z0-9-]*(?: [a-z][A-Za-z0-9-]*)?)(?=\\s*[,.]|\\s+and\\b|\\s+or\\b|$)`, 'gi');
  let match = pattern.exec(text);
  while (match !== null) {
    const marker = match[1] ?? 'when';
    const verb = match[2] ?? '';
    const object = (match[4] ?? '').trim();
    const pronoun = /^(it|them|this|that)$/i.test(object);
    const noun = pronoun ? '' : slug(singular(object));
    const states = context.events.get(`${lemma(verb).toUpperCase()}|${noun}`) ?? [];
    const state = states.length === 1 ? states[0] : undefined;
    const put = `${cased(marker, 'when')} the ${pronoun ? 'NOUN' : object} is ${state ?? 'STATE'}`;
    const fix: Fix = {
      edits: [{ at: [match.index, match.index + match[0].length], put }],
      note: state === undefined || pronoun
        ? `"${match[0]}" names an event: a condition is a state, so say which state that step leaves behind`
        : `rewrote the event "${match[0]}" as the state it leaves behind ("${state}"): confirm it`,
    };
    if (state === undefined || pronoun) fix.open = true;
    else fix.confirm = true;
    fixes.push(fix);
    match = pattern.exec(text);
  }
  return fixes;
}

const PRONOUN = /^(it|its|they|them|their|he|she|his|her|this|that|these|those)$/i;

/** A repair at the token the grammar stopped on, when the repair is mechanical. */
function syntaxFix(text: string, diagnostic: Diagnostic, context: GateContext): Fix | undefined {
  const [start, end] = diagnostic.span;
  const found = diagnostic.found.toLowerCase();
  const expects = (token: string): boolean => diagnostic.expected.includes(token);
  if (start >= text.length) {
    if (expects('"."')) return { edits: [{ at: [text.length, text.length], put: '.' }], note: 'added the closing period' };
    return undefined;
  }
  if (PRONOUN.test(found)) return undefined;
  if (found === 'again') {
    const period = text.lastIndexOf('.');
    const at = period >= 0 ? period : text.length;
    return {
      edits: [{ at: [start, end], put: '' }, { at: [at, at], put: ' when the NOUN is STATE' }],
      note: '"again" does not say which earlier state is meant: fill in the noun and its state',
      open: true,
    };
  }
  if (found === ',' && expects('"or"')) {
    return { edits: [{ at: [start, end], put: ' or' }], note: 'rewrote the comma as "or": a list of states is joined by "or"' };
  }
  if (found === ',') {
    const rest = text.slice(end).trimStart().toLowerCase().replace(/^(the|an?)\s+/, '');
    const actorNext = context.lexicon.actors.some((actor) => rest.startsWith(actor.toLowerCase()));
    if (actorNext) return { edits: [{ at: [start, end], put: ' and' }], note: 'rewrote the comma as "and": clauses of one step are joined by "and"' };
    return { edits: [{ at: [start, end], put: '' }], note: 'removed a comma: it only ends the leading condition or stands before "or" between two branches' };
  }
  if (found === 'or' && expects('","')) {
    return { edits: [{ at: [start, start], put: ', ' }], note: 'added the comma before "or": two branches are separated by ", or"' };
  }
  if (/^[a-z0-9'-]+$/i.test(diagnostic.found) && (expects('"."') || expects('"as"') || expects('"when"'))) {
    return {
      edits: [{ at: [start, end], put: '' }],
      dropped: diagnostic.found,
      note: `left out "${diagnostic.found}": the grammar has no slot for it here, so restate it in a slot or mark it descriptive with a reason`,
    };
  }
  return undefined;
}
