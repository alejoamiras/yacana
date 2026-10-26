// Isolated, parallel-safe Aztec local network: our own anvil + `aztec start --local-network` on
// registry-claimed ports (never 8545/8080), each in its own process group, data on real disk.
// Readiness races the owned child's exit so a foreign process on a claimed port is never
// mistaken for ours; signal handlers are installed before the first spawn so an interrupt
// during startup cannot orphan the children. Teardown kills only the groups this run owns.
//
//   const node = await startIsolatedNode();  …  await node.teardown();
//   bun tools/localnet/src/isolated-node.ts --smoke            boot → probe → teardown
//   bun tools/localnet/src/isolated-node.ts -- <cmd> [args…]   run <cmd> with AZTEC_NODE_URL / L1_RPC_URL set
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { lanePortBase, runPortWindowBase } from './port-window.ts';
import { claim, release } from './registry.ts';
import { jsonRpcReady, killOwned, type Owned, repoRoot, spawnDetached, toolchainBin } from './toolchain.ts';

export interface IsolatedNode {
  nodeUrl: string;
  /** The node's admin API (sequencer pause/resume); unauthenticated on the local network. */
  adminUrl: string;
  l1RpcUrl: string;
  runId: string;
  runRoot: string;
  /** Where every child's output goes; kept after teardown, the run's record. */
  logDir: string;
  /** Kills the aztec node alone; anvil, the ports and the run dir stay for a successor node. */
  stopNode: () => void;
  /**
   * A child started beside the network (a pinned node) dies with it: on teardown and on a signal,
   * then `cleanup` runs (its port lanes). The returned function takes it back once stopped by hand.
   */
  adopt: (child: Owned, cleanup: () => Promise<void>) => () => void;
  teardown: () => Promise<void>;
}

export interface IsolatedNodeOptions {
  /** Extra env for the aztec process (e.g. sequencer/prover toggles). */
  env?: Record<string, string>;
  /** Forward child stdout/stderr to ours (also YACANA_NODE_VERBOSE=1). */
  verbose?: boolean;
}

interface Ports {
  anvil: number;
  aztec: number;
  admin: number;
  p2p: number;
}

async function claimPorts(runId: string): Promise<Ports> {
  const windowBase = runPortWindowBase(runId);
  const svc = (service: string, lane: number) =>
    claim({
      runId,
      service,
      ownerPid: process.pid,
      worktree: repoRoot,
      base: lanePortBase(windowBase, lane, 8),
      span: 8,
    });
  return {
    anvil: await svc('anvil', 0),
    aztec: await svc('aztec', 1),
    admin: await svc('aztecAdmin', 2),
    p2p: await svc('aztecP2p', 3),
  };
}

function aztecArgs(ports: Ports, runRoot: string, l1RpcUrl: string): string[] {
  return [
    'start',
    '--local-network',
    '--l1-rpc-urls',
    l1RpcUrl,
    '--port',
    String(ports.aztec),
    '--admin-port',
    String(ports.admin),
    '--data-directory',
    join(runRoot, 'aztec'),
    '--world-state-data-directory',
    join(runRoot, 'aztec-world-state'),
    '--p2p.p2pPort',
    String(ports.p2p),
    '--p2p.p2pBroadcastPort',
    String(ports.p2p),
    // No transaction floor for a block. The local network's automine sequencer still builds only on a
    // transaction or a warp: a claim anchors on the latest block and expires CLAIM_TTL_SECONDS after
    // it, so a run that proves for minutes between transactions must keep the chain moving itself.
    '--sequencer.minTxsPerBlock',
    '0',
    // The rig pauses the sequencer through the admin API before stopping a node. The CLI offers no
    // bind address, so the keyless listener is open to whoever reaches this box's ports: a run for
    // a machine you own, not a shared host.
    '--disable-admin-api-key',
  ];
}

export async function startIsolatedNode(opts: IsolatedNodeOptions = {}): Promise<IsolatedNode> {
  const verbose = opts.verbose ?? process.env.YACANA_NODE_VERBOSE === '1';
  // Time + pid + random suffix: two starts in the same millisecond cannot share a runRoot.
  const runId = `yacana-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const ports = await claimPorts(runId);
  const runRoot = resolve(repoRoot, '.localnet', runId);
  mkdirSync(runRoot, { recursive: true });
  // Child scratch on real disk (never the RAM-backed /tmp) and on a SHORT path: the native
  // backend opens a UNIX socket under TMPDIR and sun_path is capped at 108 bytes.
  const childTmp = join(homedir(), '.cache', 'tmp');
  mkdirSync(childTmp, { recursive: true });
  const l1RpcUrl = `http://127.0.0.1:${ports.anvil}`;
  const nodeUrl = `http://127.0.0.1:${ports.aztec}`;
  const adminUrl = `http://127.0.0.1:${ports.admin}`;
  const logDir = join(repoRoot, '.localnet', 'logs', runId);
  const owned: Owned[] = [];
  const cleanups = new Map<Owned, () => Promise<void>>();
  let torn = false;
  const teardown = async (): Promise<void> => {
    if (torn) return;
    torn = true;
    // bun-types 1.4 narrows process.off to its 'memoryPressure' overload; the emitter view keeps the signal one.
    (process as EventEmitter).off('SIGINT', onSignal);
    (process as EventEmitter).off('SIGTERM', onSignal);
    for (const o of [...owned].reverse()) killOwned(o);
    for (const cleanup of cleanups.values()) await cleanup().catch(() => {});
    await release(runId).catch(() => {});
    rmSync(runRoot, { recursive: true, force: true });
  };
  const adopt = (child: Owned, cleanup: () => Promise<void>) => {
    if (torn) {
      killOwned(child);
      void cleanup().catch(() => {});
      throw new Error(`${child.name} started after the network's teardown began`);
    }
    owned.push(child);
    cleanups.set(child, cleanup);
    return () => {
      const i = owned.indexOf(child);
      if (i >= 0) owned.splice(i, 1);
      cleanups.delete(child);
    };
  };
  const onSignal = () => {
    void teardown().finally(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const anvil = spawnDetached(
      'anvil',
      toolchainBin('aztec-anvil'),
      ['--host', '127.0.0.1', '--port', String(ports.anvil), '--silent'],
      { TMPDIR: childTmp },
      verbose,
      join(logDir, 'anvil.log'),
    );
    owned.push(anvil);
    await jsonRpcReady(l1RpcUrl, 'eth_chainId', 60_000, anvil);
    // The network's L1 deploy looks for forge under ~/.aztec/current before anywhere else, and
    // `current` is whichever version was installed last: name the pinned one.
    const aztec = spawnDetached(
      'aztec',
      toolchainBin('aztec'),
      aztecArgs(ports, runRoot, l1RpcUrl),
      {
        FORGE_BIN: process.env.FORGE_BIN ?? toolchainBin('aztec-forge'),
        ETHEREUM_HOSTS: l1RpcUrl,
        TMPDIR: childTmp,
        ...opts.env,
      },
      verbose,
      join(logDir, 'aztec.log'),
    );
    owned.push(aztec);
    await jsonRpcReady(nodeUrl, 'node_getNodeInfo', 240_000, aztec);
  } catch (e) {
    await teardown();
    throw e;
  }
  const stopNode = () => {
    const aztec = owned.find((o) => o.name === 'aztec');
    if (aztec) killOwned(aztec);
  };
  return { nodeUrl, adminUrl, l1RpcUrl, runId, runRoot, logDir, stopNode, adopt, teardown };
}

async function runWithNode(cmd: string[]): Promise<number> {
  const startedAt = Date.now();
  const node = await startIsolatedNode();
  const nodeReadyMs = Date.now() - startedAt;
  console.info(
    `isolated node ready in ${(nodeReadyMs / 1000).toFixed(1)}s: ${node.nodeUrl} (L1 ${node.l1RpcUrl}, run ${node.runId})`,
  );
  try {
    const [bin, ...args] = cmd;
    if (!bin) return 0;
    const child = spawn(bin, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        AZTEC_NODE_URL: node.nodeUrl,
        L1_RPC_URL: node.l1RpcUrl,
        YACANA_RUN_ID: node.runId,
        // The command's clock started here, not at its own launch: what it reports can reconcile to it.
        YACANA_RUN_STARTED_AT: String(startedAt),
        YACANA_NODE_READY_MS: String(nodeReadyMs),
      },
    });
    return await new Promise<number>((res) => {
      child.on('exit', (code) => res(code ?? 1));
      // A command that cannot start (ENOENT) never exits; the node must still come down.
      child.on('error', (e) => {
        console.error(`cannot start ${bin}: ${e.message}`);
        res(127);
      });
    });
  } finally {
    await node.teardown();
  }
}

if (import.meta.main) {
  // `bun script.ts -- cmd` may or may not keep the leading `--` (bun consumes it); a later `--`
  // belongs to the command itself (`… test:e2e -- words.e2e.ts`).
  const smoke = process.argv.includes('--smoke');
  const argv = process.argv.slice(2).filter((a) => a !== '--smoke');
  const cmd = argv[0] === '--' ? argv.slice(1) : argv;
  if (!cmd.length && !smoke) throw new Error('usage: isolated-node.ts --smoke | -- <cmd> [args…]');
  if (smoke) {
    const node = await startIsolatedNode();
    console.info(`SMOKE OK — node at ${node.nodeUrl}, run ${node.runId}; tearing down.`);
    await node.teardown();
    process.exit(0);
  }
  process.exit(await runWithNode(cmd));
}
