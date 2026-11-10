/**
 * Expected behaviour of Cloud Self-Service Signup (INT-3437), as agreed in the
 * ticket, its comments, and the linked INT-3446 requirements.
 *
 * Every value starts UNCONFIRMED. A test that needs an unconfirmed value is
 * reported as BLOCKED with the open question instead of asserting guessed
 * behaviour. Confirm a value only from the ticket, the implementation, or the
 * product owner, and record the source.
 */

export type ContractValue<T> =
  | { confirmed: true; value: T; source: string }
  | { confirmed: false; question: string };

export function unconfirmed<T>(question: string): ContractValue<T> {
  return { confirmed: false, question };
}

export function confirmed<T>(value: T, source: string): ContractValue<T> {
  return { confirmed: true, value, source };
}

export class ContractUnconfirmedError extends Error {
  constructor(public readonly questions: string[]) {
    super(`BLOCKED — expected behaviour not confirmed for INT-3437:\n- ${questions.join('\n- ')}`);
    this.name = 'ContractUnconfirmedError';
  }
}

export function contractValue<T>(entry: ContractValue<T>): T {
  if (!entry.confirmed) throw new ContractUnconfirmedError([entry.question]);
  return entry.value;
}

export function unconfirmedQuestions(entries: ContractValue<unknown>[]): string[] {
  return entries.filter((e): e is { confirmed: false; question: string } => !e.confirmed).map((e) => e.question);
}

/** Normalised form of the options API response; parseSignupOptions maps the real shape onto it. */
export interface SignupOptions {
  regions: { code: string; label: string; timezones: string[] }[];
}

export type FeatureGateBehaviour =
  | { kind: 'http-status'; status: number }
  | { kind: 'redirect'; to: RegExp }
  | { kind: 'message'; text: RegExp };

export const signupContract = {
  paths: {
    signupLanding: unconfirmed<string>('Path of the public signup landing page.'),
    verification: unconfirmed<(token: string) => string>(
      'How the verification token is carried in the link (path segment or query parameter, and which name).',
    ),
    login: unconfirmed<string>('Path of the existing-user login page reached from signup.'),
    signupOptionsApi: unconfirmed<string>('Path of the signup options API (TC-A08).'),
    postSignupRedirect: unconfirmed<RegExp>('Expected post-signup redirect after auto-login (TC-B04).'),
  },
  ui: {
    landingHeading: unconfirmed<RegExp>('Heading text shown on the signup landing page.'),
    emailLabel: unconfirmed<RegExp>('Accessible label of the signup email field.'),
    submitSignupButton: unconfirmed<RegExp>('Accessible name of the signup submit button.'),
    invalidEmailMessage: unconfirmed<RegExp>('Validation message for an invalid email address.'),
    invalidEmailValidation: unconfirmed<'client' | 'server'>(
      'Is invalid email rejected client-side (no request) or server-side (POST that must not create a record)?',
    ),
    signupSubmittedMessage: unconfirmed<RegExp>('Confirmation shown after a valid signup email is submitted.'),
    existingUserBehaviour: unconfirmed<{ message: RegExp; sendsEmail: boolean }>(
      'TC-A04: what an existing user sees when entering their email on signup, and whether an email is sent.',
    ),
    duplicateRequestBehaviour: unconfirmed<{ message: RegExp; expectedVerificationEmails: number }>(
      'Risk 1: behaviour when the same email requests signup twice while pending (resend, reuse, or reject?).',
    ),
    invalidTokenMessage: unconfirmed<RegExp>('Message for an invalid, tampered, or expired verification token.'),
    usedTokenMessage: unconfirmed<RegExp>('TC-B02: message when a completed verification token is reused.'),
    passwordLabel: unconfirmed<RegExp>('Accessible label of the password field on the signup details step.'),
    regionLabel: unconfirmed<RegExp>('Accessible label of the region selector.'),
    timezoneLabel: unconfirmed<RegExp>('Accessible label of the timezone selector.'),
    completeSignupButton: unconfirmed<RegExp>('Accessible name of the button that completes signup and starts provisioning.'),
    detailsFields: unconfirmed<{ label: RegExp; testValue: string }[]>(
      'Remaining required signup detail fields (cinema name, contact, etc.) and safe TEST values.',
    ),
    rateLimitMessage: unconfirmed<RegExp>('Message or status shown when the signup rate limit is exceeded.'),
    featureGateBehaviour: unconfirmed<FeatureGateBehaviour>(
      'TC-A03: observable behaviour when the production signup feature gate is OFF (verified on a TEST host configured with the gate off).',
    ),
    autoLoginIndicator: unconfirmed<RegExp>('Element text proving the new user is logged in after provisioning.'),
    loginEmailLabel: unconfirmed<RegExp>('Accessible label of the login email/username field.'),
    loginPasswordLabel: unconfirmed<RegExp>('Accessible label of the login password field.'),
    loginButton: unconfirmed<RegExp>('Accessible name of the login button.'),
    loggedInIndicator: unconfirmed<RegExp>('Element text proving an existing user is logged in (TC-R02).'),
    loginRejectedMessage: unconfirmed<RegExp>('Message shown when a user logs in to a site they do not belong to.'),
  },
  siteLoginPath: unconfirmed<(sitecode: string) => string>(
    'Risk 4: how a login targets a specific site/sitecode (path, subdomain, or site selector).',
  ),
  suiteBRegion: unconfirmed<{ region: string; timezone: string }>(
    'Suite B: region and timezone to choose for the single approved signup.',
  ),
  passwordRules: unconfirmed<{ description: string; sample: string; message: RegExp }[]>(
    'TC-A07: password policy (length, character classes, confirmation match) and the message for each violation.',
  ),
  api: {
    signupRequestEndpoint: unconfirmed<RegExp>(
      'Pathname of the request that creates a pending signup request (must not also match the complete-signup request).',
    ),
    verificationEndpoint: unconfirmed<RegExp>('Pathname of the request that consumes a verification token.'),
    loginEndpoint: unconfirmed<RegExp>('Pathname of the existing-user login request.'),
    parseSignupOptions: unconfirmed<(body: unknown) => SignupOptions>('Response shape of the signup options API.'),
    expectedRegionTimezones: unconfirmed<Record<string, string[]>>(
      'Risk 5: which timezones each region must offer (INT-3446).',
    ),
    rateLimit: unconfirmed<{ maxRequests: number; windowSeconds: number; keyedBy: 'ip' | 'email' }>(
      'TC-A10: rate limit threshold, window, and key.',
    ),
  },
  email: {
    verificationSubject: unconfirmed<RegExp>('Subject of the verification email.'),
    verificationLinkPattern: unconfirmed<RegExp>('Pattern of the verification link inside the email.'),
    signupAlertSubject: unconfirmed<RegExp>('TC-B03: subject of the internal signup alert email.'),
  },
  provisioning: {
    statusTimeoutMs: unconfirmed<number>('Maximum acceptable provisioning time before the UI reports a timeout.'),
    sitecodePattern: unconfirmed<RegExp>('Format of a generated sitecode.'),
    templateSitecode: unconfirmed<string>('Sitecode of the CLODEM template site used for provisioning.'),
    newSiteMatchesTemplate: unconfirmed<boolean>(
      'TC-B07: should a new POS database have the same schema fingerprint as the CLODEM template?',
    ),
  },
};
