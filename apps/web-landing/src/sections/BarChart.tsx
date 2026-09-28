import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty } from '@yacana/miner-core/metrics';
import type { EpochRow } from '@yacana/miner-core/reader';
import { difficultyLabel } from '@yacana/ui';

/** Epochs drawn: the open one and the five closed before it. */
export const SHOWN = 6;
const W = 480;
const H = 100;
const LEFT = 42;
const RIGHT = 6;
const TOP = 10;
const BOTTOM = 18;

/** Up to four powers of four across the axis, so a bar of 2^128 (a test network) still reads as its own scale. */
const ticks = (hiLog2: number): number[] => {
  const powers = Array.from({ length: Math.floor(hiLog2 / 2) + 1 }, (_, k) => 4 ** k);
  const every = Math.max(1, Math.ceil(powers.length / 4));
  return powers.filter((_, k) => k % every === 0);
};

export const shown = (rows: readonly EpochRow[]): EpochRow[] => rows.slice(-SHOWN);

/**
 * Difficulty per epoch as a step line on log₂, one dot per win spread evenly across its
 * epoch's width. Storage keeps a count per epoch, not claim times: the dots say how many, not when.
 */
export function BarChart({ rows, open }: { rows: readonly EpochRow[]; open: number }) {
  const drawn = shown(rows);
  if (!drawn.length) return null;
  const values = drawn.map((r) => difficulty(r.target));
  const lo = Math.log2(Math.min(1, ...values));
  const hi = Math.log2(Math.max(64, ...values) * 1.5);
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const band = plotW / drawn.length;
  const x = (i: number, k = 0) => LEFT + (i + k) * band;
  const y = (d: number) => TOP + plotH - ((Math.log2(d) - lo) / (hi - lo)) * plotH;
  const path = drawn
    .map((r, i) => {
      const yy = y(difficulty(r.target)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yy} L${x(i + 1).toFixed(1)},${yy}`;
    })
    .join(' ');
  const last = drawn[drawn.length - 1] as EpochRow;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full font-mono text-[10px] text-ink-3"
      role="img"
      aria-label={`difficulty over the last ${drawn.length} epochs, a dot per win`}
      data-testid="hero-chart"
    >
      {ticks(hi).map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.18" />
          <text x={LEFT - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fill="currentColor">
            {t < 1e6 ? t : difficultyLabel(t)}
          </text>
        </g>
      ))}
      {drawn.map((r, i) => (
        <text key={r.epoch} x={x(i, 0.5)} y={H - 4} textAnchor="middle" fill="currentColor">
          {r.epoch}
        </text>
      ))}
      <path d={path} fill="none" stroke="var(--uv)" strokeWidth="1.5" data-testid="hero-bar" />
      {drawn.flatMap((r, i) =>
        Array.from({ length: r.claims }, (_, k) => x(i, (k + 0.5) / r.claims)).map((cx) => (
          <circle
            key={cx}
            cx={cx}
            cy={y(difficulty(r.target))}
            r="2.5"
            fill="var(--uv-2)"
            data-claim={r.epoch}
          />
        )),
      )}
      <text x={W - RIGHT} y={TOP - 1} textAnchor="end" fill="currentColor">
        {last.epoch === open
          ? `epoch ${last.epoch} · open · ${last.claims} of ${PARAMS.N}`
          : `epoch ${last.epoch}`}
      </text>
    </svg>
  );
}
