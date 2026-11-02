// Playwright config: WebKit only, emulating an iPhone 11 (414x896, DPR 2, touch, mobile UA).
import { defineConfig, devices } from '@playwright/test';

// This host lacks libavif/libmanette system packages; tests/setup-webkit.sh vendors them
// into MiniBrowser's private lib dir, so the host check would be a false negative.
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.mjs$/,
  // Per-run output dir: concurrent Playwright runs (agents) must not delete each other's traces.
  outputDir: (process.env.RF_PW_OUT ||= `../test-results/run-${process.pid}`), // set once in the runner, inherited by workers
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 15000,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'iphone11-webkit',
      use: { ...devices['iPhone 11'], browserName: 'webkit' },
    },
  ],
});
