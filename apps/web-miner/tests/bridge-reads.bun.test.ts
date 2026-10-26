// The orchestration inside one reading of a send, which no pure function can show: what the
// session asks the node, in what order, and what it refuses to conclude from the answers. Built on
// the prototype with fake dependencies — the constructor wants IndexedDB, a jotai store and Vite's
// env, and none of that is what these cases are about.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Crossing } from '@yacana/bridge/journal';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { markDeployment } from '@yacana/web-kit/browser/node-health';
import type { FactReads } from '../src/bridge/facts.ts';
import { BridgeSession } from '../src/bridge/session.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const ANCHOR = 40;
const EXPIRES = 1_000n;

const base = {
  kind: 1 as const,
  chainId: '31337',
  portal: `0x${'be'.repeat(20)}` as const,
  version: '5',
  index: 0,
};
const sent = (patch: Partial<Crossing> = {}): Crossing => ({
  ...base,
  id: 'c1',
  amount: '7',
  state: 'proving',
  createdAt: 0,
  updatedAt: 0,
  ethAddress: `0x${'22'.repeat(20)}`,
  txHash: '0xdeadbeef',
  expiresAt: EXPIRES.toString(),
  anchorBlock: ANCHOR,
  ...patch,
});

/**
 * A node whose tip time and block inventory the case chooses, recording what it was asked in
 * order. `getTxReceipt` always answers `dropped` — the whole question is what that is worth.
 */
function fakeNode(opts: { tipAt: bigint | null; blocks: number[] }) {
  const asked: string[] = [];
  const block = (n: number) =>
    opts.blocks.includes(n)
      ? { header: { globalVariables: { timestamp: Number(opts.tipAt ?? 0) } } }
      : undefined;
  return {
    asked,
    node: {
      getBlockNumber: async () => {
        asked.push('tip');
        if (opts.tipAt === null) throw new Error('no answer');
        return 9_000;
      },
      getBlockData: async (n: number | 'latest') => {
        asked.push(n === 9_000 ? 'tip-block' : `block ${n}`);
        return n === 9_000
          ? { header: { globalVariables: { timestamp: Number(opts.tipAt) } } }
          : block(n as number);
      },
      getTxReceipt: async () => {
        asked.push('receipt');
        return { status: 'dropped' };
      },
    },
  };
}

/** `factReads` on the real prototype, with only the dependencies these readings touch. */
function readsFor(opts: { tipAt: bigint | null; blocks: number[] }) {
  const { node, asked } = fakeNode(opts);
  const s = Object.create(BridgeSession.prototype) as Record<string, unknown>;
  s.d = { node };
  s.ctx = { version: 5n };
  s.scope = {};
  const reads = (
    BridgeSession.prototype as unknown as { factReads: (scope: unknown) => FactReads }
  ).factReads.call(s, {});
  return { reads, asked };
}

describe('what a dropped receipt is worth', () => {
  test('the tip and the node’s reach are read before the receipt, never after it', async () => {
    markDeployment(true);
    const { reads, asked } = readsFor({ tipAt: EXPIRES + 1n, blocks: [ANCHOR] });
    expect(await reads.tx(sent())).toEqual({ status: 'dropped' });
    // A tip read after the receipt could be past an expiry a send included in between made it under.
    expect(asked.indexOf('receipt')).toBeGreaterThan(asked.indexOf('tip'));
    expect(asked.indexOf('receipt')).toBeGreaterThan(asked.indexOf(`block ${ANCHOR}`));
  });

  test('a tip that has not passed the expiry leaves it unresolved: a block could still take it', async () => {
    markDeployment(true);
    const { reads } = readsFor({ tipAt: EXPIRES, blocks: [ANCHOR] });
    expect(await reads.tx(sent())).toBeUndefined();
  });

  test('a node without the send’s own history cannot say it never happened, however late its tip', async () => {
    markDeployment(true);
    const { reads } = readsFor({ tipAt: EXPIRES + 10_000n, blocks: [] });
    expect(await reads.tx(sent())).toBeUndefined();
    // Nor can one whose deployment check has not passed, nor a record with no anchor block.
    markDeployment(false);
    expect(await readsFor({ tipAt: EXPIRES + 10_000n, blocks: [ANCHOR] }).reads.tx(sent())).toBeUndefined();
    markDeployment(true);
    const noAnchor = sent({ anchorBlock: undefined });
    expect(await readsFor({ tipAt: EXPIRES + 10_000n, blocks: [ANCHOR] }).reads.tx(noAnchor)).toBeUndefined();
  });

  test('a tip the node will not give is no clock at all', async () => {
    markDeployment(true);
    const { reads } = readsFor({ tipAt: null, blocks: [ANCHOR] });
    expect(await reads.tx(sent())).toBeUndefined();
  });
});
