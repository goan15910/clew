// Highlighting for canonical sentences, read off the same lexer and tree the gate uses, so the colours can never
// disagree with the parser. Two layers, like a language server's syntax and semantic tokens:
//
//   * lexical: every lexer token gets a class from its token type alone (keyword family, declared lexicon entry,
//     plain word, punctuation). This is all a sentence that does not parse can get.
//   * semantic: a parsed sentence overrides that with the role each word plays in the tree: the actor, the verb
//     (the TLA+ action), the object (a variable), the state it starts from, the state it is left in, the guard.
//
// Spans are character offsets into the sentence, [start, end).
import { condSpan, KEYWORDS, type Cond, type Diagnostic, type ParseOutput, type Pred, type Ref, type Span, type Statement, type Word } from './canon-ast.js';

/** One role per word. The names double as CSS classes (`cnl-` + role, dots as dashes). */
export type HighlightRole =
  | 'actor'
  | 'modal.permit' // can: a permission, adds nothing to the model
  | 'modal.refuse' // cannot: a refusal, compiles to an action property
  | 'verb' // the event: names the TLA+ action
  | 'verb.extra' // a second verb the grammar has no place for
  | 'noun' // the object the clause moves: a status variable
  | 'noun.subject' // the noun a condition, mark, or invariant talks about
  | 'noun.link' // with / to: a link to another object
  | 'noun.slot' // of / for / on / after / from / via
  | 'state.pre' // "the submitted order": the state the object must be in
  | 'state.post' // "as approved": the state the step leaves it in
  | 'state.test' // a state a condition or invariant tests
  | 'state.init' // starts as
  | 'state.final' // ends as
  | 'quantifier' // each / some / one / no / same / new / whole
  | 'article'
  | 'kw.guard' // when
  | 'kw.effect' // as
  | 'kw.branch' // ", or" between the branches of a block
  | 'kw.join' // "and" between clauses: one atomic step
  | 'kw.logic' // and / or / either inside a condition
  | 'kw.is'
  | 'kw.not'
  | 'kw.slot'
  | 'kw.decl' // starts / ends
  | 'kw.always'
  | 'kw.never'
  | 'kw.after' // "After NOUN," lead
  | 'term' // a declared multi-word term the tree did not place
  | 'word' // a plain word the tree did not place
  | 'punct';

export interface HighlightToken {
  span: Span;
  text: string;
  role: HighlightRole;
  /** The lexer's token type: what a lexical highlighter sees. */
  lexical: HighlightRole;
  /** 1-based branch number inside a block, when the token belongs to a branch. */
  branch?: number;
  /** True for a declared multi-word lexicon entry (one token, several words). */
  declared?: boolean;
}

export interface HighlightRegion {
  kind: 'guard' | 'branch' | 'lead' | 'sep' | 'clause';
  span: Span;
  branch?: number;
  /** 1-based clause number inside its branch, for a clause region. */
  clause?: number;
}

export interface HighlightNote {
  severity: 'syntax' | 'rule';
  code: string;
  message: string;
  span: Span;
  expected: string[];
}

export interface HighlightedSentence {
  text: string;
  kind: Statement['kind'] | 'dangling';
  tokens: HighlightToken[];
  regions: HighlightRegion[];
  notes: HighlightNote[];
}

const LOGIC = new Set<string>(['and', 'or', 'either']);
const QUALIFIERS = new Set<string>(KEYWORDS.qualifier);
const ARTICLES = new Set<string>(KEYWORDS.article);
const SLOTS = new Set<string>(KEYWORDS.slot);

/** The class a lexer token type gets on its own. Keyword token types are named after the keyword. */
export function lexicalRole(type: string, text: string): HighlightRole {
  const low = text.toLowerCase();
  switch (type) {
    case 'ACTOR':
      return 'actor';
    case 'VERB':
      return 'verb';
    case 'STATE':
      return 'state.test';
    case 'TERM':
      return 'term';
    case 'Comma':
    case 'Period':
      return 'punct';
    case 'PLAIN_WORD':
      return 'word';
    default:
      break;
  }
  if (low === 'can') return 'modal.permit';
  if (low === 'cannot') return 'modal.refuse';
  if (low === 'when') return 'kw.guard';
  if (low === 'as') return 'kw.effect';
  if (low === 'is') return 'kw.is';
  if (low === 'not') return 'kw.not';
  if (low === 'always') return 'kw.always';
  if (low === 'never') return 'kw.never';
  if (low === 'starts' || low === 'ends') return 'kw.decl';
  if (LOGIC.has(low)) return 'kw.logic';
  if (ARTICLES.has(low)) return 'article';
  if (QUALIFIERS.has(low)) return 'quantifier';
  if (SLOTS.has(low)) return 'kw.slot';
  return 'word';
}

function within(span: Span, outer: Span): boolean {
  return span[0] >= outer[0] && span[1] <= outer[1];
}

/** Walk the tree and record a role for each word span it holds. Keywords between words are resolved after. */
function semanticRoles(statement: Statement): { roles: Map<string, HighlightRole>; regions: HighlightRegion[]; guards: Span[]; branches: Span[]; joins: Span[] } {
  const roles = new Map<string, HighlightRole>();
  const regions: HighlightRegion[] = [];
  const guards: Span[] = [];
  const branches: Span[] = [];
  const joins: Span[] = [];
  const put = (word: Word | { span: Span } | null | undefined, role: HighlightRole): void => {
    if (word === null || word === undefined) return;
    roles.set(`${word.span[0]}:${word.span[1]}`, role);
  };
  const ref = (node: Ref, noun: HighlightRole, state: HighlightRole): void => {
    put(node.art, 'article');
    put(node.qual, 'quantifier');
    put(node.state, state);
    put(node.noun, noun);
  };
  const pred = (node: Pred): void => {
    ref(node.subject, 'noun.subject', 'state.pre');
    for (const state of node.states) put(state, 'state.test');
  };
  const cond = (node: Cond): void => {
    if (node.type === 'pred') pred(node.pred);
    else for (const item of node.items) cond(item);
  };
  const guard = (node: Cond, start: number, branch?: number): void => {
    const span: Span = [start, condSpan(node)[1]];
    guards.push(span);
    regions.push(branch === undefined ? { kind: 'guard', span } : { kind: 'guard', span, branch });
    cond(node);
  };
  if (statement.kind === 'mark') {
    ref(statement.subject, 'noun.subject', 'state.pre');
    for (const state of statement.states) put(state, statement.mark === 'starts' ? 'state.init' : 'state.final');
  } else if (statement.kind === 'invariant') {
    pred(statement.pred);
    if (statement.guard !== null) guard(statement.guard, statement.pred.span[1]);
  } else {
    if (statement.lead !== null) {
      regions.push({ kind: 'lead', span: statement.lead.span });
      if (statement.lead.kind === 'when') guard(statement.lead.cond, statement.lead.span[0]);
      else ref(statement.lead.ref, 'noun.slot', 'state.pre');
    }
    statement.branches.forEach((branch, index) => {
      branches.push(branch.span);
      if (statement.branches.length > 1) regions.push({ kind: 'branch', span: branch.span, branch: index + 1 });
      branch.clauses.forEach((clause, clauseIndex) => {
        regions.push({ kind: 'clause', span: clause.span, branch: index + 1, clause: clauseIndex + 1 });
        if (clauseIndex > 0) {
          const previous = branch.clauses[clauseIndex - 1];
          if (previous !== undefined) joins.push([previous.span[1], clause.span[0]]);
        }
        put(clause.actor, 'actor');
        if (clause.modal !== null) put(clause.modal, clause.modal.text.toLowerCase() === 'cannot' ? 'modal.refuse' : 'modal.permit');
        put(clause.verb, 'verb');
        for (const extra of clause.extraVerbs) put(extra, 'verb.extra');
        ref(clause.object, 'noun', 'state.pre');
        if (clause.result !== null) put(clause.result.state, 'state.post');
        for (const slot of clause.slots) {
          put(slot.key, 'kw.slot');
          const key = slot.key.text.toLowerCase();
          ref(slot.ref, key === 'with' || key === 'to' ? 'noun.link' : 'noun.slot', 'state.pre');
        }
      });
      if (branch.guard !== null) {
        const last = branch.clauses[branch.clauses.length - 1];
        guard(branch.guard, last?.span[1] ?? branch.span[0], statement.branches.length > 1 ? index + 1 : undefined);
      }
    });
  }
  return { roles, regions, guards, branches, joins };
}

/** A keyword the tree does not hold as a word: its role follows from where it sits. */
function keywordRole(token: { span: Span; text: string }, lexical: HighlightRole, tree: ReturnType<typeof semanticRoles>, next: { text: string } | undefined, previous: { text: string } | undefined): HighlightRole {
  const low = token.text.toLowerCase();
  const inGuard = tree.guards.some((guard) => within(token.span, guard));
  const inBranch = tree.branches.some((branch) => within(token.span, branch));
  if (!inGuard && !inBranch && tree.branches.length > 1) {
    // Between two branches: ", or".
    if (token.text === ',' && next?.text.toLowerCase() === 'or') return 'kw.branch';
    if (low === 'or' && previous?.text === ',') return 'kw.branch';
  }
  if (low === 'and' && !inGuard && tree.joins.some((join) => within(token.span, join))) return 'kw.join';
  if (low === 'after' && !inBranch) return 'kw.after';
  if (low === 'when') return 'kw.guard';
  return lexical;
}

/**
 * Highlight one sentence from the parser's output. Pass `notes` to add rule diagnostics the gate found above
 * the grammar; syntax diagnostics come from the parse itself.
 */
export function highlightSentence(text: string, parsed: ParseOutput, rules: readonly Diagnostic[] = []): HighlightedSentence {
  const lexed = (parsed.tokens ?? []).map((token) => {
    const piece = text.slice(token.span[0], token.span[1]);
    return { span: token.span, text: piece, type: token.type, lexical: lexicalRole(token.type, piece) };
  });
  const notes: HighlightNote[] = [...parsed.diagnostics, ...rules].map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    span: diagnostic.span,
    expected: diagnostic.expected,
  }));
  const statement = parsed.statement;
  if (statement === null) {
    return {
      text,
      kind: 'dangling',
      tokens: lexed.map((token) => ({ span: token.span, text: token.text, role: token.lexical, lexical: token.lexical, ...(token.type === 'TERM' || token.type === 'STATE' || token.type === 'ACTOR' ? { declared: token.text.includes(' ') } : {}) })),
      regions: [],
      notes,
    };
  }
  const tree = semanticRoles(statement);
  const tokens: HighlightToken[] = [];
  // A tree word can cover several lexer tokens ("the submitted order": the state is every word before the noun).
  const covered = new Map<number, { span: Span; role: HighlightRole }>();
  for (const [key, role] of tree.roles) {
    const [start, end] = key.split(':').map(Number) as [number, number];
    covered.set(start, { span: [start, end], role });
  }
  let index = 0;
  while (index < lexed.length) {
    const token = lexed[index];
    if (token === undefined) break;
    const hit = covered.get(token.span[0]);
    const branch = tree.branches.findIndex((span) => within(token.span, span));
    const branchNumber = tree.branches.length > 1 && branch >= 0 ? branch + 1 : undefined;
    if (hit !== undefined) {
      // Merge the lexer tokens the word covers into one highlighted token.
      let last = index;
      while (last + 1 < lexed.length && (lexed[last + 1]?.span[1] ?? Infinity) <= hit.span[1]) last += 1;
      const lexical = lexed.slice(index, last + 1).map((piece) => piece.lexical);
      tokens.push({
        span: hit.span,
        text: text.slice(hit.span[0], hit.span[1]),
        role: hit.role,
        lexical: lexical.length === 1 ? (lexical[0] ?? 'word') : 'word',
        ...(branchNumber !== undefined ? { branch: branchNumber } : {}),
        ...(lexed.slice(index, last + 1).some((piece) => piece.type === 'TERM' || piece.type === 'STATE' || piece.type === 'ACTOR' || piece.type === 'VERB') && hit.span[1] - hit.span[0] > 0 && text.slice(hit.span[0], hit.span[1]).includes(' ') ? { declared: true } : {}),
      });
      index = last + 1;
      continue;
    }
    const role = keywordRole(token, token.lexical, tree, lexed[index + 1], lexed[index - 1]);
    tokens.push({ span: token.span, text: token.text, role, lexical: token.lexical, ...(branchNumber !== undefined ? { branch: branchNumber } : {}) });
    index += 1;
  }
  // The ", or" between two branches is one separator.
  tokens.forEach((token, at) => {
    const next = tokens[at + 1];
    if (token.role === 'kw.branch' && token.text === ',' && next?.role === 'kw.branch') tree.regions.push({ kind: 'sep', span: [token.span[0], next.span[1]] });
  });
  // Snap each region to the tokens it holds, so a renderer can open and close it on token edges.
  const regions = tree.regions.map((region) => {
    const inside = tokens.filter((token) => token.span[0] >= region.span[0] && token.span[1] <= region.span[1]);
    const first = inside[0];
    const last = inside[inside.length - 1];
    return first === undefined || last === undefined ? region : { ...region, span: [first.span[0], last.span[1]] as Span };
  });
  return { text, kind: statement.kind, tokens, regions, notes };
}
