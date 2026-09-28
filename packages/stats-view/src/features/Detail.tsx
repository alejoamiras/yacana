import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty, sentence } from '@yacana/miner-core/metrics';
import type { EpochRow } from '@yacana/miner-core/reader';
import { Badge, difficultyLabel, Kpi, Tile, TileHeader } from '@yacana/ui';
import { amount, clockMinutes, durationParts } from '@yacana/web-kit/browser/format';
import { Sk } from './Sk';

const RULES = { N: PARAMS.N, EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS, T_MAX: PARAMS.T_MAX };
const clock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);

type State = 'roll' | 'claims' | 'open' | 'unread';

/** How the row ended: by roll, by the Nth win, not yet (the open epoch), or closed but unread. */
const stateOf = (row: EpochRow, open: boolean): State =>
  row.closedBy === 'roll' ? 'roll' : row.duration !== null ? 'claims' : open ? 'open' : 'unread';

const BADGE: Record<State, { variant: 'warn' | 'neutral' | 'uv'; text: string }> = {
  roll: { variant: 'warn', text: 'closed by the escape hatch' },
  claims: { variant: 'neutral', text: `closed by the ${PARAMS.N}th win` },
  open: { variant: 'uv', text: 'open' },
  unread: { variant: 'neutral', text: 'closed · not read yet' },
};

/** The epoch card before beat two: three value blocks and two sentence lines, at the measured sizes. */
function DetailSkeleton({ className, epoch }: { className?: string; epoch: number | null }) {
  return (
    <Tile className={className} data-testid="detail" data-skeleton="">
      <TileHeader aside={<Sk className="h-2.5 w-[140px]" />}>
        {epoch === null ? 'epoch' : `epoch ${epoch}`}
      </TileHeader>
      <div className="mb-2 flex flex-wrap gap-4">
        {['wins', 'duration', 'difficulty'].map((label) => (
          <Kpi key={label} label={label} value={<Sk className="h-[22px] w-10 rounded-[4px]" />} />
        ))}
      </div>
      <Sk className="h-3.5 w-full" />
      <Sk className="mt-1.5 h-3.5 w-[70%]" />
    </Tile>
  );
}

export function Detail({
  row,
  epoch,
  open,
  next,
  now,
  className,
}: {
  /** Null until beat two: the card keeps its shape and shows its skeleton. */
  row: EpochRow | null;
  /** The open epoch's number once beat one landed: the skeleton's header names it. */
  epoch?: number | null;
  /** Whether `row` is the chain's open epoch; without closing facts otherwise it is closed, unread. */
  open: boolean;
  next?: EpochRow;
  now: number;
  className?: string;
}) {
  if (row === null) return <DetailSkeleton className={className} epoch={epoch ?? null} />;
  const state = stateOf(row, open);
  const closedAt = row.duration === null ? null : row.openedAt + row.duration;
  const span = `${clock(row.openedAt)} → ${closedAt ? clock(closedAt) : state === 'open' ? 'open' : '…'}`;
  const [dur, durUnit] =
    row.duration !== null
      ? durationParts(row.duration)
      : state === 'open'
        ? [clockMinutes(now - row.openedAt), 'min · counting']
        : ['—', ''];
  return (
    <Tile className={className} data-testid="detail">
      <TileHeader aside={span}>epoch {row.epoch}</TileHeader>
      <div className="mb-2 flex flex-wrap gap-4">
        <Kpi
          label="wins"
          value={<span className={state === 'roll' ? 'text-warn' : undefined}>{row.claims}</span>}
          unit={`of ${PARAMS.N}`}
        />
        <Kpi
          label={row.duration === null ? 'open for' : 'duration'}
          value={<span data-testid={row.duration === null ? 'detail-open-for' : undefined}>{dur}</span>}
          unit={durUnit || undefined}
        />
        <Kpi
          label="difficulty"
          value={difficultyLabel(difficulty(row.target))}
          unit={next ? `→ ${difficultyLabel(difficulty(next.target))}` : undefined}
        />
      </div>
      <p className="text-pretty text-xs text-ink-3" data-testid="sentence">
        {state === 'unread'
          ? 'Closed since; its duration and retarget have not been read yet.'
          : sentence(row, RULES)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant={BADGE[state].variant} data-testid="detail-closed-by">
          {BADGE[state].text}
        </Badge>
        <Badge>
          {amount(BigInt(row.claims) * PARAMS.REWARD, PARAMS.DECIMALS, 0)} {PARAMS.TOKEN_SYMBOL} minted
        </Badge>
      </div>
    </Tile>
  );
}
