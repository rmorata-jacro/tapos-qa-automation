import type { APIResponse, Page, Response, TestInfo } from '@playwright/test';
import {
  describeSecurityChallenge,
  detectSecurityChallenge,
  SECURITY_CHALLENGE_ANNOTATION,
  type ResponseObservation,
  type SecurityChallenge,
} from './security-challenge';

const BODY_SAMPLE_BYTES = 8_000;

async function bodySample(read: () => Promise<string>): Promise<string | undefined> {
  return read().then((text) => text.slice(0, BODY_SAMPLE_BYTES), () => undefined);
}

function titleOf(body: string | undefined): string | undefined {
  return /<title>([^<]*)<\/title>/i.exec(body ?? '')?.[1];
}

/**
 * Records Cloudflare security challenges seen by one test as annotations, so
 * the classification reporter lists the test as
 * "BLOCKED — Infrastructure / Security Challenge" whatever its raw status.
 */
export class SecurityChallengeMonitor {
  readonly challenges: SecurityChallenge[] = [];
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly testInfo: TestInfo) {}

  watchPage(page: Page): void {
    page.on('response', (response) => {
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
      this.track(this.inspectDocument(response));
    });
  }

  async inspectApiResponse(response: APIResponse): Promise<void> {
    const body = await bodySample(() => response.text());
    this.record({ url: response.url(), status: response.status(), headers: response.headers(), body, title: titleOf(body) });
  }

  /** Stops the test as BLOCKED when a challenge was recorded, keeping a masked screenshot of the page. */
  async stopIfChallenged(detail: string, page?: Page): Promise<void> {
    await Promise.all(this.pending);
    if (!this.challenges.length) return;
    if (page && !page.isClosed()) {
      const screenshot = await page.screenshot({
        fullPage: true,
        mask: [page.locator('input'), page.locator('[data-qa-sensitive]')],
        maskColor: '#000000',
        timeout: 10_000,
      }).catch(() => undefined);
      if (screenshot) await this.testInfo.attach('security-challenge-page', { body: screenshot, contentType: 'image/png' });
    }
    this.testInfo.skip(true, `${describeSecurityChallenge(this.challenges[0])} | ${detail}`);
  }

  async attachEvidence(): Promise<void> {
    await Promise.all(this.pending);
    if (!this.challenges.length) return;
    await this.testInfo.attach('security-challenge-evidence', {
      body: JSON.stringify(this.challenges, null, 2),
      contentType: 'application/json',
    });
  }

  private async inspectDocument(response: Response): Promise<void> {
    const headers = response.headers();
    const body = headers['cf-mitigated'] || headers['server']?.toLowerCase() === 'cloudflare' ? await bodySample(() => response.text()) : undefined;
    this.record({ url: response.url(), status: response.status(), headers, body, title: titleOf(body) });
  }

  private record(observation: ResponseObservation): void {
    const challenge = detectSecurityChallenge(observation);
    if (!challenge) return;
    this.challenges.push(challenge);
    this.testInfo.annotations.push({ type: SECURITY_CHALLENGE_ANNOTATION, description: describeSecurityChallenge(challenge) });
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch(() => undefined).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
}
