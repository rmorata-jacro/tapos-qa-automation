# Cloud Self-Service Signup (INT-3437) automation

Playwright + TypeScript automation for the INT-3437 manual QA plan, split by real side effects.

| Suite | Location | Safety level(s) | Nightly | Gate |
|---|---|---|---|---|
| framework | `tests/framework/` | framework | yes | none |
| local-access | `products/cloud-signup/tests/local-staging-access.spec.ts` | readonly | **no** | one GET of `/signup/` in a fresh context; no other INT-3437 scenarios |
| A-readonly | `products/cloud-signup/tests/suite-a-readonly.spec.ts` | readonly | yes | network guard aborts any mutating request to the TEST host |
| A-gated | `products/cloud-signup/tests/suite-a-gated.spec.ts` | writes-signup, rate-limit, auth-session | **no** | `QA_ALLOW_SIGNUP_WRITES`, `QA_ALLOW_RATE_LIMIT`, `QA_ALLOW_AUTH_SESSION`; only contract-confirmed endpoints may be mutated |
| B | `workflows/cloud-self-service-signup/tests/suite-b-provisioning.spec.ts` | provisioning | **no** | hard gate: recorded single-use approval, exactly one database, six prechecks, refused in CI |
| C | `workflows/cloud-self-service-signup/tests/suite-c-high-risk.spec.ts` | destructive | **no** | hard gate: separate approval, isolated non-shared host only |

The test ID, suite, safety level, expected writes, and blockers of every case live in
`int-3437-test-catalog.ts`. The runtime gate reads the level from the catalog, so a spec
file cannot silently downgrade a test.

## Staging-only enforcement

| Item | Value | Where |
|---|---|---|
| Approved staging base URL | `https://it.taposapp.com` (`CLOUD_SIGNUP_BASE_URL`) | `config/environments.ts`, `.env.example` |
| Allowlisted hosts | `it.taposapp.com` only — a code constant; env vars cannot widen it | `config/environments.ts` |
| Production (always blocked) | `https://my.internetticketing.com`, any `*.internetticketing.com` | `config/blocked-hosts.ts` |
| Approved staging DB hosts | none yet — Suites B/C fail closed | `config/environments.ts` |

Layers, all applied by `shared/safety/guarded-test.ts`, so they hold for npm scripts, direct
spec-file execution, and alternative configs:

1. **Config / global setup:** a missing, invalid, production, IP/localhost, non-https,
   non-default-port, or credential-bearing base URL stops the run. Proxy environment
   variables are refused. The staging host must resolve to public addresses that are not
   production's.
2. **Browser launch:** Chromium can only resolve `it.taposapp.com`
   (`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE it.taposapp.com`) and ignores system
   proxies. Proxy options and competing resolver flags are refused.
3. **Request routing:**
   - Every request to a non-approved host is aborted. Production hosts, navigations and
     writes to them fail the test.
   - The first hop of a redirect is fetched without redirects and its `Location` is
     validated. Later hops are checked from request events and cannot resolve
     non-approved hosts.
   - 307/308 replays of writes are refused, and WebSockets follow the same host policy.
4. **API requests:** the `request` fixture, `page.request` and `context.request` are
   wrapped. They apply the same host, write and redirect rules, and follow redirects
   manually for GET only.
5. **Databases:** `QA_WEBSALES_DB_URL`, `QA_MEMBERSHIP_DB_URL` and `QA_POS_DB_URL` must all
   point at approved staging hosts (not production-named, not localhost/IP tunnels). Each
   host must resolve publicly before Suites B/C start or any adapter connects.
6. **Static scan:** `tests/framework/guard-bypass-scan.spec.ts` fails if product or workflow
   code imports raw Playwright `test`, adds or removes routes, opens raw contexts or
   browsers, or sets proxies, resolver flags, or `ignoreHTTPSErrors`.

## Commands

```bash
npm ci && npx playwright install chromium
cp .env.example .env            # fill with approved TEST values only

npm test                        # framework self-tests (no staging traffic)
npm run test:local-staging-access   # one local GET /signup/; retries 0; run this on your own computer
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

Confirmed staging routes: `/signup/`, `/signup/complete/?token=...`, and `/signup/api/options/`.
The options API response observed on 2026-11-10 is recorded in `observed-signup-options.ts`.
Cloudflare currently answers this runner with a managed challenge (HTTP 403,
`cf-mitigated: challenge`, title "Just a moment..."). The guarded fixtures detect it on page
navigations and API responses (`shared/reporting/security-challenge.ts`), stop the test, and attach
the status, ray ID, and safe headers as `security-challenge-evidence`. The classification reporter
writes `reports/classified-results.json`, where such tests appear as
`BLOCKED — Infrastructure / Security Challenge`, not as functional failures, even if the raw
Playwright status is failed. An HTTP 403 without Cloudflare's challenge markers is still reported
as a normal result. The fix is infrastructure-approved staging access for the QA runner; the
automation never solves or bypasses the challenge.

Future gated tests use `QA_TEST_INBOX_ADDRESS` with aliases `r.morata+int3437-{testId}@jacro.com`
and the local `QA_TEST_PASSWORD` secret. The read-only tests do not use either value.

## Before these tests can pass

1. Confirm the remaining entries in `signup-contract.ts`. Until then, dependent tests report
   `BLOCKED` with the open question. Reaching the signup form also requires infrastructure to
   stop challenging the approved QA runner on `it.taposapp.com` (staging only).
2. Implement a TEST inbox adapter (`shared/test-data/test-inbox.ts`).
3. Agree and implement safe state queries (`workflows/cloud-self-service-signup/state-checks`).
4. Add known production hostnames to `config/blocked-hosts.ts`.
5. Map manual cases TC-C01 and TC-C02 to the Suite C scenarios HR-01–HR-06.
