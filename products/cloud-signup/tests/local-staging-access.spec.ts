import { expect, test } from '../../../shared/safety/guarded-test';
import {
  describeSecurityChallenge,
  detectSecurityChallenge,
  SECURITY_CHALLENGE_CLASSIFICATION,
} from '../../../shared/reporting/security-challenge';
import { SAFETY_ANNOTATION } from '../../../shared/safety/safety-levels';

/**
 * One read-only navigation to the staging signup page, for a person to run on
 * their own computer. It is not part of Suite A: QA_SUITE=local-access selects
 * this file alone. The context is empty. No Chrome profile, cookies, or login
 * session is loaded, and nothing is typed or submitted.
 */
test.describe.configure({ retries: 0 });
test.use({ storageState: { cookies: [], origins: [] } });

const SAFE_HEADERS = ['server', 'cf-mitigated', 'cf-ray', 'content-type', 'date'];

test(
  'Local staging access — open /signup/',
  {
    annotation: [
      { type: SAFETY_ANNOTATION, description: 'readonly' },
      { type: 'test-id', description: 'LOCAL-STAGING-ACCESS' },
    ],
  },
  async ({ page, securityChallenge }, testInfo) => {
    const response = await page.goto('/signup/', { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    const title = await page.title();
    const headers = response?.headers() ?? {};
    const body = await page.content().catch(() => '');
    const observed = new URL(page.url());
    const url = `${observed.origin}${observed.pathname}`;
    const challenge = detectSecurityChallenge({
      url,
      status,
      headers,
      title,
      body: body.slice(0, 8_000),
    });
    const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    const record = {
      url,
      httpStatus: status,
      title,
      cloudflareChallenge: Boolean(challenge),
      classification: challenge ? SECURITY_CHALLENGE_CLASSIFICATION : 'REACHED',
      headers: Object.fromEntries(SAFE_HEADERS.filter((name) => lowerHeaders[name]).map((name) => [name, lowerHeaders[name]])),
      challenge,
    };
    const text = JSON.stringify(record, null, 2);
    await testInfo.attach('local-staging-access', { body: text, contentType: 'application/json' });
    console.log(`\n=== Local staging access ===\n${text}\n`);

    if (challenge) {
      await securityChallenge.stopIfChallenged('Signup page was not reached. No form was submitted.', page);
      testInfo.skip(true, describeSecurityChallenge(challenge));
    }

    expect(status, 'Signup landing HTTP status, with no Cloudflare challenge detected').toBeLessThan(400);
  },
);
