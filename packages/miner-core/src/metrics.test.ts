import { describe, expect, test } from 'bun:test';
import { Fr } from '@aztec/foundation/curves/bn254';
import {
  closePreview,
  difficulty,
  escapeHatchIn,
  nextWinSeconds,
  proofsPerMinute,
  score,
} from './metrics.ts';

const rules = { N: 4, EXPECTED_EPOCH_SECONDS: 300n, T_MAX: 1200n };

describe('metrics', () => {
  test('score is 2^128 / low128; a ticket wins when it is strictly above the difficulty', () => {
    const target = 1n << 124n; // difficulty 16
    expect(difficulty(target)).toBe(16);
    expect(score(new Fr(1n << 124n))).toBe(16); // low128 = target: not a win (the contract wants low128 < target)
    expect(score(new Fr((1n << 124n) + (1n << 120n)))).toBeCloseTo(15.06, 2);
    expect(score(new Fr(1n << 120n))).toBe(256);
    expect(score(new Fr(0n))).toBe(Number.POSITIVE_INFINITY);
    // The high bits are not part of the ticket.
    expect(score(new Fr((1n << 200n) | (1n << 124n)))).toBe(16);
  });

  test('rate is over the last 20 proofs; next win at this rate', () => {
    expect(proofsPerMinute([])).toBe(0);
    expect(proofsPerMinute([3000, 3000])).toBe(20);
    const slowThenFast = [...Array(10).fill(60_000), ...Array(20).fill(3000)];
    expect(proofsPerMinute(slowThenFast)).toBe(20);
    expect(nextWinSeconds(1n << 124n, 20)).toBe(48);
    expect(nextWinSeconds(1n << 124n, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  test('close preview mirrors the retarget clamp on the elapsed time', () => {
    const target = 1n << 124n;
    expect(closePreview(target, 300n, rules)).toBeCloseTo(1);
    expect(closePreview(target, 150n, rules)).toBeCloseTo(2);
    expect(closePreview(target, 600n, rules)).toBeCloseTo(0.5);
    expect(closePreview(target, 10n, rules)).toBeCloseTo(4); // clamped
    expect(closePreview(target, 100_000n, rules)).toBeCloseTo(0.25); // capped at T_MAX, then clamped
    expect(escapeHatchIn(1000n, 1200n, 1500n)).toBe(700n);
    expect(escapeHatchIn(1000n, 1200n, 2300n)).toBe(-100n);
  });
});

import {
  calculator,
  claimsPerHour,
  networkRate,
  scheduledClaimsPerHour,
  sentence,
  sentenceKind,
} from './metrics.ts';
import { type EpochRow, rowsFromJson } from './reader.ts';

/** A closed epoch: `target`, opened at `openedAt`, `duration` seconds, `claims` of N; retarget from `next`. */
const closed = (
  epoch: number,
  openedAt: number,
  duration: number,
  target: bigint,
  next: bigint,
  claims = 4,
): EpochRow => ({
  epoch,
  target,
  openedAt,
  claims,
  duration,
  retarget: Number((next * 1_000_000n) / target) / 1_000_000,
  closedBy: claims >= 4 ? 'claims' : 'roll',
});
const open = (epoch: number, openedAt: number, target: bigint, claims: number): EpochRow => ({
  epoch,
  target,
  openedAt,
  claims,
  duration: null,
  retarget: null,
  closedBy: null,
});
const T = 1n << 124n; // difficulty 16

describe('network metrics', () => {
  test('network rate is the median over the last six count-closed epochs; rolls say nothing', () => {
    expect(networkRate([], 4)).toBeNull();
    expect(networkRate([open(0, 0, T, 1)], 4)).toBeNull();
    // 4 claims at difficulty 16 in 320 s → 0.2 proofs/s; the outlier and the roll are ignored.
    const rows = [
      closed(0, 0, 320, T, T),
      closed(1, 320, 320, T, T),
      closed(2, 640, 32, T, T),
      closed(3, 672, 1200, T, T / 4n, 1),
      closed(4, 1872, 320, T, T),
      closed(5, 2192, 320, T, T),
      closed(6, 2512, 320, T, T),
      closed(7, 2832, 320, T, T),
      open(8, 3152, T, 0),
    ];
    expect(networkRate(rows, 4)).toBeCloseTo(0.2, 6);
    expect(networkRate(rows.slice(0, 3), 4)).toBeCloseTo(0.2, 6);
  });

  test('claims per hour counts the closed epochs inside the last hour, pro rata; the schedule is N per expected', () => {
    const rows = [closed(0, 0, 1800, T, T), closed(1, 1800, 1800, T, T), open(2, 3600, T, 2)];
    // At 3600 the open epoch just opened: its two claims count, over a zero-length life.
    expect(claimsPerHour(rows, 3600)).toBeCloseTo(10, 6);
    // Half of epoch 0 lies outside the hour; the open epoch's two claims are inside it.
    expect(claimsPerHour(rows, 4500)).toBeCloseTo(8, 6);
    expect(claimsPerHour(rows.slice(0, 2), 20_000)).toBe(0);
    expect(scheduledClaimsPerHour(rules)).toBe(48);
  });

  test('the calculator: share of the network, expected wait, expected reward per day', () => {
    // 0.1 proofs/s joining a 0.2 proofs/s network: a third of it.
    const r = calculator(6, 0.2, T, { ...rules, REWARD: 4n * 10n ** 18n });
    expect(r.share).toBeCloseTo(1 / 3, 6);
    expect(r.secondsToWin).toBe(160);
    // The schedule mints 4 × 4 per 300 s; a third of that per day.
    expect(r.perDay).toBe((((16n * 10n ** 18n * 86_400n) / 300n) * 333_333n) / 1_000_000n);
    expect(calculator(0, 0.2, T, { ...rules, REWARD: 1n }).share).toBe(0);
    expect(calculator(6, 0, T, { ...rules, REWARD: 1n }).share).toBe(1);
    expect(calculator(600, 0.2, T, { ...rules, REWARD: 1n }).share).toBeLessThan(1);
    // "1e309" in the field parses to Infinity; NaN in the share would throw inside BigInt().
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -5])
      expect(calculator(bad, 0.2, T, { ...rules, REWARD: 1n })).toMatchObject({ share: 0, perDay: 0n });
    expect(calculator(6, Number.NaN, T, { ...rules, REWARD: 1n }).share).toBe(1);
  });

  test('one sentence per kind, from the numbers alone', () => {
    const rows = {
      launch: closed(0, 0, 288, T, T / 2n),
      fast: closed(3, 0, 150, T, T / 2n),
      slow: closed(4, 0, 600, T, T * 2n),
      normal: closed(5, 0, 310, T, (T * 97n) / 100n),
      rolled: closed(6, 0, 1296, T, T * 4n, 2),
      open: open(7, 0, T, 2),
    };
    for (const [kind, row] of Object.entries(rows)) {
      expect(sentenceKind(row)).toBe(kind as ReturnType<typeof sentenceKind>);
      expect(sentence(row, rules).length).toBeGreaterThan(40);
    }
    expect(sentence(rows.rolled, rules)).toContain(
      'past the 20-minute mark, when anyone may close it through the escape hatch; someone did at 00:21:36, and the next epoch was eased ×4.00',
    );
    expect(sentence(rows.fast, rules)).toContain('made ×2.00 harder');
    expect(sentence(rows.slow, rules)).toContain('eased ×2.00');
    expect(sentence(rows.normal, rules)).toContain('made ×1.03 harder');
    expect(sentence(rows.open, rules)).toContain('2 of 4 wins');
  });
});

describe('the captured testnet history', () => {
  test('reads back, and the metrics land where the soak report says', async () => {
    const rows = rowsFromJson(
      await Bun.file(new URL('../fixtures/epochs.testnet.json', import.meta.url)).text(),
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows[0]).toMatchObject({ epoch: 0, claims: 0, closedBy: 'roll', retarget: 4 });
    expect(rows.filter((r) => r.closedBy === 'roll').length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(rows.map(sentenceKind));
    for (const k of ['rolled', 'fast', 'slow', 'normal', 'open']) expect(kinds.has(k as never)).toBe(true);
    // The hour before epoch 24 opened: epochs 13–23 whole (44 claims) and the third of epoch 12's span inside
    // it (4 × 144 / 432); epoch 24's own claims lie after that instant.
    const e24 = rows[24] as EpochRow;
    expect(claimsPerHour(rows.slice(0, 25), e24.openedAt)).toBeCloseTo(44 + 4 / 3, 6);
    const rate = networkRate(rows, rules.N);
    expect(rate).toBeGreaterThanOrEqual(0.05);
    expect(rate).toBeLessThan(1);
    for (const r of rows) expect(sentence(r, rules)).not.toContain('NaN');
  });
});
