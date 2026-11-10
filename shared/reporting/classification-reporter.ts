import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { redactText } from '../safety/redaction';
import { classifyResult } from './result-classification';
import { SECURITY_CHALLENGE_ANNOTATION } from './security-challenge';

interface ClassifiedRow {
  testId: string;
  title: string;
  classification: string;
  playwrightStatus: string;
  reason?: string;
  securityChallenges: string[];
}

/** Writes reports/classified-results.json and prints one line per test with its QA classification. */
export default class ClassificationReporter implements Reporter {
  private readonly rows: ClassifiedRow[] = [];

  constructor(private readonly options: { outputFile?: string } = {}) {}

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = [...test.annotations, ...result.annotations];
    const skip = annotations.find((a) => a.type === 'skip')?.description;
    const error = result.errors[0]?.message?.split('\n')[0];
    this.rows.push({
      testId: annotations.find((a) => a.type === 'test-id')?.description ?? '',
      title: test.title,
      classification: classifyResult({ status: result.status, annotations }),
      playwrightStatus: result.status,
      reason: redactText(skip ?? error ?? '').slice(0, 600) || undefined,
      securityChallenges: annotations.filter((a) => a.type === SECURITY_CHALLENGE_ANNOTATION).map((a) => a.description ?? ''),
    });
  }

  onEnd(result: FullResult): void {
    const file = path.resolve(this.options.outputFile ?? 'reports/classified-results.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ runStatus: result.status, results: this.rows }, null, 2));
    console.log('\n=== QA classification ===');
    for (const row of this.rows) {
      console.log(`${row.classification.padEnd(46)} ${row.title} (Playwright: ${row.playwrightStatus})`);
    }
    console.log(`Classified results: ${path.relative(process.cwd(), file)}`);
  }
}
