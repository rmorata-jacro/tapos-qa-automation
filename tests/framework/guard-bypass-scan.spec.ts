import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const root = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Product and workflow code must go through shared/safety; these patterns would bypass it. */
const BYPASSES: [RegExp, string][] = [
  [/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/, 'import `test` from shared/safety/guarded-test instead of @playwright/test'],
  [/\.(route|unroute|unrouteAll|routeFromHAR|routeWebSocket)\s*\(/, 'request routing is owned by the network policy'],
  [/\bbrowser\.newContext\s*\(|\bbrowser\.newPage\s*\(/, 'use newGuardedContext()'],
  [/\.launch(Persistent|Server)?\s*\(|connectOverCDP|\.connect\s*\(/, 'browsers are launched only by the hardened fixture'],
  [/playwright\.request|request\.newContext\s*\(/, 'use the guarded `request` fixture'],
  [/\bproxy\s*:/, 'proxies are not allowed'],
  [/host-resolver-rules|proxy-server/, 'browser network flags are owned by browser-hardening'],
  [/ignoreHTTPSErrors/, 'TLS validation must stay on'],
];

test('product and workflow code cannot bypass the staging network guard', () => {
  const findings: string[] = [];
  for (const file of [...sourceFiles(path.join(root, 'products')), ...sourceFiles(path.join(root, 'workflows'))]) {
    const source = readFileSync(file, 'utf8');
    for (const [pattern, reason] of BYPASSES) {
      if (pattern.test(source)) findings.push(`${path.relative(root, file)}: ${reason}`);
    }
  }
  expect(findings).toEqual([]);
});

test('every product and workflow spec imports test from a guarded fixture', () => {
  const specs = [...sourceFiles(path.join(root, 'products')), ...sourceFiles(path.join(root, 'workflows'))].filter((f) =>
    f.endsWith('.spec.ts'),
  );
  expect(specs.length).toBeGreaterThan(0);
  for (const spec of specs) {
    const source = readFileSync(spec, 'utf8');
    expect(source, path.relative(root, spec)).toMatch(/from '(\.\.\/)+(shared\/safety\/guarded-test|fixtures\/provisioned-signup)'/);
  }
});
