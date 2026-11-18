import { readFileSync } from 'node:fs';
import { page } from './page-shell.mjs';
const lexicon = JSON.parse(readFileSync('../../examples/canon/lexicon.json', 'utf8'));
const doc = readFileSync('../../examples/canon/order.md', 'utf8').split('\n').filter((l) => /^[A-Z#]/.test(l)).join('\n')
  + '\nThe customer submits the order as submitted and the manager reviews it.';
page('../out/editor-codemirror.html', 'CNL editor (CodeMirror 6)', `
.wrap { display: grid; grid-template-columns: 1fr 260px; gap: 12px; }
textarea { width: 100%; height: 260px; font: 12px ui-monospace, Menlo, Consolas, monospace; border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: var(--panel); color: var(--ink); }
textarea.bad { border-color: #dc2626; }
@media (max-width: 760px) { .wrap { grid-template-columns: 1fr; } }`,
`<h1>CNL editor prototype: CodeMirror 6 + Clew's Chevrotain parser</h1>
<p class="note">Type to edit. Colours, squiggles, and quick fixes come from <code>clew spec canon check</code>'s own parser and gate; hover a word for its role and the TLA+ it compiles to. Edit the lexicon on the right: declaring a multi-word state or actor re-lexes every line.</p>
<div class="wrap"><div id="editor"></div><div><h2 style="margin-top:0">Lexicon</h2><textarea id="lexicon" spellcheck="false"></textarea></div></div>
<script>window.addEventListener('DOMContentLoaded', function () { CnlEditor.mountEditor(document.getElementById('editor'), ${JSON.stringify(doc)}, ${JSON.stringify(lexicon)}, document.getElementById('lexicon')); });</script>`,
['dist/editor.min.js']);
console.log('ok');
