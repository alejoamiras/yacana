// Golden vectors: a fixed PRF output and a fixed phrase must always yield these masters, fields
// and addresses. A change here is a change of every user's address.
import { describe, expect, test } from 'bun:test';
import { getSchnorrInitializerlessAccountContractAddress } from '@aztec-labs/accounts/schnorr';
import { deriveAccountFields, masterFromPrf } from './derive.ts';
import { masterFromMnemonic, normaliseWords, validWords } from './mnemonic.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const address = async (master: Uint8Array, index: number) => {
  const f = await deriveAccountFields(master, index);
  return (await getSchnorrInitializerlessAccountContractAddress(f.signingKey, f.salt, f.secret)).toString();
};

describe('key derivation', () => {
  test('a fixed PRF output → fixed master, fields and addresses per index', async () => {
    const master = await masterFromPrf(new Uint8Array(32).map((_, i) => i));
    expect(hex(master)).toBe('de93e897c657b1216ad64573d2c93a6ef07dc4601a04886ee4af745b076d66fe');
    const f0 = await deriveAccountFields(master, 0);
    expect([f0.secret.toString(), f0.salt.toString(), f0.signingKey.toString()]).toEqual([
      '0x24656dc39348d988b44bef6af0aa146b0e3b02bfc383ba8714e889c5b2a98dab',
      '0x2e13d8ed73172d5e58dc345c051484cf3b2f98c5652cc579d542beca1f8b0bff',
      '0x14449033ab81659820cf2a340bfed443564e978ed2c6aee7e6aa2fea91ac84b6',
    ]);
    expect(await address(master, 0)).toBe(
      '0x0c8828f3e685ff951d3e0d82d2161c27fcd7c5e841f69a596c435679f336df87',
    );
    expect(await address(master, 1)).toBe(
      '0x2b5d5cf352990e5e74650d490be3eef0f1411574366a2a6d80b15df421910b69',
    );
  });

  test('a fixed phrase → fixed master and address; the phrase is normalised first', async () => {
    const phrase =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const master = await masterFromMnemonic(phrase);
    expect(hex(master)).toBe('fec5845639b745673ee03414f585b1ea47bbc1491a37ba20fc85b21094113660');
    expect(await address(master, 0)).toBe(
      '0x09c2aa4b065334789de7ab2a232867fd9bd0136bcbd55e6399910e58b97af4c7',
    );
    expect(hex(await masterFromMnemonic(`  ${phrase.toUpperCase().replace(/ /g, '\n ')} `))).toBe(
      hex(master),
    );
    expect(normaliseWords(' A  b\tc ')).toBe('a b c');
  });

  test('fails closed: short PRF, wrong-size master, bad phrase, negative index', async () => {
    await expect(masterFromPrf(new Uint8Array(31))).rejects.toThrow(/expected 32/);
    await expect(deriveAccountFields(new Uint8Array(16), 0)).rejects.toThrow(/expected 32/);
    await expect(deriveAccountFields(new Uint8Array(32), -1)).rejects.toThrow(/index/);
    expect(validWords('abandon abandon abandon')).toBe(false);
    expect(
      validWords(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
      ),
    ).toBe(false);
    await expect(masterFromMnemonic('twelve wrong words')).rejects.toThrow(/twelve-word/);
  });
});
