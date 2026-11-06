// Agent and human writes to sentences, and the Markdown export of one version.
// Every write records who, why, and the text it left in `latest`.
import {
  copySentence,
  copyText,
  type Revision,
  type Sentence,
  type SentenceText,
} from './spec.js';

export type SentenceEdit =
  | { action: 'add'; text: string; hash: string; after?: string }
  | { action: 'edit'; id: string; text: string; hash: string }
  | { action: 'delete'; id: string };

export type RevisionNote = Omit<Revision<unknown>, 'value'>;

export type SentenceEditResult =
  | { ok: true; sentences: Sentence[]; sentence: Sentence }
  | { ok: false; message: string };

export function applySentenceEdit(sentences: readonly Sentence[], edit: SentenceEdit, note: RevisionNote): SentenceEditResult {
  const next = sentences.map(copySentence);
  if (edit.action === 'add') {
    let slot = next.length;
    let anchor: SentenceText | null = lastText(next);
    if (edit.after !== undefined) {
      const index = next.findIndex((sentence) => sentence.id === edit.after);
      if (index < 0) return { ok: false, message: `unknown sentence "${edit.after}"` };
      slot = index + 1;
      const after = next[index];
      anchor = after === undefined ? null : after.latest ?? after.original;
    }
    const start = anchor === null ? 0 : anchor.span[1] + 1;
    const latest: SentenceText = {
      text: edit.text,
      span: [start, start + edit.text.length],
      hash: edit.hash,
      section: anchor?.section ?? '',
    };
    const sentence: Sentence = { id: freshId(next), original: null, latest, history: [revision(note, latest)] };
    next.splice(slot, 0, sentence);
    return { ok: true, sentences: next, sentence };
  }
  const sentence = next.find((item) => item.id === edit.id);
  if (sentence === undefined) return { ok: false, message: `unknown sentence "${edit.id}"` };
  if (edit.action === 'delete') {
    if (sentence.latest === null) return { ok: false, message: `${edit.id} is already deleted` };
    sentence.latest = null;
    sentence.history.push(revision(note, null));
    return { ok: true, sentences: next, sentence };
  }
  const base = sentence.latest ?? sentence.original;
  const start = base?.span[0] ?? 0;
  const latest: SentenceText = {
    text: edit.text,
    span: [start, start + edit.text.length],
    hash: edit.hash,
    section: base?.section ?? '',
  };
  if (sentence.latest !== null && sentence.latest.hash === latest.hash) {
    return { ok: false, message: `${edit.id} already reads that text` };
  }
  sentence.latest = latest;
  sentence.history.push(revision(note, latest));
  return { ok: true, sentences: next, sentence };
}

/**
 * Markdown for one version. Each sentence is its own paragraph, so `spec init` on the
 * export splits it back into the same sentences. Headings come from the section paths.
 */
export function renderSentences(sentences: readonly Sentence[], version: 'original' | 'latest'): { text: string; count: number } {
  const blocks: string[] = [];
  let section: string[] = [];
  for (const sentence of sentences) {
    const chosen = version === 'original' ? sentence.original : sentence.latest;
    if (chosen === null) continue;
    const path = chosen.section === '' ? [] : chosen.section.split(' / ');
    let shared = 0;
    while (shared < path.length && shared < section.length && path[shared] === section[shared]) shared += 1;
    for (let depth = shared; depth < path.length; depth += 1) blocks.push(`${'#'.repeat(depth + 1)} ${path[depth] ?? ''}`);
    section = path;
    blocks.push(chosen.text);
  }
  const count = sentences.filter((sentence) => (version === 'original' ? sentence.original : sentence.latest) !== null).length;
  return { text: blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`, count };
}

function revision(note: RevisionNote, value: SentenceText | null): Revision<SentenceText | null> {
  const entry: Revision<SentenceText | null> = {
    at: note.at,
    who: note.who,
    reason: note.reason,
    value: value === null ? null : copyText(value),
  };
  if (note.finding !== undefined) entry.finding = note.finding;
  if (note.comment !== undefined) entry.comment = note.comment;
  return entry;
}

function lastText(sentences: readonly Sentence[]): SentenceText | null {
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    const text = sentence?.latest ?? sentence?.original ?? null;
    if (text !== null) return text;
  }
  return null;
}

function freshId(sentences: readonly Sentence[]): string {
  const used = new Set<string>();
  for (const sentence of sentences) used.add(sentence.id);
  let number = 1;
  while (used.has(`s${number}`)) number += 1;
  return `s${number}`;
}
