// Upgrade rules: which build an install is, which build it should move to, and how a checksum file reads.
// Pure data and decisions. The network, the disk, and npm live in adapters.

export type Channel = 'release' | 'head' | 'local';

export const CHANNELS: readonly Channel[] = ['release', 'head', 'local'];

export interface BuildInfo {
  version: string;
  channel: Channel;
  commit?: string;
}

export interface SemVer {
  core: readonly [number, number, number];
  pre: readonly (string | number)[];
}

const SEMVER = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemVer(text: string): SemVer | undefined {
  const match = SEMVER.exec(text);
  if (match === null) return undefined;
  const pre = (match[4] ?? '').split('.').filter((part) => part !== '').map((part) => (/^[0-9]+$/.test(part) ? Number(part) : part));
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

export function isPrerelease(version: SemVer): boolean {
  return version.pre.length > 0;
}

// SemVer 2.0.0 precedence. Build metadata is already dropped by parseSemVer.
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const shared = Math.min(a.pre.length, b.pre.length);
  for (let index = 0; index < shared; index += 1) {
    const left = a.pre[index];
    const right = b.pre[index];
    if (left === right) continue;
    if (typeof left === 'number' && typeof right === 'number') return Math.sign(left - right);
    if (typeof left === 'number') return -1;
    if (typeof right === 'number') return 1;
    return (left as string) < (right as string) ? -1 : 1;
  }
  return Math.sign(a.pre.length - b.pre.length);
}

export interface ReleaseTag {
  tag: string;
  version: string;
  prerelease: boolean;
}

export function releaseTag(tag: string, prerelease: boolean): ReleaseTag | undefined {
  if (parseSemVer(tag) === undefined) return undefined;
  return { tag, version: tag.replace(/^v/, ''), prerelease };
}

// Highest SemVer among the tags. Prereleases count only when the caller allows them.
export function newestRelease(releases: readonly ReleaseTag[], includePrerelease: boolean): ReleaseTag | undefined {
  let best: ReleaseTag | undefined;
  let bestVersion: SemVer | undefined;
  for (const release of releases) {
    if (!includePrerelease && (release.prerelease || isPrerelease(parseSemVer(release.version)!))) continue;
    const version = parseSemVer(release.version)!;
    if (bestVersion === undefined || compareSemVer(version, bestVersion) > 0) {
      best = release;
      bestVersion = version;
    }
  }
  return best;
}

export type Move =
  | { action: 'install' }
  | { action: 'current'; reason: string };

export interface ReleaseMove {
  installed: BuildInfo;
  target: string;
  switching: boolean;
  exact: boolean;
  force: boolean;
}

// An exact --version or a channel switch installs whatever differs. Staying on the release channel only moves up.
export function decideRelease(move: ReleaseMove): Move {
  const installed = parseSemVer(move.installed.version);
  const target = parseSemVer(move.target);
  if (move.target === move.installed.version && move.installed.channel === 'release') {
    return move.force ? { action: 'install' } : { action: 'current', reason: `already on ${move.target}` };
  }
  if (move.exact || move.switching || move.force) return { action: 'install' };
  if (installed !== undefined && target !== undefined && compareSemVer(target, installed) <= 0) {
    return { action: 'current', reason: `${move.installed.version} is not older than the newest release ${move.target}` };
  }
  return { action: 'install' };
}

export interface HeadMove {
  installed: BuildInfo;
  edgeCommit: string;
  force: boolean;
}

// Head builds are compared by identity. Their version string is for display.
export function decideHead(move: HeadMove): Move {
  const same = move.installed.channel === 'head' && move.installed.commit === move.edgeCommit;
  if (same && !move.force) return { action: 'current', reason: `already on edge ${move.edgeCommit.slice(0, 7)}` };
  return { action: 'install' };
}

// `sha256sum` output: "<64 hex>  <name>" or "<64 hex> *<name>".
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (match !== null) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

export function normalizeDigest(digest: string | undefined): string | undefined {
  if (digest === undefined) return undefined;
  const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest);
  return match === null ? undefined : match[1]!.toLowerCase();
}

export type ChecksumVerdict = { ok: true } | { ok: false; message: string };

export interface ChecksumEvidence {
  actual: string;
  listed: string | undefined;
  apiDigest: string | undefined;
  pinned: string | undefined;
}

// Fail closed. SHA256SUMS must name the file. The API digest and --checksum are checked when present.
export function verifyChecksums(file: string, evidence: ChecksumEvidence): ChecksumVerdict {
  if (evidence.listed === undefined) return { ok: false, message: `SHA256SUMS has no line for ${file}` };
  if (evidence.listed !== evidence.actual) {
    return { ok: false, message: `${file} hashes to ${evidence.actual}, but SHA256SUMS lists ${evidence.listed}` };
  }
  if (evidence.apiDigest !== undefined && evidence.apiDigest !== evidence.actual) {
    return { ok: false, message: `${file} hashes to ${evidence.actual}, but GitHub reports ${evidence.apiDigest}` };
  }
  if (evidence.pinned !== undefined && evidence.pinned.toLowerCase() !== evidence.actual) {
    return { ok: false, message: `${file} hashes to ${evidence.actual}, but --checksum is ${evidence.pinned.toLowerCase()}` };
  }
  return { ok: true };
}
