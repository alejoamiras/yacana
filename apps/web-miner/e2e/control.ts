// The control server of a bridge-mode e2e run on the isolated network: the node's debug API for
// warps and proves, the operator script's own forward. Spawned detached by run-setup, killed by
// teardown.
//
//   bun e2e/control.ts <port> <record-path> <node-url> <l1-rpc-url> <archive-path>
//   YACANA_L1_PRIVATE_KEY names the operators key (a throwaway anvil account).
import { createAztecNodeDebugClient } from '@aztec-labs/stdlib/interfaces/client';
import { forwardAll } from '@yacana/deploy/bridge/forward';
import { openOperator } from '@yacana/deploy/bridge/operator';
import { serveControl } from '@yacana/localnet/control';
import type { Hex } from 'viem';

const [port, record, nodeUrl, l1RpcUrl, archive] = process.argv.slice(2);
const key = process.env.YACANA_L1_PRIVATE_KEY as Hex | undefined;
if (!port || !record || !nodeUrl || !l1RpcUrl || !archive || !key)
  throw new Error(
    'usage: control.ts <port> <record> <node-url> <l1-rpc-url> <archive>; YACANA_L1_PRIVATE_KEY set',
  );

/** One local-network slot; the rig warps in the same unit. */
const SLOT_SECONDS = 72;
const debug = createAztecNodeDebugClient(nodeUrl);
const op = await openOperator({ record, rpcUrl: l1RpcUrl, key });

const { url } = serveControl(Number(port), {
  ping: async () => 'pong',
  // Five slots close the exit's epoch whatever slot it landed in; the prove settles it on Ethereum.
  settle: async () => {
    await debug.warpL2TimeAtLeastBy(SLOT_SECONDS * 5);
    await debug.prove();
  },
  // A message sent while checkpoint N is the tip is served once the tip reaches N+3; four slots cover it.
  nudge: async () => {
    for (let i = 0; i < 4; i++) await debug.warpL2TimeAtLeastBy(SLOT_SECONDS);
  },
  forward: async () => {
    const report = await forwardAll(op, { source: op.record, sourceNodeUrl: nodeUrl, archive });
    return { forwarded: report.forwarded.length, failed: report.failed.length, archived: report.archived };
  },
});
console.log(`control: ${url} (record ${record})`);
