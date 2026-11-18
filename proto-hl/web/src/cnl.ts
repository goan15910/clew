// Browser entry: the real Chevrotain parser, the gate, the compiler and the highlighter, bundled as one script.
import { chevrotainCanonParser } from '../../../src/adapters/canon/chevrotain-parser.js';
import { CNL_HIGHLIGHT_CSS } from '../../../src/adapters/canon/highlight-css.js';
import { renderSentenceHtml, roleClass, ROLE_LABEL } from '../../../src/adapters/canon/highlight-html.js';
import type { CanonLexicon } from '../../../src/domain/canon-ast.js';
import { compileCanon } from '../../../src/domain/canon-compile.js';
import { runGate } from '../../../src/domain/canon-gate.js';
import { highlightSentence } from '../../../src/domain/canon-highlight.js';

export function createCnl(lexicon: CanonLexicon) {
  const parser = chevrotainCanonParser.forLexicon(lexicon);
  return {
    parse: (text: string) => parser.parse(text),
    highlight: (text: string, rules = []) => highlightSentence(text, parser.parse(text), rules),
    gate: (inputs: { id: string; text: string }[]) => runGate(inputs, lexicon, (text) => parser.parse(text)),
    compile: (accepted: Parameters<typeof compileCanon>[0]) => compileCanon(accepted, lexicon),
  };
}
export { CNL_HIGHLIGHT_CSS, renderSentenceHtml, roleClass, ROLE_LABEL };
