import { describe, expect, test } from 'vitest';
import { FEE_JUICE_SYMBOL, MOCK_TIMING, MOCK_TOKENS, mockFunding, scriptFrom } from './mock';
import type { Token } from './provider';
import {
  commitOf,
  fileName,
  MAX_RECORD_BYTES,
  newRecord,
  parseRecord,
  RecordRefused,
  STAND_IN_MASTER,
  toFile,
} from './recovery';

const SCOPE = { chainId: '11155111', rollupVersion: '7' };
const byName = (symbol: string) =>
  MOCK_TOKENS.find((t) => t.chainId === 11155111 && t.symbol === symbol) as Token;
const USDC = byName('USDC');
const FJ = byName(FEE_JUICE_SYMBOL);
const record = newRecord(SCOPE, { token: USDC, amountIn: 100_000_000n }, 1_700_000_000_000, 123_456);
const base = toFile(record);
const variant = (patch: object) => JSON.stringify({ ...base, ...patch });
const withToken = (patch: object) => variant({ hint: { ...base.hint, token: { ...USDC, ...patch } } });
/** HKDF-SHA256 (RFC 5869) under the miner's KDF salt, then SHA-256, computed outside this code. */
const PINNED = '0x23957db03ccbc3f6ab2cc4919ae0c53aa7a8bc3c5423c9478f5b9eb9d34eaa6c';

describe('the recovery record', () => {
  test('a record round-trips through its file to the same commitment; another index, scope or master gives another', async () => {
    const back = parseRecord(JSON.stringify(base), SCOPE);
    expect(back).toEqual(record);
    expect(fileName(back)).toBe('yacana-fees-11155111-123456.json');
    const commit = await commitOf(STAND_IN_MASTER, back);
    // Pinned: a changed label or derivation orphans every funding a file names.
    expect(commit).toBe(PINNED);
    expect(await commitOf(STAND_IN_MASTER, { ...record, index: record.index + 1 })).not.toBe(commit);
    expect(await commitOf(STAND_IN_MASTER, { ...record, rollupVersion: '8' })).not.toBe(commit);
    expect(await commitOf(new Uint8Array(32), record)).not.toBe(commit);
  });

  test('a file off its size, kind, network or shape is refused with the reason; a well-formed one is read', () => {
    const refused: [string, string][] = [
      [' '.repeat(MAX_RECORD_BYTES + 1), 'larger than a recovery file'],
      ['{"v":1,', 'not a fee funding'],
      ['[1]', 'not a fee funding'],
      [variant({ v: 2 }), 'not a fee funding'],
      [variant({ kind: 'yacana-bridge' }), 'not a fee funding'],
      [variant({ chainId: '1' }), 'another network'],
      [variant({ rollupVersion: '8' }), 'another network'],
      [variant({ chainId: 11155111 }), 'chainId is malformed'],
      [variant({ index: 2 ** 48 }), 'index is malformed'],
      [variant({ index: 1.5 }), 'index is malformed'],
      [variant({ createdAt: -1 }), 'createdAt is malformed'],
      [variant({ account: '0x0123' }), 'record.account is malformed'],
      [variant({ hint: { ...base.hint, amountIn: '0' } }), 'hint.amountIn is malformed'],
      [variant({ hint: { ...base.hint, amountIn: '1e6' } }), 'hint.amountIn is malformed'],
      [withToken({ address: '0xusdc' }), 'hint.token.address is malformed'],
      [withToken({ symbol: '<img src=x onerror=alert(1)>' }), 'hint.token.symbol is malformed'],
      [withToken({ symbol: 'US‮DC' }), 'hint.token.symbol is malformed'],
      [withToken({ decimals: 77 }), 'hint.token.decimals is malformed'],
      [withToken({ balance: '1' }), 'hint.token.balance is malformed'],
    ];
    for (const [text, reason] of refused) {
      const read = () => parseRecord(text, SCOPE);
      expect(read, text.slice(0, 60)).toThrow(RecordRefused);
      expect(read, text.slice(0, 60)).toThrow(reason);
    }
    expect(parseRecord(JSON.stringify(base), SCOPE)).toEqual(record);
  });

  test('two files with different tokens and amounts resume as their own funding against fresh mocks', async () => {
    const files = [
      newRecord(SCOPE, { token: USDC, amountIn: 100_000_000n }, 0, 1),
      newRecord(SCOPE, { token: FJ, amountIn: 40n * 10n ** 18n }, 0, 2),
    ];
    const found = await Promise.all(
      files.map(async (r) => {
        const back = parseRecord(JSON.stringify(toFile(r)), SCOPE);
        const commit = await commitOf(STAND_IN_MASTER, back);
        const { provider } = mockFunding(scriptFrom(''), { ...MOCK_TIMING, quote: 0 });
        return provider.resume({ commit, hint: back.hint }, new AbortController().signal);
      }),
    );
    expect(found.map((f) => [f?.quote.from.symbol, f?.quote.amountIn, f?.landed])).toEqual([
      ['USDC', 100_000_000n, ['swap', 'deposit']],
      [FEE_JUICE_SYMBOL, 40n * 10n ** 18n, ['deposit']],
    ]);
  });
});
