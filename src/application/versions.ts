// Resolve a version name (`original`, `latest`, or a milestone id) to the session as it was then.
// Shared by spec export, spec diff, the milestone commands, and the canonical pipeline's --at.
import { type SpecSnapshot } from '../domain/spec.js';
import { isVersionRef, VERSION_REF_MESSAGE, versionRank, type Milestone } from '../domain/spec-versions.js';
import type { CanonState, CanonStore, MilestoneStore, SpecStore } from './ports.js';

export interface VersionPorts {
  store: SpecStore;
  canon: CanonStore;
  milestones: MilestoneStore;
}

/** A session at one version. `latest` text is the version's text, whatever the version; `canon` is its lexicon. */
export interface Version {
  ref: string;
  rank: number;
  snapshot: SpecSnapshot;
  canon: CanonState | undefined;
  milestone?: Milestone;
}

export type VersionFault = 'session' | 'unreadable' | 'locked' | 'schema' | 'version';
export type VersionResult = { ok: true; version: Version } | { ok: false; fault: VersionFault; message: string };

export function resolveVersion(ports: VersionPorts, session: string, ref: string): VersionResult {
  if (!isVersionRef(ref)) return { ok: false, fault: 'version', message: `"${ref}": ${VERSION_REF_MESSAGE}` };
  if (ref === 'latest' || ref === 'original') {
    const read = ports.store.update(session, { create: false }, () => undefined);
    if (!read.ok) return { ok: false, fault: read.fault === 'missing' ? 'session' : read.fault, message: read.message };
    if (ref === 'original') return { ok: true, version: { ref, rank: versionRank(ref), snapshot: originalSnapshot(read.snapshot), canon: undefined } };
    const canon = ports.canon.read(session);
    if (!canon.ok) return { ok: false, fault: 'unreadable', message: canon.message };
    return { ok: true, version: { ref, rank: versionRank(ref), snapshot: read.snapshot, canon: canon.state } };
  }
  const listed = ports.milestones.list(session);
  if (!listed.ok) return { ok: false, fault: listed.fault === 'missing' ? 'session' : listed.fault, message: listed.message };
  const milestone = listed.milestones.find((item) => item.id === ref);
  if (milestone === undefined) {
    const known = listed.milestones.map((item) => item.id);
    return { ok: false, fault: 'version', message: `no milestone "${ref}"${known.length === 0 ? '; none is closed yet' : `; closed: ${known.join(', ')}`}` };
  }
  const frozen = ports.milestones.read(session, ref);
  if (!frozen.ok) return { ok: false, fault: frozen.fault === 'missing' ? 'version' : frozen.fault, message: frozen.message };
  return { ok: true, version: { ref, rank: versionRank(ref), snapshot: frozen.frozen.snapshot, canon: frozen.frozen.canon, milestone } };
}

/**
 * The spec as `spec init` read it, in the shape every reader expects: each sentence's `latest` is its original text
 * and it has no revisions yet. Added sentences are absent. The derived layers belong to later text, so they are left out.
 */
export function originalSnapshot(snapshot: SpecSnapshot): SpecSnapshot {
  const sentences = [];
  for (const sentence of snapshot.sentences) {
    if (sentence.original === null) continue;
    sentences.push({ id: sentence.id, original: sentence.original, latest: sentence.original, history: [] });
  }
  return { schemaVersion: snapshot.schemaVersion, id: snapshot.id, specHash: snapshot.specHash, created: snapshot.created, updated: snapshot.created, sentences, tagged: [] };
}
