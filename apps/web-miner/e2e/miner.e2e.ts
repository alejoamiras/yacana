import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from './fixtures.ts';
import { BOOT_MS, bootPage, pageUrl, passKeyScreen, run } from './helpers.ts';

// RSS of the browser's process tree, sampled from `ps`; Playwright's Chromium is the one whose
// command line carries its temporary profile directory. `peakMiB` is the highest sample, `nowMiB`
// the latest: a leak shows in the steady state, a peak also counts the old backend's memory before
// the collector returns it.
function rssWatcher(): { peakMiB: () => number; nowMiB: () => number; stop: () => void } {
  let peak = 0;
  let now = 0;
  const sample = () => {
    try {
      const rows = execSync('ps -eo pid=,ppid=,rss=,args=', { encoding: 'utf8' }).split('\n');
      const roots = rows
        .filter((l) => l.includes('playwright_chromiumdev_profile'))
        .map((l) => Number(l.trim().split(/\s+/)[0]));
      const byParent = new Map<number, number[]>();
      const rss = new Map<number, number>();
      for (const l of rows) {
        const [pid, ppid, kb] = l.trim().split(/\s+/).map(Number) as [number, number, number];
        rss.set(pid, kb);
        byParent.set(ppid, [...(byParent.get(ppid) ?? []), pid]);
      }
      const seen = new Set<number>();
      let total = 0;
      const stack = [...roots];
      while (stack.length) {
        const p = stack.pop() as number;
        if (seen.has(p)) continue;
        seen.add(p);
        total += rss.get(p) ?? 0;
        stack.push(...(byParent.get(p) ?? []));
      }
      now = total;
      peak = Math.max(peak, total);
    } catch {
      /* ps hiccup */
    }
  };
  const timer = setInterval(sample, 500);
  const mib = (kb: number) => Math.round(kb / 1024);
  return {
    peakMiB: () => mib(peak),
    nowMiB: () => {
      sample();
      return mib(now);
    },
    stop: () => clearInterval(timer),
  };
}

/** Collects garbage in the page and lets the process tree settle before a memory sample. */
async function settled(page: Page, memory: { nowMiB: () => number }): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  await page.waitForTimeout(3000);
  return memory.nowMiB();
}

test('first visit creates an account, mines at the easy target, claims and shows the balance', async ({
  page,
}) => {
  const r = run();
  const memory = rssWatcher();
  await bootPage(page, pageUrl(r));
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.getByTestId('balance')).toHaveText('0');
  await expect(page.getByTestId('balance').locator('xpath=..')).toHaveText(/^0\s*tYACA$/);
  // The M1 frame at 1280 (the default viewport) and 1440: 1080 wide, three equal tracks and the
  // 300-px rail; between md and xl two equal columns, the rail beside the stacked ledger and balance tile.
  const cockpit = page.getByTestId('cockpit');
  const tracks = () => cockpit.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  const width = () => cockpit.evaluate((el) => el.getBoundingClientRect().width);
  // The balance right of the loop and the rail under it, one column; the KPIs and the ledger under the loop, as wide.
  const placed = () =>
    cockpit.evaluate((el) => {
      const [loop, right, kpis, ledger] = Array.from(el.children) as HTMLElement[];
      const box = (n: Element | null | undefined) => (n as Element).getBoundingClientRect();
      const [l, balance, rail, k, g] = [
        loop,
        right?.firstElementChild,
        right?.lastElementChild,
        kpis,
        ledger,
      ].map(box);
      const near = (a: number, b: number) => Math.abs(a - b) <= 1;
      return (
        balance.left > l.right &&
        near(balance.top, l.top) &&
        rail.top > balance.bottom &&
        near(rail.left, balance.left) &&
        k.top > l.bottom &&
        near(k.left, l.left) &&
        near(k.right, l.right) &&
        g.top > k.bottom &&
        near(g.right, l.right)
      );
    });
  expect(await tracks()).toBe('246px 246px 246px 300px');
  expect(await width()).toBe(1080);
  expect(await placed()).toBe(true);
  await page.setViewportSize({ width: 1024, height: 900 });
  const half = `${(((await width()) - 14) / 2).toString()}px`;
  expect(await tracks()).toBe(`${half} ${half}`);
  // Between md and xl the column dissolves: the rail beside the balance, the ledger under the balance.
  expect(
    await cockpit.evaluate((el) => {
      const [, right, , ledger] = Array.from(el.children) as HTMLElement[];
      const [balance, rail] = Array.from((right as HTMLElement).children).map((c) =>
        c.getBoundingClientRect(),
      );
      const g = (ledger as HTMLElement).getBoundingClientRect();
      return (
        balance !== undefined &&
        rail !== undefined &&
        rail.top === balance.top &&
        rail.left >= balance.right &&
        g.top > balance.bottom
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await tracks()).toBe('246px 246px 246px 300px');
  expect(await width()).toBe(1080);
  expect(await placed()).toBe(true);
  // The loop tile's height is fixed: the claim lives on the loop's chip and its win line, never in a slot.
  const loopHeight = () =>
    cockpit.evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().height);
  const idleHeight = await loopHeight();
  await expect(page.getByTestId('claim-chip')).toHaveCount(0);
  await page.getByTestId('start').click();
  // The pill's suffix follows what proves (✦ presto beside the run's headless Presto): the word alone is the phase.
  await expect(page.getByTestId('phase')).toHaveText(/^mining/);
  // The easy target wins every other proof; the claim is then proved in-page and mined.
  await expect(page.getByTestId('phase')).toHaveText(/^claiming/, { timeout: 5 * 60_000 });
  await expect(page.getByTestId('claim-chip')).toContainText(/claiming · \w+/);
  expect(await loopHeight()).toBe(idleHeight);
  const balanceTile = page.getByTestId('right-column').locator('> *').first();
  const tileHeight = () => balanceTile.evaluate((el) => el.getBoundingClientRect().height);
  const balanceHeight = await tileHeight();
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 10 * 60_000 });
  await expect(page.getByTestId('balance')).toHaveText('4');
  // The mint line under the number, on a line the tile had reserved: no height change.
  await expect(page.getByTestId('mint-line')).toHaveText('+4 tYACA · just now');
  expect(await tileHeight()).toBe(balanceHeight);
  await expect(page.getByTestId('epoch-claims')).toHaveText('1 of 4');
  expect(await loopHeight()).toBe(idleHeight);
  const ledger = page.getByTestId('ledger');
  await expect(ledger).toContainText(/minted in block [\d,]+↗ \(opens in a new tab\) · 4 tYACA, privately/);
  // The newest line: at this easy target a second claim can have minted by now, and each line links.
  await expect(ledger.getByRole('link', { name: /block/ }).first()).toHaveAttribute('href', /\/blocks\/\d+$/);
  await expect(ledger.getByRole('link', { name: /effects/ }).first()).toHaveAttribute(
    'href',
    /\/tx-effects\/0x[0-9a-f]{64}$/,
  );
  // Mining resumes on its own after a claim; stop it cleanly (at this easy target the next win can be in
  // flight already: Stop returns once that claim has minted). The ✓ outlives the stop by its ten seconds.
  await page.getByTestId('stop').click({ timeout: 5 * 60_000 });
  await expect(page.getByTestId('phase')).toHaveText(/^idle/);
  await expect(page.getByTestId('claim-chip')).toHaveCount(0, { timeout: 15_000 });
  // Each win renews the line, and at this target they keep coming: only with mining stopped does it end,
  // ten seconds after the last one.
  await expect(page.getByTestId('mint-line')).toHaveText('', { timeout: 15_000 });
  expect(await tileHeight()).toBe(balanceHeight);
  // The nav reaches the stats app on the same origin.
  await expect(page.getByTestId('nav-stats')).toHaveAttribute('href', /\/stats\/$/);
  // At this easy target more than one claim can have minted before Stop landed: what the first visit
  // holds is whatever it claimed, and the second visit must add exactly one more.
  const minted = Number(await page.getByTestId('claims').textContent());
  expect(minted).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('balance')).toHaveText(String(4 * minted));
  // Second visit: the persisted account signs again and its notes are still there.
  const account = await page.getByTestId('account').getAttribute('title');
  await page.reload();
  await passKeyScreen(page);
  await expect(page.getByTestId('account')).toBeVisible({ timeout: BOOT_MS });
  expect(await page.getByTestId('account').getAttribute('title')).toBe(account);
  await expect(page.getByTestId('balance')).toHaveText(String(4 * minted));
  // The claims history is this device's, restored under the account: the next claim adds to it.
  await page.getByTestId('start').click();
  await expect(page.getByTestId('claims')).toHaveText(String(minted + 1), { timeout: 10 * 60_000 });
  // The claim's own balance read can land before this visit's PXE has synced the new note; the poll
  // publishes it a few reads later. On a slow machine that is minutes, not the default's one minute.
  await expect(page.getByTestId('balance')).toHaveText(String(4 * (minted + 1)), { timeout: 5 * 60_000 });
  await page.getByTestId('stop').click();
  memory.stop();
  console.log(`peak browser process-tree RSS: ${memory.peakMiB()} MiB`);
  writeFileSync(
    new URL('./.peak-rss.json', import.meta.url).pathname,
    JSON.stringify({ peakMiB: memory.peakMiB() }),
  );
  expect(memory.peakMiB()).toBeGreaterThan(0);
});

test('a poisoned CRS cache is purged before proving', async ({ page }) => {
  const r = run();
  // bb.js prefers its idb-keyval cache (32 MiB of uncompressed G1 points) over any download; fill it
  // with zeros before the page runs. Proving with it would fail; the page must purge it.
  await page.addInitScript(() => {
    if ((window as { __poisoned?: boolean }).__poisoned) return;
    (window as { __poisoned?: boolean }).__poisoned = true;
    const req = indexedDB.open('keyval-store', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put(new Uint8Array(2 ** 19 * 64), 'g1Data');
      tx.objectStore('keyval').put(new Uint8Array(128), 'g2Data');
    };
  });
  await bootPage(page, pageUrl(r));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 10 * 60_000 });
  await page.getByTestId('stop').click();
});

// Power changes rebuild bb.js in place; the job resumes at its next nonce. The process tree must
// not keep the old backends: growth above 300 MiB over three rebuilds means a leak (then the
// fallback is a Worker respawn per change).
test('three power changes keep mining, the ledger grows, memory stays bounded', async ({ page }) => {
  const r = run();
  // The hard deployment: no win, so no claim proof (≈ 2 GB on its own) muddies the measurement.
  await bootPage(page, pageUrl(r, { miner: r.hardMiner, token: r.hardToken }));
  const memory = rssWatcher();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText('mining');
  const lines = () => page.getByTestId('ledger').locator('[data-slot=proof-line]');
  await expect(lines()).not.toHaveCount(0, { timeout: 3 * 60_000 });
  const baseline = await settled(page, memory);
  const slider = page.getByRole('slider');
  const max = Number(await slider.getAttribute('max'));
  for (const threads of [Math.max(1, Math.ceil(max / 2)), 1, max]) {
    const before = await lines().count();
    await slider.fill(String(threads));
    await expect(page.getByText(new RegExp(`^${threads} threads?`))).toBeVisible();
    // Attempts keep landing on the rebuilt backend (a claim in between is fine: mining resumes).
    await expect
      .poll(async () => (await lines().count()) - before, { timeout: 5 * 60_000 })
      .toBeGreaterThanOrEqual(2);
  }
  await expect(page.getByTestId('phase')).not.toHaveText('idle');
  const after = await settled(page, memory);
  await page.getByTestId('stop').click();
  memory.stop();
  console.log(
    `RSS baseline ${baseline} MiB, after three rebuilds ${after} MiB (peak ${memory.peakMiB()} MiB)`,
  );
  expect(after - baseline).toBeLessThanOrEqual(300);
});

test('a prover crash surfaces as an error and mining restarts on the next start', async ({ page }) => {
  const r = run();
  await bootPage(page, pageUrl(r));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText('mining');
  await page.evaluate(() => window.yacana?.crashProver());
  await expect(page.getByTestId('miner-error')).toContainText('worker');
  await expect(page.getByTestId('phase')).toHaveText('idle');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText('mining');
  await expect(page.getByTestId('tickets')).not.toHaveText('0', { timeout: 2 * 60_000 });
  await page.getByTestId('stop').click();
});

test('the mini window: page fonts, its own loop, two lines that fit, open across pages; Start opens it when asked, and mines when refused', async ({
  page,
  context,
}) => {
  const r = run();
  await bootPage(page, pageUrl(r));
  const supported = await page.evaluate(() => 'documentPictureInPicture' in window);
  test.skip(!supported, 'Document Picture-in-Picture is not available in this browser build');
  let popped = context.waitForEvent('page');
  await page.getByTestId('pop-out').click();
  let pip = await popped;
  await pip.waitForLoadState();
  // Headless, the window takes the context's viewport; a headed browser gives it the size asked for.
  await pip.setViewportSize({ width: 360, height: 216 });
  await expect(pip.locator('[data-slot=score-loop][data-calm]')).toBeVisible();
  await expect(page.getByTestId('pop-out')).toBeDisabled();
  // A loaded face, not `fonts.check`, which is true for a face that never loaded; and no failed font request.
  const fonts = await pip.evaluate(async () => {
    await document.fonts.ready;
    const loaded = Array.from(document.fonts).filter(
      (f) => f.family.includes('Hanken Grotesk') && f.status === 'loaded',
    ).length;
    const failed = performance
      .getEntriesByType('resource')
      .filter((e) => /\.woff2?(\?|$)/.test(e.name) && (e as PerformanceResourceTiming).responseStatus >= 400);
    return { loaded, failed: failed.map((e) => e.name) };
  });
  expect(fonts.failed).toEqual([]);
  expect(fonts.loaded).toBeGreaterThan(0);
  // The user's numbers, then the network's: two rows, neither wider than the window.
  const fit = await pip.evaluate(() => {
    const footer = document.querySelector('[data-testid=pip-footer]') as HTMLElement;
    const rows = Array.from(footer.children) as HTMLElement[];
    return {
      width: window.innerWidth,
      page: document.documentElement.scrollWidth,
      rows: rows.map((r) => [r.scrollWidth, r.clientWidth, r.getBoundingClientRect().right]),
    };
  });
  console.log(`[pip] ${JSON.stringify(fit)}`);
  expect(fit.width).toBe(360);
  expect(fit.page).toBeLessThanOrEqual(fit.width);
  expect(fit.rows).toHaveLength(2);
  for (const [scroll, client, right] of fit.rows as number[][]) {
    expect(scroll).toBeLessThanOrEqual(client as number);
    expect(right).toBeLessThanOrEqual(fit.width);
  }
  // The shell owns the window: a page change neither closes it nor empties it.
  await page.getByRole('link', { name: 'Wallet' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await page.getByRole('link', { name: 'Mine' }).click();
  await expect(pip.locator('[data-testid=pip-footer]')).toBeVisible();
  expect(pip.isClosed()).toBe(false);
  await pip.close();
  await expect(page.getByTestId('pop-out')).toBeEnabled();

  // Asked for, the Start click opens it; mining starts either way.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: /Open the mini window when mining starts/ }).click();
  await page.getByRole('link', { name: 'Mine' }).click();
  popped = context.waitForEvent('page');
  await page.getByTestId('start').click();
  pip = await popped;
  await expect(page.getByTestId('phase')).toHaveText('mining');
  await pip.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('start')).toBeEnabled({ timeout: 2 * 60_000 });
  await pip.close();
  await page.evaluate(() => {
    const api = (window as unknown as { documentPictureInPicture: { requestWindow: () => Promise<Window> } })
      .documentPictureInPicture;
    api.requestWindow = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
  });
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText('mining');
  await expect(page.getByTestId('pop-out')).toBeEnabled();
  await page.getByTestId('stop').click();
});
