import { generatePrivateKey } from 'viem/accounts';
import { connectTestWallet, installL1Wallet } from '../helpers/l1-wallet.ts';
import { BOOT_MS, dialogOverflow, openDialog, virtualAuthenticator } from '../helpers.ts';
import { expect, type Page, test } from './fixtures.ts';

/**
 * The account dialog is 440 px wide and the page needs 900 px to be a desktop, so the window is
 * 900 × 720: what is checked is the dialog's own box — no horizontal overflow in the page or inside
 * it, its bottom inside the viewport, and the screen's primary reachable by the dialog's scroll.
 */
async function fits(page: Page, primary: string) {
  const over = await dialogOverflow(page);
  const box = await page.evaluate(() => {
    const r = (document.querySelector('[data-testid=sign-in]') as HTMLElement).getBoundingClientRect();
    return { width: Math.round(r.width), bottom: r.bottom };
  });
  expect(over.page).toBeLessThanOrEqual(0);
  expect(over.inner).toBeLessThanOrEqual(0);
  expect(box.width).toBe(440);
  expect(box.bottom).toBeLessThanOrEqual(720);
  const button = page.getByTestId(primary);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
}

test('the account screens and their notes fit the dialog at 720 px tall', async ({ page, replay }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await virtualAuthenticator(page); // no credential on it: a log in with a passkey fails, honestly
  await page.goto(replay.url());
  await openDialog(page);
  await fits(page, 'start-create');

  await page.getByTestId('start-create').click();
  await fits(page, 'create-passkey');
  await page.getByTestId('back').click();
  await page.getByTestId('start-login').click();
  await fits(page, 'restore-passkey');
  await page.getByTestId('restore-passkey').click();
  await expect(page.getByTestId('key-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('key-error')).toContainText("Sign-in didn't complete.");
  await fits(page, 'restore-passkey');
  await page.getByTestId('restore-words').click();
  await expect(page.getByTestId('words-restore')).toBeVisible();
  await fits(page, 'words-open');

  await page.reload();
  await openDialog(page);
  await page.getByTestId('start-create').click();
  await page.getByTestId('use-words').click();
  await expect(page.getByTestId('words-backup')).toBeVisible();
  await fits(page, 'words-done');
  await page.getByTestId('written').check();
  await expect(page.getByTestId('quiz')).toBeVisible();
  await fits(page, 'words-done');
});

/**
 * The fee dialog over a list longer than the window: its box inside the window and not scrolled itself,
 * its head (title, wallet chip, search) and its foot (the file link, where the option has one) in view,
 * and the list scrolling inside down to its last row with the head and foot still in view.
 */
async function feeDialogFits(page: Page, foot: boolean) {
  const dialog = page.getByTestId('fees-dialog');
  const list = dialog.getByTestId('fees-token-list');
  const rows = list.locator('[data-testid^=fees-token-]');
  await expect(rows.first()).toBeVisible();
  const box = await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, scrolls: d.scrollHeight - d.clientHeight };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(720);
  expect(box.scrolls).toBeLessThanOrEqual(0);
  const ends = [
    dialog.getByRole('heading', { name: 'Fund fees.' }),
    dialog.getByTestId('eth-account'),
    dialog.getByTestId('fees-search'),
    ...(foot ? [dialog.getByText('Resuming a funding? Load its file')] : []),
  ];
  for (const part of ends) await expect(part).toBeInViewport();
  expect(await list.evaluate((l) => l.scrollHeight - l.clientHeight)).toBeGreaterThan(0);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();
  for (const part of ends) await expect(part).toBeInViewport();
}

test('the fee dialog stays inside the window at 720 px tall, its token list scrolling between the search and the file link', async ({
  page,
  replay,
}) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await installL1Wallet(page.context(), {
    rpcUrl: 'http://127.0.0.1:1',
    privateKey: generatePrivateKey(),
    chainId: 11155111,
  });
  const open = async (option: string) => {
    await page.goto(replay.url({ fees: option, 'fees-session': 'stand-in' }));
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    await page.getByTestId('fees-entry').click();
  };
  // E lists every supported token: the held first, then the rest under their heading.
  await open('e');
  await connectTestWallet(page);
  await feeDialogFits(page, true);
  // Reloaded, the wallet reconnects on its own and E opens straight on the full list.
  await page.reload();
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  await page.getByTestId('fees-entry').click();
  await feeDialogFits(page, true);
  // D and F list the held tokens alone; a broad search lists most of them.
  for (const option of ['d', 'f']) {
    await open(option);
    await page.getByTestId('fees-search').fill('a');
    await feeDialogFits(page, false);
  }
});
