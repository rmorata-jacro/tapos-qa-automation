import type { Page, TestInfo } from '@playwright/test';

const BOT_CHECK_TEXT = 'Performing security verification';

export const STAGING_BOT_CHECK_BLOCKER =
  'AUTOMATION BLOCKER: it.taposapp.com showed the Cloudflare bot-check page instead of the application. ' +
  'The read-only guard aborted POST /cdn-cgi/challenge-platform/ and challenges.cloudflare.com is not an approved host, ' +
  'so the application page was not reached. Product labels were not observed and were not guessed.';

export async function stagingBotCheckVisible(page: Page): Promise<boolean> {
  const botCheck = page.getByText(BOT_CHECK_TEXT).first();
  return botCheck.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
}

/** Attaches a masked screenshot, then stops the test as BLOCKED. */
export async function stopForBotCheck(page: Page, testInfo: TestInfo, detail: string): Promise<void> {
  const screenshot = await page.screenshot({
    fullPage: true,
    mask: [page.locator('input'), page.locator('[data-qa-sensitive]')],
    maskColor: '#000000',
    timeout: 10_000,
  }).catch(() => undefined);
  if (screenshot) await testInfo.attach('bot-check-page', { body: screenshot, contentType: 'image/png' });
  testInfo.skip(true, `${STAGING_BOT_CHECK_BLOCKER} ${detail}`);
}
