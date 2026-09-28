// The node as a setting: what a pasted URL must be, how a candidate is checked before it is used,
// and the one handle every holder of the node keeps so the node can change under them.
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { jsonStringify } from '@aztec/foundation/json-rpc';
import { makeFetch } from '@aztec/foundation/json-rpc/client';
import {
  assertDeployment,
  type ExpectedDeployment,
  readLatestBlock,
  type StorageLayout,
} from '@yacana/miner-core/reader';
import type { SiteMode } from '../config.ts';
import { allowCandidate, QUIET, type QuietInit } from './node-guard.ts';

export type Node = ReturnType<typeof createAztecNodeClient>;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;

/** https only in production (a local http node in e2e and dev builds); no credentials, no fragment. */
export function parseNodeUrl(text: string, mode: SiteMode): URL {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error('not a URL');
  }
  if (url.username || url.password) throw new Error('a node URL cannot carry credentials');
  if (url.hash) throw new Error('a node URL cannot carry a fragment');
  const localHttp = url.protocol === 'http:' && LOCAL_HOST.test(url.hostname) && mode !== 'production';
  if (url.protocol !== 'https:' && !localHttp) throw new Error('a node must be reached over https');
  return url;
}

/** A client that fails in one deadline: the SDK's default retries retryable failures three times. */
export const nodeClient = (url: string): Node => createAztecNodeClient(url, {}, makeFetch([], false));

/**
 * A client for optional reads beside the page's own: each request quiet (it never opens nor extends a
 * cooldown), sent once `turn` resolves and abandoned `deadlineMs` after it leaves, no retries. The SDK's
 * transport builds each `init` itself and takes neither mark nor signal, so this one mirrors it with both.
 */
export const quietNodeClient = (url: string, deadlineMs: number, turn?: () => Promise<void>): Node =>
  createAztecNodeClient(
    url,
    {},
    async (host: string, body: unknown, extraHeaders: Record<string, string> = {}) => {
      await turn?.();
      const init: QuietInit = {
        method: 'POST',
        body: jsonStringify(body),
        headers: { 'content-type': 'application/json', ...extraHeaders },
        signal: AbortSignal.timeout(deadlineMs),
        [QUIET]: true,
      };
      const res = await fetch(host, init);
      const text = await res.text();
      let json: { error?: { message?: string } } | undefined;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(res.ok ? `Failed to parse body as JSON: ${text}` : res.statusText);
      }
      if (!res.ok)
        throw new Error(`Error ${res.status} from server ${host}: ${json?.error?.message ?? text}`);
      return { response: json, headers: res.headers };
    },
  );

export interface NodeProbe {
  chainId: bigint;
  rollupVersion: bigint;
  rollupAddress: string;
  block: number;
  /** Seconds between the latest block's timestamp and now; how far behind the node is. */
  blockAgeS: number;
  latencyMs: number;
}

/**
 * The deployment check plus the node's tip and its latency, through a lease on the guard so a
 * candidate can be probed while another node is the page's. The same call is the boot's check.
 */
export async function probeNode(
  url: string,
  expected: ExpectedDeployment,
  minerLayout: StorageLayout,
  deadlineMs = 10_000,
  make: (url: string) => Node = nodeClient,
): Promise<NodeProbe> {
  const release = allowCandidate(url, deadlineMs);
  try {
    const node = make(url);
    const t0 = performance.now();
    await assertDeployment(node, expected, minerLayout);
    const block = await readLatestBlock(node);
    const latencyMs = performance.now() - t0;
    return {
      chainId: expected.chainId,
      rollupVersion: expected.rollupVersion,
      rollupAddress: expected.rollupAddress,
      block: block.number,
      blockAgeS: Math.max(0, Math.round(Date.now() / 1000 - block.timestamp)),
      latencyMs,
    };
  } finally {
    release();
  }
}

/** The node's latest block, its checkpointed checkpoint and the block's own time: the tip the health store keeps. */
export async function readTip(node: Node): Promise<{ block: number; checkpoint: number; timestamp: number }> {
  const [latest, checkpoint] = await Promise.all([
    readLatestBlock(node),
    node.getCheckpointNumber('checkpointed'),
  ]);
  return { block: latest.number, checkpoint: Number(checkpoint), timestamp: latest.timestamp };
}

export interface SwitchableNode {
  node: Node;
  /** Points every holder of `node` at `url`; a call already in flight finishes on the client it started on. */
  use(url: string): void;
  current(): string;
}

/**
 * One handle over the current SDK client: every property read forwards to the client of that
 * moment, functions bound to it. The wallet, the controller and the pollers keep the handle, so
 * "Use this node" changes what is behind it without rebuilding them.
 */
export function switchableNode(url: string, make: (url: string) => Node = nodeClient): SwitchableNode {
  let currentUrl = url;
  let client = make(url);
  const node = new Proxy({} as Node, {
    get(_, prop) {
      const value = Reflect.get(client as object, prop) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
    },
    has: (_, prop) => prop in (client as object),
  });
  return {
    node,
    use(next) {
      if (next === currentUrl) return;
      currentUrl = next;
      client = make(next);
    },
    current: () => currentUrl,
  };
}
