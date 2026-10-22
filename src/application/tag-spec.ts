// Use case: tag current sentences through PosTaggerPort and store the tokens.
import {
  currentSentences,
  hasAgentTokens,
  hasBlocking,
  sameTagged,
  staleFindings,
  tagFindings,
  taggerVersionFinding,
  taggingDiffers,
  tokensFromTagging,
  type Finding,
  type Sentence,
  type SpecSnapshot,
  type TaggedSentence,
  type Token,
} from '../domain/spec.js';
import { specInput, type Outcome, type SpecTaggedView, type SpecTagDocument, type SpecTokenView } from './documents.js';
import type { PosTaggerPort, SpecStore } from './ports.js';

export interface TagSpecCommand {
  sessionId?: string;
  sentenceId?: string;
}

export function tagSpec(command: TagSpecCommand, store: SpecStore, tagger: PosTaggerPort): Outcome<SpecTagDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let unknownSentence = false;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    const live = currentSentences(current.sentences);
    if (command.sentenceId !== undefined && !includesId(live, command.sentenceId)) {
      unknownSentence = true;
      return undefined;
    }
    const existing = new Map<string, TaggedSentence>();
    for (const item of current.tagged) existing.set(item.id, item);
    const replacements = new Map<string, TaggedSentence>();
    const produced: Finding[] = [];
    for (const sentence of live) {
      if (command.sentenceId !== undefined && sentence.id !== command.sentenceId) continue;
      const tagging = tagger.tag(sentence.text);
      const tokens = tokensFromTagging(sentence, tagging);
      const previous = existing.get(sentence.id);
      if (hasAgentTokens(previous) && previous !== undefined) {
        if (taggingDiffers(previous, tagging.clauses, tokens)) {
          produced.push({
            id: `conflict:${sentence.id}`,
            kind: 'conflict',
            code: 'agent-tokens',
            severity: 'warning',
            message: `${sentence.id} has agent-edited tokens; the tagger did not overwrite them`,
            refs: [sentence.id],
          });
        }
        for (const finding of tagFindings(sentence.id, sentence.text, previous.tokens, previous.clauses)) produced.push(finding);
        continue;
      }
      const clauses: string[] = [];
      for (const clause of tagging.clauses) clauses.push(clause);
      replacements.set(sentence.id, { id: sentence.id, status: 'current', clauses, tokens });
      for (const finding of tagFindings(sentence.id, sentence.text, tokens, clauses)) produced.push(finding);
    }
    const versionFinding = taggerVersionFinding(current.tagger, { name: tagger.name, version: tagger.version });
    if (versionFinding !== undefined) produced.push(versionFinding);
    for (const finding of staleFindings(current.sentences)) produced.push(finding);
    findings = produced;
    const tagged = mergeTagged(current.sentences, current.tagged, replacements);
    const taggerSame = current.tagger !== undefined && current.tagger.name === tagger.name && current.tagger.version === tagger.version;
    if (sameTagged(current.tagged, tagged) && taggerSame) return undefined;
    const now = new Date().toISOString();
    const snapshot: SpecSnapshot = {
      schemaVersion: current.schemaVersion,
      id: current.id,
      specPath: current.specPath,
      specHash: current.specHash,
      tagger: { name: tagger.name, version: tagger.version },
      created: current.created,
      updated: now,
      sentences: current.sentences,
      tagged,
    };
    const touched: string[] = [];
    for (const sentence of live) {
      if (command.sentenceId === undefined || sentence.id === command.sentenceId) touched.push(sentence.id);
    }
    const history: { spec?: string; session: string; sentence?: string } = { session: current.id };
    if (command.sentenceId !== undefined) history.sentence = command.sentenceId;
    return {
      snapshot,
      history: {
        at: now,
        command: 'spec.tag',
        args: history,
        before: touched,
        after: touched,
      },
    };
  });
  if (!result.ok) {
    const fault = result.fault === 'missing' ? 'session' : result.fault;
    return invalid(fault, result.message);
  }
  if (unknownSentence) return invalid('session', `unknown sentence "${command.sentenceId ?? ''}"`);
  const targets = targeted(result.snapshot, command.sentenceId);
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.tag',
      ok: true,
      session: result.snapshot.id,
      tagger: { name: tagger.name, version: tagger.version },
      sentences: taggedViews(targets, result.snapshot.tagged),
      findings,
      issues: [],
    },
  };
}

function resolveSession(store: SpecStore, requested: string | undefined): { ok: true; id: string } | { ok: false; message: string } {
  const sessions = store.listSessions();
  if (requested !== undefined) {
    for (const session of sessions) {
      if (session.id === requested) return { ok: true, id: requested };
    }
    return { ok: false, message: `no spec session "${requested}"` };
  }
  const only = sessions[0];
  if (sessions.length === 0 || only === undefined) return { ok: false, message: 'no spec session; run clew spec init first' };
  if (sessions.length > 1) {
    const ids: string[] = [];
    for (const session of sessions) ids.push(session.id);
    return { ok: false, message: `more than one spec session; pass --session. Open sessions: ${ids.join(', ')}` };
  }
  return { ok: true, id: only.id };
}

function includesId(sentences: readonly Sentence[], id: string): boolean {
  for (const sentence of sentences) {
    if (sentence.id === id) return true;
  }
  return false;
}

function mergeTagged(
  sentences: readonly Sentence[],
  existing: readonly TaggedSentence[],
  replacements: ReadonlyMap<string, TaggedSentence>,
): TaggedSentence[] {
  const byId = new Map<string, TaggedSentence>();
  for (const item of existing) byId.set(item.id, item);
  for (const [id, item] of replacements) byId.set(id, item);
  const tagged: TaggedSentence[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const item = byId.get(sentence.id);
    if (item === undefined) continue;
    tagged.push(item);
    seen.add(item.id);
  }
  for (const item of existing) {
    if (seen.has(item.id)) continue;
    tagged.push(byId.get(item.id) ?? item);
  }
  return tagged;
}

function targeted(snapshot: SpecSnapshot, sentenceId: string | undefined): Sentence[] {
  const sentences: Sentence[] = [];
  for (const sentence of currentSentences(snapshot.sentences)) {
    if (sentenceId === undefined || sentence.id === sentenceId) sentences.push(sentence);
  }
  return sentences;
}

function taggedViews(sentences: readonly Sentence[], tagged: readonly TaggedSentence[]): SpecTaggedView[] {
  const byId = new Map<string, TaggedSentence>();
  for (const item of tagged) byId.set(item.id, item);
  const views: SpecTaggedView[] = [];
  for (const sentence of sentences) {
    const item = byId.get(sentence.id);
    const clauses: string[] = [];
    const tokens: SpecTokenView[] = [];
    if (item !== undefined) {
      for (const clause of item.clauses) clauses.push(clause);
      for (const token of item.tokens) tokens.push(tokenView(token));
    }
    views.push({
      id: sentence.id,
      text: sentence.text,
      section: sentence.section,
      clauses,
      tokens,
    });
  }
  return views;
}

function tokenView(token: Token): SpecTokenView {
  const tags: string[] = [];
  for (const tag of token.tags) tags.push(tag);
  return {
    id: token.id,
    text: token.text,
    tags,
    span: [token.span[0], token.span[1]],
    origin: token.origin,
  };
}

function invalid(fault: SpecTagDocument['fault'], message: string): Outcome<SpecTagDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.tag',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(undefined, message)],
    },
  };
}
