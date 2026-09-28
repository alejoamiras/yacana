import { beforeAll, describe, expect, test } from 'bun:test';
import type { NodeRequestOutcome } from './node-guard.ts';

const PORTAL = `0x${'be'.repeat(20)}` as const;
/** A JSON-RPC stand-in: one chain, code at the portal and nowhere else, a tip. */
const answers = (chainId: bigint): Record<string, (params: unknown[]) => string> => ({
  eth_chainId: () => `0x${chainId.toString(16)}`,
  eth_getCode: (params) => ((params[0] as string).toLowerCase() === PORTAL ? '0x6001' : '0x'),
  eth_blockNumber: () => '0x2a',
});
const rpc = (chainId: bigint) => async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (href.includes('down')) throw new TypeError('Failed to fetch');
  // Headers at once, then a body that never comes; aborting the request errors it, as a browser does.
  if (href.includes('stall'))
    return new Response(
      new ReadableStream({
        start: (c) => init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason)),
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const { id, method, params } = JSON.parse(init?.body as string) as {
    id: number;
    method: string;
    params: unknown[];
  };
  const result = answers(chainId)[method]?.(params) ?? null;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  });
};

let mod: typeof import('./eth-rpc.ts');
let guard: typeof import('./node-guard.ts');

beforeAll(async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://yacana.test/mine/'),
    configurable: true,
    writable: true,
  });
  globalThis.fetch = rpc(11155111n) as typeof fetch;
  guard = await import('./node-guard.ts');
  guard.installNodeGuard();
  guard.setOriginalFetch(rpc(11155111n) as typeof fetch);
  mod = await import('./eth-rpc.ts');
});

describe('the Ethereum RPC setting', () => {
  test('a URL follows the node rule', () => {
    expect(mod.parseEthRpcUrl(' https://rpc.example ', 'production').href).toBe('https://rpc.example/');
    expect(() => mod.parseEthRpcUrl('http://rpc.example', 'production')).toThrow(/over https/);
    expect(mod.parseEthRpcUrl('http://127.0.0.1:8545', 'e2e').port).toBe('8545');
  });

  test('the probe wants the portal chain and the portal code, through a candidate lease', async () => {
    const probe = await mod.probeEthRpc('https://rpc.example', { chainId: 11155111n, portal: PORTAL });
    expect(probe).toMatchObject({ chainId: 11155111n, block: 42n });
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    // The lease is released: the candidate is blocked again.
    await expect(fetch('https://rpc.example')).rejects.toThrow(/blocked endpoint/);
    await expect(mod.probeEthRpc('https://rpc.example', { chainId: 1n, portal: PORTAL })).rejects.toThrow(
      /serves chain 11155111; the portal is on 1/,
    );
    await expect(
      mod.probeEthRpc('https://rpc.example', { chainId: 11155111n, portal: `0x${'00'.repeat(20)}` }),
    ).rejects.toThrow(/no portal at/);
    await expect(
      mod.probeEthRpc('https://rpc.example/down', { chainId: 11155111n, portal: PORTAL }),
    ).rejects.toThrow();
  });

  test('the health folds outcomes: ok is the last word, a failure keeps its first moment and the last ok', () => {
    const at = (status: NodeRequestOutcome['status'], latencyMs = 5): NodeRequestOutcome => ({
      endpoint: 'https://rpc.example/',
      startedAt: 0,
      status,
      latencyMs,
      retryAfter: null,
      quiet: false,
    });
    const ok = mod.nextEthRpcHealth({ kind: 'unknown' }, at(200), 1_000);
    expect(ok).toEqual({ kind: 'ok', latencyMs: 5, at: 1_000 });
    const failed = mod.nextEthRpcHealth(ok, at('network'), 2_000);
    expect(failed).toEqual({ kind: 'failed', status: 'network', since: 2_000, lastOkAt: 1_000 });
    expect(mod.nextEthRpcHealth(failed, at(503), 3_000)).toEqual({
      kind: 'failed',
      status: 503,
      since: 2_000,
      lastOkAt: 1_000,
    });
    expect(mod.nextEthRpcHealth(failed, at(429), 4_000)).toMatchObject({ kind: 'ok' });
    expect(mod.nextEthRpcHealth({ kind: 'unknown' }, at('timeout'), 5)).toEqual({
      kind: 'failed',
      status: 'timeout',
      since: 5,
      lastOkAt: null,
    });
  });

  test('a viem client with the quiet mark and a 10 s timeout leaves the health alone; the plain one does not', async () => {
    mod.startEthRpcHealth();
    mod.resetEthRpcHealth();
    const DOWN = 'https://down.example/';
    guard.setEthRpcEndpoint(DOWN, 1_000);
    try {
      await expect(mod.quietEthRpcClient(DOWN, 10_000).getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
      expect(mod.ethRpcHealth()).toEqual({ kind: 'unknown' });
      await expect(mod.ethRpcClient(DOWN).getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
      expect(mod.ethRpcHealth().kind).toBe('failed');
    } finally {
      guard.setEthRpcEndpoint(null, 1_000);
      mod.resetEthRpcHealth();
    }
  });

  test("the quiet client's deadline covers the body, not only the headers", async () => {
    const STALL = 'https://stall.example/';
    guard.setEthRpcEndpoint(STALL, 3_000);
    try {
      const started = performance.now();
      await expect(mod.quietEthRpcClient(STALL, 50).getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      guard.setEthRpcEndpoint(null, 1_000);
    }
  });

  test('the live store follows the guard once started, and a reset forgets', async () => {
    mod.startEthRpcHealth();
    mod.startEthRpcHealth();
    guard.setEthRpcEndpoint('https://live.example', 1_000);
    try {
      const seen: string[] = [];
      const off = mod.subscribeEthRpcHealth(() => seen.push(mod.ethRpcHealth().kind));
      await (
        await fetch('https://live.example', {
          method: 'POST',
          body: '{"id":1,"method":"eth_blockNumber","params":[]}',
        })
      ).text();
      expect(mod.ethRpcHealth().kind).toBe('ok');
      mod.resetEthRpcHealth();
      expect(mod.ethRpcHealth()).toEqual({ kind: 'unknown' });
      off();
      expect(seen).toEqual(['ok', 'unknown']);
    } finally {
      guard.setEthRpcEndpoint(null, 1_000);
    }
  });
});
