import { describe, expect, test } from 'bun:test';
import { classifyClaimFailure, revertCause } from './claim-failure.ts';

// The strings aztec.js 5.2.0, the node and the PXE produce (utils/node.js waitForTx; the tagging sync). The
// first two as the owner's ledger showed them (hashes shortened there), the third from a replay on the
// isolated network.
const FIXTURES: [string, ReturnType<typeof classifyClaimFailure>][] = [
  [
    'Block hash 0x2766a372…842993c6 not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred.',
    'anchor-pruned',
  ],
  ['no effects for 0x075d240a…e0e4d505', 'lost'],
  [
    'C++ simulation failed: AVM simulation failed: [R_NULLIFIER_INSERTION] UNRECOVERABLE ERROR! Nullifier collision: Attempted to emit duplicate siloed nullifier 0x2f592d1831b66d2d77abac2db2c392a4eab588c8a2ba6dabd074a3807adc1c25.',
    'landed-elsewhere',
  ],
  ['Invalid tx: Existing nullifier', 'landed-elsewhere'],
  ['Invalid tx: Invalid expiration timestamp', 'expired'],
  ['Transaction 0x0a1b was dropped. Reason: Invalid expiration timestamp', 'expired'],
  ['Transaction 0x0a1b was dropped. Reason: Tx dropped by P2P node: include_by_timestamp passed', 'expired'],
  ['Transaction 0x0a1b was dropped. Reason: unknown', 'other'],
  ['Transaction 0x0a1b reverted: app_logic_reverted. Reason: Assertion failed: epoch closed', 'reverted'],
  ['Transaction 0x0a1b reverted: both_reverted. Reason: unknown', 'reverted'],
  ['Simulation error: Assertion failed: epoch is not open', 'refused'],
  ['Simulation error: Nullifier read request failed for note 0x…', 'delivery-blocked'],
  ['unknown nullifier 0x12', 'delivery-blocked'],
  ['fetch failed', 'other'],
  ['', 'other'],
];

describe('classifyClaimFailure', () => {
  test.each(FIXTURES)('%s → %s', (message, expected) => {
    expect(classifyClaimFailure(new Error(message))).toBe(expected);
  });
  test('a revert names its cause: the miner\'s stale claim, else the reason after "Reason:"', () => {
    expect(
      revertCause('Transaction 0x1 reverted: app_logic_reverted. Reason: Assertion failed: stale claim'),
    ).toEqual({
      stale: true,
    });
    expect(
      revertCause('Transaction 0x1 reverted: app_logic_reverted. Reason: Assertion failed: retired'),
    ).toEqual({
      stale: false,
      reason: 'Assertion failed: retired',
    });
    // A 5.2.0 receipt carries no reason: the SDK's "unknown" is no reason at all.
    expect(revertCause('Transaction 0x1 reverted: app_logic_reverted. Reason: unknown')).toEqual({
      stale: false,
    });
    expect(revertCause('reverted')).toEqual({ stale: false });
  });
  test('non-Error values are classified from their string form', () => {
    expect(classifyClaimFailure('Invalid expiration timestamp')).toBe('expired');
    expect(classifyClaimFailure({})).toBe('other');
  });
});
