import { applyNetworkPolicy } from '../../../shared/safety/network-policy';
import { int3437Case, requireContract, requireEnv } from '../../../products/cloud-signup/helpers/int-3437-case';
import { VerificationPage } from '../../../products/cloud-signup/pages/verification-page';
import { signupContract } from '../../../products/cloud-signup/signup-contract';
import { expect, test } from '../fixtures/provisioned-signup';

/**
 * Suite B — controlled E2E signup. All tests share ONE provisioned signup
 * (worker fixture) and its sitecode. The fixture refuses to run without a
 * recorded, single-use approval for exactly one new staging database, and it
 * never deletes staging data.
 */

const { paths, ui, email, provisioning, siteLoginPath } = signupContract;

const B01 = int3437Case('TC-B01');
test(B01.title, B01.details, async ({ provisionedSignup: signup }) => {
  const [sitecodePattern] = requireContract(provisioning.sitecodePattern);

  expect(signup.statusHistory.at(-1), `Provisioning statuses: ${signup.statusHistory.join(' → ')}`).toBe('completed');
  expect(signup.sitecode, 'Generated sitecode format').toMatch(sitecodePattern);
  expect(signup.autoLoggedIn, 'New user should be logged in automatically after provisioning').toBe(true);
  expect(await signup.state.signupRequestCount(signup.email), 'Exactly one signup request for the fixture email').toBe(1);
});

const B02 = int3437Case('TC-B02');
test(B02.title, B02.details, async ({ provisionedSignup: signup, browser, baseURL }) => {
  requireContract(ui.usedTokenMessage);
  test.skip(!signup.live, 'Verification link is held in memory only and is unavailable in a resumed worker.');
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [] });
  const verification = new VerificationPage(await context.newPage(), baseURL!);

  await verification.openLink(signup.live!.verificationLink);

  await expect(verification.usedTokenMessage(), 'Reused completed token must be rejected').toBeVisible();
  expect(await signup.state.signupRequestCount(signup.email), 'Token reuse must not create a second request').toBe(1);
  expect(await signup.state.signupRequestStatus(signup.email), 'Token reuse must not change request status').toBe('completed');
  await context.close();
});

const B03 = int3437Case('TC-B03');
test(B03.title, B03.details, async ({ provisionedSignup: signup }) => {
  const [subject] = requireContract(email.signupAlertSubject);
  const alertInbox = requireEnv('QA_SIGNUP_ALERT_INBOX', 'TEST inbox receiving internal signup alerts');

  await expect
    .poll(
      async () =>
        (await signup.inbox.listMessages(alertInbox, { subject })).filter((m) => m.receivedAt >= signup.startedAt).length,
      { message: 'A signup alert email should arrive after the fixture signup', timeout: 120_000, intervals: [5_000] },
    )
    .toBeGreaterThanOrEqual(1);
});

const B04 = int3437Case('TC-B04');
test(B04.title, B04.details, async ({ provisionedSignup: signup }) => {
  const [redirect] = requireContract(paths.postSignupRedirect);

  expect(signup.landingPathname, 'Post-signup landing page').toMatch(redirect);
});

const B05 = int3437Case('TC-B05');
test(B05.title, B05.details, async ({ provisionedSignup: signup }) => {
  expect(await signup.state.signupRequestStatus(signup.email), 'Signup request status').toBe('completed');
  expect(await signup.state.storedPasswordIsPresent(signup.email), 'Stored signup password must be cleared (NULL)').toBe(false);
});

const B06 = int3437Case('TC-B06');
test(B06.title, B06.details, async ({ provisionedSignup: { state, sitecode } }) => {
  expect.soft(await state.itBookingRecordCount(sitecode), `IT booking records for ${sitecode}`).toBe(1);
  expect.soft(await state.websalesRecordCount(sitecode), `Websales records for ${sitecode}`).toBe(1);
  expect.soft(await state.membershipRecordCount(sitecode), `Membership records for ${sitecode}`).toBe(1);
});

const B07 = int3437Case('TC-B07');
test(B07.title, B07.details, async ({ provisionedSignup: { state, sitecode, selected } }) => {
  const [templateSitecode, shouldMatch] = requireContract(provisioning.templateSitecode, provisioning.newSiteMatchesTemplate);

  expect(await state.posDatabaseExists(sitecode), `POS database for ${sitecode}`).toBe(true);
  expect(await state.posRegionSettings(sitecode), 'Persisted region/timezone must match the selection').toEqual(selected);
  if (shouldMatch) {
    expect(await state.schemaFingerprint(sitecode), 'New POS schema must match the CLODEM template').toBe(
      await state.schemaFingerprint(templateSitecode),
    );
  }
});

const R01 = int3437Case('TC-R01');
test(R01.title, R01.details, async ({ provisionedSignup: signup }) => {
  const [templateSitecode] = requireContract(provisioning.templateSitecode);

  expect(await signup.state.schemaFingerprint(templateSitecode), 'CLODEM template must be unchanged by provisioning').toBe(
    signup.templateFingerprintBefore,
  );
});

const R03 = int3437Case('TC-R03');
test(R03.title, R03.details, async ({ provisionedSignup: signup }) => {
  test.skip(
    signup.passwordObservedWhilePending === 'not-observed',
    'Provisioning finished before a pending state could be observed; pending-password presence is not proven.',
  );

  expect(signup.passwordObservedWhilePending, 'Password should be stored while signup is pending').toBe(true);
  expect(await signup.state.storedPasswordIsPresent(signup.email), 'Password must be cleared after completion').toBe(false);
});

const RR04 = int3437Case('RR-04');
test(RR04.title, RR04.details, async ({ provisionedSignup: signup, browser, baseURL }) => {
  const [loginPathFor, templateSitecode, rejected, emailLabel, passwordLabel, loginButton] = requireContract(
    siteLoginPath, provisioning.templateSitecode, ui.loginRejectedMessage, ui.loginEmailLabel, ui.loginPasswordLabel, ui.loginButton,
  );
  test.skip(!signup.live, 'New user password is held in memory only and is unavailable in a resumed worker.');
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [] });
  const page = await context.newPage();
  await page.goto(loginPathFor(templateSitecode));

  await page.getByLabel(emailLabel).fill(signup.email);
  await page.getByLabel(passwordLabel, { exact: true }).fill(signup.live!.password);
  await page.getByRole('button', { name: loginButton }).click();

  await expect(page.getByText(rejected), 'New cinema user must not be able to log in to the CLODEM site').toBeVisible();
  await context.close();
});
