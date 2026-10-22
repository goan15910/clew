// Use case: split a Markdown spec into sentences and open or refresh a session.
import { basename } from 'node:path';
import { reconcileEntities, sameEntities } from '../domain/spec-entities.js';
import { reconcileFacts, sameFacts } from '../domain/spec-facts.js';
import {
  SPEC_SCHEMA_VERSION,
  SPEC_SESSION_ID_PATTERN,
  applySpecText,
  currentSentences,
  hasBlocking,
  initFindings,
  sameSentences,
  sameTagged,
  sentenceIds,
  splitSpec,
  staleFindings,
  type SentenceDraft,
  type SpecSnapshot,
} from '../domain/spec.js';
import { specInput, type Outcome, type SpecInitDocument, type SpecSentenceView } from './documents.js';
import type { SessionRef, SpecStore, SpecTextSource } from './ports.js';

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
  const id = allocateSessionId(read.spec.path, store.listSessions(), command.sessionId);
  const result = store.update(id, { create: true }, (current) => {
    const applied = applySpecText(current?.sentences ?? [], current?.tagged ?? [], drafts);
    const entities = current?.entities === undefined ? undefined : reconcileEntities(applied.sentences, applied.tagged, current.entities);
    const facts = current?.facts === undefined ? undefined : reconcileFacts(applied.sentences, applied.tagged, entities ?? [], current.facts);
    const now = new Date().toISOString();
    const snapshot: SpecSnapshot = {
      schemaVersion: SPEC_SCHEMA_VERSION,
      id,
      specPath: read.spec.path,
      specHash: read.spec.hash,
      created: current?.created ?? now,
      updated: now,
      sentences: applied.sentences,
      tagged: applied.tagged,
    };
    if (current?.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
    if (entities !== undefined) snapshot.entities = entities;
    if (facts !== undefined) snapshot.facts = facts;
    if (
      current !== undefined
      && current.specPath === snapshot.specPath
      && current.specHash === snapshot.specHash
      && sameSentences(current.sentences, snapshot.sentences)
      && sameTagged(current.tagged, snapshot.tagged)
      && sameEntities(current.entities, snapshot.entities)
      && sameFacts(current.facts, snapshot.facts)
    ) {
      return undefined;
    }
    const before = current === undefined ? [] : sentenceIds(current.sentences);
    return {
      snapshot,
      history: {
        at: now,
        command: 'spec.init',
        args: { spec: read.spec.path, session: id },
        before,
        after: sentenceIds(snapshot.sentences),
      },
    };
  });
  if (!result.ok) {
    const fault = result.fault === 'missing' ? 'session' : result.fault;
    return invalid(command.file, fault, result.message);
  }
  const findings = [...initFindings(result.snapshot.sentences, split.emptySpans), ...staleFindings(result.snapshot.sentences)];
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
  for (const sentence of currentSentences(sentences)) {
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

function allocateSessionId(specPath: string, sessions: readonly SessionRef[], requested: string | undefined): string {
  if (requested !== undefined) return requested;
  for (const session of sessions) {
    if (session.specPath === specPath) return session.id;
  }
  const base = sessionBase(specPath);
  const taken = new Set<string>();
  for (const session of sessions) taken.add(session.id);
  if (!taken.has(base)) return base;
  let number = 2;
  while (taken.has(`${base}-${number}`)) number += 1;
  return `${base}-${number}`;
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
