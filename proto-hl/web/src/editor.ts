// Prototype: a CodeMirror 6 editor for canonical sentences, one per line. CodeMirror owns editing; the colours,
// the squiggles, the quick fixes, and the hover all come from Clew's own parser, gate, and compiler.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { forceLinting, linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { chevrotainCanonParser } from '../../../src/adapters/canon/chevrotain-parser.js';
import { CNL_HIGHLIGHT_CSS } from '../../../src/adapters/canon/highlight-css.js';
import { roleClass, ROLE_LABEL } from '../../../src/adapters/canon/highlight-html.js';
import type { CanonLexicon } from '../../../src/domain/canon-ast.js';
import { compileCanon, type CanonModel } from '../../../src/domain/canon-compile.js';
import { runGate, type GateResult } from '../../../src/domain/canon-gate.js';
import { highlightSentence, type HighlightedSentence } from '../../../src/domain/canon-highlight.js';

interface Analysis {
  lines: { from: number; text: string; hl: HighlightedSentence }[];
  gate: GateResult;
  model: CanonModel;
}

let lexicon: CanonLexicon = { actors: [], terms: [], states: [], verbs: [] };
let parser = chevrotainCanonParser.forLexicon(lexicon);

function analyse(doc: Text): Analysis {
  const inputs: { id: string; text: string; from: number }[] = [];
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (line.text.trim() === '' || line.text.startsWith('#')) continue;
    inputs.push({ id: `L${n}`, text: line.text, from: line.from });
  }
  const gate = runGate(inputs, lexicon, (text) => parser.parse(text));
  const accepted = gate.sentences.filter((s) => s.status === 'accepted' && s.statement !== undefined).map((s) => ({ id: s.id, text: s.text, statement: s.statement! }));
  const model = compileCanon(accepted, lexicon);
  const lines = inputs.map((input) => {
    const gated = gate.sentences.find((s) => s.id === input.id);
    const rules = (gated?.diagnostics ?? []).filter((d) => d.severity === 'rule');
    return { from: input.from, text: input.text, hl: highlightSentence(input.text, parser.parse(input.text), rules) };
  });
  return { lines, gate, model };
}

const relex = StateEffect.define<null>();

const analysisField = StateField.define<Analysis>({
  create: (state) => analyse(state.doc),
  update: (value, tr) => (tr.docChanged || tr.effects.some((e) => e.is(relex)) ? analyse(tr.state.doc) : value),
});

const decorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (_value, tr) => {
    const analysis = tr.state.field(analysisField);
    const builder = new RangeSetBuilder<Decoration>();
    const marks: { from: number; to: number; deco: Decoration }[] = [];
    for (const line of analysis.lines) {
      for (const region of line.hl.regions) {
        if (region.kind === 'guard') marks.push({ from: line.from + region.span[0], to: line.from + region.span[1], deco: Decoration.mark({ class: 'cnl-region cnl-guard' }) });
      }
      for (const token of line.hl.tokens) {
        const cls = [roleClass(token.role), token.declared ? 'cnl-declared' : ''].join(' ');
        marks.push({ from: line.from + token.span[0], to: line.from + token.span[1], deco: Decoration.mark({ class: cls, attributes: { 'data-role': token.role } }) });
      }
    }
    marks.sort((a, b) => a.from - b.from || b.to - a.to);
    for (const mark of marks) builder.add(mark.from, mark.to, mark.deco);
    return builder.finish();
  },
  provide: (field) => EditorView.decorations.from(field),
});

const cnlLinter = linter((view) => {
  const analysis = view.state.field(analysisField);
  const out: CmDiagnostic[] = [];
  for (const sentence of analysis.gate.sentences) {
    if (sentence.status !== 'dangling') continue;
    const line = analysis.lines.find((l) => `L${view.state.doc.lineAt(l.from).number}` === sentence.id);
    if (line === undefined) continue;
    const draft = sentence.draft;
    for (const d of sentence.diagnostics) {
      const from = line.from + Math.min(d.span[0], line.text.length);
      const to = line.from + Math.min(Math.max(d.span[1], d.span[0] + 1), line.text.length);
      out.push({
        from: Math.min(from, to),
        to,
        severity: d.severity === 'syntax' ? 'error' : 'warning',
        source: d.code,
        message: `${d.message}${d.expected.length > 0 ? `\nexpected: ${d.expected.slice(0, 10).join(', ')}` : ''}${draft !== undefined ? `\ndraft: ${draft.text}` : ''}`,
        actions: draft !== undefined && draft.parses ? [{
          name: 'Use draft',
          apply: (v, _from, _to) => v.dispatch({ changes: { from: line.from, to: line.from + line.text.length, insert: draft.text } }),
        }] : [],
      });
    }
  }
  return out;
}, { delay: 150 });

const hover = hoverTooltip((view, pos) => {
  const analysis = view.state.field(analysisField);
  const line = analysis.lines.find((l) => pos >= l.from && pos <= l.from + l.text.length);
  if (line === undefined) return null;
  const at = pos - line.from;
  const token = line.hl.tokens.find((t) => at >= t.span[0] && at <= t.span[1]);
  if (token === undefined) return null;
  const id = `L${view.state.doc.lineAt(line.from).number}`;
  const tla: string[] = [];
  for (const action of analysis.model.actions) {
    if (action.sentence !== id) continue;
    if (token.role === 'verb' && (token.branch === undefined || token.branch === action.branch)) tla.push(`action ${action.name}`);
    for (const item of [...action.guards, ...action.effects]) if (token.span[0] >= item.span[0] && token.span[1] <= item.span[1]) tla.push(item.tla);
  }
  for (const inv of analysis.model.invariants) if (inv.sentence === id && token.role !== 'article') tla.push(inv.tla);
  return {
    pos: line.from + token.span[0],
    end: line.from + token.span[1],
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cnl-tip';
      dom.innerHTML = `<b>${token.text}</b> <span>${ROLE_LABEL[token.role]}</span>${[...new Set(tla)].map((t) => `<code>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`).join('')}`;
      return { dom };
    },
  };
});

const theme = EditorView.theme({
  '&': { fontSize: '14.5px', background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: '8px' },
  '.cm-content': { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', lineHeight: '1.9' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip-lint': { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: '6px' },
});

export function mountEditor(parent: HTMLElement, doc: string, initial: CanonLexicon, lexiconBox: HTMLTextAreaElement | null): EditorView {
  lexicon = initial;
  parser = chevrotainCanonParser.forLexicon(lexicon);
  const style = document.createElement('style');
  style.textContent = `${CNL_HIGHLIGHT_CSS}
.cm-content { --cnl-actor: #0e7490; }
.cnl-tip { padding: 6px 9px; max-width: 520px; font-size: 13px; }
.cnl-tip span { color: var(--muted); }
.cnl-tip code { display: block; margin-top: 3px; font: 12px ui-monospace, Menlo, Consolas, monospace; }`;
  document.head.appendChild(style);
  parent.classList.add('cnl');
  const extensions: Extension[] = [lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), analysisField, decorations, cnlLinter, lintGutter(), hover, theme, EditorView.lineWrapping];
  const view = new EditorView({ doc, extensions, parent });
  if (lexiconBox !== null) {
    lexiconBox.value = JSON.stringify(initial, null, 1);
    lexiconBox.addEventListener('input', () => {
      try {
        lexicon = JSON.parse(lexiconBox.value) as CanonLexicon;
        parser = chevrotainCanonParser.forLexicon(lexicon);
        lexiconBox.classList.remove('bad');
        view.dispatch({ effects: relex.of(null) });
        forceLinting(view);
      } catch {
        lexiconBox.classList.add('bad');
      }
    });
  }
  return view;
}
