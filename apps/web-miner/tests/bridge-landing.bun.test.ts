import { describe, expect, test } from 'bun:test';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { type Crossing, knownEth, UNKNOWN_ETH } from '@yacana/bridge/journal';
import { deriveCrossingSecrets } from '@yacana/bridge/secrets';
import type { Arrivals, Arrived } from '../src/bridge/landing.ts';
import { arrivalCandidates, landed, matchArrivals, twinOf } from '../src/bridge/landing.ts';

const PORTAL = `0x${'be'.repeat(20)}` as const;
const DEPOSITOR = `0x${'d0'.repeat(20)}` as const;
const master = new Uint8Array(32).map((_, i) => i);
const scope = { chainId: 31337n, portal: EthAddress.fromString(PORTAL) };
const hash = async (version: bigint, index: number) =>
  (await deriveCrossingSecrets(master, { ...scope, version }, index)).secretHash.toString() as `0x${string}`;

describe('the landing scan', () => {
  test('candidates are the window of indices under each source version and this one', async () => {
    const c = await arrivalCandidates(master, scope, { sources: [5n], current: 6n }, 3);
    expect(c.map((x) => `${x.kind}:${x.version}:${x.index}`)).toEqual([
      '2:5:0',
      '2:5:1',
      '2:5:2',
      '3:6:0',
      '3:6:1',
      '3:6:2',
    ]);
    expect(c[1]?.secretHash).toBe(await hash(5n, 1));
  });

  test("the portal's events pick out this master's crossings, in the state the event puts them in", async () => {
    const candidates = await arrivalCandidates(master, scope, { sources: [5n], current: 6n }, 3);
    const arrivals: Arrivals = {
      forwarded: [
        {
          secretHash: await hash(5n, 1),
          source: 5n,
          target: 6n,
          amount: 7n,
          inboxIndex: 41n,
          txHash: '0xf1',
          epoch: 3n,
          leafId: 2n,
        },
        // Someone else's send-ahead, and one of ours forwarded from a version we did not ask about.
        {
          secretHash: `0x${'aa'.repeat(32)}`,
          source: 5n,
          target: 6n,
          amount: 1n,
          inboxIndex: 42n,
          txHash: '0xf2',
          epoch: 3n,
          leafId: 3n,
        },
        {
          secretHash: await hash(4n, 0),
          source: 4n,
          target: 6n,
          amount: 1n,
          inboxIndex: 43n,
          txHash: '0xf3',
          epoch: 1n,
          leafId: 2n,
        },
      ],
      deposited: [
        {
          sender: DEPOSITOR,
          secretHash: await hash(6n, 0),
          version: 6n,
          amount: 3n,
          inboxIndex: 44n,
          txHash: '0xd1',
        },
        // A deposit into another version under our label is not ours here.
        {
          sender: DEPOSITOR,
          secretHash: await hash(6n, 2),
          version: 5n,
          amount: 3n,
          inboxIndex: 45n,
          txHash: '0xd2',
        },
      ],
    };
    const here = { chainId: '31337', portal: PORTAL, current: 6n };
    const arrived = matchArrivals(arrivals, candidates, here);
    const found = arrived.map((a) => a.crossing(1_000));
    expect(found.map((c) => [c.kind, c.version, c.index, c.state, c.inboxIndex, c.amount])).toEqual([
      [2, '5', 1, 'forwarded', '41', '7'],
      [3, '6', 0, 'deposited', '44', '3'],
    ]);
    expect(found[0]?.target).toBe('6');
    const [send, dep] = arrived as [Arrived, Arrived];
    // A crossing the journal knows keeps its own record, however far along.
    const claimed: Crossing = { ...(found[0] as Crossing), state: 'minted-l2', claimTxHash: '0xc' };
    expect(landed(claimed, send, 2_000)).toBe(claimed);
    // A deposit the wallet answered after the page closed is still `proving` in the journal, at the amount
    // last asked: the event moves it on, at the amount Ethereum saw.
    const unanswered: Crossing = {
      ...(found[1] as Crossing),
      state: 'proving',
      amount: '9',
      inboxIndex: undefined,
      l1TxHash: undefined,
    };
    expect(landed(unanswered, dep, 3_000)).toMatchObject({
      state: 'deposited',
      amount: '3',
      inboxIndex: '44',
      l1TxHash: '0xd1',
      updatedAt: 3_000,
    });
    // Two devices of one account derived the same index: the second message under it is its own
    // row, keyed by its message, and the stored row keeps the message it already holds.
    const [other] = matchArrivals(
      {
        forwarded: [],
        deposited: [
          {
            sender: DEPOSITOR,
            secretHash: await hash(6n, 0),
            version: 6n,
            amount: 3n,
            inboxIndex: 77n,
            txHash: '0xd9',
          },
        ],
      },
      candidates,
      here,
    ) as [Arrived];
    const stored = landed(unanswered, dep, 3_000);
    expect(twinOf(stored, other, 4_000)).toMatchObject({
      id: `${stored.id}:6:77`,
      inboxIndex: '77',
      state: 'deposited',
      l1TxHash: '0xd9',
    });
    expect(twinOf(stored, dep, 4_000)).toBeUndefined();
    expect(twinOf(unanswered, other, 4_000)).toBeUndefined();
    // A held send's amount was fixed at its burn: a forwarded message of another amount under its
    // index is another device's send, left where it is and given its own row.
    const held: Crossing = {
      ...(found[0] as Crossing),
      state: 'held',
      inboxIndex: undefined,
      target: undefined,
      l1TxHash: undefined,
    };
    expect(landed(held, send, 5_000)).toMatchObject({ state: 'forwarded', inboxIndex: '41' });
    const [nine] = matchArrivals(
      {
        forwarded: [{ ...arrivals.forwarded[0], amount: 9n, inboxIndex: 52n, txHash: '0xf9' } as never],
        deposited: [],
      },
      candidates,
      here,
    ) as [Arrived];
    expect(landed(held, nine, 5_000)).toBe(held);
    expect(twinOf(held, nine, 5_000)).toMatchObject({
      id: `${held.id}:6:52`,
      amount: '9',
      state: 'forwarded',
    });
    // A witnessed send is its leaf: the same amount under its index from another leaf is another send.
    const witnessed: Crossing = {
      ...held,
      state: 'witnessed',
      witness: {
        version: '5',
        index: 1,
        kind: 2,
        amount: '7',
        aux: await hash(5n, 1),
        recipientOrRedeemKey: `0x${'22'.repeat(20)}`,
        txHash: `0x${'33'.repeat(32)}`,
        epoch: '3',
        numCheckpointsInEpoch: 1,
        leafIndex: '0',
        path: [`0x${'44'.repeat(32)}`],
      },
    };
    expect(landed(witnessed, send, 6_000)).toMatchObject({ state: 'forwarded', inboxIndex: '41' });
    const [sameAmount] = matchArrivals(
      {
        forwarded: [{ ...arrivals.forwarded[0], inboxIndex: 53n, txHash: '0xf7', leafId: 3n } as never],
        deposited: [],
      },
      candidates,
      here,
    ) as [Arrived];
    expect(landed(witnessed, sameAmount, 6_000)).toBe(witnessed);
    expect(twinOf(witnessed, sameAmount, 6_000)).toMatchObject({ id: `${held.id}:6:53`, state: 'forwarded' });
    // A send forwarded into another version is not an arrival here.
    const elsewhere = matchArrivals(arrivals, candidates, { ...here, current: 7n });
    expect(elsewhere.map((a) => a.crossing(1).kind)).toEqual([3]);
    // The next window starts where this one ended.
    const later = await arrivalCandidates(master, scope, { sources: [], current: 6n }, 3, 3);
    expect(later.map((x) => x.index)).toEqual([3, 4, 5]);
  });

  test('a deposit carries its depositor; a row recorded without one learns it from its own event, at any state', async () => {
    const candidates = await arrivalCandidates(master, scope, { sources: [5n], current: 6n }, 3);
    const here = { chainId: '31337', portal: PORTAL, current: 6n };
    const [send, dep] = matchArrivals(
      {
        forwarded: [
          {
            secretHash: await hash(5n, 1),
            source: 5n,
            target: 6n,
            amount: 7n,
            inboxIndex: 41n,
            txHash: '0xf1',
            epoch: 3n,
            leafId: 2n,
          },
        ],
        deposited: [
          {
            sender: DEPOSITOR,
            secretHash: await hash(6n, 0),
            version: 6n,
            amount: 3n,
            inboxIndex: 44n,
            txHash: '0xd1',
          },
        ],
      },
      candidates,
      here,
    ) as [Arrived, Arrived];
    const fresh = dep.crossing(1_000);
    expect(fresh.ethAddress).toBe(DEPOSITOR);
    expect(knownEth(send.crossing(1_000))).toBeUndefined();

    // Past the arrival, where every row an earlier build zero-filled already is: only the address moves.
    const old: Crossing = { ...fresh, ethAddress: UNKNOWN_ETH, state: 'minted-l2', claimTxHash: '0xc' };
    expect(landed(old, dep, 2_000)).toEqual({ ...old, ethAddress: DEPOSITOR });
    // Before it, the heal rides along with the event.
    const early: Crossing = { ...fresh, ethAddress: UNKNOWN_ETH, state: 'proving', inboxIndex: undefined };
    expect(landed(early, dep, 2_000)).toMatchObject({ state: 'deposited', ethAddress: DEPOSITOR });
    // An address the record knows is never replaced, and a row that needs nothing is the same object.
    const mine: Crossing = { ...old, ethAddress: `0x${'11'.repeat(20)}` };
    expect(landed(mine, dep, 2_000)).toBe(mine);
    // Another message under the index is not this row's event.
    const twin: Crossing = { ...old, inboxIndex: '99' };
    expect(landed(twin, dep, 2_000)).toBe(twin);
    // A send is never given a depositor: its address is the recipient its witness is matched on.
    const sent: Crossing = { ...send.crossing(1_000), state: 'minted-l2' };
    expect(landed(sent, send, 2_000)).toBe(sent);
  });
});
