import { beforeAll, describe, expect, test } from 'bun:test';

// The guard captures `globalThis.fetch` when it is imported: the fake network and the page's
// location exist first, then the guard, then (as in the miner) the CRS interceptor on top of it.
const calls: { href: string; init?: RequestInit }[] = [];
const network = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push({ href, init });
  if (href.startsWith('data:')) {
    // Decoded here, not through whatever `fetch` is by now (another suite's guard may be underneath).
    const [meta, payload] = href.slice(5).split(',', 2) as [string, string];
    const bytes = meta.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload));
    return new Response(bytes, { headers: { 'content-type': meta.replace(/;base64$/, '') } });
  }
  if (href.includes('down')) throw new TypeError('Failed to fetch');
  if (href.includes('limited'))
    return new Response('{"error":{"message":"slow down"}}', {
      status: 429,
      headers: { 'retry-after': '7' },
    });
  if (href.includes('stall')) {
    // Headers at once, a body that never comes until the signal aborts it.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
      },
    });
    return new Response(body, { status: 200 });
  }
  if (href.includes('slow')) {
    // A real fetch rejects with the signal's reason; the fake must too, or the deadline is untested.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 50);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(init.signal?.reason);
      });
    });
  }
  return new Response(JSON.stringify({ ok: true, href }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const PAGE = 'https://yacana.test';
const NODE = 'https://node.example/rpc?key=a';

let guard: typeof import('./node-guard.ts');

beforeAll(async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL(`${PAGE}/mine/`),
    configurable: true,
    writable: true,
  });
  globalThis.fetch = network as typeof fetch;
  guard = await import('./node-guard.ts');
  // Another suite in the same run may have imported the guard over the real fetch, or left a gate on it
  // (the health store's): point it at this fake and clear the gate. `installNodeGuard` is idempotent
  // and never re-captures `original`, so the fake is set through `setOriginalFetch`.
  guard.installNodeGuard();
  guard.setOriginalFetch(network as typeof fetch);
  guard.setNodeGate(null);
  guard.setNodeEndpoint(NODE, 1_000);
});

describe('node guard', () => {
  test('normalises an endpoint on origin + path + query, the path exactly as the SDK posts it', () => {
    expect(guard.normaliseEndpoint('https://a.example/rpc/?k=1#x')).toBe('https://a.example/rpc/?k=1');
    expect(guard.normaliseEndpoint('https://a.example')).toBe('https://a.example/');
    expect(guard.normaliseEndpoint('https://a.example/rpc/')).not.toBe(
      guard.normaliseEndpoint('https://a.example/rpc'),
    );
    expect(guard.normaliseEndpoint('https://a.example/rpc?node=A')).not.toBe(
      guard.normaliseEndpoint('https://a.example/rpc?node=B'),
    );
  });

  test('the fingerprint is the SHA-256 of the normalised endpoint: two paths on one origin are two nodes', async () => {
    const a = await guard.endpointFingerprint('https://a.example/a');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await guard.endpointFingerprint('https://a.example/a#frag'));
    expect(a).not.toBe(await guard.endpointFingerprint('https://a.example/a/'));
    expect(a).not.toBe(await guard.endpointFingerprint('https://a.example/ab'));
  });

  test("a node on the page's own origin is still the node: the deadline, no redirects, reported", async () => {
    const seen: string[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.endpoint));
    guard.setNodeEndpoint(`${PAGE}/rpc`, 1_000);
    try {
      calls.length = 0;
      await (await fetch(`${PAGE}/rpc`, { method: 'POST', redirect: 'follow' })).text();
      await fetch('/slots/0.json');
      expect(calls[0]?.init?.redirect).toBe('error');
      expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
      expect(calls[1]?.init?.redirect).toBeUndefined();
      expect(seen).toEqual([`${PAGE}/rpc`]);
    } finally {
      off();
      guard.setNodeEndpoint(NODE, 1_000);
    }
  });

  test('same-origin and the node pass; the node gets the deadline and no redirects; the rest throws', async () => {
    calls.length = 0;
    await fetch('/slots/0.json');
    await fetch(`${NODE}`, { method: 'POST', redirect: 'follow' });
    expect(calls.map((c) => c.href)).toEqual(['/slots/0.json', NODE]);
    expect(calls[0]?.init?.redirect).toBeUndefined();
    expect(calls[1]?.init?.redirect).toBe('error');
    expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
    await expect(fetch('https://node.example/rpc?key=b')).rejects.toThrow(/blocked endpoint/);
    await expect(fetch('https://other.example/')).rejects.toThrow(/blocked endpoint/);
    await expect(fetch('https://node.example/rpcx?key=a')).rejects.toThrow(/blocked endpoint/);
  });

  test("the Ethereum RPC is a second admitted slot with its own deadline and listeners, never the node's", async () => {
    const node: string[] = [];
    const rpc: string[] = [];
    const offNode = guard.onNodeResponse((o) => node.push(o.endpoint));
    const offRpc = guard.onEthRpcResponse((o) => rpc.push(`${o.endpoint} ${o.status}`));
    const RPC = 'https://rpc.example/';
    guard.setEthRpcEndpoint(RPC, 1_000);
    try {
      calls.length = 0;
      await (await fetch(RPC, { method: 'POST', redirect: 'follow' })).text();
      expect(calls[0]?.init?.redirect).toBe('error');
      expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
      expect(guard.currentEthRpcEndpoint()).toBe(RPC);
      // The node's collisions are refused both ways.
      expect(() => guard.setNodeEndpoint(RPC, 1_000)).toThrow(/Ethereum RPC/);
      expect(() => guard.setEthRpcEndpoint(NODE, 1_000)).toThrow(/node's/);
      guard.setEthRpcEndpoint('https://rpc.example/down', 1_000);
      await expect(fetch('https://rpc.example/down')).rejects.toThrow(/Failed to fetch/);
      guard.setEthRpcEndpoint(null, 1_000);
      await expect(fetch(RPC)).rejects.toThrow(/blocked endpoint/);
    } finally {
      offNode();
      offRpc();
      guard.setEthRpcEndpoint(null, 1_000);
    }
    expect(node).toEqual([]);
    expect(rpc).toEqual([`${RPC} 200`, 'https://rpc.example/down network']);
  });

  test('a candidate lease admits one endpoint for its duration and is not reported', async () => {
    const seen: string[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.endpoint));
    const release = guard.allowCandidate('https://cand.example/rpc', 500);
    await (await fetch('https://cand.example/rpc')).text();
    await (await fetch(NODE)).text();
    release();
    await expect(fetch('https://cand.example/rpc')).rejects.toThrow(/blocked endpoint/);
    off();
    expect(seen).toEqual([guard.normaliseEndpoint(NODE)]);
  });

  test('overlapping leases of one endpoint hold it until the last release; a release twice is one', async () => {
    const first = guard.allowCandidate('https://cand.example/rpc', 500);
    const second = guard.allowCandidate('https://cand.example/rpc', 500);
    first();
    first();
    await (await fetch('https://cand.example/rpc')).text();
    second();
    await expect(fetch('https://cand.example/rpc')).rejects.toThrow(/blocked endpoint/);
  });

  test('quiet reads are reported with the flag, even when the outcome lands after the reader gave up', async () => {
    const seen: boolean[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.quiet));
    await guard.quietNodeReads(async () => (await fetch(NODE)).text());
    await (await fetch(NODE)).text();
    // A slow answer: the quiet scope exits before the body lands (the reader's own deadline fired).
    guard.setNodeEndpoint('https://node.example/slow', 1_000);
    try {
      let late: Promise<string> | undefined;
      await guard.quietNodeReads(async () => {
        late = fetch('https://node.example/slow').then((r) => r.text());
      });
      await late;
    } finally {
      guard.setNodeEndpoint(NODE, 1_000);
    }
    off();
    expect(seen).toEqual([true, false, true]);
  });

  test('the quiet mark makes its own request quiet, not one beside it, on the node and the RPC alike', async () => {
    const node: boolean[] = [];
    const rpc: boolean[] = [];
    const offNode = guard.onNodeResponse((o) => node.push(o.quiet));
    const offRpc = guard.onEthRpcResponse((o) => rpc.push(o.quiet));
    const RPC = 'https://rpc.example/';
    const marked = { [guard.QUIET]: true } as RequestInit;
    guard.setEthRpcEndpoint(RPC, 1_000);
    try {
      await Promise.all(
        [fetch(NODE, marked), fetch(NODE), fetch(RPC, marked), fetch(RPC)].map(async (r) => (await r).text()),
      );
    } finally {
      offNode();
      offRpc();
      guard.setEthRpcEndpoint(null, 1_000);
    }
    expect([node.sort(), rpc.sort()]).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  test('outcomes name the status once the body landed, a timeout and a network failure', async () => {
    const seen: (number | string)[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.status));
    const res = await fetch(NODE);
    expect(seen).toEqual([]); // headers alone are not an outcome
    await res.text();
    guard.setNodeEndpoint('https://node.example/slow', 10);
    await expect(fetch('https://node.example/slow')).rejects.toThrow();
    guard.setNodeEndpoint('https://node.example/down', 1_000);
    await expect(fetch('https://node.example/down')).rejects.toThrow(/Failed to fetch/);
    guard.setNodeEndpoint(NODE, 1_000);
    off();
    expect(seen).toEqual([200, 'timeout', 'network']);
  });

  test('a 200 whose body stalls past the deadline is one timeout, reported once', async () => {
    const seen: (number | string)[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.status));
    guard.setNodeEndpoint('https://node.example/stall', 30);
    const res = await fetch('https://node.example/stall');
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
    guard.setNodeEndpoint(NODE, 1_000);
    off();
    expect(seen).toEqual(['timeout']);
  });

  test('the Retry-After header rides along when readable', async () => {
    const seen: (string | null)[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.retryAfter));
    guard.setNodeEndpoint('https://node.example/limited', 1_000);
    await (await fetch('https://node.example/limited')).text();
    guard.setNodeEndpoint(NODE, 1_000);
    off();
    expect(seen).toEqual(['7']);
  });

  test('the gate answers an endpoint without touching the network', async () => {
    calls.length = 0;
    guard.setNodeGate(() => new Response('{"error":{"message":"cooling down"}}', { status: 429 }));
    const res = await fetch(NODE);
    expect(res.status).toBe(429);
    expect(calls).toEqual([]);
    guard.setNodeGate(null);
  });

  test('a cancelled body reports a failure once, so a recovery lock is freed without declaring success', async () => {
    const seen: (number | string)[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.status));
    const res = await fetch(NODE);
    await res.body?.cancel('done early');
    off();
    expect(seen).toEqual(['network']); // headers alone are not a completed answer
  });

  test('data: and blob: loads pass untouched — bb.js fetches its bundled WASM as data: URLs', async () => {
    const { fetchCode } = await import(
      '../../../../node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/index.js'
    );
    const bytes = new Uint8Array(await fetchCode(false));
    expect(bytes.byteLength).toBeGreaterThan(1_000_000);
    expect(String.fromCharCode(...Array.from(bytes.subarray(0, 4)))).toBe('\0asm');
  });

  test('through the CRS interceptor an unpinned host fails here, not on the network', async () => {
    calls.length = 0;
    await import('../pinned-crs.ts');
    await expect(fetch('https://crs.other-cdn.example/g1.dat')).rejects.toThrow(/blocked endpoint/);
    expect(calls).toEqual([]);
  });
});

describe('node guard, the accelerator', () => {
  const HEALTH = 'http://127.0.0.1:59833/health';
  const PROVE = 'http://127.0.0.1:59833/prove/ultra-honk';

  test('its URLs pass with the deadline and no redirects, unreported even inside a quiet scope; the rest of the host is blocked', async () => {
    const seen: string[] = [];
    const off = guard.onNodeResponse((o) => seen.push(o.endpoint));
    guard.setAcceleratorEndpoints([HEALTH, PROVE], 500);
    try {
      calls.length = 0;
      await (await fetch(HEALTH)).text();
      await guard.quietNodeReads(async () =>
        (await fetch(PROVE, { method: 'POST', redirect: 'follow' })).text(),
      );
      expect(calls.map((c) => c.href)).toEqual([HEALTH, PROVE]);
      expect(calls[1]?.init?.redirect).toBe('error');
      expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
      expect(seen).toEqual([]);
      await expect(fetch('http://127.0.0.1:59833/prove')).rejects.toThrow(/blocked endpoint/);
      await expect(fetch('http://127.0.0.1:59834/health')).rejects.toThrow(/blocked endpoint/);
      await expect(fetch('http://127.0.0.1:59833/health?x=1')).rejects.toThrow(/blocked endpoint/);
    } finally {
      off();
      guard.setAcceleratorEndpoints(null, 500);
    }
    await expect(fetch(HEALTH)).rejects.toThrow(/blocked endpoint/);
  });

  test('a node at an accelerator URL is refused, in either order', async () => {
    guard.setAcceleratorEndpoints([HEALTH, PROVE], 500);
    expect(() => guard.setNodeEndpoint(PROVE, 1_000)).toThrow(/accelerator/);
    expect(guard.currentNodeEndpoint()).toBe(NODE);
    guard.setAcceleratorEndpoints(null, 500);
    expect(() => guard.setAcceleratorEndpoints([NODE, PROVE], 500)).toThrow(/node/);
    await expect(fetch(PROVE)).rejects.toThrow(/blocked endpoint/);
  });
});
