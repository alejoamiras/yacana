// Shared by the specs: the run record, page URLs, the virtual authenticator, the key screen.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CDPSession, expect, type Page } from '@playwright/test';
import { type E2eRun, RUN_FILE } from './run.ts';

/** The page's E2E hooks (main.tsx); only what the specs use. */
declare global {
  interface Window {
    yacana?: {
      crashProver(): void;
      log(): string[];
      proverless: boolean;
      tamperNextClaim(): void;
      retryPendingClaim(): Promise<boolean>;
      session: { publicBalance(owner: string): Promise<bigint> };
      controller():
        | {
            lastClaim?: {
              txHash: string;
              nullifiers: string[];
              noteHashes: string[];
              ticketNullifier: string;
              prover?: string;
            };
          }
        | undefined;
    };
  }
}

export const run = (): E2eRun => JSON.parse(readFileSync(RUN_FILE, 'utf8')) as E2eRun;
/**
 * The page for this run. Presto is switched off unless a spec asks for it (`presto: 'on'` uses the
 * lane's port the build carries; a port number points elsewhere): the browser-prover regressions stay
 * on WASM while a headless Presto serves the run.
 */
export const pageUrl = (r: E2eRun, extra: Record<string, string> = {}) => {
  const q: Record<string, string> = {
    node: r.nodeUrl,
    miner: r.miner,
    token: r.token,
    presto: 'off',
    ...extra,
  };
  if (q.presto === 'on') delete q.presto;
  return `${r.baseURL}/?${new URLSearchParams(q)}`;
};

export const BOOT_MS = 8 * 60_000; // CRS verification, wallet + PXE boot, bb.js init

/** With `E2E_SHOTS` naming a directory, the page at this moment as `<name>.png` there: the built screens, for the eye. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // A sheet slides in over 200 ms; the picture is of the moment settled.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** A CTAP2.1 platform authenticator with PRF that confirms every touch by itself. */
export async function virtualAuthenticator(
  page: Page,
): Promise<{ cdp: CDPSession; id: string; remove: () => Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    id: authenticatorId,
    remove: async () => {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    },
  };
}

/**
 * The account dialog over the signed-out cockpit: open by itself on a device with an account, else
 * through the balance tile's Log in (no mining intent: the specs press Start themselves).
 */
export async function openDialog(page: Page): Promise<void> {
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  const screen = page.getByTestId('key-screen');
  if (!(await screen.isVisible())) await page.getByTestId('sign-in-balance').click();
  await expect(screen).toBeVisible({ timeout: 10_000 });
}

/**
 * The dialog's sideways overflow with the running step's right cell reading `text`. The text node's
 * data is swapped and restored inside one task: React keeps its node and no render lands between.
 */
export const dialogOverflowWithRight = (page: Page, text: string): Promise<number> =>
  page.evaluate((long) => {
    const d = document.querySelector('[data-testid=sign-in]') as HTMLElement;
    const node = d.querySelector('[data-state=active] [data-slot=step-right]')?.firstChild as Text;
    const was = node.data;
    node.data = long;
    const over = d.scrollWidth - d.clientWidth;
    node.data = was;
    return over;
  }, text);

/** Horizontal overflow, in px, of the page and of the account dialog's own box; none is ≤ 0. */
export const dialogOverflow = (page: Page): Promise<{ page: number; inner: number }> =>
  page.evaluate(() => {
    const d = document.querySelector('[data-testid=sign-in]') as HTMLElement;
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inner: d.scrollWidth - d.clientWidth,
    };
  });

export async function passKeyScreen(page: Page): Promise<void> {
  await openDialog(page);
  const open = page.getByTestId('open-key');
  if (await open.isVisible()) return open.click();
  await page.getByTestId('start-create').click();
  await page.getByTestId('consent').check();
  await page.getByTestId('create-passkey').click();
}

/**
 * The hold gesture on a HoldButton, released once its fill reads full: the fill runs on the frame clock,
 * and a page busy after a reload drops frames, so a fixed wait can release early and only reveal the click path.
 */
export async function holdThrough(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  const box = (await button.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(button.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await page.mouse.up();
}

/** Sign out from the Wallet's account tile: the dialog, the hold; the page reloads signed out. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Wallet' }).click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('sign-out-dialog')).toBeVisible();
  await holdThrough(page, 'sign-out-hold');
  // The page reloads onto a device without an account: the cockpit first, the dialog on the click.
  await openDialog(page);
}

export async function bootPage(
  page: Page,
  url: string,
): Promise<Awaited<ReturnType<typeof virtualAuthenticator>>> {
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  const auth = await virtualAuthenticator(page);
  await page.goto(url);
  await passKeyScreen(page);
  await expect(page.getByTestId('account')).toBeVisible({ timeout: BOOT_MS });
  await logOpening(page);
  return auth;
}

/** The session's `opened:` line (the keys and notes steps' durations), for the run's log. */
export async function logOpening(page: Page): Promise<void> {
  const lines = await page.evaluate(() => window.yacana?.log() ?? []);
  const line = lines.reverse().find((l) => l.includes('opened:'));
  if (line) console.log(`[opening] ${line}`);
}
