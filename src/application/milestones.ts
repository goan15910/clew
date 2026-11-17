// Use cases of spec versioning: close a milestone over the work since the last one, list the milestones, show one
// with the log entries it covers, and diff any two versions (original, a milestone, latest).
// A milestone records what was done; it is never opened ahead of the work, so no plan is stored.
import type { CanonLexicon } from '../domain/canon-ast.js';
import {
  countCommands,
  diffActions,
  diffLexicon,
  diffSentences,
  liveCount,
  nextMilestoneId,
  type ActionSummary,
  type Milestone,
  type MilestoneDigest,
  type VersionCounts,
} from '../domain/spec-versions.js';
import type { SpecHistoryEntry, SpecSnapshot } from '../domain/spec.js';
import { compileGate, gateSession } from './canon.js';
import { specInput, type MilestoneChangeView, type Outcome, type SpecDiffDocument, type SpecMilestoneDocument } from './documents.js';
import { DEFAULT_AUTHOR } from './edit-sentences.js';
import type { CanonHistoryEntry, CanonParserFactory, CanonState } from './ports.js';
import { resolveSession } from './spec-session.js';
import { originalSnapshot, resolveVersion, type VersionPorts } from './versions.js';

export interface MilestonePorts extends VersionPorts {
  parser: CanonParserFactory;
}

type MilestoneDoc = SpecMilestoneDocument;

function refused(command: MilestoneDoc['command'], fault: NonNullable<MilestoneDoc['fault']>, message: string): Outcome<MilestoneDoc> {
  return { exit: 'invalid', document: { command, ok: false, fault, findings: [], issues: [specInput(undefined, message)] } };
}

function storeFault(fault: 'missing' | 'locked' | 'schema' | 'unreadable' | 'refused'): NonNullable<MilestoneDoc['fault']> {
  return fault === 'missing' ? 'session' : fault;
}

/** Counts and compiled actions of one version. `lexicon` gates it; without one the gate counts stay absent. */
function versionFacts(snapshot: SpecSnapshot, lexicon: CanonLexicon | undefined, parser: CanonParserFactory): { counts: VersionCounts; actions?: ActionSummary[] } {
  const counts: VersionCounts = { live: liveCount(snapshot.sentences) };
  if (snapshot.frames !== undefined) counts.frames = snapshot.frames.filter((frame) => frame.notTransition === undefined).length;
  if (lexicon === undefined) return { counts };
  const gate = gateSession(snapshot, lexicon, parser);
  const model = compileGate(gate, lexicon);
  counts.accepted = gate.sentences.filter((sentence) => sentence.status === 'accepted').length;
  counts.dangling = gate.sentences.filter((sentence) => sentence.status === 'dangling').length;
  counts.actions = model.actions.length;
  const actions = model.actions.map((action) => ({ name: action.name, guards: action.guards.map((item) => item.tla), effects: action.effects.map((item) => item.tla) }));
  return { counts, actions };
}

interface Compared {
  counts: { from: VersionCounts; to: VersionCounts };
  gatedWith: { from?: string; to?: string };
  sentences: ReturnType<typeof diffSentences>;
  lexicon?: ReturnType<typeof diffLexicon>;
  actions?: ReturnType<typeof diffActions>;
}

/**
 * Compare two versions. Each side is gated with its own lexicon; a side that has none (the original spec, or a
 * version from before the first lexicon) is gated with the other side's, so the gate counts still compare.
 */
function compare(from: { ref: string; rank: number; snapshot: SpecSnapshot; canon: CanonState | undefined }, to: typeof from, parser: CanonParserFactory): Compared {
  const fromLexicon = from.canon?.lexicon ?? to.canon?.lexicon;
  const toLexicon = to.canon?.lexicon ?? from.canon?.lexicon;
  const before = versionFacts(from.snapshot, fromLexicon, parser);
  const after = versionFacts(to.snapshot, toLexicon, parser);
  const gatedWith: Compared['gatedWith'] = {};
  if (from.canon === undefined && fromLexicon !== undefined) gatedWith.from = to.ref;
  if (to.canon === undefined && toLexicon !== undefined) gatedWith.to = from.ref;
  const compared: Compared = { counts: { from: before.counts, to: after.counts }, gatedWith, sentences: diffSentences(from.snapshot.sentences, to.snapshot.sentences, to.rank >= from.rank) };
  const lexicon = diffLexicon(from.canon?.lexicon, to.canon?.lexicon);
  if (lexicon !== undefined) compared.lexicon = lexicon;
  if (before.actions !== undefined || after.actions !== undefined) compared.actions = diffActions(before.actions ?? [], after.actions ?? []);
  return compared;
}

function canonCommand(entry: CanonHistoryEntry): string {
  return `spec.canon.${entry.action}`;
}

export function closeMilestone(
  command: { sessionId?: string; title: string; goal: string; decisions: string[]; by?: string },
  ports: MilestonePorts,
): Outcome<MilestoneDoc> {
  const name: MilestoneDoc['command'] = 'spec.milestone.close';
  const resolved = resolveSession(ports.store, command.sessionId);
  if (!resolved.ok) return refused(name, 'session', resolved.message);
  const session = resolved.id;
  const closed = ports.milestones.close(session, (now) => {
    const last = now.milestones[now.milestones.length - 1];
    const history = { from: last?.history.to ?? 0, to: now.history.length };
    const canonHistory = now.canon?.history ?? [];
    const canon = { from: last?.canon.to ?? 0, to: canonHistory.length };
    if (history.from >= history.to && canon.from >= canon.to) {
      return { ok: false, message: `nothing to close: no history line or canonical change since ${last === undefined ? 'the session began' : `milestone ${last.id}`}` };
    }
    let previous: { ref: string; rank: number; snapshot: SpecSnapshot; canon: CanonState | undefined };
    if (last === undefined) {
      previous = { ref: 'original', rank: 0, snapshot: originalSnapshot(now.snapshot), canon: undefined };
    } else {
      const frozen = ports.milestones.read(session, last.id);
      if (!frozen.ok) return { ok: false, message: frozen.message };
      previous = { ref: last.id, rank: Number(last.id.slice(1)), snapshot: frozen.frozen.snapshot, canon: frozen.frozen.canon };
    }
    const id = nextMilestoneId(now.milestones);
    const compared = compare(previous, { ref: id, rank: Number(id.slice(1)), snapshot: now.snapshot, canon: now.canon }, ports.parser);
    const commands = [
      ...now.history.slice(history.from, history.to).map((entry) => entry.command),
      ...canonHistory.slice(canon.from, canon.to).map(canonCommand),
    ];
    const digest: MilestoneDigest = {
      before: compared.counts.from,
      after: compared.counts.to,
      added: compared.sentences.added.map((item) => item.id),
      deleted: compared.sentences.deleted.map((item) => item.id),
      edited: compared.sentences.edited.map((item) => item.id),
      commands: countCommands(commands),
    };
    if (compared.lexicon !== undefined) digest.lexicon = compared.lexicon;
    if (compared.actions !== undefined) digest.actions = compared.actions;
    const milestone: Milestone = {
      id,
      title: command.title,
      goal: command.goal,
      decisions: command.decisions.slice(),
      who: command.by ?? DEFAULT_AUTHOR,
      at: new Date().toISOString(),
      previous: previous.ref,
      history,
      canon,
      digest,
    };
    return { ok: true, milestone };
  });
  if (!closed.ok) return refused(name, storeFault(closed.fault), closed.message);
  return { exit: 'pass', document: { command: name, ok: true, session, milestone: closed.milestone, findings: [], issues: [] } };
}

export function listMilestones(command: { sessionId?: string }, ports: MilestonePorts): Outcome<MilestoneDoc> {
  const name: MilestoneDoc['command'] = 'spec.milestone.list';
  const resolved = resolveSession(ports.store, command.sessionId);
  if (!resolved.ok) return refused(name, 'session', resolved.message);
  const session = resolved.id;
  const listed = ports.milestones.list(session);
  if (!listed.ok) return refused(name, storeFault(listed.fault), listed.message);
  const log = ports.milestones.log(session);
  if (!log.ok) return refused(name, storeFault(log.fault), log.message);
  const canon = ports.canon.read(session);
  if (!canon.ok) return refused(name, 'unreadable', canon.message);
  const last = listed.milestones[listed.milestones.length - 1];
  const pending = {
    since: last?.id ?? 'original',
    history: log.history.length - (last?.history.to ?? 0),
    canon: (canon.state?.history.length ?? 0) - (last?.canon.to ?? 0),
  };
  return { exit: 'pass', document: { command: name, ok: true, session, milestones: listed.milestones, pending, findings: [], issues: [] } };
}

export function showMilestone(command: { sessionId?: string; id: string; changes: boolean }, ports: MilestonePorts): Outcome<MilestoneDoc> {
  const name: MilestoneDoc['command'] = 'spec.milestone.show';
  const resolved = resolveSession(ports.store, command.sessionId);
  if (!resolved.ok) return refused(name, 'session', resolved.message);
  const session = resolved.id;
  const listed = ports.milestones.list(session);
  if (!listed.ok) return refused(name, storeFault(listed.fault), listed.message);
  const milestone = listed.milestones.find((item) => item.id === command.id);
  if (milestone === undefined) return refused(name, 'version', `no milestone "${command.id}"`);
  const document: MilestoneDoc = { command: name, ok: true, session, milestone, findings: [], issues: [] };
  if (command.changes) {
    const log = ports.milestones.log(session);
    if (!log.ok) return refused(name, storeFault(log.fault), log.message);
    const frozen = ports.milestones.read(session, milestone.id);
    if (!frozen.ok) return refused(name, storeFault(frozen.fault), frozen.message);
    const changes: MilestoneChangeView[] = [];
    for (let index = milestone.history.from; index < milestone.history.to; index += 1) {
      const entry = log.history[index];
      if (entry !== undefined) changes.push(historyChange(entry, index));
    }
    const canonHistory = frozen.frozen.canon?.history ?? [];
    for (let index = milestone.canon.from; index < milestone.canon.to; index += 1) {
      const entry = canonHistory[index];
      if (entry !== undefined) changes.push(canonChange(entry, index));
    }
    // Both logs in the order they were written; a history line before a canon entry of the same instant.
    changes.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : left.log === right.log ? left.line - right.line : left.log === 'history' ? -1 : 1));
    document.changes = changes;
  }
  return { exit: 'pass', document };
}

function historyChange(entry: SpecHistoryEntry, index: number): MilestoneChangeView {
  const ids = new Set<string>();
  for (const id of [entry.args.id, entry.args.sentence, entry.args.frame, entry.args.span, entry.args.into]) if (id !== undefined) ids.add(id);
  for (const id of entry.args.ids ?? []) ids.add(id);
  if (ids.size === 0 && entry.command.startsWith('spec.sentences.')) {
    const before = new Set(entry.before);
    for (const id of entry.after) if (!before.has(id)) ids.add(id);
  }
  const view: MilestoneChangeView = { log: 'history', line: index + 1, at: entry.at, command: entry.command, ids: [...ids] };
  if (entry.args.by !== undefined) view.who = entry.args.by;
  if (entry.args.reason !== undefined) view.reason = entry.args.reason;
  if (entry.args.text !== undefined) view.text = entry.args.text;
  return view;
}

function canonChange(entry: CanonHistoryEntry, index: number): MilestoneChangeView {
  const ids: string[] = [];
  if (entry.sentence !== undefined) ids.push(entry.sentence);
  for (const id of entry.merged ?? []) ids.push(id);
  const view: MilestoneChangeView = { log: 'canon', line: index + 1, at: entry.at, command: canonCommand(entry), who: entry.who, ids, reason: entry.reason };
  if (entry.to !== undefined) view.text = entry.to;
  return view;
}

export function diffVersions(command: { sessionId?: string; from?: string; to?: string }, ports: MilestonePorts): Outcome<SpecDiffDocument> {
  const name = 'spec.diff' as const;
  const fail = (fault: NonNullable<SpecDiffDocument['fault']>, message: string): Outcome<SpecDiffDocument> => ({
    exit: 'invalid',
    document: { command: name, ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  });
  const resolved = resolveSession(ports.store, command.sessionId);
  if (!resolved.ok) return fail('session', resolved.message);
  const session = resolved.id;
  let fromRef = command.from;
  if (fromRef === undefined) {
    // With no version named, show the work not yet in a milestone: the last milestone (or the original) to latest.
    const listed = ports.milestones.list(session);
    if (!listed.ok) return fail(listed.fault === 'missing' ? 'session' : listed.fault, listed.message);
    fromRef = listed.milestones[listed.milestones.length - 1]?.id ?? 'original';
  }
  const from = resolveVersion(ports, session, fromRef);
  if (!from.ok) return fail(from.fault, from.message);
  const to = resolveVersion(ports, session, command.to ?? 'latest');
  if (!to.ok) return fail(to.fault, to.message);
  const compared = compare(from.version, to.version, ports.parser);
  const document: SpecDiffDocument = {
    command: name,
    ok: true,
    session,
    from: from.version.ref,
    to: to.version.ref,
    counts: compared.counts,
    sentences: compared.sentences,
    findings: [],
    issues: [],
  };
  if (compared.gatedWith.from !== undefined || compared.gatedWith.to !== undefined) document.gatedWith = compared.gatedWith;
  if (compared.lexicon !== undefined) document.lexicon = compared.lexicon;
  if (compared.actions !== undefined) document.actions = compared.actions;
  return { exit: 'pass', document };
}
