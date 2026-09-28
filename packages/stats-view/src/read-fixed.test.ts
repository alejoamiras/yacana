import { TABLE_EPOCHS } from '@yacana/miner-core/reader';
import { describe, expect, test } from 'vitest';
import { assertOpenEpoch } from './read-fixed';

describe('the open epoch a node reports', () => {
  test('an epoch the slot table addresses passes; anything else is refused before it is walked', () => {
    expect(assertOpenEpoch(0)).toBe(0);
    expect(assertOpenEpoch(30)).toBe(30);
    expect(assertOpenEpoch(TABLE_EPOCHS - 1)).toBe(TABLE_EPOCHS - 1);
    for (const bad of [-1, 1.5, Number.NaN, 1e20, TABLE_EPOCHS, Number.MAX_SAFE_INTEGER + 2])
      expect(() => assertOpenEpoch(bad)).toThrow(/not an epoch this deployment can have/);
  });
});
