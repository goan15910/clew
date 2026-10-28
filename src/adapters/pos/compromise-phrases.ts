// Optional phrase/chunk extraction for pilots. Compromise only lives in adapters.
// Production tagging still uses compromise-tagger.ts (word tokens + clauses).
import nlp from 'compromise';
import type { PhraseExtraction, PhraseExtractorPort, PhraseLexicon, PhraseUnit } from '../../application/ports.js';

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') out.push(item);
  }
  return out;
}

function unitsFrom(kind: PhraseUnit['kind'], phrases: readonly string[]): PhraseUnit[] {
  const units: PhraseUnit[] = [];
  for (const text of phrases) {
    units.push({ text, kind, words: text.trim().split(/\s+/).length });
  }
  return units;
}

function withLexicon(lexicon: PhraseLexicon | undefined): typeof nlp {
  if (lexicon === undefined) return nlp;
  const words: Record<string, string> = {};
  for (const key of Object.keys(lexicon)) {
    const tag = lexicon[key];
    if (typeof tag === 'string' && tag !== '') words[key] = tag;
  }
  // Plugin mutates the shared factory; pilots should pass a stable lexicon once per process.
  nlp.plugin({ words });
  return nlp;
}

export function createCompromisePhraseExtractor(lexicon?: PhraseLexicon): PhraseExtractorPort {
  const engine = withLexicon(lexicon);
  return {
    name: 'compromise-phrases',
    version: engine.version,
    extract(text: string): PhraseExtraction {
      const doc = engine(text);
      const nouns = asStrings(doc.nouns().out('array'));
      const verbs = asStrings(doc.verbs().out('array'));
      const adjectives = asStrings(doc.adjectives().out('array'));
      const people = asStrings(doc.people().out('array'));
      const chunks = asStrings(doc.chunks().out('array'));
      const clauses = asStrings(doc.clauses().out('array'));
      const pattern = asStrings(doc.match('#Adjective+ #Noun+').out('array'));
      const units: PhraseUnit[] = [
        ...unitsFrom('noun', nouns),
        ...unitsFrom('verb', verbs),
        ...unitsFrom('adjective', adjectives),
        ...unitsFrom('person', people),
        ...unitsFrom('chunk', chunks),
        ...unitsFrom('pattern', pattern),
      ];
      return { units, clauses };
    },
  };
}

/** Default extractor with no custom lexicon. */
export const compromisePhraseExtractor: PhraseExtractorPort = createCompromisePhraseExtractor();
