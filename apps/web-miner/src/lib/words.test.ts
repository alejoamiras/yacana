import { describe, expect, test } from 'vitest';
import { nextDifficulty } from './words';

describe('words', () => {
  test('a difficulty is written the way the charts label it, compact from a million', () => {
    expect(nextDifficulty(64, 2.31)).toBe('147.8 (×2.31)');
    expect(nextDifficulty(1e6, 1.2)).toBe('1.2e6 (×1.20)');
  });
});
