import { describe, expect, test } from 'bun:test';
import type { Tx } from '@aztec-labs/stdlib/tx';
import { type SentTx, sendObserver } from '../src/wallet.ts';

const tx = (hash: string, expiresAt: number, anchorBlock: number): Tx =>
  ({
    getTxHash: () => ({ toString: () => hash }),
    data: {
      expirationTimestamp: BigInt(expiresAt),
      constants: { anchorBlockHeader: { globalVariables: { blockNumber: anchorBlock } } },
    },
  }) as unknown as Tx;

describe('the send observer', () => {
  test('every send is observed; a turn’s hook runs before the node sees its own send, and a refusal stops it', async () => {
    const seen: SentTx[] = [];
    const order: string[] = [];
    const o = sendObserver((s) => seen.push(s));
    const target = { sendTx: async () => void order.push('node') };
    // No turn: straight through, and the observation is synchronous.
    await o.sendTx(target, tx('0xa', 100, 7));
    expect(seen).toEqual([{ txHash: '0xa', expiresAt: 100, anchorBlock: 7 }]);
    // A turn's hook: committed before the node, then gone with the turn.
    await o.turn(() => o.sendTx(target, tx('0xb', 200, 8)), {
      hook: async (s) => void order.push(`hook ${s.txHash}`),
    });
    await o.sendTx(target, tx('0xc', 300, 9));
    expect(order).toEqual(['node', 'hook 0xb', 'node', 'node']);
    // A hook that fails refuses the send: nothing reaches the node, and the turn passes on.
    const refused = o.turn(() => o.sendTx(target, tx('0xd', 400, 10)), {
      hook: async () => {
        throw new Error('storage failed');
      },
    });
    await expect(refused).rejects.toThrow('storage failed');
    expect(order).toHaveLength(4);
    await o.turn(() => o.sendTx(target, tx('0xe', 500, 11)));
    expect(order).toHaveLength(5);
  });

  test('one transaction at the wallet at a time: a later turn cannot take an earlier one’s hook or its prover’s word', async () => {
    const order: string[] = [];
    const o = sendObserver(() => {});
    const target = { sendTx: async () => void order.push('node') };
    let proveExit = () => {};
    const exitProving = new Promise<void>((r) => {
      proveExit = r;
    });
    // The exit holds the wallet while it proves; the withdraw arrives meanwhile and must wait.
    const exit = o.turn(
      async () => {
        await exitProving;
        o.said()?.('wasm');
        await o.sendTx(target, tx('0xexit', 100, 1));
        order.push('exit waits for its block');
      },
      { hook: async (s) => void order.push(`recorded ${s.txHash}`), said: (p) => order.push(`exit: ${p}`) },
    );
    const withdraw = o.turn(
      async () => {
        o.said()?.('presto');
        await o.sendTx(target, tx('0xwithdraw', 200, 2));
      },
      { said: (p) => order.push(`withdraw: ${p}`) },
    );
    await Promise.resolve();
    expect(order).toEqual([]);
    proveExit();
    await Promise.all([exit, withdraw]);
    // The turn passed at the exit's submission: the withdraw did not wait for the exit's block.
    expect(order.slice(0, 3)).toEqual(['exit: wasm', 'recorded 0xexit', 'node']);
    expect(order).toContain('withdraw: presto');
    expect(order.filter((x) => x.startsWith('recorded'))).toEqual(['recorded 0xexit']);
    // A turn that ends without sending passes on too.
    await o.turn(async () => {});
    await o.turn(() => o.sendTx(target, tx('0xlast', 300, 3)));
  });
});
