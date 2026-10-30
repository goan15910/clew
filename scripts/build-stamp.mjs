// Stamp a package directory with its version and a build-info.json receipt.
// Usage: node scripts/build-stamp.mjs <git-dir> <package-dir> --channel release|head|local
//
// A commit with an exact v* tag keeps the package.json version. Any other commit gets
// <pkg>.dev.<commit count>+g<sha7>. The dev.N prerelease part orders head builds;
// the +g<sha7> build metadata names the commit.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [gitDir, packageDir, flag, channelArg] = process.argv.slice(2);
if (!gitDir || !packageDir || flag !== '--channel' || !['release', 'head', 'local'].includes(channelArg)) {
  console.error('usage: build-stamp.mjs <git-dir> <package-dir> --channel release|head|local');
  process.exit(2);
}

const git = (...args) => execFileSync('git', ['-C', gitDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const packageFile = join(packageDir, 'package.json');
const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
const commit = git('rev-parse', 'HEAD');

let tagged = true;
try {
  git('describe', '--tags', '--match', 'v*', '--exact-match', 'HEAD');
} catch {
  tagged = false;
}

function devVersion(base, count, sha) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(base);
  if (!match) throw new Error(`not a SemVer version: ${base}`);
  const [, major, minor, patch, pre] = match;
  const next = pre ? base : `${major}.${minor}.${Number(patch) + 1}`;
  return `${next}${pre ? '.dev.' : '-dev.'}${count}+g${sha}`;
}

const version = tagged ? pkg.version : devVersion(pkg.version, git('rev-list', '--count', 'HEAD'), commit.slice(0, 7));
const channel = channelArg === 'head' && tagged ? 'release' : channelArg;

pkg.version = version;
writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(join(packageDir, 'build-info.json'), `${JSON.stringify({ version, channel, commit }, null, 2)}\n`);
console.log(version);
