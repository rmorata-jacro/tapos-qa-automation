import { test as base, type Page, type TestInfo } from '@playwright/test';
import { APPROVED_STAGING } from '../../config/environments';
import { guardContext, hardenLaunchOptions } from './browser-hardening';
import { verifyHostResolution } from './dns-guard';
import { assertStagingUrl, proxyEnvironmentReasons, UnsafeEnvironmentError } from './environment-guard';
import { ExecutionNotPermittedError, evaluateLevel } from './execution-gate';
import { guardApiContext } from './guarded-api';
import { evaluateIsolatedEnvironment } from './isolated-environment';
import type { NetworkPolicyHandle } from './network-policy';
import { requireProvisioningApproval } from './provisioning-approval';
import { redactText, redactUrl } from './redaction';
import { isSafetyLevel, SAFETY_ANNOTATION, SAFETY_POLICIES, type SafetyLevel } from './safety-levels';

const DEFAULT_MASKS = ['input[type="password"]', 'input[type="email"]', '[data-qa-sensitive]', '[autocomplete="one-time-code"]'];

export interface ReadonlyApi {
  getJson<T = unknown>(pathOrUrl: string): Promise<{ status: number; body: T }>;
}

export interface GuardedFixtures {
  /** Pathname patterns a gated test may send mutating requests to. */
  allowedMutations: RegExp[];
  /** Extra selectors masked in failure screenshots. */
  sensitiveSelectors: string[];
  safetyLevel: SafetyLevel;
  networkPolicy: NetworkPolicyHandle;
  readonlyApi: ReadonlyApi;
}

export interface GuardedWorkerFixtures {
  stagingResolutionVerified: void;
}

export function safetyLevelOf(testInfo: TestInfo): SafetyLevel {
  const declared = testInfo.annotations.filter((a) => a.type === SAFETY_ANNOTATION).map((a) => a.description);
  if (declared.length !== 1 || !isSafetyLevel(declared[0])) {
    throw new Error(
      `Test "${testInfo.title}" must declare exactly one "${SAFETY_ANNOTATION}" annotation. ` +
        'Unclassified tests are never assumed to be read-only.',
    );
  }
  return declared[0];
}

async function captureRedactedEvidence(page: Page, testInfo: TestInfo, extraMasks: string[]): Promise<void> {
  if (page.isClosed()) return;
  try {
    const screenshot = await page.screenshot({
      fullPage: true,
      mask: [...DEFAULT_MASKS, ...extraMasks].map((selector) => page.locator(selector)),
      maskColor: '#000000',
      timeout: 10_000,
    });
    await testInfo.attach('failure-screenshot-redacted', { body: screenshot, contentType: 'image/png' });
  } catch (error) {
    await testInfo.attach('failure-screenshot-error', { body: redactText(String(error)), contentType: 'text/plain' });
  }
  await testInfo.attach('page-url-redacted', { body: redactUrl(page.url()), contentType: 'text/plain' });
}

/**
 * Every product and workflow spec imports `test` from here, so these
 * restrictions apply however the spec is executed (npm script, direct file
 * path, or another config):
 * - the browser can only resolve approved staging hosts and ignores proxies;
 * - the staging host must resolve to public, non-production addresses;
 * - baseURL must be the approved staging host over https;
 * - browser, redirect, WebSocket, and API traffic is policed per safety level.
 */
export const test = base.extend<GuardedFixtures, GuardedWorkerFixtures>({
  launchOptions: [async ({ launchOptions }, use) => use(hardenLaunchOptions(launchOptions)), { scope: 'worker' }],

  stagingResolutionVerified: [
    async ({}, use) => {
      const reasons = [...proxyEnvironmentReasons(), ...(await verifyHostResolution(APPROVED_STAGING.hosts))];
      if (reasons.length) throw new UnsafeEnvironmentError(`Staging network check failed: ${reasons.join(' ')}`);
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  allowedMutations: [[], { option: true }],
  sensitiveSelectors: [[], { option: true }],

  safetyLevel: [
    async ({ baseURL, proxy }, use, testInfo) => {
      const level = safetyLevelOf(testInfo);
      const target = assertStagingUrl(baseURL, 'CLOUD_SIGNUP_BASE_URL');
      if (proxy) throw new UnsafeEnvironmentError('A Playwright proxy is configured; it can hide the real destination.');
      const decision = evaluateLevel(level);
      if (!decision.permitted) {
        if (SAFETY_POLICIES[level].onDenied === 'skip') {
          testInfo.skip(true, `NOT PERMITTED (${level}): ${decision.reasons.join(' ')}`);
        }
        throw new ExecutionNotPermittedError(decision);
      }
      if (level === 'provisioning') requireProvisioningApproval();
      if (level === 'destructive') {
        const reasons = evaluateIsolatedEnvironment(target.hostname);
        if (reasons.length) throw new Error(`SUITE C REFUSED: ${reasons.join(' ')}`);
      }
      testInfo.annotations.push({ type: 'environment', description: target.host });
      await use(level);
    },
    { auto: true },
  ],

  networkPolicy: async ({ context, safetyLevel, allowedMutations, baseURL }, use) => {
    await use(await guardContext(context, { level: safetyLevel, allowedMutations, baseURL }));
  },

  request: async ({ request, safetyLevel, allowedMutations, baseURL }, use) => {
    await use(guardApiContext(request, { level: safetyLevel, allowedMutations, baseURL }));
  },

  page: async ({ page, networkPolicy, sensitiveSelectors }, use, testInfo) => {
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) await captureRedactedEvidence(page, testInfo, sensitiveSelectors);
    if (networkPolicy.allowedWrites.length) {
      await testInfo.attach('write-requests-redacted', { body: networkPolicy.allowedWrites.join('\n'), contentType: 'text/plain' });
    }
    if (networkPolicy.blockedRequests.length) {
      await testInfo.attach('blocked-background-requests', { body: networkPolicy.blockedRequests.join('\n'), contentType: 'text/plain' });
    }
    if (networkPolicy.violations.length) {
      throw new Error(`NETWORK SAFETY VIOLATION:\n- ${networkPolicy.violations.join('\n- ')}`);
    }
  },

  readonlyApi: async ({ request, baseURL }, use) => {
    const api = guardApiContext(request, { level: 'readonly', allowedMutations: [], baseURL });
    await use({
      async getJson<T>(pathOrUrl: string) {
        const response = await api.get(pathOrUrl, { headers: { accept: 'application/json' } });
        const text = await response.text();
        try {
          return { status: response.status(), body: JSON.parse(text) as T };
        } catch {
          throw new Error(`Expected JSON from ${redactUrl(response.url())} (HTTP ${response.status()}), got: ${redactText(text.slice(0, 200))}`);
        }
      },
    });
  },
});

export { expect } from '@playwright/test';

/**
 * Navigates to a URL that contains a secret (e.g. a verification link)
 * without exposing it: page.goto records the full URL in report step titles
 * and error messages.
 */
export async function navigateSensitive(page: Page, url: URL, label: string): Promise<void> {
  await base.step(`Open ${label} (URL redacted)`, async () => {
    try {
      await Promise.all([
        page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame(), timeout: 30_000 }),
        page.evaluate((target) => {
          window.location.href = target;
        }, url.toString()),
      ]);
      await page.waitForLoadState('domcontentloaded');
    } catch (error) {
      throw new Error(`Failed to open ${label}: ${redactText(String(error))}`);
    }
  });
}
