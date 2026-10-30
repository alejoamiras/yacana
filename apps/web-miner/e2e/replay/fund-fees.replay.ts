import { readFileSync } from 'node:fs';
import type { Request } from '@playwright/test';
import { generatePrivateKey } from 'viem/accounts';
import { connectTestWallet, installL1Wallet, type L1WalletControl } from '../helpers/l1-wallet.ts';
import { BOOT_MS } from '../helpers.ts';
import { expect, type Page, test } from './fixtures.ts';
import { REPLAY_NODE_ORIGIN } from './run.ts';

/** What connecting asks a wallet; anything else (a balance, a node read through the wallet) is the flow reading a chain. */
const CONNECT_ASKS = new Set([
  'eth_accounts',
  'eth_chainId',
  'eth_requestAccounts',
  'wallet_requestPermissions',
  'wallet_revokePermissions',
]);
const SEPOLIA = 11155111;

interface Window {
  /** Same-origin fetches and XHRs, as `METHOD URL BODY`. */
  same: string[];
  /** The JSON-RPC methods the page sent the node. */
  node: Set<string>;
  /** Every request's URL and body, whatever its origin or type. */
  all: string[];
}

/** The page's requests from now until `stop`. */
function watch(page: Page, app: string): { stop: () => Window } {
  const w: Window = { same: [], node: new Set(), all: [] };
  const on = (r: Request) => {
    const url = new URL(r.url());
    const body = r.postData() ?? '';
    w.all.push(`${r.url()} ${body}`);
    if (r.resourceType() !== 'fetch' && r.resourceType() !== 'xhr') return;
    if (url.origin === app) w.same.push(`${r.method()} ${r.url()} ${body}`);
    if (url.origin === REPLAY_NODE_ORIGIN) {
      const calls = [r.postDataJSON() as { method: string } | { method: string }[]].flat();
      for (const c of calls) w.node.add(c.method);
    }
  };
  page.on('request', on);
  return {
    stop: () => {
      page.off('request', on);
      return w;
    },
  };
}

/**
 * The old-tab check's first `GET /build.json` lands 20 s after a load: a window long enough holds it
 * once and the baseline may not, so one is set aside on both sides before they are compared.
 */
function settled(same: readonly string[], app: string): string[] {
  const timed = `GET ${app}/build.json `;
  const out = [...same];
  const i = out.indexOf(timed);
  if (i >= 0) out.splice(i, 1);
  return out.sort();
}

/** What the page sent from a navigation on equals the baseline load's: same requests, node methods among its. */
function likeBaseline(w: Window, base: Window, app: string, where: string) {
  expect(settled(w.same, app), where).toEqual(settled(base.same, app));
  expect(
    [...w.node].filter((m) => !base.node.has(m)),
    where,
  ).toEqual([]);
}

/** The click that saves the recovery file, and the file: its name and its text. */
async function saving(page: Page, testId: string, to: string): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  await download.saveAs(to);
  return { name: download.suggestedFilename(), text: readFileSync(to, 'utf8') };
}

/** From the open picker: Sepolia's USDC found by search, 100 of it, and its quote. */
async function sepoliaUsdc(page: Page) {
  await page.getByTestId('fees-search').fill('usd');
  await page.getByTestId(`fees-token-${SEPOLIA}-USDC`).click();
  await page.getByTestId('fees-amount').fill('100');
  await expect(page.getByTestId('fees-quote')).toBeVisible();
}

async function doneAndDismissed(page: Page) {
  await expect(page.getByTestId('fees-done')).toBeVisible();
  // Funded past a claim's cost, the account no longer gets the entry.
  await page.getByTestId('fees-dismiss').click();
  await expect(page.getByTestId('fees-card')).toHaveCount(0);
}

const settings = (page: Page) => page.getByRole('link', { name: 'Settings' }).click();

/** The page's text never spells the wallet's address out: the chip shows it shortened. */
async function unnamed(page: Page, l1: L1WalletControl) {
  expect((await page.locator('body').innerText()).toLowerCase()).not.toContain(
    l1.address.slice(2).toLowerCase(),
  );
}

async function openAt(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
}

/** f, on a wallet never asked: one tap asks it once, and the dialog opens on the picker with no list shown. */
async function optionF(page: Page, l1: L1WalletControl, file: string) {
  await expect(page.getByTestId('fees-entry')).toBeVisible();
  expect(l1.asked()).not.toContain('eth_requestAccounts');
  await page.getByTestId('fees-entry').click();
  await expect(page.getByTestId('fees-dialog').getByTestId('eth-account')).toBeVisible();
  expect(l1.asked().filter((m) => m === 'eth_requestAccounts')).toHaveLength(1);
  await expect(page.getByTestId('wallet-picker')).toHaveCount(0);
  await unnamed(page, l1);
  await sepoliaUsdc(page);
  const saved = await saving(page, 'fees-go', file);
  await expect(page.getByTestId('fees-step-file')).toHaveAttribute('data-state', 'done');
  await doneAndDismissed(page);
  return saved;
}

/** d: connects on the card, saves at the trail's first stop, and keeps the trade through Settings. */
async function optionD(page: Page, l1: L1WalletControl, file: string) {
  // Connected since f: disconnect on the card's chip, so the card's own connect is what connects.
  await page.getByTestId('fees-card').getByTestId('eth-disconnect').click();
  await page.getByTestId('fees-connect').click();
  await expect(page.getByTestId('fees-card').getByTestId('eth-account')).toBeVisible();
  await unnamed(page, l1);
  await page.getByTestId('fees-entry').click();
  await sepoliaUsdc(page);
  await page.getByTestId('fees-go').click();
  await expect(page.getByTestId('fees-step-file')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('fees-step-swap')).toHaveAttribute('data-state', 'todo');
  const saved = await saving(page, 'fees-save', file);
  await settings(page);
  await expect(page.getByTestId('fees-card')).toHaveCount(0);
  await page.getByRole('link', { name: 'Mine', exact: true }).click();
  await expect(page.getByTestId('fees-card')).toBeVisible();
  await expect(page.getByTestId('fees-entry')).toHaveCount(0);
  await doneAndDismissed(page);
  return saved;
}

/** Records every state `fees-step-swap` and `fees-step-deposit` show from now on, in this document. */
const observeLanded = (page: Page) =>
  page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __feesSeen: Set<string> }).__feesSeen = seen;
    // Every mutation rescans both marks: a commit that adds the card and one that flips a state both count.
    const scan = () => {
      for (const m of document.querySelectorAll(
        '[data-testid="fees-step-swap"],[data-testid="fees-step-deposit"]',
      ))
        seen.add(`${m.getAttribute('data-testid')}:${m.getAttribute('data-state')}`);
    };
    new MutationObserver(scan).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
  });

test('the mocked fee funding runs end to end in every ask27 option, and its recovery file finishes the claim after the site data is cleared', async ({
  page,
  replay,
}, testInfo) => {
  const app = new URL(replay.run.baseURL).origin;
  // Its RPC is a closed port: the flow reads no chain, so nothing may reach it.
  const l1 = await installL1Wallet(page.context(), {
    rpcUrl: 'http://127.0.0.1:1',
    privateKey: generatePrivateKey(),
    chainId: SEPOLIA,
  });
  const everything: string[] = [];
  const files: { name: string; text: string }[] = [];
  const flagged = (o: string, extra: Record<string, string> = {}) =>
    replay.url({ fees: o, 'fees-session': 'stand-in', ...extra });

  const baseline = watch(page, app);
  await openAt(page, replay.url());
  await page.waitForLoadState('networkidle');
  const base = baseline.stop();
  everything.push(...base.all);

  const run = async (o: string, url: string, body: () => Promise<{ name: string; text: string }>) => {
    const w = watch(page, app);
    await openAt(page, url);
    files.push(await body());
    const seen = w.stop();
    everything.push(...seen.all);
    likeBaseline(seen, base, app, o);
  };
  await run('f', flagged('f'), () => optionF(page, l1, testInfo.outputPath('f.json')));
  await run('d', flagged('d'), () => optionD(page, l1, testInfo.outputPath('d.json')));

  // e: saved on the quote's own beat, then the site's data cleared mid-crossing and the file loaded.
  const before = watch(page, app);
  await openAt(page, flagged('e', { 'fees-fail': 'claim' }));
  await page.getByTestId('fees-entry').click();
  await page.getByTestId('fees-dialog').getByTestId('eth-disconnect').click();
  await expect(page.getByTestId('fees-dialog').getByTestId('fees-restore')).toBeAttached();
  await connectTestWallet(page);
  await unnamed(page, l1);
  await sepoliaUsdc(page);
  await expect(page.getByTestId('fees-go')).toBeDisabled();
  const saved = await saving(page, 'fees-save', testInfo.outputPath('e.json'));
  files.push(saved);
  await page.getByTestId('fees-go').click();
  await expect(page.getByTestId('fees-step-message')).toHaveAttribute('data-state', 'running');
  const pre = before.stop();
  everything.push(...pre.all);
  expect(
    settled(pre.same, app).filter((r) => !base.same.includes(r)),
    'e before the reload',
  ).toEqual([]);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: app, storageTypes: 'all' });
  const after = watch(page, app);
  await page.reload();
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  await observeLanded(page);
  await page.getByTestId('fees-entry').click();
  await page.getByTestId('fees-restore').setInputFiles(testInfo.outputPath('e.json'));
  await expect(page.getByTestId('fees-step-message')).toBeVisible();
  await expect(page.getByTestId('fees-failure')).toBeVisible();
  await expect(page.getByTestId('fees-step-claim')).toHaveAttribute('data-state', 'failed');
  await page.getByTestId('fees-retry').click();
  await doneAndDismissed(page);
  const resumed = after.stop();
  everything.push(...resumed.all);
  likeBaseline(resumed, base, app, 'e after the reload');
  const landed = await page.evaluate(() => [
    ...(window as unknown as { __feesSeen: Set<string> }).__feesSeen,
  ]);
  expect(new Set(landed)).toEqual(new Set(['fees-step-swap:done', 'fees-step-deposit:done']));

  // Signed out without the stand-in, the entry rule shows nothing.
  await openAt(page, replay.url({ fees: 'e' }));
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('fees-card')).toHaveCount(0);

  // The wallet's address names the visitor: no request, file or file name carries it, and the wallet was asked to connect only.
  const sentinel = l1.address.slice(2).toLowerCase();
  expect(everything.filter((r) => r.toLowerCase().includes(sentinel))).toEqual([]);
  expect(files.map((f) => `${f.name} ${f.text}`.toLowerCase()).filter((f) => f.includes(sentinel))).toEqual(
    [],
  );
  expect(files.map((f) => f.name)).toEqual([
    expect.stringMatching(/^yacana-fees-\d+-\d+\.json$/),
    expect.any(String),
    expect.any(String),
  ]);
  expect(l1.asked().filter((m) => !CONNECT_ASKS.has(m))).toEqual([]);
});
