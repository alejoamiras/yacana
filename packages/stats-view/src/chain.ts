// The reader the beats read through: the deployment check, the layouts, the node; and the latest block.
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
  assertDeployment,
  expectedFromStrings,
  type Node,
  type SlotLoader,
  type StorageLayout,
} from '@yacana/miner-core/reader';
import { type Connection, expectedDeployment } from '@yacana/web-kit/browser/connection';
import { chunkLoader, fetchLayouts } from '@yacana/web-kit/browser/slots';

/** The poll's cadence; the banner calls the numbers stale after two of them. */
export const POLL_MS = 30_000;

export interface Reader {
  node: Node;
  miner: AztecAddress;
  token: AztecAddress;
  minerLayout: StorageLayout;
  tokenLayout: StorageLayout;
  load: SlotLoader;
}

/** The boot check through the host's client, then the layouts the reads need. */
export async function openReader(connection: Connection, node: Node): Promise<Reader> {
  const layout = await fetchLayouts();
  const expected = expectedDeployment();
  await assertDeployment(
    node,
    expectedFromStrings({
      chainId: expected.chainId.toString(),
      rollupVersion: expected.rollupVersion.toString(),
      rollupAddress: expected.rollupAddress,
      miner: connection.miner,
      minerClassId: expected.minerClassId,
      token: connection.token,
      tokenClassId: expected.tokenClassId,
    }),
    layout.miner,
  );
  return {
    node,
    miner: AztecAddress.fromStringUnsafe(connection.miner),
    token: AztecAddress.fromStringUnsafe(connection.token),
    minerLayout: layout.miner,
    tokenLayout: layout.token,
    load: chunkLoader(),
  };
}
