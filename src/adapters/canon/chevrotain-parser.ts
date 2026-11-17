// The only file that imports chevrotain. The canonical grammar (src/domain/canon-ast.ts) as a lexer built
// per lexicon and a parser that builds the typed tree directly. The grammar is strict: a sentence parses or
// it is rejected at the first token the grammar has no place for, with the tokens it would have accepted.
import { createToken, createTokenInstance, EmbeddedActionsParser, EOF, Lexer, tokenMatcher, type IToken, type TokenType } from 'chevrotain';
import type { CanonParser, CanonParserFactory } from '../../application/ports.js';
import {
  condSpan,
  FORMS,
  KEYWORDS,
  type Block,
  type Branch,
  type CanonLexicon,
  type Clause,
  type Cond,
  type Diagnostic,
  type Invariant,
  type Lead,
  type Mark,
  type ParseOutput,
  type Pred,
  type Ref,
  type Slot,
  type Span,
  type Statement,
  type Word,
} from '../../domain/canon-ast.js';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function longestFirst(items: readonly string[]): string[] {
  return items.slice().sort((left, right) => right.length - left.length);
}

const WORD_END = '(?![A-Za-z0-9-])';

/** A pattern that never matches. Each token type needs its own, so the name is part of it. */
function never(name: string): string {
  return `(?!)${name}`;
}

function alternatives(items: readonly string[], suffix: string, name: string): string {
  if (items.length === 0) return never(name);
  const parts = longestFirst(items).map((item) => escapeRegExp(item.trim()).replace(/ +/g, '\\s+'));
  return `(?:${parts.join('|')})${suffix}${WORD_END}`;
}

/** A declared verb is inflected on its first word: "sign off" also matches "signs off". */
function verbPattern(verbs: readonly string[]): string {
  const multi = verbs.filter((verb) => verb.trim().includes(' '));
  if (multi.length === 0) return never('verb');
  const parts = longestFirst(multi).map((verb) => {
    const words = verb.trim().split(/\s+/);
    const head = words[0] ?? '';
    return `${escapeRegExp(head)}(?:e?s)?\\s+${words.slice(1).map(escapeRegExp).join('\\s+')}`;
  });
  return `(?:${parts.join('|')})${WORD_END}`;
}

function buildTokens(lexicon: CanonLexicon) {
  const sticky = (source: string): RegExp => new RegExp(source, 'iy');
  // Categories: one token can stand wherever its category is expected.
  const AnyWord = createToken({ name: 'WORD', pattern: Lexer.NA });
  const Art = createToken({ name: 'ARTICLE', pattern: Lexer.NA });
  const Qual = createToken({ name: 'QUALIFIER', pattern: Lexer.NA });
  const SlotKw = createToken({ name: 'SLOT_KEYWORD', pattern: Lexer.NA });
  const Modal = createToken({ name: 'MODAL', pattern: Lexer.NA });
  const MarkKw = createToken({ name: 'MARK_KEYWORD', pattern: Lexer.NA });
  // Lexicon tokens come first, so a declared "On Hold" wins over the keyword "not".
  const State = createToken({ name: 'STATE', pattern: sticky(alternatives(lexicon.states, '', 'state')), categories: AnyWord, line_breaks: false });
  const Term = createToken({ name: 'TERM', pattern: sticky(alternatives(lexicon.terms, 's?', 'term')), categories: AnyWord, line_breaks: false });
  const Verb = createToken({ name: 'VERB', pattern: sticky(verbPattern(lexicon.verbs)), line_breaks: false });
  const Actor = createToken({ name: 'ACTOR', pattern: sticky(alternatives(lexicon.actors, '', 'actor')), categories: AnyWord, line_breaks: false });
  const Plain = createToken({ name: 'PLAIN_WORD', pattern: /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/, categories: AnyWord });
  const keyword = (word: string, categories: TokenType[]): TokenType =>
    createToken({ name: word, label: `"${word}"`, pattern: new RegExp(word, 'i'), longer_alt: Plain, categories });
  const K: Record<string, TokenType> = {};
  for (const word of KEYWORDS.modal) K[word] = keyword(word, [Modal]);
  for (const word of KEYWORDS.article) K[word] = keyword(word, [Art]);
  for (const word of KEYWORDS.qualifier) K[word] = keyword(word, [Qual]);
  for (const word of KEYWORDS.slot) K[word] = keyword(word, [SlotKw]);
  for (const word of [...KEYWORDS.result, ...KEYWORDS.logic]) K[word] = keyword(word, []);
  // "starts" and "ends" stay ordinary words everywhere but in a mark, so an actor can still start a task.
  K.starts = keyword('starts', [AnyWord, MarkKw]);
  K.ends = keyword('ends', [AnyWord, MarkKw]);
  K.always = keyword('always', []);
  K.never = keyword('never', []);
  const Comma = createToken({ name: 'Comma', label: '","', pattern: /,/ });
  const Period = createToken({ name: 'Period', label: '"."', pattern: /\./ });
  const WS = createToken({ name: 'WS', pattern: /\s+/, group: Lexer.SKIPPED });
  // Longer keywords before their prefixes ("cannot" before "can", "an" before "a").
  const keywords = Object.values(K).sort((left, right) => right.name.length - left.name.length);
  const all = [WS, State, Term, Verb, Actor, ...keywords, Plain, Comma, Period, AnyWord, Art, Qual, SlotKw, Modal, MarkKw];
  return { all, AnyWord, Art, Qual, SlotKw, Modal, MarkKw, State, Term, Verb, Actor, Plain, Comma, Period, K };
}

type Tokens = ReturnType<typeof buildTokens>;

function word(token: IToken): Word {
  return { text: token.image, span: [token.startOffset, (token.endOffset ?? token.startOffset) + 1] };
}

function cover(items: readonly ({ span: Span } | null | undefined)[]): Span {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const item of items) {
    if (item === null || item === undefined) continue;
    start = Math.min(start, item.span[0]);
    end = Math.max(end, item.span[1]);
  }
  return [start === Number.POSITIVE_INFINITY ? 0 : start, end];
}

function group(type: 'and' | 'or', items: Cond[], either: boolean): Cond {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return { type, span: [0, 0], items };
  if (items.length === 1 && !either) return first;
  const node: Cond = { type, span: [condSpan(first)[0], condSpan(last)[1]], items };
  if (either) node.either = true;
  return node;
}

class CanonGrammar extends EmbeddedActionsParser {
  private readonly t: Tokens;
  private text = '';

  constructor(tokens: Tokens) {
    super(tokens.all, { maxLookahead: 2 });
    this.t = tokens;
    this.performSelfAnalysis();
  }

  run(entry: 'block' | 'mark' | 'invariant', tokens: IToken[], text: string): Statement | undefined {
    this.text = text;
    this.input = tokens;
    if (entry === 'mark') return this.mark();
    if (entry === 'invariant') return this.invariant();
    return this.block();
  }

  // block = [ lead "," ] branch { "," "or" branch } "." ;
  private block = this.RULE('block', (): Block => {
    const lead = this.OPTION(() => {
      const found = this.SUBRULE(this.lead);
      this.CONSUME(this.t.Comma);
      return found;
    }) ?? null;
    const branches = [this.SUBRULE(this.branch)];
    this.MANY(() => {
      this.CONSUME2(this.t.Comma);
      this.CONSUME(this.t.K.or as TokenType);
      branches.push(this.SUBRULE2(this.branch));
    });
    this.CONSUME(this.t.Period);
    return { kind: 'block', span: [0, this.text.length], lead, branches };
  });

  // lead = "when" cond | "after" ref ;
  private lead = this.RULE('lead', (): Lead => this.OR([
    {
      ALT: () => {
        const key = this.CONSUME(this.t.K.when as TokenType);
        const cond = this.SUBRULE(this.cond);
        return this.ACTION((): Lead => ({ kind: 'when', span: [key.startOffset, condSpan(cond)[1]], cond }));
      },
    },
    {
      ALT: () => {
        const key = this.CONSUME(this.t.K.after as TokenType);
        const ref = this.SUBRULE(this.ref);
        return this.ACTION((): Lead => ({ kind: 'after', span: [key.startOffset, ref.span[1]], ref }));
      },
    },
  ]));

  // branch = clause { "and" clause } [ "when" cond ] ;
  private branch = this.RULE('branch', (): Branch => {
    const clauses = [this.SUBRULE(this.clause)];
    this.MANY(() => {
      this.CONSUME(this.t.K.and as TokenType);
      clauses.push(this.SUBRULE2(this.clause));
    });
    const guard = this.OPTION(() => {
      this.CONSUME(this.t.K.when as TokenType);
      return this.SUBRULE(this.cond);
    }) ?? null;
    return this.ACTION((): Branch => {
      const last = clauses[clauses.length - 1];
      const end = guard !== null ? condSpan(guard)[1] : last?.span[1] ?? 0;
      return { span: [clauses[0]?.span[0] ?? 0, end], clauses, guard };
    });
  });

  // clause = [ [ art ] ACTOR [ modal ] ] VERB ref { slot } [ "as" [ art ] STATE ] { slot } ;
  private clause = this.RULE('clause', (): Clause => {
    let art: IToken | undefined;
    let actor: IToken | undefined;
    let modal: IToken | undefined;
    let result: Clause['result'] = null;
    const slots: Slot[] = [];
    const extraVerbs: Word[] = [];
    // An actor is a word too, so the choice is a gate: an actor, or an article and an actor, starts the long form.
    this.OPTION({
      GATE: () => tokenMatcher(this.LA(1), this.t.Actor) || (tokenMatcher(this.LA(1), this.t.Art) && tokenMatcher(this.LA(2), this.t.Actor)),
      DEF: () => {
        art = this.OPTION2(() => this.CONSUME(this.t.Art));
        actor = this.CONSUME(this.t.Actor);
        modal = this.OPTION3(() => this.CONSUME(this.t.Modal));
      },
    });
    const verb = this.OR([{ ALT: () => this.CONSUME(this.t.Verb) }, { ALT: () => this.CONSUME(this.t.AnyWord) }]);
    // Error production: a word followed by an article cannot start the object, so it is a second "verb". A rule reports it.
    this.MANY({
      GATE: () => tokenMatcher(this.LA(1), this.t.AnyWord) && tokenMatcher(this.LA(2), this.t.Art),
      DEF: () => {
        extraVerbs.push(word(this.CONSUME2(this.t.AnyWord)));
      },
    });
    const object = this.SUBRULE(this.ref);
    this.MANY2(() => this.OR2([
      {
        ALT: () => {
          slots.push(this.SUBRULE(this.slot));
        },
      },
      {
        GATE: () => result === null,
        ALT: () => {
          const key = this.CONSUME(this.t.K.as as TokenType);
          this.OPTION4(() => this.CONSUME2(this.t.Art));
          const state = this.SUBRULE(this.state);
          result = this.ACTION(() => ({ span: [key.startOffset, state.span[1]] as Span, state }));
        },
      },
    ]));
    return this.ACTION((): Clause => {
      const first = (art ?? actor ?? verb).startOffset;
      let end = object.span[1];
      if (result !== null) end = Math.max(end, result.span[1]);
      for (const slot of slots) end = Math.max(end, slot.span[1]);
      return {
        span: [first, end],
        actor: actor === undefined ? null : word(actor),
        modal: modal === undefined ? null : word(modal),
        verb: word(verb),
        extraVerbs,
        object,
        result,
        slots,
      };
    });
  });

  private slot = this.RULE('slot', (): Slot => {
    const key = this.CONSUME(this.t.SlotKw);
    const ref = this.SUBRULE(this.ref);
    return this.ACTION((): Slot => ({ span: [key.startOffset, ref.span[1]], key: word(key), ref }));
  });

  // cond: "and" binds tighter than "or"; an "either" group is a unit of an "and".
  private cond = this.RULE('cond', (): Cond => {
    const alternatives = [this.SUBRULE(this.all)];
    this.MANY(() => {
      this.CONSUME(this.t.K.or as TokenType);
      alternatives.push(this.SUBRULE2(this.all));
    });
    return this.ACTION(() => group('or', alternatives, false));
  });

  private all = this.RULE('all', (): Cond => {
    const units = [this.SUBRULE(this.unit)];
    this.MANY(() => {
      this.CONSUME(this.t.K.and as TokenType);
      units.push(this.SUBRULE2(this.unit));
    });
    return this.ACTION(() => group('and', units, false));
  });

  private unit = this.RULE('unit', (): Cond => this.OR([
    {
      ALT: () => {
        this.CONSUME(this.t.K.either as TokenType);
        const items = [this.SUBRULE(this.predCond)];
        this.AT_LEAST_ONE(() => {
          this.CONSUME(this.t.K.or as TokenType);
          items.push(this.SUBRULE2(this.predCond));
        });
        return this.ACTION(() => group('or', items, true));
      },
    },
    { ALT: () => this.SUBRULE3(this.predCond) },
  ]));

  private predCond = this.RULE('predCond', (): Cond => {
    const pred = this.SUBRULE(this.pred);
    return { type: 'pred', pred };
  });

  // "is approved or rejected": after "or", a piece with no "is" is one more state. LL(2) cannot see that far,
  // so a gate scans ahead for [art] [qual] WORD+ "is".
  private predAhead(start: number): boolean {
    let k = start;
    if (tokenMatcher(this.LA(k), this.t.K.either as TokenType)) return true;
    if (tokenMatcher(this.LA(k), this.t.Art)) k += 1;
    if (tokenMatcher(this.LA(k), this.t.Qual)) k += 1;
    let words = 0;
    while (tokenMatcher(this.LA(k), this.t.AnyWord)) {
      k += 1;
      words += 1;
    }
    return words > 0 && tokenMatcher(this.LA(k), this.t.K.is as TokenType);
  }

  private pred = this.RULE('pred', (): Pred => {
    const subject = this.SUBRULE(this.ref);
    this.CONSUME(this.t.K.is as TokenType);
    const negated = this.OPTION(() => this.CONSUME(this.t.K.not as TokenType)) !== undefined;
    const states = this.SUBRULE(this.states);
    return this.ACTION((): Pred => ({ span: [subject.span[0], states[states.length - 1]?.span[1] ?? subject.span[1]], subject, negated, states }));
  });

  private states = this.RULE('states', (): Word[] => {
    const states = [this.SUBRULE(this.state)];
    this.MANY({
      GATE: () => !this.predAhead(2),
      DEF: () => {
        this.CONSUME(this.t.K.or as TokenType);
        states.push(this.SUBRULE2(this.state));
      },
    });
    return states;
  });

  // A state name is one word, a declared multi-word state, or a qualifier word used as a name ("as new").
  private state = this.RULE('state', (): Word => {
    const token = this.OR([{ ALT: () => this.CONSUME(this.t.AnyWord) }, { ALT: () => this.CONSUME(this.t.Qual) }]);
    return this.ACTION(() => word(token));
  });

  // ref = [ art ] [ qual ] [ STATE ] NOUN ; the last word is the noun, the words before it are the state.
  private ref = this.RULE('ref', (): Ref => {
    const art = this.OPTION(() => this.CONSUME(this.t.Art));
    const qual = this.OPTION2(() => this.CONSUME(this.t.Qual));
    const words: IToken[] = [];
    this.AT_LEAST_ONE(() => {
      words.push(this.CONSUME(this.t.AnyWord));
    });
    return this.ACTION(() => this.buildRef(art, qual, words));
  });

  // mark = [ art ] NOUN ( "starts" | "ends" ) "as" [ art ] STATE { "or" STATE } "." ;
  private mark = this.RULE('mark', (): Mark => {
    const art = this.OPTION(() => this.CONSUME(this.t.Art));
    const words: IToken[] = [];
    this.AT_LEAST_ONE({
      GATE: () => !(tokenMatcher(this.LA(1), this.t.MarkKw) && tokenMatcher(this.LA(2), this.t.K.as as TokenType)),
      DEF: () => {
        words.push(this.CONSUME(this.t.AnyWord));
      },
    });
    const key = this.CONSUME(this.t.MarkKw);
    this.CONSUME(this.t.K.as as TokenType);
    this.OPTION2(() => this.CONSUME2(this.t.Art));
    const states = [this.SUBRULE(this.state)];
    this.MANY(() => {
      this.CONSUME(this.t.K.or as TokenType);
      states.push(this.SUBRULE2(this.state));
    });
    this.CONSUME(this.t.Period);
    return this.ACTION((): Mark => ({
      kind: 'mark',
      span: [0, this.text.length],
      mark: key.image.toLowerCase() === 'starts' ? 'starts' : 'ends',
      subject: this.buildRef(art, undefined, words),
      states,
    }));
  });

  // invariant = ref "is" ( "always" [ "not" ] | "never" ) STATE { "or" STATE } [ "when" cond ] "." ;
  private invariant = this.RULE('invariant', (): Invariant => {
    const subject = this.SUBRULE(this.ref);
    this.CONSUME(this.t.K.is as TokenType);
    const negated = this.OR([
      {
        ALT: () => {
          this.CONSUME(this.t.K.always as TokenType);
          return this.OPTION(() => this.CONSUME(this.t.K.not as TokenType)) !== undefined;
        },
      },
      {
        ALT: () => {
          this.CONSUME(this.t.K.never as TokenType);
          return true;
        },
      },
    ]);
    const states = this.SUBRULE(this.states);
    const guard = this.OPTION2(() => {
      this.CONSUME(this.t.K.when as TokenType);
      return this.SUBRULE(this.cond);
    }) ?? null;
    this.CONSUME(this.t.Period);
    return this.ACTION((): Invariant => ({
      kind: 'invariant',
      span: [0, this.text.length],
      pred: { span: [subject.span[0], states[states.length - 1]?.span[1] ?? subject.span[1]], subject, negated, states },
      guard,
    }));
  });

  private buildRef(art: IToken | undefined, qual: IToken | undefined, words: readonly IToken[]): Ref {
    const all = words.map(word);
    const noun = all[all.length - 1] ?? { text: '', span: [0, 0] as Span };
    const first = all[0];
    const beforeNoun = all[all.length - 2];
    const state = all.length > 1 && first !== undefined && beforeNoun !== undefined
      ? { span: [first.span[0], beforeNoun.span[1]] as Span, text: this.text.slice(first.span[0], beforeNoun.span[1]) }
      : null;
    const artWord = art === undefined ? null : word(art);
    const qualWord = qual === undefined ? null : word(qual);
    const last = words[words.length - 1];
    return {
      span: cover([artWord, qualWord, ...all]),
      art: artWord,
      qual: qualWord,
      state,
      noun,
      declared: last !== undefined && tokenMatcher(last, this.t.Term),
    };
  }
}

/** Words whose replacement the grammar knows. A syntax failure on one of them names it. */
const RETIRED: Record<string, string> = {
  in: 'via',
  through: 'via',
  under: 'with',
  at: 'for the whole',
  if: 'when',
  once: 'when',
  unless: 'when ... is not',
  every: 'each',
  are: 'is',
  again: 'when the NOUN is STATE, or a state word before the object',
};

function entryOf(tokens: readonly IToken[], t: Tokens): 'block' | 'mark' | 'invariant' {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === undefined || next === undefined) continue;
    if (tokenMatcher(token, t.MarkKw) && tokenMatcher(next, t.K.as as TokenType)) return 'mark';
    if (tokenMatcher(token, t.K.is as TokenType) && (tokenMatcher(next, t.K.always as TokenType) || tokenMatcher(next, t.K.never as TokenType))) return 'invariant';
  }
  return 'block';
}

function parserFor(lexicon: CanonLexicon): CanonParser {
  const t = buildTokens(lexicon);
  const lexer = new Lexer(t.all);
  const grammar = new CanonGrammar(t);
  const concrete = t.all.filter((type) => type.PATTERN !== Lexer.NA && type.GROUP !== Lexer.SKIPPED);
  const label = (type: TokenType): string => type.LABEL ?? type.name;
  // Which tokens the grammar accepts after a prefix. Chevrotain 12 removed the API that listed them, and an error
  // names only the token of the step that failed, so the full set is found by trying each token type after the prefix.
  const expectedAfter = (entry: 'block' | 'mark' | 'invariant', before: IToken[], text: string): string[] => {
    const found: string[] = [];
    for (const type of concrete) {
      const probe = createTokenInstance(type, '?', -1, -1, -1, -1, -1, -1);
      grammar.run(entry, [...before, probe], text);
      if (!grammar.errors.some((error) => error.token === probe)) found.push(label(type));
    }
    return found;
  };
  return {
    parse(text: string): ParseOutput {
      const lexed = lexer.tokenize(text);
      const diagnostics: Diagnostic[] = [];
      for (const error of lexed.errors) {
        const span: Span = [error.offset, error.offset + error.length];
        diagnostics.push({ severity: 'syntax', code: 'character', message: `"${text.slice(span[0], span[1])}" is not a word, a comma, or a period`, span, found: text.slice(span[0], span[1]), expected: [] });
      }
      const entry = entryOf(lexed.tokens, t);
      const statement = grammar.run(entry, lexed.tokens, text);
      const errors = grammar.errors.slice();
      for (const error of errors) {
        const atEnd = tokenMatcher(error.token, EOF) || error.token.startOffset === -1 || Number.isNaN(error.token.startOffset);
        const span: Span = atEnd ? [text.length, text.length] : [error.token.startOffset, (error.token.endOffset ?? error.token.startOffset) + 1];
        const index = atEnd ? lexed.tokens.length : lexed.tokens.indexOf(error.token);
        const before = lexed.tokens.slice(0, index < 0 ? lexed.tokens.length : index);
        const found = atEnd ? 'end of sentence' : error.token.image;
        const hint = RETIRED[found.toLowerCase()];
        diagnostics.push({
          severity: 'syntax',
          code: hint === undefined ? 'unexpected' : 'retired-word',
          message: hint === undefined ? `unexpected ${atEnd ? found : `"${found}"`}` : `"${found}" is written "${hint}"`,
          span,
          found,
          expected: expectedAfter(entry, before, text),
          form: entry === 'block' ? FORMS.block : entry === 'mark' ? FORMS.mark : FORMS.invariant,
        });
      }
      return { statement: diagnostics.length > 0 || statement === undefined ? null : statement, diagnostics };
    },
  };
}

export const chevrotainCanonParser: CanonParserFactory = {
  name: 'chevrotain',
  forLexicon: parserFor,
};
