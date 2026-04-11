import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests mutate `./test-data` in place (create/rename/delete files),
 * so they can't run in parallel against the same backing directory.
 * `fullyParallel: false` + `workers: 1` forces strict serial execution
 * across files, and each test file's `beforeEach` reseeds the
 * filesystem to a known state via `e2e/fixtures.ts`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html']] : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      DATA_DIR: './test-data',
      TEMPLATES_DIR: './test-templates',
    },
  },
});
