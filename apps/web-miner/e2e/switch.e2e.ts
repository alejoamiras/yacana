import { expect, type Page, test } from './fixtures.ts';
import { BOOT_MS, openDialog, run } from './helpers.ts';

const stats = async (proxy: string) => (await (await fetch(`${proxy}/__stats`)).json()) as { count: number };
const setMode = (proxy: string, mode: 'ok' | 'down' | 'foreign') =>
  fetch(`${proxy}/__mode`, { method: 'POST', body: JSON.stringify({ mode }) });

/** Change → the field → Save: the stepper runs the probe and the switch, then the row shows the new node. */
async function changeNode(page: Page, url: string): Promise<void> {
  await page.getByTestId('node-change').click();
  await page.getByTestId('node-url').fill(url);
  await page.getByTestId('node-save').click();
  const stepper = page.getByTestId('node-stepper');
  await expect(stepper).toBeVisible({ timeout: 60_000 });
  await expect(stepper).toContainText('Rebuilding your view of the chain from the new node', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('node-row')).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByTestId('node-in-use')).toHaveText(new URL(url).host);
}

/**
 * The live node switch between two distinct endpoints (two proxies in front of the isolated node),
 * under an open words account while mining: the row's stepper shows, the session survives, a claim
 * lands on the new node, the old node sees nothing more; a node that stops serving turns the chip
 * to `no answer` and raises the banner, and the switch back clears both.
 */
test('a live switch A → B while mining, a claim after it, and the banner on a dead node', async ({
  page,
}) => {
  test.setTimeout(20 * 60_000);
  const r = run();
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  // The page starts on A through the saved setting, not the query pin (a pin would disable Change).
  await page.addInitScript(
    (nodeUrl) => localStorage.setItem('yacana.connection', JSON.stringify({ nodeUrl })),
    r.proxyA,
  );
  await page.goto(`${r.baseURL}/`);
  await openDialog(page);
  await page.getByTestId('start-create').click();
  await page.getByTestId('use-words').click();
  await page.getByTestId('words-skip').click();
  await expect(page.getByTestId('account')).toBeVisible({ timeout: BOOT_MS });
  expect((await stats(r.proxyA)).count).toBeGreaterThan(0);
  expect((await stats(r.proxyB)).count).toBe(0);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText(/mining/, { timeout: 60_000 });

  // Settings → the row shows A in use, healthy, with a block; B is saved and takes over without a reload.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('node-in-use')).toHaveText(new URL(r.proxyA).host);
  await expect(page.getByTestId('node-chip')).toHaveText('healthy', { timeout: 60_000 });
  await expect(page.getByTestId('node-line')).toContainText(/^block [\d,]+ · \d+ s ago/, { timeout: 60_000 });
  // A is a saved node, not the build's: the row says so and offers the default.
  await expect(page.getByTestId('node-row')).toContainText('· custom');
  await expect(page.getByTestId('node-default')).toBeVisible();
  await changeNode(page, r.proxyB);
  // What was in flight at the switch has reached A by now (a batch leaves in several calls); nothing may follow.
  const atSwitch = (await stats(r.proxyA)).count;
  await expect(page.getByTestId('node-row')).toContainText('· custom');
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('yacana.connection') ?? '{}'));
  expect(new URL(saved.nodeUrl).href).toBe(new URL(r.proxyB).href);

  // The session survived the switch (no reload, the same account) and mining carries on, on B.
  await page.getByRole('link', { name: 'Mine' }).click();
  await expect(page.getByTestId('account')).toBeVisible();
  await expect(page.getByTestId('phase')).toHaveText(/mining/, { timeout: 3 * 60_000 });
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 10 * 60_000 });
  expect((await stats(r.proxyA)).count).toBe(atSwitch);
  expect((await stats(r.proxyB)).count).toBeGreaterThan(20);

  // B stops serving: the banner names it and the row's chip says so; back to A and both go.
  await setMode(r.proxyB, 'down');
  const banner = page.getByTestId('node-banner');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(banner).toHaveAttribute('data-kind', /silent|throttled|stale/);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('node-chip')).toContainText(/no answer|throttled/, { timeout: 60_000 });
  await changeNode(page, r.proxyA);
  await expect(page.getByTestId('node-banner')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('node-chip')).toHaveText('healthy', { timeout: 60_000 });
});

test('another deployment’s node, or one that does not answer, is refused under the field; the node in use is kept', async ({
  page,
}) => {
  const r = run();
  await page.addInitScript(
    (nodeUrl) => localStorage.setItem('yacana.connection', JSON.stringify({ nodeUrl })),
    r.proxyA,
  );
  await page.goto(`${r.baseURL}/`);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('node-in-use')).toHaveText(new URL(r.proxyA).host, { timeout: BOOT_MS });
  // Proxy B reports another rollup: reachable, but not this deployment's.
  await setMode(r.proxyB, 'foreign');
  await page.getByTestId('node-change').click();
  await page.getByTestId('node-url').fill(r.proxyB);
  await page.getByTestId('node-save').click();
  await expect(page.getByTestId('node-error')).toContainText(
    /Not this deployment's node \(it serves rollup 0x[0-9a-f]+\)\. Kept /,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('node-error')).toContainText(`Kept ${new URL(r.proxyA).host}.`);
  await setMode(r.proxyB, 'ok');
  // The run's claimed, never-listened-on port: reachable is where it fails.
  await page.getByTestId('node-url').fill(`http://127.0.0.1:${r.closedPort}`);
  await page.getByTestId('node-save').click();
  await expect(page.getByTestId('node-error')).toContainText(`Kept ${new URL(r.proxyA).host}.`, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('node-url')).toHaveValue(`http://127.0.0.1:${r.closedPort}/`);
  await page.getByTestId('node-cancel').click();
  await expect(page.getByTestId('node-in-use')).toHaveText(new URL(r.proxyA).host);
});
