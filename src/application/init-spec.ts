// Use case: split a Markdown spec into sentences and open or refresh a session.
import { basename } from 'node:path';
import { sameConcepts } from '../domain/spec-concepts.js';
import { rebuildLayers, sameFrames } from '../domain/spec-frames.js';
import { retainValidSpans, sameSpans } from '../domain/spec-spans.js';
import {
  SPEC_SCHEMA_VERSION,
  SPEC_SESSION_ID_PATTERN,
  applySpecText,
  hasBlocking,
  initFindings,
  sameSentences,
  sameTagged,
  sentenceIds,
  splitSpec,
  sentenceFindings,
  type SentenceDraft,
  type SpecSnapshot,
  liveSentences,
} from '../domain/spec.js';
import { specInput, type Outcome, type SpecInitDocument, type SpecSentenceView } from './documents.js';
import type { SpecStore, SpecTextSource } from './ports.js';

export interface InitSpecCommand {
  file: string;
  sessionId?: string;
}

export function initSpec(command: InitSpecCommand, text: SpecTextSource, store: SpecStore): Outcome<SpecInitDocument> {
  const read = text.read(command.file);
  if (!read.ok) return invalid(command.file, 'unreadable', read.message);
  const split = splitSpec(read.spec.text);
  const drafts: SentenceDraft[] = [];
  for (const sentence of split.sentences) {
    drafts.push({
      text: sentence.text,
      span: [sentence.span[0], sentence.span[1]],
      hash: text.hash(sentence.text),
      section: sentence.section,
    });
  }
  const id = allocateSessionId(read.spec.path, command.sessionId);
  const result = store.update(id, { create: true }, (current) => {
    const now = new Date().toISOString();
    const applied = applySpecText(current?.sentences ?? [], current?.tagged ?? [], drafts, now);
    const retained = retainValidSpans(current?.spans, applied.tagged);
    const layers = rebuildLayers(liveSentences(applied.sentences), retained ?? [], current ?? {});
    const spans = retained === undefined ? undefined : layers.spans;
    const snapshot: SpecSnapshot = {
      schemaVersion: SPEC_SCHEMA_VERSION,
      id,
      specHash: read.spec.hash,
      created: current?.created ?? now,
      updated: now,
      sentences: applied.sentences,
      tagged: applied.tagged,
    };
    if (current?.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
    if (spans !== undefined) snapshot.spans = spans;
    if (layers.concepts !== undefined) snapshot.concepts = layers.concepts;
    if (layers.frames !== undefined) snapshot.frames = layers.frames;
    if (current?.graph !== undefined) snapshot.graph = current.graph;
    if (
      current !== undefined
      && current.specHash === snapshot.specHash
      && sameSentences(current.sentences, snapshot.sentences)
      && sameTagged(current.tagged, snapshot.tagged)
      && sameSpans(current.spans, snapshot.spans)
      && sameConcepts(current.concepts, snapshot.concepts)
      && sameFrames(current.frames, snapshot.frames)
    ) {
      return undefined;
    }
    const before = current === undefined ? [] : sentenceIds(current.sentences);
    return {
      snapshot,
      history: {
        at: now,
        command: 'spec.init',
        args: { session: id },
        before,
        after: sentenceIds(snapshot.sentences),
      },
    };
  });
  if (!result.ok) {
    const fault = result.fault === 'missing' ? 'session' : result.fault;
    return invalid(command.file, fault, result.message);
  }
  const findings = [...initFindings(result.snapshot.sentences, split.emptySpans), ...sentenceFindings(result.snapshot.sentences)];
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.init',
      ok: true,
      session: result.snapshot.id,
      spec: command.file,
      specHash: result.snapshot.specHash,
      sentences: sentenceViews(result.snapshot.sentences),
      findings,
      issues: [],
    },
  };
}

function sentenceViews(sentences: SpecSnapshot['sentences']): SpecSentenceView[] {
  const views: SpecSentenceView[] = [];
  for (const sentence of liveSentences(sentences)) {
    views.push({
      id: sentence.id,
      text: sentence.text,
      span: [sentence.span[0], sentence.span[1]],
      hash: sentence.hash,
      section: sentence.section,
    });
  }
  return views;
}

function allocateSessionId(specPath: string, requested: string | undefined): string {
  return requested ?? sessionBase(specPath);
}

function sessionBase(filePath: string): string {
  const stem = basename(filePath).replace(/\.[^.]+$/, '');
  const kebab = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (SPEC_SESSION_ID_PATTERN.test(kebab)) return kebab;
  const prefixed = `s-${kebab}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (SPEC_SESSION_ID_PATTERN.test(prefixed)) return prefixed;
  return 'spec';
}

function invalid(file: string, fault: SpecInitDocument['fault'], message: string): Outcome<SpecInitDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.init',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(file, message)],
    },
  };
}
