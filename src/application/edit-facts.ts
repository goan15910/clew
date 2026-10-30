// Use case: add, edit, or remove facts. Patches are already plain objects.
import { hasBlocking, type Fact, type Finding, type SpecSnapshot } from '../domain/spec.js';
import { normalizeWord } from '../domain/spec-entities.js';
import {
  applyFactPatch,
  buildFact,
  contradictionFindings,
  copyFact,
  factSignature,
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
    const normalized = normalizeDraft(raw);
    for (const finding of normalized.findings) findings.push(finding);
    const checked = validateFactDraft(normalized.draft, entities ?? []);
    if (checked.findings.some((finding) => finding.severity === 'blocking')) {
      for (const finding of checked.findings) findings.push(finding);
      return { findings, changed: [], removed: [], blocked: true };
    }
    const signature = factSignature({ ...normalized.draft, type: normalized.draft.type ?? 'performs' });
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
  const normalized = normalizeDraft(draft);
  const merged = mergeDraft(draftFrom(current), normalized.draft);
  if (draft.confidence === undefined) delete merged.confidence;
  const checked = validateFactDraft(merged, entities ?? []);
  const findings = [...normalized.findings, ...checked.findings];
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

function normalizeDraft(draft: FactDraft): { draft: FactDraft; findings: Finding[] } {
  const next: FactDraft = {};
  if (draft.type !== undefined) next.type = draft.type;
  if (draft.actor !== undefined) next.actor = draft.actor;
  if (draft.action !== undefined) next.action = draft.action;
  if (draft.object !== undefined) next.object = draft.object;
  if (draft.condition !== undefined) next.condition = draft.condition;
  if (draft.sources !== undefined) next.sources = draft.sources.slice();
  if (draft.note !== undefined) next.note = draft.note;
  if (draft.confidence !== undefined) next.confidence = draft.confidence;
  const findings: Finding[] = [];
  const from = normalizeState(draft.from, 'from', findings);
  const to = normalizeState(draft.to, 'to', findings);
  const state = normalizeState(draft.state, 'state', findings);
  if (from !== undefined) next.from = from;
  if (typeof to === 'string') next.to = to;
  if (typeof state === 'string') next.state = state;
  return { draft: next, findings };
}

function normalizeState(value: string | null | undefined, field: string, findings: Finding[]): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = normalizeWord(value);
  if (normalized.word === undefined) return value;
  if (normalized.changed) {
    findings.push({
      id: `normalized-name:${field}`,
      kind: 'vocabulary',
      code: 'normalized-name',
      severity: 'info',
      message: `${field} normalized to ${normalized.word}`,
      refs: [],
    });
  }
  return normalized.word;
}

function mergeDraft(base: FactDraft, patch: FactDraft): FactDraft {
  const next: FactDraft = {
    type: base.type,
    sources: base.sources?.slice() ?? [],
  };
  if (base.actor !== undefined) next.actor = base.actor;
  if (base.action !== undefined) next.action = base.action;
  if (base.object !== undefined) next.object = base.object;
  if (base.from !== undefined) next.from = base.from;
  if (base.to !== undefined) next.to = base.to;
  if (base.condition !== undefined) next.condition = base.condition;
  if (base.state !== undefined) next.state = base.state;
  if (base.note !== undefined) next.note = base.note;
  if (base.confidence !== undefined) next.confidence = base.confidence;
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.actor !== undefined) next.actor = patch.actor;
  if (patch.action !== undefined) next.action = patch.action;
  if (patch.object !== undefined) next.object = patch.object;
  if (patch.from !== undefined) next.from = patch.from;
  if (patch.to !== undefined) next.to = patch.to;
  if (patch.condition !== undefined) next.condition = patch.condition;
  if (patch.state !== undefined) next.state = patch.state;
  if (patch.note !== undefined) next.note = patch.note;
  if (patch.confidence !== undefined) next.confidence = patch.confidence;
  if (patch.sources !== undefined) next.sources = patch.sources.slice();
  return next;
}

function draftFrom(fact: Fact): FactDraft {
  const draft: FactDraft = { type: fact.type, sources: fact.sources.slice(), confidence: fact.confidence };
  if (fact.actor !== undefined) draft.actor = fact.actor;
  if (fact.action !== undefined) draft.action = fact.action;
  if (fact.object !== undefined) draft.object = fact.object;
  if (fact.from !== undefined) draft.from = fact.from;
  if (fact.to !== undefined) draft.to = fact.to;
  if (fact.condition !== undefined) draft.condition = fact.condition;
  if (fact.state !== undefined) draft.state = fact.state;
  if (fact.note !== undefined) draft.note = fact.note;
  return draft;
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
  if (current.entities !== undefined) snapshot.entities = current.entities;
  return snapshot;
}

function invalid(command: SpecFactsDocument['command'], fault: SpecFactsDocument['fault'], message: string): Outcome<SpecFactsDocument> {
  return {
    exit: 'invalid',
    document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
