// Lexical baselines: what a regex highlighter (Prism / highlight.js) or a TextMate grammar (Shiki, VS Code, GitHub)
// can do for canonical sentences, given the same keyword lists and the lexicon. Generated, not hand-written, so the
// comparison is fair: the rules use lookbehind heuristics for the roles a regex can guess.
//   node lexical.mjs <lexicon.json> <sentences.json|order.md> <out-prefix> [title]
// Writes <out-prefix>-prism.html, <out-prefix>-shiki.html and prints role agreement with the parse tree.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Prism = require('prismjs');

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (list) => list.slice().sort((a, b) => b.length - a.length).map((w) => esc(w).replace(/ +/g, '\\s+')).join('|');

/** One rule list feeds both Prism and TextMate. Each rule: role, regex (JS), and for TextMate a capture form. */
export function lexicalRules(lexicon) {
  const actors = lexicon.actors ?? [];
  const multi = { term: (lexicon.terms ?? []), state: (lexicon.states ?? []), verb: (lexicon.verbs ?? []) };
  const W = "[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*";
  const KW = 'when|as|and|or|either|is|not|can|cannot|the|a|an|new|same|each|some|one|no|whole|of|with|to|for|on|after|from|via|starts|ends|always|never';
  const NOUN_END = `(?=\\s+(?:as|when|is|of|with|to|for|on|after|from|via|and|starts|ends)\\b|\\s*[,.])`;
  const rules = [];
  if (multi.state.length) rules.push(['state.test', `\\b(?:${words(multi.state)})\\b`]);
  if (multi.term.length) rules.push(['noun', `\\b(?:${words(multi.term)})s?\\b`]);
  if (multi.verb.length) rules.push(['verb', `\\b(?:${words(multi.verb)})\\b`]);
  if (actors.length) rules.push(['actor', `\\b(?:${words(actors)})\\b`]);
  rules.push(['kw.branch', ',\\s*or\\b']);
  rules.push(['modal.refuse', '\\bcannot\\b']);
  rules.push(['modal.permit', '\\bcan\\b']);
  rules.push(['kw.not', '\\b(?:not|never)\\b']);
  rules.push(['kw.decl', '\\b(?:starts|ends)(?=\\s+as\\b)']);
  // Heuristics a regex can make with lookbehind.
  rules.push(['state.post', `(?<=\\bas\\s+(?:the\\s+|a\\s+)?)(?!(?:${KW})\\b)${W}`]);
  rules.push(['state.test', `(?<=\\b(?:is|is\\s+not|always|always\\s+not|never|or)\\s+)(?!(?:${KW})\\b)${W}(?=\\s+(?:or|and|when)\\b|\\s*[,.])`]);
  if (actors.length) rules.push(['verb', `(?<=\\b(?:${words(actors)})\\s+(?:can\\s+|cannot\\s+)?)(?!(?:${KW})\\b)${W}`]);
  rules.push(['verb', `(?<=\\band\\s+|,\\s*or\\s+)(?!(?:${KW})\\b)${W}(?=\\s+(?:the|a|an|new|each|some|one|no)\\b)`]);
  rules.push(['state.pre', `(?<=\\b(?:the|a|an|each|some|one|no|new)\\s+)(?!(?:${KW})\\b)${W}(?=\\s+${W}${NOUN_END})`]);
  rules.push(['noun', `(?<=\\b(?:the|a|an|each|some|one|no|new|same|whole|${W})\\s+)(?!(?:${KW})\\b)${W}${NOUN_END}`]);
  rules.push(['kw.guard', '\\bwhen\\b']);
  rules.push(['kw.effect', '\\bas\\b']);
  rules.push(['quantifier', '\\b(?:each|some|one|no|new|same|whole)\\b']);
  rules.push(['article', '\\b(?:the|a|an)\\b']);
  rules.push(['kw.slot', '\\b(?:of|with|to|for|on|after|from|via)\\b']);
  rules.push(['kw.is', '\\bis\\b']);
  rules.push(['kw.logic', '\\b(?:and|or|either)\\b']);
  rules.push(['kw.always', '\\balways\\b']);
  rules.push(['punct', '[,.]']);
  return rules;
}

export function prismGrammar(lexicon) {
  const grammar = {};
  lexicalRules(lexicon).forEach(([role, source], index) => {
    grammar[`r${index}_${role.replace('.', '_')}`] = { pattern: new RegExp(source, 'i'), alias: `cnl-${role.replace('.', '-')}`, greedy: true };
  });
  return grammar;
}

/** Tokens in order with a role, from Prism. */
function prismTokens(text, grammar) {
  const out = [];
  let at = 0;
  for (const token of Prism.tokenize(text, grammar)) {
    const len = typeof token === 'string' ? token.length : String(token.content).length;
    if (typeof token !== 'string') out.push({ span: [at, at + len], role: token.alias.replace(/^cnl-/, '').replace('-', '.') });
    at += len;
  }
  return out;
}

function renderPrism(text, grammar) {
  return `<span class="cnl">${Prism.highlight(text, grammar, 'cnl').replace(/class="token r\d+_[a-z_]+ /g, 'class="')}</span>`;
}

/** Standard TextMate scopes, so stock themes have something to colour. */
const TM_SCOPE = {
  actor: 'entity.name.type', verb: 'entity.name.function', noun: 'variable.other', 'state.post': 'string.quoted',
  'state.pre': 'constant.language', 'state.test': 'constant.language', quantifier: 'keyword.operator', 'kw.guard': 'keyword.control',
  'kw.effect': 'keyword.control', 'kw.branch': 'keyword.control', 'modal.refuse': 'invalid.illegal', 'modal.permit': 'storage.modifier',
  'kw.not': 'keyword.operator.logical', 'kw.decl': 'storage.type', article: 'comment', 'kw.slot': 'keyword.other', 'kw.is': 'keyword.other',
  'kw.logic': 'keyword.operator.logical', 'kw.always': 'storage.type', punct: 'punctuation.separator',
};

/** TextMate grammar: the same rules. Oniguruma has no variable-length lookbehind, so those become captures. */
export function textMateGrammar(lexicon) {
  const patterns = [];
  for (const [role, source] of lexicalRules(lexicon)) {
    const scope = `${TM_SCOPE[role] ?? 'source'}.${role.replace('.', '-')}.cnl`;
    const look = /^\(\?<=(.*?)\)(.*)$/.exec(source);
    if (look) {
      // (?<=PREFIX)BODY  ->  (PREFIX)(BODY), prefix uncoloured.
      let depth = 0; let cut = -1;
      for (let i = 4; i < source.length; i += 1) {
        if (source[i] === '\\') { i += 1; continue; }
        if (source[i] === '(') depth += 1;
        if (source[i] === ')') { if (depth === 0) { cut = i; break; } depth -= 1; }
      }
      const prefix = source.slice(4, cut);
      const body = source.slice(cut + 1);
      patterns.push({ match: `(?i)(${prefix})(${body})`, captures: { 1: { patterns: [{ include: '$self' }] }, 2: { name: scope } } });
    } else {
      patterns.push({ match: `(?i)${source}`, name: scope });
    }
  }
  return { name: 'cnl', scopeName: 'source.cnl', patterns };
}

function loadSentences(path) {
  if (path.endsWith('.json')) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data.sentences.filter((s) => s.latest !== null).map((s) => ({ id: s.id, text: s.latest.text }));
  }
  let n = 0;
  return readFileSync(path, 'utf8').split('\n').filter((l) => /^[A-Z]/.test(l)).map((text) => ({ id: `s${(n += 1)}`, text: text.trim() }));
}

const CONTENT = ['actor', 'verb', 'noun', 'state.pre', 'state.post', 'state.test', 'quantifier', 'kw.guard', 'kw.effect', 'kw.branch', 'modal.refuse', 'kw.not'];
const family = (role) => (role.startsWith('noun') ? 'noun' : role === 'state.init' || role === 'state.final' ? 'state.test' : role === 'kw.never' ? 'kw.not' : role === 'term' ? 'noun' : role);

export async function main() {
  const [lexPath, sentPath, prefix, title = 'Lexical baselines'] = process.argv.slice(2);
  const lexRaw = JSON.parse(readFileSync(lexPath, 'utf8'));
  const lexicon = lexRaw.lexicon ?? lexRaw;
  const sentences = loadSentences(sentPath);
  const grammar = prismGrammar(lexicon);
  // Semantic roles from Clew, for the score.
  const cnl = await import(pathToFileURL(new URL('./dist/cnl-node.mjs', import.meta.url).pathname).href);
  const api = cnl.createCnl(lexicon);
  let total = 0; let agree = 0; let missed = 0; let wrong = 0;
  const confusion = new Map();
  const rows = [];
  for (const s of sentences) {
    const hl = api.highlight(s.text);
    const lex = prismTokens(s.text, grammar);
    for (const token of hl.tokens) {
      const truth = family(token.role);
      if (!CONTENT.includes(truth)) continue;
      total += 1;
      const guess = lex.find((t) => t.span[0] <= token.span[0] && t.span[1] >= token.span[1]) ?? lex.find((t) => t.span[0] === token.span[0]);
      const g = guess ? family(guess.role) : 'none';
      if (g === truth) agree += 1; else { if (g === 'none') missed += 1; else wrong += 1; const k = `${truth} ← ${g}`; confusion.set(k, (confusion.get(k) ?? 0) + 1); }
    }
    rows.push({ id: s.id, prism: renderPrism(s.text, grammar), sem: api.renderSentenceHtml ? null : null, semHtml: cnl.renderSentenceHtml(hl) });
  }
  const pct = (x) => `${((100 * x) / Math.max(total, 1)).toFixed(1)}%`;
  const top = [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const summary = { sentences: sentences.length, contentWords: total, agree: pct(agree), wrongRole: pct(wrong), uncoloured: pct(missed), topConfusions: top };
  console.log(JSON.stringify(summary, null, 1));
  // Shiki: same rules as a TextMate grammar, two stock themes.
  const { createHighlighter } = await import('shiki');
  const tm = textMateGrammar(lexicon);
  const shiki = await createHighlighter({ themes: ['github-light', 'one-dark-pro'], langs: [tm] });
  const shikiRows = sentences.slice(0, 40).map((s) => ({ id: s.id, light: shiki.codeToHtml(s.text, { lang: 'cnl', theme: 'github-light' }), dark: shiki.codeToHtml(s.text, { lang: 'cnl', theme: 'one-dark-pro' }) }));
  const css = cnl.CNL_HIGHLIGHT_CSS;
  const shell = (heading, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title><style>
body { margin: 0; background: #f6f7f9; color: #111827; font: 15px/1.75 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; } h1 { font-size: 18px; margin: 0 0 6px; } p.note { color: #5b6472; font-size: 13px; }
table { border-collapse: collapse; width: 100%; background: #fff; } td, th { border: 1px solid #e2e5ea; padding: 5px 9px; vertical-align: top; text-align: left; } th { font-size: 12px; color: #5b6472; font-weight: 600; }
td.id { color: #5b6472; font: 12px ui-monospace, Menlo, monospace; width: 50px; }
pre.shiki { margin: 0; padding: 4px 8px; border-radius: 6px; white-space: pre-wrap; font-size: 13px; }
${css}</style></head><body><main>${body}</main></body></html>`;
  const scoreHtml = `<p class="note">Content words (actor, verb, object, the three kinds of state, quantifier, when/as/", or", cannot/not) given the same role as the parse tree: <b>${summary.agree}</b>; a wrong role: ${summary.wrongRole}; left uncoloured: ${summary.uncoloured}. Most common misses: ${top.map(([k, v]) => `${k} ×${v}`).join(', ')}.</p>`;
  writeFileSync(`${prefix}-prism.html`, shell(`${title}: Prism vs tree`, `<h1>${title}: regex highlighting (Prism) vs Clew's parse tree</h1>${scoreHtml}<p class="note">Left: Prism with a grammar generated from the keyword lists and the lexicon, plus lookbehind heuristics. Right: the semantic highlighter on the Chevrotain tree. Same stylesheet on both sides.</p><table><tr><th>id</th><th>Prism (regex)</th><th>Chevrotain tree</th></tr>${rows.map((r) => `<tr><td class="id">${r.id}</td><td>${r.prism}</td><td>${r.semHtml}</td></tr>`).join('')}</table>`));
  writeFileSync(`${prefix}-shiki.html`, shell(`${title}: Shiki`, `<h1>${title}: Shiki (TextMate grammar, stock themes)</h1><p class="note">The same rules compiled to a TextMate grammar (Oniguruma has no variable-length lookbehind, so the heuristics become captures). Roles are mapped onto standard scopes (entity.name.function for the verb, string for the result state, keyword.control for when/as, ...). A stock theme then colours them, but by what the scopes mean in code, not in CNL: several roles share one colour and nothing marks the guard or the branches.</p><table><tr><th>id</th><th>github-light</th><th>one-dark-pro</th></tr>${shikiRows.map((r) => `<tr><td class="id">${r.id}</td><td>${r.light}</td><td>${r.dark}</td></tr>`).join('')}</table>`));
  writeFileSync(`${prefix}-cnl.tmLanguage.json`, JSON.stringify(tm, null, 1));
  return summary;
}

if (process.argv[1] && process.argv[1].endsWith("lexical.mjs")) main();
