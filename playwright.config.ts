import { defineConfig, devices, type Project } from '@playwright/test';
import { loadLocalEnv } from './config/load-env';
import { selectedSuite, SUITE_FILES, type SuiteSelection } from './config/suites';
import { assertTestUrl } from './shared/safety/environment-guard';

loadLocalEnv();

const suite = selectedSuite();
const baseURL = process.env.CLOUD_SIGNUP_BASE_URL;
if (suite !== 'framework' && baseURL) assertTestUrl(baseURL, 'CLOUD_SIGNUP_BASE_URL');

/** Traces capture typed values and full URLs, so they are only kept for suites that never handle secrets. */
const TRACE: Record<SuiteSelection, 'off' | 'retain-on-failure'> = {
  framework: 'off',
  'A-readonly': 'retain-on-failure',
  'A-gated': 'off',
  B: 'off',
  C: 'off',
};

const highRisk = suite === 'B' || suite === 'C';

const project: Project = {
  name: suite,
  ...SUITE_FILES[suite],
  use: suite === 'framework' ? {} : { ...devices['Desktop Chrome'], baseURL, trace: TRACE[suite] },
};

export default defineConfig({
  projects: [project],
  globalSetup: './config/global-setup.ts',
  fullyParallel: !highRisk && suite !== 'A-gated',
  workers: highRisk ? 1 : undefined,
  retries: suite === 'A-readonly' && process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: suite === 'B' ? 10 * 60_000 : 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'reports/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
