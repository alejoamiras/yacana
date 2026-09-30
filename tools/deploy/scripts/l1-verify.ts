// Publishes a record's portal and YACA source on Etherscan through the pinned forge, under the
// settings `l1-deploy.ts` compiled them with. The key is read from the environment by forge itself,
// never placed on a command line; a contract already verified passes.
//
//   ETHERSCAN_API_KEY=… bun tools/deploy/scripts/l1-verify.ts deployments/<profile>.json
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { policyFor } from '@yacana/bridge/policy';
import type { BridgeRecord } from '@yacana/bridge/record';
import { repoRoot } from '@yacana/localnet/toolchain';
import { PARAMS, PROFILE } from '@yacana/miner-core/generated/params';
import { encodeAbiParameters, type Hex } from 'viem';

const forgeScript = resolve(repoRoot, 'protocol/portal/scripts/forge.ts');

async function verify(address: string, contract: string, chainId: string, args: Hex): Promise<void> {
  const child = Bun.spawn(
    [
      process.execPath,
      forgeScript,
      'verify-contract',
      address,
      contract,
      '--chain',
      chainId,
      '--constructor-args',
      args,
      '--watch',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if ((await child.exited) !== 0) throw new Error(`${contract} at ${address} did not verify`);
}

// What l1-deploy.ts passed: the record's Registry and operators, the policy, the token metadata. A
// public RPC may have pruned the creation receipt, so nothing is read back from the chain; an
// argument that differs fails Etherscan's bytecode comparison.
export function constructorArgs(bridge: BridgeRecord): { portal: Hex; yaca: Hex } {
  const p = policyFor();
  const portal = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      {
        type: 'tuple',
        components: [
          { name: 'perHour', type: 'uint128' },
          { name: 'allowance', type: 'uint128' },
          { name: 'exitFloor', type: 'uint64' },
          { name: 'pauseMax', type: 'uint64' },
          { name: 'pauseBudget', type: 'uint64' },
          { name: 'launchBackdate', type: 'uint64' },
          { name: 'launchAhead', type: 'uint64' },
          { name: 'leafGas', type: 'uint256' },
        ],
      },
      { type: 'string' },
      { type: 'string' },
    ],
    [bridge.registry as Hex, bridge.operators as Hex, p, PARAMS.TOKEN_NAME, PARAMS.TOKEN_SYMBOL],
  );
  const yaca = encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'address' }],
    [PARAMS.TOKEN_NAME, PARAMS.TOKEN_SYMBOL, bridge.portal as Hex],
  );
  return { portal, yaca };
}

if (import.meta.main) {
  const recordPath = process.argv[2];
  if (!recordPath?.endsWith('.json') || !process.env.ETHERSCAN_API_KEY)
    throw new Error(
      'usage: ETHERSCAN_API_KEY=… bun tools/deploy/scripts/l1-verify.ts deployments/<profile>.json',
    );
  // The arguments are rebuilt from the params the deploy read, so they must be this record's profile.
  if (basename(recordPath) !== `${PROFILE}.json`)
    throw new Error(`${recordPath} is not the generated profile's record (deployments/${PROFILE}.json)`);
  const { bridge } = JSON.parse(readFileSync(resolve(repoRoot, recordPath), 'utf8')) as {
    bridge?: BridgeRecord;
  };
  if (!bridge) throw new Error(`${recordPath} has no bridge block`);

  const args = constructorArgs(bridge);
  await verify(bridge.portal, 'src/YacanaPortal.sol:YacanaPortal', bridge.chainId, args.portal);
  await verify(bridge.yaca, 'src/YACA.sol:YACA', bridge.chainId, args.yaca);
  console.log(
    `${recordPath}: portal ${bridge.portal} and YACA ${bridge.yaca} verified on chain ${bridge.chainId}`,
  );
}
