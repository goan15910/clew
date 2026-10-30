import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

test('short help omits examples and clew help prints them for every command', () => {
  const index = clew(['help']);
  assert.equal(index.status, 0);
  assert.equal(index.stderr, '');
  assert.doesNotMatch(index.stdout, /^Examples:/m);
  assert.doesNotMatch(index.stdout, /^Exit codes:/m);
  assert.doesNotMatch(index.stdout, /^Notes:/m);
  assert.match(index.stdout, /^Commands:/m);

  const rootHelp = clew(['--help']);
  const rootShort = clew(['-h']);
  assert.equal(rootHelp.status, 0);
  assert.equal(rootHelp.stderr, '');
  assert.equal(rootHelp.stdout, rootShort.stdout);
  assert.match(rootHelp.stdout, /^Usage:/m);
  assert.match(rootHelp.stdout, /help \[command\.\.\.\]/);
  assert.doesNotMatch(rootHelp.stdout, /^Examples:/m);
  assert.doesNotMatch(rootHelp.stdout, /^Exit codes:/m);
  assert.doesNotMatch(rootHelp.stdout, /^Notes:/m);
  assert.doesNotMatch(rootHelp.stdout, /examples\/todo/);

  const discovered = discover();
  const listed = indexPaths(index.stdout).map((path) => path.join(' ')).sort();
  assert.deepEqual(discovered.map((path) => path.join(' ')).sort(), listed);

  for (const path of discovered) {
    const label = path.join(' ');
    assert.ok(!(path.length > 1 && path[path.length - 1] === 'help'), `${label} is an implicit help command`);
    const short = clew([...path, '--help']);
    const dash = clew([...path, '-h']);
    const full = clew(['help', ...path]);
    assert.equal(short.status, 0, label);
    assert.equal(short.stderr, '', label);
    assert.equal(short.stdout, dash.stdout, label);
    assert.equal(full.status, 0, label);
    assert.equal(full.stderr, '', label);
    assert.ok(full.stdout.startsWith(short.stdout.trimEnd()), label);
    assert.doesNotMatch(short.stdout, /^Examples:/m, label);
    assert.doesNotMatch(short.stdout, /^Exit codes:/m, label);
    assert.doesNotMatch(short.stdout, /^Notes:/m, label);
    assert.match(full.stdout, /^Examples:/m, label);
    assert.match(full.stdout, /^Exit codes:/m, label);
    assert.match(full.stdout, /^Notes:/m, label);

    const examples = section(full.stdout, 'Examples:');
    assert.ok(examples.length > 0, label);
    const prefix = `clew ${label}`;
    for (const example of examples) {
      assert.ok(example.startsWith(prefix), `${example} does not start with ${prefix}`);
      assert.equal(short.stdout.includes(`\n  ${example}\n`), false, example);
    }
    const codes = section(full.stdout, 'Exit codes:');
    assert.ok(codes.length > 0, label);
    assert.ok(codes.every((line) => /^[012]  \S/.test(line)), label);
    assert.ok(section(full.stdout, 'Notes:').length > 0, label);

    if (label === 'chart check') assert.ok(examples.includes('clew chart check examples/todo/b-full.yaml --json'));
    if (label === 'chart view') {
      assert.ok(examples.includes('clew chart view examples/todo/b-full.yaml --json'));
      assert.ok(examples.includes('clew chart view examples/todo/b-full.yaml --open'));
    }
    if (label === 'workflows view') {
      assert.ok(examples.includes('clew workflows view examples/todo/workflows.yaml --json'));
      assert.ok(examples.includes('clew workflows view examples/todo/workflows.yaml --open'));
    }
    if (label === 'verify') assert.ok(examples.some((line) => line.includes('--heatmap --replay --out out')));
    if (label === 'spec graph split') assert.ok(examples.includes('clew spec graph split --id W1 --at tr2 --json'));
    if (label === 'spec trace') assert.ok(examples.includes('clew spec trace actor:customer --json'));
    if (label === 'spec facts') {
      assert.ok(examples.some((line) => line.startsWith('clew spec facts propose')));
      assert.ok(examples.some((line) => line.startsWith('clew spec facts add')));
    }
    if (label === 'spec facts propose') assert.ok(examples.every((line) => !line.includes('facts add')));
    if (label === 'spec show tagged') {
      assert.ok(examples.includes('clew spec show tagged --json'));
      assert.equal(codes.some((line) => line.startsWith('1 ')), false);
    }
    if (label === 'spec view') {
      assert.ok(examples.includes('clew spec view order --json'));
      assert.ok(examples.includes('clew spec view order --open'));
      assert.equal(codes.some((line) => line.startsWith('1 ')), false);
    }
    if (label === 'spec session list') assert.ok(examples.includes('clew spec session list --json'));
    if (label === 'spec session remove') assert.ok(examples.includes('clew spec session remove order --json'));
  }
});

test('an unknown help command exits 2', () => {
  const unknown = clew(['help', 'spec', 'facts', 'nope']);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /unknown command: spec facts nope/);

  const malformed = clew(['help', 'Spec']);
  assert.equal(malformed.status, 2);
  assert.equal(malformed.stdout, '');
  assert.match(malformed.stderr, /command names use letters, digits, and hyphens/);

  const implicit = clew(['chart', 'help']);
  assert.equal(implicit.status, 2);
  assert.match(implicit.stderr, /unknown command 'help'/);
});

function discover(prefix: string[] = []): string[][] {
  const names = subcommandNames(clew([...prefix, '--help']).stdout);
  return names.flatMap((name) => {
    const path = [...prefix, name];
    return [path, ...discover(path)];
  });
}

function subcommandNames(stdout: string): string[] {
  const lines = stdout.split('\n');
  const start = lines.indexOf('Commands:');
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '') break;
    const match = /^  (\S+)/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

function indexPaths(stdout: string): string[][] {
  const paths: string[][] = [];
  for (const line of stdout.split('\n')) {
    const match = /^  ([a-z][a-z0-9]*(?: [a-z][a-z0-9-]*)*)  +\S/.exec(line);
    if (match?.[1] !== undefined) paths.push(match[1].split(' '));
  }
  return paths;
}

function section(text: string, title: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf(title);
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    body.push(line.slice(2));
  }
  return body;
}

const runs = new Map<string, { status: number; stdout: string; stderr: string }>();

function clew(args: string[]): { status: number; stdout: string; stderr: string } {
  const key = args.join('\0');
  const cached = runs.get(key);
  if (cached !== undefined) return cached;
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
  const value = { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  runs.set(key, value);
  return value;
}
