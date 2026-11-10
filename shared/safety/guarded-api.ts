import type { APIRequestContext, APIResponse } from '@playwright/test';
import { describeRejection, stagingHostPolicy, type HostPolicy } from './environment-guard';
import { mutationAllowed, SAFE_METHODS } from './network-policy';
import { redactUrl } from './redaction';
import type { SafetyLevel } from './safety-levels';

type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

const MAX_REDIRECTS = 10;
const METHOD_SHORTCUTS = ['get', 'head', 'post', 'put', 'patch', 'delete'] as const;

export class BlockedRequestError extends Error {
  constructor(message: string) {
    super(`REQUEST BLOCKED by QA network policy: ${message}`);
    this.name = 'BlockedRequestError';
  }
}

export interface GuardedApiOptions {
  level: SafetyLevel;
  allowedMutations: RegExp[];
  baseURL?: string;
  hostPolicy?: HostPolicy;
  /** Called with every response received, including redirect hops. */
  onResponse?: (response: APIResponse) => Promise<void>;
}

/**
 * Wraps an APIRequestContext so Node-side API calls obey the same rules as
 * the browser: approved hosts only, level-based mutation rules, and redirects
 * followed manually (GET/HEAD only) after validating every Location.
 */
export function guardApiContext(context: APIRequestContext, options: GuardedApiOptions): APIRequestContext {
  const policy = options.hostPolicy ?? stagingHostPolicy();

  async function guardedFetch(urlOrRequest: unknown, fetchOptions: FetchOptions = {}): Promise<APIResponse> {
    if (typeof urlOrRequest !== 'string') throw new BlockedRequestError('only string URLs are accepted by the guarded API.');
    const method = (fetchOptions.method ?? 'GET').toUpperCase();
    let url = new URL(urlOrRequest, options.baseURL).toString();

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const rejection = describeRejection(url, policy);
      if (rejection) throw new BlockedRequestError(`${method} ${redactUrl(url)}${hop ? ` (redirect hop ${hop})` : ''} — ${rejection}`);
      if (!SAFE_METHODS.has(method) && !mutationAllowed(options.level, new URL(url).pathname, options.allowedMutations)) {
        throw new BlockedRequestError(`${method} ${redactUrl(url)} is not permitted for "${options.level}" tests.`);
      }
      const response = await context.fetch(url, { ...fetchOptions, method, maxRedirects: 0 });
      await options.onResponse?.(response);
      const location = response.headers()['location'];
      const isRedirect = response.status() >= 300 && response.status() < 400 && location;
      if (!isRedirect || !SAFE_METHODS.has(method)) return response;
      url = new URL(location, url).toString();
    }
    throw new BlockedRequestError(`more than ${MAX_REDIRECTS} redirects.`);
  }

  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'fetch') return guardedFetch;
      if ((METHOD_SHORTCUTS as readonly (string | symbol)[]).includes(property)) {
        return (url: string, opts: FetchOptions = {}) => guardedFetch(url, { ...opts, method: String(property).toUpperCase() });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
