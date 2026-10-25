// Bun-side E2E setup: a throwaway deployment on AZTEC_NODE_URL, the site assembled in e2e mode
// twice — the apex into e2e/.dist, the old role into e2e/.dist-old — each served by `wrangler dev`
// as static assets (the `_headers` and `_redirects` Cloudflare would apply) on a registry-claimed
// port (lane 7; owned by the Playwright process, which outlives this script), and e2e/.run.json for
// the specs. The servers bind `localhost`; the browser reaches the old one as `v5.localhost`, a
// loopback name it resolves itself, which the apps treat as the versioned origin.
import { type ChildProcess, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { type Deployment, deployYacana, TEST_PORTAL } from '@yacana/deploy/deploy';
import { lanePortBase, runPortWindowBase } from '@yacana/localnet/port-window';
import { claim, release } from '@yacana/localnet/registry';
import { assemble } from '../src/assemble.ts';
import { type E2eRun, RUN_FILE } from './run.ts';

const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set: run through `bun run e2e:agent -- …`');
const pkg = resolve(import.meta.dir, '..');
const OUT_DIR = resolve(pkg, 'e2e/.dist');
const OLD_OUT_DIR = resolve(pkg, 'e2e/.dist-old');

const e2eEnv = (d: Deployment, role: 'apex' | 'old', oldAppOrigin: string): NodeJS.ProcessEnv => ({
  ...process.env,
  YACANA_SITE_MODE: 'e2e',
  YACANA_APP_ROLE: role,
  VITE_OLD_APP_ORIGIN: oldAppOrigin,
  VITE_AZTEC_NODE_URL: nodeUrl,
  VITE_RP_ID: 'localhost',
  VITE_E2E_QUERY_OVERRIDES: '1',
  VITE_CHAIN_ID: d.chainId,
  VITE_ROLLUP_VERSION: d.rollupVersion,
  VITE_ROLLUP_ADDRESS: d.rollupAddress,
  VITE_YACANA_MINER: d.miner,
  VITE_YACANA_TOKEN: d.token,
  VITE_YACANA_MINER_CLASS: d.minerClassId,
  VITE_YACANA_TOKEN_CLASS: d.tokenClassId,
  VITE_DEPLOYMENT_RECORD: JSON.stringify(d),
});

/**
 * Two wranglers side by side: each needs its own inspector port, or the second dies on 9229, and its
 * own state directory, or the two open one SQLite store at once and workerd dies on SQLITE_BUSY.
 */
function startServer(log: number, port: number, inspector: number, dir: string): ChildProcess {
  const args = [
    'wrangler',
    'dev',
    '--assets',
    dir,
    '--port',
    String(port),
    '--inspector-port',
    String(inspector),
    '--ip',
    'localhost',
    '--persist-to',
    resolve(pkg, '.wrangler', `state-${port}`),
  ];
  const child = spawn('bunx', args, {
    cwd: pkg,
    stdio: ['ignore', log, log],
    detached: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  child.unref();
  return child;
}

async function waitUntilUp(baseURL: string, child: ChildProcess): Promise<boolean> {
  for (let i = 0; i < 240 && child.exitCode === null; i++) {
    const ok = await fetch(`${baseURL}/build.json`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return true;
    await delay(500);
  }
  return false;
}

const ownerPid = Number(process.env.E2E_OWNER_PID ?? process.ppid);
const runId = `site-e2e-${ownerPid}-${Date.now()}`;
const lane = {
  runId,
  ownerPid,
  worktree: resolve(pkg, '../..'),
  base: lanePortBase(runPortWindowBase(runId), 7, 8),
  span: 8,
};
const port = await claim({ ...lane, service: 'wrangler' });
const oldPort = await claim({ ...lane, service: 'wrangler-old' });
const inspector = await claim({ ...lane, service: 'wrangler-inspector' });
const oldInspector = await claim({ ...lane, service: 'wrangler-inspector-old' });
let spawned: ChildProcess | undefined;
let spawnedOld: ChildProcess | undefined;
try {
  // A target no proof reaches: the landing's demo scores its proof and never has a winner.
  const deployed = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: 1n,
    portal: TEST_PORTAL,
  });
  const oldBaseURL = `http://v5.localhost:${oldPort}`;
  await assemble(OUT_DIR, e2eEnv(deployed, 'apex', oldBaseURL));
  await assemble(OLD_OUT_DIR, e2eEnv(deployed, 'old', oldBaseURL));
  const log = openSync(resolve(pkg, 'e2e/.wrangler.log'), 'w');
  spawned = startServer(log, port, inspector, OUT_DIR);
  spawnedOld = startServer(log, oldPort, oldInspector, OLD_OUT_DIR);
  const baseURL = `http://localhost:${port}`;
  if (!(await waitUntilUp(baseURL, spawned)))
    throw new Error(`wrangler dev did not start on ${baseURL} (see e2e/.wrangler.log)`);
  // Node need not resolve `v5.localhost`: the readiness probe goes to `localhost` like the apex's.
  if (!(await waitUntilUp(`http://localhost:${oldPort}`, spawnedOld)))
    throw new Error(`wrangler dev did not start on ${oldBaseURL} (see e2e/.wrangler.log)`);
  const run: E2eRun = {
    baseURL,
    oldBaseURL,
    nodeUrl,
    miner: deployed.miner,
    token: deployed.token,
    serverPid: spawned.pid as number,
    oldServerPid: spawnedOld.pid as number,
    runId,
  };
  await Bun.write(RUN_FILE, JSON.stringify(run, null, 2));
  console.log(`e2e: ${baseURL} (old ${oldBaseURL}) miner ${deployed.miner} token ${deployed.token}`);
  process.exit(0);
} catch (e) {
  // The servers are detached: nothing else would reap them once this script is gone.
  for (const child of [spawned, spawnedOld]) {
    if (!child?.pid) continue;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* never started */
    }
  }
  await release(runId).catch(() => {});
  throw e;
}
