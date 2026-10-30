// Use case: move this global install to the newest build on a channel. Verify the tarball, then install the file that was hashed.
import { join } from 'node:path';
import {
  decideHead,
  decideRelease,
  isPrerelease,
  newestRelease,
  normalizeDigest,
  parseChecksums,
  parseSemVer,
  releaseTag,
  verifyChecksums,
  type BuildInfo,
  type Move,
  type ReleaseTag,
} from '../domain/upgrade.js';
import type { Outcome, UpgradeDocument } from './documents.js';
import { specInput } from './documents.js';
import type { Release, ReleaseAsset, UpgradePorts } from './ports.js';

export interface UpgradeCommand {
  channel?: 'release' | 'head';
  version?: string;
  check: boolean;
  force: boolean;
  checksum?: string;
  verifyProvenance: boolean;
}

type Fault = NonNullable<UpgradeDocument['fault']>;

interface Target {
  channel: 'release' | 'head';
  version: string;
  commit?: string;
  release: Release;
  tarball: string;
  move: Move;
}

const EDGE_TARBALL = 'clew-edge.tgz';

export async function upgradeClew(command: UpgradeCommand, ports: UpgradePorts): Promise<Outcome<UpgradeDocument>> {
  const location = ports.install.locate();
  const installed = location.build;
  if (location.kind === 'other') return refused(installed, location.reason, 'reinstall with scripts/install-clew.sh');
  if (installed.channel === 'local' && !command.force) {
    return refused(installed, 'this is a local build', 'update the checkout, then run scripts/install-clew.sh --from local; or pass --force to replace it with a published build');
  }

  const channel = command.version !== undefined ? 'release' : (command.channel ?? (installed.channel === 'head' ? 'head' : 'release'));
  const resolved = channel === 'head' ? await resolveHead(installed, command, ports) : await resolveRelease(installed, command, ports);
  if (!resolved.ok) return failed('resolve', resolved.message, installed.version);
  const target = resolved.value;

  if (target.move.action === 'current') {
    return pass({ action: 'current', channel, from: installed.version, to: target.version, note: target.move.reason });
  }
  if (command.check) return pass({ action: 'would-install', channel, from: installed.version, to: target.version });

  const tarballUrl = target.release.assets.find((asset) => asset.name === target.tarball);
  const sumsUrl = target.release.assets.find((asset) => asset.name === 'SHA256SUMS');
  if (tarballUrl === undefined || sumsUrl === undefined) {
    return failed('resolve', `release ${target.release.tag} is missing ${tarballUrl === undefined ? target.tarball : 'SHA256SUMS'}`, installed.version);
  }

  const manual = `npm install -g ${tarballUrl.url} --prefix ${location.prefix}`;
  if (!location.writable) {
    return {
      exit: 'fail',
      document: {
        command: 'upgrade',
        ok: false,
        fault: 'permission',
        from: installed.version,
        to: target.version,
        retry: manual,
        issues: [specInput(undefined, `${location.prefix} is not writable. Clew never runs sudo. Run this yourself, or install with a prefix you own.`)],
      },
    };
  }

  const dir = ports.files.makeTempDir();
  try {
    return await apply({ command, ports, dir, prefix: location.prefix, installed, target, tarballAsset: tarballUrl, sumsAsset: sumsUrl });
  } finally {
    ports.files.removeDir(dir);
  }
}

interface Apply {
  command: UpgradeCommand;
  ports: UpgradePorts;
  dir: string;
  prefix: string;
  installed: BuildInfo;
  target: Target;
  tarballAsset: ReleaseAsset;
  sumsAsset: ReleaseAsset;
}

async function apply(job: Apply): Promise<Outcome<UpgradeDocument>> {
  const { ports, target, installed } = job;
  const tarball = join(job.dir, target.tarball);
  const downloaded = await ports.files.download(job.tarballAsset.url, tarball);
  if (!downloaded.ok) return failed('download', downloaded.message, installed.version);
  const sums = await ports.files.fetchText(job.sumsAsset.url);
  if (!sums.ok) return failed('download', sums.message, installed.version);

  const verdict = verifyChecksums(target.tarball, {
    actual: await ports.files.sha256(tarball),
    listed: parseChecksums(sums.value).get(target.tarball),
    apiDigest: normalizeDigest(job.tarballAsset.sha256),
    pinned: job.command.checksum,
  });
  if (!verdict.ok) return failed('checksum', verdict.message, installed.version);

  if (job.command.verifyProvenance) {
    const attested = await ports.provenance.verify(tarball);
    if (!attested.ok) return failed('provenance', attested.message, installed.version);
  }

  const packed = ports.files.inspect(tarball);
  if (!packed.ok) return failed('install', packed.message, installed.version);
  const mismatch = packedMismatch(target, packed.value);
  if (mismatch !== undefined) return failed('install', mismatch, installed.version);

  const done = await ports.npm.install(tarball, job.prefix);
  if (!done.ok) return failed('install', done.message, installed.version);

  const reported = ports.npm.installedVersion(job.prefix);
  if (!reported.ok) return failed('install', reported.message, installed.version);
  if (reported.value !== packed.value.version) {
    return failed('install', `installed clew reports ${reported.value}, expected ${packed.value.version}`, installed.version);
  }
  return pass({ action: 'installed', channel: target.channel, from: installed.version, to: packed.value.version });
}

function packedMismatch(target: Target, packed: BuildInfo): string | undefined {
  if (target.channel === 'release' && packed.version !== target.version) {
    return `tarball is ${packed.version}, expected ${target.version}`;
  }
  if (target.channel === 'head' && packed.commit !== target.commit) {
    return `edge moved while downloading (tarball ${packed.commit ?? 'has no commit'}, expected ${target.commit}). Run clew upgrade again.`;
  }
  return undefined;
}

type Resolved = { ok: true; value: Target } | { ok: false; message: string };

async function resolveRelease(installed: BuildInfo, command: UpgradeCommand, ports: UpgradePorts): Promise<Resolved> {
  const switching = installed.channel !== 'release';
  if (command.version !== undefined) {
    const version = command.version.replace(/^v/, '');
    const tag = `v${version}`;
    return { ok: true, value: releaseTarget(installed, ports.releases.direct(tag), version, switching, true, command.force) };
  }
  const listed = await ports.releases.list();
  if (!listed.ok) return listed;
  const byTag = new Map<string, Release>();
  const candidates: ReleaseTag[] = [];
  for (const release of listed.value) {
    const candidate = releaseTag(release.tag, release.prerelease);
    if (candidate === undefined) continue;
    byTag.set(release.tag, release);
    candidates.push(candidate);
  }
  const current = parseSemVer(installed.version);
  const best = newestRelease(candidates, current !== undefined && isPrerelease(current));
  if (best === undefined) return { ok: false, message: 'no eligible release found' };
  return { ok: true, value: releaseTarget(installed, byTag.get(best.tag)!, best.version, switching, false, command.force) };
}

function releaseTarget(installed: BuildInfo, release: Release, version: string, switching: boolean, exact: boolean, force: boolean): Target {
  return {
    channel: 'release',
    version,
    release,
    tarball: `clew-${version}.tgz`,
    move: decideRelease({ installed, target: version, switching, exact, force }),
  };
}

async function resolveHead(installed: BuildInfo, command: UpgradeCommand, ports: UpgradePorts): Promise<Resolved> {
  const edge = await ports.releases.edge();
  if (!edge.ok) return edge;
  const { commit, release } = edge.value;
  return {
    ok: true,
    value: {
      channel: 'head',
      version: `edge@${commit.slice(0, 7)}`,
      commit,
      release,
      tarball: EDGE_TARBALL,
      move: decideHead({ installed, edgeCommit: commit, force: command.force }),
    },
  };
}

function pass(fields: Omit<UpgradeDocument, 'command' | 'ok' | 'issues'>): Outcome<UpgradeDocument> {
  return { exit: 'pass', document: { command: 'upgrade', ok: true, ...fields, issues: [] } };
}

function failed(fault: Fault, message: string, from: string): Outcome<UpgradeDocument> {
  return { exit: 'fail', document: { command: 'upgrade', ok: false, fault, from, issues: [specInput(undefined, message)] } };
}

function refused(installed: BuildInfo, reason: string, advice: string): Outcome<UpgradeDocument> {
  return {
    exit: 'invalid',
    document: {
      command: 'upgrade',
      ok: false,
      fault: 'refused',
      from: installed.version,
      retry: advice,
      issues: [specInput(undefined, `clew upgrade only updates a global npm install it made. ${reason}. ${advice}.`)],
    },
  };
}
