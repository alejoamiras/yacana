// Retiring a version, in the order the portal enforces: the transition after it observed, the
// retire message sent into its Inbox (once, from the portal, so its existence is the authority),
// and the message consumed on the old chain — from then on no claim mints there, while exits and
// arrivals go on. The L1 step is idempotent: sent already, it yields the same index from the log.

import { waitForL1ToL2MessageReady } from '@aztec-labs/aztec.js/messaging';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { INBOX_BUCKET_GAS, retireLeaf } from '@yacana/bridge/inbox';
import { scanLogs } from '@yacana/bridge/logs';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { type Hex, parseEventLogs } from 'viem';
import type { L2Side } from './l2.ts';
import { confirmed, type Operator, writeOpts } from './operator.ts';
import { noteAllTransitions } from './transition.ts';

export interface RetireSent {
  version: bigint;
  txHash: Hex;
  /** The message's index in the version's Inbox: what the L2 `retire` names. */
  inboxIndex: bigint;
  /** The message was already on its way: nothing was sent this time. */
  resumed: boolean;
}

/**
 * The `Retired` event of an earlier send, for a rerun whose L2 step is still owed: searched from the
 * portal's deploy block (the record's, or genesis) to the head, one window at a time.
 */
async function sentBefore(op: Operator, version: bigint): Promise<RetireSent> {
  const [log] = await scanLogs(op.publicClient, {
    address: op.portal.address,
    abi: yacanaPortalAbi,
    eventName: 'Retired',
    args: { version },
    fromBlock: BigInt(op.record.bridge.deployBlock ?? 0),
    toBlock: await op.publicClient.getBlockNumber(),
    first: true,
  });
  if (log?.args.inboxIndex === undefined)
    throw new Error(
      `the portal holds version ${version} as retired but the RPC serves no Retired log for it`,
    );
  return { version, txHash: log.transactionHash, inboxIndex: log.args.inboxIndex, resumed: true };
}

export async function retireOnL1(op: Operator, version: bigint): Promise<RetireSent> {
  await noteAllTransitions(op);
  if ((await op.portal.read.flipAt([version])) === 0n)
    throw new Error(`version ${version} has not been flipped away from: nothing to retire`);
  if ((await op.portal.read.versionInfo([version])).retireSent) return sentBefore(op, version);
  // The retire message may open a bucket its estimate appended to (`INBOX_BUCKET_GAS`).
  const gas = (await op.portal.estimateGas.retire([version], writeOpts(op))) + INBOX_BUCKET_GAS;
  const txHash = await confirmed(op, () => op.portal.write.retire([version], { ...writeOpts(op), gas }));
  const receipt = await op.publicClient.getTransactionReceipt({ hash: txHash });
  const [retired] = parseEventLogs({ abi: yacanaPortalAbi, eventName: 'Retired', logs: receipt.logs });
  if (!retired) throw new Error(`retire ${txHash} emitted no Retired event`);
  return { version, txHash, inboxIndex: retired.args.inboxIndex, resumed: false };
}

/** Consumes the retire message on the old chain once the node has synced it (minutes on a real L1). */
export async function retireOnL2(
  l2: L2Side,
  portal: Hex,
  sent: Pick<RetireSent, 'version' | 'inboxIndex'>,
  timeoutSeconds = 1800,
) {
  const served = BigInt((await l2.node.getNodeInfo()).rollupVersion);
  if (served !== sent.version)
    throw new Error(`the node serves version ${served}; the retire was for ${sent.version}`);
  const leaf = await retireLeaf(
    {
      chainId: l2.chainId,
      rollupVersion: l2.rollupVersion,
      miner: AztecAddress.fromStringUnsafe(l2.miner.address.toString()),
      portal: EthAddress.fromString(portal),
    },
    sent.inboxIndex,
  );
  await waitForL1ToL2MessageReady(l2.node, leaf, { timeoutSeconds });
  const result = await l2.miner.methods
    .retire(sent.inboxIndex)
    .send({ from: l2.from, fee: l2.fee, wait: { timeout: 600 } });
  return result.receipt.txHash.toString();
}
