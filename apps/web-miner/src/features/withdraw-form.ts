// Withdraw validation, pure: addresses through the SDK parser, amounts as decimal strings to
// bigint (no floats), the reviewed snapshot is what gets sent.
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';

export type Mode = 'private' | 'public';

export interface Draft {
  to: string;
  amount: string;
  mode: Mode;
}

export interface Snapshot {
  to: AztecAddress;
  amount: bigint;
  mode: Mode;
  /** The amount as typed, for the review line. */
  display: string;
}

/** "1.5" with 18 decimals → 1500000000000000000n; rejects anything but digits and one point. */
export function parseAmount(text: string, decimals: number): bigint {
  const m = text.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error('amount must be a number like 1.5');
  const whole = m[1] as string;
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  if ((m[2] ?? '').length > decimals) throw new Error(`at most ${decimals} decimal places`);
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac);
  if (value === 0n) throw new Error('amount must be more than zero');
  return value;
}

/** The form's line under the amount the moment it is known: nothing while the amount is fine. */
export function amountRefusal(text: string, balance: bigint, decimals: number): string | null {
  if (text.trim() === '') return 'Enter an amount.';
  try {
    return parseAmount(text, decimals) > balance ? 'More than your balance.' : null;
  } catch (e) {
    return e instanceof Error ? `${e.message[0]?.toUpperCase()}${e.message.slice(1)}.` : String(e);
  }
}

/** The form's line under the address, once the field is left: the four refusals in the user's words. */
export async function recipientRefusal(text: string, self: string): Promise<string | null> {
  const t = text.trim();
  if (t === '') return null;
  if (t === self) return "That's this account.";
  try {
    await parseRecipient(t, self);
    return null;
  } catch {
    return 'Not an Aztec address: 66 characters, starting with 0x.';
  }
}

export async function parseRecipient(text: string, self: string): Promise<AztecAddress> {
  let to: AztecAddress;
  try {
    to = AztecAddress.fromStringUnsafe(text.trim());
  } catch {
    throw new Error('not an Aztec address');
  }
  if (to.isZero()) throw new Error('the zero address cannot receive');
  if (to.toString() === self) throw new Error('that is this account');
  if (!(await to.isValid())) throw new Error('not a valid Aztec address');
  return to;
}

/** Everything checked at review time; the send uses this object and nothing from the form. */
export async function review(d: Draft, self: string, balance: bigint, decimals: number): Promise<Snapshot> {
  const to = await parseRecipient(d.to, self);
  const amount = parseAmount(d.amount, decimals);
  if (amount > balance) throw new Error('more than the private balance');
  return { to, amount, mode: d.mode, display: d.amount.trim() };
}
