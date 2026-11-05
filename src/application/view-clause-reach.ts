// Use case: kernel reach of each compiled clause for the inspector Frames tab. Domain JSON stays read-only.
import { compileFrames } from '../domain/spec-compile.js';
import { clauseReach } from '../domain/spec-kernel.js';
import type { ClauseReachDocument } from './documents.js';
import type { SpecStore } from './ports.js';
import { frameViews } from './spec-views.js';

export interface ViewClauseReachCommand {
  id: string;
}

export function viewClauseReach(command: ViewClauseReachCommand, store: SpecStore): ClauseReachDocument {
  const result = store.update(command.id, { create: false }, () => undefined);
  if (!result.ok) return { session: command.id, frames: {}, error: result.message };
  const frames = result.snapshot.frames ?? [];
  const compilation = compileFrames(frames, result.snapshot.concepts ?? []);
  const reach: ClauseReachDocument['frames'] = {};
  for (const view of frameViews(frames, compilation.compiled.items, compilation.restated, clauseReach(compilation.compiled))) {
    if (view.reach !== undefined) reach[view.id] = view.reach;
  }
  return { session: result.snapshot.id, frames: reach };
}
