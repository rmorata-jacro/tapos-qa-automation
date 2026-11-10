# Cloud Self-Service Signup (INT-3437) automation

Playwright + TypeScript automation for the INT-3437 manual QA plan, split by real side effects.

| Suite | Location | Safety level(s) | Nightly | Gate |
|---|---|---|---|---|
| framework | `tests/framework/` | framework | yes | none |
| A-readonly | `products/cloud-signup/tests/suite-a-readonly.spec.ts` | readonly | yes | network guard aborts any mutating request to the TEST host |
| A-gated | `products/cloud-signup/tests/suite-a-gated.spec.ts` | writes-signup, rate-limit, auth-session | **no** | `QA_ALLOW_SIGNUP_WRITES`, `QA_ALLOW_RATE_LIMIT`, `QA_ALLOW_AUTH_SESSION`; only contract-confirmed endpoints may be mutated |
| B | `workflows/cloud-self-service-signup/tests/suite-b-provisioning.spec.ts` | provisioning | **no** | hard gate: recorded single-use approval, exactly one database, six prechecks, refused in CI |
| C | `workflows/cloud-self-service-signup/tests/suite-c-high-risk.spec.ts` | destructive | **no** | hard gate: separate approval, isolated non-shared host only |

The test ID, suite, safety level, expected writes, and blockers of every case live in
`int-3437-test-catalog.ts`. The runtime gate reads the level from the catalog, so a spec
file cannot silently downgrade a test.

## Commands

```bash
npm ci && npx playwright install chromium
cp .env.example .env            # fill with approved TEST values only

npm test                        # framework self-tests (no staging traffic)
npm run plan:a-readonly         # print run plan + exact tests, run nothing
npm run plan:a-gated
npm run plan:b
npm run plan:c

npm run test:nightly            # A-readonly with QA_RUN_CONTEXT=nightly
npm run test:a-readonly
npm run test:a-gated            # also needs the QA_ALLOW_* flags
npm run test:b                  # refused unless the Suite B approval gate is satisfied
npm run test:c                  # refused unless the isolated-environment gate is satisfied
npm run report                  # open reports/html
```

Filter within a suite with tags, e.g. `npm run test:a-gated -- --grep @auth-session`.

## Evidence and redaction

- Reports: `reports/html`, `reports/results.json`, artifacts in `reports/test-results`.
- Built-in screenshots are off. On failure a full-page screenshot is taken with password,
  email, one-time-code and `[data-qa-sensitive]` fields masked, plus a redacted page URL.
- Traces are kept on failure only for A-readonly (no secrets are typed there). Traces are off
  for A-gated, B and C because they record typed values and full URLs.
- Verification links and generated passwords are held in memory only. Mutating requests that
  were allowed through are attached as a redacted list.

## Suite B data handling

The single signup fixture writes a non-secret run record to
`.qa-state/provisioning-approvals/<approval>.run-record.json` (sitecode, status, timestamps)
and never deletes staging data. An approval can be claimed once; a restarted worker resumes
from the run record instead of provisioning again.

## Before these tests can pass

1. Confirm every entry in `signup-contract.ts` from INT-3437, its comments, INT-3446, and the
   implementation. Until then, dependent tests report `BLOCKED` with the open question.
2. Implement a TEST inbox adapter (`shared/test-data/test-inbox.ts`).
3. Agree and implement safe state queries (`workflows/cloud-self-service-signup/state-checks`).
4. Add known production hostnames to `config/blocked-hosts.ts`.
5. Map manual cases TC-C01 and TC-C02 to the Suite C scenarios HR-01–HR-06.
