// The replay lane's fixture-only build and server, and the one-off recording it replays.
//   bun run e2e:agent -- bun apps/web-miner/e2e/replay/setup.ts record   # on the isolated network
//   bun e2e/replay/setup.ts serve|teardown                                    # no node involved
import { type ChildProcess, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { type Browser, chromium, type Route } from '@playwright/test';
import { COMMITTED } from '@yacana/contracts/scripts/commit-artifacts';
import { deployYacana, TEST_PORTAL } from '@yacana/deploy/deploy';
import { buildApp, claimPreviewPort, startPreview, waitUntilUp } from '@yacana/localnet/preview';
import { release } from '@yacana/localnet/registry';
import { deriveSlotTable, LAYOUTS_PATH, loadLayouts } from '@yacana/miner-core/slots';
import { BOOT_MS } from '../helpers.ts';
import {
  RECORDING_FILE,
  REPLAY_NODE_ORIGIN,
  REPLAY_RUN_FILE,
  type Recording,
  type ReplayBinding,
  type ReplayDeployment,
  type ReplayRun,
  rpcKey,
} from './run.ts';

const pkg = resolve(import.meta.dir, '../..');
const repo = resolve(pkg, '../..');
const OUT_DIR = 'e2e/replay/.dist';
const LOG_FILE = resolve(pkg, 'e2e/replay/.vite.log');

interface RpcCall {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown[];
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The inputs a recorded answer depends on beyond its RPC key: the artifacts the page ships and reads with, the SDK. */
export function currentBinding(): ReplayBinding {
  return {
    minerArtifactSha256: sha256(COMMITTED.miner),
    tokenArtifactSha256: sha256(
      Bun.resolveSync('@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json', repo),
    ),
    layoutsSha256: sha256(LAYOUTS_PATH),
    aztecVersion: (
      JSON.parse(readFileSync(resolve(repo, 'node_modules/@aztec-labs/aztec.js/package.json'), 'utf8')) as {
        version: string;
      }
    ).version,
  };
}

export const bindingDrift = (recorded: ReplayBinding, current: ReplayBinding): string[] =>
  (Object.keys(current) as (keyof ReplayBinding)[]).filter((k) => recorded[k] !== current[k]);

/** The recorded deployment's claims slot for epoch 0, the epoch a fresh deployment opens on. */
export async function claimsKeyFor(miner: string): Promise<string> {
  const table = await deriveSlotTable((await loadLayouts()).miner, 0);
  const slot = table.claims[0];
  if (!slot) throw new Error('the slot table has no claims slot for epoch 0');
  return rpcKey({ method: 'aztec_getPublicStorageAt', params: ['latest', miner, slot.toString()] });
}

const replayEnv = (d: ReplayDeployment): NodeJS.ProcessEnv => ({
  ...process.env,
  YACANA_SITE_MODE: 'e2e',
  VITE_AZTEC_NODE_URL: REPLAY_NODE_ORIGIN,
  VITE_RP_ID: 'localhost',
  VITE_E2E_QUERY_OVERRIDES: '1',
  VITE_DEV_FUND_FEES: '1',
  VITE_PRESTO_E2E_PORT: '',
  VITE_CHAIN_ID: d.chainId,
  VITE_ROLLUP_VERSION: d.rollupVersion,
  VITE_ROLLUP_ADDRESS: d.rollupAddress,
  VITE_YACANA_MINER: d.miner,
  VITE_YACANA_TOKEN: d.token,
  VITE_YACANA_MINER_CLASS: d.minerClassId,
  VITE_YACANA_TOKEN_CLASS: d.tokenClassId,
});

async function serve(d: ReplayDeployment, ownerPid: number): Promise<ReplayRun> {
  const runId = `web-miner-replay-${ownerPid}-${Date.now()}`;
  const port = await claimPreviewPort({ runId, ownerPid, worktree: repo, laneIndex: 7 });
  let spawned: ChildProcess | undefined;
  try {
    const log = openSync(LOG_FILE, 'w');
    buildApp(pkg, OUT_DIR, log, replayEnv(d));
    // Bound to the IPv4 loopback: the LNA spec reaches the page by that address (its address-space
    // override names the endpoint that served the page, and `localhost` may resolve to ::1); every
    // other spec keeps the `localhost` URL, which Chromium connects across both loopback families.
    spawned = startPreview(pkg, OUT_DIR, log, port, replayEnv(d), '127.0.0.1');
    const baseURL = `http://localhost:${port}`;
    if (!(await waitUntilUp(baseURL, spawned)))
      throw new Error(`vite preview did not start on ${baseURL} (see e2e/replay/.vite.log)`);
    const run: ReplayRun = { baseURL, vitePid: spawned.pid as number, runId };
    writeFileSync(REPLAY_RUN_FILE, JSON.stringify(run, null, 2));
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
  const file = Bun.file(REPLAY_RUN_FILE);
  if (!(await file.exists())) return;
  const run = (await file.json()) as ReplayRun;
  try {
    process.kill(-run.vitePid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  await release(run.runId).catch(() => {});
  rmSync(REPLAY_RUN_FILE, { force: true });
}

/**
 * Drives the built page once against a fresh deployment on the real node — the preflight, the
 * deployment probe, the public epoch read — and keeps every answer under its method and params.
 */
async function record(nodeUrl: string): Promise<void> {
  // The build below is a bare `vite build`: the page's CRS, artifacts and slot table come from prebuild.
  const prebuild = spawnSync('bun', ['scripts/prebuild.ts'], { cwd: pkg, stdio: 'inherit' });
  if (prebuild.status !== 0) throw new Error('prebuild failed');
  const deployed = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: 1n << 127n,
    portal: TEST_PORTAL,
  });
  const d: ReplayDeployment = {
    chainId: deployed.chainId,
    rollupVersion: deployed.rollupVersion,
    rollupAddress: deployed.rollupAddress,
    miner: deployed.miner,
    token: deployed.token,
    minerClassId: deployed.minerClassId,
    tokenClassId: deployed.tokenClassId,
  };
  const answers: Record<string, unknown> = {};
  const run = await serve(d, process.pid);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // A boot that never reaches the cockpit only explains itself through the page's own errors.
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.error(`page ${m.type()}: ${m.text()}`);
    });
    await page.route(
      (url) => url.origin === REPLAY_NODE_ORIGIN,
      async (route: Route) => {
        const body = route.request().postDataJSON() as RpcCall | RpcCall[];
        const calls = Array.isArray(body) ? body : [body];
        const out = [];
        for (const c of calls) {
          const res = (await (
            await route.fetch({ url: nodeUrl, method: 'POST', postData: JSON.stringify(c) })
          ).json()) as { result: unknown };
          answers[rpcKey(c)] = res.result;
          out.push({ jsonrpc: '2.0', id: c.id, result: res.result });
        }
        await route.fulfill({ json: Array.isArray(body) ? out : out[0] });
      },
    );
    await page.goto(`${run.baseURL}/?presto=off`);
    await page.getByTestId('cockpit').waitFor({ timeout: BOOT_MS });
    // The public epoch rendered: the poll's reads are in the recording.
    await page
      .getByTestId('epoch-claims')
      .filter({ hasText: /\d+ of \d+/ })
      .waitFor({ timeout: 60_000 });
  } finally {
    await browser?.close();
    await teardown();
  }
  const claimsKey = await claimsKeyFor(d.miner);
  if (!(claimsKey in answers)) throw new Error("the visit never read the open epoch's claims");
  const recording: Recording = {
    recordedAt: new Date().toISOString(),
    deployment: d,
    binding: currentBinding(),
    claimsKey,
    answers: Object.fromEntries(
      Object.keys(answers)
        .sort()
        .map((k) => [k, answers[k]]),
    ),
  };
  writeFileSync(RECORDING_FILE, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`recorded ${Object.keys(answers).length} answers for ${d.miner}`);
}

const loadRecording = (): Recording => JSON.parse(readFileSync(RECORDING_FILE, 'utf8')) as Recording;

const command = process.argv[2];
if (command === 'record') {
  const nodeUrl = process.env.AZTEC_NODE_URL;
  if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set: run through `bun run e2e:agent -- …`');
  await record(nodeUrl);
} else if (command === 'serve') {
  const recording = loadRecording();
  const drift = bindingDrift(recording.binding, currentBinding());
  if (drift.length)
    throw new Error(
      `e2e/replay/recording.json was taken against other inputs (${drift.join(', ')}): re-record with ` +
        '`bun run e2e:agent -- bun apps/web-miner/e2e/replay/setup.ts record`',
    );
  const run = await serve(recording.deployment, Number(process.env.E2E_OWNER_PID ?? process.ppid));
  console.log(`replay: ${run.baseURL} (recorded ${recording.recordedAt})`);
  process.exit(0);
} else if (command === 'teardown') {
  await teardown();
} else if (command !== undefined) {
  throw new Error('usage: setup.ts record|serve|teardown');
}
