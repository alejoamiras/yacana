// bun test (not Vitest): the kv-store suite uses the jest globals bun provides.
import { describe, expect, test } from 'bun:test';
import { Fq, Fr } from '@aztec-labs/foundation/curves/bn254';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
// Not exported by the package barrel; the hoisted layout makes the path stable.
import { describeAztecMap } from '../../../node_modules/@aztec-labs/kv-store/dest/interfaces/map_test_suite.js';
import { WalletDB } from '../../../node_modules/@aztec-labs/wallets/dest/embedded/wallet_db.js';
import { MemoryKvStore } from '../src/wallet/memory-store.ts';

describeAztecMap('MemoryKvStore', () => Promise.resolve(new MemoryKvStore()), true);

describe('MemoryKvStore under the WalletDB', () => {
  test('stores, lists and retrieves an account; nothing survives close()', async () => {
    const store = new MemoryKvStore();
    const db = new WalletDB(store, () => {});
    const address = await AztecAddress.random();
    const secretKey = Fr.random();
    const signingKey = Fq.random();
    await db.storeAccount(address, {
      type: 'schnorr_initializerless',
      secretKey,
      salt: Fr.ZERO,
      signingKey,
      alias: undefined,
    });
    expect((await db.listAccounts()).map((a) => a.item.toString())).toEqual([address.toString()]);
    const got = await db.retrieveAccount(address);
    expect(got.secretKey.equals(secretKey)).toBe(true);
    expect(Buffer.from(got.signingKey as Uint8Array).equals(signingKey.toBuffer())).toBe(true);
    await db.close();
    expect(await store.estimateSize()).toMatchObject({ numItems: 0 });
    expect(await new WalletDB(store, () => {}).listAccounts()).toEqual([]);
  });
});
