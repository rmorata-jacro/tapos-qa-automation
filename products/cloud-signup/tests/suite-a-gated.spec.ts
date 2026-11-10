import { expect, test as guardedTest } from '../../../shared/safety/guarded-test';
import { resolveTestInbox, uniquePlusAddress, type TestInbox } from '../../../shared/test-data/test-inbox';
import { fetchSignupOptions } from '../api/signup-options-client';
import { confirmedPatterns, int3437Case, requireContract, requireEnv } from '../helpers/int-3437-case';
import { startVerifiedPendingSignup, VERIFICATION_EMAIL_TIMEOUT_MS } from '../helpers/pending-signup';
import { LoginPage } from '../pages/login-page';
import { SignupLandingPage } from '../pages/signup-landing-page';
import { signupContract } from '../signup-contract';

/**
 * Suite A (gated). These tests create pending signup requests, send emails,
 * consume verification tokens, exercise rate limits, or create login
 * sessions. They are excluded from nightly runs and each level needs its own
 * opt-in flag. Signup details are never submitted: the complete-signup
 * request is not in the mutation allowlist, so the network guard aborts it.
 */

const { paths, ui, api, email, passwordRules } = signupContract;

const test = guardedTest.extend<{ inbox: TestInbox }>({
  inbox: async ({}, use) =>
    use({
      waitForLink: (recipient, options) => resolveTestInbox().waitForLink(recipient, options),
      listMessages: (recipient, options) => resolveTestInbox().listMessages(recipient, options),
    }),
});

test.describe('Signup requests (writes-signup / rate-limit)', () => {
  test.use({ allowedMutations: confirmedPatterns(api.signupRequestEndpoint, api.verificationEndpoint) });

  const A04 = int3437Case('TC-A04');
  test(A04.title, A04.details, async ({ page }) => {
    const [, , , behaviour] = requireContract(
      paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.existingUserBehaviour, api.signupRequestEndpoint,
    );
    const existingEmail = requireEnv('QA_EXISTING_USER_EMAIL', 'dedicated existing TEST account');
    const landing = new SignupLandingPage(page);
    await landing.open();

    await landing.requestSignup(existingEmail);

    await expect(landing.message(behaviour.message), 'Existing user should be directed to log in').toBeVisible();
  });

  const A06 = int3437Case('TC-A06');
  test(A06.title, A06.details, async ({ page, inbox, baseURL }) => {
    requireContract(
      paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.passwordLabel, api.signupRequestEndpoint,
      api.verificationEndpoint, email.verificationSubject, email.verificationLinkPattern,
    );

    const { details } = await startVerifiedPendingSignup(page, inbox, baseURL!, 'a06');

    await expect(details.passwordInput(), 'Verified plus-address should reach the signup details step').toBeVisible();
  });

  const A07 = int3437Case('TC-A07');
  test(A07.title, A07.details, async ({ page, inbox, baseURL }) => {
    const [rules] = requireContract(
      passwordRules, paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.passwordLabel,
      api.signupRequestEndpoint, api.verificationEndpoint, email.verificationSubject, email.verificationLinkPattern,
    );
    const { details } = await startVerifiedPendingSignup(page, inbox, baseURL!, 'a07');

    for (const rule of rules) {
      await test.step(`Password rule: ${rule.description}`, async () => {
        await details.passwordInput().fill(rule.sample);
        await details.passwordInput().blur();
        await expect(details.message(rule.message), `Password violating "${rule.description}" should be rejected`).toBeVisible();
      });
    }
  });

  const A09 = int3437Case('TC-A09');
  test(A09.title, A09.details, async ({ page, inbox, baseURL, readonlyApi }) => {
    requireContract(
      paths.signupOptionsApi, api.parseSignupOptions, ui.regionLabel, ui.timezoneLabel, paths.signupLanding,
      ui.emailLabel, ui.submitSignupButton, api.signupRequestEndpoint, api.verificationEndpoint,
      email.verificationSubject, email.verificationLinkPattern,
    );
    const { options } = await fetchSignupOptions(readonlyApi);
    const { details } = await startVerifiedPendingSignup(page, inbox, baseURL!, 'a09');

    const uiRegions = await details.optionValues(details.regionSelect());
    expect(uiRegions.sort(), 'Region selector must offer exactly the API regions').toEqual(
      options.regions.map((r) => r.code).sort(),
    );
    for (const region of options.regions) {
      await test.step(`Region ${region.code} offers its timezones`, async () => {
        await details.selectRegion(region.code);
        await expect
          .poll(async () => (await details.optionValues(details.timezoneSelect())).sort(), {
            message: `Timezones offered for region ${region.code} must match the options API`,
            timeout: 10_000,
          })
          .toEqual([...region.timezones].sort());
      });
    }
  });

  const A10 = int3437Case('TC-A10');
  test(A10.title, A10.details, async ({ page }) => {
    const [, , , submitted, limitMessage, limit] = requireContract(
      paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.signupSubmittedMessage, ui.rateLimitMessage,
      api.rateLimit, api.signupRequestEndpoint,
    );
    test.setTimeout(60_000 + limit.maxRequests * 15_000);
    const landing = new SignupLandingPage(page);
    const sharedAddress = uniquePlusAddress('a10');

    for (let attempt = 1; attempt <= limit.maxRequests + 1; attempt += 1) {
      await landing.open();
      await landing.requestSignup(limit.keyedBy === 'email' ? sharedAddress : uniquePlusAddress(`a10n${attempt}`));
      const expected = attempt <= limit.maxRequests ? submitted : limitMessage;
      await expect(
        landing.message(expected),
        attempt <= limit.maxRequests
          ? `Request ${attempt} of ${limit.maxRequests} should be accepted`
          : `Request ${attempt} should be rejected by the rate limit`,
      ).toBeVisible();
    }
  });

  const RR01 = int3437Case('RR-01');
  test(RR01.title, RR01.details, async ({ page, inbox }) => {
    const [, , , behaviour, subject] = requireContract(
      paths.signupLanding, ui.emailLabel, ui.submitSignupButton, ui.duplicateRequestBehaviour,
      email.verificationSubject, api.signupRequestEndpoint,
    );
    const address = uniquePlusAddress('rr01');
    const landing = new SignupLandingPage(page);

    await landing.open();
    await landing.requestSignup(address);
    await landing.open();
    await landing.requestSignup(address);

    await expect(landing.message(behaviour.message), 'Second request for a pending email should be handled').toBeVisible();
    await expect
      .poll(async () => (await inbox.listMessages(address, { subject })).length, {
        message: `Expected exactly ${behaviour.expectedVerificationEmails} verification email(s) for a duplicate request`,
        timeout: VERIFICATION_EMAIL_TIMEOUT_MS,
        intervals: [5_000],
      })
      .toBe(behaviour.expectedVerificationEmails);
  });
});

test.describe('Existing login (auth-session)', () => {
  test.use({ allowedMutations: confirmedPatterns(api.loginEndpoint) });

  const R02 = int3437Case('TC-R02');
  test(R02.title, R02.details, async ({ page }) => {
    requireContract(paths.login, ui.loginEmailLabel, ui.loginPasswordLabel, ui.loginButton, ui.loggedInIndicator, api.loginEndpoint);
    const username = requireEnv('QA_EXISTING_USER_EMAIL', 'dedicated existing TEST account');
    const password = requireEnv('QA_EXISTING_USER_PASSWORD', 'dedicated existing TEST account');
    const login = new LoginPage(page);
    await login.open();

    await login.login(username, password);

    await expect(login.loggedInIndicator(), 'Existing TEST user should be logged in').toBeVisible();
  });
});
