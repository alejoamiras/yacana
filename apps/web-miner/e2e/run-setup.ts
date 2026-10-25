// Bun-side E2E setup: a throwaway deployment at an easy target on AZTEC_NODE_URL, Vite on a
// registry-claimed port (owned by the Playwright process, which outlives this script), and
// e2e/.run.json for the spec. Deploy needs Bun (artifacts are read with Bun.file). The server
// binds `localhost`, not 127.0.0.1: WebAuthn refuses an IP literal as an RP ID.
//
// E2E_SERVER=preview (default) makes a Vite build in e2e mode for this run into e2e/.dist and
// serves it with `vite preview`: the Workers and the bundle are built as they ship, the CSP and the
// allowlist carry the local additions of e2e mode, and E2E_PROVERLESS=1 turns off transaction
// proving. The dev server injects Node globals and accepts local nodes on its own, which hid a
// Worker without `Buffer` once. E2E_SERVER=dev keeps it for debugging with readable stacks.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { deployBridgeForRun, RUN_OPERATORS_KEY, registerForRun } from '@yacana/deploy/bridge/run';
import { deployYacana, TEST_PORTAL } from '@yacana/deploy/deploy';
import { lanePortBase, runPortWindowBase } from '@yacana/localnet/port-window';
import {
  type PrestoLane,
  prestoServerBinary,
  startPrestoServer,
  stopPrestoServer,
} from '@yacana/localnet/presto';
import { waitUntilUp } from '@yacana/localnet/preview';
import { claim, release } from '@yacana/localnet/registry';
import type { Hex } from 'viem';
import { e2eBuildEnv } from './build-env.ts';
import { type E2eBridge, type E2eRun, type E2eServer, type RigStep, RUN_FILE, TIMINGS_FILE } from './run.ts';

const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set: run through `bun run e2e:agent -- …`');
const server = (process.env.E2E_SERVER ?? 'preview') as E2eServer;
if (server !== 'dev' && server !== 'preview')
  throw new Error(`E2E_SERVER must be dev or preview, got ${server}`);
const pkg = resolve(import.meta.dir, '..');
const OUT_DIR = 'e2e/.dist';

// Bridge mode: the portal on the network's anvil, the version registered, the control server up.
// On by default (the whole suite holds the bridge spec) and for the `bridge` shard; the other
// shards skip the twenty seconds of forge.
const shard = process.env.E2E_SHARD;
const bridgeMode = process.env.E2E_BRIDGE === '1' || shard === undefined || shard === 'bridge';
/** Anvil account 3: the holder the test wallet signs with (account 1 operates the bridge, account 0 publishes blocks). */
const HOLDER_KEY: Hex = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
/** Relative to the repo root: what the operator functions and the control server open. */
const RECORD_FILE = 'apps/web-miner/e2e/.record.json';
const ARCHIVE_FILE = 'apps/web-miner/e2e/.witnesses.jsonl';

async function startControl(log: number, port: number, l1RpcUrl: string): Promise<ChildProcess> {
  const child = spawn(
    'bun',
    ['e2e/control.ts', String(port), RECORD_FILE, nodeUrl as string, l1RpcUrl, ARCHIVE_FILE],
    {
      cwd: pkg,
      stdio: ['ignore', log, log],
      detached: true,
      env: { ...process.env, YACANA_L1_PRIVATE_KEY: RUN_OPERATORS_KEY },
    },
  );
  child.unref();
  for (let i = 0; i < 240 && child.exitCode === null; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/ping`, { method: 'POST' }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return child;
    await delay(250);
  }
  throw new Error('the control server did not start (see e2e/.vite.log)');
}

function buildForRun(log: number, env: NodeJS.ProcessEnv): void {
  execFileSync('bunx', ['vite', 'build', '--outDir', OUT_DIR, '--emptyOutDir'], {
    cwd: pkg,
    stdio: ['ignore', log, log],
    env,
  });
}

function startServer(log: number, port: number, env: NodeJS.ProcessEnv): ChildProcess {
  const serve = ['--port', String(port), '--strictPort', '--host', 'localhost'];
  const args = server === 'preview' ? ['vite', 'preview', '--outDir', OUT_DIR, ...serve] : ['vite', ...serve];
  const child = spawn('bunx', args, { cwd: pkg, stdio: ['ignore', log, log], detached: true, env });
  child.unref();
  return child;
}

const ownerPid = Number(process.env.E2E_OWNER_PID ?? process.ppid);
const runId = `web-miner-e2e-${ownerPid}-${Date.now()}`;
const lane = {
  runId,
  ownerPid,
  worktree: resolve(pkg, '../..'),
  base: lanePortBase(runPortWindowBase(runId), 6, 8),
  span: 8,
};
const port = await claim({ ...lane, service: 'vite' });
const proxyPorts = [
  await claim({ ...lane, service: 'node-proxy-a' }),
  await claim({ ...lane, service: 'node-proxy-b' }),
];
// Claimed so nothing else on this host binds it for the run's duration; deliberately never listened on.
const closedPort = await claim({ ...lane, service: 'presto-closed' });
const controlPort = bridgeMode ? await claim({ ...lane, service: 'control' }) : null;
let spawned: ChildProcess | undefined;
let proxies: ChildProcess | undefined;
let controlServer: ChildProcess | undefined;
let presto: PrestoLane | null = null;
const steps: RigStep[] = [];
let lapStart = Date.now();
const lap = (name: string) => {
  const now = Date.now();
  steps.push({ name, ms: now - lapStart });
  lapStart = now;
};
try {
  // The run's headless Presto: absent only where none is installed (presto.e2e.ts then skips); an
  // installed one that fails to start fails the run.
  if (prestoServerBinary())
    presto = await startPrestoServer({ lane, home: resolve(pkg, 'e2e/.presto-home', runId) });
  else console.log('e2e: presto-server is not installed; the Presto spec will skip');
  lap('presto start');
  const l1RpcUrl = process.env.L1_RPC_URL;
  if (bridgeMode && !l1RpcUrl)
    throw new Error('bridge mode needs L1_RPC_URL: run through `bun run e2e:agent -- …`');
  const bridge = bridgeMode ? await deployBridgeForRun(nodeUrl as string, l1RpcUrl as string) : null;
  if (bridge) lap('bridge deploy (portal + YACA)');
  const target = BigInt(process.env.YACANA_E2E_TARGET ?? String(1n << 127n));
  const deployed = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: target,
    portal: bridge ? EthAddress.fromString(bridge.portal) : TEST_PORTAL,
  });
  lap('deploy (easy target)');
  if (bridge) {
    await registerForRun(deployed, bridge, l1RpcUrl as string, {
      recordFile: RECORD_FILE,
      archiveFile: ARCHIVE_FILE,
    });
    lap('register the version');
  }
  const hard = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: 1n << 64n,
    portal: TEST_PORTAL,
  });
  lap('deploy (impossible target)');
  const log = openSync(resolve(pkg, 'e2e/.vite.log'), 'w');
  const env = e2eBuildEnv(deployed, {
    nodeUrl,
    prestoPort: presto?.port ?? null,
    bridge,
    proverless: process.env.E2E_PROVERLESS === '1',
  });
  if (server === 'preview') buildForRun(log, env);
  lap(`bundle build (${server})`);
  spawned = startServer(log, port, env);
  const vite = spawned;
  const baseURL = `http://localhost:${port}`;
  if (!(await waitUntilUp(baseURL, vite)))
    throw new Error(`vite ${server} did not start on ${baseURL} (see e2e/.vite.log)`);
  lap('server up');
  proxies = spawn('bun', ['e2e/node-proxy.ts', nodeUrl, ...proxyPorts.map(String)], {
    cwd: pkg,
    stdio: ['ignore', log, log],
    detached: true,
  });
  proxies.unref();
  const proxyA = `http://127.0.0.1:${proxyPorts[0]}`;
  const proxyB = `http://127.0.0.1:${proxyPorts[1]}`;
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${proxyA}/__stats`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) break;
    await delay(250);
  }
  lap('proxies up');
  let e2eBridge: E2eBridge | null = null;
  if (bridge && controlPort !== null) {
    controlServer = await startControl(log, controlPort, l1RpcUrl as string);
    lap('control up');
    e2eBridge = {
      portal: bridge.portal,
      yaca: bridge.yaca,
      chainId: bridge.chainId,
      l1RpcUrl: l1RpcUrl as string,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      holderKey: HOLDER_KEY,
    };
  }
  await Bun.write(TIMINGS_FILE, JSON.stringify({ steps }, null, 2));
  const run: E2eRun = {
    baseURL,
    nodeUrl,
    miner: deployed.miner,
    token: deployed.token,
    hardMiner: hard.miner,
    hardToken: hard.token,
    proxyA,
    proxyB,
    proxyPid: proxies.pid as number,
    vitePid: vite.pid as number,
    prestoUrl: presto?.url ?? null,
    prestoPid: presto?.pid ?? null,
    prestoHome: presto?.home ?? null,
    closedPort,
    runId,
    server,
    bridge: e2eBridge,
    controlPid: controlServer?.pid ?? null,
  };
  await Bun.write(RUN_FILE, JSON.stringify(run, null, 2));
  console.log(
    `e2e: ${baseURL} (${server}) miner ${deployed.miner} token ${deployed.token}${presto ? ` presto ${presto.url}` : ''}${
      e2eBridge ? ` portal ${e2eBridge.portal} control ${e2eBridge.controlUrl}` : ''
    }`,
  );
  process.exit(0);
} catch (e) {
  // The servers are detached: nothing else would reap them once this script is gone.
  for (const child of [spawned, proxies, controlServer]) {
    if (!child?.pid) continue;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* never started */
    }
  }
  if (presto) await stopPrestoServer(presto.pid);
  await release(runId).catch(() => {});
  throw e;
}
