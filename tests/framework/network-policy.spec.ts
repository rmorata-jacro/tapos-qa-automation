import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';
import { guardContext } from '../../shared/safety/browser-hardening';
import type { HostPolicy } from '../../shared/safety/environment-guard';
import { guardApiContext } from '../../shared/safety/guarded-api';
import { applyNetworkPolicy } from '../../shared/safety/network-policy';

/**
 * Proves the browser/API network guard against a throwaway loopback server.
 * The framework project launches Chromium with the staging resolver rules, so
 * even a guard failure could not resolve production. Production URLs below
 * are only ever aborted, never fetched.
 */

const PRODUCTION = 'https://my.internetticketing.com';
const loopbackPolicy: HostPolicy = { allowedHosts: ['127.0.0.1'], blockedPatterns: BLOCKED_HOST_PATTERNS, allowLoopbackSelfTest: true };

let server: Server;
let origin: string;
const received: string[] = [];

const html = (body: string) => `<!doctype html><title>t</title>${body}`;
const SEND = `<script>window.send = (p, m = 'POST') => fetch(p, { method: m, body: m === 'GET' ? undefined : 'x' }).then(() => 'sent', () => 'aborted');</script>`;

const ROUTES: Record<string, { status: number; headers?: Record<string, string>; body?: string }> = {
  '/page': { status: 200, body: html(SEND) },
  '/redirect-to-prod': { status: 302, headers: { location: `${PRODUCTION}/login` } },
  '/hop1': { status: 302, headers: { location: '/hop2' } },
  '/hop2': { status: 302, headers: { location: `${PRODUCTION}/` } },
  '/js-to-prod': { status: 200, body: html(`<script>location.href = '${PRODUCTION}/';</script>`) },
  '/third-party': { status: 200, body: html('<img src="https://cdn.unknown-third-party.example/pixel.png">') },
  '/ws-to-prod': { status: 200, body: html(`<script>window.ws = new WebSocket('wss://my.internetticketing.com/socket');</script>`) },
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    const route = ROUTES[req.url ?? ''] ?? { status: 200, body: 'ok' };
    res.writeHead(route.status, { 'content-type': 'text/html', ...route.headers }).end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  received.length = 0;
});

const send = (page: import('@playwright/test').Page, path: string, method = 'POST') =>
  page.evaluate(([p, m]) => (window as unknown as { send: (p: string, m: string) => Promise<string> }).send(p, m), [path, method]);

test.describe('browser request policy', () => {
  test('readonly tests cannot send mutating requests to the approved host', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });
    await page.goto(`${origin}/page`);

    expect(await send(page, '/signup-request')).toBe('aborted');

    expect(received).toEqual(['GET /page']);
    expect(policy.violations.join('\n')).toContain('POST');
  });

  test('a Cloudflare bot-check POST is aborted and does not fail the read-only policy', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });
    await page.goto(`${origin}/page`);

    expect(await send(page, '/cdn-cgi/challenge-platform/h/b/test')).toBe('aborted');

    expect(received).toEqual(['GET /page']);
    expect(policy.violations).toEqual([]);
    expect(policy.allowedWrites).toEqual([]);
    expect(policy.blockedRequests.join('\n')).toContain('Bot-check POST aborted');
  });

  test('gated tests may only mutate allowlisted endpoints', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'writes-signup', allowedMutations: [/^\/signup-request$/], hostPolicy: loopbackPolicy });
    await page.goto(`${origin}/page`);

    expect(await send(page, '/signup-request')).toBe('sent');
    expect(await send(page, '/signup-complete')).toBe('aborted');

    expect(received).toEqual(['GET /page', 'POST /signup-request']);
    expect(policy.violations.join('\n')).toContain('/signup-complete');
  });

  test('direct navigation to production is aborted', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });

    await expect(page.goto(`${PRODUCTION}/login`)).rejects.toThrow();

    expect(policy.violations.join('\n')).toMatch(/Blocked: GET https:\/\/my\.internetticketing\.com\/login .*PRODUCTION/);
  });

  test('a redirect from the approved host to production is aborted before it is followed', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });

    await expect(page.goto(`${origin}/redirect-to-prod`)).rejects.toThrow();

    expect(received).toEqual(['GET /redirect-to-prod']);
    expect(policy.violations.join('\n')).toMatch(/Redirect blocked: .*\/redirect-to-prod → https:\/\/my\.internetticketing\.com\/login .*PRODUCTION/);
  });

  test('a fetch() redirected to production is aborted', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });
    await page.goto(`${origin}/page`);

    expect(await send(page, '/redirect-to-prod', 'GET')).toBe('aborted');

    expect(policy.violations.join('\n')).toContain('Redirect blocked');
  });

  test('script-driven navigation to production is aborted', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });

    await page.goto(`${origin}/js-to-prod`);
    await expect.poll(() => policy.violations.join('\n')).toMatch(/my\.internetticketing\.com.*PRODUCTION/);
    expect(page.url()).not.toContain('internetticketing');
  });

  test('background requests to unknown hosts are aborted and recorded', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });

    await page.goto(`${origin}/third-party`);
    await expect.poll(() => policy.blockedRequests.length).toBe(1);

    expect(policy.blockedRequests[0]).toContain('cdn.unknown-third-party.example');
    expect(policy.violations).toEqual([]);
  });

  test('WebSockets to production are refused', async ({ context, page }) => {
    const policy = await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });

    await page.goto(`${origin}/ws-to-prod`);

    await expect.poll(() => policy.violations.join('\n')).toMatch(/WebSocket blocked: wss:\/\/my\.internetticketing\.com/);
  });
});

test.describe('API request policy', () => {
  test('API calls to production and API redirects to production are refused', async ({ request }) => {
    const api = guardApiContext(request, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });

    await expect(api.get(`${PRODUCTION}/api/signup`)).rejects.toThrow(/PRODUCTION/);
    await expect(api.fetch(`${PRODUCTION}/api/login`, { method: 'POST' })).rejects.toThrow(/PRODUCTION/);
    await expect(api.get(`${origin}/hop1`)).rejects.toThrow(/redirect hop 2.*PRODUCTION/);

    expect(received).toEqual(['GET /hop1', 'GET /hop2']);
  });

  test('readonly API contexts cannot mutate', async ({ request }) => {
    const api = guardApiContext(request, { level: 'readonly', allowedMutations: [], hostPolicy: loopbackPolicy });

    await expect(api.post(`${origin}/signup-request`)).rejects.toThrow(/not permitted/);
    expect(received).toEqual([]);
  });

  test('page.request and context.request are guarded too', async ({ context, page }) => {
    await guardContext(context, { level: 'provisioning', allowedMutations: [], hostPolicy: loopbackPolicy });

    await expect(page.request.get(`${PRODUCTION}/`)).rejects.toThrow(/PRODUCTION/);
    await expect(context.request.post(`${PRODUCTION}/api/signup`)).rejects.toThrow(/PRODUCTION/);
    const later = await context.newPage();
    await expect(later.request.get(`${origin}/redirect-to-prod`)).rejects.toThrow(/PRODUCTION/);
  });
});

test('resolver backstop: the browser cannot resolve non-approved hosts even without routing', async ({ page }) => {
  await expect(page.goto('https://example.com/')).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
});
