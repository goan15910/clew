// The first, full scheme from the survey: every role coloured. Kept for comparison; the default is highlight-css.ts.
// The stylesheet for highlighted canonical sentences. Every colour is a custom property, so a host page (the spec
// viewer, the state explorer, an editor) can retheme it, and dark mode is one block of overrides.
//
// The scheme follows what the words do in the model, most important first:
//   1. Result state ("as approved"): a filled pill. It is the effect, the one thing a step changes.
//   2. Verb: bold blue. It names the TLA+ action.
//   3. Structure (when, as, ", or"): small capitals, like SQL's WHERE / AS. They split guard, effect, and branches.
//   4. Polarity (cannot, not, never): red. One word flips the meaning of the whole sentence.
//   5. Actor, object, quantifier: their own hues; states the step needs or tests: outlined or plain green.
//   6. Noise (articles, is, slot words): grey, present but quiet.
export const CNL_HIGHLIGHT_CSS_FULL = `
.cnl {
  --cnl-actor: #0e7490; --cnl-verb: #1d4ed8; --cnl-noun: #6d28d9; --cnl-link: #7e22ce;
  --cnl-state: #15803d; --cnl-state-bg: #dcfce7; --cnl-state-ink: #14532d; --cnl-state-line: #86efac;
  --cnl-quant: #c2410c; --cnl-polar: #b91c1c; --cnl-polar-bg: #fee2e2;
  --cnl-struct: #be185d; --cnl-struct-bg: #fce7f3; --cnl-minor: #64748b; --cnl-noise: #9ca3af;
  --cnl-guard-bg: rgba(250, 204, 21, 0.14); --cnl-guard-line: rgba(202, 138, 4, 0.45);
  --cnl-error: #dc2626; --cnl-warn: #d97706; --cnl-ink: inherit;
  color: var(--cnl-ink);
}
.cnl-actor { color: var(--cnl-actor); font-weight: 600; }
.cnl-verb { color: var(--cnl-verb); font-weight: 700; }
.cnl-verb-extra { color: var(--cnl-error); font-weight: 700; text-decoration: line-through; }
.cnl-noun, .cnl-noun-subject { color: var(--cnl-noun); font-weight: 600; }
.cnl-noun-link, .cnl-noun-slot { color: var(--cnl-link); text-decoration: underline dotted 1px; text-underline-offset: 3px; }
.cnl-state-post { color: var(--cnl-state-ink); background: var(--cnl-state-bg); font-weight: 700; border-radius: 4px; padding: 0 0.28em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.cnl-state-pre { color: var(--cnl-state); border: 1px solid var(--cnl-state-line); border-radius: 4px; padding: 0 0.22em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.cnl-state-test { color: var(--cnl-state); font-weight: 600; }
.cnl-state-init { color: var(--cnl-state-ink); background: var(--cnl-state-bg); font-weight: 700; border-radius: 999px; padding: 0 0.4em; }
.cnl-state-init::before { content: "\\25CF\\00A0"; font-size: 0.7em; vertical-align: 0.12em; }
.cnl-state-final { color: var(--cnl-state-ink); background: var(--cnl-state-bg); font-weight: 700; border-radius: 999px; padding: 0 0.4em; outline: 3px double var(--cnl-state); outline-offset: 1px; margin: 0 0.2em; }
.cnl-quantifier { color: var(--cnl-quant); font-weight: 700; }
.cnl-article { color: var(--cnl-noise); }
.cnl-kw-guard, .cnl-kw-effect, .cnl-kw-branch, .cnl-kw-after, .cnl-kw-decl {
  color: var(--cnl-struct); font-weight: 700; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.05em;
}
.cnl-kw-branch { background: var(--cnl-struct-bg); border-radius: 3px; padding: 0 0.15em; }
.cnl-kw-join { color: var(--cnl-struct); font-weight: 600; }
.cnl-kw-logic, .cnl-kw-is, .cnl-kw-slot { color: var(--cnl-minor); }
.cnl-kw-not, .cnl-kw-never { color: var(--cnl-polar); font-weight: 700; }
.cnl-kw-always { color: var(--cnl-struct); font-weight: 700; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.05em; }
.cnl-kw-never { text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.05em; }
.cnl-modal-refuse { color: var(--cnl-polar); background: var(--cnl-polar-bg); font-weight: 700; border-radius: 4px; padding: 0 0.25em; }
.cnl-modal-permit { color: var(--cnl-minor); font-style: italic; }
.cnl-term { color: var(--cnl-noun); }
.cnl-word { color: inherit; }
.cnl-punct { color: var(--cnl-minor); }
.cnl-declared { text-decoration-line: underline; text-decoration-style: solid; text-decoration-thickness: 1px; text-decoration-color: currentColor; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.cnl-region.cnl-guard { background: var(--cnl-guard-bg); border-bottom: 1px dashed var(--cnl-guard-line); border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.cnl-error { text-decoration: underline wavy var(--cnl-error) 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.cnl-warn { text-decoration: underline wavy var(--cnl-warn) 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.cnl-eol { color: var(--cnl-error); }
/* Block layout: one branch per line, like a formatted SQL statement. */
.cnl-layout .cnl-region.cnl-branch { display: block; position: relative; padding-left: 1.9em; }
.cnl-layout .cnl-region.cnl-branch::before { content: attr(data-branch); position: absolute; left: 0.2em; top: 0.18em; font-size: 0.72em; font-weight: 700; color: var(--cnl-struct); border: 1px solid var(--cnl-struct); border-radius: 999px; width: 1.45em; height: 1.45em; line-height: 1.35em; text-align: center; }
.cnl-layout .cnl-region.cnl-sep { display: block; padding-left: 1.9em; line-height: 1.5; }
/* Lexical layer: what a regex or TextMate highlighter could know. */
.cnl-lexical .cnl-state-test { font-weight: 600; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .cnl {
    --cnl-actor: #67e8f9; --cnl-verb: #93c5fd; --cnl-noun: #c4b5fd; --cnl-link: #d8b4fe;
    --cnl-state: #86efac; --cnl-state-bg: #14532d; --cnl-state-ink: #dcfce7; --cnl-state-line: #22c55e;
    --cnl-quant: #fdba74; --cnl-polar: #fca5a5; --cnl-polar-bg: #450a0a;
    --cnl-struct: #f9a8d4; --cnl-struct-bg: #500724; --cnl-minor: #94a3b8; --cnl-noise: #6b7280;
    --cnl-guard-bg: rgba(250, 204, 21, 0.09); --cnl-guard-line: rgba(250, 204, 21, 0.35);
    --cnl-error: #f87171; --cnl-warn: #fbbf24;
  }
}
:root[data-theme="dark"] .cnl {
  --cnl-actor: #67e8f9; --cnl-verb: #93c5fd; --cnl-noun: #c4b5fd; --cnl-link: #d8b4fe;
  --cnl-state: #86efac; --cnl-state-bg: #14532d; --cnl-state-ink: #dcfce7; --cnl-state-line: #22c55e;
  --cnl-quant: #fdba74; --cnl-polar: #fca5a5; --cnl-polar-bg: #450a0a;
  --cnl-struct: #f9a8d4; --cnl-struct-bg: #500724; --cnl-minor: #94a3b8; --cnl-noise: #6b7280;
  --cnl-guard-bg: rgba(250, 204, 21, 0.09); --cnl-guard-line: rgba(250, 204, 21, 0.35);
  --cnl-error: #f87171; --cnl-warn: #fbbf24;
}
`;
