import { test } from '../../../shared/safety/guarded-test';
import { SAFETY_ANNOTATION } from '../../../shared/safety/safety-levels';
import { catalogEntry } from '../int-3437-test-catalog';
import { unconfirmedQuestions, type ContractValue } from '../signup-contract';

/**
 * Binds a Playwright test to its INT-3437 catalog entry. The safety level is
 * taken from the catalog, never from the spec file, so the runtime gate and
 * the run plan always agree.
 */
export function int3437Case(id: string) {
  const entry = catalogEntry(id);
  return {
    title: `${entry.id} — ${entry.title}`,
    details: {
      tag: [`@${entry.id}`, `@suite-${entry.suite}`, `@${entry.level}`],
      annotation: [
        { type: SAFETY_ANNOTATION, description: entry.level },
        { type: 'test-id', description: entry.id },
        ...(entry.limits ?? []).map((limit) => ({ type: 'coverage-limit', description: limit })),
      ],
    },
  };
}

type Values<T extends ContractValue<unknown>[]> = { [K in keyof T]: T[K] extends ContractValue<infer V> ? V : never };

/** Skips the current test as BLOCKED when any required expectation is unconfirmed. */
export function requireContract<T extends ContractValue<unknown>[]>(...entries: T): Values<T> {
  const questions = unconfirmedQuestions(entries);
  test.info().skip(questions.length > 0, `BLOCKED — needs confirmation from INT-3437: ${questions.join(' | ')}`);
  return entries.map((entry) => (entry.confirmed ? entry.value : undefined)) as Values<T>;
}

/** Mutation allowlist built only from confirmed endpoints; unconfirmed ones allow nothing. */
export function confirmedPatterns(...entries: ContractValue<RegExp>[]): RegExp[] {
  return entries.flatMap((entry) => (entry.confirmed ? [entry.value] : []));
}

export function requireEnv(name: string, purpose: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`TEST DATA PREREQUISITE NOT MET: ${name} is not set (${purpose}).`);
  return value;
}
