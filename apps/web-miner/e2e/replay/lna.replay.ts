// The local-network permission for real, the way Presto's own harness does it: Chromium is told the
// page's loopback origin is public, so its fetch to a Presto on 127.0.0.1 is a genuine public → loopback
// request with the browser's gate in front of it. A counting fake stands for Presto; the evidence is its
// hit count under each permission state, and the card's standing.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { BOOT_MS } from '../helpers.ts';
import { expect, type Page, test } from './fixtures.ts';
import { REPLAY_RUN_FILE, type ReplayRun } from './run.ts';

const run = JSON.parse(readFileSync(REPLAY_RUN_FILE, 'utf8')) as ReplayRun;
const app = new URL(run.baseURL);
/** The page by IP: the override below names the endpoint that served it, which `localhost` (::1 here) would not. */
const origin = `http://127.0.0.1:${app.port}`;

test.use({
  launchOptions: {
    // The endpoint that served the page is declared public: every fetch to loopback crosses the boundary.
    args: ['--disable-dev-shm-usage', `--ip-address-space-overrides=127.0.0.1:${app.port}=public`],
  },
});

/** A current Presto that only answers `/health`, counting every request that reaches it (preflights included). */
function fakePresto(): Promise<{ server: Server; port: number; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-private-network', 'true');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.url?.startsWith('/health')) {
      res.setHeader('content-type', 'application/json');
      return void res.end(
        JSON.stringify({ status: 'ok', api_version: 1, schemes: ['chonk', 'ultra_honk'], version: '1.2.1' }),
      );
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      ok({ server, port, hits: () => hits });
    }),
  );
}

const REMEMBERED = () => localStorage.setItem('yacana.presto', JSON.stringify({ used: true, rev: 0 }));

/** The signed-out Start: the key screen opens and is dismissed; the session's Start ran either way. */
async function start(page: Page): Promise<void> {
  await page.getByTestId('sign-in-mine').click();
  await expect(page.getByTestId('key-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('key-screen')).toHaveCount(0);
}

const card = (page: Page) => page.getByTestId('presto-card');

/** The fixture's page URL on the IP origin, which its routing is told to admit. */
function at(
  replay: { url: (q?: Record<string, string>) => string; allow: (o: string) => void },
  q?: Record<string, string>,
) {
  replay.allow(origin);
  return replay.url(q).replace(app.origin, origin);
}

/** The permission as the page reads it: the split descriptor first, the legacy one when the split is unknown. */
const permissionState = (page: Page) =>
  page.evaluate(async () => {
    for (const name of ['loopback-network', 'local-network-access']) {
      try {
        const s = await navigator.permissions.query({ name: name as PermissionName });
        return { name, state: s.state };
      } catch {
        /* unknown descriptor */
      }
    }
    return null;
  });

test('the boundary is real: a secure context, targetAddressSpace, the descriptor that answers, and a fresh context reads prompt', async ({
  page,
  replay,
  browserName,
}) => {
  await page.goto(at(replay));
  await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
  const facts = await page.evaluate(() => ({
    secure: window.isSecureContext,
    targetAddressSpace: 'targetAddressSpace' in Request.prototype,
    userAgent: navigator.userAgent,
  }));
  const descriptor = await permissionState(page);
  const line = `${browserName} ${facts.userAgent} · descriptor ${JSON.stringify(descriptor)} · secure ${facts.secure} · targetAddressSpace ${facts.targetAddressSpace}`;
  test.info().annotations.push({ type: 'lna', description: line });
  console.log(`lna: ${line}`);
  expect(facts.secure).toBe(true);
  expect(facts.targetAddressSpace).toBe(true);
  expect(descriptor?.state).toBe('prompt');
});

test('under prompt nothing reaches Presto: load, Start, remembered or not', async ({ page, replay }) => {
  const fake = await fakePresto();
  replay.allow(`https://127.0.0.1:${fake.port}`);
  replay.allow(`http://127.0.0.1:${fake.port}`);
  try {
    await page.goto(at(replay, { presto: String(fake.port) }));
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    await start(page);
    await expect(card(page)).toHaveAttribute('data-standing', 'ask');
    await page.waitForTimeout(2000);
    expect(fake.hits()).toBe(0);
    // Remembered from an earlier visit: still no probe while the browser would prompt; the card asks for the click.
    await page.context().addInitScript(REMEMBERED);
    await page.reload();
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    await start(page);
    await expect(card(page)).toHaveAttribute('data-standing', 'remembered');
    await expect(page.getByTestId('presto-look')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(fake.hits()).toBe(0);
  } finally {
    fake.server.close();
  }
});

test('denied with Presto remembered: zero hits, and the card reads blocked', async ({ page, replay }) => {
  const fake = await fakePresto();
  replay.allow(`https://127.0.0.1:${fake.port}`);
  replay.allow(`http://127.0.0.1:${fake.port}`);
  try {
    // CDP's grant denies every permission left out of the list.
    await page.context().grantPermissions([], { origin });
    await page.context().addInitScript(REMEMBERED);
    await page.goto(at(replay, { presto: String(fake.port) }));
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    expect((await permissionState(page))?.state).toBe('denied');
    await start(page);
    await expect(card(page)).toHaveAttribute('data-standing', 'blocked');
    await page.waitForTimeout(2000);
    expect(fake.hits()).toBe(0);
    // The browser's own gate, not the page's reading of it: a Look under denied reaches nothing.
    await page.getByTestId('presto-look').click();
    await page.waitForTimeout(3000);
    expect(fake.hits()).toBe(0);
    await expect(card(page)).toHaveAttribute('data-standing', 'blocked');
  } finally {
    fake.server.close();
  }
});

test('prompt, then Look: the request waits for a grant in the same context, and the card reads found without a reload', async ({
  page,
  replay,
}) => {
  const fake = await fakePresto();
  replay.allow(`https://127.0.0.1:${fake.port}`);
  replay.allow(`http://127.0.0.1:${fake.port}`);
  try {
    await page.goto(at(replay, { presto: String(fake.port) }));
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    await page.getByTestId('presto-look').click();
    // The prompt holds the request: nothing reaches the fake, and the SDK's bounded check gives up on it.
    await expect(card(page)).toHaveAttribute('data-standing', 'absent', { timeout: 30_000 });
    expect(fake.hits()).toBe(0);
    expect((await permissionState(page))?.state).toBe('prompt');
    // The grant fires `change`; the click already given is asked again, no reload.
    await page.context().grantPermissions(['local-network-access'], { origin });
    await expect(card(page)).toHaveAttribute('data-standing', 'found', { timeout: 30_000 });
    expect(fake.hits()).toBeGreaterThan(0);
    expect((await permissionState(page))?.state).toBe('granted');
  } finally {
    fake.server.close();
  }
});

test('granted with Presto remembered: a reload probes silently, exactly once', async ({ page, replay }) => {
  const fake = await fakePresto();
  replay.allow(`https://127.0.0.1:${fake.port}`);
  replay.allow(`http://127.0.0.1:${fake.port}`);
  try {
    await page.context().grantPermissions(['local-network-access'], { origin });
    await page.context().addInitScript(REMEMBERED);
    await page.goto(at(replay, { presto: String(fake.port) }));
    await expect(page.getByTestId('cockpit')).toBeVisible({ timeout: BOOT_MS });
    await expect(card(page)).toHaveAttribute('data-standing', 'remembered');
    expect(fake.hits()).toBe(0);
    await start(page);
    await expect(card(page)).toHaveAttribute('data-standing', 'found', { timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect(fake.hits()).toBe(1);
  } finally {
    fake.server.close();
  }
});
