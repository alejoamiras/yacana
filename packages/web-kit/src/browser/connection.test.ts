import { afterAll, beforeAll, expect, test } from 'bun:test';

// Every suite shares one module registry: another may have loaded this module, and its import-time
// defaults, first. So a load is compared with the same module's load from empty storage.
const KEY = 'yacana.connection';
const DEFAULT = 'https://node.example';
const V5 = 'https://v5.testnet.rpc.aztec-labs.com';
const CUSTOM = 'https://custom.example/';
const RPC = 'https://rpc.example/';
const store = new Map<string, string>();
const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const priorDefault = process.env.VITE_AZTEC_NODE_URL;
let mod: typeof import('./connection.ts');

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  process.env.VITE_AZTEC_NODE_URL = DEFAULT;
  mod = await import('./connection.ts');
});
afterAll(() => {
  if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  if (priorDefault === undefined) delete process.env.VITE_AZTEC_NODE_URL;
  else process.env.VITE_AZTEC_NODE_URL = priorDefault;
});

const seed = (saved: object) => store.set(KEY, JSON.stringify(saved));
const saved = () => JSON.parse(store.get(KEY) ?? 'null');

test('a default node, retired or chosen with "Use the default", is no choice; a custom node is one', () => {
  store.clear();
  const unchosen = mod.loadConnection().nodeUrl;
  // V5's default as the tile saved it, slash included: no choice; the RPC beside it stays.
  seed({ nodeUrl: `${V5}/`, ethRpcUrl: RPC });
  expect(mod.loadConnection()).toMatchObject({ nodeUrl: unchosen, ethRpcUrl: RPC });
  // Today's default in either spelling, or a retired one, saves no node over a custom one.
  for (const nodeUrl of [`${DEFAULT}/`, DEFAULT, V5]) {
    seed({ nodeUrl: CUSTOM, ethRpcUrl: RPC });
    expect(mod.saveConnection({ nodeUrl })).toBe(true);
    expect(saved()).toEqual({ ethRpcUrl: RPC });
  }
  // A stored copy of today's default stays, on load and through a save of the RPC alone.
  seed({ nodeUrl: `${DEFAULT}/` });
  expect(mod.loadConnection().nodeUrl).toBe(`${DEFAULT}/`);
  expect(mod.saveConnection({ ethRpcUrl: RPC })).toBe(true);
  expect(saved()).toEqual({ nodeUrl: `${DEFAULT}/`, ethRpcUrl: RPC });
  expect([DEFAULT, `${DEFAULT}/`, V5, 'not a url'].map((u) => mod.isDefaultNode(u))).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(mod.saveConnection({ nodeUrl: CUSTOM })).toBe(true);
  expect(mod.loadConnection().nodeUrl).toBe(CUSTOM);
});
