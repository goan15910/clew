// Prototype: simpler highlight themes on the same spans. Only CSS differs.
//   npx tsx proto-hl/variants.ts <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { chevrotainCanonParser } from '../src/adapters/canon/chevrotain-parser.js';
import { CNL_HIGHLIGHT_CSS } from '../src/adapters/canon/highlight-css.js';
import { renderSentenceHtml } from '../src/adapters/canon/highlight-html.js';
import type { CanonLexicon } from '../src/domain/canon-ast.js';
import { highlightSentence } from '../src/domain/canon-highlight.js';

const lexicon = JSON.parse(readFileSync('proto-hl/hard/lexicon.json', 'utf8')) as CanonLexicon;
lexicon.actors.push('manager');
const sentences = [
  'The customer submits a new purchase order as submitted.',
  'The account manager signs off the submitted purchase order as approved when the total is small, or holds the submitted purchase order as On Hold when the total is large.',
  'The warehouse ships the approved purchase order as shipped when the purchase order is not On Hold and either the total is small or the invoice is paid.',
  'The customer cannot cancel the shipped purchase order.',
  'The purchase order is never shipped when the total is large and no invoice is paid.',
  'The purchase order starts as draft.',
  'Once the order is approved, the warehouse must pack it.',
];
const parser = chevrotainCanonParser.forLexicon(lexicon);

// Every role back to plain text; each variant then turns on only what it needs.
const RESET = `
.v .cnl [class*="cnl-"] { color: inherit; font-weight: 400; font-style: normal; background: none; border: 0; outline: 0; padding: 0; margin: 0;
  text-transform: none; font-size: inherit; letter-spacing: normal; text-decoration: none; }
.v .cnl .cnl-state-init::before { content: none; }
.v .cnl .cnl-region.cnl-guard { background: none; border: 0; }
.v .cnl .cnl-error { text-decoration: underline wavy #dc2626 1.5px; text-underline-offset: 3px; }
.v .cnl .cnl-warn { text-decoration: underline wavy #d97706 1.5px; text-underline-offset: 3px; }`;
const KW = '.cnl-kw-guard, .cnl-kw-effect, .cnl-kw-branch, .cnl-kw-decl, .cnl-kw-always, .cnl-kw-after';
const POLAR = '.cnl-modal-refuse, .cnl-kw-not, .cnl-kw-never';
const scope = (name: string, rules: string) => rules.replace(/(^|\})\s*([^{}]+)\{/g, (_m, close, sel) => `${close}\n${sel.split(',').map((s: string) => `.v-${name} .cnl ${s.trim()}`).join(', ')} {`);

const VARIANTS: { key: string; title: string; note: string; css: string }[] = [
  { key: 'kw', title: 'A. Keywords only', note: 'Like SQL: the clause words (when, as, ", or", starts/ends) in one colour, bold; the words that flip meaning (cannot, not, never) bold red. Nothing else.',
    css: scope('kw', `${KW} { color: #1d4ed8; font-weight: 700; } ${POLAR} { color: #b91c1c; font-weight: 700; }`) },
  { key: 'skel', title: 'B. Skeleton', note: 'A, plus the verb and the result state in bold black: read only the bold words and you get "submits … as submitted", the step itself.',
    css: scope('skel', `${KW} { color: #1d4ed8; font-weight: 700; } ${POLAR} { color: #b91c1c; font-weight: 700; } .cnl-verb, .cnl-state-post, .cnl-state-init, .cnl-state-final { font-weight: 700; }`) },
  { key: 'muted', title: 'C. Skeleton, quiet guard', note: 'B, with the condition after "when" in grey, so the action reads first and the guard reads second.',
    css: scope('muted', `${KW} { color: #1d4ed8; font-weight: 700; } ${POLAR} { color: #b91c1c; font-weight: 700; } .cnl-verb, .cnl-state-post, .cnl-state-init, .cnl-state-final { font-weight: 700; } .cnl-region.cnl-guard, .cnl-region.cnl-guard [class*="cnl-"] { color: #6b7280; } .cnl-region.cnl-guard .cnl-kw-guard { color: #1d4ed8; } .cnl-region.cnl-guard .cnl-kw-not { color: #b91c1c; }`) },
];

const rows = sentences.map((text) => {
  const html = renderSentenceHtml(highlightSentence(text, parser.parse(text)));
  return `<tr>${VARIANTS.map((v) => `<td class="v v-${v.key}">${html}</td>`).join('')}<td class="full">${html}</td></tr>`;
}).join('\n');
const layout = renderSentenceHtml(highlightSentence(sentences[1]!, parser.parse(sentences[1]!))).replace('class="cnl ', 'class="cnl cnl-layout ');

writeFileSync(process.argv[2] ?? 'variants.html', `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CNL highlight variants</title><style>
body { margin: 0; background: #f6f7f9; color: #111827; font: 15px/1.7 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 16px; } h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 20px 0 6px; }
p.note { color: #5b6472; font-size: 13px; margin: 0 0 10px; }
table { border-collapse: collapse; width: 100%; background: #fff; table-layout: fixed; } td, th { border: 1px solid #e2e5ea; padding: 7px 10px; vertical-align: top; text-align: left; }
th { font-size: 13px; font-weight: 600; } th small { display: block; font-weight: 400; color: #5b6472; font-size: 12px; line-height: 1.4; margin-top: 2px; }
td.full { opacity: .55; } .box { background: #fff; border: 1px solid #e2e5ea; padding: 10px 14px; max-width: 760px; }
${CNL_HIGHLIGHT_CSS}
${RESET}
${VARIANTS.map((v) => v.css).join('\n')}
.v .cnl-layout .cnl-region.cnl-branch, .v .cnl-layout .cnl-region.cnl-sep { padding-left: 1.9em; }
.v .cnl-layout .cnl-region.cnl-branch::before { content: attr(data-branch); position: absolute; left: 0.2em; top: 0.18em; font-size: 0.72em; font-weight: 700; border: 1px solid; border-radius: 999px; width: 1.45em; height: 1.45em; line-height: 1.35em; text-align: center; }
.v-skel .cnl-layout .cnl-region.cnl-branch::before { border-color: #1d4ed8; color: #1d4ed8; }
</style></head><body><main>
<h1>Simpler CNL highlighting: three variants</h1>
<p class="note">Same spans from the parse tree; only the stylesheet changes. The last column is the current full scheme, for reference. Errors keep their wavy underline in every variant.</p>
<table><tr>${VARIANTS.map((v) => `<th>${v.title}<small>${v.note}</small></th>`).join('')}<th>Current (full)<small>For comparison.</small></th></tr>
${rows}</table>
<h2>Variant B with one branch per line</h2>
<div class="box v v-skel">${layout}</div>
</main></body></html>`);
console.log('ok');
