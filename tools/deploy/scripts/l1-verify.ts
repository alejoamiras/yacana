// Publishes a record's portal and YACA source on Etherscan through the pinned forge, under the
// settings `l1-deploy.ts` compiled them with. The key is read from the environment by forge itself,
// never placed on a command line; a contract already verified passes.
//
//   ETHERSCAN_API_KEY=… bun tools/deploy/scripts/l1-verify.ts deployments/<profile>.json
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BridgeRecord } from '@yacana/bridge/record';
import { repoRoot } from '@yacana/localnet/toolchain';
import { createPublicClient, encodeAbiParameters, type Hex, http, parseAbi } from 'viem';

const forgeScript = resolve(repoRoot, 'protocol/portal/scripts/forge.ts');

async function verify(address: Hex, contract: string, chainId: string, extra: string[]): Promise<void> {
  const child = Bun.spawn(
    [
      process.execPath,
      forgeScript,
      'verify-contract',
      address,
      contract,
      '--chain',
      chainId,
      '--watch',
      ...extra,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if ((await child.exited) !== 0) throw new Error(`${contract} at ${address} did not verify`);
}

const recordPath = process.argv[2];
if (!recordPath?.endsWith('.json') || !process.env.ETHERSCAN_API_KEY)
  throw new Error(
    'usage: ETHERSCAN_API_KEY=… bun tools/deploy/scripts/l1-verify.ts deployments/<profile>.json',
  );
const { bridge } = JSON.parse(readFileSync(resolve(repoRoot, recordPath), 'utf8')) as {
  bridge?: BridgeRecord;
};
if (!bridge) throw new Error(`${recordPath} has no bridge block`);
const portal = bridge.portal as Hex;
const yaca = bridge.yaca as Hex;
const rpcUrl = process.env.YACANA_L1_RPC_URL ?? bridge.l1RpcUrl;

// The portal is its own creation transaction, so forge reads its arguments back; YACA is created
// inside that constructor, so its arguments are rebuilt from what the token reports.
await verify(portal, 'src/YacanaPortal.sol:YacanaPortal', bridge.chainId, [
  '--rpc-url',
  rpcUrl,
  '--guess-constructor-args',
]);
const client = createPublicClient({ transport: http(rpcUrl) });
const erc20 = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']);
const [name, symbol] = await Promise.all([
  client.readContract({ address: yaca, abi: erc20, functionName: 'name' }),
  client.readContract({ address: yaca, abi: erc20, functionName: 'symbol' }),
]);
const yacaArgs = encodeAbiParameters(
  [{ type: 'string' }, { type: 'string' }, { type: 'address' }],
  [name, symbol, portal],
);
await verify(yaca, 'src/YACA.sol:YACA', bridge.chainId, ['--constructor-args', yacaArgs]);
console.log(
  `${recordPath}: portal ${bridge.portal} and YACA ${bridge.yaca} verified on chain ${bridge.chainId}`,
);
