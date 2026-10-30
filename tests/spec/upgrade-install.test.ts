import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDGE_COMMIT = 'e'.repeat(40);

interface Built {
  file: string;
  sha: string;
}

let work: string;
let prefix: string;
let server: Server;
let base: string;
const assets = new Map<string, Buffer>();
let releases: unknown[] = [];
let edgeCommit = EDGE_COMMIT;

function tagVersion(path: string): string {
  return /\/download\/v([^/]+)\//.exec(path)![1]!;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// Re-pack the checkout's tarball under another version and receipt.
async function restamp(packed: string, name: string, info: { version: string; channel: string; commit?: string }): Promise<Built> {
  const dir = mkdtempSync(join(work, 'stamp-'));
  await run('tar', ['-xzf', packed, '-C', dir]);
  const pkgFile = join(dir, 'package', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { version: string };
  pkg.version = info.version;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  writeFileSync(join(dir, 'package', 'build-info.json'), JSON.stringify(info));
  const file = join(work, name);
  await run('tar', ['-czf', file, '-C', dir, 'package']);
  return { file, sha: sha256(readFileSync(file)) };
}

function publish(built: Built, name: string, sums: string = `${built.sha}  ${name}\n`): { tarball: string; sums: string } {
  const sumsName = `SHA256SUMS-${name}`;
  assets.set(name, readFileSync(built.file));
  assets.set(sumsName, Buffer.from(sums));
  return { tarball: `${base}/dl/${name}`, sums: `${base}/dl/${sumsName}` };
}

function releaseJson(tag: string, prerelease: boolean, urls: { tarball: string; sums: string }, name: string, sha: string): unknown {
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    assets: [
      { name, browser_download_url: urls.tarball, digest: `sha256:${sha}` },
      { name: 'SHA256SUMS', browser_download_url: urls.sums },
    ],
  };
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'clew-upgrade-test-'));
  server = createServer((request, response) => {
    const path = request.url ?? '';
    const send = (status: number, body: Buffer | string) => {
      response.writeHead(status);
      response.end(body);
    };
    if (path.startsWith('/dl/')) {
      const body = assets.get(basename(path));
      return body === undefined ? send(404, 'missing') : send(200, body);
    }
    const direct = /^\/goan15910\/clew\/releases\/download\/[^/]+\/(.+)$/.exec(path);
    if (direct !== null) {
      const name = direct[1]!;
      const body = assets.get(name === 'SHA256SUMS' ? `SHA256SUMS-clew-${tagVersion(path)}.tgz` : name);
      return body === undefined ? send(404, 'missing') : send(200, body);
    }
    if (path.startsWith('/repos/goan15910/clew/releases?')) return send(200, JSON.stringify(releases));
    if (path === '/repos/goan15910/clew/releases/tags/edge') {
      const edge = (releases as { tag_name: string }[]).find((release) => release.tag_name === 'edge');
      return edge === undefined ? send(404, '{}') : send(200, JSON.stringify(edge));
    }
    if (path === '/repos/goan15910/clew/git/ref/tags/edge') return send(200, JSON.stringify({ object: { sha: edgeCommit, type: 'commit' } }));
    return send(404, 'unknown');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const packed = join(work, 'packed');
  mkdirSync(packed);
  const { stdout } = await run('npm', ['pack', '--silent', '--pack-destination', packed], { cwd: root });
  const tarball = join(packed, stdout.trim().split('\n').at(-1)!);

  const v3 = await restamp(tarball, 'clew-0.1.0-alpha3.tgz', { version: '0.1.0-alpha3', channel: 'release' });
  const v4 = await restamp(tarball, 'clew-0.1.0-alpha4.tgz', { version: '0.1.0-alpha4', channel: 'release' });
  const edge = await restamp(tarball, 'clew-edge.tgz', { version: '0.1.0-alpha4.dev.9+geeeeeee', channel: 'head', commit: EDGE_COMMIT });
  publish(v3, 'clew-0.1.0-alpha3.tgz');
  releases = [
    releaseJson('v0.1.0-alpha4', true, publish(v4, 'clew-0.1.0-alpha4.tgz'), 'clew-0.1.0-alpha4.tgz', v4.sha),
    releaseJson('edge', true, publish(edge, 'clew-edge.tgz'), 'clew-edge.tgz', edge.sha),
  ];

  prefix = join(work, 'prefix');
  const cache = join(work, 'cache');
  await run('npm', ['install', '-g', v3.file, '--prefix', prefix, '--offline', '--cache', cache, '--registry', 'http://127.0.0.1:9']);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(work, { recursive: true, force: true });
});

async function clew(args: string[], apiUrl: string = base): Promise<{ status: number; stdout: string; stderr: string }> {
  const env = { ...process.env, CLEW_GITHUB_API_URL: apiUrl, CLEW_GITHUB_URL: base };
  try {
    const { stdout, stderr } = await run(join(prefix, 'bin', 'clew'), args, { env });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { status: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

async function installedVersion(): Promise<string> {
  return (await clew(['--version'])).stdout.trim();
}

test('release channel: check, upgrade, then current', async () => {
  assert.equal(await installedVersion(), '0.1.0-alpha3');

  const check = await clew(['upgrade', '--check', '--json']);
  assert.equal(check.status, 0);
  assert.deepEqual(JSON.parse(check.stdout), { command: 'upgrade', ok: true, action: 'would-install', channel: 'release', from: '0.1.0-alpha3', to: '0.1.0-alpha4', issues: [] });
  assert.equal(await installedVersion(), '0.1.0-alpha3');

  const upgrade = await clew(['upgrade', '--json']);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.equal(JSON.parse(upgrade.stdout).action, 'installed');
  assert.equal(await installedVersion(), '0.1.0-alpha4');

  const again = await clew(['upgrade', '--json']);
  assert.equal(JSON.parse(again.stdout).action, 'current');
});

test('a tarball that fails SHA256SUMS installs nothing', async () => {
  const built = await restamp(join(work, 'clew-0.1.0-alpha4.tgz'), 'bad.tgz', { version: '0.1.0-alpha5', channel: 'release' });
  const urls = publish(built, 'clew-0.1.0-alpha5.tgz', `${'0'.repeat(64)}  clew-0.1.0-alpha5.tgz\n`);
  releases = [releaseJson('v0.1.0-alpha5', true, urls, 'clew-0.1.0-alpha5.tgz', built.sha), ...releases];
  const result = await clew(['upgrade']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256SUMS lists/);
  assert.equal(await installedVersion(), '0.1.0-alpha4');
  releases = releases.slice(1);
});

test('--version downgrades with no API call and --checksum pins the hash', async () => {
  const deadApi = 'http://127.0.0.1:9';
  const wrongPin = await clew(['upgrade', '--version', '0.1.0-alpha3', '--checksum', '1'.repeat(64)], deadApi);
  assert.equal(wrongPin.status, 1);
  assert.match(wrongPin.stderr, /--checksum/);
  assert.equal(await installedVersion(), '0.1.0-alpha4');

  const down = await clew(['upgrade', '--version', 'v0.1.0-alpha3', '--json'], deadApi);
  assert.equal(down.status, 0, down.stderr);
  assert.equal(await installedVersion(), '0.1.0-alpha3');
  assert.equal((await clew(['upgrade'])).status, 0);
  assert.equal(await installedVersion(), '0.1.0-alpha4');
});

test('head channel installs edge by commit and is then current', async () => {
  const switched = await clew(['upgrade', '--channel', 'head', '--json']);
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(await installedVersion(), '0.1.0-alpha4.dev.9+geeeeeee');
  assert.equal(JSON.parse((await clew(['upgrade', '--json'])).stdout).action, 'current');
  edgeCommit = 'f'.repeat(40);
  const moved = await clew(['upgrade', '--json']);
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, /edge moved/);
  edgeCommit = EDGE_COMMIT;
});

test('a checkout run through tsx is refused before any network call', async () => {
  const result = await run(join(root, 'node_modules', '.bin', 'tsx'), ['src/cli.ts', 'upgrade', '--json'], {
    cwd: root,
    env: { ...process.env, CLEW_GITHUB_API_URL: 'http://127.0.0.1:9' },
  }).then(
    () => ({ status: 0, stderr: '' }),
    (error: { code: number; stderr: string }) => ({ status: error.code, stderr: error.stderr }),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only updates a global npm install/);
});

test('self-update is a hidden alias for upgrade', async () => {
  const result = await clew(['self-update', '--check', '--json']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).command, 'upgrade');
});
