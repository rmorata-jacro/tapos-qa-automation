import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';
import type { HostPolicy } from '../../shared/safety/environment-guard';
import { applyNetworkPolicy } from '../../shared/safety/network-policy';

/**
 * Redirect hops after the first are followed by Chromium itself and are not
 * routed. To observe that path, these tests use a browser without the staging
 * resolver rule so loopback hops can complete. Every non-loopback target here
 * is a production-pattern name under the reserved `.invalid` TLD (RFC 6761),
 * which can never resolve, so no real host is contacted.
 */

const FAKE_PRODUCTION = 'https://my.prod.invalid';
const loopbackPolicy: HostPolicy = { allowedHosts: ['127.0.0.1'], blockedPatterns: BLOCKED_HOST_PATTERNS, allowLoopbackSelfTest: true };

let server: Server;
let origin: string;
let browser: Browser;
const received: string[] = [];

const ROUTES: Record<string, { status: number; location?: string }> = {
  '/hop-ok': { status: 302, location: '/page' },
  '/hop1': { status: 302, location: '/hop2' },
  '/hop2': { status: 302, location: `${FAKE_PRODUCTION}/login` },
  '/post-replay': { status: 307, location: '/signup-complete' },
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    const route = ROUTES[req.url ?? ''];
    if (route) return void res.writeHead(route.status, { location: route.location! }).end();
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><script>window.post = (p) => fetch(p, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'aborted');</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ args: ['--no-proxy-server'] });
});

test.afterAll(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  received.length = 0;
});

test('redirects within the approved host are followed', async () => {
  const context = await browser.newContext();
  const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });
  const page = await context.newPage();

  await page.goto(`${origin}/hop-ok`);

  expect(new URL(page.url()).pathname).toBe('/page');
  expect(received).toEqual(['GET /hop-ok', 'GET /page']);
  expect(policy.violations).toEqual([]);
  await context.close();
});

test('a later redirect hop to a production host is detected and fails the test', async () => {
  const context = await browser.newContext();
  const policy = await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });
  const page = await context.newPage();

  await expect(page.goto(`${origin}/hop1`)).rejects.toThrow();

  expect(received).toEqual(['GET /hop1', 'GET /hop2']);
  expect(policy.violations.join('\n')).toMatch(/Redirect hop blocked: GET https:\/\/my\.prod\.invalid\/login .*PRODUCTION/);
  await context.close();
});

test('a 307 redirect cannot replay a write to a non-allowlisted endpoint', async () => {
  const context = await browser.newContext();
  const policy = await applyNetworkPolicy(context, {
    level: 'writes-signup',
    allowedMutations: [/^\/post-replay$/],
    hostPolicy: loopbackPolicy,
  });
  const page = await context.newPage();
  await page.goto(`${origin}/page`);

  expect(await page.evaluate(() => (window as unknown as { post: (p: string) => Promise<string> }).post('/post-replay'))).toBe('aborted');

  expect(received).toEqual(['GET /page', 'POST /post-replay']);
  expect(policy.violations.join('\n')).toContain('would replay POST');
  await context.close();
});
