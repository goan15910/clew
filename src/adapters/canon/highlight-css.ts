// The default stylesheet for highlighted canonical sentences. Deliberately quiet: only three things are marked.
//   * Keywords that give a sentence its shape (when, as, ", or", starts / ends as, always): bold blue.
//   * Objects, the nouns a step moves or a condition tests: green, normal weight.
//   * States, wherever they appear (needed, resulting, tested, initial, final): a soft grey dashed underline.
// Everything else, verbs, actors, negations (cannot, not, never) and conditions included, stays plain text. Errors keep a wavy underline.
// Every colour is a custom property, so a host page can retheme it; dark mode is one block of overrides.
export const CNL_HIGHLIGHT_CSS = `
.cnl { --cnl-keyword: #1d4ed8; --cnl-object: #15803d; --cnl-state-line: rgba(55, 65, 81, 0.6); --cnl-error: #dc2626; --cnl-warn: #d97706; --cnl-muted: #64748b; }
.cnl-kw-guard, .cnl-kw-effect, .cnl-kw-branch, .cnl-kw-decl, .cnl-kw-always, .cnl-kw-after { color: var(--cnl-keyword); font-weight: 700; }
.cnl-noun, .cnl-noun-subject, .cnl-noun-link, .cnl-noun-slot { color: var(--cnl-object); }
.cnl-state-pre, .cnl-state-post, .cnl-state-test, .cnl-state-init, .cnl-state-final {
  text-decoration: underline dashed var(--cnl-state-line) 1.5px; text-underline-offset: 4px; text-decoration-skip-ink: none;
}
.cnl-error { text-decoration: underline wavy var(--cnl-error) 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.cnl-warn { text-decoration: underline wavy var(--cnl-warn) 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.cnl-eol { color: var(--cnl-error); }
/* One branch per line, like a formatted SQL statement. */
.cnl-layout .cnl-region.cnl-branch { display: block; position: relative; padding-left: 1.9em; }
.cnl-layout .cnl-region.cnl-branch::before { content: attr(data-branch); position: absolute; left: 0.2em; top: 0.18em; font-size: 0.72em; font-weight: 700; color: var(--cnl-muted); border: 1px solid var(--cnl-muted); border-radius: 999px; width: 1.45em; height: 1.45em; line-height: 1.35em; text-align: center; }
.cnl-layout .cnl-region.cnl-sep { display: block; padding-left: 1.9em; line-height: 1.5; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .cnl { --cnl-keyword: #93c5fd; --cnl-object: #86efac; --cnl-state-line: rgba(209, 213, 219, 0.6); --cnl-error: #f87171; --cnl-warn: #fbbf24; --cnl-muted: #94a3b8; }
}
:root[data-theme="dark"] .cnl { --cnl-keyword: #93c5fd; --cnl-object: #86efac; --cnl-state-line: rgba(209, 213, 219, 0.6); --cnl-error: #f87171; --cnl-warn: #fbbf24; --cnl-muted: #94a3b8; }
`;
