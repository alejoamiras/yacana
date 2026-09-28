// Stats as pages of the miner: they load inside the page that mines, read beside it through their own
// quiet clients, and follow its endpoints. Runs in the bridge shard: the Ethereum switch needs a build
// with a portal.
import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { BOOT_MS, bootPage, openDialog, pageUrl, run } from './helpers.ts';

/** The guard's two slots, read where the guard keeps them: the page's own view is what is under test. */
const guardSlots = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis as unknown as Record<symbol, { endpoint: string | null; ethRpc: string | null }>)[
      Symbol.for('yacana.node-guard')
    ];
    return { node: s?.endpoint ?? null, eth: s?.ethRpc ?? null };
  });

/** Overview's wins, from the minted tile's line ("N wins × R · no premine"); NaN while it is unread. */
async function winsOn(page: Page): Promise<number> {
  const line = page.getByTestId('observatory').getByText(/ wins × /);
  const text = (await line.count()) ? await line.textContent() : null;
  return Number(text?.replace(/,/g, '').match(/(\d+) wins/)?.[1] ?? Number.NaN);
}

/** The same RPC under the other loopback name: a second endpoint in front of the same anvil. */
const otherName = (url: string): string => {
  const u = new URL(url);
  u.hostname = u.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return u.href;
};

// The lazy page's chunk: hashed in a build, the source under the dev server; a retry adds a query.
const STATS_CHUNK = /\/(assets\/Stats-[\w-]+\.js|src\/routes\/Stats\.tsx)(\?.*)?$/;

test('Stats inside the miner while it mines: the chunk refused, then loaded; its pages come and go without a reload, the mini window, the proofs or the guard moving; Space scrolls', async ({
  page,
  context,
}) => {
  const r = run();
  await bootPage(page, pageUrl(r));
  let pip: Page | undefined;
  if (await page.evaluate(() => 'documentPictureInPicture' in window)) {
    const popped = context.waitForEvent('page');
    await page.getByTestId('pop-out').click();
    pip = await popped;
    await pip.waitForLoadState();
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText(/^mining/);
  const tickets = page.getByTestId('tickets');
  await expect(tickets).not.toHaveText('0', { timeout: 3 * 60_000 });
  const proofs = await tickets.textContent();
  const slots = await guardSlots(page);
  expect(slots.node).not.toBeNull();
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  // The chunk refused on first opening: the card under the bar, the aside still counting.
  const fetched: string[] = [];
  page.on('request', (req) => {
    if (STATS_CHUNK.test(req.url())) fetched.push(new URL(req.url()).search);
  });
  await page.route(STATS_CHUNK, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.getByTestId('nav-stats').click();
  await expect(page).toHaveURL(/\/stats$/);
  const card = page.getByTestId('stats-unavailable');
  await expect(card).toContainText('Stats could not be fetched. Mining goes on.');
  await expect(card).not.toHaveAttribute('data-redeployed');
  await expect(page.getByTestId('mining-here')).toContainText(/proofs\/min/);
  // The failed URL stays failed for the document: Try again has to fetch the chunk under a new one.
  await page.unroute(STATS_CHUNK);
  await page.getByTestId('stats-retry').click();
  const overview = page.getByTestId('stats');
  await expect(overview).toBeVisible();
  await expect(page.getByTestId('observatory').getByText(/ wins × /)).toBeVisible();
  // stats-view's own classes reach the miner's stylesheet: md:grid-cols-6 is used nowhere else.
  expect(await overview.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(6);

  // Space is the browser's here: the page scrolls and mining goes on.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByTestId('phase')).toHaveText(/^(mining|claiming)/);

  await page.getByTestId('sub-bridge').click();
  await expect(page).toHaveURL(/\/stats\/bridge$/);
  await expect(page.getByTestId('bridge-kpis')).toBeVisible();
  await page.getByTestId('sub-verify').click();
  await expect(page).toHaveURL(/\/stats\/verify$/);
  await expect(page.getByTestId('verify')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('bridge')).toBeVisible();
  await expect(page).toHaveURL(/\/stats\/bridge$/);
  await page.goBack();
  await expect(overview).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('bridge')).toBeVisible();

  await page.getByTestId('nav-mine').click();
  await expect(page.getByTestId('cockpit')).toBeVisible();
  await expect(tickets).not.toHaveText(proofs ?? '', { timeout: 2 * 60_000 });
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  expect(await guardSlots(page)).toEqual(slots);
  if (pip) {
    expect(pip.isClosed()).toBe(false);
    await expect(pip.locator('[data-testid=pip-footer]')).toBeVisible();
  }
  // Opened again: the module loaded by the retry is reused, not fetched a third time.
  await page.getByTestId('nav-stats').click();
  await expect(overview).toBeVisible();
  expect(fetched).toEqual(['', '?retry=1']);
  await page.getByTestId('nav-mine').click();
  await page.getByTestId('stop').click();
});

test('Stats opened during a claim reads nothing until it settles; an Ethereum switch leaves a bridge read held on the old RPC without effect', async ({
  page,
}) => {
  test.setTimeout(20 * 60_000);
  const r = run();
  const bridge = r.bridge;
  if (!bridge) throw new Error('this spec needs a run with a portal (the bridge shard)');
  await bootPage(page, pageUrl(r));

  // Every submission waits until released: the first claim stays out for as long as the test says.
  let releaseSends: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseSends = resolve;
  });
  let sendHeld: () => void = () => {};
  const sending = new Promise<void>((resolve) => {
    sendHeld = resolve;
  });
  const node = new URL(r.nodeUrl).origin;
  await page.route(
    (url) => url.origin === node,
    async (route) => {
      if (!(route.request().postData() ?? '').includes('aztec_sendTx')) return route.fallback();
      sendHeld();
      await released;
      await route.fallback();
    },
  );
  await page.getByTestId('start').click();
  await sending;
  await expect(page.getByTestId('phase')).toHaveText(/^claiming/);

  // First opened while the claim is out: the page stands on its skeletons, nothing read.
  await page.getByTestId('nav-stats').click();
  await expect(page.getByTestId('stats')).toBeVisible();
  await page.waitForTimeout(5_000);
  expect(await page.getByText(/no premine/).count()).toBe(0);
  expect(await page.getByTestId('strip').getAttribute('data-skeleton')).toBe('');
  await expect(page.getByTestId('phase')).toHaveText(/^claiming/);
  releaseSends();
  await expect(page.getByText(/no premine/)).toBeVisible({ timeout: 2 * 60_000 });

  // Mining stopped, so no claim holds Stats back while the old RPC's read is out.
  await page.getByTestId('nav-mine').click();
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('start')).toBeEnabled({ timeout: 3 * 60_000 });

  // Stats' portal read on the old RPC is held; the miner's own reads never call operators().
  const oldRpc = new URL(bridge.l1RpcUrl).href;
  const newRpc = otherName(bridge.l1RpcUrl);
  const OPERATORS = 'e673df8a';
  const held: { route: Route; request: Request; at: number }[] = [];
  let caught: () => void = () => {};
  const holding = new Promise<void>((resolve) => {
    caught = resolve;
  });
  await page.route(
    (url) => url.href === oldRpc,
    (route) => {
      if (!(route.request().postData() ?? '').includes(OPERATORS)) return route.fallback();
      held.push({ route, request: route.request(), at: Date.now() });
      caught();
    },
  );
  const readOnNew = page.waitForEvent('requestfinished', {
    predicate: (req) => req.url() === newRpc && (req.postData() ?? '').includes(OPERATORS),
    timeout: 60_000,
  });
  await page.getByTestId('nav-stats').click();
  await holding;
  await page.getByTestId('sub-bridge').click();
  await page.evaluate(
    (url) =>
      (
        window as unknown as { yacana: { session: { switchEthRpc(u: string): Promise<void> } } }
      ).yacana.session.switchEthRpc(url),
    newRpc,
  );
  await readOnNew;
  await expect(page.getByTestId('bridge-kpis')).toBeVisible();
  const first = held[0] as (typeof held)[number];
  // The hosted client gives a read up after 10 s: the release must come before, or it proves nothing.
  const heldMs = Date.now() - first.at;
  console.log(`[stats-host] the old RPC's read was held ${heldMs} ms`);
  expect(heldMs, 'the held read is still out').toBeLessThan(9_000);
  const failed = page.waitForEvent('requestfailed', {
    predicate: (req) => req === first.request,
    timeout: 5_000,
  });
  await first.route.abort('failed');
  await failed;
  // Counted, not awaited: the successor's next read, 30 s on, would clear what a late publish put there.
  await page.waitForTimeout(3_000);
  expect(await page.getByTestId('bridge-stale').count()).toBe(0);
  expect(await page.getByTestId('bridge-error').count()).toBe(0);
  await expect(page.getByTestId('bridge-kpis')).toBeVisible();
  expect((await guardSlots(page)).eth).toBe(newRpc);
});

test('a node switch while on Stats: the next runtime reads the new node, and nothing is blocked', async ({
  page,
}) => {
  test.setTimeout(20 * 60_000);
  const r = run();
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  // The page starts on A through the saved setting: a query pin would disable Change.
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
  await page.getByTestId('start').click();
  await expect(page.getByTestId('phase')).toHaveText(/^mining/, { timeout: 60_000 });
  await page.getByTestId('nav-stats').click();
  await expect(page.getByTestId('observatory').getByText(/ wins × /)).toBeVisible();
  const before = await winsOn(page);

  // The switch starts in Settings; Stats is open again while it rebuilds, and stays open.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('node-change').click();
  await page.getByTestId('node-url').fill(r.proxyB);
  await page.getByTestId('node-save').click();
  await expect(page.getByTestId('node-stepper')).toContainText(
    'Rebuilding your view of the chain from the new node',
    { timeout: 60_000 },
  );
  await page.getByTestId('nav-stats').click();
  const b = new URL(r.proxyB).href;
  await expect.poll(async () => (await guardSlots(page)).node, { timeout: 5 * 60_000 }).toBe(b);
  // Past what the page held when the switch ended: a claim minted since, which only a runtime reading
  // after the switch can show, through the one node the guard now admits.
  const settled = await winsOn(page);
  const floor = Number.isNaN(settled) ? before : Math.max(before, settled);
  // The error card at any point is the answer: a runtime left on A reads nothing the guard lets out.
  const card = page.getByTestId('boot-error');
  const refused = card.waitFor().then(
    async () => `Stats could not read: ${await card.innerText()}`,
    () => null,
  );
  const read = expect
    .poll(() => winsOn(page), { timeout: 10 * 60_000, intervals: [5_000] })
    .toBeGreaterThan(floor)
    .then(() => null);
  expect(await Promise.race([read, refused])).toBeNull();
  await expect(page).toHaveURL(/\/stats$/);
  expect(await card.count()).toBe(0);
  expect(await page.getByText(/blocked endpoint/).count()).toBe(0);
});

test('a direct visit to Stats before the preflight points the guard at the node: Stats waits for it, then reads', async ({
  page,
}) => {
  const r = run();
  // The preflight's first await held for five seconds: Stats mounts while the guard has no node.
  await page.addInitScript(() => {
    const databases = IDBFactory.prototype.databases;
    IDBFactory.prototype.databases = function (this: IDBFactory) {
      return new Promise<void>((resolve) => setTimeout(resolve, 5_000)).then(() => databases.call(this));
    };
  });
  await page.goto(pageUrl(r).replace('/?', '/stats?'));
  await expect(page.getByTestId('stats')).toBeVisible();
  expect((await guardSlots(page)).node, 'the guard was on its node already: nothing to wait for').toBeNull();
  const card = page.getByTestId('boot-error');
  await expect(page.getByText(/no premine/).or(card)).toBeVisible({ timeout: 2 * 60_000 });
  expect(await card.count()).toBe(0);
});
