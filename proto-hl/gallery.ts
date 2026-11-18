// Prototype: render a gallery of highlighted canonical sentences from a spec (or a session) and its lexicon.
//   npx tsx proto-hl/gallery.ts --example <out.html>
//   npx tsx proto-hl/gallery.ts --session <session-dir> <out.html> [title]
import { readFileSync, writeFileSync } from 'node:fs';
import { chevrotainCanonParser } from '../src/adapters/canon/chevrotain-parser.js';
import { CNL_HIGHLIGHT_CSS } from '../src/adapters/canon/highlight-css.js';
import { renderSentenceHtml, ROLE_LABEL, type TokenTrace } from '../src/adapters/canon/highlight-html.js';
import { compileGate } from '../src/application/canon.js';
import type { CanonLexicon, Span } from '../src/domain/canon-ast.js';
import { runGate } from '../src/domain/canon-gate.js';
import { highlightSentence, type HighlightedSentence, type HighlightRole } from '../src/domain/canon-highlight.js';

interface Input { id: string; text: string; section: string; original?: string }

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function specInputs(lexiconPath: string, specPath: string): { lexicon: CanonLexicon; inputs: Input[] } {
  const lexicon = JSON.parse(readFileSync(lexiconPath, 'utf8')) as CanonLexicon;
  const inputs: Input[] = [];
  let n = 0;
  for (const line of readFileSync(specPath, 'utf8').split('\n')) {
    if (/^[A-Z]/.test(line)) inputs.push({ id: `s${(n += 1)}`, text: line.trim(), section: specPath });
  }
  return { lexicon, inputs };
}

function exampleInputs(): { lexicon: CanonLexicon; inputs: Input[] } {
  const { lexicon, inputs } = specInputs('examples/canon/lexicon.json', 'examples/canon/order.md');
  let section = '';
  let w = 0;
  for (const line of readFileSync('examples/canon/workflows.md', 'utf8').split('\n')) {
    const heading = /^## (.*)/.exec(line);
    if (heading) section = `examples/canon/workflows.md / ${heading[1]}`;
    const step = /^\d+\. (.*)/.exec(line);
    if (step && step[1]) inputs.push({ id: `w${(w += 1)}`, text: step[1], section });
  }
  return { lexicon, inputs };
}

function sessionInputs(dir: string): { lexicon: CanonLexicon; inputs: Input[] } {
  const lexicon = (JSON.parse(readFileSync(`${dir}/canon.json`, 'utf8')) as { lexicon: CanonLexicon }).lexicon;
  const data = JSON.parse(readFileSync(`${dir}/sentences.json`, 'utf8')) as { sentences: { id: string; original: { text: string; section: string } | null; latest: { text: string; section: string } | null }[] };
  const inputs: Input[] = [];
  for (const sentence of data.sentences) {
    if (sentence.latest === null) continue;
    const original = sentence.original?.text;
    inputs.push({ id: sentence.id, text: sentence.latest.text, section: sentence.latest.section, ...(original !== undefined && original !== sentence.latest.text ? { original } : {}) });
  }
  return { lexicon, inputs };
}

const GROUPS: { title: string; roles: HighlightRole[] }[] = [
  { title: 'Keywords', roles: ['kw.guard', 'kw.effect', 'kw.branch', 'kw.decl'] },
  { title: 'Objects', roles: ['noun'] },
  { title: 'States', roles: ['state.pre', 'state.post', 'state.test'] },
];

const SAMPLE: Partial<Record<HighlightRole, string>> = {
  'state.post': 'approved', verb: 'reviews', 'kw.guard': 'when', 'kw.effect': 'as', 'kw.branch': ', or', 'kw.join': 'and',
  'modal.refuse': 'cannot', 'kw.not': 'not', 'kw.never': 'never', actor: 'manager', noun: 'order', 'noun.link': 'product',
  quantifier: 'each', 'state.pre': 'submitted', 'kw.decl': 'starts', 'state.test': 'packed', 'state.init': 'draft', 'state.final': 'closed',
  'kw.always': 'always', article: 'the', 'kw.is': 'is', 'kw.logic': 'or', 'kw.slot': 'with', 'modal.permit': 'can',
};

function legend(): string {
  return GROUPS.map((group) => `<div class="lg"><b>${group.title}</b>${group.roles
    .map((role) => `<span class="cnl"><span class="cnl-${role.replace(/\./g, '-')}" title="${esc(ROLE_LABEL[role])}">${esc(SAMPLE[role] ?? role)}</span></span>`)
    .join(' ')}</div>`).join('');
}

/** Map compiled guards and effects back onto the tokens they came from. */
function tracesFor(sentenceId: string, hl: HighlightedSentence, model: ReturnType<typeof compileGate>): Map<number, TokenTrace[]> {
  const out = new Map<number, TokenTrace[]>();
  const add = (span: Span, trace: TokenTrace, roles?: HighlightRole[]): void => {
    for (const token of hl.tokens) {
      if (token.span[0] < span[0] || token.span[1] > span[1]) continue;
      if (roles !== undefined && !roles.includes(token.role)) continue;
      out.set(token.span[0], [...(out.get(token.span[0]) ?? []), trace]);
    }
  };
  for (const action of model.actions) {
    if (action.sentence !== sentenceId) continue;
    const branch = hl.regions.find((region) => region.kind === 'branch' && region.branch === action.branch);
    const verbSpan: Span = branch?.span ?? [0, hl.text.length];
    add(verbSpan, { owner: action.name, tla: `${action.name}: ${action.actor} ${action.event} ${action.object}` }, ['verb']);
    for (const guard of action.guards) add(guard.span, { owner: action.name, tla: guard.tla });
    for (const effect of action.effects) add(effect.span, { owner: action.name, tla: effect.tla });
  }
  for (const refusal of model.refusals) {
    if (refusal.sentence !== sentenceId) continue;
    add([0, hl.text.length], { owner: refusal.name, tla: `[][${refusal.over.map((over) => over.action).join(' \\/ ') || 'no action'} => ~(guard)]_vars` }, ['modal.refuse', 'verb']);
    for (const guard of refusal.guards) add(guard.span, { owner: refusal.name, tla: guard.tla });
  }
  for (const invariant of model.invariants) {
    if (invariant.sentence !== sentenceId) continue;
    add([0, hl.text.length], { owner: invariant.name, tla: invariant.tla }, ['kw.never', 'kw.always', 'state.test', 'noun.subject']);
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const spec = args[0] === '--spec';
  const { lexicon, inputs } = args[0] === '--session' ? sessionInputs(args[1] ?? '') : spec ? specInputs(args[1] ?? '', args[2] ?? '') : exampleInputs();
  const out = args[0] === '--session' ? args[2] ?? 'gallery.html' : spec ? args[3] ?? 'gallery.html' : args[1] ?? 'gallery.html';
  const title = (args[0] === '--session' ? args[3] : spec ? args[4] : args[2]) ?? 'Canonical sentences, highlighted';
  const parser = chevrotainCanonParser.forLexicon(lexicon);
  const gate = runGate(inputs.map((input) => ({ id: input.id, text: input.text })), lexicon, (text) => parser.parse(text));
  const model = compileGate(gate, lexicon);
  const bySection = new Map<string, string[]>();
  let accepted = 0;
  for (const input of inputs) {
    const gated = gate.sentences.find((sentence) => sentence.id === input.id);
    const parsed = parser.parse(input.text);
    const rules = (gated?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'rule');
    const hl = highlightSentence(input.text, parsed, rules);
    const traces = tracesFor(input.id, hl, model);
    const ok = gated?.status === 'accepted';
    if (ok) accepted += 1;
    let row = `<div class="row ${ok ? 'ok' : 'bad'}"><div class="meta"><code>${esc(input.id)}</code><span class="chip ${ok ? 'ok' : 'bad'}">${ok ? hl.kind : 'dangling'}</span></div><div class="body">`;
    if (input.original !== undefined) {
      const raw = highlightSentence(input.original, parser.parse(input.original));
      row += `<div class="orig"><span class="tag">input</span>${renderSentenceHtml(raw)}</div>`;
    }
    row += `<div class="sent"><span class="tag">${input.original !== undefined ? 'canonical' : ''}</span>`;
    row += `<span class="v v-sem">${renderSentenceHtml(hl, { traces, id: input.id })}</span>`;
    row += `<span class="v v-lex">${renderSentenceHtml(hl, { layer: 'lexical', id: input.id })}</span>`;
    row += `<span class="v v-plain">${esc(input.text)}</span></div>`;
    if (!ok) {
      for (const note of hl.notes) {
        const caret = `${' '.repeat(note.span[0])}${'^'.repeat(Math.max(1, note.span[1] - note.span[0]))}`;
        row += `<pre class="diag"><b>${note.severity === 'syntax' ? 'ERROR' : 'RULE'}</b> ${esc(note.code)}: ${esc(note.message)}${note.expected.length > 0 ? `\n<span class="exp">expected: ${esc(note.expected.slice(0, 12).join(', '))}${note.expected.length > 12 ? ', …' : ''}</span>` : ''}\n<span class="src">${esc(input.text)}</span>\n<span class="caret">${esc(caret)}</span></pre>`;
      }
      const draft = gated?.draft;
      if (draft !== undefined) {
        const dhl = highlightSentence(draft.text, parser.parse(draft.text));
        row += `<div class="draft"><span class="tag">draft ${draft.parses ? '✓ parses' : '✗ still dangling'}${draft.needsConfirm ? ' · confirm' : ''}${draft.dropped.length > 0 ? ` · drops “${esc(draft.dropped.join(' '))}”` : ''}</span>${renderSentenceHtml(dhl)}</div>`;
      }
    }
    row += '</div></div>';
    const list = bySection.get(input.section) ?? [];
    list.push(row);
    bySection.set(input.section, list);
  }
  const sections = [...bySection].map(([section, rows]) => `<section><h2>${esc(section)}</h2>${rows.join('')}</section>`).join('');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CNL highlight gallery</title>
<style>
:root { --bg: #f6f7f9; --panel: #fff; --ink: #111827; --muted: #5b6472; --line: #e2e5ea; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f1115; --panel: #171a21; --ink: #e5e7eb; --muted: #9aa3b2; --line: #2a2f3a; } }
:root[data-theme="dark"] { --bg: #0f1115; --panel: #171a21; --ink: #e5e7eb; --muted: #9aa3b2; --line: #2a2f3a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.75 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--panel); border-bottom: 1px solid var(--line); padding: 10px 16px; }
header h1 { font-size: 17px; margin: 0 0 4px; }
.stats { color: var(--muted); font-size: 13px; }
.controls { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 6px 0; font-size: 13px; }
.controls label { cursor: pointer; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 13px; }
.lg b { color: var(--muted); font-weight: 600; margin-right: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
main { max-width: 1100px; margin: 0 auto; padding: 8px 16px 90px; }
h2 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 22px 0 6px; }
.row { display: flex; gap: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin-bottom: 6px; }
.row.bad { border-left: 3px solid #dc2626; }
.meta { width: 84px; flex: none; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.meta code { color: var(--muted); }
.chip { font-size: 10.5px; border-radius: 999px; padding: 0 7px; width: fit-content; border: 1px solid var(--line); color: var(--muted); }
.chip.bad { color: #dc2626; border-color: #fca5a5; }
.body { flex: 1; min-width: 0; }
.tag { display: inline-block; min-width: 0; font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-right: 8px; }
.tag:empty { display: none; }
.orig { opacity: .82; font-size: 14px; border-bottom: 1px dashed var(--line); padding-bottom: 3px; margin-bottom: 3px; }
.draft { margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--line); }
pre.diag { margin: 6px 0 2px; padding: 6px 9px; background: var(--bg); border-radius: 6px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; overflow-x: auto; }
pre.diag b { color: #dc2626; }
pre.diag .exp { color: var(--muted); white-space: pre-wrap; }
pre.diag .caret { color: #dc2626; font-weight: 700; }
.v-lex, .v-plain { display: none; }
body.layer-lex .v-sem, body.layer-plain .v-sem { display: none; }
body.layer-lex .v-lex { display: inline; } body.layer-plain .v-plain { display: inline; }
#inspector { position: fixed; left: 0; right: 0; bottom: 0; background: var(--panel); border-top: 1px solid var(--line); padding: 8px 16px; font-size: 13px; min-height: 56px; }
#inspector code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
#inspector .muted { color: var(--muted); }
.cnl [data-tla] { cursor: help; }
.cnl .hot { outline: 2px solid #f59e0b; outline-offset: 1px; border-radius: 3px; }
@media (max-width: 640px) { .row { flex-direction: column; gap: 2px; } .meta { flex-direction: row; width: auto; } }
${CNL_HIGHLIGHT_CSS}
</style></head>
<body>
<header>
<h1>${esc(title)}</h1>
<div class="stats">${inputs.length} sentences, ${accepted} accepted, ${inputs.length - accepted} dangling. Highlighting comes from the Chevrotain lexer and the parse tree that <code>clew spec canon check</code> uses.</div>
<div class="controls">
<span>Layer:</span>
<label><input type="radio" name="layer" value="sem" checked> semantic (tree roles)</label>
<label><input type="radio" name="layer" value="lex"> lexical only (tokens)</label>
<label><input type="radio" name="layer" value="plain"> plain</label>
<label><input type="checkbox" id="layout"> one branch per line</label>
<label><input type="checkbox" id="dark"> dark</label>
</div>
<div class="legend">${legend()}</div>
</header>
<main>${sections}</main>
<div id="inspector"><span class="muted">Hover a word: its role, and the TLA+ it compiles to.</span></div>
<script>
document.querySelectorAll('input[name=layer]').forEach(function (input) {
  input.addEventListener('change', function () { document.body.className = document.body.className.replace(/layer-\\w+/g, '') + ' layer-' + input.value; });
});
document.getElementById('layout').addEventListener('change', function (event) { document.querySelectorAll('.v-sem > .cnl').forEach(function (el) { el.classList.toggle('cnl-layout', event.target.checked); }); });
document.getElementById('dark').addEventListener('change', function (event) { document.documentElement.setAttribute('data-theme', event.target.checked ? 'dark' : 'light'); });
var inspector = document.getElementById('inspector');
document.addEventListener('mouseover', function (event) {
  var el = event.target.closest && event.target.closest('.cnl [data-role]');
  document.querySelectorAll('.hot').forEach(function (hot) { hot.classList.remove('hot'); });
  if (!el) return;
  var root = el.closest('.cnl');
  var lines = (el.getAttribute('title') || '').split('\\n');
  var html = '<b>' + el.textContent + '</b> <span class="muted">' + lines[0] + '</span>';
  for (var i = 1; i < lines.length; i++) html += '<br><code>' + lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code>';
  inspector.innerHTML = html;
  var tla = el.getAttribute('data-tla');
  if (tla) root.querySelectorAll('[data-tla]').forEach(function (other) { if (other.getAttribute('data-tla') === tla) other.classList.add('hot'); });
});
</script>
</body></html>`;
  writeFileSync(out, html);
  console.log(`${out}: ${inputs.length} sentences, ${accepted} accepted`);
}

main();
