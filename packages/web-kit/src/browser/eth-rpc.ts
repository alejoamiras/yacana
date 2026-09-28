// The Ethereum RPC as a setting, the node's twin: what a pasted URL must be, how a candidate is
// checked before it is used (it answers for the portal's chain and has the portal's code), and the
// health of the one in use from every outcome the guard reports for it. New Ethereum-bound exits
// are held back while it is failing: a burn must never ride stale eligibility.
import { createPublicClient, type Hex, http } from 'viem';
import type { SiteMode } from '../config.ts';
import { parseNodeUrl } from './node.ts';
import {
  allowCandidate,
  type NodeRequestOutcome,
  onEthRpcResponse,
  QUIET,
  type QuietInit,
} from './node-guard.ts';

/** The same rule as a node URL: https, a local http only outside production, no credentials, no fragment. */
export const parseEthRpcUrl = (text: string, mode: SiteMode): URL => parseNodeUrl(text, mode);

export interface EthRpcProbe {
  chainId: bigint;
  block: bigint;
  latencyMs: number;
}

/** A client that fails in one deadline: viem's default retries a failed request three times. */
export const ethRpcClient = (url: string) => createPublicClient({ transport: http(url, { retryCount: 0 }) });

/** For optional reads: every request quiet (RPC health never hears of it), given up after `timeoutMs`. */
export const quietEthRpcClient = (url: string, timeoutMs: number) =>
  createPublicClient({
    transport: http(url, {
      retryCount: 0,
      timeout: timeoutMs,
      fetchOptions: { [QUIET]: true } as QuietInit,
      // viem's own timeout ends when the headers arrive: this signal also bounds the body.
      fetchFn: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]),
        }),
    }),
  });

/**
 * Whether `url` serves the portal's chain and knows the portal, through a lease on the guard so a
 * candidate can be probed while another RPC is the page's. The same call is the boot's check.
 */
export async function probeEthRpc(
  url: string,
  expected: { chainId: bigint; portal: Hex },
  deadlineMs = 10_000,
  make: (url: string) => ReturnType<typeof ethRpcClient> = ethRpcClient,
): Promise<EthRpcProbe> {
  const release = allowCandidate(url, deadlineMs);
  try {
    const client = make(url);
    const t0 = performance.now();
    const [chainId, code, block] = await Promise.all([
      client.getChainId(),
      client.getCode({ address: expected.portal }),
      client.getBlockNumber({ cacheTime: 0 }),
    ]);
    const latencyMs = performance.now() - t0;
    if (BigInt(chainId) !== expected.chainId)
      throw new Error(`this RPC serves chain ${chainId}; the portal is on ${expected.chainId}`);
    if (!code || code === '0x') throw new Error(`no portal at ${expected.portal} on this RPC's chain`);
    return { chainId: BigInt(chainId), block, latencyMs };
  } finally {
    release();
  }
}

const CHAINS: Record<string, string> = {
  '1': 'Ethereum',
  '11155111': 'Sepolia',
  '17000': 'Holesky',
  '560048': 'Hoodi',
  '31337': 'local chain',
};

/** The chain by its id, as the row names it; an unknown id is said as a number. */
export const ethChainName = (chainId: string | bigint): string =>
  CHAINS[chainId.toString()] ?? `chain ${chainId.toString()}`;

export type EthRpcHealth =
  | { kind: 'unknown' }
  | { kind: 'ok'; latencyMs: number; at: number }
  | { kind: 'failed'; status: NodeRequestOutcome['status']; since: number; lastOkAt: number | null };

let health: EthRpcHealth = { kind: 'unknown' };
const listeners = new Set<() => void>();
let listening = false;

const set = (next: EthRpcHealth) => {
  health = next;
  for (const fn of listeners) fn();
};

/** Folds one outcome into the health: a success is the new word; a failure keeps the first failure's start. */
export function nextEthRpcHealth(h: EthRpcHealth, o: NodeRequestOutcome, now: number): EthRpcHealth {
  if (typeof o.status === 'number' && o.status < 500) return { kind: 'ok', latencyMs: o.latencyMs, at: now };
  return {
    kind: 'failed',
    status: o.status,
    since: h.kind === 'failed' ? h.since : now,
    lastOkAt: h.kind === 'ok' ? h.at : h.kind === 'failed' ? h.lastOkAt : null,
  };
}

/** Listens to the guard's RPC outcomes from here on; idempotent. */
export function startEthRpcHealth(): void {
  if (listening) return;
  listening = true;
  onEthRpcResponse((o) => {
    if (!o.quiet) set(nextEthRpcHealth(health, o, Date.now()));
  });
}

/** A new RPC starts with no history. */
export const resetEthRpcHealth = (): void => set({ kind: 'unknown' });

export const ethRpcHealth = (): EthRpcHealth => health;

export const subscribeEthRpcHealth = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
