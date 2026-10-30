import type { Request } from '@playwright/test';
import { BOOT_MS } from '../helpers.ts';
import { expect, type Page, test } from './fixtures.ts';
import { REPLAY_NODE_ORIGIN } from './run.ts';

/** The page's own fetches and XHRs from now on, as full URLs. */
function fetches(page: Page): { urls: string[]; stop: () => void } {
  const urls: string[] = [];
  const on = (r: Request) => {
    if (r.resourceType() === 'fetch' || r.resourceType() === 'xhr') urls.push(r.url());
  };
  page.on('request', on);
  return { urls, stop: () => page.off('request', on) };
}

const settings = (page: Page) => page.getByRole('link', { name: 'Settings' }).click();

// The fixture refuses every other origin; this holds the app's own origin to what the page fetches
// without the flow, so the mock cannot reach the network from the same origin either.
test('the mocked fee funding runs end to end on B, through a failed claim and its retry', async ({
  page,
  replay,
}) => {
  const app = new URL(replay.run.baseURL).origin;
  const plain = fetches(page);
  await page.goto(replay.url());
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  await page.waitForLoadState('networkidle');
  plain.stop();
  const known = new Set(
    plain.urls
      .map((u) => new URL(u))
      .filter((u) => u.origin === app)
      .map((u) => u.pathname),
  );
  known.add('/build.json');

  const seen = fetches(page);
  await page.goto(replay.url({ fees: 'b', 'fees-session': 'stand-in', 'fees-fail': 'claim' }));
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  await page.getByTestId('fees-entry').click();
  await page.getByTestId('fees-search').fill('usd');
  await page.getByTestId('fees-token-11155111-USDC').click();
  await page.getByTestId('fees-amount').fill('100');
  await expect(page.getByTestId('fees-quote')).toBeVisible();
  await page.getByTestId('fees-go').click();
  // The card outlives the route: back from Settings it shows the trade, not the entry.
  await settings(page);
  await expect(page.getByTestId('fees-card')).toHaveCount(0);
  await page.getByRole('link', { name: 'Mine', exact: true }).click();
  await expect(page.getByTestId('fees-card')).toBeVisible();
  await expect(page.getByTestId('fees-entry')).toHaveCount(0);
  await expect(page.getByTestId('fees-failure')).toBeVisible();
  await expect(page.getByTestId('fees-step-claim')).toHaveAttribute('data-state', 'failed');
  await page.getByTestId('fees-retry').click();
  await expect(page.getByTestId('fees-done')).toBeVisible();
  // Funded past a claim's cost, the account no longer gets the entry.
  await page.getByTestId('fees-dismiss').click();
  await expect(page.getByTestId('fees-card')).toHaveCount(0);
  seen.stop();
  const stray = seen.urls.filter((u) => {
    const url = new URL(u);
    return url.origin !== REPLAY_NODE_ORIGIN && !(url.origin === app && known.has(url.pathname));
  });
  expect(stray).toEqual([]);
});
