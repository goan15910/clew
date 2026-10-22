// The only file that imports compromise. Parts of speech for one sentence.
import nlp from 'compromise';
import type { PosTaggerPort } from '../../application/ports.js';
import type { PosTagging, PosToken } from '../../domain/spec.js';

interface RawTerm {
  text?: unknown;
  tags?: unknown;
  offset?: { start?: unknown; length?: unknown };
}

interface RawSentence {
  terms?: RawTerm[];
}

function tagList(tags: unknown): string[] {
  const list: string[] = [];
  const values = tags instanceof Set ? [...tags] : Array.isArray(tags) ? tags : [];
  for (const tag of values) {
    if (typeof tag === 'string') list.push(tag);
  }
  return list;
}

export const compromiseTagger: PosTaggerPort = {
  name: 'compromise',
  version: nlp.version,
  tag(text: string): PosTagging {
    const doc = nlp(text);
    const parsed: unknown = doc.sentences().json({ terms: { tags: true, offset: true } });
    const sentences = Array.isArray(parsed) ? parsed as RawSentence[] : [];
    const tokens: PosToken[] = [];
    let cursor = 0;
    for (const sentence of sentences) {
      const terms = Array.isArray(sentence.terms) ? sentence.terms : [];
      for (const term of terms) {
        if (typeof term.text !== 'string' || term.text === '') continue;
        const tags = tagList(term.tags);
        const offsetStart = typeof term.offset?.start === 'number' ? term.offset.start : undefined;
        const offsetLength = typeof term.offset?.length === 'number' ? term.offset.length : term.text.length;
        if (offsetStart !== undefined && text.slice(offsetStart, offsetStart + offsetLength) === term.text) {
          tokens.push({ text: term.text, tags, start: offsetStart, end: offsetStart + offsetLength });
          cursor = offsetStart + offsetLength;
          continue;
        }
        const found = text.indexOf(term.text, cursor);
        if (found >= 0) {
          tokens.push({ text: term.text, tags, start: found, end: found + term.text.length });
          cursor = found + term.text.length;
          continue;
        }
        tokens.push({ text: term.text, tags, start: cursor, end: cursor });
      }
    }
    const clauseRaw: unknown = doc.clauses().out('array');
    const clauses: string[] = [];
    if (Array.isArray(clauseRaw)) {
      for (const clause of clauseRaw) {
        if (typeof clause === 'string' && clause !== '') clauses.push(clause);
      }
    }
    return { tokens, clauses };
  },
};
