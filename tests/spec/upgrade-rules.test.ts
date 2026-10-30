import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideHead, decideRelease, newestRelease, parseChecksums, parseSemVer, compareSemVer, releaseTag, verifyChecksums, type BuildInfo } from '../../src/domain/upgrade.ts';
import { upgradeClew, type UpgradeCommand } from '../../src/application/upgrade-clew.ts';
import type { InstallLocation, Release, UpgradePorts } from '../../src/application/ports.ts';

const order = (a: string, b: string) => compareSemVer(parseSemVer(a)!, parseSemVer(b)!);

test('SemVer precedence puts dev builds above their release and below the next one', () => {
  assert.equal(order('0.1.0-alpha.2', '0.1.0-alpha.10'), -1);
  assert.equal(order('0.1.0-alpha3', '0.1.0-alpha3.dev.36+g24cb67d'), -1);
  assert.equal(order('0.1.0-alpha3.dev.36+g24cb67d', '0.1.0-alpha3.dev.37+gffffff0'), -1);
  assert.equal(order('0.1.0-alpha3.dev.99', '0.1.0-alpha4'), -1);
  assert.equal(order('0.1.0-alpha4', '0.1.0'), -1);
  assert.equal(order('0.1.0+a', '0.1.0+b'), 0);
});

test('newestRelease honours the prerelease rule', () => {
  const tags = [releaseTag('v0.1.0-alpha.2', true)!, releaseTag('v0.1.0-alpha.10', true)!, releaseTag('v0.0.9', false)!];
  assert.equal(newestRelease(tags, true)?.tag, 'v0.1.0-alpha.10');
  assert.equal(newestRelease(tags, false)?.tag, 'v0.0.9');
  assert.equal(newestRelease([], true), undefined);
});

test('release and head moves', () => {
  const release: BuildInfo = { version: '0.1.0-alpha3', channel: 'release' };
  const move = (target: string, extra = {}) => decideRelease({ installed: release, target, switching: false, exact: false, force: false, ...extra }).action;
  assert.equal(move('0.1.0-alpha3'), 'current');
  assert.equal(move('0.1.0-alpha2'), 'current');
  assert.equal(move('0.1.0-alpha4'), 'install');
  assert.equal(move('0.1.0-alpha2', { exact: true }), 'install');
  assert.equal(move('0.1.0-alpha3', { force: true }), 'install');
  const head: BuildInfo = { version: '0.1.0-alpha3.dev.4+gabcdef0', channel: 'head', commit: 'abcdef0123' };
  assert.equal(decideHead({ installed: head, edgeCommit: 'abcdef0123', force: false }).action, 'current');
  assert.equal(decideHead({ installed: head, edgeCommit: 'ffffff0123', force: false }).action, 'install');
  assert.equal(decideHead({ installed: release, edgeCommit: 'abcdef0123', force: false }).action, 'install');
});

test('checksums fail closed', () => {
  const sum = 'a'.repeat(64);
  const sums = parseChecksums(`${sum}  clew-1.tgz\n${'b'.repeat(64)} *other.tgz\n`);
  assert.equal(sums.get('clew-1.tgz'), sum);
  assert.equal(sums.get('other.tgz'), 'b'.repeat(64));
  const base = { actual: sum, listed: sum, apiDigest: undefined, pinned: undefined };
  assert.equal(verifyChecksums('clew-1.tgz', base).ok, true);
  assert.equal(verifyChecksums('clew-1.tgz', { ...base, listed: undefined }).ok, false);
  assert.equal(verifyChecksums('clew-1.tgz', { ...base, listed: 'c'.repeat(64) }).ok, false);
  assert.equal(verifyChecksums('clew-1.tgz', { ...base, apiDigest: 'c'.repeat(64) }).ok, false);
  assert.equal(verifyChecksums('clew-1.tgz', { ...base, pinned: 'c'.repeat(64) }).ok, false);
});

interface Spy {
  installs: string[];
  downloads: string[];
}

function ports(location: InstallLocation, releases: Release[], overrides: Partial<{ sums: string }> = {}): { ports: UpgradePorts; spy: Spy } {
  const spy: Spy = { installs: [], downloads: [] };
  const sum = 'd'.repeat(64);
  const fake: UpgradePorts = {
    install: { locate: () => location },
    releases: {
      list: async () => ({ ok: true, value: releases }),
      edge: async () => ({ ok: true, value: { commit: 'e'.repeat(40), release: releases[0]! } }),
      direct: (tag) => ({ tag, prerelease: false, assets: [{ name: `clew-${tag.slice(1)}.tgz`, url: 'u/t' }, { name: 'SHA256SUMS', url: 'u/s' }] }),
    },
    files: {
      makeTempDir: () => '/tmp/fake',
      removeDir: () => {},
      fetchText: async () => ({ ok: true, value: overrides.sums ?? `${sum}  clew-0.1.0-alpha4.tgz\n${sum}  clew-edge.tgz\n${sum}  clew-0.1.0-alpha2.tgz\n` }),
      download: async (url) => {
        spy.downloads.push(url);
        return { ok: true, value: undefined };
      },
      sha256: async () => sum,
      inspect: (tarball) => ({ ok: true, value: tarball.endsWith('clew-edge.tgz') ? { version: '0.1.0-alpha4.dev.9+geeeeeee', channel: 'head', commit: 'e'.repeat(40) } : { version: /clew-(.+)\.tgz$/.exec(tarball)![1]!, channel: 'release' } }),
    },
    npm: {
      install: async (tarball) => {
        spy.installs.push(tarball);
        return { ok: true, value: undefined };
      },
      installedVersion: () => ({ ok: true, value: /clew-(.+)\.tgz$/.exec(spy.installs.at(-1)!)![1]!.replace('edge', '0.1.0-alpha4.dev.9+geeeeeee') }),
    },
    provenance: { verify: async () => ({ ok: true, value: undefined }) },
  };
  return { ports: fake, spy };
}

const releases: Release[] = [
  { tag: 'v0.1.0-alpha4', prerelease: true, assets: [{ name: 'clew-0.1.0-alpha4.tgz', url: 'u/t4', sha256: `sha256:${'d'.repeat(64)}` }, { name: 'SHA256SUMS', url: 'u/s' }, { name: 'clew-edge.tgz', url: 'u/e' }] },
  { tag: 'v0.1.0-alpha3', prerelease: true, assets: [] },
];
const global = (build: BuildInfo, writable = true): InstallLocation => ({ kind: 'global', build, prefix: '/p', writable });
const run: UpgradeCommand = { check: false, force: false, verifyProvenance: false };

test('upgrade installs the verified file from the newest prerelease', async () => {
  const { ports: p, spy } = ports(global({ version: '0.1.0-alpha3', channel: 'release' }), releases);
  const outcome = await upgradeClew(run, p);
  assert.equal(outcome.exit, 'pass');
  assert.equal(outcome.document.action, 'installed');
  assert.deepEqual(spy.installs, ['/tmp/fake/clew-0.1.0-alpha4.tgz']);
});

test('upgrade --check installs nothing and refusals cost no download', async () => {
  const check = ports(global({ version: '0.1.0-alpha3', channel: 'release' }), releases);
  assert.equal((await upgradeClew({ ...run, check: true }, check.ports)).document.action, 'would-install');
  assert.deepEqual(check.spy.downloads, []);

  const local = ports(global({ version: '0.1.0-alpha3', channel: 'local' }), releases);
  const refused = await upgradeClew(run, local.ports);
  assert.equal(refused.exit, 'invalid');
  assert.deepEqual(local.spy.downloads, []);
  assert.equal((await upgradeClew({ ...run, force: true }, local.ports)).document.action, 'installed');

  const other = ports({ kind: 'other', build: { version: '0.1.0-alpha3', channel: 'release' }, reason: 'linked' }, releases);
  assert.equal((await upgradeClew({ ...run, force: true }, other.ports)).exit, 'invalid');
});

test('a stable install ignores prereleases and a checksum mismatch installs nothing', async () => {
  const stable = ports(global({ version: '0.1.0', channel: 'release' }), releases);
  assert.equal((await upgradeClew(run, stable.ports)).exit, 'fail');

  const bad = ports(global({ version: '0.1.0-alpha3', channel: 'release' }), releases, { sums: `${'0'.repeat(64)}  clew-0.1.0-alpha4.tgz\n` });
  const outcome = await upgradeClew(run, bad.ports);
  assert.equal(outcome.exit, 'fail');
  assert.equal(outcome.document.fault, 'checksum');
  assert.deepEqual(bad.spy.installs, []);

  const missing = ports(global({ version: '0.1.0-alpha3', channel: 'release' }), releases, { sums: '' });
  assert.equal((await upgradeClew(run, missing.ports)).document.fault, 'checksum');
});

test('an unwritable prefix prints the npm command and never installs', async () => {
  const { ports: p, spy } = ports(global({ version: '0.1.0-alpha3', channel: 'release' }, false), releases);
  const outcome = await upgradeClew(run, p);
  assert.equal(outcome.document.fault, 'permission');
  assert.match(outcome.document.retry ?? '', /^npm install -g u\/t4 --prefix \/p$/);
  assert.deepEqual(spy.installs, []);
});

test('head channel compares commits and --version downgrades without a list call', async () => {
  const head = ports(global({ version: '0.1.0-alpha3.dev.1+geeeeeee', channel: 'head', commit: 'e'.repeat(40) }), releases);
  assert.equal((await upgradeClew(run, head.ports)).document.action, 'current');

  const fromRelease = ports(global({ version: '0.1.0-alpha4', channel: 'release' }), releases);
  const edge = await upgradeClew({ ...run, channel: 'head' }, fromRelease.ports);
  assert.equal(edge.document.action, 'installed');
  assert.deepEqual(fromRelease.spy.installs, ['/tmp/fake/clew-edge.tgz']);
  assert.deepEqual(fromRelease.spy.downloads, ['u/e']);

  const exact = ports(global({ version: '0.1.0-alpha4', channel: 'release' }), []);
  const down = await upgradeClew({ ...run, version: 'v0.1.0-alpha2' }, exact.ports);
  assert.equal(down.document.action, 'installed');
  assert.equal(down.document.to, '0.1.0-alpha2');
  assert.deepEqual(exact.spy.downloads, ['u/t']);
});
