// The bridge page's tiles. The portal knows what left each version and what arrived, not who
// holds what: every figure here is a flow or this build's own supply. The figures speak for
// themselves; a dotted word carries its one-line tooltip, one disclosure per card holds the
// sentence, and the rules live on the FAQ.

import type { VersionFlows } from '@yacana/bridge/portal-reader';
import type { MigrationRecord } from '@yacana/bridge/record';
import { PARAMS } from '@yacana/miner-core/generated/params';
import type { EpochRow } from '@yacana/miner-core/reader';
import { Badge, ChipLink, Kpi, KvRow, StackedBar, Tile, TileHeader, Timeline } from '@yacana/ui';
import { firstEpoch } from '@yacana/web-kit/browser/connection';
import { useEffect, useId, useState } from 'react';
import {
  type BridgeSnapshot,
  chainNow,
  coinsSeries,
  crossingLine,
  day,
  deadlineOf,
  exitLimitLine,
  figuresOf,
  headroomLine,
  kpisOf,
  lastDayWords,
  type MinerFlows,
  pauseLine,
  pauseRule,
  phasesOf,
  versionLine,
  whereOf,
} from '../bridge-beat';
import { l1Links } from '../explorer';
import { useStatsHost } from '../host';
import { CoinsChart } from './CoinsChart';

const FIRST = firstEpoch();

const chainName = (chainId: string): string =>
  chainId === '1'
    ? 'Ethereum'
    : chainId === '11155111'
      ? 'Sepolia'
      : chainId === '31337'
        ? 'anvil'
        : `chain ${chainId}`;

/** A dotted word whose explanation opens on hover or keyboard focus (the gap is part of the hover area) and closes on Escape however it opened. */
function Term({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = hovered || focused;
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDismissed(true);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);
  const leave = () => {
    setHovered(false);
    setDismissed(false);
  };
  return (
    <span className="group relative inline-block">
      <button
        type="button"
        aria-describedby={id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={leave}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
        }}
        className="cursor-help border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] text-inherit underline decoration-dotted underline-offset-[3px] outline-none focus-visible:ring-1 focus-visible:ring-uv"
      >
        {children}
      </button>
      <span
        role="tooltip"
        id={id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={leave}
        className={`absolute bottom-full left-0 z-10 w-64 pb-1.5 ${dismissed ? 'hidden' : 'hidden group-focus-within:block group-hover:block'}`}
      >
        <span className="block rounded-[6px] border border-line bg-panel px-2.5 py-2 font-sans text-xs normal-case text-ink-2">
          {title}
        </span>
      </span>
    </span>
  );
}

const EXIT_LIMIT =
  'Withdrawals from a version are capped at what mining could have produced: the limit grows with the schedule from the launch and freezes at the upgrade, net of what arrived. Beyond it, a withdrawal waits for it to grow.';

export function BridgeKpis({
  snapshot,
  live,
  miner,
  supply,
  now,
  chainId,
}: {
  snapshot: BridgeSnapshot;
  live: VersionFlows | undefined;
  miner: MinerFlows | undefined;
  supply: bigint | undefined;
  now: number;
  chainId: string;
}) {
  const kpis = kpisOf(snapshot, live, miner, supply, chainNow(snapshot, now), chainName(chainId));
  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6" data-testid="bridge-kpis">
      {kpis.map((k) => (
        <Tile key={k.id} data-testid={`kpi-${k.id}`}>
          <Kpi label={k.label} value={k.value} unit={k.unit} sub={k.sub} />
        </Tile>
      ))}
    </div>
  );
}

export function BridgePhases({
  version,
  migration,
  snapshot,
  className,
}: {
  version: VersionFlows | undefined;
  migration: MigrationRecord | null;
  /** The read the version came from: its clock is Ethereum's, never the device's — the closing day is a categorical call. */
  snapshot: Pick<BridgeSnapshot, 'policy' | 'chainTime'> | null;
  className?: string;
}) {
  const { faqHref } = useStatsHost();
  return (
    <Tile className={className} data-testid="bridge-phases">
      <TileHeader
        aside={
          <a href={faqHref} className="hover:text-ink" data-testid="bridge-faq">
            what happens →
          </a>
        }
      >
        {version ? `V${version.registryIndex} · the phases` : 'the phases'}
      </TileHeader>
      {version && snapshot ? (
        <Timeline
          items={phasesOf(version, migration, Number(snapshot.chainTime), snapshot)}
          className="mt-1.5"
        />
      ) : (
        <p className="text-xs text-ink-3">reading the portal…</p>
      )}
    </Tile>
  );
}

export function BridgeCoins({
  rows,
  snapshot,
  now,
}: {
  rows: readonly EpochRow[];
  snapshot: BridgeSnapshot;
  now: number;
}) {
  // The emission is exact only over every epoch since this version's first, with no gap: a window
  // loaded beside the latest one would draw a false total.
  const last = rows.reduce((a, r) => Math.max(a, r.epoch), -1);
  const complete = rows.length > 0 && rows.length === last - FIRST + 1 && rows.every((r) => r.epoch >= FIRST);
  // A send ahead lands on the next version without a claim here: once two versions have minted, no
  // version's rows and flows add up to a balance, so the split is drawn only while one has.
  const versions = snapshot.versions.length;
  const points =
    complete && versions === 1 && snapshot.extras
      ? coinsSeries(rows, snapshot.extras.events, chainNow(snapshot, now))
      : [];
  return (
    <Tile data-testid="bridge-coins">
      <TileHeader aside="since launch · violet on Aztec · grey on Ethereum">where the coins are</TileHeader>
      {points.length > 1 ? (
        <CoinsChart points={points} symbol={PARAMS.TOKEN_SYMBOL} />
      ) : (
        <p className="text-xs text-ink-3">
          {versions > 1
            ? `YACA is one pool across ${versions} versions: the split is drawn while one version has minted`
            : !snapshot.extras
              ? 'the portal’s events could not be read'
              : complete
                ? 'the epochs held so far draw nothing yet'
                : `drawn once every epoch since launch is held · ${rows.length} of ${Math.max(0, last - FIRST + 1)} so far`}
        </p>
      )}
    </Tile>
  );
}

function VersionCard({
  v,
  snapshot,
  miner,
  supply,
}: {
  v: VersionFlows;
  snapshot: BridgeSnapshot;
  miner: MinerFlows | undefined;
  supply: bigint | undefined;
}) {
  const live = v.version === snapshot.canonical.version;
  // Closed, frozen or pre-launch is Ethereum's word at the read, never the device's clock.
  const chainTime = Number(snapshot.chainTime);
  const segments = whereOf(v, snapshot, miner, supply, import.meta.env.VITE_ROLLUP_VERSION);
  return (
    <Tile
      className={live ? 'border-uv' : undefined}
      data-testid="bridge-version"
      data-version={v.version.toString()}
      data-index={v.registryIndex.toString()}
      data-live={live ? '1' : '0'}
    >
      <div className="flex items-baseline justify-between gap-3">
        <b className="text-base font-semibold">Aztec V{v.registryIndex.toString()}</b>
        <Badge variant={live ? 'uv' : 'neutral'}>
          {live ? 'canonical' : v.flipAt > 0n ? 'past' : 'registered'}
        </Badge>
      </div>
      <p className="mt-1.5 text-sm" data-testid="version-line">
        {versionLine(v, snapshot)}
      </p>
      {snapshot.extras && <StackedBar segments={segments} className="mt-3.5" />}
      <div className="mt-3">
        <KvRow label="launched" value={day(v.launchAt)} />
        <KvRow
          label={
            <Term title="Nothing leaves a version after its last day; what is still on it is lost.">
              last day
            </Term>
          }
          value={lastDayWords(deadlineOf(v, snapshot), v, Number(snapshot.policy.exitFloor / 86_400n))}
          className="[&>:first-child]:shrink-0 [&>:last-child]:text-right"
        />
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-2">
          the exit limit · {headroomLine(v, snapshot.policy, chainTime)}
        </summary>
        <p className="mt-1.5 text-pretty text-ink-3" data-testid="exit-limit">
          {exitLimitLine(v, snapshot.policy, chainTime)}
        </p>
      </details>
    </Tile>
  );
}

export function BridgeVersions({
  snapshot,
  miner,
  supply,
}: {
  snapshot: BridgeSnapshot;
  miner: MinerFlows | undefined;
  supply: bigint | undefined;
}) {
  return (
    <Tile data-testid="bridge-versions">
      <TileHeader aside="one card per version">versions</TileHeader>
      <div className="grid gap-3.5 md:grid-cols-2">
        {snapshot.versions.map((v) => (
          <VersionCard key={v.version.toString()} v={v} snapshot={snapshot} miner={miner} supply={supply} />
        ))}
      </div>
    </Tile>
  );
}

/** The portal as it stands: open or paused, the deposits, the last crossing, the exit limit and the pause. */
export function BridgeTurnstile({
  snapshot,
  live,
  miner,
  now,
  chainId,
}: {
  snapshot: BridgeSnapshot;
  live: VersionFlows | undefined;
  miner: MinerFlows | undefined;
  now: number;
  chainId: string;
}) {
  const p = snapshot.policy;
  const f = figuresOf(snapshot, live, miner, undefined);
  const nowSeconds = chainNow(snapshot, now);
  return (
    <Tile data-testid="bridge-turnstile">
      <TileHeader aside={`${chainName(chainId)} · ${live ? `V${live.registryIndex}` : 'this version'}`}>
        the portal
      </TileHeader>
      <KvRow
        label="state"
        value={
          <span className={live?.paused ? 'text-warn' : 'text-ok'}>{live?.paused ? 'paused' : 'open'}</span>
        }
      />
      <KvRow label="deposits" value={live?.depositsClosed ? 'closed before the upgrade' : 'open'} />
      <KvRow label="crossings" value={crossingLine(f.lastCrossingAt, nowSeconds)} />
      <KvRow
        label={<Term title={EXIT_LIMIT}>exit limit</Term>}
        value={live ? headroomLine(live, p, Number(snapshot.chainTime)) : '—'}
      />
      <KvRow
        label={<Term title={pauseRule(p)}>pause</Term>}
        value={<span data-testid="pause-line">{live ? pauseLine(live, p, nowSeconds) : '—'}</span>}
      />
    </Tile>
  );
}

const key = (label: string, address: string, testId: string) => (
  <ChipLink label={label} value={address} href={l1Links.address(address)} testId={testId} />
);

/** The bridge on Ethereum: the contracts and the keys that may act, each on Etherscan; the rules one link away. */
export function BridgePortal({
  snapshot,
  record,
  chainId,
  className,
}: {
  snapshot: BridgeSnapshot;
  record: { portal: string; yaca: string; registry: string };
  chainId: string;
  className?: string;
}) {
  const { faqHref } = useStatsHost();
  return (
    <Tile className={className} data-testid="bridge-portal">
      <TileHeader
        aside={
          <a href={`${faqHref}#rules`} className="hover:text-ink" data-testid="bridge-rules">
            the rules →
          </a>
        }
      >
        the bridge on {chainName(chainId)}
      </TileHeader>
      <div className="flex flex-wrap gap-2">
        {key('portal', record.portal, 'chip-portal')}
        {key('YACA', record.yaca, 'chip-yaca')}
        {key('registry', record.registry, 'chip-registry')}
        {key('multisig', snapshot.operators, 'chip-operators')}
        {snapshot.forwarders.map((f) => key('relayer', f, 'chip-forwarder'))}
      </div>
      <p className="mt-3 text-xs text-ink-3">
        The governance multisig registers versions and may pause; an authorized relayer may forward a held
        send-ahead. Everything else is the contracts’ own.
      </p>
    </Tile>
  );
}

export function NoBridge({ className }: { className?: string }) {
  return (
    <Tile className={className} data-testid="no-bridge">
      <TileHeader>bridge</TileHeader>
      <p className="text-xs text-ink-3">
        This deployment has no bridge yet: no portal on Ethereum, nothing crosses.
      </p>
    </Tile>
  );
}
