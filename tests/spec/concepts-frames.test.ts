import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type { FrameView, SpecConceptsDocument, SpecFramesDocument, SpecGraphDocument, SpecStatusDocument } from '../../src/application/documents.js';
import type { Role } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const SPEC = [
  'When the customer submits an order, the manager approves the order if the total is under 500 dollars.',
  'A clerk must not cancel a shipped package. The clerk packs the package and ships it.',
  'An order starts as draft.',
].join('\n');

describe('spec concepts and frames', { concurrency: false }, () => {
  test('the same word gives one concept, and a second run writes nothing', () => {
    withData((dir) => {
      prepare(dir, SPEC);
      const listed = run(dir, ['spec', 'concepts', 'list', '--json']);
      assert.equal(listed.status, 0, listed.stderr);
      const document = json<SpecConceptsDocument>(listed);
      assert.equal(document.command, 'spec.concepts.list');
      assert.equal(document.ok, true);
      const order = document.concepts?.find((concept) => concept.id === 'concept:order');
      assert.equal(order?.canonical, 'order');
      assert.deepEqual(order?.members.map((member) => member.sentence), ['s1', 's1', 's4']);
      const ship = document.concepts?.find((concept) => concept.id === 'concept:ship');
      assert.deepEqual(ship?.members.map((member) => member.surface), ['shipped', 'ships']);
      assert.equal(document.concepts?.some((concept) => concept.canonical === '500' || concept.canonical === 'it'), false);
      const session = specSessionDir('flow', { CLEW_DATA_DIR: dir });
      assert.equal(existsSync(join(session, 'concepts.json')), true);
      const spans = JSON.parse(readFileSync(join(session, 'spans.json'), 'utf8')) as { spans: { id: string; entityId?: string }[] };
      assert.equal(spans.spans.find((span) => span.id === 'sp:s1.t6..s1.t6')?.entityId, 'concept:order');
      const before = historyCommands(dir);
      assert.equal(run(dir, ['spec', 'concepts', 'list', '--json']).status, 0);
      assert.deepEqual(historyCommands(dir), before);
      assert.equal(before.filter((command) => command === 'spec.concepts.list').length, 1);
    });
  });

  test('frames read actor, event, object, result, and when by position', () => {
    withData((dir) => {
      prepare(dir, SPEC);
      const listed = run(dir, ['spec', 'frames', 'list', '--json']);
      assert.equal(listed.status, 0, listed.stderr);
      const document = json<SpecFramesDocument>(listed);
      assert.equal(document.command, 'spec.frames.list');
      const frames = document.frames ?? [];
      assert.deepEqual(frames.map((frame) => frame.id), ['fr:s1.t1', 'fr:s1.t7', 'fr:s1.t12', 'fr:s2.t1', 'fr:s3.t1', 'fr:s3.t6', 'fr:s4.t1']);

      const submit = frameOf(frames, 'fr:s1.t1');
      assert.equal(submit.marker, 'when');
      assert.deepEqual(roles(submit), { actor: 'customer', event: 'submit', object: 'order', result: 'submitted', when: 'unknown' });

      const approve = frameOf(frames, 'fr:s1.t7');
      assert.deepEqual(text(approve.roles.when.latest.value), 'When the customer submits an order and if the total is under 500 dollars');
      assert.deepEqual(refs(approve.roles.when.latest.value), ['fr:s1.t1', 'fr:s1.t12']);
      assert.deepEqual(approve.compiled, {
        event: 'APPROVE',
        object: 'order',
        from: 'submitted',
        to: 'approved',
        actor: 'manager',
        kind: 'action',
        when: 'order_status = "submitted" ∧ cond_s1_t12',
        effect: 'order_status\' = "approved"',
      });

      const total = frameOf(frames, 'fr:s1.t12');
      assert.equal(total.marker, 'if');
      assert.deepEqual(total.notTransition, { reason: 'no verb' });
      assert.equal(total.compiled, undefined);

      const cancel = frameOf(frames, 'fr:s2.t1');
      assert.equal(cancel.negated, true);
      assert.deepEqual(roles(cancel), { actor: 'clerk', event: 'cancel', object: 'package', result: 'cancelled', when: 'unknown' });
      assert.equal(cancel.compiled?.kind, 'forbidden');
      assert.equal(cancel.roles.event.latest.dependsOn.length, 2);

      const ship = frameOf(frames, 'fr:s3.t6');
      assert.equal(text(ship.roles.actor.latest.value), 'clerk');
      assert.deepEqual(ship.roles.actor.latest.dependsOn, ['sp:s3.t2..s3.t2']);
      assert.equal(text(ship.roles.object.latest.value), 'package');
      assert.deepEqual(ship.roles.object.latest.dependsOn, ['sp:s3.t5..s3.t5', 'sp:s3.t8..s3.t8']);

      const starts = frameOf(frames, 'fr:s4.t1');
      assert.deepEqual(roles(starts), { actor: 'unknown', event: 'start', object: 'order', result: 'draft', when: 'unknown' });
      assert.deepEqual(refs(starts.roles.result.latest.value), ['concept:draft']);

      assert.deepEqual(document.findings.map((finding) => finding.id), ['value-never-assigned:cond_s1_t12=true']);
      assert.deepEqual(document.findings[0]?.refs, ['cond_s1_t12', 'fr:s1.t7']);
      assert.equal(document.findings.every((finding) => finding.severity === 'warning'), true);

      const filtered = json<SpecFramesDocument>(run(dir, ['spec', 'frames', 'list', '--sentence', 's3', '--json']));
      assert.deepEqual(filtered.frames?.map((frame) => frame.id), ['fr:s3.t1', 'fr:s3.t6']);
      assert.deepEqual(filtered.findings, []);
      const stored = JSON.parse(readFileSync(join(specSessionDir('flow', { CLEW_DATA_DIR: dir }), 'frames.json'), 'utf8')) as { schemaVersion: number; frames: unknown[] };
      assert.equal(stored.schemaVersion, 5);
      assert.equal(stored.frames.length, 7);
    });
  });

  test('a boolean condition guards the graph transition, and status counts frames', () => {
    withData((dir) => {
      prepare(dir, SPEC);
      assert.equal(run(dir, ['spec', 'frames', 'list', '--json']).status, 0);
      const built = run(dir, ['spec', 'graph', 'build', '--json']);
      const graph = json<SpecGraphDocument>(built);
      const approve = graph.graph?.transitions.find((transition) => transition.event === 'APPROVE');
      assert.equal(approve?.from, 'submitted');
      assert.equal(approve?.guard, 'condition:cond_s1_t12');
      assert.equal(approve?.frame, 'fr:s1.t7');
      assert.equal(graph.findings.some((finding) => finding.code === 'guard-without-else'), false);
      const status = json<SpecStatusDocument>(run(dir, ['spec', 'status', '--json']));
      assert.equal(status.layers?.concepts, true);
      assert.equal(status.layers?.frames, true);
      assert.deepEqual(status.coverage?.frames, { transition: 6, notTransition: 1, incomplete: 0 });
      assert.deepEqual(status.coverage?.sentences.mapped, ['s1', 's2', 's3', 's4']);
    });
  });

  test('passive voice reads the by-actor, and a frame without an object is a warning', () => {
    withData((dir) => {
      prepare(dir, 'The order is cancelled by the manager. Then it is archived.');
      const document = json<SpecFramesDocument>(run(dir, ['spec', 'frames', 'list', '--json']));
      const frames = document.frames ?? [];
      assert.equal(frames.length, 2);
      const archive = frameOf(frames, 'fr:s2.t1');
      assert.deepEqual(roles(archive), { actor: 'unknown', event: 'archive', object: 'unknown', result: 'archived', when: 'The order is cancelled by the manager' });
      assert.equal(archive.compiled, undefined);
      assert.deepEqual(document.findings.map((finding) => [finding.id, finding.severity]), [['frame-missing-object:fr:s2.t1', 'warning']]);
      const frame = frameOf(frames, 'fr:s1.t1');
      assert.deepEqual(roles(frame), { actor: 'manager', event: 'cancel', object: 'order', result: 'cancelled', when: 'unknown' });
      assert.deepEqual(frame.compiled, {
        event: 'CANCEL',
        object: 'order',
        from: 'null',
        to: 'cancelled',
        actor: 'manager',
        kind: 'action',
        when: 'order_status = null',
        effect: 'order_status\' = "cancelled"',
      });
    });
  });

  test('layers are required in order, and bad input is exit 2', () => {
    withData((dir) => {
      const file = join(dir, 'flow.md');
      writeFileSync(file, `${SPEC}\n`);
      assert.equal(run(dir, ['spec', 'init', file, '--json']).status, 0);
      const early = run(dir, ['spec', 'concepts', 'list', '--json']);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /no tokens; run clew spec tag first/);
      assert.equal(run(dir, ['spec', 'tag', '--json']).status, 0);
      const absent = json<SpecStatusDocument>(run(dir, ['spec', 'status', '--json']));
      const codes = absent.findings.map((finding) => finding.code);
      assert.equal(codes.includes('concepts-absent') && codes.includes('frames-absent'), true);
      const graph = run(dir, ['spec', 'graph', 'build', '--json']);
      assert.equal(graph.status, 2);
      assert.match(graph.stderr, /no frames; run clew spec frames list first/);
      const unknown = run(dir, ['spec', 'frames', 'list', '--sentence', 's9', '--json']);
      assert.equal(unknown.status, 2);
      assert.match(unknown.stderr, /unknown sentence "s9"/);
      const bad = run(dir, ['spec', 'frames', 'list', '--sentence', 'x', '--json']);
      assert.equal(bad.status, 2);
      assert.equal(json<SpecFramesDocument>(bad).fault, 'usage');
    });
  });

  test('help lists the concept and frame commands', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec concepts list/);
    assert.match(help.stdout, /spec frames list/);
    assert.doesNotMatch(help.stdout, /spec entities|spec facts/);
  });
});

function frameOf(frames: readonly FrameView[], id: string): FrameView {
  const frame = frames.find((item) => item.id === id);
  assert.ok(frame, id);
  return frame;
}

function roles(frame: FrameView): Record<string, string> {
  return {
    actor: text(frame.roles.actor.latest.value),
    event: text(frame.roles.event.latest.value),
    object: text(frame.roles.object.latest.value),
    result: text(frame.roles.result.latest.value),
    when: text(frame.roles.when.latest.value),
  };
}

function text(role: Role): string {
  return role === 'unknown' ? 'unknown' : role.text;
}

function refs(role: Role): string[] {
  return role === 'unknown' ? [] : role.refs;
}

function prepare(dir: string, spec: string): void {
  const file = join(dir, 'flow.md');
  writeFileSync(file, `${spec}\n`);
  const init = run(dir, ['spec', 'init', file, '--json']);
  assert.equal(init.status, 0, init.stderr);
  const tag = run(dir, ['spec', 'tag', '--json']);
  assert.equal(tag.status, 0, tag.stderr);
}

function historyCommands(dir: string): string[] {
  const file = join(specSessionDir('flow', { CLEW_DATA_DIR: dir }), 'history.jsonl');
  const commands: string[] = [];
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    if (line !== '') commands.push((JSON.parse(line) as { command: string }).command);
  }
  return commands;
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function run(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  return clew(args, dir);
}

function clew(args: string[], dataDir: string): { status: number; stdout: string; stderr: string } {
  const env = Object.assign({}, process.env);
  env.CLEW_DATA_DIR = dataDir;
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, env, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function withData(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-frames-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
