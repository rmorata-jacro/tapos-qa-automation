import { expect, test } from '@playwright/test';
import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';
import { APPROVED_STAGING, PRODUCTION_URLS } from '../../config/environments';
import { resolveBaseUrl } from '../../config/suites';
import { hardenLaunchOptions, stagingLaunchArgs } from '../../shared/safety/browser-hardening';
import { evaluateDatabaseTargets, requireStagingDatabases } from '../../shared/safety/database-guard';
import { verifyHostResolution } from '../../shared/safety/dns-guard';
import { assertStagingUrl, classifyHost, proxyEnvironmentReasons, stagingHostPolicy } from '../../shared/safety/environment-guard';
import { evaluateIsolatedEnvironment } from '../../shared/safety/isolated-environment';

const PRODUCTION = 'https://my.internetticketing.com';
const STAGING = 'https://it.taposapp.com';

test.describe('approved targets', () => {
  test('staging and production are fixed in code', () => {
    expect(APPROVED_STAGING.baseUrl).toBe(STAGING);
    expect(APPROVED_STAGING.hosts).toEqual(['it.taposapp.com']);
    expect(PRODUCTION_URLS).toContain(PRODUCTION);
  });

  test('environment variables cannot widen the allowlist or unblock production', () => {
    const policy = stagingHostPolicy({ QA_ALLOWED_HOSTS: 'my.internetticketing.com,evil.example', QA_BLOCKED_HOST_PATTERNS: '' });
    expect(policy.allowedHosts).toEqual(['it.taposapp.com']);
    expect(classifyHost('my.internetticketing.com', policy)).toBe('production');
    expect(classifyHost('my.internetticketing.com', { allowedHosts: ['my.internetticketing.com'], blockedPatterns: BLOCKED_HOST_PATTERNS })).toBe('production');
  });
});

test.describe('staging URL guard', () => {
  for (const url of [STAGING, `${STAGING}/signup?x=1`, 'https://IT.TAPOSAPP.COM', 'https://it.taposapp.com./']) {
    test(`accepts ${url}`, () => {
      expect(assertStagingUrl(url, 'URL').hostname.replace(/\.$/, '').toLowerCase()).toBe('it.taposapp.com');
    });
  }

  const production = [
    PRODUCTION,
    `${PRODUCTION}/login`,
    'https://MY.INTERNETTICKETING.COM',
    'https://my.internetticketing.com.',
    'https://api.internetticketing.com',
    'http://my.internetticketing.com',
    'https://my.internetticketing.com:443/',
    'https://it.taposapp.com@my.internetticketing.com/',
    `${PRODUCTION}/?next=${STAGING}`,
    `${PRODUCTION}#it.taposapp.com`,
  ];
  for (const url of production) {
    test(`rejects production ${url}`, () => {
      expect(() => assertStagingUrl(url, 'URL')).toThrow(/PRODUCTION/);
    });
  }

  const substitutes = [
    'http://localhost',
    'https://localhost:3000',
    'https://127.0.0.1',
    'https://[::1]',
    'https://2130706433',
    'https://0x7f000001',
    'https://it.taposapp.com.localhost',
    'https://staging',
    'https://104.26.8.106',
  ];
  for (const url of substitutes) {
    test(`rejects localhost/IP substitute ${url}`, () => {
      expect(() => assertStagingUrl(url, 'URL')).toThrow(/localhost\/IP substitute/);
    });
  }

  for (const url of ['https://it.taposapp.com.evil.example', 'https://taposapp.com', 'https://other.taposapp.com', 'https://it-taposapp.com']) {
    test(`rejects unknown host ${url}`, () => {
      expect(() => assertStagingUrl(url, 'URL')).toThrow(/not an approved staging host/);
    });
  }

  test('rejects insecure scheme, non-default port, and embedded credentials on the staging host', () => {
    expect(() => assertStagingUrl('http://it.taposapp.com', 'URL')).toThrow(/https/);
    expect(() => assertStagingUrl('https://it.taposapp.com:8443', 'URL')).toThrow(/default https port/);
    expect(() => assertStagingUrl('https://user:pw@it.taposapp.com', 'URL')).toThrow(/credentials/);
  });

  test('fails closed when the staging URL is missing or invalid, for every staging suite', () => {
    for (const suite of ['A-readonly', 'A-gated', 'B', 'C'] as const) {
      expect(() => resolveBaseUrl(suite, {}), suite).toThrow(/not set/);
      expect(() => resolveBaseUrl(suite, { CLOUD_SIGNUP_BASE_URL: '   ' }), suite).toThrow(/not set/);
      expect(() => resolveBaseUrl(suite, { CLOUD_SIGNUP_BASE_URL: 'it.taposapp.com' }), suite).toThrow(/not a valid URL/);
      expect(() => resolveBaseUrl(suite, { CLOUD_SIGNUP_BASE_URL: PRODUCTION }), suite).toThrow(/PRODUCTION/);
      expect(resolveBaseUrl(suite, { CLOUD_SIGNUP_BASE_URL: `${STAGING}/signup` }), suite).toBe(STAGING);
    }
    expect(resolveBaseUrl('framework', {})).toBeUndefined();
  });

  test('proxy environment variables are refused', () => {
    expect(proxyEnvironmentReasons({ HTTPS_PROXY: 'http://proxy.example:3128' })).toHaveLength(1);
    expect(proxyEnvironmentReasons({})).toEqual([]);
  });
});

test.describe('DNS guard', () => {
  const resolver = (map: Record<string, string[]>) => async (host: string) => {
    if (!map[host]) throw new Error('ENOTFOUND');
    return map[host];
  };
  const prod = { 'my.internetticketing.com': ['52.56.131.160'] };

  test('accepts staging resolving to public non-production addresses', async () => {
    expect(await verifyHostResolution(['it.taposapp.com'], resolver({ ...prod, 'it.taposapp.com': ['104.26.8.106'] }))).toEqual([]);
  });

  test('refuses hosts-file / tunnel substitutes, production addresses, and resolution failures', async () => {
    for (const addresses of [['127.0.0.1'], ['10.1.2.3'], ['192.168.0.5'], ['169.254.1.1'], ['::1']]) {
      const reasons = await verifyHostResolution(['it.taposapp.com'], resolver({ ...prod, 'it.taposapp.com': addresses }));
      expect(reasons.join(' '), addresses.join()).toContain('non-public');
    }
    const shared = await verifyHostResolution(['it.taposapp.com'], resolver({ ...prod, 'it.taposapp.com': ['52.56.131.160'] }));
    expect(shared.join(' ')).toContain('PRODUCTION');
    expect((await verifyHostResolution(['it.taposapp.com'], resolver(prod))).join(' ')).toContain('could not be resolved');
  });
});

test.describe('database target guard (Websales, Membership, POS)', () => {
  const approved = { approvedHosts: ['db.staging.example'], blockedPatterns: BLOCKED_HOST_PATTERNS };
  const env = (host: string, database = 'websales_staging') => ({
    QA_WEBSALES_DB_URL: `mysql://qa_reader:S3cretPw@${host}:3306/${database}`,
    QA_MEMBERSHIP_DB_URL: 'mysql://qa_reader:S3cretPw@db.staging.example:3306/membership_staging',
    QA_POS_DB_URL: 'mysql://qa_reader:S3cretPw@db.staging.example:3306/pos_staging',
  });

  test('fails closed while no staging database hosts are approved', async () => {
    expect(evaluateDatabaseTargets(env('db.staging.example')).reasons.join(' ')).toContain('No staging database hosts are approved');
    await expect(requireStagingDatabases(env('db.staging.example'))).rejects.toThrow(/DATABASE TARGETS REFUSED/);
  });

  test('requires all three connections', () => {
    const reasons = evaluateDatabaseTargets({}, approved).reasons.join(' ');
    for (const name of ['QA_WEBSALES_DB_URL', 'QA_MEMBERSHIP_DB_URL', 'QA_POS_DB_URL']) expect(reasons).toContain(name);
  });

  test('accepts approved staging hosts and refuses production, substitutes, and unknown hosts', () => {
    expect(evaluateDatabaseTargets(env('db.staging.example'), approved).reasons).toEqual([]);
    const cases: [string, string, RegExp][] = [
      ['db.internetticketing.com', 'websales', /PRODUCTION/],
      ['db.staging.example', 'websales_prod', /PRODUCTION/],
      ['live-db.example', 'websales', /PRODUCTION/],
      ['localhost', 'websales', /substitute/],
      ['127.0.0.1', 'websales', /substitute/],
      ['10.0.0.8', 'websales', /substitute/],
      ['db.other.example', 'websales', /not an approved staging database host/],
    ];
    for (const [host, database, expected] of cases) {
      expect(evaluateDatabaseTargets(env(host, database), approved).reasons.join(' '), `${host}/${database}`).toMatch(expected);
    }
  });

  test('never echoes database credentials', () => {
    const text = evaluateDatabaseTargets(env('db.internetticketing.com'), approved).reasons.join(' ');
    expect(text).not.toMatch(/S3cretPw|qa_reader/);
  });
});

test.describe('browser launch hardening', () => {
  test('the browser can only resolve approved staging hosts and ignores proxies', () => {
    expect(stagingLaunchArgs()).toEqual(['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE it.taposapp.com', '--no-proxy-server']);
  });

  test('proxies and competing resolver rules are refused', () => {
    expect(() => hardenLaunchOptions({ proxy: { server: 'http://proxy.example:3128' } })).toThrow(/proxy/);
    expect(() => hardenLaunchOptions({ args: ['--host-resolver-rules=MAP it.taposapp.com 52.56.131.160'] })).toThrow(/not allowed/);
    expect(() => hardenLaunchOptions({ args: ['--proxy-server=http://x'] })).toThrow(/not allowed/);
  });
});

test('Suite C refuses shared staging even if the environment does not list it as shared', () => {
  const env = {
    QA_SUITE: 'C', QA_ALLOW_DESTRUCTIVE: '1', QA_ISOLATED_ENVIRONMENT_CONFIRMED: 'yes', QA_SUITE_C_APPROVAL_ID: 'c-approval',
    QA_ISOLATED_HOSTS: 'it.taposapp.com', QA_SHARED_STAGING_HOSTS: '',
  };
  expect(evaluateIsolatedEnvironment('it.taposapp.com', env).join(' ')).toContain('shared staging host');
});
