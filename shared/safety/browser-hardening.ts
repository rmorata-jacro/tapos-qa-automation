import type { APIRequestContext, Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from '@playwright/test';
import { stagingHostPolicy, type HostPolicy } from './environment-guard';
import { guardApiContext } from './guarded-api';
import { applyNetworkPolicy, type NetworkPolicyHandle } from './network-policy';
import type { SafetyLevel } from './safety-levels';

const FORBIDDEN_ARG = /^--(host-resolver-rules|proxy-server|proxy-pac-url|proxy-bypass-list)=/;

/**
 * Browser-wide backstop independent of request routing: Chromium may only
 * resolve the approved staging hosts, and system proxies are ignored so the
 * resolver rule cannot be bypassed. IP-literal URLs are not resolved and are
 * rejected by the route policy instead.
 */
export function stagingLaunchArgs(policy: HostPolicy = stagingHostPolicy()): string[] {
  const excludes = policy.allowedHosts.map((host) => `EXCLUDE ${host}`).join(', ');
  return [`--host-resolver-rules=MAP * ~NOTFOUND, ${excludes}`, '--no-proxy-server'];
}

export function hardenLaunchOptions(options: LaunchOptions, policy: HostPolicy = stagingHostPolicy()): LaunchOptions {
  if (options.proxy) throw new Error('Browser proxy configuration is not allowed: it can hide the real destination.');
  const forbidden = (options.args ?? []).filter((arg) => FORBIDDEN_ARG.test(arg));
  if (forbidden.length) throw new Error(`Browser launch arguments not allowed: ${forbidden.join(' ')}`);
  return { ...options, args: [...(options.args ?? []), ...stagingLaunchArgs(policy)] };
}

export interface GuardOptions {
  level: SafetyLevel;
  allowedMutations: RegExp[];
  baseURL?: string;
  hostPolicy?: HostPolicy;
}

function replaceRequest(target: Page | BrowserContext, request: APIRequestContext): void {
  Object.defineProperty(target, 'request', { value: request, configurable: true, enumerable: true });
}

/** Applies the network policy and guards context.request / page.request for every page in the context. */
export async function guardContext(context: BrowserContext, options: GuardOptions): Promise<NetworkPolicyHandle> {
  const handle = await applyNetworkPolicy(context, options);
  const guardedRequest = guardApiContext(context.request, options);
  replaceRequest(context, guardedRequest);
  for (const page of context.pages()) replaceRequest(page, guardedRequest);
  context.on('page', (page) => replaceRequest(page, guardedRequest));
  return handle;
}

/** The only supported way for tests and fixtures to open an additional browser context. */
export async function newGuardedContext(
  browser: Browser,
  options: GuardOptions,
  contextOptions: Omit<BrowserContextOptions, 'baseURL' | 'proxy' | 'serviceWorkers'> = {},
): Promise<{ context: BrowserContext; policy: NetworkPolicyHandle }> {
  const context = await browser.newContext({ ...contextOptions, baseURL: options.baseURL, serviceWorkers: 'block' });
  const policy = await guardContext(context, options);
  return { context, policy };
}
