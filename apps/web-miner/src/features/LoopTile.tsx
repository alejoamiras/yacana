import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty, nextWinSeconds, proofsPerMinute } from '@yacana/miner-core/metrics';
import {
  Button,
  ClaimChip,
  cn,
  difficultyLabel,
  Kpi,
  Mark,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScoreLoop,
  StatusPill,
  Tile,
  TileHeader,
  Tip,
  useTweenedNumber,
} from '@yacana/ui';
import { useAtomValue, useStore } from 'jotai';
import type { MinerController } from '../controller';
import { chipStep } from '../lib/claim-copy';
import { amount, compact, durationParts } from '../lib/format';
import type { MinerState } from '../lib/reducer';
import { pillStatus } from '../lib/status';
import { difficultyCaption, emptyCaption, loopHelp, perWinSub, pipDifficultyTip } from '../lib/words';
import { openPip, pipSupported, pipWindowAtom } from '../pip';
import { prestoAtom } from '../presto';
import { bootAtom, epochAtom, minerAtom, nowAtom } from '../state';
import { useStartClick } from './use-start-click';

/** The user's Start goes through the session (it asks Presto beside the start); the controller alone stops. */
type Controls = { controller: () => MinerController | undefined; onStart: () => void };

/** The window the header names: since the start until it is three minutes old, then the last three minutes. */
const WINDOW_MS = 180_000;

/** The mini window: the state and Stop, the last minute of the loop as a strip, your numbers, then the network's. */
export function PipView({ controller, onStart, win }: Controls & { win: Window }) {
  const miner = useAtomValue(minerAtom);
  const epoch = useAtomValue(epochAtom);
  const now = useAtomValue(nowAtom);
  const native = useAtomValue(prestoAtom).active === 'presto';
  const perMinute = useTweenedNumber(proofsPerMinute(miner.recent));
  const bar = epoch ? difficulty(epoch.target) : null;
  const opening = useAtomValue(bootAtom).phase === 'opening';
  const startClick = useStartClick(onStart);
  return (
    <div className="flex h-full flex-col justify-between bg-ground p-3 text-ink">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Mark state={miner.phase === 'mining' ? 'mining' : 'idle'} />
          <StatusPill status={pillStatus(miner, now)} />
        </span>
        {miner.phase === 'mining' ? (
          <Button size="sm" onClick={() => controller()?.stop()}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={opening || miner.phase !== 'idle'}
            onClick={startClick}
            data-testid="pip-start"
          >
            Start
          </Button>
        )}
      </div>
      <ScoreLoop
        calm
        difficulty={bar}
        samples={miner.samples}
        spans={miner.claimSpans}
        barCaption={difficultyCaption(bar)}
        winAt={miner.winAt}
        height={48}
        spanMs={60_000}
        geometry={{ pad: 4, fontPx: 10 }}
        win={win}
      />
      <div className="flex flex-col gap-[3px] font-mono text-[10px] text-ink-2" data-testid="pip-footer">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span>
            <span className="font-sans text-lg font-semibold tracking-[-0.02em] text-ink">
              {perMinute.toFixed(1)}
            </span>{' '}
            proofs/min{native && <span className="text-uv-2"> · native</span>}
          </span>
          <span className="text-ok">
            {miner.wins} {miner.wins === 1 ? 'win' : 'wins'} ·{' '}
            {amount(PARAMS.REWARD * BigInt(miner.wins), PARAMS.DECIMALS)} {PARAMS.TOKEN_SYMBOL}
          </span>
        </div>
        {epoch && (
          <div>
            epoch {epoch.epoch.toString()} · <span className="text-ink">{epoch.claims}</span> of {PARAMS.N}{' '}
            wins ·{' '}
            <Tip tip={pipDifficultyTip(bar)} container={win.document.body}>
              difficulty
            </Tip>{' '}
            {bar === null ? '—' : difficultyLabel(bar)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Opens the mini window the shell renders into; one at a time. */
function PopOut() {
  const store = useStore();
  const open = useAtomValue(pipWindowAtom) !== null;
  return (
    <Button size="sm" disabled={open} onClick={() => void openPip(store)} data-testid="pop-out">
      Pop out
    </Button>
  );
}

/** Start's place: opening while an account comes up, the way in while none is, Stop/Start otherwise. */
function StartControl({
  ready,
  opening,
  miner,
  controller,
  onStart,
}: Controls & { ready: boolean; opening: boolean; miner: MinerState }) {
  const startClick = useStartClick(onStart);
  if (opening)
    return (
      <Button size="sm" variant="primary" disabled data-testid="start-opening">
        opening…
      </Button>
    );
  if (!ready)
    return (
      <Button size="sm" variant="primary" data-testid="sign-in-mine" onClick={startClick}>
        Start mining
      </Button>
    );
  if (miner.phase === 'mining' || miner.phase === 'claiming')
    return (
      <Button
        size="sm"
        data-testid="stop"
        disabled={miner.stopping}
        title={
          miner.phase === 'claiming' ? 'The claim finishes; mining does not resume after it.' : undefined
        }
        onClick={() => controller()?.stop()}
      >
        Stop
      </Button>
    );
  return (
    <Button
      size="sm"
      variant="primary"
      data-testid="start"
      disabled={miner.phase !== 'idle' || miner.proverDead}
      onClick={startClick}
    >
      Start mining
    </Button>
  );
}

function LoopHelp({ bar }: { bar: number | null }) {
  const { height, reach } = loopHelp(bar);
  return (
    <Popover>
      <PopoverTrigger
        aria-label="How to read this"
        data-testid="loop-help"
        className="inline-flex size-[18px] items-center justify-center rounded-full border border-line-2 font-mono text-[11px] font-medium normal-case tracking-normal text-ink-3 outline-none hover:border-ink-4 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:text-ink"
      >
        ?
      </PopoverTrigger>
      <PopoverContent className="normal-case tracking-normal" data-testid="loop-help-content">
        <b className="font-semibold text-ink">How to read this</b>
        <span>
          {height[0]}
          <b className="font-medium text-ink">{height[1]}</b>
          {height[2]}
        </span>
        <span>
          {reach[0]}
          <b className="font-medium text-uv-2">{reach[1]}</b>
          {reach[2]}
        </span>
      </PopoverContent>
    </Popover>
  );
}

/** The header's left: the pill when paused; "live · since 16:05" then "live · last 3 min" while mining; else "your proofs". */
function HeaderText({
  status,
  miner,
  now,
}: {
  status: ReturnType<typeof pillStatus>;
  miner: MinerState;
  now: number;
}) {
  if (status === 'paused') return <StatusPill status="paused" />;
  if (miner.phase === 'mining' || miner.phase === 'claiming') {
    const since = miner.since;
    const window =
      since === null || now - since >= WINDOW_MS
        ? 'last 3 min'
        : `since ${new Date(since).toISOString().slice(11, 16)}`;
    return <span data-testid="loop-window">live · {window}</span>;
  }
  return <>your proofs</>;
}

/** The claim's step and one clock from the win, beside the status; the wait once Stop was pressed. */
function HeaderClaim({ miner, now }: { miner: MinerState; now: number }) {
  if (!miner.claim) return null;
  return (
    <ClaimChip
      step={chipStep(miner.claim.step)}
      seconds={(now - miner.claim.wonAt) / 1000}
      stopping={miner.stopping}
      data-testid="claim-chip"
    />
  );
}

/** The chart's footer: the session's pace and count, with ✦ presto between them while Presto is what proves. */
function RateLine({ native, miner, perProof }: { native: boolean; miner: MinerState; perProof: number }) {
  if (!miner.recent.length) return null;
  return (
    <span data-testid="rate-line">
      {perProof.toFixed(1)} s per proof · {native && <span className="text-uv-2">✦ presto · </span>}
      {compact(miner.proofs)} proofs
    </span>
  );
}

/** The header row is a fixed-height status line with the claim's chip; the stepper lives in the rail. */
export function LoopTile({ controller, onStart, className }: Controls & { className?: string }) {
  const boot = useAtomValue(bootAtom);
  const miner = useAtomValue(minerAtom);
  const epoch = useAtomValue(epochAtom);
  const now = useAtomValue(nowAtom);
  const native = useAtomValue(prestoAtom).active === 'presto';
  const last = miner.recent[miner.recent.length - 1];
  const perProof = useTweenedNumber(last === undefined ? 0 : last / 1000);
  const ready = boot.phase === 'ready';
  const opening = boot.phase === 'opening';
  const bar = epoch ? difficulty(epoch.target) : null;
  const status = pillStatus(miner, now);
  return (
    <Tile className={cn('flex flex-col gap-4', className)}>
      <TileHeader
        className="mb-0 h-[30px] items-center"
        aside={
          <span className="flex items-center gap-3">
            {pipSupported() && <PopOut />}
            <StartControl
              ready={ready}
              opening={opening}
              miner={miner}
              controller={controller}
              onStart={onStart}
            />
          </span>
        }
      >
        <span className="flex items-center gap-3">
          <HeaderText status={status} miner={miner} now={now} />
          <LoopHelp bar={bar} />
          <HeaderClaim miner={miner} now={now} />
        </span>
      </TileHeader>
      <ScoreLoop
        calm
        difficulty={bar}
        samples={miner.samples}
        spans={miner.claimSpans}
        axisTitle="difficulty reached · log scale"
        barCaption={difficultyCaption(bar)}
        winAt={miner.winAt}
        since={miner.sinceT ?? undefined}
        height={230}
        placeholder={['Your proofs draw here once you start.', emptyCaption(bar)]}
        footer={<RateLine native={native} miner={miner} perProof={perProof} />}
      />
    </Tile>
  );
}

const nextWin = (target: bigint, perMinute: number): [string, string] | null => {
  if (perMinute <= 0) return null;
  const [value, unit] = durationParts(nextWinSeconds(target, perMinute));
  return unit ? [`~${value}`, unit] : null;
};

/** Signed out the values are dashes and the subs say what would fill them. */
function kpiSubs(
  ready: boolean,
  bar: number | null,
  miner: MinerState,
): { rate: string; next: string; best: string } {
  if (ready)
    return {
      rate: `${compact(miner.proofs)} proofs this session`,
      next: 'could be now, could be 3× longer',
      best: `${miner.wins} ${miner.wins === 1 ? 'win' : 'wins'} · ${amount(PARAMS.REWARD * BigInt(miner.wins), PARAMS.DECIMALS)} ${PARAMS.TOKEN_SYMBOL} this session`,
    };
  return { rate: 'starts with mining', next: perWinSub(bar), best: '' };
}

export function KpiTiles({ className }: { className?: string }) {
  const miner = useAtomValue(minerAtom);
  const epoch = useAtomValue(epochAtom);
  const ready = useAtomValue(bootAtom).phase === 'ready';
  const perMinute = useTweenedNumber(proofsPerMinute(miner.recent));
  const bar = epoch ? difficulty(epoch.target) : null;
  const next = ready && epoch ? nextWin(epoch.target, proofsPerMinute(miner.recent)) : null;
  const subs = kpiSubs(ready, bar, miner);
  return (
    <div className={cn('grid grid-cols-3 gap-[14px]', className)} data-testid="kpi-tiles">
      <Tile>
        <Kpi
          size="lg"
          label="rate"
          value={<span data-testid="rate">{ready ? perMinute.toFixed(1) : '—'}</span>}
          unit="proofs/min"
          sub={
            ready ? (
              <>
                <span data-testid="tickets">{compact(miner.proofs)}</span> proofs this session
              </>
            ) : (
              subs.rate
            )
          }
        />
      </Tile>
      <Tile>
        <Kpi
          size="lg"
          label="next win, at this rate"
          value={next ? next[0] : '—'}
          unit={next?.[1]}
          sub={subs.next}
        />
      </Tile>
      <Tile>
        <Kpi
          size="lg"
          label="best difficulty this epoch"
          value={ready && miner.best !== null ? difficultyLabel(miner.best) : '—'}
          unit={ready && bar !== null ? `of ${difficultyLabel(bar)}` : undefined}
          sub={subs.best || undefined}
        />
      </Tile>
    </div>
  );
}
