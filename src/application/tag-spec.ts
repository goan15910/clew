// Use case: tag current sentences through PosTaggerPort and store the tokens.
import { sameConcepts } from '../domain/spec-concepts.js';
import { rebuildLayers, sameFrames } from '../domain/spec-frames.js';
import { replaceSentenceSpans, sameSpans, validatePartition } from '../domain/spec-spans.js';
import { markSkippedTokens } from '../domain/spec-stop-words.js';
import {
  liveSentences,
  hasAgentTokens,
  hasBlocking,
  sameTagged,
  sentenceFindings,
  tagFindings,
  taggerVersionFinding,
  taggingDiffers,
  tokensFromTagging,
  type Finding,
  type PosTagging,
  type LiveSentence,
  type Sentence,
  type SpecSnapshot,
  type TaggedSentence,
  type Token,
} from '../domain/spec.js';
import { specInput, type Outcome, type SpecTagDocument } from './documents.js';
import type { PosTaggerPort, SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { spanViews, taggedViews } from './spec-views.js';

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
    const live = liveSentences(current.sentences);
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
      const { tagging, tokens } = tagTokens(sentence, tagger);
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
    for (const finding of sentenceFindings(current.sentences)) produced.push(finding);
    findings = produced;
    const tagged = mergeTagged(current.sentences, current.tagged, replacements);
    const replacedSentenceIds = new Set<string>();
    for (const id of replacements.keys()) replacedSentenceIds.add(id);
    const spans = replaceSentenceSpans(current.spans, tagged, replacedSentenceIds);
    const partitionProblem = validatePartition(spans, tagged);
    if (partitionProblem !== undefined) {
      produced.push({
        id: 'span-partition',
        kind: 'conflict',
        code: 'span-partition',
        severity: 'blocking',
        message: partitionProblem,
        refs: [],
      });
      findings = produced;
      return undefined;
    }
    const layers = rebuildLayers(liveSentences(current.sentences), spans, current);
    const taggerSame = current.tagger !== undefined && current.tagger.name === tagger.name && current.tagger.version === tagger.version;
    if (
      sameTagged(current.tagged, tagged)
      && taggerSame
      && sameSpans(current.spans, layers.spans)
      && sameConcepts(current.concepts, layers.concepts)
      && sameFrames(current.frames, layers.frames)
    ) {
      return undefined;
    }
    const now = new Date().toISOString();
    const snapshot: SpecSnapshot = {
      schemaVersion: current.schemaVersion,
      id: current.id,
      specHash: current.specHash,
      tagger: { name: tagger.name, version: tagger.version },
      created: current.created,
      updated: now,
      sentences: current.sentences,
      tagged,
      spans: layers.spans,
    };
    if (layers.concepts !== undefined) snapshot.concepts = layers.concepts;
    if (layers.frames !== undefined) snapshot.frames = layers.frames;
    if (current.graph !== undefined) snapshot.graph = current.graph;
    const before: string[] = [];
    const after: string[] = [];
    for (const sentence of live) {
      if (command.sentenceId !== undefined && sentence.id !== command.sentenceId) continue;
      after.push(sentence.id);
      const previous = existing.get(sentence.id);
      if (previous !== undefined && previous.status === 'current' && previous.tokens.length > 0) before.push(sentence.id);
    }
    const history: { spec?: string; session: string; sentence?: string } = { session: current.id };
    if (command.sentenceId !== undefined) history.sentence = command.sentenceId;
    return {
      snapshot,
      history: {
        at: now,
        command: 'spec.tag',
        args: history,
        before,
        after,
      },
    };
  });
  if (!result.ok) {
    const fault = result.fault === 'missing' ? 'session' : result.fault;
    return invalid(fault, result.message);
  }
  if (unknownSentence) return invalid('session', `unknown sentence "${command.sentenceId ?? ''}"`);
  const targets = targeted(result.snapshot, command.sentenceId);
  const spanFilter = new Set<string>();
  for (const sentence of targets) spanFilter.add(sentence.id);
  const spans = [];
  for (const span of result.snapshot.spans ?? []) {
    const sentenceId = span.firstTokenId.slice(0, span.firstTokenId.indexOf('.'));
    if (spanFilter.has(sentenceId)) spans.push(span);
  }
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.tag',
      ok: true,
      session: result.snapshot.id,
      tagger: { name: tagger.name, version: tagger.version },
      sentences: taggedViews(targets, result.snapshot.tagged),
      spans: spanViews(spans),
      findings,
      issues: [],
    },
  };
}

/** Tag one live sentence. Stop words are marked before 1:1 span promotion; they stay as merge glue. */
export function tagTokens(sentence: LiveSentence, tagger: PosTaggerPort): { tagging: PosTagging; tokens: Token[] } {
  const tagging = tagger.tag(sentence.text);
  return { tagging, tokens: markSkippedTokens(tokensFromTagging(sentence, tagging)) };
}

function includesId(sentences: readonly LiveSentence[], id: string): boolean {
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

function targeted(snapshot: SpecSnapshot, sentenceId: string | undefined): LiveSentence[] {
  const sentences: LiveSentence[] = [];
  for (const sentence of liveSentences(snapshot.sentences)) {
    if (sentenceId === undefined || sentence.id === sentenceId) sentences.push(sentence);
  }
  return sentences;
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
