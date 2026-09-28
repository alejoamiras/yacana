// The claim on its win line: the step while it runs, the outcome after, one clock from the win,
// Stop's mark; and the sentences the ledger draws from them.
import { describe, expect, test } from 'bun:test';
import { settlementSuffix, settlementTitle, winNote } from '../src/lib/claim-copy.ts';
import { type Event, initial, type MinerState, reduce } from '../src/lib/reducer.ts';

const epoch = { epoch: 3n, seed: 7n, target: 1n << 122n, openedAt: 0n, claims: 1 };

/** The state after `events`, from a started miner. */
const play = (events: Event[], from: MinerState = initial): MinerState =>
  events.reduce((s, e) => reduce(s, e)[0], reduce(from, { type: 'start', epoch })[0]);

const won: Event[] = [
  { type: 'attempt', proveMs: 3610, score: 2.8, win: true, bar: 1, at: 1_000, t: 1 },
  { type: 'winner', epoch: 3n, secretId: 1, at: 1_000 },
];

const winLine = (s: MinerState) => s.ledger.find((l) => l.kind === 'win');

describe('the claim on its win line', () => {
  test('the win line carries the step, the clock counts from the win, Stop marks the claim', () => {
    let s = play(won);
    expect(s.claim).toMatchObject({ step: 'proving', wonAt: 1_000, lineId: winLine(s)?.id });
    expect(winNote(winLine(s)?.claim, 5_000)?.text).toBe('claiming: proving in your browser, about 20 s');
    s = play([{ type: 'sent', txHash: '0xab', expiresAt: 600, at: 21_000 }], s);
    expect(winLine(s)?.claim).toMatchObject({ step: 'sent', expiresAt: 600 });
    expect(winNote(winLine(s)?.claim, 21_000)?.text).toBe(
      'claiming: sent to the node · drops in 9:39 if no block takes it',
    );
    // Stop during the claim: the phase stays, the mark is on the state, no halt goes to the worker.
    const [stopped, commands] = reduce(s, { type: 'stop' });
    expect(stopped).toMatchObject({ phase: 'claiming', stopping: true });
    expect(commands).toEqual([]);
    s = play([{ type: 'included', block: 83_164, at: 40_000 }], stopped);
    expect(winNote(winLine(s)?.claim, 40_000)?.text).toBe('claiming: in a block · syncing the note');
    expect(s.claim?.wonAt).toBe(1_000);
    s = play(
      [
        {
          type: 'claimed',
          reward: '4 tYACA',
          block: 83_164,
          txHash: '0xab',
          nullifier: '0xn',
          noteHash: '0xh',
          noteHashes: 1,
          claims: [1, 2],
          at: 41_000,
        },
      ],
      s,
    );
    expect(s).toMatchObject({ phase: 'idle', claim: null, stopping: false, wins: 1 });
    expect(winNote(winLine(s)?.claim, 41_000)).toBeUndefined();
    expect(s.ledger[0]).toMatchObject({
      kind: 'minted',
      text: '4 tYACA, privately',
      links: { block: 83_164 },
    });
  });

  test.each([
    [
      'Transaction 0x1 reverted: app_logic_reverted. Reason: Assertion failed: stale claim',
      'reverted',
      'recovering',
      "didn't land: the epoch closed first · the sponsor paid, your proof is unspent · re-syncing, about a minute",
    ],
    [
      'Transaction 0x1 reverted: app_logic_reverted. Reason: Assertion failed: retired',
      'reverted',
      'recovering',
      "didn't land: it reverted (Assertion failed: retired) · the sponsor paid, your proof is unspent · re-syncing, about a minute",
    ],
    [
      'Transaction 0x1 reverted: app_logic_reverted. Reason: unknown',
      'reverted',
      'recovering',
      "didn't land: it reverted · the sponsor paid, your proof is unspent · re-syncing, about a minute",
    ],
    [
      'unknown nullifier 0x12',
      'delivery-blocked',
      'recovering',
      "didn't land: an earlier reverted claim blocks this account · re-syncing, about a minute",
    ],
    [
      'Block hash 0x1 not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred.',
      'anchor-pruned',
      'idle',
      'the node dropped the block it was reading · proving again, try 2 of 3',
    ],
    ['no effects for 0x1', 'lost', 'idle', 'the node lost sight of it · checking the chain for your claim'],
    ['Invalid tx: Existing nullifier', 'landed-elsewhere', 'idle', 'checking the chain for your claim'],
    [
      'Simulation error: Assertion failed: epoch is not open',
      'refused',
      'idle',
      'checking the chain for your claim',
    ],
    [
      'Transaction 0x1 was dropped. Reason: Invalid expiration timestamp',
      'expired',
      'idle',
      'checking the chain for your claim',
    ],
    [
      'Circuit execution failed: verify',
      'other',
      'idle',
      'claim failed: Circuit execution failed: verify · mining paused',
    ],
  ] as const)('%s → %s', (error, kind, phase, text) => {
    const sent = play([{ type: 'sent', txHash: '0xab', expiresAt: 600, at: 1_000 }], play(won));
    const [s, commands] = reduce(sent, {
      type: 'failed',
      error,
      kind,
      epoch: 3n,
      attempt: 1,
      sent: true,
      watching: false,
      at: 2_000,
    });
    expect(s).toMatchObject({ phase, claim: null, stopping: false });
    const note = winNote(winLine(s)?.claim, 2_000);
    expect(note?.text).toBe(text);
    expect(note?.action).toBe(kind === 'other' ? 'Retry' : undefined);
    // No ✗ line doubles the outcome; a win that may still mint halts the worker and waits for its check.
    expect(s.ledger.filter((l) => l.kind === 'failed')).toHaveLength(0);
    expect(commands).toEqual(phase === 'idle' ? [{ type: 'halt' }, { type: 'retry-in', ms: 5_000 }] : []);
  });

  test('a waiting win says what comes next: sent again or proved again by try, three tries, Stop, not claimed', () => {
    const fail = (kind: 'lost' | 'refused' | 'anchor-pruned', attempt: number, sent: boolean): Event => ({
      type: 'failed',
      error: kind,
      kind,
      epoch: 3n,
      attempt,
      sent,
      watching: false,
      at: 2_000,
    });
    const open: Event = { type: 'checked', verdict: 'open', watching: false, at: 3_000 };
    const text = (s: MinerState) => winNote(winLine(s)?.claim, 3_000)?.text;
    const action = (s: MinerState) => winNote(winLine(s)?.claim, 3_000)?.action;

    const resent = play([fail('lost', 1, true), open], play(won));
    expect(text(resent)).toBe('it didn’t land · sending again, try 2 of 3');
    // Once the attempt is sent, its steps speak for it.
    expect(text(play([{ type: 'sent', txHash: '0xcd', expiresAt: 600, at: 3_000 }], resent))).toMatch(
      /^claiming: sent to the node/,
    );
    expect(text(play([fail('refused', 1, false), open], play(won)))).toBe(
      'the claim failed · proving again, try 2 of 3',
    );
    expect(text(play([fail('anchor-pruned', 2, false)], play(won)))).toBe(
      'the node dropped the block it was reading · proving again, try 3 of 3',
    );
    const spent = play([fail('anchor-pruned', 3, false)], play(won));
    expect([text(spent), action(spent)]).toEqual([
      'couldn’t claim after 3 tries: the node keeps dropping blocks · the win stays claimable until epoch 3 closes',
      'Retry',
    ]);
    expect(text(play([{ type: 'retry', at: 3_000 }, open], spent))).toBe(
      'the node dropped the block it was reading · proving again, one more try',
    );
    const stopped = play([fail('lost', 1, true), { type: 'stop' }], play(won));
    expect([text(stopped), action(stopped)]).toEqual([
      'stopped · the win stays claimable until epoch 3 closes',
      'Retry',
    ]);
    const closed: Event = { type: 'checked', verdict: 'closed', watching: true, at: 3_000 };
    expect(text(play([fail('lost', 1, true), closed], play(won)))).toBe('checking the chain for your claim');
    const notMinted: Event = { type: 'checked', verdict: 'not-minted', watching: false, at: 3_000 };
    expect(text(play([fail('lost', 1, true), notMinted], play(won)))).toBe(
      'not claimed: the epoch closed before the claim landed',
    );
    expect(text(play([fail('refused', 1, false), notMinted], play(won)))).toBe(
      'not claimed: the epoch closed before the claim went out',
    );
  });

  test('the banners: a stale claim names the race, another revert does not; the pause names the clock and the line learns the wait', () => {
    const stale = play(
      [{ type: 'failed', error: 'reverted: Reason: stale claim', kind: 'reverted', at: 2_000 }],
      play(won),
    );
    expect(stale.notice?.body).toBe(
      'A claim reverted: someone closed the epoch first. Re-syncing this account from the chain; mining resumes in about a minute.',
    );
    // The controller's verdict from the chain outranks a message that names nothing.
    const verdict = play(
      [{ type: 'failed', error: 'reverted: Reason: unknown', kind: 'reverted', stale: true, at: 2_000 }],
      play(won),
    );
    expect(verdict.notice?.body).toBe(stale.notice?.body);
    expect(winNote(winLine(verdict)?.claim, 2_000)?.text).toBe(
      "didn't land: the epoch closed first · the sponsor paid, your proof is unspent · re-syncing, about a minute",
    );
    const other = play(
      [{ type: 'failed', error: 'reverted: Reason: x', kind: 'reverted', at: 2_000 }],
      play(won),
    );
    expect(other.notice?.body).toBe(
      'Re-syncing this account from the chain; mining resumes in about a minute.',
    );
    const blocked = play(
      [
        { type: 'failed', error: 'unknown nullifier', kind: 'delivery-blocked', at: 2_000 },
        { type: 'recovered', at: 3_000 },
        { type: 'paused', until: 3_000 + 38 * 60_000, at: 3_000 },
      ],
      play(won),
    );
    expect(blocked.notice?.body).toMatch(
      /^Claims from this account wait until the reverted one is final on Ethereum\. Mining resumes about \d\d:\d\d\.$/,
    );
    expect(winNote(winLine(blocked)?.claim, 3_000)?.text).toBe(
      "didn't land: an earlier reverted claim blocks this account · claims wait for Ethereum's finality, about 38 min",
    );
  });

  test('a win against a closed epoch is discarded on its line; a retry re-annotates the same line; a win without its line gets a ✗ when it ends', () => {
    const switched = play(
      [{ type: 'epoch', epoch: { ...epoch, epoch: 4n }, at: 1_500 }],
      play([won[0] as Event]),
    );
    const [s, commands] = reduce(switched, { type: 'winner', epoch: 3n, secretId: 1, at: 2_000 });
    expect(commands).toEqual([{ type: 'discard', reason: 'won against a closed epoch' }]);
    expect(winNote(winLine(s)?.claim, 2_000)).toEqual({
      text: 'not claimed: the epoch closed before the claim went out',
      tone: 'dim',
    });
    const failed = play([{ type: 'failed', error: 'boom', kind: 'other', at: 2_000 }], play(won));
    const retried = play(
      [
        { type: 'retry', at: 3_000 },
        { type: 'checked', verdict: 'open', watching: false, at: 3_000 },
      ],
      failed,
    );
    expect(retried.claim).toMatchObject({ step: 'proving', wonAt: 3_000, lineId: winLine(failed)?.id });
    expect(winNote(winLine(retried)?.claim, 3_000)?.text).toBe(
      'the claim failed · proving again, try 2 of 3',
    );
    const bare = play([{ type: 'winner', epoch: 3n, secretId: 1, at: 1_000 }]);
    const [lineless] = reduce(bare, { type: 'failed', error: 'x', kind: 'reverted', at: 2_000 });
    expect(lineless.ledger[0]).toMatchObject({ kind: 'failed', text: 'claim reverted' });
  });

  test('a minted line says settling until its epoch is proven, and only that word explains itself', () => {
    expect([settlementSuffix('pending'), settlementTitle('pending')]).toEqual([
      'settling',
      'Final once its epoch is proven.',
    ]);
    expect([settlementSuffix('settled'), settlementTitle('settled')]).toEqual(['final', undefined]);
    expect(settlementSuffix(undefined)).toBeUndefined();
  });
});
