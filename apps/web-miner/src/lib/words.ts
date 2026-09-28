// The miner's sentences about how hard a win is. One word, difficulty: at difficulty D about one proof in D
// wins, and a proof's height is the difficulty it reached.
import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficultyLabel } from '@yacana/ui/score-loop-model';
import type { Rules } from '../state';
import { amount, duration } from './format';

/** "About 1 proof in N": difficulty D comes up about once in D proofs. None below 2, where it is not odds. */
export const oddsOf = (d: number | null): number | null =>
  d === null || Math.round(d) < 2 ? null : Math.round(d);

/** The epoch tile's tips; `d` is the open epoch's difficulty. */
export const epochTips = (rules: Rules, d: number | null) => {
  const n = rules.N;
  const minutes = Math.round(Number(rules.T_MAX) / 60);
  const odds = oddsOf(d);
  return {
    epoch: `An epoch is a round the whole network shares. It ends after ${n} wins, anyone's, then the difficulty adjusts for the next one. You can win in every epoch.`,
    wins: `Everyone's wins in this round, not yours alone. The ${n}th closes it.`,
    difficulty:
      d === null || odds === null
        ? 'How hard a win is right now. At difficulty D, about one proof in D wins.'
        : `How hard a win is right now. At difficulty ${difficultyLabel(d)}, about one proof in ${odds} wins.`,
    expected: `The network aims for ${n} wins every ${duration(Number(rules.EXPECTED_EPOCH_SECONDS))}. If an epoch closes faster, more people are mining than the difficulty assumed, so it rises for the next epoch; slower, and it falls. It moves at most 4× either way.`,
    next: `The difficulty the next epoch would open with if the ${n}th win landed now.`,
    reset: `After ${minutes} min without ${n} wins anyone may end the epoch, so a difficulty set too high cannot stall the network. The button appears here when it can.`,
  };
};

/** "147.8 (×2.31)": the difficulty the next epoch would open with, and its ratio to this one. */
export const nextDifficulty = (d: number, ratio: number): string =>
  `${difficultyLabel(d * ratio)} (×${ratio.toFixed(2)})`;

/** The chart's "How to read this", each paragraph as [before, the term set in bold, after]. */
export const loopHelp = (d: number | null) => {
  const odds = oddsOf(d);
  return {
    height: [
      'Each tick is one proof. Its height is ',
      'the difficulty it reached',
      ': pure luck, difficulty D comes up about once in D proofs.',
    ],
    reach: [
      'A proof that reaches ',
      "the network's difficulty",
      ` wins ${amount(PARAMS.REWARD, PARAMS.DECIMALS)} ${PARAMS.TOKEN_SYMBOL}.${odds !== null ? ` Today about 1 proof in ${odds} does, so most ticks stay low.` : ''} More proofs per minute means more draws, not taller ones.`,
    ],
  } as const;
};

/** Written at the line's left end: what reaching it means, and how often a proof does. */
export const difficultyCaption = (d: number | null): string | undefined => {
  if (d === null) return undefined;
  const odds = oddsOf(d);
  const head = `difficulty ${difficultyLabel(d)} · reach it and you win`;
  return odds === null ? head : `${head} · about 1 in ${odds} do`;
};

export const emptyCaption = (d: number | null): string =>
  `Difficulty is ${d === null ? '—' : difficultyLabel(d)} · a proof that reaches it wins`;

/** The signed-out KPI's sub, before the rate means anything. */
export const perWinSub = (d: number | null): string => {
  if (d === null) return 'difficulty not read yet';
  const perWin = Math.max(1, Math.round(d));
  return `difficulty ${difficultyLabel(d)} · about ${perWin} ${perWin === 1 ? 'proof' : 'proofs'} per win`;
};

/** The ledger's epoch line; `ratio` is the difficulty's move at the retarget, when it was seen. */
export const epochOpened = (epoch: bigint, d: number, ratio?: number): string =>
  `epoch ${epoch} opened · difficulty ${difficultyLabel(d)}${ratio === undefined ? '' : ` (×${ratio.toFixed(2)})`}`;

/** The mini window's tip on the word. */
export const pipDifficultyTip = (d: number | null): string => {
  const odds = oddsOf(d);
  return odds === null ? 'How hard a win is right now.' : `About one proof in ${odds} wins.`;
};
