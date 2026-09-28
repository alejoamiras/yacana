import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { Deployment } from '../src/chain.ts';
import { canMint } from '../src/claim-check.ts';

const OPEN = new Fr(1n);
const RETIRED = new Fr(2n);

const deployment = (open: () => Promise<Fr>, retired: () => Promise<Fr>) =>
  ({
    node: {
      getPublicStorageAt: (_tip: string, _at: AztecAddress, slot: Fr) =>
        slot.equals(OPEN) ? open() : retired(),
    },
    miner: {
      address: AztecAddress.fromBigIntUnsafe(7n),
      artifact: { storageLayout: { open_epoch: { slot: OPEN }, retired: { slot: RETIRED } } },
    },
  }) as unknown as Deployment;

describe('canMint', () => {
  test('one storage read failing while the other is out answers unknown only once both have ended', async () => {
    let release = () => {};
    const held = new Promise<Fr>((r) => {
      release = () => r(Fr.ZERO);
    });
    let answer: boolean | 'unknown' | undefined;
    const asked = canMint(
      deployment(
        () => Promise.reject(new Error('rpc error')),
        () => held,
      ),
      3n,
      'latest',
    ).then((a) => {
      answer = a;
    });
    await Bun.sleep(20);
    expect(answer).toBeUndefined();
    release();
    await asked;
    expect(answer).toBe('unknown');
  });
});
