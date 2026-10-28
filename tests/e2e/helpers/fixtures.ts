import { test as base } from '@playwright/test';
import { startViewerWithCliOpen, type RunningViewer } from './viewer-harness.js';

type WorkerFixtures = {
  viewer: RunningViewer;
};

export const test = base.extend<object, WorkerFixtures>({
  viewer: [
    async ({}, use) => {
      const viewer = await startViewerWithCliOpen();
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
