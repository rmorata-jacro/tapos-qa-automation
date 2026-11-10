import { defineConfig, devices, type Project } from '@playwright/test';
import { loadLocalEnv } from './config/load-env';
import { resolveBaseUrl, selectedSuite, SUITE_FILES, type SuiteSelection } from './config/suites';
import { hardenLaunchOptions } from './shared/safety/browser-hardening';

loadLocalEnv();

const suite = selectedSuite();
const baseURL = resolveBaseUrl(suite);

/** Traces capture typed values and full URLs, so they are only kept for suites that never handle secrets. */
const TRACE: Record<SuiteSelection, 'off' | 'retain-on-failure'> = {
  framework: 'off',
  'local-access': 'off',
  'A-readonly': 'retain-on-failure',
  'A-gated': 'off',
  B: 'off',
  C: 'off',
};

const highRisk = suite === 'B' || suite === 'C';

const project: Project = {
  name: suite,
  ...SUITE_FILES[suite],
  // Product suites get hardened launch options from the guarded fixture; framework browser checks need them here.
  use: suite === 'framework'
    ? { launchOptions: hardenLaunchOptions({}) }
    : { ...devices['Desktop Chrome'], baseURL, trace: TRACE[suite] },
};

export default defineConfig({
  projects: [project],
  globalSetup: './config/global-setup.ts',
  fullyParallel: !highRisk && suite !== 'A-gated',
  workers: highRisk ? 1 : undefined,
  retries: suite === 'local-access' ? 0 : suite === 'A-readonly' && process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: suite === 'B' ? 10 * 60_000 : 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'reports/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['./shared/reporting/classification-reporter.ts', { outputFile: 'reports/classified-results.json' }],
  ],
  use: {
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
