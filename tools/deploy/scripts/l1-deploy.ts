// Deploys YACA and the portal through the pinned forge, verifies the code on chain, and writes
// the bridge block into a deployment record — or, when the record does not exist yet, beside it as
// deployments/<profile>.bridge.json for `bun run deploy` to fold in. Every secret comes from the
// environment and the key is read inside the forge script, never placed on a command line.
//
//   YACANA_L1_RPC_URL=… YACANA_L1_PRIVATE_KEY=0x… YACANA_REGISTRY=0x… YACANA_OPERATORS=0x… \
//     bun tools/deploy/scripts/l1-deploy.ts [deployments/<profile>.json]
//   bun tools/deploy/scripts/l1-deploy.ts --anvil        # its own anvil and a stand-in Registry
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { policyFor } from '@yacana/bridge/policy';
import { lanePortBase, runPortWindowBase } from '@yacana/localnet/port-window';
import { claim, release } from '@yacana/localnet/registry';
import { jsonRpcReady, killOwned, repoRoot, spawnDetached, toolchainBin } from '@yacana/localnet/toolchain';
import { PARAMS, PROFILE } from '@yacana/miner-core/generated/params';
import { createPublicClient, createWalletClient, type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BridgeRecord } from '../src/deploy.ts';

const portalDir = resolve(repoRoot, 'protocol/portal');
const forgeStd = resolve(
  toolchainBin('aztec-forge'),
  '../../node_modules/@aztec-foundation/l1-artifacts/l1-contracts/lib/forge-std/src',
);

/** Anvil's first funded account: throwaway, and only ever used on a chain nobody else runs. */
export const ANVIL_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export async function startAnvil(
  extraArgs: string[] = [],
): Promise<{ rpcUrl: string; stop: () => Promise<void> }> {
  const bin = toolchainBin('aztec-anvil');
  const runId = `yacana-l1-${process.pid}-${Date.now()}`;
  const port = await claim({
    runId,
    service: 'anvil',
    ownerPid: process.pid,
    worktree: repoRoot,
    base: lanePortBase(runPortWindowBase(runId), 0, 8),
    span: 8,
  });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawnDetached(
    'anvil',
    bin,
    ['--host', '127.0.0.1', '--port', String(port), '--silent', ...extraArgs],
    {},
    false,
  );
  const stop = async () => {
    killOwned(anvil);
    await release(runId).catch(() => {});
  };
  try {
    await jsonRpcReady(rpcUrl, 'eth_chainId', 60_000, anvil);
  } catch (e) {
    await stop();
    throw e;
  }
  return { rpcUrl, stop };
}

/** A stand-in Registry (the Foundry harness's) on a chain that has no Aztec deployment. */
async function deployFakeRegistry(rpcUrl: string, key: Hex): Promise<Hex> {
  const artifact = (await Bun.file(resolve(portalDir, 'out/Harness.sol/FakeRegistry.json')).json()) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const client = createPublicClient({ transport: http(rpcUrl) });
  const hash = await wallet.deployContract({
    abi: artifact.abi as [],
    bytecode: artifact.bytecode.object,
    chain: null,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('the stand-in Registry did not deploy');
  return receipt.contractAddress;
}

// Spawned without blocking: a synchronous spawn would starve any JSON-RPC server in this process that
// forge talks to.
async function forgeScript(env: Record<string, string>): Promise<{ portal: Hex; yaca: Hex }> {
  const proc = Bun.spawn(
    [
      toolchainBin('aztec-forge'),
      'script',
      'script/Deploy.s.sol:Deploy',
      '--rpc-url',
      env.YACANA_L1_RPC_URL as string,
      '--broadcast',
      '--json',
      // Each transaction's gas is then the node's eth_estimateGas × 130 %. forge's own EVM lags a chain
      // that reprices: its simulation priced the portal's creation on Sepolia about 7× too low.
      '--skip-simulation',
    ],
    {
      cwd: portalDir,
      env: { ...process.env, ...env, FOUNDRY_REMAPPINGS: `forge-std/=${forgeStd}/` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  // Both pipes drain together, or a full one stalls forge.
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`forge script failed:\n${out}\n${err}`);
  // forge --json prints one JSON object per line; the script's returns land in the one with `returns`.
  for (const line of out.split('\n')) {
    try {
      const j = JSON.parse(line) as { returns?: Record<string, { value: string }> };
      if (j.returns?.portal && j.returns.yaca)
        return { portal: j.returns.portal.value as Hex, yaca: j.returns.yaca.value as Hex };
    } catch {
      /* not a JSON line */
    }
  }
  throw new Error(`forge script printed no return values:\n${out}`);
}

export async function deployL1(env: {
  rpcUrl: string;
  key: Hex;
  registry: Hex;
  operators: Hex;
}): Promise<BridgeRecord> {
  const policy = policyFor();
  const { portal, yaca } = await forgeScript({
    YACANA_L1_RPC_URL: env.rpcUrl,
    YACANA_L1_PRIVATE_KEY: env.key,
    YACANA_REGISTRY: env.registry,
    YACANA_OPERATORS: env.operators,
    YACANA_PER_HOUR: policy.perHour.toString(),
    YACANA_ALLOWANCE: policy.allowance.toString(),
    YACANA_EXIT_FLOOR: policy.exitFloor.toString(),
    YACANA_PAUSE_MAX: policy.pauseMax.toString(),
    YACANA_PAUSE_BUDGET: policy.pauseBudget.toString(),
    YACANA_LAUNCH_BACKDATE: policy.launchBackdate.toString(),
    YACANA_LAUNCH_AHEAD: policy.launchAhead.toString(),
    YACANA_LEAF_GAS: policy.leafGas.toString(),
    YACANA_TOKEN_NAME: PARAMS.TOKEN_NAME,
    YACANA_TOKEN_SYMBOL: PARAMS.TOKEN_SYMBOL,
  });
  const client = createPublicClient({ transport: http(env.rpcUrl) });
  for (const [name, address] of [
    ['portal', portal],
    ['YACA', yaca],
  ] as const) {
    const code = await client.getCode({ address });
    if (!code || code === '0x') throw new Error(`${name} at ${address} has no code`);
  }
  const chainId = await client.getChainId();
  return {
    chainId: String(chainId),
    portal,
    yaca,
    registry: env.registry,
    operators: env.operators,
    l1RpcUrl: new URL(env.rpcUrl).origin,
    deployBlock: (await client.getBlockNumber()).toString(),
  };
}

if (import.meta.main) {
  const anvilMode = process.argv.includes('--anvil');
  const recordPath = process.argv.slice(2).find((a) => a.endsWith('.json'));
  const anvil = anvilMode ? await startAnvil() : undefined;
  try {
    const rpcUrl = anvil?.rpcUrl ?? process.env.YACANA_L1_RPC_URL;
    const key = (anvil ? ANVIL_KEY : process.env.YACANA_L1_PRIVATE_KEY) as Hex | undefined;
    if (!rpcUrl || !key) throw new Error('YACANA_L1_RPC_URL and YACANA_L1_PRIVATE_KEY are required');
    const operators = (anvil ? privateKeyToAccount(ANVIL_KEY).address : process.env.YACANA_OPERATORS) as Hex;
    const registry = (anvil ? await deployFakeRegistry(rpcUrl, key) : process.env.YACANA_REGISTRY) as Hex;
    if (!operators || !registry) throw new Error('YACANA_REGISTRY and YACANA_OPERATORS are required');
    const bridge = await deployL1({ rpcUrl, key, registry, operators });
    const path = recordPath ? resolve(repoRoot, recordPath) : undefined;
    if (path && existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      // The miner trusts one portal, immutably: a record naming another cannot take this one.
      if (typeof record.portal === 'string' && record.portal.toLowerCase() !== bridge.portal.toLowerCase())
        throw new Error(`${recordPath}'s miner trusts portal ${record.portal}, not ${bridge.portal}`);
      if (record.chainId !== bridge.chainId)
        throw new Error(`${recordPath} is on chain ${record.chainId}, the portal on ${bridge.chainId}`);
      writeFileSync(path, `${JSON.stringify({ ...record, bridge }, null, 2)}\n`);
      console.log(`${recordPath}: bridge block written`);
    } else if (!anvil) {
      // No record yet (the portal comes before its first miner): the block waits beside where the
      // record will be, and `bun run deploy` folds it in.
      writeFileSync(
        resolve(repoRoot, `deployments/${PROFILE}.bridge.json`),
        `${JSON.stringify(bridge, null, 2)}\n`,
      );
      console.log(
        `deployments/${PROFILE}.bridge.json: bridge block written; bun run deploy folds it into the record`,
      );
    }
    console.log(`${PROFILE} portal ${bridge.portal}, YACA ${bridge.yaca} on chain ${bridge.chainId}`);
  } finally {
    await anvil?.stop();
  }
}
