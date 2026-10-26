// The screenshot gate's fixture-only build and server, and the one-off recording it replays.
//   bun e2e/visual-setup.ts record    # under `bun run e2e:agent --`: deploys (the portal on the run's
//                                     # anvil when it has one), records every JSON-RPC answer the pages
//                                     # need — the node's and Ethereum's — into visual-rpc.json (+ the deployment)
//   bun e2e/visual-setup.ts serve     # builds e2e/.visual-dist from the recorded deployment, with a
//                                     # fixed source commit and only chunk 0 of the slot table; serves it
//   bun e2e/visual-setup.ts teardown
// No node and no Ethereum are involved in `serve`: the spec answers the pages' RPC from the recording.
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EthAddress } from '@aztec-labs/aztec.js/addresses';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { type Browser, chromium, type Page, type Route } from '@playwright/test';
import type { BridgeRecord } from '@yacana/bridge/record';
import { deployYacana, TEST_PORTAL } from '@yacana/deploy/deploy';
import { release } from '@yacana/localnet/registry';
import { slotTableToJson } from '@yacana/miner-core/reader';
import { deriveSlotTable, LAYOUTS_PATH, loadLayouts } from '@yacana/miner-core/slots';
import { MOCK_ETH_ORIGIN, MOCK_NODE_ORIGIN } from './helpers.ts';
import { buildApp, claimPreviewPort, mockStorage, pkg, startPreview, waitUntilUp } from './serve.ts';

const OUT_DIR = 'e2e/.visual-dist';
const VISUAL_FILE = resolve(pkg, 'e2e/.visual.json');
const RPC_FILE = resolve(pkg, 'e2e/visual-rpc.json');
const DEPLOYMENT_FILE = resolve(pkg, 'e2e/visual-deployment.json');
/** The record the run's operator registers from; repo-relative for the operator, gitignored. */
const RECORD_FILE = 'apps/web-stats/e2e/.visual-record.json';
/** What the Verify chips and the footer show: the baselines must not move with the commit. */
const VISUAL_COMMIT = '0123456789abcdef0123456789abcdef01234567';

interface VisualDeployment {
  chainId: string;
  rollupVersion: string;
  rollupAddress: string;
  miner: string;
  token: string;
  minerClassId: string;
  tokenClassId: string;
  /** The portal the record was made with; absent when the recording run had no Ethereum. */
  bridge?: BridgeRecord;
}

interface VisualRun {
  baseURL: string;
  nodeOrigin: string;
  ethOrigin: string;
  vitePid: number;
  runId: string;
}

interface RpcCall {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown[];
}

const rpcKey = (c: RpcCall) => `${c.method} ${JSON.stringify(c.params ?? [])}`;

const visualEnv = (d: VisualDeployment): NodeJS.ProcessEnv => ({
  ...process.env,
  YACANA_SITE_MODE: 'e2e',
  VITE_AZTEC_NODE_URL: MOCK_NODE_ORIGIN,
  VITE_ETH_RPC_URL: d.bridge ? MOCK_ETH_ORIGIN : '',
  VITE_BRIDGE: d.bridge ? JSON.stringify(d.bridge) : '',
  VITE_RP_ID: 'localhost',
  VITE_SOURCE_COMMIT: VISUAL_COMMIT,
  VITE_CHAIN_ID: d.chainId,
  VITE_ROLLUP_VERSION: d.rollupVersion,
  VITE_ROLLUP_ADDRESS: d.rollupAddress,
  VITE_YACANA_MINER: d.miner,
  VITE_YACANA_TOKEN: d.token,
  VITE_YACANA_MINER_CLASS: d.minerClassId,
  VITE_YACANA_TOKEN_CLASS: d.tokenClassId,
  VITE_DEPLOYMENT_RECORD: JSON.stringify(d),
});

/** The build, then only chunk 0 of the slot table (the fixture's 31 epochs live there) and the layouts. */
async function build(d: VisualDeployment, log: number): Promise<void> {
  buildApp(OUT_DIR, log, visualEnv(d));
  const dist = resolve(pkg, OUT_DIR);
  rmSync(resolve(dist, 'slots'), { recursive: true, force: true });
  mkdirSync(resolve(dist, 'slots'), { recursive: true });
  writeFileSync(
    resolve(dist, 'slots/0.json'),
    slotTableToJson(await deriveSlotTable((await loadLayouts()).miner, 0)),
  );
  cpSync(LAYOUTS_PATH, resolve(dist, 'layouts.json'));
}

async function serve(d: VisualDeployment, ownerPid: number): Promise<VisualRun> {
  const runId = `web-stats-visual-${ownerPid}-${Date.now()}`;
  const port = await claimPreviewPort(runId, ownerPid);
  let spawned: ChildProcess | undefined;
  try {
    const log = openSync(resolve(pkg, 'e2e/.visual.log'), 'w');
    await build(d, log);
    spawned = startPreview(OUT_DIR, log, port, visualEnv(d));
    const baseURL = `http://localhost:${port}`;
    if (!(await waitUntilUp(baseURL, spawned)))
      throw new Error(`vite preview did not start on ${baseURL} (see e2e/.visual.log)`);
    const run: VisualRun = {
      baseURL,
      nodeOrigin: MOCK_NODE_ORIGIN,
      ethOrigin: MOCK_ETH_ORIGIN,
      vitePid: spawned.pid as number,
      runId,
    };
    await Bun.write(VISUAL_FILE, JSON.stringify(run, null, 2));
    return run;
  } catch (e) {
    if (spawned?.pid) {
      try {
        process.kill(-spawned.pid, 'SIGKILL');
      } catch {
        /* never started */
      }
    }
    await release(runId).catch(() => {});
    throw e;
  }
}

async function teardown(): Promise<void> {
  const file = Bun.file(VISUAL_FILE);
  if (!(await file.exists())) return;
  const run = (await file.json()) as VisualRun;
  try {
    process.kill(-run.vitePid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  await release(run.runId).catch(() => {});
  rmSync(VISUAL_FILE, { force: true });
}

/** Every JSON-RPC call to `origin` answered by `upstream` (or `local` first), and kept under its method and params. */
function recordOrigin(
  page: Page,
  origin: string,
  upstream: string,
  answers: Record<string, unknown>,
  local: (c: RpcCall) => unknown = () => undefined,
): void {
  void page.route(
    (url) => url.origin === origin,
    async (route: Route) => {
      const body = route.request().postDataJSON() as RpcCall | RpcCall[];
      const calls = Array.isArray(body) ? body : [body];
      const out = [];
      for (const c of calls) {
        const result =
          local(c) ??
          (
            (await (
              await route.fetch({ url: upstream, method: 'POST', postData: JSON.stringify(c) })
            ).json()) as { result: unknown }
          ).result;
        answers[rpcKey(c)] = result;
        out.push({ jsonrpc: '2.0', id: c.id, result });
      }
      await route.fulfill({ json: Array.isArray(body) ? out : out[0] });
    },
  );
}

/**
 * Drives the built pages once against a fresh deployment: the fixture's storage answers locally,
 * everything else goes to the real node (and the portal's reads to the run's anvil), and every
 * answer is kept under its method and params.
 */
async function record(nodeUrl: string, l1RpcUrl: string | undefined): Promise<void> {
  // Loaded here, not at the top: the bridge deploy names the pinned forge on import, which the replaying gate on CI does not have.
  const { deployBridgeForRun, registerForRun } = await import('@yacana/deploy/bridge/run');
  const bridge = l1RpcUrl ? await deployBridgeForRun(nodeUrl, l1RpcUrl) : undefined;
  const deployed = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: 1n << 127n,
    portal: bridge ? EthAddress.fromString(bridge.portal) : TEST_PORTAL,
  });
  if (bridge && l1RpcUrl) await registerForRun(deployed, bridge, l1RpcUrl, { recordFile: RECORD_FILE });
  const d: VisualDeployment = {
    chainId: deployed.chainId,
    rollupVersion: deployed.rollupVersion,
    rollupAddress: deployed.rollupAddress,
    miner: deployed.miner,
    token: deployed.token,
    minerClassId: deployed.minerClassId,
    tokenClassId: deployed.tokenClassId,
    ...(bridge ? { bridge } : {}),
  };
  const storage = await mockStorage(deployed);
  const answers: Record<string, unknown> = {};
  const run = await serve(d, process.pid);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    recordOrigin(page, MOCK_NODE_ORIGIN, nodeUrl, answers, (c) => {
      const [, contract, slot] = (c.params ?? []) as [unknown, string, string];
      return c.method === 'aztec_getPublicStorageAt' ? storage[contract]?.[slot] : undefined;
    });
    if (l1RpcUrl) recordOrigin(page, MOCK_ETH_ORIGIN, l1RpcUrl, answers);
    await page.goto(`${run.baseURL}/`);
    await page.getByTestId('table').locator('tbody tr').nth(30).waitFor({ timeout: 60_000 });
    await page.getByTestId('freshness').filter({ hasText: 'block' }).waitFor({ timeout: 60_000 });
    if (bridge) {
      await page.goto(`${run.baseURL}/bridge`);
      await page.getByTestId('kpi-ethereum').filter({ hasText: 'YACA' }).waitFor({ timeout: 60_000 });
      await page.getByTestId('bridge-version').waitFor({ timeout: 60_000 });
      await page.getByTestId('coins-chart').waitFor({ timeout: 60_000 });
    }
  } finally {
    await browser?.close();
    await teardown();
  }
  const sorted = Object.fromEntries(
    Object.keys(answers)
      .sort()
      .map((k) => [k, answers[k]]),
  );
  writeFileSync(RPC_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(d, null, 2)}\n`);
  console.log(
    `recorded ${Object.keys(sorted).length} answers for ${d.miner}${bridge ? ` with the portal ${bridge.portal}` : ''}`,
  );
}

const command = process.argv[2];
if (command === 'record') {
  const nodeUrl = process.env.AZTEC_NODE_URL;
  if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set: run through `bun run e2e:agent -- …`');
  await record(nodeUrl, process.env.L1_RPC_URL);
} else if (command === 'serve') {
  const d = (await Bun.file(DEPLOYMENT_FILE).json()) as VisualDeployment;
  const run = await serve(d, Number(process.env.E2E_OWNER_PID ?? process.ppid));
  console.log(`visual: ${run.baseURL}`);
  process.exit(0);
} else if (command === 'teardown') {
  await teardown();
} else {
  throw new Error('usage: visual-setup.ts record|serve|teardown');
}
