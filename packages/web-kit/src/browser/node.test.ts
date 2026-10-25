import { beforeAll, describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Fr } from '@aztec-labs/aztec.js/fields';
import type { ExpectedDeployment } from '@yacana/miner-core/reader';

let mod: typeof import('./node.ts');
let guard: typeof import('./node-guard.ts');

beforeAll(async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://yacana.test/mine/'),
    configurable: true,
    writable: true,
  });
  guard = await import('./node-guard.ts');
  mod = await import('./node.ts');
});

describe('parseNodeUrl', () => {
  test('https anywhere; http only on localhost outside production; no credentials, no fragment', () => {
    expect(mod.parseNodeUrl(' https://node.example/rpc ', 'production').href).toBe(
      'https://node.example/rpc',
    );
    expect(() => mod.parseNodeUrl('http://node.example', 'production')).toThrow(/over https/);
    expect(() => mod.parseNodeUrl('http://localhost:8080', 'production')).toThrow(/over https/);
    expect(mod.parseNodeUrl('http://localhost:8080', 'e2e').port).toBe('8080');
    expect(mod.parseNodeUrl('http://127.0.0.1:1', 'dev').host).toBe('127.0.0.1:1');
    expect(() => mod.parseNodeUrl('https://user:pw@node.example', 'production')).toThrow(/credentials/);
    expect(() => mod.parseNodeUrl('https://node.example/#x', 'production')).toThrow(/fragment/);
    expect(() => mod.parseNodeUrl('node.example', 'production')).toThrow(/not a URL/);
  });
});

/** A node client stand-in: the methods the probe and the check call, each answer configurable. */
const fakeNode = (over: Partial<Record<string, unknown>> = {}) => {
  const miner = AztecAddress.fromNumberUnsafe(7);
  const token = AztecAddress.fromNumberUnsafe(8);
  const minerClass = new Fr(11);
  const tokenClass = new Fr(12);
  const expected: ExpectedDeployment = {
    chainId: 31337n,
    rollupVersion: 5n,
    rollupAddress: `0x${'ab'.repeat(20)}`,
    miner,
    minerClassId: minerClass,
    token,
    tokenClassId: tokenClass,
  };
  const node = {
    getChainId: async () => 31337,
    getNodeInfo: async () => ({
      rollupVersion: 5,
      l1ContractAddresses: { rollupAddress: { toString: () => `0x${'AB'.repeat(20)}` } },
    }),
    getContract: async (a: AztecAddress) => ({
      currentContractClassId: a.equals(miner) ? minerClass : tokenClass,
    }),
    getPublicStorageAt: async () => token.toField(),
    getBlockData: async () => ({
      header: {
        globalVariables: { blockNumber: 4242, timestamp: BigInt(Math.floor(Date.now() / 1000) - 3) },
      },
    }),
    ...over,
  };
  return { node, expected, layout: { token: { slot: new Fr(1) } } as never };
};

describe('probeNode', () => {
  test('passes a matching node with its tip and latency, under a lease that ends with it', async () => {
    const f = fakeNode();
    const probe = await mod.probeNode(
      'https://cand.example/rpc',
      f.expected,
      f.layout,
      1_000,
      () => f.node as never,
    );
    expect(probe).toMatchObject({ chainId: 31337n, rollupVersion: 5n, block: 4242 });
    expect(probe.blockAgeS).toBeGreaterThanOrEqual(2);
    expect(probe.blockAgeS).toBeLessThan(10);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    await expect(fetch('https://cand.example/rpc')).rejects.toThrow(/blocked endpoint/);
  });

  test('refuses a wrong chain, rollup version, rollup address or class id', async () => {
    const attempt = (over: Partial<Record<string, unknown>>) => {
      const f = fakeNode(over);
      return mod.probeNode('https://cand.example/rpc', f.expected, f.layout, 1_000, () => f.node as never);
    };
    await expect(attempt({ getChainId: async () => 1 })).rejects.toThrow(/on chain 1/);
    await expect(
      attempt({
        getNodeInfo: async () => ({
          rollupVersion: 6,
          l1ContractAddresses: { rollupAddress: { toString: () => `0x${'ab'.repeat(20)}` } },
        }),
      }),
    ).rejects.toThrow(/rollup version/);
    await expect(
      attempt({
        getNodeInfo: async () => ({
          rollupVersion: 5,
          l1ContractAddresses: { rollupAddress: { toString: () => `0x${'cd'.repeat(20)}` } },
        }),
      }),
    ).rejects.toThrow(/serves rollup/);
    await expect(
      attempt({ getContract: async () => ({ currentContractClassId: new Fr(99) }) }),
    ).rejects.toThrow(/has class/);
  });
});

describe('switchableNode', () => {
  test('forwards every read to the current client, binds functions to it, and moves on use()', () => {
    const made: string[] = [];
    const make = (url: string) =>
      ({
        url,
        getBlockNumber() {
          return `${(this as { url: string }).url}:tip`;
        },
        info: { rollupVersion: url.length },
      }) as never;
    const s = mod.switchableNode('https://a.example', (u) => {
      made.push(u);
      return make(u);
    });
    const held = s.node as unknown as { getBlockNumber: () => string };
    const bound = held.getBlockNumber;
    expect(held.getBlockNumber()).toBe('https://a.example:tip');
    expect('getBlockNumber' in held).toBe(true);
    s.use('https://b.example');
    expect(s.current()).toBe('https://b.example');
    expect(held.getBlockNumber()).toBe('https://b.example:tip');
    // A function read before the switch stays bound to the client of that moment.
    expect(bound()).toBe('https://a.example:tip');
    s.use('https://b.example');
    expect(made).toEqual(['https://a.example', 'https://b.example']);
    expect(guard).toBeDefined();
  });
});
