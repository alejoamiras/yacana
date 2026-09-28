// The bridge page's one read and its sentences, pure over an injected reader; the extras the
// page draws (YACA's supply, every crossing's event with its time) arrive beside it, and the
// figures of the tiles, the bar and the chart are derived here from both.

import { type DeadlineReading, readDeadline } from '@yacana/bridge/exit-deadline';
import type { PortalPolicy, PortalReader, VersionFlows } from '@yacana/bridge/portal-reader';
import type { MigrationRecord } from '@yacana/bridge/record';
import { PARAMS } from '@yacana/miner-core/generated/params';
import type { EpochRow } from '@yacana/miner-core/reader';
import type { BarSegment, TimelineItem } from '@yacana/ui/bridge-types';
import { amount, duration } from '@yacana/web-kit/browser/format';

export interface BridgeSnapshot {
  versions: VersionFlows[];
  canonical: { version: bigint; index: bigint };
  policy: PortalPolicy;
  operators: string;
  forwarders: string[];
  /** Ethereum's clock at the read (unix seconds): what a pause, a launch or a deadline is measured against. */
  chainTime: bigint;
  /** Wall clock (ms) of the read. */
  readAt: number;
  /** The reads the page draws from: absent when they failed, the sentences stand without them. */
  extras?: BridgeExtras;
}

/** One crossing as the portal recorded it: what kind, for which version, how much, when. */
export interface FlowEvent {
  kind: 'exit' | 'send' | 'deposit' | 'redeem';
  version: bigint;
  amount: bigint;
  /** Unix seconds of the block. */
  at: number;
}

export interface BridgeExtras {
  /** YACA's total supply on Ethereum: what is there right now. */
  yacaSupply: bigint;
  events: FlowEvent[];
  /** Unix seconds of the last crossing of any kind, or null when none happened yet. */
  lastCrossingAt: number | null;
}

/** What the miner's own counters say: everything that ever left through the portal, everything that arrived. */
export interface MinerFlows {
  exited: bigint;
  claimedFromL1: bigint;
}

type BridgeReads = Pick<
  PortalReader,
  'registered' | 'flows' | 'canonical' | 'policy' | 'operators' | 'forwarders' | 'blockTime'
>;

export async function readBridge(reader: BridgeReads, now = Date.now()): Promise<BridgeSnapshot> {
  const [registered, canonical, policy, operators, forwarders, chainTime] = await Promise.all([
    reader.registered(),
    reader.canonical(),
    reader.policy(),
    reader.operators(),
    reader.forwarders(),
    reader.blockTime(),
  ]);
  const versions = await Promise.all(registered.map((v) => reader.flows(v)));
  return { versions, canonical, policy, operators, forwarders, chainTime, readAt: now };
}

/**
 * The chain's clock carried forward by the wall clock since the read, for a countdown only: whether
 * exits are closed, a launch is ahead or a pause is on is decided on `chainTime` as observed, so a
 * device clock that jumps cannot declare a version closed while Ethereum is still before the deadline.
 */
export const chainNow = (s: BridgeSnapshot, now: number): number =>
  Number(s.chainTime) + Math.max(0, Math.floor((now - s.readAt) / 1000));

const yaca = (raw: bigint): string => `${amount(raw, PARAMS.DECIMALS, 2)} ${PARAMS.TOKEN_SYMBOL}`;
const whole = (raw: bigint): string => amount(raw, PARAMS.DECIMALS, 0);
export const day = (unix: bigint | number): string =>
  new Date(Number(unix) * 1000).toISOString().slice(0, 10);
/** "Sep 5", for a timeline's dates. */
export const shortDay = (unix: bigint | number): string =>
  new Date(Number(unix) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** The portal's "never" for a deadline: the max uint256. */
const OPEN_ENDED = (1n << 256n) - 1n;
const max0 = (v: bigint): bigint => (v < 0n ? 0n : v);

const closed = (v: VersionFlows, nowSeconds: number): boolean =>
  v.deadline !== OPEN_ENDED && BigInt(nowSeconds) > v.deadline;

/** The last day as the portal computes it, from the transitions and the pause accounting at the read's block. */
export const deadlineOf = (
  v: VersionFlows,
  s: Pick<BridgeSnapshot, 'policy' | 'chainTime'>,
): DeadlineReading =>
  readDeadline({
    flipAt: v.flipAt,
    afterNextAt: v.afterNextAt,
    pausedSeconds: v.pausedSeconds,
    floor: s.policy.exitFloor,
    l1Now: s.chainTime,
  });

/**
 * The last day in the four readings: a rule before the upgrade, a floor while the version after
 * next is unseen, a cliff once the floor is past, a date only once both transitions are recorded.
 */
export function lastDayWords(
  d: DeadlineReading,
  v: VersionFlows,
  floorDays: number,
  date: (unix: bigint) => string = day,
): string {
  const afterNext = `V${v.registryIndex + 2n} going live`;
  if (d.kind === 'no-flip')
    return `the later of ${afterNext} and ${floorDays} d after the upgrade · plus paused days`;
  if (d.kind === 'floor') return `${date(d.until)} at the earliest · then ${afterNext}`;
  if (d.kind === 'any-day') return `could close any day · ${afterNext} ends it`;
  return d.closed ? `${date(d.at)} · passed` : `${date(d.at)} · plus paused days`;
}

const lastDayShort = (d: DeadlineReading): string => {
  if (d.kind === 'set') return `last day ${day(d.at)}${d.closed ? ' · passed' : ''}`;
  if (d.kind === 'floor') return `last day ${day(d.until)} at the earliest`;
  return d.kind === 'any-day' ? 'could close any day' : 'no last day yet';
};

/**
 * The exit limit in one sentence: what may leave now and what the rest waits for. Headroom is room
 * under the limit, not leave to go: a pause holds it and the last day ends it, so the line says
 * which; before the upgrade the limit grows, after it what is beyond the frozen limit never leaves.
 */
export function exitLimitLine(v: VersionFlows, policy: PortalPolicy, nowSeconds: number): string {
  const left = `${yaca(v.exited)} has left`;
  if (closed(v, nowSeconds))
    return `last day ${day(v.deadline)} · ${left}; nothing more leaves V${v.registryIndex}.`;
  const may = `${yaca(v.headroom)} may leave V${v.registryIndex}`;
  if (v.paused) return `${may} once the pause ends · ${left}.`;
  if (v.flipAt > 0n)
    return `${may} right now · the limit froze at the upgrade; ${left}. What is beyond it cannot leave.`;
  const grows = `grows ${yaca(policy.perHour)} an hour`;
  if (v.launchAt > BigInt(nowSeconds))
    return `${may} right now · the limit ${grows} from the launch on ${day(v.launchAt)}; withdrawals beyond it wait for it.`;
  return `${may} right now · ${grows}; withdrawals beyond it wait for it to grow, until the upgrade freezes it.`;
}

/** The exit limit as a row: what may leave now, or why nothing does. */
export function headroomLine(v: VersionFlows, policy: PortalPolicy, nowSeconds: number): string {
  if (closed(v, nowSeconds)) return 'last day passed · nothing more leaves';
  if (v.paused) return `${yaca(v.headroom)} once the pause ends`;
  if (v.flipAt > 0n) return `${yaca(v.headroom)} may leave · frozen at the upgrade`;
  return `${yaca(v.headroom)} may leave now · grows ${yaca(policy.perHour)} an hour`;
}

/** What the governance multisig may do with the pause, from the policy. */
export const pauseRule = (policy: PortalPolicy): string =>
  `the governance multisig may pause withdrawals and deposits for up to ${duration(Number(policy.pauseMax))} a call, ${duration(Number(policy.pauseBudget))} in total per version; paused days push the last day back`;

/** The pause in one sentence: the portal's word on whether it is on, and how much of the budget is spent. */
export function pauseLine(v: VersionFlows, policy: PortalPolicy, nowSeconds: number): string {
  const spent = `${duration(Number(v.pausedSeconds))} of ${duration(Number(policy.pauseBudget))} used`;
  if (!v.paused) return `not paused · ${spent}`;
  const more = Number(v.pausedUntil) - nowSeconds;
  return `paused${more > 0 ? ` for ${duration(more)} more` : ''} · ${spent}`;
}

export function versionLine(
  v: VersionFlows,
  s: Pick<BridgeSnapshot, 'canonical' | 'policy' | 'chainTime'>,
): string {
  const canonical = s.canonical;
  if (!v.registered) return 'not registered on the portal yet';
  if (v.version === canonical.version)
    return v.depositsClosed
      ? 'the live version · deposits closed before the upgrade'
      : 'the live version · mining, deposits and withdrawals here';
  if (v.flipAt > 0n) return `upgraded from on ${day(v.flipAt)} · ${lastDayShort(deadlineOf(v, s))}`;
  if (v.registryIndex < canonical.index) return 'upgraded from · the upgrade not yet recorded on the portal';
  return 'registered ahead of the upgrade · not live yet';
}

// ---------------------------------------------------------------- the phases

const launchedPhase = (v: VersionFlows, nowSeconds: number): TimelineItem => {
  const ahead = v.launchAt > BigInt(nowSeconds);
  return {
    id: 'launched',
    label: 'launched',
    state: ahead ? 'on' : 'done',
    detail: `${shortDay(v.launchAt)} · ${ahead ? 'the schedule starts' : 'epoch 0 opened'}`,
  };
};

const announcedPhase = (m: MigrationRecord | null, flipped: boolean, next: string): TimelineItem => ({
  id: 'announced',
  label: m ? `${next} announced` : 'not announced',
  state: m || flipped ? 'done' : 'todo',
  detail: m
    ? `${shortDay(BigInt(m.announcedAt))} · send ahead before ${shortDay(BigInt(m.expectedFlipAt))}`
    : 'mining goes on until a next version is named',
});

const flipPhase = (
  v: VersionFlows,
  m: MigrationRecord | null,
  flipped: boolean,
  next: string,
): TimelineItem => ({
  id: 'flip',
  label: `${next} canonical`,
  state: flipped ? 'done' : m ? 'on' : 'todo',
  detail: flipped
    ? `${shortDay(v.flipAt)} · mining on V${v.registryIndex} ended`
    : `${m ? `~${shortDay(BigInt(m.expectedFlipAt))} · ` : ''}mining on V${v.registryIndex} ends`,
});

/** Going quiet is the version's last proof, which nothing announces; the retire message (mining's end) is only its omen, so the phase is never done. */
const retirePhase = (v: VersionFlows, flipped: boolean): TimelineItem => ({
  id: 'retire',
  label: `V${v.registryIndex} goes quiet`,
  state: flipped ? 'on' : 'todo',
  detail: v.retireSent
    ? 'retire message sent · mining ends when the miner consumes it · proving may stop any time'
    : 'days later · nothing can leave',
});

/** The last day's phase: a rule until the upgrade, then the reading (the cliff red), done once Ethereum is past the date. */
const closesPhase = (v: VersionFlows, d: DeadlineReading, floorDays: number): TimelineItem => ({
  id: 'closes',
  label: 'last day',
  state:
    d.kind === 'set' && d.closed
      ? 'done'
      : d.kind === 'no-flip'
        ? 'todo'
        : d.kind === 'any-day'
          ? 'bad'
          : 'on',
  detail: lastDayWords(d, v, floorDays, shortDay),
});

/**
 * A version's life as a timeline: the launch (from the portal's registration), the announcement
 * (from the build's record, when it carries one), the upgrade, the retire message, its last day.
 */
export function phasesOf(
  v: VersionFlows,
  m: MigrationRecord | null,
  nowSeconds: number,
  s: Pick<BridgeSnapshot, 'policy' | 'chainTime'>,
): TimelineItem[] {
  const flipped = v.flipAt > 0n;
  const next = m ? `V${m.toIndex}` : 'the next version';
  return [
    launchedPhase(v, nowSeconds),
    announcedPhase(m, flipped, next),
    flipPhase(v, m, flipped, next),
    retirePhase(v, flipped),
    closesPhase(v, deadlineOf(v, s), Number(s.policy.exitFloor / 86_400n)),
  ];
}

// ---------------------------------------------------------------- what the page draws

const sum = (events: FlowEvent[], kinds: FlowEvent['kind'][], until = Number.POSITIVE_INFINITY): bigint =>
  events.filter((e) => kinds.includes(e.kind) && e.at <= until).reduce((a, e) => a + e.amount, 0n);

export interface Kpi {
  id: string;
  label: string;
  value: string;
  unit?: string;
  sub: string;
}

const percent = (part: bigint, whole: bigint): string =>
  whole === 0n ? '0 %' : `${(Number((part * 1000n) / whole) / 10).toFixed(0)} %`;

/** The figures every tile draws from, each undefined when its read is missing. */
export interface BridgeFigures {
  onEthereum?: bigint;
  /** Everything the miner ever minted by mining: its supply, less what came from Ethereum, plus what left. */
  mined?: bigint;
  /** Burned on the miner, not yet claimed on Ethereum. */
  transit?: bigint;
  /** Through the portal, not yet claimed on the miner. */
  waiting?: bigint;
  /** Withdrawals claimed on Ethereum and send-aheads forwarded on, for the live version (the portal's Forwarded events). */
  withdrawals?: number;
  sendAheads?: number;
  /** Unix seconds of the last crossing of any kind through the portal; null when none happened; undefined when the history could not be read. */
  lastCrossingAt?: number | null;
}

export function figuresOf(
  s: BridgeSnapshot,
  live: VersionFlows | undefined,
  miner: MinerFlows | undefined,
  supply: bigint | undefined,
): BridgeFigures {
  const x = s.extras;
  const mine = (e: FlowEvent) => !live || e.version === live.version;
  return {
    onEthereum: x?.yacaSupply,
    mined: supply !== undefined && miner ? supply - miner.claimedFromL1 + miner.exited : undefined,
    transit: miner && live ? max0(miner.exited - live.exited) : undefined,
    waiting: miner && live ? max0(live.inbound - miner.claimedFromL1) : undefined,
    withdrawals: x ? x.events.filter((e) => e.kind === 'exit' && mine(e)).length : undefined,
    sendAheads: x ? x.events.filter((e) => e.kind === 'send' && mine(e)).length : undefined,
    lastCrossingAt: x ? x.lastCrossingAt : undefined,
  };
}

const DASH = '—';

/** At most `max` of `sorted`, evenly spaced, the first and the last always among them. */
export function sampleBlocks(sorted: readonly bigint[], max: number): bigint[] {
  if (sorted.length <= max) return [...sorted];
  const step = Math.ceil((sorted.length - 1) / (max - 1));
  const picked = sorted.filter((_, i) => i % step === 0);
  const last = sorted[sorted.length - 1] as bigint;
  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}
const figure = (raw: bigint | undefined): string => (raw === undefined ? DASH : whole(raw));

/** "last crossed 2 min ago", "nothing has crossed yet", or that the history could not be read. */
export const crossingLine = (lastCrossingAt: number | null | undefined, nowSeconds: number): string =>
  lastCrossingAt === undefined
    ? 'history unavailable'
    : lastCrossingAt
      ? `last crossed ${duration(Math.max(0, nowSeconds - lastCrossingAt))} ago`
      : 'nothing has crossed yet';

/** YACA on Ethereum is one pool across versions; its share of all minted is known only while one version has minted. */
const ethereumKpi = (f: BridgeFigures, chain: string, onlyVersion: boolean): Kpi => ({
  id: 'ethereum',
  label: 'on Ethereum',
  value: figure(f.onEthereum),
  unit: 'YACA',
  sub: `an ERC-20 on ${chain}${
    onlyVersion && f.onEthereum !== undefined && f.mined !== undefined && f.mined > 0n
      ? ` · ${percent(f.onEthereum, f.mined)} of all minted`
      : ''
  }`,
});

const aztecKpi = (
  f: BridgeFigures,
  miner: MinerFlows | undefined,
  supply: bigint | undefined,
  v: string,
): Kpi => ({
  id: 'aztec',
  label: `on Aztec ${v}`,
  value: figure(supply),
  unit: PARAMS.TOKEN_SYMBOL,
  sub:
    f.mined !== undefined && miner
      ? `${whole(f.mined)} mined · ${whole(miner.exited)} left · ${whole(miner.claimedFromL1)} came back`
      : 'the private balances, in sum',
});

const transitKpi = (f: BridgeFigures): Kpi => ({
  id: 'transit',
  label: 'on the way to Ethereum',
  value: figure(f.transit),
  unit: PARAMS.TOKEN_SYMBOL,
  sub: f.transit === 0n ? 'nothing on the way' : 'burned here, not yet claimed there',
});

const waitingKpi = (f: BridgeFigures): Kpi => ({
  id: 'waiting',
  label: 'waiting to be claimed',
  value: figure(f.waiting),
  unit: PARAMS.TOKEN_SYMBOL,
  sub: f.waiting === 0n ? 'every arrival claimed' : 'arrived on Aztec, unclaimed',
});

const bridgeKpi = (s: BridgeSnapshot, live: VersionFlows | undefined): Kpi => ({
  id: 'bridge',
  label: 'bridge',
  value: live?.paused ? 'paused' : 'open',
  sub: `paused ${duration(Number(live?.pausedSeconds ?? 0n))} of ${duration(Number(s.policy.pauseBudget))}`,
});

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const leftKpi = (f: BridgeFigures, live: VersionFlows | undefined, v: string): Kpi => ({
  id: 'left',
  label: `left ${v}`,
  value: live ? whole(live.exited) : DASH,
  unit: PARAMS.TOKEN_SYMBOL,
  sub:
    f.withdrawals === undefined || f.sendAheads === undefined
      ? 'withdrawals claimed, send-aheads forwarded'
      : `${count(f.withdrawals, 'withdrawal', 'withdrawals')} claimed${f.sendAheads ? ` · ${count(f.sendAheads, 'send-ahead', 'send-aheads')} forwarded` : ''}`,
});

/**
 * The six figures: what is on Ethereum (YACA's supply), what is on the live version, what is on
 * the way to Ethereum (burned here, not yet claimed there), what waits to be claimed (through the
 * portal, not yet claimed on the miner), the bridge's state, what left the live version.
 */
export function kpisOf(
  s: BridgeSnapshot,
  live: VersionFlows | undefined,
  miner: MinerFlows | undefined,
  supply: bigint | undefined,
  _nowSeconds: number,
  chain: string,
): Kpi[] {
  const f = figuresOf(s, live, miner, supply);
  const v = live ? `V${live.registryIndex}` : 'this version';
  return [
    ethereumKpi(f, chain, s.versions.length === 1),
    aztecKpi(f, miner, supply, v),
    transitKpi(f),
    waitingKpi(f),
    bridgeKpi(s, live),
    leftKpi(f, live, v),
  ];
}

/** Where a version's coins are, for its stacked bar: still here, left to Ethereum net, crossing, moved to the next version. The miner read is `built`'s; another version's supply and transit are unknown here, not zero. */
export function whereOf(
  v: VersionFlows,
  s: BridgeSnapshot,
  miner: MinerFlows | undefined,
  supply: bigint | undefined,
  built: string,
): BarSegment[] {
  const events = s.extras ? s.extras.events.filter((e) => e.version === v.version) : [];
  const toEth = max0(sum(events, ['exit', 'redeem']) - sum(events, ['deposit']));
  const moved = sum(events, ['send']);
  const mine = v.version.toString() === built;
  const here = mine ? supply : undefined;
  const transit = mine && miner ? max0(miner.exited - v.exited) : undefined;
  const n = (raw: bigint | undefined) =>
    raw === undefined ? 0 : Number(raw / 10n ** BigInt(Math.max(0, PARAMS.DECIMALS - 6)));
  const shown = (raw: bigint | undefined) => (raw === undefined ? DASH : whole(raw));
  return [
    {
      id: 'here',
      label: `still on V${v.registryIndex}`,
      figure: shown(here),
      value: n(here),
      color: 'var(--uv)',
    },
    {
      id: 'eth',
      label: 'left to Ethereum, net',
      figure: whole(toEth),
      value: n(toEth),
      color: 'var(--ink-3)',
    },
    { id: 'transit', label: 'crossing', figure: shown(transit), value: n(transit), color: 'var(--warn)' },
    {
      id: 'moved',
      label: 'moved on',
      figure: whole(moved),
      value: n(moved),
      color: 'var(--uv-2)',
    },
  ];
}

export interface CoinsPoint {
  /** Unix seconds. */
  t: number;
  /** Whole tokens. */
  aztec: number;
  ethereum: number;
  total: number;
}

const tokens = (raw: bigint): number =>
  Number(raw / 10n ** BigInt(Math.max(0, PARAMS.DECIMALS - 4))) / 10 ** Math.min(4, PARAMS.DECIMALS);

/**
 * Where the coins are: the emission of the epochs held (each epoch's claims counted at its open,
 * times the reward) against what is on Ethereum by then (exits and redeems, less deposits); the rest
 * is on Aztec. One point per epoch open and per crossing, the last at `now`. When the rows start
 * after launch the emission is short by the missing epochs: nothing is clipped, the caller says so.
 */
export function coinsSeries(
  rows: readonly EpochRow[],
  events: FlowEvent[],
  nowSeconds: number,
): CoinsPoint[] {
  const epochs = [...rows].sort((a, b) => a.epoch - b.epoch);
  const first = epochs[0];
  if (!first) return [];
  const times = new Set<number>([...epochs.map((r) => r.openedAt), ...events.map((e) => e.at), nowSeconds]);
  const points: CoinsPoint[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t < first.openedAt) continue;
    const claims = epochs.filter((r) => r.openedAt <= t).reduce((a, r) => a + BigInt(r.claims), 0n);
    const total = claims * PARAMS.REWARD;
    const onEth = max0(sum(events, ['exit', 'redeem'], t) - sum(events, ['deposit'], t));
    points.push({ t, total: tokens(total), ethereum: tokens(onEth), aztec: tokens(max0(total - onEth)) });
  }
  return points;
}
