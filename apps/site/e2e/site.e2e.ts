import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { type E2eRun, RUN_FILE } from './run.ts';

const run = (): E2eRun => JSON.parse(readFileSync(RUN_FILE, 'utf8')) as E2eRun;
/** The smallest file of the pinned CRS the miner fetches from `/crs` (`crs.lock.json`). */
const CRS_FILE = 'g2.dat';

const query = (r: E2eRun) =>
  `?${new URLSearchParams({ node: r.nodeUrl, miner: r.miner, token: r.token }).toString()}`;

const POLICY = [
  'strict-transport-security',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'content-security-policy',
  'permissions-policy',
  'x-content-type-options',
  'referrer-policy',
];

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[console] ${m.text().slice(0, 300)}`));
});

test('one origin, three apps: every path serves its app under the same headers; build.json says e2e', async ({
  page,
  request,
}) => {
  const r = run();
  const build = await (await request.get(`${r.baseURL}/build.json`)).json();
  expect(build).toMatchObject({ mode: 'e2e', rpId: 'localhost', nodeOrigin: new URL(r.nodeUrl).origin });
  expect(build.commit).toMatch(/^[0-9a-f]{40}$/);

  const headersOf = async (path: string) => {
    const res = await request.get(`${r.baseURL}${path}`);
    expect(res.status(), path).toBe(200);
    return Object.fromEntries(POLICY.map((h) => [h, res.headers()[h]]));
  };
  const reference = await headersOf('/');
  for (const h of POLICY) expect(reference[h], h).toBeTruthy();
  // The node is a setting the policy cannot name: any https origin, the local forms only in this e2e build.
  const csp = reference['content-security-policy'] as string;
  expect(csp).toContain("connect-src 'self' data: https: http://127.0.0.1:* http://localhost:*");
  expect(csp).toContain("webrtc 'block'");
  expect(csp).not.toContain(new URL(r.nodeUrl).origin);
  for (const path of [
    '/mine/wallet',
    '/mine/stats',
    '/mine/stats/bridge',
    '/mine/stats/verify',
    '/stats?epoch=0',
    '/stats/bridge',
    '/verify',
    '/faq',
    '/slots/0.json',
    '/artifacts/yacana_work.json',
  ])
    expect(await headersOf(path), path).toEqual(reference);

  await page.goto(`${r.baseURL}/${query(r)}`);
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByTestId('live-epoch')).toHaveText('0 of 4');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.goto(`${r.baseURL}/mine/wallet${query(r)}`);
  // The miner boots under the /mine/wallet path (the SPA fallback), then goes to the cockpit: no
  // account on this profile, so the wallet has nothing to show; the balance tile's Log in opens the dialog.
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: 2 * 60_000 });
  await expect(page.getByTestId('phase')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/mine/');
  await page.getByTestId('sign-in-balance').click();
  await expect(page.getByTestId('key-screen')).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  // The miner's own Stats: each path is its page, served by the miner's app, cross-origin isolated.
  for (const [path, shown] of [
    ['/mine/stats', 'stats'],
    ['/mine/stats/bridge', 'no-bridge'],
    ['/mine/stats/verify', 'verify'],
    ['/mine/stats/', 'stats'],
  ] as const) {
    await page.goto(`${r.baseURL}${path}${query(r)}`);
    await expect(page.getByTestId(shown), path).toBeVisible({ timeout: 2 * 60_000 });
    expect(new URL(page.url()).pathname, path).toBe(path);
    expect(await page.evaluate(() => crossOriginIsolated), path).toBe(true);
  }

  await page.goto(`${r.baseURL}/stats${query(r)}&epoch=0`);
  await expect(page.getByTestId('detail')).toContainText('epoch 0');
  await page.goto(`${r.baseURL}/verify${query(r)}`);
  await expect(page.getByTestId('verify')).toBeVisible();
  await expect(page.getByTestId('verify-miner')).toHaveText(r.miner);
  // The FAQ is the landing's page at the root; the stats app's bridge route is its own page.
  await page.goto(`${r.baseURL}/faq${query(r)}`);
  await expect(page.getByTestId('faq-panel')).toHaveCount(6);
  expect(new URL(page.url()).pathname).toBe('/faq');
  await page.goto(`${r.baseURL}/stats/bridge${query(r)}`);
  await expect(page.getByTestId('no-bridge')).toBeVisible();
});

test('the versioned origin: the old role under the same headers, restore only, and an open tab learns it is behind', async ({
  page,
  request,
}) => {
  const r = run();
  // Browsers resolve `*.localhost` themselves; Node asks the system, which need not know the name.
  // The old origin is its own server on its own port, so Node reaches it as `localhost`.
  const fromNode = (base: string) => base.replace('//v5.localhost', '//localhost');
  const build = async (base: string) => (await request.get(`${fromNode(base)}/build.json`)).json();
  const apex = await build(r.baseURL);
  const old = await build(r.oldBaseURL);
  expect(apex).toMatchObject({ mode: 'e2e', role: 'apex', miner: r.miner });
  expect(old).toMatchObject({ mode: 'e2e', role: 'old', miner: r.miner, rollupVersion: apex.rollupVersion });
  // One policy for both origins, byte for byte.
  const headersOf = async (base: string, path: string) => {
    const res = await request.get(`${fromNode(base)}${path}`);
    expect(res.status(), `${base}${path}`).toBe(200);
    return Object.fromEntries(POLICY.map((h) => [h, res.headers()[h]]));
  };
  for (const path of ['/', '/mine/wallet', '/stats'])
    expect(await headersOf(r.oldBaseURL, path), path).toEqual(await headersOf(r.baseURL, path));

  // The old origin's miner: retired (no Start), no dialog on arrival, and the dialog restores, never creates.
  await page.goto(`${r.oldBaseURL}/mine/${query(r)}`);
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: 2 * 60_000 });
  await expect(page.getByTestId('retired')).toContainText('Send what’s still here ahead.');
  await expect(page.getByTestId('start')).toHaveCount(0);
  await expect(page.getByTestId('key-screen')).toBeHidden();
  await page.getByTestId('sign-in-mine').click();
  await expect(page.getByTestId('key-screen')).toBeVisible();
  await expect(page.getByTestId('create-passkey')).toHaveCount(0);
  await expect(page.getByTestId('restore-passkey')).toBeEnabled();

  // A tab left open across a redeploy: build.json now names another miner; the next check says reload.
  await page.goto(`${r.baseURL}/mine/${query(r)}`);
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: 2 * 60_000 });
  await expect(page.getByTestId('old-tab')).toHaveCount(0);
  const record = new URL('./.dist/build.json', import.meta.url).pathname;
  const before = readFileSync(record, 'utf8');
  try {
    writeFileSync(record, JSON.stringify({ ...apex, miner: `0x${'1'.repeat(64)}` }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('old-tab')).toContainText('This tab is behind.', { timeout: 30_000 });
  } finally {
    writeFileSync(record, before);
  }
});

test('the landing serves no prover; the miner still does', async ({ page, request }) => {
  const r = run();
  // The landing's HTML and its assets name nothing of bb.js or a WASM binary.
  const html = await (await request.get(`${r.baseURL}/`)).text();
  expect(html).not.toMatch(/barretenberg|\.wasm/);
  const heavy: string[] = [];
  page.on('request', (req) => {
    if (/barretenberg|\.wasm(\?|$)/.test(req.url())) heavy.push(req.url());
  });
  await page.goto(`${r.baseURL}/${query(r)}`);
  await expect(page.getByTestId('hero-live')).toBeVisible();
  await expect(page.getByTestId('live-epoch')).toHaveText('0 of 4');
  await expect(page.getByTestId('ledger-public')).toContainText('—');
  expect(heavy).toEqual([]);
  // The miner's CRS is still there at the origin's root.
  const crs = await request.get(`${r.baseURL}/crs/${CRS_FILE}`);
  expect(crs.status()).toBe(200);
  expect((await crs.body()).length).toBe(128);
});
