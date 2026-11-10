import { randomBytes } from 'node:crypto';
import { expect, test } from '../../../shared/safety/guarded-test';
import { assertStagingUrl } from '../../../shared/safety/environment-guard';
import { fetchSignupOptions } from '../api/signup-options-client';
import { int3437Case, requireContract } from '../helpers/int-3437-case';
import { stagingBotCheckVisible, stopForBotCheck } from '../helpers/staging-bot-check';
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
test(A01.title, A01.details, async ({ page }, testInfo) => {
  requireContract(paths.signupLanding);
  const landing = new SignupLandingPage(page);

  await landing.open();
  if (await stagingBotCheckVisible(page)) {
    await stopForBotCheck(page, testInfo, 'The heading, email field, and signup button were not available to check.');
  }
  requireContract(ui.landingHeading, ui.emailLabel, ui.submitSignupButton);

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
    test(`${A05.title} [${label}]`, A05.details, async ({ page, baseURL }, testInfo) => {
      requireContract(paths.verification);
      const verification = new VerificationPage(page, baseURL!);

      await verification.openWithToken(makeToken());
      const passwordFields = await page.locator('input[type="password"]').count();
      if (await stagingBotCheckVisible(page)) {
        await stopForBotCheck(
          page,
          testInfo,
          `Token rejection was not reached for the ${label}. Password fields on the page: ${passwordFields}. The cinema-details form was not shown.`,
        );
      }
      requireContract(ui.invalidTokenMessage);

      await expect(verification.invalidTokenMessage(), `A ${label} must be rejected with the invalid-token message`).toBeVisible();
      expect(passwordFields, 'Cinema-details password field must not be available for an invalid token').toBe(0);
    });
  }
});

const A08 = int3437Case('TC-A08');
test(A08.title, A08.details, async ({ readonlyApi }) => {
  const [, , expectedRegions, expectedZones] = requireContract(
    paths.signupOptionsApi,
    api.parseSignupOptions,
    api.expectedRegions,
    api.expectedRegionTimezones,
  );

  const { status, options } = await fetchSignupOptions(readonlyApi);

  expect(status, 'Signup options API should respond 200').toBe(200);
  expect(
    options.regions.map((region) => ({ code: region.code, label: region.label })),
    'Selectable regions and labels',
  ).toEqual([...expectedRegions]);
  for (const region of options.regions) {
    const invalid = region.timezones.filter((zone) => !isValidTimeZone(zone));
    expect(invalid, `Region ${region.code} offers non-IANA timezones`).toEqual([]);
  }
  const actual = Object.fromEntries(options.regions.map((region) => [region.code, [...region.timezones].sort()]));
  const expected = Object.fromEntries(Object.entries(expectedZones).map(([code, zones]) => [code, [...zones].sort()]));
  expect(actual, 'Region → timezone lists must match the observed staging options').toEqual(expected);
});
