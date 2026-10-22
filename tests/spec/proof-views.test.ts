import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodePng, encodeAnimatedGif, gifFrameCount, type Raster } from '../../src/adapters/diagram/gif.js';
import { coverageHeatmapSvg } from '../../src/adapters/diagram/heatmap.js';
import { frameCaption, replayFrameDot, stepMark } from '../../src/adapters/diagram/replay-frames.js';
import { transitionCoverage, type TransitionCoverage, type WorkflowResult } from '../../src/domain/verification.js';
import type { Model, Transition } from '../../src/domain/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function clew(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function edge(from: string, event: string, to: string): Transition {
  return { from, event, to, actor: 'user', effect: { name: 'mark', sets: 'flag' } };
}

function modelOf(transitions: readonly Transition[]): Model {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const transition of transitions) {
    add(transition.from);
    add(transition.to);
  }
  return {
    id: 'sample',
    initial: ids[0] ?? 'a',
    states: () => ids.map((id) => ({ id, label: id, final: false, data: [] })),
    transitions: () => transitions,
  };
}

function flow(id: string, steps: readonly { from: string; event: string; to: string | null; accepted: boolean }[], expect: WorkflowResult['expect'] = 'accepted', pass = true): WorkflowResult {
  return {
    id,
    title: id,
    expect,
    pass,
    reason: pass ? 'ok' : 'failed',
    trace: steps.map((step, index) => ({
      n: index + 1,
      text: step.event,
      event: step.event,
      from: step.from,
      to: step.to,
      accepted: step.accepted,
      workflowEvent: step.event.toLowerCase(),
      workflowFrom: step.from,
      workflowTo: step.accepted ? step.to : null,
    })),
    finalState: steps[steps.length - 1]?.to ?? steps[0]?.from ?? null,
    finalWorkflowState: null,
    provedBy: 'replay',
  };
}

function solid(width: number, height: number, r: number, g: number, b: number): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function near(raster: Raster, r: number, g: number, b: number, tolerance: number): boolean {
  const pixels = raster.width * raster.height;
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4;
    const dr = (raster.rgba[offset] ?? 0) - r;
    const dg = (raster.rgba[offset + 1] ?? 0) - g;
    const db = (raster.rgba[offset + 2] ?? 0) - b;
    if (dr * dr + dg * dg + db * db <= tolerance * tolerance) return true;
  }
  return false;
}

describe('proof views', () => {
  test('domain and application do not import the diagram codecs', () => {
    const offenders: string[] = [];
    for (const layer of ['domain', 'application']) {
      for (const file of walk(join(root, 'src', layer))) {
        const source = readFileSync(file, 'utf8');
        if (source.includes('adapters/diagram') || source.includes('node:zlib') || source.includes('child_process')) offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('transition coverage counts accepted steps and skips a refusal', () => {
    const model = modelOf([
      edge('draft', 'SUBMIT', 'todo'),
      edge('todo', 'ARCHIVE', 'archived'),
    ]);
    const rows = transitionCoverage(model, [
      flow('W1', [
        { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
        { from: 'todo', event: 'ARCHIVE', to: 'archived', accepted: true },
      ]),
      flow('W8', [
        { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
        { from: 'todo', event: 'ARCHIVE', to: null, accepted: false },
      ], 'rejected', true),
      flow('W1b', [
        { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
        { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
      ]),
    ]);
    const submit = rows.find((row) => row.event === 'SUBMIT');
    const archive = rows.find((row) => row.event === 'ARCHIVE');
    assert.ok(submit);
    assert.ok(archive);
    assert.equal(submit.count, 4);
    assert.deepEqual(submit.flows, ['W1', 'W8', 'W1b']);
    assert.equal(archive.count, 1);
    assert.deepEqual(archive.flows, ['W1']);
    assert.deepEqual(rows.map((row) => row.event), ['SUBMIT', 'ARCHIVE']);
  });

  test('an unexercised transition stays in the heatmap as a cold zero', () => {
    const model = modelOf([edge('draft', 'DELETE', 'deleted'), edge('deleted', 'RESTORE', 'draft')]);
    const rows = transitionCoverage(model, [flow('W5', [{ from: 'draft', event: 'DELETE', to: 'deleted', accepted: true }])]);
    const restore = rows.find((row) => row.event === 'RESTORE');
    assert.ok(restore);
    assert.equal(restore.count, 0);
    assert.deepEqual(restore.flows, []);
    const svg = coverageHeatmapSvg(model, 'a-basic', 1, rows);
    assert.match(svg, /Transition coverage: a-basic/);
    assert.match(svg, /deleted — RESTORE → draft: 0/);
    assert.match(svg, /#d0e2f3/);
    assert.match(svg, /#b22318/);
    assert.equal(svg.includes('graphviz'), false);
  });

  test('a passing refusal and a wrong accept are labeled on the last frame', () => {
    const model = modelOf([
      edge('draft', 'SUBMIT', 'todo'),
      edge('todo', 'START', 'inProgress'),
      edge('done', 'ARCHIVE', 'archived'),
    ]);
    const refused = flow('W8', [
      { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
      { from: 'todo', event: 'START', to: 'inProgress', accepted: true },
      { from: 'inProgress', event: 'ARCHIVE', to: null, accepted: false },
    ], 'rejected', true);
    refused.title = 'Unfinished task cannot be archived';
    const wrong = flow('W8', [
      { from: 'draft', event: 'SUBMIT', to: 'todo', accepted: true },
      { from: 'todo', event: 'START', to: 'inProgress', accepted: true },
      { from: 'inProgress', event: 'ARCHIVE', to: 'archived', accepted: true },
    ], 'rejected', false);
    assert.equal(stepMark(refused, refused.trace[2]!), 'refused');
    assert.equal(stepMark(wrong, wrong.trace[2]!), 'wrong-accept');
    const last = replayFrameDot(model, refused, refused.trace.length);
    const first = replayFrameDot(model, refused, 0);
    assert.match(last, /refused \(as required\)/);
    assert.match(last, /#1a7f37/);
    assert.match(frameCaption(refused, 3), /ARCHIVE {2}refused/);
    assert.match(first, /#d0d7de/);
    assert.equal(first.includes('#1a7f37'), false);
    assert.match(replayFrameDot(model, wrong, wrong.trace.length), /should be refused/);
    assert.match(replayFrameDot(model, wrong, wrong.trace.length), /#cf222e/);
  });

  test('gif frames keep the canvas and the count', () => {
    const gif = encodeAnimatedGif(
      [solid(2, 2, 200, 10, 10), solid(3, 1, 10, 10, 200)],
      { delayCs: 10, lastDelayCs: 20 },
    );
    assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(gif.readUInt16LE(6), 3);
    assert.equal(gif.readUInt16LE(8), 2);
    assert.equal(gifFrameCount(gif), 2);
    assert.equal(gif[gif.length - 1], 0x3b);
  });

  test('--heatmap and --replay need --out', () => {
    for (const flag of ['--heatmap', '--replay']) {
      const result = clew(['verify', 'examples/todo/b-full.yaml', 'examples/todo/workflows.yaml', 'examples/todo/mapping.yaml', flag, '--json']);
      assert.equal(result.status, 2, flag);
      assert.match(result.stderr, /need --out/);
      const document = JSON.parse(result.stdout) as { fault?: string; ok: boolean };
      assert.equal(document.fault, 'usage');
      assert.equal(document.ok, false);
    }
  });

  test('b-full heatmap and W8 replay are written, and a-basic still fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clew-views-'));
    try {
      const heat = clew(['verify', 'examples/todo/b-full.yaml', 'examples/todo/workflows.yaml', 'examples/todo/mapping.yaml', '--heatmap', '--out', dir]);
      assert.equal(heat.status, 0, heat.stderr);
      assert.match(heat.stdout, /heatmap: coverage-heatmap\.svg/);
      const svg = readFileSync(join(dir, 'coverage-heatmap.svg'), 'utf8');
      assert.match(svg, /draft — SUBMIT → todo: 7 \(W1, W2, W3, W4, W6, W7, W8\)/);
      assert.match(svg, /archived — UNARCHIVE → done: 0/);

      const replay = clew(['verify', 'examples/todo/b-full.yaml', 'examples/todo/workflows.yaml', 'examples/todo/mapping.yaml', '--replay', '--flow', 'W8', '--out', dir, '--json']);
      assert.equal(replay.status, 0, replay.stderr);
      const document = JSON.parse(replay.stdout) as { views?: { replays?: { id: string; file: string; frames: number }[] }; transitionCoverage?: TransitionCoverage[] };
      assert.equal(document.transitionCoverage, undefined);
      assert.equal(document.views?.replays?.[0]?.frames, 4);
      const gif = readFileSync(join(dir, 'replays', 'W8.gif'));
      assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
      assert.equal(gifFrameCount(gif), 4);

      const basic = clew(['verify', 'examples/todo/a-basic.yaml', 'examples/todo/workflows.yaml', 'examples/todo/mapping.yaml', '--replay', '--flow', 'W8', '--out', dir, '--json']);
      assert.equal(basic.status, 1, basic.stderr);
      assert.equal(basic.stderr, '');
      const failed = JSON.parse(basic.stdout) as { ok: boolean; views?: { replays?: { frames: number }[] } };
      assert.equal(failed.ok, false);
      assert.equal(failed.views?.replays?.[0]?.frames, 4);
      assert.equal(existsSync(join(dir, 'replays', 'W8.gif')), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the W8 replay frame is drawn green when refused and red when accepted', () => {
    const passed = clewJson('examples/todo/b-full.yaml');
    const failed = clewJson('examples/todo/a-basic.yaml');
    const model = modelOf([
      edge('draft', 'SUBMIT', 'todo'),
      edge('todo', 'START', 'inProgress'),
      edge('inProgress', 'ARCHIVE', 'archived'),
    ]);
    const refusedDot = replayFrameDot(model, passed, passed.trace.length);
    const refusedPng = execFileSync('neato', ['-n', '-Tpng', '-Gdpi=72'], { input: refusedDot, maxBuffer: 8 * 1024 * 1024 });
    const refused = decodePng(refusedPng);
    assert.equal(near(refused, 0x1a, 0x7f, 0x37, 24), true);
    const startDot = replayFrameDot(model, passed, 0);
    const start = decodePng(execFileSync('neato', ['-n', '-Tpng', '-Gdpi=72'], { input: startDot, maxBuffer: 8 * 1024 * 1024 }));
    assert.equal(near(start, 0x1a, 0x7f, 0x37, 12), false);
    const wrongDot = replayFrameDot(model, failed, failed.trace.length);
    const wrong = decodePng(execFileSync('neato', ['-n', '-Tpng', '-Gdpi=72'], { input: wrongDot, maxBuffer: 8 * 1024 * 1024 }));
    assert.equal(near(wrong, 0xcf, 0x22, 0x2e, 24), true);
  });
});

function clewJson(chart: string): WorkflowResult {
  const result = clew(['verify', chart, 'examples/todo/workflows.yaml', 'examples/todo/mapping.yaml', '--flow', 'W8', '--json']);
  assert.equal(result.status === 0 || result.status === 1, true, result.stderr);
  const document = JSON.parse(result.stdout) as {
    ok: boolean;
    flows: {
      id: string;
      title: string;
      expect: string;
      pass: boolean;
      reason: string;
      provedBy: string;
      trace: { n: number; text: string; accepted: boolean; workflow: { from: string; event: string; to: string | null }; chart: { from: string; event: string; to: string | null } }[];
    }[];
  };
  const item = document.flows[0];
  assert.ok(item);
  return {
    id: item.id,
    title: item.title,
    expect: item.expect,
    pass: item.pass,
    reason: item.reason,
    provedBy: item.provedBy,
    finalState: item.trace[item.trace.length - 1]?.chart.to ?? null,
    finalWorkflowState: item.trace[item.trace.length - 1]?.workflow.to ?? null,
    trace: item.trace.map((step) => ({
      n: step.n,
      text: step.text,
      accepted: step.accepted,
      event: step.chart.event,
      from: step.chart.from,
      to: step.chart.to,
      workflowEvent: step.workflow.event,
      workflowFrom: step.workflow.from,
      workflowTo: step.workflow.to,
    })),
  };
}
