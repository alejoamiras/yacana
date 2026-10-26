// bun: the address validity check runs Grumpkin through bb.js, which jsdom cannot host.
import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { ethRefusal } from '../src/bridge/forms.ts';
import { amountRefusal, recipientRefusal, review } from '../src/features/withdraw-form.ts';

describe('withdraw review', () => {
  test('the snapshot carries the parsed recipient, integer amount and mode; every refusal names its reason', async () => {
    const self = (await AztecAddress.random()).toString();
    const to = await AztecAddress.random();
    const ok = await review(
      { to: ` ${to.toString()} `, amount: '1.25', mode: 'private' },
      self,
      2n * 10n ** 18n,
      18,
    );
    expect(ok.to.equals(to)).toBe(true);
    expect(ok.amount).toBe(125n * 10n ** 16n);
    expect(ok.mode).toBe('private');
    expect(ok.display).toBe('1.25');
    const attempt = (d: Partial<{ to: string; amount: string }>) =>
      review({ to: to.toString(), amount: '1', mode: 'public', ...d }, self, 10n ** 18n, 18);
    await expect(attempt({ to: 'nope' })).rejects.toThrow(/not an Aztec address/);
    await expect(attempt({ to: AztecAddress.ZERO.toString() })).rejects.toThrow(/zero address/);
    await expect(attempt({ to: self })).rejects.toThrow(/this account/);
    // In the field but not a Grumpkin x-coordinate (about half of all small integers).
    let x = 1n;
    while (await AztecAddress.fromBigIntUnsafe(x).isValid()) x++;
    await expect(attempt({ to: AztecAddress.fromBigIntUnsafe(x).toString() })).rejects.toThrow(/valid/);
    await expect(attempt({ amount: '1.5' })).rejects.toThrow(/more than the private balance/);
  });
});

describe("the forms' refusals, in the user's words", () => {
  test('the amount on input, the address once the field is left; nothing while a field is fine or empty', async () => {
    const self = (await AztecAddress.random()).toString();
    const other = (await AztecAddress.random()).toString();
    expect(amountRefusal('', 10n ** 18n, 18)).toBe('Enter an amount.');
    expect(amountRefusal('5', 10n ** 18n, 18)).toBe('More than your balance.');
    expect(amountRefusal('abc', 10n ** 18n, 18)).toBe('Amount must be a number like 1.5.');
    expect(amountRefusal('0.5', 10n ** 18n, 18)).toBeNull();
    expect(await recipientRefusal('', self)).toBeNull();
    expect(await recipientRefusal(self, self)).toBe("That's this account.");
    expect(await recipientRefusal('0x1a2b', self)).toBe(
      'Not an Aztec address: 66 characters, starting with 0x.',
    );
    expect(await recipientRefusal(` ${other} `, self)).toBeNull();
    expect(ethRefusal('')).toBeNull();
    expect(ethRefusal('0x1234')).toBe('Not an Ethereum address: 42 characters, starting with 0x.');
    expect(ethRefusal(`0x${'0'.repeat(40)}`)).toBe('The zero address cannot receive.');
    expect(ethRefusal('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBeNull();
  });
});
