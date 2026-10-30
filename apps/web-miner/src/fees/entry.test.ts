import { describe, expect, test } from 'vitest';
import { entryShows, standsIn } from './entry';

describe('the entry rule', () => {
  test('it shows only signed in, with no sponsor, while the private Fee Juice is below a claim', () => {
    const short = { sponsored: false, privateFeeJuice: 1n, claimCost: 2n };
    expect(entryShows(true, short)).toBe(true);
    expect(entryShows(false, short)).toBe(false);
    expect(entryShows(true, { ...short, sponsored: true })).toBe(false);
    expect(entryShows(true, { ...short, privateFeeJuice: 2n })).toBe(false);
  });

  test('only the exact stand-in switch stands in an account', () => {
    expect(standsIn('?fees=b&fees-session=stand-in')).toBe(true);
    for (const q of ['', '?fees-session=', '?fees-session=Stand-in', '?fees-session=stand-in-x'])
      expect(standsIn(q)).toBe(false);
  });
});
