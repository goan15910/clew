// Use case: propose draft facts from entities and tokens.
import { hasBlocking, type Finding, type SpecSnapshot } from '../domain/spec.js';
import { proposeFacts, sameFacts } from '../domain/spec-facts.js';
import type { Outcome, SpecFactsDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { factViews } from './spec-views.js';

export interface ProposeFactsCommand {
  sessionId?: string;
  sentenceId?: string;
}

export function proposeSpecFacts(command: ProposeFactsCommand, store: SpecStore): Outcome<SpecFactsDocument> {
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid('session', resolved.message);
  let problem: string | undefined;
  let findings: Finding[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (!hasCurrentTokens(current)) {
      problem = 'no tokens; run clew spec tag first';
      return undefined;
    }
    if (current.entities === undefined) {
      problem = 'no entities; run clew spec entities list first';
      return undefined;
    }
    if (command.sentenceId !== undefined && !hasSentence(current, command.sentenceId)) {
      problem = `unknown sentence "${command.sentenceId}"`;
      return undefined;
    }
    const proposed = proposeFacts(current.sentences, current.tagged, current.entities, current.facts ?? [], command.sentenceId);
    findings = proposed.findings;
    if (sameFacts(current.facts, proposed.facts)) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.facts = proposed.facts;
    const ids: string[] = [];
    for (const fact of proposed.facts) {
      if (fact.removed !== true) ids.push(fact.id);
    }
    const args: { session: string; sentence?: string } = { session: current.id };
    if (command.sentenceId !== undefined) args.sentence = command.sentenceId;
    return {
      snapshot,
      history: { at: now, command: 'spec.facts.propose', args, before: ids, after: ids },
    };
  });
  if (!result.ok) return invalid(result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid('session', problem);
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: 'spec.facts.propose',
      ok: true,
      session: result.snapshot.id,
      facts: factViews(result.snapshot.facts ?? []),
      findings,
      issues: [],
    },
  };
}

function hasCurrentTokens(snapshot: SpecSnapshot): boolean {
  for (const item of snapshot.tagged) {
    if (item.status === 'current' && item.tokens.length > 0) return true;
  }
  return false;
}

function hasSentence(snapshot: SpecSnapshot, id: string): boolean {
  for (const sentence of snapshot.sentences) {
    if (sentence.id === id && sentence.status === 'current') return true;
  }
  return false;
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specPath: current.specPath,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
    entities: current.entities,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  return snapshot;
}

function invalid(fault: SpecFactsDocument['fault'], message: string): Outcome<SpecFactsDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'spec.facts.propose',
      ok: false,
      fault,
      findings: [],
      issues: [specInput(undefined, message)],
    },
  };
}
