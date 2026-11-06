// The only file that imports compromise. Parts of speech for one sentence.
import nlp from 'compromise';
import type { PosTaggerPort } from '../../application/ports.js';
import type { PosTagging, PosToken } from '../../domain/spec.js';

interface RawTerm {
  text?: unknown;
  implicit?: unknown;
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

function verbInfinitive(text: string): string | undefined {
  const infinitive = nlp(text).verbs().toInfinitive().text().trim().toLowerCase();
  if (infinitive === '') return undefined;
  return infinitive;
}

function pastParticiple(lemma: string): string | undefined {
  const forms: unknown = nlp(lemma).verbs().conjugate()[0];
  if (typeof forms !== 'object' || forms === null) return undefined;
  const participle = 'Participle' in forms && typeof forms.Participle === 'string' ? forms.Participle : undefined;
  const past = 'PastTense' in forms && typeof forms.PastTense === 'string' ? forms.PastTense : undefined;
  const form = (participle ?? past ?? '').trim().toLowerCase();
  return form === '' ? undefined : form;
}

/** Contractions expand into a text-less term ("cannot" → "can" + ""), so its tags belong to the written token. */
function foldImplicit(token: PosToken | undefined, tags: readonly string[]): void {
  if (token === undefined) return;
  for (const tag of tags) {
    if (!token.tags.includes(tag)) token.tags.push(tag);
  }
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
        if (term.text === '') {
          foldImplicit(tokens.at(-1), tagList(term.tags));
          continue;
        }
        if (typeof term.text !== 'string') continue;
        const tags = tagList(term.tags);
        const offsetStart = typeof term.offset?.start === 'number' ? term.offset.start : undefined;
        const offsetLength = typeof term.offset?.length === 'number' ? term.offset.length : term.text.length;
        let start = cursor;
        let end = cursor;
        if (offsetStart !== undefined && text.slice(offsetStart, offsetStart + offsetLength) === term.text) {
          start = offsetStart;
          end = offsetStart + offsetLength;
          cursor = end;
        } else {
          const found = text.indexOf(term.text, cursor);
          if (found >= 0) {
            start = found;
            end = found + term.text.length;
            cursor = end;
          } else {
            start = cursor;
            end = cursor;
          }
        }
        const token: PosToken = { text: term.text, tags, start, end };
        if (tags.includes('Verb')) {
          const lemma = verbInfinitive(typeof term.implicit === 'string' ? term.implicit : term.text);
          if (lemma !== undefined) {
            token.lemma = lemma;
            const participle = pastParticiple(lemma);
            if (participle !== undefined) token.participle = participle;
          }
        }
        tokens.push(token);
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
