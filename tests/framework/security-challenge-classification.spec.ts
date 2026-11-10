import { expect, test, type TestInfo } from '@playwright/test';
import { SecurityChallengeMonitor } from '../../shared/reporting/challenge-monitor';
import { classifyResult } from '../../shared/reporting/result-classification';
import {
  detectSecurityChallenge,
  SECURITY_CHALLENGE_ANNOTATION,
  SECURITY_CHALLENGE_CLASSIFICATION,
} from '../../shared/reporting/security-challenge';

const CHALLENGE_BODY =
  "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue" +
  "<script>window._cf_chl_opt = {cType: 'managed', cZone: 'qa.invalid'};</script>" +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

const CHALLENGE_HEADERS = {
  Server: 'cloudflare',
  'Cf-Mitigated': 'challenge',
  'CF-RAY': '0000000000000000-TST',
  'Content-Type': 'text/html; charset=UTF-8',
  'Set-Cookie': '__cf_bm=never-kept; path=/',
};

test.describe('security challenge detection', () => {
  test('classifies a Cloudflare managed challenge and keeps the original status and safe headers', () => {
    const challenge = detectSecurityChallenge({
      url: 'https://qa.invalid/signup/api/options/?token=secret-value',
      status: 403,
      headers: CHALLENGE_HEADERS,
      title: 'Just a moment...',
      body: CHALLENGE_BODY,
    });
    expect(challenge).toMatchObject({ vendor: 'Cloudflare', challengeType: 'managed', status: 403, rayId: '0000000000000000-TST' });
    expect(challenge!.evidence).toEqual(expect.arrayContaining(['cf-mitigated: challenge', 'title: Just a moment...', 'HTTP 403']));
    expect(challenge!.headers).not.toHaveProperty('set-cookie');
    expect(challenge!.url).not.toContain('secret-value');
  });

  test('recognises the challenge page without cf-mitigated when served by Cloudflare with challenge markers', () => {
    const challenge = detectSecurityChallenge({ url: 'https://qa.invalid/signup/', status: 403, headers: { server: 'cloudflare' }, title: 'Just a moment...' });
    expect(challenge?.vendor).toBe('Cloudflare');
  });

  test('does not treat an ordinary HTTP 403 as a security challenge', () => {
    const cases: { headers: Record<string, string>; body: string; title?: string }[] = [
      { headers: { 'content-type': 'application/json' }, body: '{"ok":false,"error":"forbidden"}', title: undefined },
      { headers: { server: 'cloudflare', 'content-type': 'text/html' }, body: '<title>403 Forbidden</title>', title: '403 Forbidden' },
      { headers: { server: 'nginx' }, body: '', title: 'Just a moment...' },
    ];
    for (const { headers, body, title } of cases) {
      expect(detectSecurityChallenge({ url: 'https://qa.invalid/x', status: 403, headers, body, title })).toBeUndefined();
    }
  });

  test('does not treat a successful Cloudflare-served page with the same title as a challenge', () => {
    expect(detectSecurityChallenge({ url: 'https://qa.invalid/', status: 200, headers: { server: 'cloudflare' }, title: 'Just a moment...' })).toBeUndefined();
  });
});

test.describe('result classification', () => {
  const challengeNote = { type: SECURITY_CHALLENGE_ANNOTATION, description: 'Cloudflare managed challenge | HTTP 403' };

  test('a security challenge outranks the raw failed or skipped status', () => {
    expect(classifyResult({ status: 'failed', annotations: [challengeNote] })).toBe(SECURITY_CHALLENGE_CLASSIFICATION);
    expect(classifyResult({ status: 'skipped', annotations: [challengeNote, { type: 'skip', description: 'x' }] })).toBe(SECURITY_CHALLENGE_CLASSIFICATION);
  });

  test('other results keep their own classification', () => {
    expect(classifyResult({ status: 'passed', annotations: [] })).toBe('PASS');
    expect(classifyResult({ status: 'failed', annotations: [] })).toBe('FAIL');
    expect(classifyResult({ status: 'timedOut', annotations: [] })).toBe('FAIL');
    expect(classifyResult({ status: 'skipped', annotations: [{ type: 'skip', description: 'BLOCKED — needs confirmation from INT-3437: q' }] }))
      .toBe('BLOCKED — Expected behaviour unconfirmed');
    expect(classifyResult({ status: 'skipped', annotations: [{ type: 'skip', description: 'NOT PERMITTED (provisioning): no' }] }))
      .toBe('BLOCKED — Not permitted');
  });
});

function fakeTestInfo() {
  const info = {
    annotations: [] as { type: string; description?: string }[],
    attachments: [] as string[],
    async attach(name: string) {
      info.attachments.push(name);
    },
    skip(condition: boolean, reason: string) {
      if (condition) throw new Error(`SKIPPED: ${reason}`);
    },
  };
  return info;
}

test.describe('challenge monitor on browser navigations', () => {
  test('records a challenged main-frame navigation and stops with the infrastructure classification', async ({ page }) => {
    const info = fakeTestInfo();
    const monitor = new SecurityChallengeMonitor(info as unknown as TestInfo);
    monitor.watchPage(page);
    await page.route('https://qa.invalid/**', (route) =>
      route.fulfill({ status: 403, headers: CHALLENGE_HEADERS, body: CHALLENGE_BODY, contentType: 'text/html' }));

    await page.goto('https://qa.invalid/signup/');

    await expect(monitor.stopIfChallenged('Landing page not reached.', page)).rejects.toThrow(
      `SKIPPED: ${SECURITY_CHALLENGE_CLASSIFICATION}: Cloudflare managed challenge | HTTP 403`,
    );
    expect(info.annotations.map((a) => a.type)).toEqual([SECURITY_CHALLENGE_ANNOTATION]);
    expect(info.attachments).toContain('security-challenge-page');
  });

  test('lets an ordinary 403 page through for normal assertions', async ({ page }) => {
    const info = fakeTestInfo();
    const monitor = new SecurityChallengeMonitor(info as unknown as TestInfo);
    monitor.watchPage(page);
    await page.route('https://qa.invalid/**', (route) =>
      route.fulfill({ status: 403, headers: { server: 'cloudflare' }, body: '<title>Forbidden</title>', contentType: 'text/html' }));

    await page.goto('https://qa.invalid/signup/');

    await expect(monitor.stopIfChallenged('n/a', page)).resolves.toBeUndefined();
    expect(info.annotations).toEqual([]);
  });
});
