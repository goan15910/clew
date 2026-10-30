import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: isCi,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // 4-vCPU ubuntu-latest: 4 Chromium + 4 viewer servers thrash; 2 workers scales more reliably.
  // CI also shards the suite across matrix jobs (see e2e-viewer.yml).
  workers: isCi ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
    // outputDir defaults to `ctrf/`; outputFile is the basename only.
    ['playwright-ctrf-json-reporter', { outputFile: 'ctrf-report.json' }],
    ...(isCi ? [['github'] as const] : []),
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  outputDir: 'test-results',
});
