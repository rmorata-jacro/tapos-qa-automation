import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NIGHTLY_SUITES, SUITE_FILES } from '../../config/suites';
import { INT_3437_CATALOG, INT_3437_RISKS } from '../../products/cloud-signup/int-3437-test-catalog';
import { SAFETY_POLICIES } from '../../shared/safety/safety-levels';

const root = path.resolve(__dirname, '..', '..');
const specSource = (suite: keyof typeof SUITE_FILES) =>
  readFileSync(path.join(root, SUITE_FILES[suite].testDir, SUITE_FILES[suite].testMatch), 'utf8');

test.describe('INT-3437 catalog consistency', () => {
  test('every catalog entry is implemented exactly once, in its own suite file', () => {
    for (const entry of Object.values(INT_3437_CATALOG)) {
      const pattern = new RegExp(`int3437Case\\('${entry.id}'\\)`, 'g');
      const scenarioPattern = new RegExp(`id: '${entry.id}'`, 'g');
      const source = specSource(entry.suite);
      const count = (source.match(pattern)?.length ?? 0) + (source.match(scenarioPattern)?.length ?? 0);
      expect(count, `${entry.id} occurrences in ${SUITE_FILES[entry.suite].testMatch}`).toBe(1);
    }
  });

  test('read-only entries declare no writes and only use nightly-safe levels', () => {
    for (const entry of Object.values(INT_3437_CATALOG)) {
      if (entry.level === 'readonly') expect(entry.expectedWrites, entry.id).toEqual([]);
      if (NIGHTLY_SUITES.includes(entry.suite)) {
        expect(SAFETY_POLICIES[entry.level].nightlyAllowed, `${entry.id} is in a nightly suite`).toBe(true);
      }
    }
  });

  test('suites only contain their permitted safety levels', () => {
    const allowed = {
      'A-readonly': ['readonly'],
      'A-gated': ['auth-session', 'writes-signup', 'rate-limit'],
      B: ['provisioning'],
      C: ['destructive'],
    } as const;
    for (const entry of Object.values(INT_3437_CATALOG)) {
      expect(allowed[entry.suite] as readonly string[], `${entry.id} level ${entry.level}`).toContain(entry.level);
    }
  });

  test('every regression risk is covered by existing catalog entries', () => {
    for (const risk of INT_3437_RISKS) {
      expect(risk.coveredBy.length, risk.id).toBeGreaterThan(0);
      for (const id of risk.coveredBy) expect(INT_3437_CATALOG[id], `${risk.id} → ${id}`).toBeDefined();
    }
  });
});
