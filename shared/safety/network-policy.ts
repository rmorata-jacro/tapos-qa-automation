import type { BrowserContext, Request } from '@playwright/test';
import { isAllowedTestHost, isBlockedHost } from './environment-guard';
import { redactUrl } from './redaction';
import type { SafetyLevel } from './safety-levels';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface NetworkPolicyOptions {
  level: SafetyLevel;
  /** Pathname patterns on the TEST host that a gated test is allowed to mutate. */
  allowedMutations: RegExp[];
}

export interface NetworkPolicyHandle {
  violations: string[];
  /** Redacted "METHOD url" lines for every mutating request that was allowed through. */
  allowedWrites: string[];
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

function describe(request: Request): string {
  return `${request.method()} ${redactUrl(request.url())}`;
}

/**
 * Classifies tests by what they actually send:
 * - production-pattern hosts are always aborted;
 * - navigations away from approved TEST hosts are aborted;
 * - readonly tests may not send any mutating request to a TEST host;
 * - gated tests may only mutate explicitly allowlisted endpoints.
 * Mutating requests to third-party hosts (analytics beacons) are silently
 * aborted rather than failing the test.
 */
export async function applyNetworkPolicy(
  context: BrowserContext,
  { level, allowedMutations }: NetworkPolicyOptions,
): Promise<NetworkPolicyHandle> {
  const handle: NetworkPolicyHandle = { violations: [], allowedWrites: [] };

  await context.route('**/*', async (route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return route.fallback();
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.fallback();

    if (isBlockedHost(url.hostname)) {
      handle.violations.push(`Blocked production-pattern host: ${describe(request)}`);
      return route.abort('blockedbyclient');
    }

    const testHost = isAllowedTestHost(url.hostname);
    if (isMainFrameNavigation(request) && !testHost) {
      handle.violations.push(`Navigation outside approved TEST hosts: ${describe(request)}`);
      return route.abort('blockedbyclient');
    }

    if (SAFE_METHODS.has(request.method())) return route.fallback();
    if (!testHost) return route.abort('blockedbyclient');

    const allowed =
      level === 'provisioning' ||
      level === 'destructive' ||
      (level !== 'readonly' && level !== 'framework' && allowedMutations.some((p) => p.test(url.pathname)));

    if (!allowed) {
      handle.violations.push(
        `Mutating request not permitted for "${level}" test: ${describe(request)}. ` +
          'If this request is genuinely required, reclassify the test instead of widening the policy.',
      );
      return route.abort('blockedbyclient');
    }
    handle.allowedWrites.push(describe(request));
    return route.fallback();
  });

  return handle;
}
