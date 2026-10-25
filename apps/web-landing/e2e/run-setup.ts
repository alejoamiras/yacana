// Bun-side E2E setup: a throwaway deployment on AZTEC_NODE_URL, Vite preview on a registry-claimed
// port (lane 5; owned by the Playwright process, which outlives this script), and e2e/.run.json
// for the specs. The server binds `localhost`.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { type Deployment, deployYacana, TEST_PORTAL } from '@yacana/deploy/deploy';
import { lanePortBase, runPortWindowBase } from '@yacana/localnet/port-window';
import { claim, release } from '@yacana/localnet/registry';
import { type E2eRun, RUN_FILE } from './run.ts';

const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set: run through `bun run e2e:agent -- …`');
const pkg = resolve(import.meta.dir, '..');
const OUT_DIR = 'e2e/.dist';
const CLAIM_OUT_DIR = 'e2e/.dist-claim';
const CLAIM_FILE = 'apps/web-landing/e2e/.example-claim.json';

const e2eEnv = (d: Deployment): NodeJS.ProcessEnv => ({
  ...process.env,
  YACANA_SITE_MODE: 'e2e',
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
  // No recorded claim: the ledger's empty state. The second build points at the run's fixture.
  VITE_EXAMPLE_CLAIM: '',
});

/** The committed fixture claim with its identity rewritten to this run's deployment, so the config accepts it. */
function writeClaimFixture(d: Deployment): void {
  const fixture = JSON.parse(readFileSync(resolve(pkg, 'e2e/fixtures/example-claim.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  writeFileSync(
    resolve(pkg, '../..', CLAIM_FILE),
    JSON.stringify(
      { ...fixture, miner: d.miner, chainId: d.chainId, rollupVersion: d.rollupVersion },
      null,
      2,
    ),
  );
}

function buildForRun(log: number, env: NodeJS.ProcessEnv, outDir: string): void {
  execFileSync('bunx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: pkg,
    stdio: ['ignore', log, log],
    env,
  });
}

function startServer(log: number, port: number, env: NodeJS.ProcessEnv, outDir: string): ChildProcess {
  const args = [
    'vite',
    'preview',
    '--outDir',
    outDir,
    '--port',
    String(port),
    '--strictPort',
    '--host',
    'localhost',
  ];
  const child = spawn('bunx', args, { cwd: pkg, stdio: ['ignore', log, log], detached: true, env });
  child.unref();
  return child;
}

async function waitUntilUp(baseURL: string, child: ChildProcess): Promise<boolean> {
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    const ok = await fetch(`${baseURL}/`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return true;
    await delay(500);
  }
  return false;
}

const ownerPid = Number(process.env.E2E_OWNER_PID ?? process.ppid);
const runId = `web-landing-e2e-${ownerPid}-${Date.now()}`;
const worktree = resolve(pkg, '../..');
const base = lanePortBase(runPortWindowBase(runId), 5, 8);
const portFor = (service: string) => claim({ runId, service, ownerPid, worktree, base, span: 8 });
const spawned: ChildProcess[] = [];
try {
  // A target no proof reaches: the deployment stays at epoch 0 with no claim, the ledger's empty state.
  const deployed = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
    initialTarget: 1n,
    portal: TEST_PORTAL,
  });
  const log = openSync(resolve(pkg, 'e2e/.vite.log'), 'w');
  const env = e2eEnv(deployed);
  writeClaimFixture(deployed);
  const serve = async (service: string, outDir: string, extra: NodeJS.ProcessEnv): Promise<string> => {
    const port = await portFor(service);
    buildForRun(log, { ...env, ...extra }, outDir);
    const child = startServer(log, port, env, outDir);
    spawned.push(child);
    const url = `http://localhost:${port}`;
    if (!(await waitUntilUp(url, child)))
      throw new Error(`vite preview did not start on ${url} (see e2e/.vite.log)`);
    return url;
  };
  const baseURL = await serve('vite', OUT_DIR, {});
  // The second build also carries an announced migration: the one line every page shows then.
  const claimURL = await serve('vite-claim', CLAIM_OUT_DIR, {
    VITE_EXAMPLE_CLAIM: CLAIM_FILE,
    VITE_MIGRATION: JSON.stringify({ toIndex: '1', announcedAt: '1799900000', expectedFlipAt: '1800500000' }),
  });
  const run: E2eRun = {
    baseURL,
    claimURL,
    nodeUrl,
    miner: deployed.miner,
    token: deployed.token,
    vitePids: spawned.map((c) => c.pid as number),
    runId,
  };
  await Bun.write(RUN_FILE, JSON.stringify(run, null, 2));
  console.log(
    `e2e: ${baseURL} (+ ${claimURL} with the claim) miner ${deployed.miner} token ${deployed.token}`,
  );
  process.exit(0);
} catch (e) {
  // The servers are detached: nothing else would reap them once this script is gone.
  for (const child of spawned) {
    try {
      process.kill(-(child.pid as number), 'SIGKILL');
    } catch {
      /* never started */
    }
  }
  await release(runId).catch(() => {});
  throw e;
}
