// What the page knows about its node, in two clocks: the transport (is the node answering, is it
// asking us to back off) from every outcome the guard reports, and the freshness (when did this
// page last get usable chain data) from the pollers. During a cooldown the guard itself answers the
// node's requests with a synthetic failure, so nothing — not the pollers, not the PXE — keeps
// hammering; at the deadline one request goes to the network while the rest keep the synthetic
// answer until it lands. Only `waitTurn()` (the boot) actually waits for that recovery's outcome.
import { currentNodeEndpoint, type NodeRequestOutcome, onNodeResponse, setNodeGate } from './node-guard.ts';

export type Transport =
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'throttled'; retryAt: number; status: 429; backoffMs: number }
  | { kind: 'silent'; since: number; retryAt: number; backoffMs: number };

/** The node's latest block as the pollers last saw it. */
export interface NodeTip {
  block: number;
  /** The node's last checkpointed checkpoint number. */
  checkpoint: number;
  /** The block's own timestamp (s): its age is what the user feels, not the verdict. */
  timestamp: number;
  observedAt: number;
}

/** The rollup's view from L1: every checkpoint the node should have. */
export interface L1Sample {
  pendingCheckpoint: number;
  /** The L1 head the sample was read at: a sample whose head did not move is a cached answer, not news. */
  head: number;
  at: number;
}

export interface NodeHealth {
  transport: Transport;
  /** The pollers' last successful chain read (ms since epoch); null before the first. */
  lastReadAt: number | null;
  tip: NodeTip | null;
  l1: L1Sample | null;
  /** Whether the node in use passed the deployment check; null until it was run. */
  deploymentOk: boolean | null;
  /** The last fresh comparison's verdict, kept while L1 says nothing new: a known lag is never cleared by silence. */
  behind: boolean;
}

export type NodeStanding = 'healthy' | 'behind' | 'throttled' | 'silent' | 'unknown';

/** An L1 sample older than this says nothing about now. */
export const L1_FRESH_MS = 60_000;
/** A tip older than this (the signed-out poll is every 30 s) is no observation of the node now. */
export const TIP_FRESH_MS = 90_000;
/** The node may lag the rollup by this many checkpoints without being behind. */
export const BEHIND_CHECKPOINTS = 1;

export type HealthEvent =
  | { type: 'ok'; latencyMs: number }
  | { type: '429'; retryAfterS: number | null }
  | { type: 'failed' };

const THROTTLE_MIN_MS = 15_000;
const THROTTLE_MAX_MS = 60_000;
const SILENT_MIN_MS = 20_000;
const SILENT_MAX_MS = 60_000;
const CLAMP_MIN_MS = 5_000;
const CLAMP_MAX_MS = 120_000;
/** Opaque network failures this close together after successes read as a rate limit without CORS headers. */
const OPAQUE_BURST = 3;
const OPAQUE_WINDOW_MS = 30_000;

const OK: Transport = { kind: 'ok', latencyMs: 0 };

const FRESH: Omit<NodeHealth, 'transport'> = {
  lastReadAt: null,
  tip: null,
  l1: null,
  deploymentOk: null,
  behind: false,
};

let health: NodeHealth = { transport: OK, ...FRESH };
const listeners = new Set<() => void>();
let opaque: number[] = [];
/** Set while the one recovery request at a deadline is on the network. */
let probing = false;
/** performance.now() when `probing` was set: only the recovery it admitted may clear it. */
let probingSince = 0;
/** performance.now() when the current cooldown was observed: a success that started earlier is stale. */
let cooldownFrom = 0;
/** performance.now() of the last reset: an outcome that started before it belongs to the node before. */
let resetAt = 0;

const emit = () => {
  for (const fn of listeners) fn();
};

const set = (next: NodeHealth) => {
  health = next;
  emit();
};

/** `Retry-After` as seconds: delta-seconds or an HTTP-date in the future; anything else is null. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  if (Number.isNaN(at) || at <= now) return null;
  return Math.round((at - now) / 1000);
}

/** One outcome into one event; pure. A 429's header is read here so the store never sees a Response. */
export function classify(o: NodeRequestOutcome): HealthEvent {
  if (o.status === 429) return { type: '429', retryAfterS: parseRetryAfter(o.retryAfter) };
  if (typeof o.status === 'number' && o.status < 500) return { type: 'ok', latencyMs: o.latencyMs };
  return { type: 'failed' };
}

const clamp = (ms: number) => Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, ms));
const grow = (previous: number | undefined, min: number, max: number) =>
  previous === undefined ? min : Math.min(max, previous * 2);

/** The next transport state for an event; pure, so every rule is testable on its own. */
export function nextTransport(t: Transport, e: HealthEvent, now: number): Transport {
  if (e.type === 'ok') return { kind: 'ok', latencyMs: e.latencyMs };
  if (e.type === '429') {
    const backoffMs =
      e.retryAfterS !== null
        ? clamp(e.retryAfterS * 1000)
        : grow(t.kind === 'throttled' ? t.backoffMs : undefined, THROTTLE_MIN_MS, THROTTLE_MAX_MS);
    return { kind: 'throttled', retryAt: now + backoffMs, status: 429, backoffMs };
  }
  const backoffMs = grow(t.kind === 'silent' ? t.backoffMs : undefined, SILENT_MIN_MS, SILENT_MAX_MS);
  return { kind: 'silent', since: t.kind === 'silent' ? t.since : now, retryAt: now + backoffMs, backoffMs };
}

/** A cooldown is in force while its deadline has not passed, or while the recovery request is out. */
export const coolingDown = (t: Transport, now = Date.now()): boolean =>
  t.kind !== 'ok' && (now < t.retryAt || probing);

/** One outcome of the current endpoint into the store; exported for tests, the guard feeds it in production. */
export function recordOutcome(o: NodeRequestOutcome): void {
  // A → B → A: an answer from the first visit to A passes the endpoint check but predates the reset.
  if (o.startedAt < resetAt) return;
  // Optional work never opens a cooldown; once one is on, its answers count (it may be the recovery).
  if (o.quiet && health.transport.kind === 'ok') return;
  const now = Date.now();
  let event = classify(o);
  // A success that started before the request that opened the cooldown says nothing about now.
  if (event.type === 'ok' && health.transport.kind !== 'ok' && o.startedAt < cooldownFrom) return;
  // An edge's 429 without CORS headers reaches fetch as a TypeError; a burst of those right after
  // successes is a throttle, not silence.
  if (o.status === 'network') {
    opaque = [...opaque.filter((t) => now - t < OPAQUE_WINDOW_MS), now];
    if (opaque.length >= OPAQUE_BURST) event = { type: '429', retryAfterS: null };
  } else if (event.type === 'ok') opaque = [];
  const transport = nextTransport(health.transport, event, now);
  // The cooldown is observed now, not when the failing request was sent: a success already in flight
  // when the throttle began does not prove it has lifted, so it must not clear the cooldown either.
  if (transport.kind !== 'ok' && health.transport.kind === 'ok') cooldownFrom = performance.now();
  set({ ...health, transport });
}

/** Tests only: a transport state without the outcomes that would take real seconds to reach it. */
export const setTransportForTests = (t: Transport): void => set({ ...health, transport: t });
/** Tests only: a whole health record, for the standing's rules. */
export const setHealthForTests = (h: Partial<NodeHealth>): void => set({ ...health, ...h });

const synthetic = (t: Transport): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: t.kind === 'throttled' ? 'the node is rate-limiting this page' : 'the node is not answering',
      },
    }),
    { status: t.kind === 'throttled' ? 429 : 503, headers: { 'content-type': 'application/json' } },
  );

let started = false;

/** Wires the store to the guard: outcomes in, the cooldown gate out. Idempotent. */
export function startNodeHealth(): void {
  if (started) return;
  started = true;
  onNodeResponse((o) => {
    // A late answer from an endpoint that is no longer the page's says nothing about the current one.
    if (o.endpoint !== currentNodeEndpoint()) return;
    // Only the recovery this deadline admitted clears the lock: an obsolete answer that started
    // before it (an ignored stale success) must not free the gate while the recovery is still out.
    if (probing && o.startedAt >= probingSince) probing = false;
    recordOutcome(o);
  });
  setNodeGate(() => {
    const t = health.transport;
    if (t.kind === 'ok') return null;
    if (Date.now() < t.retryAt) return synthetic(t);
    // The deadline passed: one request goes to the network as the recovery; the rest keep the
    // synthetic answer until its outcome lands (`waitTurn` is what actually waits for it).
    if (probing) return synthetic(t);
    probing = true;
    probingSince = performance.now();
    return null;
  });
}

/** The pollers say when usable chain data arrived; the interceptor never does. */
export const markRead = (at = Date.now()): void => set({ ...health, lastReadAt: at });

const l1Fresh = (h: NodeHealth, now: number): boolean => h.l1 !== null && now - h.l1.at <= L1_FRESH_MS;
/** The tip is read beside the poll and its failure is swallowed: an old observation says nothing about the node now. */
const tipFresh = (h: NodeHealth, now: number): boolean =>
  h.tip !== null && now - h.tip.observedAt <= TIP_FRESH_MS;

/** Behind when fresh samples of both sides say the node lacks more than the tolerance; otherwise the last verdict stands. */
const verdict = (h: NodeHealth, now: number): boolean =>
  h.tip !== null && h.l1 !== null && tipFresh(h, now) && l1Fresh(h, now)
    ? h.l1.pendingCheckpoint - h.tip.checkpoint > BEHIND_CHECKPOINTS
    : h.behind;

/** The node's tip as a poller read it (the public epoch poll, the session's refresh). */
export function recordTip(tip: Omit<NodeTip, 'observedAt'>, now = Date.now()): void {
  const next = { ...health, tip: { ...tip, observedAt: now } };
  set({ ...next, behind: verdict(next, now) });
}

/**
 * The rollup's pending checkpoint from L1. Counts only with a head past the last sample's: an RPC
 * answering from a cache would otherwise keep a stale view fresh. Returns whether it counted.
 */
export function recordL1(sample: Omit<L1Sample, 'at'>, now = Date.now()): boolean {
  if (health.l1 !== null && sample.head <= health.l1.head) return false;
  const next = { ...health, l1: { ...sample, at: now } };
  set({ ...next, behind: verdict(next, now) });
  return true;
}

/** The RPC changed: its head is no baseline for the next one's; the verdict stands until a fresh sample says otherwise. */
export const resetL1 = (): void => set({ ...health, l1: null });

/** The row's Retry: the cooldown's deadline is now, so the next request goes to the network as the recovery. */
export function retryNode(): void {
  const t = health.transport;
  if (t.kind === 'ok') return;
  set({ ...health, transport: { ...t, retryAt: Date.now() } });
}

/** The deployment check's outcome for the node in use (the boot's probe, a switch's). */
export const markDeployment = (ok: boolean): void => set({ ...health, deploymentOk: ok });

/**
 * One word for the node: the transport's while it is not answering, `behind` while a fresh L1
 * sample last said so, `healthy` only with the deployment checked and L1 fresh; `unknown` otherwise
 * (the chip then shows the transport's word, never a verdict L1 could not give).
 */
export function standing(h: NodeHealth, now: number): NodeStanding {
  if (h.transport.kind === 'throttled') return 'throttled';
  if (h.transport.kind === 'silent') return 'silent';
  if (h.behind) return 'behind';
  if (h.deploymentOk && tipFresh(h, now) && l1Fresh(h, now)) return 'healthy';
  return 'unknown';
}

/** Seconds since the tip's block was made; null before any tip. */
export const tipAgeS = (h: NodeHealth, now: number): number | null =>
  h.tip === null ? null : Math.max(0, Math.round(now / 1000 - h.tip.timestamp));

/** The store forgets the old node: a switch starts from `ok`. */
export const resetNodeHealth = (): void => {
  opaque = [];
  probing = false;
  probingSince = 0;
  cooldownFrom = 0;
  resetAt = performance.now();
  set({ transport: OK, ...FRESH });
};

export const nodeHealth = (): NodeHealth => health;

export interface BannerState {
  kind: 'throttled' | 'silent' | 'stale';
  /** Seconds the numbers have been old (throttled, stale) or the node quiet (silent); null before any read. */
  ageS: number | null;
  /** Seconds to the next attempt; null when nothing is scheduled. */
  retryInS: number | null;
}

/** What the banner says for a state, or nothing: pure, so the three apps derive it the same way. */
export function bannerState(h: NodeHealth, now: number, staleAfterMs: number): BannerState | null {
  const t = h.transport;
  const readAge = h.lastReadAt === null ? null : Math.max(0, Math.round((now - h.lastReadAt) / 1000));
  if (t.kind === 'throttled')
    return { kind: 'throttled', ageS: readAge, retryInS: Math.max(0, Math.ceil((t.retryAt - now) / 1000)) };
  if (t.kind === 'silent')
    return {
      kind: 'silent',
      ageS: Math.max(0, Math.round((now - t.since) / 1000)),
      retryInS: Math.max(0, Math.ceil((t.retryAt - now) / 1000)),
    };
  if (readAge !== null && readAge * 1000 > staleAfterMs)
    return { kind: 'stale', ageS: readAge, retryInS: null };
  return null;
}

/** For React: `useSyncExternalStore(subscribeNodeHealth, nodeHealth, nodeHealth)` — this package has no React. */
export const subscribeNodeHealth = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/**
 * Resolves when the endpoint is usable again: at once when `ok`; at the deadline when no recovery
 * is out; when a recovery in flight settles (`ok` resolves everyone, a failure re-arms the wait).
 * An abort of `signal` resolves it at once and leaves nothing armed.
 */
export function waitTurn(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      off();
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const check = () => {
      const t = health.transport;
      if (t.kind === 'ok' || (Date.now() >= t.retryAt && !probing)) {
        done();
        return true;
      }
      return false;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Before the deadline a timer wakes the check; past it (a recovery out) the outcome's emission does.
    const arm = () => {
      const t = health.transport;
      clearTimeout(timer);
      if (t.kind === 'ok' || Date.now() >= t.retryAt) return;
      timer = setTimeout(() => void check(), t.retryAt - Date.now() + 1);
    };
    const off = subscribeNodeHealth(() => {
      if (!check()) arm();
    });
    if (signal?.aborted) return done();
    signal?.addEventListener('abort', done);
    if (!check()) arm();
  });
}
