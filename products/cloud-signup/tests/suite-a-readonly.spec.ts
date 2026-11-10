import { randomBytes } from 'node:crypto';
import { expect, test } from '../../../shared/safety/guarded-test';
import { assertStagingUrl } from '../../../shared/safety/environment-guard';
import { fetchSignupOptions } from '../api/signup-options-client';
import { int3437Case, requireContract } from '../helpers/int-3437-case';
import { SignupLandingPage } from '../pages/signup-landing-page';
import { VerificationPage } from '../pages/verification-page';
import { signupContract } from '../signup-contract';

/**
 * Suite A (read-only). Every request is policed by the network guard: any
 * mutating request to the TEST host aborts and fails the test. Safe for
 * unattended nightly execution.
 */

const { paths, ui, api } = signupContract;

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const A01 = int3437Case('TC-A01');
test(A01.title, A01.details, async ({ page }) => {
  requireContract(paths.signupLanding, ui.landingHeading, ui.emailLabel, ui.submitSignupButton);
  const landing = new SignupLandingPage(page);

  await landing.open();

  await expect(landing.heading(), 'Signup landing heading should be visible').toBeVisible();
  await expect(landing.emailInput(), 'Signup email field should be editable').toBeEditable();
  await expect(landing.submitButton(), 'Signup submit button should be visible').toBeVisible();
});

const A02 = int3437Case('TC-A02');
test.describe(A02.title, () => {
  const invalidEmails = ['plainaddress', 'missing-at-sign.example.test', 'user@', '@example.test', 'two@@example.test'];

  for (const email of invalidEmails) {
    test(`${A02.title} [${email}]`, A02.details, async ({ page }) => {
      const [, , , message, validation] = requireContract(
        paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.invalidEmailMessage, ui.invalidEmailValidation,
      );
      test.skip(
        validation === 'server',
        'RECLASSIFY: invalid email is validated server-side (sends a POST). Move TC-A02 to Suite A-gated.',
      );
      const landing = new SignupLandingPage(page);
      await landing.open();

      await landing.requestSignup(email);

      await expect(landing.message(message), `"${email}" should show the invalid-email message`).toBeVisible();
    });
  }
});

const A03 = int3437Case('TC-A03');
test(A03.title, A03.details, async ({ page }) => {
  const [landingPath, behaviour] = requireContract(paths.signupLanding, ui.featureGateBehaviour);
  const gateOffBase = process.env.CLOUD_SIGNUP_GATE_OFF_BASE_URL;
  test.skip(!gateOffBase, 'BLOCKED: CLOUD_SIGNUP_GATE_OFF_BASE_URL (a TEST host with the signup gate OFF) is not configured.');
  const target = new URL(landingPath, assertStagingUrl(gateOffBase, 'CLOUD_SIGNUP_GATE_OFF_BASE_URL'));

  const response = await page.goto(target.toString());

  switch (behaviour.kind) {
    case 'http-status':
      expect(response?.status(), 'Signup page status with the feature gate OFF').toBe(behaviour.status);
      break;
    case 'redirect':
      await expect(page, 'Signup should redirect away when the gate is OFF').toHaveURL(behaviour.to);
      break;
    case 'message':
      await expect(page.getByText(behaviour.text), 'Gate-off message should be visible').toBeVisible();
      break;
  }
});

const A05 = int3437Case('TC-A05');
test.describe(A05.title, () => {
  const syntheticTokens: [string, () => string][] = [
    ['random well-formed token', () => randomBytes(32).toString('base64url')],
    ['malformed token', () => 'not-a-valid-token'],
    ['truncated token', () => randomBytes(4).toString('hex')],
  ];

  for (const [label, makeToken] of syntheticTokens) {
    test(`${A05.title} [${label}]`, A05.details, async ({ page, baseURL }) => {
      requireContract(paths.verification, ui.invalidTokenMessage);
      const verification = new VerificationPage(page, baseURL!);

      await verification.openWithToken(makeToken());

      await expect(verification.invalidTokenMessage(), `A ${label} must be rejected with the invalid-token message`).toBeVisible();
    });
  }
});

const A08 = int3437Case('TC-A08');
test(A08.title, A08.details, async ({ readonlyApi }) => {
  requireContract(paths.signupOptionsApi, api.parseSignupOptions);

  const { status, options } = await fetchSignupOptions(readonlyApi);

  expect(status, 'Signup options API should respond 200').toBe(200);
  expect(options.regions.length, 'Signup options should list at least one region').toBeGreaterThan(0);
  const codes = options.regions.map((r) => r.code);
  expect(new Set(codes).size, `Region codes must be unique: ${codes.join(', ')}`).toBe(codes.length);
  for (const region of options.regions) {
    expect(region.timezones.length, `Region ${region.code} should offer at least one timezone`).toBeGreaterThan(0);
    const invalid = region.timezones.filter((zone) => !isValidTimeZone(zone));
    expect(invalid, `Region ${region.code} offers non-IANA timezones`).toEqual([]);
  }

  if (api.expectedRegionTimezones.confirmed) {
    const actual = Object.fromEntries(options.regions.map((r) => [r.code, [...r.timezones].sort()]));
    const expected = Object.fromEntries(
      Object.entries(api.expectedRegionTimezones.value).map(([code, zones]) => [code, [...zones].sort()]),
    );
    expect(actual, 'Region → timezone mapping must match INT-3446').toEqual(expected);
  } else {
    test.info().annotations.push({ type: 'coverage-limit', description: api.expectedRegionTimezones.question });
  }
});
