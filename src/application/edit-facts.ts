// Use case: add, edit, or remove facts. Patches are already plain objects.
import { hasBlocking, type Fact, type Finding, type SpecSnapshot } from '../domain/spec.js';
import {
  applyFactPatch,
  buildFact,
  contradictionFindings,
  copyFact,
  draftFrom,
  factSignature,
  mergeDraft,
  validateFactDraft,
  type FactDraft,
} from '../domain/spec-facts.js';
import type { Outcome, SpecFactsDocument } from './documents.js';
import { specInput } from './documents.js';
import type { SpecStore } from './ports.js';
import { resolveSession } from './spec-session.js';
import { factViews } from './spec-views.js';

export type EditFactsCommand =
  | { action: 'add'; sessionId?: string; drafts: FactDraft[] }
  | { action: 'edit'; sessionId?: string; id: string; draft: FactDraft }
  | { action: 'remove'; sessionId?: string; ids: string[] };

export function editFacts(command: EditFactsCommand, store: SpecStore): Outcome<SpecFactsDocument> {
  const commandName = `spec.facts.${command.action}` as SpecFactsDocument['command'];
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(commandName, 'session', resolved.message);
  let problem: string | undefined;
  let findings: Finding[] = [];
  let changed: string[] = [];
  let removed: string[] = [];
  const result = store.update(resolved.id, { create: false }, (current) => {
    if (current === undefined) return undefined;
    if (current.entities === undefined) {
      problem = 'no entities; run clew spec entities list first';
      return undefined;
    }
    const applied = apply(command, current);
    if (applied.problem !== undefined) {
      problem = applied.problem;
      return undefined;
    }
    findings = applied.findings;
    changed = applied.changed;
    removed = applied.removed;
    if (applied.blocked || applied.facts === undefined) return undefined;
    const now = new Date().toISOString();
    const snapshot = copySnapshot(current, now);
    snapshot.facts = applied.facts;
    const args: { session: string; id?: string; ids?: string[] } = { session: current.id };
    if (command.action === 'edit') args.id = command.id;
    if (command.action !== 'edit') args.ids = changed.length > 0 ? changed : removed;
    return {
      snapshot,
      history: {
        at: now,
        command: commandName,
        args,
        before: command.action === 'remove' ? removed : changed,
        after: command.action === 'remove' ? [] : changed,
      },
    };
  });
  if (!result.ok) return invalid(commandName, result.fault === 'missing' ? 'session' : result.fault, result.message);
  if (problem !== undefined) return invalid(commandName, 'session', problem);
  return {
    exit: hasBlocking(findings) ? 'fail' : 'pass',
    document: {
      command: commandName,
      ok: true,
      session: result.snapshot.id,
      facts: factViews(result.snapshot.facts ?? []),
      changed,
      removed,
      findings,
      issues: [],
    },
  };
}

interface Applied {
  facts?: Fact[];
  findings: Finding[];
  changed: string[];
  removed: string[];
  blocked: boolean;
  problem?: string;
}

function apply(command: EditFactsCommand, current: SpecSnapshot): Applied {
  const entities = current.entities ?? [];
  const facts = current.facts ?? [];
  if (command.action === 'remove') return removeFacts(facts, command.ids);
  if (command.action === 'edit') return editOne(facts, entities, command.id, command.draft);
  return addFacts(facts, entities, command.drafts);
}

function addFacts(facts: readonly Fact[], entities: SpecSnapshot['entities'], drafts: readonly FactDraft[]): Applied {
  const next: Fact[] = [];
  for (const fact of facts) next.push(copyFact(fact));
  const used = new Set<string>();
  for (const fact of next) used.add(fact.id);
  const findings: Finding[] = [];
  const changed: string[] = [];
  for (const raw of drafts) {
    const normalized = { draft: raw, findings: [] as Finding[] };
    for (const finding of normalized.findings) findings.push(finding);
    const checked = validateFactDraft(normalized.draft, entities ?? []);
    if (checked.findings.some((finding) => finding.severity === 'blocking')) {
      for (const finding of checked.findings) findings.push(finding);
      return { findings, changed: [], removed: [], blocked: true };
    }
    const signature = factSignature(buildFact('f0', normalized.draft));
    const existing = findBySignature(next, signature);
    if (existing !== undefined && existing.removed !== true) {
      findings.push({
        id: `contradicting:${existing.id}`,
        kind: 'conflict',
        code: 'contradicting-facts',
        severity: 'blocking',
        message: `${existing.id} already records ${signature}; edit it instead`,
        refs: [existing.id],
      });
      return { findings, changed: [], removed: [], blocked: true };
    }
    if (existing?.removed === true) {
      const revived = buildFact(existing.id, normalized.draft);
      const index = next.findIndex((fact) => fact.id === existing.id);
      if (index >= 0) next[index] = revived;
      changed.push(revived.id);
      continue;
    }
    let number = 1;
    while (used.has(`f${number}`)) number += 1;
    const id = `f${number}`;
    used.add(id);
    next.push(buildFact(id, normalized.draft));
    changed.push(id);
  }
  for (const finding of contradictionFindings(next)) findings.push(finding);
  return { facts: next, findings, changed, removed: [], blocked: false };
}

function editOne(facts: readonly Fact[], entities: SpecSnapshot['entities'], id: string, draft: FactDraft): Applied {
  const current = findFact(facts, id);
  if (current === undefined || current.removed === true) return { findings: [], changed: [], removed: [], blocked: false, problem: `unknown fact "${id}"` };
  const merged = mergeDraft(draftFrom(current), draft);
  if (draft.confidence === undefined) delete merged.confidence;
  const checked = validateFactDraft(merged, entities ?? []);
  const findings = checked.findings.slice();
  if (findings.some((finding) => finding.severity === 'blocking')) return { findings, changed: [], removed: [], blocked: true };
  const patched = applyFactPatch(current, merged);
  const signature = factSignature(patched);
  for (const fact of facts) {
    if (fact.id === id || fact.removed === true) continue;
    if (factSignature(fact) === signature) {
      findings.push({
        id: `contradicting:${fact.id}`,
        kind: 'conflict',
        code: 'contradicting-facts',
        severity: 'blocking',
        message: `${fact.id} already records ${signature}`,
        refs: [id, fact.id],
      });
      return { findings, changed: [], removed: [], blocked: true };
    }
  }
  const next: Fact[] = [];
  for (const fact of facts) next.push(fact.id === id ? patched : copyFact(fact));
  for (const finding of contradictionFindings(next)) findings.push(finding);
  return { facts: next, findings, changed: [id], removed: [], blocked: false };
}

function removeFacts(facts: readonly Fact[], ids: readonly string[]): Applied {
  const missing: string[] = [];
  for (const id of ids) {
    const fact = findFact(facts, id);
    if (fact === undefined || fact.removed === true) missing.push(id);
  }
  if (missing.length > 0) return { findings: [], changed: [], removed: [], blocked: false, problem: `unknown fact "${missing[0] ?? ''}"` };
  const next: Fact[] = [];
  for (const fact of facts) {
    if (!ids.includes(fact.id)) {
      next.push(copyFact(fact));
      continue;
    }
    const removed = copyFact(fact);
    removed.removed = true;
    removed.status = 'stale';
    removed.origin = 'agent';
    next.push(removed);
  }
  return { facts: next, findings: [], changed: [], removed: ids.slice(), blocked: false };
}

function findFact(facts: readonly Fact[], id: string): Fact | undefined {
  for (const fact of facts) {
    if (fact.id === id) return fact;
  }
  return undefined;
}

function findBySignature(facts: readonly Fact[], signature: string): Fact | undefined {
  let removed: Fact | undefined;
  for (const fact of facts) {
    if (factSignature(fact) !== signature) continue;
    if (fact.removed !== true) return fact;
    removed = fact;
  }
  return removed;
}

function copySnapshot(current: SpecSnapshot, updated: string): SpecSnapshot {
  const snapshot: SpecSnapshot = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    specHash: current.specHash,
    created: current.created,
    updated,
    sentences: current.sentences,
    tagged: current.tagged,
  };
  if (current.tagger !== undefined) snapshot.tagger = { name: current.tagger.name, version: current.tagger.version };
  if (current.spans !== undefined) snapshot.spans = current.spans;
  if (current.entities !== undefined) snapshot.entities = current.entities;
  if (current.graph !== undefined) snapshot.graph = current.graph;
  return snapshot;
}

function invalid(command: SpecFactsDocument['command'], fault: SpecFactsDocument['fault'], message: string): Outcome<SpecFactsDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
