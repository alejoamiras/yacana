// The wallet's ETH against a portal call's gas, over a transport that answers one request at a
// time: what matters is that either reading failing leaves the verdict unknown rather than "no
// ETH", which would refuse a claim the wallet could have paid for.
import { describe, expect, test } from 'bun:test';
import { INBOX_BUCKET_GAS } from '@yacana/bridge/inbox';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { custom, type Hex } from 'viem';
import { anvil } from 'viem/chains';
import { createConfig } from 'wagmi';
import type { WagmiConfig } from '../src/bridge/eth.ts';
import { inboxWriteGas, type PortalCall, payerFunds } from '../src/bridge/eth-balance.ts';

const ACCOUNT = `0x${'aa'.repeat(20)}` as Hex;
const CALL: PortalCall<typeof yacanaPortalAbi, 'deposit'> = {
  address: `0x${'be'.repeat(20)}` as Hex,
  abi: yacanaPortalAbi,
  functionName: 'deposit',
  args: [7n, `0x${'11'.repeat(32)}` as Hex, 5n, 900n],
};

/** A chain that answers `answers` alone; the shape wagmi's actions need, not the app's own config. */
const config = (answers: Record<string, unknown>) =>
  createConfig({
    chains: [anvil],
    transports: {
      [anvil.id]: custom({
        async request({ method }: { method: string }) {
          if (method === 'eth_chainId') return `0x${anvil.id.toString(16)}`;
          if (method in answers) {
            const a = answers[method];
            if (a instanceof Error) throw a;
            return a;
          }
          throw new Error(`no answer for ${method}`);
        },
      }),
    },
  }) as unknown as WagmiConfig;

/** A base fee of 1 gwei and no priority fee; viem quotes 1.2× the base. */
const FEES = {
  eth_maxPriorityFeePerGas: '0x0',
  eth_getBlockByNumber: { number: '0x64', baseFeePerGas: '0x3b9aca00' },
};
/** A deposit writes an Inbox, so its 21,000-gas estimate is priced with a new bucket on top. */
const GAS_COST = (21_000n + INBOX_BUCKET_GAS) * 1_200_000_000n;

const forward = (kind: number): PortalCall<typeof yacanaPortalAbi, 'forward'> => ({
  address: CALL.address,
  abi: yacanaPortalAbi,
  functionName: 'forward',
  args: [
    5n,
    {
      kind,
      amount: 7n,
      aux: `0x${'11'.repeat(32)}`,
      recipientOrRedeemKey: ACCOUNT,
      epoch: 3n,
      numCheckpointsInEpoch: 1n,
      leafIndex: 0n,
      path: [],
      sig: '0x',
      expiry: 0n,
    },
  ],
});

describe("the payer's ETH against a call", () => {
  test('both numbers known: enough follows the comparison, and the balance is the wei the RPC gives', async () => {
    const rich = config({ eth_getBalance: '0xde0b6b3a7640000', eth_estimateGas: '0x5208', ...FEES });
    expect(await payerFunds(rich, ACCOUNT, CALL)).toEqual({
      balance: 10n ** 18n,
      cost: GAS_COST,
      enough: true,
    });
    // A wallet holding less than the gas: the page says so itself, without asking the wallet.
    const poor = config({ eth_getBalance: '0x2710', eth_estimateGas: '0x5208', ...FEES });
    expect(await payerFunds(poor, ACCOUNT, CALL)).toMatchObject({ balance: 10_000n, enough: false });
  });

  test('either reading failing alone leaves the verdict unknown, never "no ETH"', async () => {
    const noBalance = config({
      eth_getBalance: new Error('rpc down'),
      eth_estimateGas: '0x5208',
      ...FEES,
    });
    expect(await payerFunds(noBalance, ACCOUNT, CALL)).toEqual({
      balance: null,
      cost: GAS_COST,
      enough: null,
    });
    // A call that would revert cannot be estimated: the cost is unknown, not zero.
    const noEstimate = config({ eth_getBalance: '0x2710', eth_estimateGas: new Error('reverted') });
    expect(await payerFunds(noEstimate, ACCOUNT, CALL)).toEqual({
      balance: 10_000n,
      cost: null,
      enough: null,
    });
    // No call to price at all (a send-ahead's forward, whose signature is not made for an estimate).
    expect(await payerFunds(noEstimate, ACCOUNT, undefined)).toEqual({
      balance: 10_000n,
      cost: null,
      enough: null,
    });
  });

  test('a write that sends an Inbox message names its estimate plus a new bucket; any other leaves it to the wallet', async () => {
    const rpc = config({ eth_estimateGas: '0x5208' });
    expect(await inboxWriteGas(rpc, ACCOUNT, CALL)).toBe(21_000n + INBOX_BUCKET_GAS);
    expect(await inboxWriteGas(rpc, ACCOUNT, forward(2))).toBe(21_000n + INBOX_BUCKET_GAS);
    expect(await inboxWriteGas(rpc, ACCOUNT, forward(1))).toBeUndefined();
  });
});
