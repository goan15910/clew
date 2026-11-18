// Render a highlighted canonical sentence as HTML: one <span> per token, a wrapper per branch and per guard, the
// gaps between tokens kept as written. Pure string building, so it runs in Node (static pages) and in a browser.
import type { HighlightedSentence, HighlightRole, HighlightToken } from '../../domain/canon-highlight.js';

export interface TokenTrace {
  /** What the word compiles to, for a tooltip: `order_status' = "approved"`. */
  tla: string;
  /** The TLA+ action or property it belongs to. */
  owner: string;
}

export interface RenderOptions {
  /** `semantic` (default) uses the tree's roles; `lexical` shows only what the lexer knows. */
  layer?: 'semantic' | 'lexical';
  /** Traces from the compiled model, looked up by token start offset. */
  traces?: ReadonlyMap<number, TokenTrace[]>;
  /** The sentence id, written on the root element. */
  id?: string;
}

export const ROLE_LABEL: Record<HighlightRole, string> = {
  actor: 'actor',
  'modal.permit': 'permission (can): adds nothing to the model',
  'modal.refuse': 'refusal (cannot): an action property',
  verb: 'verb: the event that names the TLA+ action',
  'verb.extra': 'a second verb the grammar has no place for',
  noun: 'object: the variable this step moves',
  'noun.subject': 'subject of a condition or declaration',
  'noun.link': 'link target (with / to)',
  'noun.slot': 'slot noun',
  'state.pre': 'state the object must be in (precondition)',
  'state.post': 'result: the state the step leaves the object in',
  'state.test': 'state a condition tests',
  'state.init': 'initial state',
  'state.final': 'final state',
  quantifier: 'quantifier',
  article: 'article',
  'kw.guard': 'guard: the condition of the step',
  'kw.effect': 'result marker',
  'kw.branch': 'branch separator: another way the same event can go',
  'kw.join': 'joins clauses into one atomic step',
  'kw.logic': 'logic',
  'kw.is': 'predicate',
  'kw.not': 'negation',
  'kw.slot': 'slot keyword',
  'kw.decl': 'declaration (starts / ends)',
  'kw.always': 'invariant',
  'kw.never': 'invariant (negated)',
  'kw.after': 'event lead',
  term: 'declared term',
  word: 'word',
  punct: 'punctuation',
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function roleClass(role: HighlightRole): string {
  return `cnl-${role.replace(/\./g, '-')}`;
}

function tokenHtml(token: HighlightToken, options: RenderOptions, notes: HighlightedSentence['notes']): string {
  const role = options.layer === 'lexical' ? token.lexical : token.role;
  const classes = [roleClass(role)];
  if (token.declared) classes.push('cnl-declared');
  const hits = notes.filter((note) => token.span[0] < Math.max(note.span[1], note.span[0] + 1) && token.span[1] > note.span[0]);
  if (hits.some((note) => note.severity === 'syntax')) classes.push('cnl-error');
  else if (hits.length > 0) classes.push('cnl-warn');
  const tips = [ROLE_LABEL[role]];
  const traces = options.layer === 'lexical' ? undefined : options.traces?.get(token.span[0]);
  for (const trace of traces ?? []) tips.push(`${trace.owner}: ${trace.tla}`);
  for (const note of hits) tips.push(`${note.code}: ${note.message}`);
  const data = traces !== undefined && traces.length > 0 ? ` data-tla="${escapeHtml(traces.map((trace) => trace.tla).join('  ∧  '))}"` : '';
  return `<span class="${classes.join(' ')}" data-role="${role}"${data} title="${escapeHtml(tips.join('\n'))}">${escapeHtml(token.text)}</span>`;
}

/** The sentence as HTML. Regions become nested wrappers: a branch holds its guard. */
export function renderSentenceHtml(sentence: HighlightedSentence, options: RenderOptions = {}): string {
  const semantic = options.layer !== 'lexical';
  const regions = semantic ? sentence.regions.slice().sort((left, right) => left.span[0] - right.span[0] || right.span[1] - left.span[1]) : [];
  const opens = new Map<number, string[]>();
  const closes = new Map<number, number>();
  for (const region of regions) {
    const label = region.kind === 'branch' ? ` data-branch="${region.branch ?? ''}"` : region.kind === 'clause' ? ` data-clause="${region.clause ?? ''}"` : '';
    const tag = `<span class="cnl-region cnl-${region.kind}"${label}>`;
    opens.set(region.span[0], [...(opens.get(region.span[0]) ?? []), tag]);
    closes.set(region.span[1], (closes.get(region.span[1]) ?? 0) + 1);
  }
  let html = '';
  let at = 0;
  const text = sentence.text;
  const emitGap = (until: number): void => {
    if (until > at) html += escapeHtml(text.slice(at, until));
    at = Math.max(at, until);
  };
  for (const token of sentence.tokens) {
    emitGap(token.span[0]);
    for (const tag of opens.get(token.span[0]) ?? []) html += tag;
    html += tokenHtml(token, options, sentence.notes);
    at = token.span[1];
    const count = closes.get(token.span[1]) ?? 0;
    for (let index = 0; index < count; index += 1) html += '</span>';
  }
  emitGap(text.length);
  // A syntax error at the end of the sentence ("expected a period") has no token: mark the end.
  const atEnd = sentence.notes.find((note) => note.span[0] >= text.length);
  if (atEnd !== undefined) html += `<span class="cnl-error cnl-eol" title="${escapeHtml(`${atEnd.code}: ${atEnd.message}`)}">␣</span>`;
  const id = options.id === undefined ? '' : ` data-sentence="${escapeHtml(options.id)}"`;
  return `<span class="cnl cnl-kind-${sentence.kind}${semantic ? '' : ' cnl-lexical'}"${id}>${html}</span>`;
}
