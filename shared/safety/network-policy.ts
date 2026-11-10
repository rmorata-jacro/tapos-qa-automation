import type { BrowserContext, Request, Route } from '@playwright/test';
import { classifyHost, describeRejection, stagingHostPolicy, type HostPolicy } from './environment-guard';
import { redactUrl } from './redaction';
import type { SafetyLevel } from './safety-levels';

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cloudflare bot-check submission. It is a POST to the staging host, so it is
 * aborted for every safety level and is not treated as an allowed write.
 * Aborting it stops the browser from getting past the interstitial.
 */
const BOT_CHECK_PATH = /^\/cdn-cgi\/challenge-platform\//;

export interface NetworkPolicyOptions {
  level: SafetyLevel;
  /** Pathname patterns on the staging host that a gated test is allowed to mutate. */
  allowedMutations: RegExp[];
  hostPolicy?: HostPolicy;
}

export interface NetworkPolicyHandle {
  /** Any entry fails the test. */
  violations: string[];
  /** Redacted "METHOD url" lines for every mutating request that was allowed through. */
  allowedWrites: string[];
  /** Background requests to non-approved hosts that were aborted without failing the test. */
  blockedRequests: string[];
}

function describe(method: string, url: string): string {
  return `${method} ${redactUrl(url)}`;
}

function isMainFrameNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    const frame = request.frame();
    return frame === frame.page().mainFrame();
  } catch {
    return true;
  }
}

export function mutationAllowed(level: SafetyLevel, pathname: string, allowedMutations: RegExp[]): boolean {
  if (level === 'provisioning' || level === 'destructive') return true;
  if (level === 'readonly' || level === 'framework') return false;
  return allowedMutations.some((pattern) => pattern.test(pathname));
}

/**
 * Polices every browser request in a context:
 * - requests to non-approved hosts never leave the browser (production
 *   hosts, navigations, and mutations to them fail the test);
 * - readonly tests may not mutate; gated tests may only mutate allowlisted endpoints;
 * - redirects are validated: Playwright only routes the first URL of a
 *   redirect chain, so approved requests are fetched with redirects disabled
 *   and the Location is checked before the browser may follow it; later hops
 *   are checked from request events and are limited by the browser resolver;
 * - WebSockets are subject to the same host policy.
 */
export async function applyNetworkPolicy(
  context: BrowserContext,
  { level, allowedMutations, hostPolicy = stagingHostPolicy() }: NetworkPolicyOptions,
): Promise<NetworkPolicyHandle> {
  const handle: NetworkPolicyHandle = { violations: [], allowedWrites: [], blockedRequests: [] };

  const handler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      handle.violations.push(`Unparseable request URL aborted: ${describe(method, request.url())}`);
      return route.abort('blockedbyclient');
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.fallback();

    const rejection = describeRejection(url.toString(), hostPolicy);
    if (rejection) {
      const hostClass = classifyHost(url.hostname, hostPolicy);
      const entry = `${describe(method, url.toString())} — ${rejection}`;
      if (hostClass === 'production' || isMainFrameNavigation(request) || !SAFE_METHODS.has(method)) {
        handle.violations.push(`Blocked: ${entry}`);
      } else {
        handle.blockedRequests.push(entry);
      }
      return route.abort('blockedbyclient');
    }

    if (!SAFE_METHODS.has(method) && BOT_CHECK_PATH.test(url.pathname)) {
      handle.blockedRequests.push(`Bot-check POST aborted (not forwarded): ${describe(method, url.toString())}`);
      return route.abort('blockedbyclient');
    }

    if (!SAFE_METHODS.has(method)) {
      if (!mutationAllowed(level, url.pathname, allowedMutations)) {
        handle.violations.push(
          `Mutating request not permitted for "${level}" test: ${describe(method, url.toString())}. ` +
            'If this request is genuinely required, reclassify the test instead of widening the policy.',
        );
        return route.abort('blockedbyclient');
      }
      handle.allowedWrites.push(describe(method, url.toString()));
    }

    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      return route.abort('failed').catch(() => undefined);
    }
    const location = response.headers()['location'];
    if (response.status() >= 300 && response.status() < 400 && location) {
      const target = new URL(location, url);
      const redirectRejection = describeRejection(target.toString(), hostPolicy);
      if (redirectRejection) {
        handle.violations.push(`Redirect blocked: ${describe(method, url.toString())} → ${redactUrl(target.toString())} — ${redirectRejection}`);
        return route.abort('blockedbyclient');
      }
      const replaysWrite = !SAFE_METHODS.has(method) && (response.status() === 307 || response.status() === 308);
      if (replaysWrite && !mutationAllowed(level, target.pathname, allowedMutations)) {
        handle.violations.push(
          `Redirect blocked: ${response.status()} would replay ${method} to ${redactUrl(target.toString())}, which is not permitted for "${level}" tests.`,
        );
        return route.abort('blockedbyclient');
      }
    }
    return route.fulfill({ response });
  };

  await context.route('**/*', handler);

  // Chromium follows the redirect hops after the first itself; they are not routed. They can
  // only resolve approved hosts (see browser-hardening), and every hop is still checked here.
  context.on('request', (request) => {
    if (!request.redirectedFrom()) return;
    const rejection = describeRejection(request.url(), hostPolicy);
    if (rejection) {
      handle.violations.push(`Redirect hop blocked: ${describe(request.method(), request.url())} — ${rejection}`);
    } else if (!SAFE_METHODS.has(request.method()) && !mutationAllowed(level, new URL(request.url()).pathname, allowedMutations)) {
      handle.violations.push(`Redirect hop replayed a write not permitted for "${level}" tests: ${describe(request.method(), request.url())}`);
    }
  });
  await context.routeWebSocket(/.*/, (ws) => {
    const rejection = describeRejection(ws.url().replace(/^ws/, 'http'), hostPolicy);
    if (rejection) {
      handle.violations.push(`WebSocket blocked: ${redactUrl(ws.url())} — ${rejection}`);
      return ws.close({ code: 1008, reason: 'Blocked by QA network policy' });
    }
    ws.connectToServer();
  });

  return handle;
}
