// The numbers the interface shows, defined once. Pure; every surface imports these.
import type { Fr } from '@aztec/foundation/curves/bn254';
import { low128 } from './proof.ts';
import type { EpochRow } from './reader.ts';
import { cappedElapsed, type EpochRules, nextTarget } from './retarget.ts';

const TWO_128 = 2 ** 128;
const RECENT = 20;

/** 2^128 / low128(digest); the contract's `low128 < target` is `score > difficulty`. */
export const score = (digest: Fr): number => {
  const low = low128(digest);
  return low === 0n ? Number.POSITIVE_INFINITY : TWO_128 / Number(low);
};

/** Expected proofs per winning ticket, 2^128 / target. */
export const difficulty = (target: bigint): number => TWO_128 / Number(target);

/** Over the last RECENT prove durations (ms); 0 when idle. */
export const proofsPerMinute = (recentMs: readonly number[]): number => {
  const window = recentMs.slice(-RECENT);
  if (!window.length) return 0;
  return 60_000 / (window.reduce((a, b) => a + b, 0) / window.length);
};

/** "At this rate": difficulty / rate; Infinity when idle. */
export const nextWinSeconds = (target: bigint, perMinute: number): number =>
  perMinute > 0 ? (difficulty(target) * 60) / perMinute : Number.POSITIVE_INFINITY;

/** If the epoch closed now: the next difficulty as a ratio of the current one, clamp included. */
export const closePreview = (target: bigint, elapsedSeconds: bigint, rules: EpochRules): number =>
  difficulty(nextTarget(target, cappedElapsed(elapsedSeconds, rules), rules)) / difficulty(target);

/** Seconds until anyone may roll the epoch; ≤ 0 once T_MAX has passed. */
export const escapeHatchIn = (openedAt: bigint, tMax: bigint, now: bigint): bigint => openedAt + tMax - now;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

const NETWORK_EPOCHS = 6;

/** The epochs the network rate is taken from: the last six closed by claims in a positive time. */
export const rateSample = (rows: readonly EpochRow[]): EpochRow[] =>
  rows.filter((r) => r.closedBy === 'claims' && r.duration !== null && r.duration > 0).slice(-NETWORK_EPOCHS);

/**
 * The network's proof rate implied by the last closed epochs: n × difficulty / duration each,
 * median of the last NETWORK_EPOCHS (one epoch swings ×3 on luck alone at N = 4); null before
 * any epoch closed by claims. Epochs closed by roll() say nothing about the rate.
 */
export const networkRate = (closed: readonly EpochRow[], n: number): number | null =>
  median(rateSample(closed).map((r) => (n * difficulty(r.target)) / (r.duration as number)));

/**
 * Claims in the last hour, an estimate: storage keeps counts per epoch, not claim times, so an
 * epoch's claims are spread evenly over its span (the open one's over its life so far) and the
 * part inside the hour is counted.
 */
export const claimsPerHour = (rows: readonly EpochRow[], nowSec: number): number => {
  const since = nowSec - 3600;
  let claims = 0;
  for (const r of rows) {
    const end = r.duration === null ? nowSec : r.openedAt + r.duration;
    const span = end - r.openedAt;
    if (end <= since || r.claims === 0) continue;
    if (span <= 0) {
      claims += r.claims;
      continue;
    }
    claims += (r.claims * (Math.min(end, nowSec) - Math.max(r.openedAt, since))) / span;
  }
  return claims;
};

/** The schedule: claims per hour when every epoch closes on time. */
export const scheduledClaimsPerHour = (rules: EpochRules): number =>
  (rules.N * 3600) / Number(rules.EXPECTED_EPOCH_SECONDS);

/**
 * What joining the network at `yourPerMinute` would earn: your share of the network once you are
 * part of it (yours over the measured rate plus yours, so never above 1), the expected wait for a
 * win at today's difficulty, and that share of the schedule per day. A rate that is not a finite
 * positive number counts as zero: the inputs come from a text field.
 */
export function calculator(
  yourPerMinute: number,
  networkPerSecond: number,
  target: bigint,
  rules: EpochRules & { REWARD: bigint },
): { share: number; secondsToWin: number; perDay: bigint } {
  const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const yours = finite(yourPerMinute) / 60;
  const share = yours > 0 ? yours / (finite(networkPerSecond) + yours) : 0;
  const perDay = (BigInt(rules.N) * rules.REWARD * 86_400n) / rules.EXPECTED_EPOCH_SECONDS;
  return {
    share,
    secondsToWin: nextWinSeconds(target, finite(yourPerMinute)),
    perDay: (perDay * BigInt(Math.round(share * 1_000_000))) / 1_000_000n,
  };
}

export type SentenceKind = 'open' | 'launch' | 'rolled' | 'fast' | 'slow' | 'normal';

/** How an epoch went, from its closing facts alone; the retarget clamp marks the extremes. */
export function sentenceKind(row: EpochRow): SentenceKind {
  if (row.duration === null || row.retarget === null) return 'open';
  if (row.closedBy === 'roll') return 'rolled';
  if (row.epoch === 0) return 'launch';
  const harder = 1 / row.retarget;
  return harder > 1.25 ? 'fast' : harder < 0.8 ? 'slow' : 'normal';
}

const minutes = (s: number): string => (s >= 90 ? `${(s / 60).toFixed(s >= 600 ? 0 : 1)} min` : `${s} s`);
const clock = (unix: number): string => new Date(unix * 1000).toISOString().slice(11, 19);

/**
 * One sentence per epoch, from its numbers; the templates are the whole vocabulary. The move is
 * always the observed one: "made ×1.44 harder" is the difficulty ratio (the target fell to ×0.69),
 * "eased ×1.44" the target ratio.
 */
export function sentence(row: EpochRow, rules: EpochRules): string {
  const expected = minutes(Number(rules.EXPECTED_EPOCH_SECONDS));
  const kind = sentenceKind(row);
  if (kind === 'open')
    return `Open with ${row.claims} of ${rules.N} wins; it closes at the ${ordinal(rules.N)} win, expected about ${expected} after it opened.`;
  const dur = minutes(row.duration as number);
  const retarget = row.retarget as number;
  const move = retarget < 1 ? `made ×${(1 / retarget).toFixed(2)} harder` : `eased ×${retarget.toFixed(2)}`;
  switch (kind) {
    case 'rolled':
      return `Hashrate fell away after ${row.claims} ${row.claims === 1 ? 'win' : 'wins'}. The epoch sat open past the ${Number(rules.T_MAX) / 60}-minute mark, when anyone may close it through the escape hatch; someone did at ${clock(row.openedAt + (row.duration as number))}, and the next epoch was ${move}.`;
    case 'launch':
      return `Epoch 0 opened at launch at difficulty ${difficulty(row.target).toFixed(1)}; ${rules.N} wins closed it in ${dur} against ${expected} expected, and the first retarget ${move} the next epoch.`;
    case 'fast':
      return `${rules.N} wins in ${dur} against ${expected} expected: the network was faster than the difficulty assumed, so the next epoch was ${move}.`;
    case 'slow':
      return `${rules.N} wins took ${dur} against ${expected} expected: the next epoch was ${move}.`;
    default:
      return `${rules.N} wins in ${dur}, close to the ${expected} expected; the next epoch was ${move}.`;
  }
}

const ordinal = (n: number): string =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'] as const)[n % 10 < 4 ? n % 10 : 0]}`;
