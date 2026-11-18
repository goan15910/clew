import { readFileSync } from 'node:fs';
import { page } from './page-shell.mjs';
const lexicon = JSON.parse(readFileSync('../../examples/canon/lexicon.json', 'utf8'));
const lines = readFileSync('../../examples/canon/order.md', 'utf8').split('\n').filter((l) => /^[A-Z]/.test(l));
const roles = ['actor','verb','noun','noun-subject','noun-link','state-post','state-pre','state-test','state-init','state-final','quantifier','article','kw-guard','kw-effect','kw-branch','kw-join','kw-not','kw-never','kw-always','kw-decl','modal-refuse','modal-permit','kw-is','kw-logic','kw-slot','punct'];
const colors = { actor: '#0e7490', verb: '#1d4ed8', noun: '#6d28d9', 'noun-subject': '#6d28d9', 'noun-link': '#7e22ce', 'state-post': '#14532d', 'state-pre': '#15803d', 'state-test': '#15803d', 'state-init': '#14532d', 'state-final': '#14532d', quantifier: '#c2410c', article: '#9ca3af', 'kw-guard': '#be185d', 'kw-effect': '#be185d', 'kw-branch': '#be185d', 'kw-join': '#be185d', 'kw-not': '#b91c1c', 'kw-never': '#b91c1c', 'kw-always': '#be185d', 'kw-decl': '#be185d', 'modal-refuse': '#b91c1c', 'modal-permit': '#64748b', 'kw-is': '#64748b', 'kw-logic': '#64748b', 'kw-slot': '#64748b', punct: '#64748b' };
const bg = { 'state-post': '#dcfce7', 'state-init': '#dcfce7', 'state-final': '#dcfce7', 'modal-refuse': '#fee2e2', 'kw-branch': '#fce7f3' };
const css = roles.map((r) => `::highlight(cnl-${r}) { color: ${colors[r]};${bg[r] ? ` background-color: ${bg[r]};` : ''}${r === 'noun-link' ? ' text-decoration: underline dotted;' : ''} }`).join('\n')
  + '\n::highlight(cnl-guard) { background-color: rgba(250, 204, 21, 0.18); }\n::highlight(cnl-error) { text-decoration: underline wavy #dc2626; }';
page('../out/highlight-api.html', 'CNL via CSS Custom Highlight API', `${css}
.ed { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; white-space: pre-wrap; line-height: 1.9; outline: none; }
.ed:focus { border-color: #93c5fd; }`,
`<h1>CNL via the CSS Custom Highlight API</h1>
<p class="note">The text below is one plain, editable text node per line: no &lt;span&gt; is added. The same Chevrotain highlighter registers ranges with <code>CSS.highlights</code>, re-run on every keystroke. Supported in Chrome/Edge 105+, Safari 17.2+, Firefox 140+. <code>::highlight()</code> can only set colour, background, and text decoration: no bold, no small capitals, no pill borders, so roles must be told apart by colour alone.</p>
<div id="ed" class="ed" contenteditable="true" spellcheck="false">${lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n')}</div>
<script>
window.addEventListener('DOMContentLoaded', function () {
  var api = Cnl.createCnl(${JSON.stringify(lexicon)});
  var ed = document.getElementById('ed');
  function paint() {
    var text = ed.textContent;
    var node = ed.firstChild;
    var groups = {};
    var add = function (name, from, to) { if (!node) return; var r = new Range(); r.setStart(node, from); r.setEnd(node, to); (groups[name] = groups[name] || []).push(r); };
    var at = 0;
    text.split('\\n').forEach(function (line) {
      if (line.trim()) {
        var hl = api.highlight(line);
        hl.tokens.forEach(function (t) { add('cnl-' + t.role.replace('.', '-'), at + t.span[0], at + t.span[1]); });
        hl.regions.forEach(function (g) { if (g.kind === 'guard') add('cnl-guard', at + g.span[0], at + g.span[1]); });
        hl.notes.forEach(function (n) { add('cnl-error', at + Math.min(n.span[0], line.length - 1), at + Math.min(Math.max(n.span[1], n.span[0] + 1), line.length)); });
      }
      at += line.length + 1;
    });
    CSS.highlights.clear();
    Object.keys(groups).forEach(function (name) { CSS.highlights.set(name, new Highlight(...groups[name])); });
  }
  ed.addEventListener('input', function () { if (ed.childNodes.length > 1) { var t = ed.textContent; ed.textContent = t; } paint(); });
  paint();
});
</script>`, ['dist/cnl.min.js']);
console.log('ok');
