// Use case: add, edit, or delete a sentence. An edit drops what was derived from that
// sentence and rebuilds it: re-tag, fresh 1:1 spans, then concepts and frames.
import { rebuildLayers } from '../domain/spec-frames.js';
import { overlayGraph } from '../domain/spec-graph.js';
import { applySentenceEdit, type SentenceEdit } from '../domain/spec-sentences.js';
import { replaceSentenceSpans } from '../domain/spec-spans.js';
import {
  hasBlocking,
  liveSentence,
  liveSentences,
  sentenceState,
  splitSpec,
  tagFindings,
  type Finding,
  type Sentence,
  type SpecHistoryArgs,
  type SpecSnapshot,
  type TaggedSentence,
} from '../domain/spec.js';
import { specInput, type Outcome, type SpecSentenceRecordView, type SpecSentencesDocument } from './documents.js';
import type { PosTaggerPort, SpecStore, SpecTextSource } from './ports.js';
import { resolveSession } from './spec-session.js';
import { tagTokens } from './tag-spec.js';

export interface EditSentenceCommand {
  action: 'add' | 'edit' | 'delete';
  sessionId?: string;
  id?: string;
  after?: string;
  text?: string;
  reason: string;
  finding?: string;
  comment?: string;
  by?: string;
}

export const DEFAULT_AUTHOR = 'agent';

export function editSentence(
  command: EditSentenceCommand,
  store: SpecStore,
  tagger: PosTaggerPort,
  text: Pick<SpecTextSource, 'hash'>,
): Outcome<SpecSentencesDocument> {
  const commandName: SpecSentencesDocument['command'] = `spec.sentences.${command.action}`;
  const edit = toEdit(command, text);
  if (typeof edit === 'string') return invalid(commandName, 'session', edit);
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);
  let problem: string | undefined;
  let written: Sentence | undefined;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    const now = new Date().toISOString();
    const note: Parameters<typeof applySentenceEdit>[2] = { at: now, who: command.by ?? DEFAULT_AUTHOR, reason: command.reason };
    if (command.finding !== undefined) note.finding = command.finding;
    if (command.comment !== undefined) note.comment = command.comment;
    const applied = applySentenceEdit(current.sentences, edit, note);
    if (!applied.ok) {
      problem = applied.message;
      return undefined;
    }
    written = applied.sentence;
    const rebuilt = rebuildSentence(current, applied.sentences, applied.sentence, tagger);
    findings = rebuilt.findings;
    return {
      snapshot: rebuilt.snapshot,
      history: {
        at: now,
        command: commandName,
        args: historyArgs(command, current.id, applied.sentence.id),
        before: command.action === 'add' ? [] : [applied.sentence.id],
        after: applied.sentence.latest === null ? [] : [applied.sentence.id],
      },
    };
  });
  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(commandName, 'session', problem);
  const sentence = written === undefined ? undefined : recordView(written);
  const document: SpecSentencesDocument = { command: commandName, ok: true, session: result.snapshot.id, findings, issues: [] };
  if (sentence !== undefined) document.sentence = sentence;
  return { exit: hasBlocking(findings) ? 'fail' : 'pass', document };
}

export function recordView(sentence: Sentence): SpecSentenceRecordView {
  return {
    id: sentence.id,
    state: sentenceState(sentence),
    original: sentence.original,
    latest: sentence.latest,
    history: sentence.history,
  };
}

function toEdit(command: EditSentenceCommand, text: Pick<SpecTextSource, 'hash'>): SentenceEdit | string {
  if (command.reason.trim() === '') return 'a sentence write needs --reason';
  if (command.action === 'delete') {
    if (command.id === undefined) return 'pass --id';
    return { action: 'delete', id: command.id };
  }
  const raw = command.text?.trim() ?? '';
  const split = splitSpec(raw).sentences;
  const only = split[0];
  if (split.length !== 1 || only === undefined || only.text !== raw) return '--text must be exactly one sentence';
  if (command.action === 'add') {
    const edit: SentenceEdit = { action: 'add', text: raw, hash: text.hash(raw) };
    if (command.after !== undefined) edit.after = command.after;
    return edit;
  }
  if (command.id === undefined) return 'pass --id';
  return { action: 'edit', id: command.id, text: raw, hash: text.hash(raw) };
}

function rebuildSentence(
  current: SpecSnapshot,
  sentences: Sentence[],
  sentence: Sentence,
  tagger: PosTaggerPort,
): { snapshot: SpecSnapshot; findings: Finding[] } {
  const findings: Finding[] = [];
  const tagged: TaggedSentence[] = current.tagged.filter((item) => item.id !== sentence.id);
  if (sentence.latest !== null && current.tagger !== undefined) {
    const live = liveSentence(sentence.id, sentence.latest);
    const { tagging, tokens } = tagTokens(live, tagger);
    const clauses = tagging.clauses.slice();
    tagged.push({ id: sentence.id, status: 'current', clauses, tokens });
    for (const finding of tagFindings(sentence.id, live.text, tokens, clauses)) findings.push(finding);
  }
  const order = new Map<string, number>();
  sentences.forEach((item, index) => order.set(item.id, index));
  tagged.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  const spans = current.spans === undefined && current.tagger === undefined
    ? undefined
    : replaceSentenceSpans(current.spans, tagged, new Set([sentence.id]));
  const live = liveSentences(sentences);
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specHash: current.specHash,
    created: current.created,
    updated: new Date().toISOString(),
    sentences,
    tagged,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  const layers = rebuildLayers(live, spans ?? [], current);
  if (spans !== undefined) snapshot.spans = layers.spans;
  if (layers.concepts !== undefined) snapshot.concepts = layers.concepts;
  if (layers.frames !== undefined) snapshot.frames = layers.frames;
  const overlay = overlayGraph(current.graph);
  if (overlay !== undefined) snapshot.graph = overlay;
  return { snapshot, findings };
}

function historyArgs(command: EditSentenceCommand, session: string, id: string): SpecHistoryArgs {
  const args: SpecHistoryArgs = { session, id, reason: command.reason };
  if (command.text !== undefined) args.text = command.text.trim();
  if (command.after !== undefined) args.after = command.after;
  if (command.finding !== undefined) args.finding = command.finding;
  if (command.by !== undefined) args.by = command.by;
  return args;
}

function invalid(command: SpecSentencesDocument['command'], fault: SpecSentencesDocument['fault'], message: string): Outcome<SpecSentencesDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
