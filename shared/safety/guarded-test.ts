import { test as base, type Page, type TestInfo } from '@playwright/test';
import { assertTestUrl, isAllowedTestHost } from './environment-guard';
import { ExecutionNotPermittedError, evaluateLevel } from './execution-gate';
import { evaluateIsolatedEnvironment } from './isolated-environment';
import { applyNetworkPolicy, type NetworkPolicyHandle } from './network-policy';
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

export const test = base.extend<GuardedFixtures>({
  allowedMutations: [[], { option: true }],
  sensitiveSelectors: [[], { option: true }],

  safetyLevel: [
    async ({ baseURL }, use, testInfo) => {
      const level = safetyLevelOf(testInfo);
      const decision = evaluateLevel(level);
      if (!decision.permitted) {
        if (SAFETY_POLICIES[level].onDenied === 'skip') {
          testInfo.skip(true, `NOT PERMITTED (${level}): ${decision.reasons.join(' ')}`);
        }
        throw new ExecutionNotPermittedError(decision);
      }
      if (level !== 'framework') {
        const target = assertTestUrl(baseURL, 'CLOUD_SIGNUP_BASE_URL');
        if (level === 'provisioning') requireProvisioningApproval();
        if (level === 'destructive') {
          const reasons = evaluateIsolatedEnvironment(target.hostname);
          if (reasons.length) throw new Error(`SUITE C REFUSED: ${reasons.join(' ')}`);
        }
      }
      testInfo.annotations.push({ type: 'environment', description: baseURL ? new URL(baseURL).host : 'none' });
      await use(level);
    },
    { auto: true },
  ],

  networkPolicy: async ({ context, safetyLevel, allowedMutations }, use) => {
    await use(await applyNetworkPolicy(context, { level: safetyLevel, allowedMutations }));
  },

  page: async ({ page, networkPolicy, sensitiveSelectors }, use, testInfo) => {
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) await captureRedactedEvidence(page, testInfo, sensitiveSelectors);
    if (networkPolicy.allowedWrites.length) {
      await testInfo.attach('write-requests-redacted', {
        body: networkPolicy.allowedWrites.join('\n'),
        contentType: 'text/plain',
      });
    }
    if (networkPolicy.violations.length) {
      throw new Error(`NETWORK SAFETY VIOLATION:\n- ${networkPolicy.violations.join('\n- ')}`);
    }
  },

  readonlyApi: async ({ request, baseURL }, use) => {
    await use({
      async getJson<T>(pathOrUrl: string) {
        const url = new URL(pathOrUrl, baseURL);
        if (!isAllowedTestHost(url.hostname)) {
          throw new Error(`Read-only API call refused: ${redactUrl(url.toString())} is not an approved TEST host.`);
        }
        const response = await request.get(url.toString(), { headers: { accept: 'application/json' } });
        const text = await response.text();
        let body: T;
        try {
          body = JSON.parse(text) as T;
        } catch {
          throw new Error(
            `Expected JSON from ${redactUrl(url.toString())} (HTTP ${response.status()}), got: ${redactText(text.slice(0, 200))}`,
          );
        }
        return { status: response.status(), body };
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
