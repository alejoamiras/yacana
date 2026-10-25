import { describe, expect, test } from 'bun:test';
import { OutboxAbi } from '@aztec-foundation/l1-artifacts/OutboxAbi';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem';
import { yacanaPortalAbi } from './portal.ts';
import { errorName, revertNameOf, revertRow } from './revert.ts';

const thrownRevert = (errorName: 'VersionPaused' | 'DeadlinePassed' | 'NotOperators') =>
  new BaseError('call reverted', {
    cause: new ContractFunctionRevertedError({
      abi: yacanaPortalAbi,
      functionName: 'forward',
      data: encodeErrorResult({
        abi: yacanaPortalAbi,
        errorName,
        args: errorName === 'NotOperators' ? [`0x${'11'.repeat(20)}`] : [5n],
      }),
    }),
  });

describe("a revert's name and the row it means", () => {
  test("the portal's and the Outbox's errors decode by name; an unknown selector is kept as is", () => {
    const headroom = encodeErrorResult({
      abi: yacanaPortalAbi,
      errorName: 'WaitsForHeadroom',
      args: [5n, 7n, 3n],
    });
    expect(errorName(headroom)).toBe('WaitsForHeadroom');
    const nullified = encodeErrorResult({
      abi: OutboxAbi,
      errorName: 'Outbox__AlreadyNullified',
      args: [2n, 9n],
    });
    expect(errorName(nullified)).toBe('Outbox__AlreadyNullified');
    expect(errorName('0xdeadbeef00')).toBe('0xdeadbeef');
    expect(errorName('0x')).toBe('empty');
  });

  test('the three refusals a holder can meet name a row state; every other error names none', () => {
    const paused = thrownRevert('VersionPaused');
    expect(revertNameOf(paused)).toBe('VersionPaused');
    expect(revertRow(paused)).toBe('paused');
    expect(revertRow(thrownRevert('DeadlinePassed'))).toBe('closed');
    // Operator-only errors reach a holder through a bug: the raw name says more than a sentence.
    expect(revertRow(thrownRevert('NotOperators'))).toBeUndefined();
    expect(revertNameOf(new Error('the wallet said no'))).toBeUndefined();
    expect(revertRow(new Error('the wallet said no'))).toBeUndefined();
  });
});
