import { describe, expect, test } from 'bun:test';
import { masterFromPrf } from '@yacana/miner-core/keys/derive';
import { masterFromMnemonic } from '@yacana/miner-core/keys/mnemonic';
import {
  addressUnderClass,
  buildClasses,
  currentAccountClassId,
  fingerprintOf,
  PREVIOUS_ACCOUNT_CLASS_ID,
} from '../src/keys/classes.ts';
import { addressOf } from '../src/keys/store.ts';

const master = new Uint8Array(32).map((_, i) => i);

describe('account classes', () => {
  test("the recipe under the build's class is the SDK's own address", async () => {
    const id = await currentAccountClassId();
    expect(await addressUnderClass(master, 0, id)).toBe(await addressOf(master, 0));
    // Another class, another address for the same master.
    expect(await addressUnderClass(master, 0, `0x${'01'.repeat(32)}`)).not.toBe(await addressOf(master, 0));
  });

  test("the previous recipe derives the last build's addresses", async () => {
    // derive.test.ts's golden addresses as Aztec 5.2.0 computed them.
    const { previous } = await buildClasses();
    const prf = await masterFromPrf(new Uint8Array(32).map((_, i) => i));
    expect(await previous.addressOf(prf, 0)).toBe(
      '0x1362161bb2ff9ebba63f4e42484fcdfade31b6ed33e8226a686cd0f5443e474b',
    );
    expect(await previous.addressOf(prf, 1)).toBe(
      '0x02979e139de8899030bca0c3cce3794bc78804d2aabf09285f960d77c9340ba9',
    );
    const phrase = await masterFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    expect(await previous.addressOf(phrase, 0)).toBe(
      '0x1d344823544184dcd59804da14432bb50f4f71d0aef001afd581b06638d5ebc1',
    );
  });

  test("the build's class is pinned; an SDK bump moves it, and the previous recipe, on purpose", async () => {
    expect(await currentAccountClassId()).toBe(
      '0x222287bfcd04411264393983dd8d01ca5ea9ae305d1a10a1e6d8deef7f17659b',
    );
    expect(PREVIOUS_ACCOUNT_CLASS_ID).not.toBe(await currentAccountClassId());
  });

  test('the fingerprint names the master, not a class, and differs per master', async () => {
    const fp = await fingerprintOf(master);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintOf(master)).toBe(fp);
    expect(await fingerprintOf(new Uint8Array(32).fill(5))).not.toBe(fp);
    expect(fp).not.toBe(await addressOf(master, 0));
  });
});
