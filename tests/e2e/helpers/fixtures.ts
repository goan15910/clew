import { test as base } from '@playwright/test';
import { startViewerWithServeApi, type RunningViewer } from './viewer-harness.js';

type WorkerFixtures = {
  viewer: RunningViewer;
};

// One in-process viewer server per worker (same HTTP serve path as `clew spec view --open`).
// Avoids a per-worker `tsx src/cli.ts` cold start that contended with Chromium on 4-vCPU runners.
export const test = base.extend<object, WorkerFixtures>({
  viewer: [
    async ({}, use) => {
      const viewer = await startViewerWithServeApi();
      await use(viewer);
      await viewer.stop();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ viewer }, use) => {
    await use(new URL(viewer.url).origin);
  },
});

export { expect } from '@playwright/test';
