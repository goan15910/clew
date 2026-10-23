import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

test('--version and -V print the package.json version', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const long = clew(['--version']);
  const short = clew(['-V']);
  const help = clew(['--help']);
  assert.equal(long.status, 0);
  assert.equal(short.status, 0);
  assert.equal(long.stderr, '');
  assert.equal(short.stderr, '');
  assert.equal(long.stdout, `${pkg.version}\n`);
  assert.equal(short.stdout, long.stdout);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /-V, --version/);
});

function clew(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
