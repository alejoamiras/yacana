// The claim checks against a real node (`AZTEC_NODE_URL`, as `bun run e2e:agent` sets it): the tips
// they pin reads to answer, and the answers have the shapes the checks read. Nothing is deployed at the
// address read, so its slots are zero: epoch 0 open, the version not retired.
import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TxHash } from '@aztec/stdlib/tx';
import type { Deployment } from '../src/chain.ts';
import { absentAt, canMint, carrier, fate, tipAt } from '../src/claim-check.ts';

const url = process.env.AZTEC_NODE_URL;

describe.skipIf(!url)('the claim checks on a live node', () => {
  const node = createAztecNodeClient(url ?? '');
  const d = {
    node,
    miner: {
      address: AztecAddress.fromBigIntUnsafe(0x7acan),
      artifact: { storageLayout: { open_epoch: { slot: new Fr(1n) }, retired: { slot: new Fr(2n) } } },
    },
  } as unknown as Deployment;

  test('reads pinned to a tip answer: the time at each, an absent nullifier, the miner slots', async () => {
    const checkpointed = await tipAt(d, 'checkpointed');
    expect(checkpointed).toBeGreaterThan(0);
    expect(await tipAt(d, 'latest')).toBeGreaterThanOrEqual(checkpointed as number);
    expect(await absentAt(d, Fr.random().toString(), 'checkpointed')).toBe(true);
    expect(await canMint(d, 0n, 'checkpointed')).toBe(true);
    expect(await canMint(d, 0n, 'latest')).toBe(true);
    expect(await canMint(d, 1n, 'latest')).toBe('unknown');
  });

  test('a send the node never saw is dropped; a nullifier in a block is found there, its transaction mined with its effect', async () => {
    expect(await fate(d, TxHash.random().toString())).toBe('dropped');
    let found: { block: number; nullifier: string; tx: string } | undefined;
    for (let n = await node.getBlockNumber(); n >= 1 && !found; n--) {
      const fx = (await node.getBlock(n, { includeTransactions: true }))?.body.txEffects.find(
        (e) => e.nullifiers.length > 0,
      );
      if (fx) found = { block: n, nullifier: fx.nullifiers[0]?.toString() ?? '', tx: fx.txHash.toString() };
    }
    if (!found) throw new Error('no block on this node carries a transaction');
    expect(await carrier(d, found.nullifier)).toMatchObject({ block: found.block, txHash: found.tx });
    expect(await absentAt(d, found.nullifier, 'latest')).toBe(false);
    const f = await fate(d, found.tx);
    expect(typeof f === 'object' ? f.block : f).toBe(found.block);
  });
});
