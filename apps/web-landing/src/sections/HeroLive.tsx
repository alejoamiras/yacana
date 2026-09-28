import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty, networkRate, rateSample } from '@yacana/miner-core/metrics';
import type { EpochRow } from '@yacana/miner-core/reader';
import { difficultyLabel, ExternalLink, Kpi, NodeWayOut, StatusPill, Tile } from '@yacana/ui';
import {
  defaultNodeUrl,
  loadConnection,
  NODE_SETTINGS_HREF,
  restoreDefaultNode,
} from '@yacana/web-kit/browser/connection';
import { amount, duration } from '@yacana/web-kit/browser/format';
import { copy } from '../copy';
import { links } from '../explorer';
import { useNow } from '../hooks';
import type { Live } from '../live';
import { appHref, type LiveStatus } from '../state';
import { BarChart, SHOWN } from './BarChart';

const h = copy.hero;

const mintedSub = (status: LiveStatus): string => {
  if (status.phase === 'ready')
    return `${amount(status.live.supply / PARAMS.REWARD, 0)} wins · ${h.mintedSub}`;
  return status.phase === 'unlaunched' ? h.unlaunched : h.loading;
};

/** On the chain's clock (the last block's time), not the visitor's: the two can disagree by minutes. */
const epochSub = (open: EpochRow, blockTime: number): string =>
  `open ${duration(Math.max(0, blockTime - open.openedAt))} · expected ${duration(Number(PARAMS.EXPECTED_EPOCH_SECONDS))}`;

function Freshness({ live }: { live: Live | undefined }) {
  const now = useNow();
  if (!live) return <span className="text-2xs text-ink-3">{h.loading}</span>;
  const age = Math.max(0, now - live.block.timestamp);
  return (
    <span className="text-2xs text-ink-3" data-testid="live-block">
      <ExternalLink
        href={links.block(live.block.number)}
        full={String(live.block.number)}
        className="text-ink-3"
      >
        block {live.block.number.toLocaleString('en-US')}
      </ExternalLink>{' '}
      · {duration(age)} ago
    </span>
  );
}

function Notices({ status, live }: { status: LiveStatus; live: Live | undefined }) {
  return (
    <>
      {live?.historyError && (
        <span className="text-2xs text-warn" data-testid="live-history-error">
          history unavailable: {live.historyError}
        </span>
      )}
      {status.phase === 'ready' && status.unreachable && (
        <span className="text-2xs text-warn" data-testid="live-unreachable">
          {h.unreachable}
        </span>
      )}
      {status.phase === 'error' && (
        <span className="flex flex-col gap-2 text-2xs text-bad" data-testid="live-error">
          {status.message}
          <NodeWayOut
            onDefault={loadConnection().nodeUrl === defaultNodeUrl() ? undefined : restoreDefaultNode}
            settingsHref={NODE_SETTINGS_HREF}
          />
        </span>
      )}
    </>
  );
}

function Numbers({ status, live }: { status: LiveStatus; live: Live | undefined }) {
  const rows = live?.rows ?? [];
  const open = rows[rows.length - 1];
  const rate = networkRate(rows, PARAMS.N);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      <Kpi
        label="minted"
        value={<span data-testid="live-minted">{live ? amount(live.supply, PARAMS.DECIMALS, 0) : '—'}</span>}
        unit={PARAMS.TOKEN_SYMBOL}
        sub={mintedSub(status)}
      />
      <Kpi
        label="epoch"
        value={<span data-testid="live-open">{live ? live.open : '—'}</span>}
        unit={
          open && (
            <span data-testid="live-epoch">
              {open.claims} of {PARAMS.N}
            </span>
          )
        }
        sub={open && live ? epochSub(open, live.block.timestamp) : ''}
      />
      <Kpi
        label="difficulty"
        value={
          <span data-testid="live-difficulty">{open ? difficultyLabel(difficulty(open.target)) : '—'}</span>
        }
        sub={open ? h.barSub : ''}
      />
      <Kpi
        label="network"
        value={<span data-testid="live-network">{rate === null ? '—' : `≈ ${rate.toFixed(2)}`}</span>}
        unit="proofs/s"
        sub={rate === null ? h.noHistory : `median of ${rateSample(rows).length} epochs`}
      />
    </div>
  );
}

export function HeroLive({ status }: { status: LiveStatus }) {
  const live = status.phase === 'ready' ? status.live : undefined;
  const rows = live?.rows ?? [];
  const fresh = status.phase === 'ready' && !status.unreachable;
  return (
    <Tile className="flex flex-col gap-2.5 self-center px-[18px] py-3.5" data-testid="hero-live">
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={fresh ? 'mining' : 'idle'}>{h.live}</StatusPill>
        <Freshness live={live} />
      </div>
      <Numbers status={status} live={live} />
      <div className="border-t border-line pt-2.5">
        {rows.length ? (
          <BarChart rows={rows} open={live?.open ?? -1} />
        ) : (
          <div className="h-[100px]" aria-hidden />
        )}
        <p className="mt-1 font-mono text-2xs text-ink-3" data-testid="hero-caption">
          {rows.length > SHOWN ? h.caption : h.captionShort}
        </p>
      </div>
      <p className="text-2xs text-ink-3">
        {h.rule} ·{' '}
        <a href={appHref('stats')} className="text-uv-2 hover:text-ink">
          {h.allStats}
        </a>
      </p>
      <Notices status={status} live={live} />
    </Tile>
  );
}
