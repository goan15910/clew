import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../../src/adapters/spec-store/data-dir.js';
import { jsonSpecStore } from '../../../src/adapters/spec-store/json-file-store.js';
import type { SpecSnapshot } from '../../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

export const GUARDED_SPEC = [
  'When the customer submits an order, the manager approves the order if the total is under 500 dollars.',
  'A clerk must not cancel a shipped package.',
].join('\n');

/** init, tag, frames list, and optionally graph build. Returns the session folder. */
export function buildFramesSession(dataDir: string, id: string, options: { graph: boolean }): string {
  const file = join(dataDir, `${id}.md`);
  writeFileSync(file, `${GUARDED_SPEC}\n`);
  const steps = [['spec', 'init', file], ['spec', 'tag'], ['spec', 'frames', 'list']];
  if (options.graph) steps.push(['spec', 'graph', 'build']);
  for (const step of steps) {
    const result = spawnSync(tsx, ['src/cli.ts', ...step, '--session', id, '--json'], {
      cwd: root,
      env: { ...process.env, CLEW_DATA_DIR: dataDir },
      encoding: 'utf8',
    });
    assert.ok(result.status === 0 || result.status === 1, `${step.join(' ')}: ${result.stderr}`);
  }
  return specSessionDir(id, { CLEW_DATA_DIR: dataDir });
}

export function loadFramesSnapshot(dataDir: string, id: string): SpecSnapshot {
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dataDir;
  try {
    const loaded = jsonSpecStore.update(id, { create: false }, () => undefined);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
    return loaded.snapshot;
  } finally {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
  }
}
