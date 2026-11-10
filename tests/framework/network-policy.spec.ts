import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { applyNetworkPolicy } from '../../shared/safety/network-policy';

/** Exercises the network guard against a throwaway loopback server; nothing leaves this machine. */

let server: Server;
let origin: string;
const received: string[] = [];

const PAGE = `<!doctype html><title>policy</title><script>
  window.send = (path) => fetch(path, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'aborted');
</script>`;

test.beforeAll(async () => {
  process.env.QA_ALLOWED_HOSTS = '127.0.0.1';
  server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/html' }).end(req.method === 'GET' ? PAGE : 'ok');
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

test('readonly tests cannot send mutating requests to the TEST host', async ({ context, page }) => {
  const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [] });
  await page.goto(`${origin}/signup`);

  expect(await page.evaluate(() => (window as unknown as { send: (p: string) => Promise<string> }).send('/signup-request'))).toBe('aborted');

  expect(received).toEqual(['GET /signup']);
  expect(policy.violations.join('\n')).toContain('POST');
});

test('gated tests may only mutate allowlisted endpoints', async ({ context, page }) => {
  const policy = await applyNetworkPolicy(context, { level: 'writes-signup', allowedMutations: [/^\/signup-request$/] });
  await page.goto(`${origin}/signup`);
  const send = (path: string) =>
    page.evaluate((p) => (window as unknown as { send: (p: string) => Promise<string> }).send(p), path);

  expect(await send('/signup-request')).toBe('sent');
  expect(await send('/signup-complete')).toBe('aborted');

  expect(received).toEqual(['GET /signup', 'POST /signup-request']);
  expect(policy.allowedWrites).toHaveLength(1);
  expect(policy.violations.join('\n')).toContain('/signup-complete');
});

test('navigation to hosts outside the allowlist is aborted', async ({ context, page }) => {
  const policy = await applyNetworkPolicy(context, { level: 'readonly', allowedMutations: [] });

  await expect(page.goto('http://localhost:9/')).rejects.toThrow();

  expect(policy.violations.join('\n')).toContain('Navigation outside approved TEST hosts');
});
