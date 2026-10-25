// What an automine warp waits for first. 6.0.0's rollup refuses a checkpoint that leaves an Inbox
// bucket past its cutoff unconsumed, and the automine sequencer builds from what its archiver holds:
// a warp sent between an Inbox write and the archiver's next poll proposes without the message,
// reverts in simulation and mines nothing.
import { InboxAbi } from '@aztec-foundation/l1-artifacts/InboxAbi';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { getPublicClient } from '@aztec-labs/ethereum/client';
import { Fr } from '@aztec-labs/foundation/curves/bn254';

const POLL_MS = 250;

/**
 * Resolves once the node's archiver holds the last message on its rollup's Inbox; the archiver
 * syncs the Inbox in order, so every earlier one is held too. Throws after `timeoutMs`.
 */
export async function untilInboxSynced(nodeUrl: string, l1RpcUrl: string, timeoutMs = 60_000): Promise<void> {
  const node = createAztecNodeClient(nodeUrl);
  const { l1ChainId, l1ContractAddresses } = await node.getNodeInfo();
  const l1 = getPublicClient({ l1RpcUrls: [l1RpcUrl], l1ChainId });
  const sent = await l1.getContractEvents({
    address: l1ContractAddresses.inboxAddress.toString(),
    abi: InboxAbi,
    eventName: 'MessageSent',
    fromBlock: 0n,
  });
  const last = sent.at(-1)?.args.hash;
  if (!last) return;
  const deadline = Date.now() + timeoutMs;
  while ((await node.getL1ToL2MessageIndex(Fr.fromHexString(last))) === undefined) {
    if (Date.now() > deadline)
      throw new Error(
        `the node at ${nodeUrl} has not synced Inbox message ${last} after ${timeoutMs / 1000} s`,
      );
    await Bun.sleep(POLL_MS);
  }
}
