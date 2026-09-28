import { proofsPerMinute } from '@yacana/miner-core/metrics';
import { describe, expect, test } from 'vitest';
import {
  attemptScheduled,
  type Command,
  type EpochInfo,
  type Event,
  initial,
  MINTED_FRESH_MS,
  type MinerState,
  mintedFresh,
  reduce,
  SAMPLE_SPAN_MS,
} from './reducer';

const epoch = (n: bigint, seed = 7n, target = 1n << 122n): EpochInfo => ({
  epoch: n,
  seed,
  target,
  openedAt: 0n,
  claims: 0,
});

const MINTED = {
  txHash: '0xt',
  nullifier: '0xn',
  noteHash: '0xh',
  noteHashes: 1,
  claims: [1, 2] as [number, number],
};

const attempt = (score: number, t = 0, win = false, bar = 64) =>
  ({ type: 'attempt', proveMs: 3000, score, win, bar, at: 1_700_000_000_000 + t, t }) as const;

/** A claim attempt that failed while its ticket may still mint. */
const failure = (
  kind: 'anchor-pruned' | 'lost' | 'expired' | 'other',
  n: number,
  sent = false,
  e: bigint = 3n,
  error: string = kind,
): Event => ({ type: 'failed', error, kind, epoch: e, attempt: n, sent, watching: false });

const open: Event = { type: 'checked', verdict: 'open', watching: false };

/** A miner on epoch `e` whose win line is up and whose claim runs. */
function claimingWin(e = 3n): [MinerState, number | null] {
  let [s] = reduce(initial, { type: 'start', epoch: epoch(e) });
  [s] = reduce(s, attempt(70, 100, true));
  const id = s.ledger[0]?.id ?? null;
  [s] = reduce(s, { type: 'winner', epoch: e, secretId: s.job?.secretId ?? -1 });
  return [s, id];
}

const noteOf = (s: MinerState, id: number | null) => s.ledger.find((l) => l.id === id)?.claim;

describe('miner reducer', () => {
  test('start mines the open epoch with a fresh secret; stop halts', () => {
    const [s1, c1] = reduce(initial, { type: 'start', epoch: epoch(3n), at: 1_700_000_000_000, t: 500 });
    expect(s1.phase).toBe('mining');
    expect(s1).toMatchObject({ since: 1_700_000_000_000, sinceT: 500 });
    expect(c1).toEqual([{ type: 'mine', epoch: 3n, seed: 7n, target: 1n << 122n, secretId: 1 }]);
    const [s2, c2] = reduce(s1, { type: 'stop' });
    expect(s2.phase).toBe('idle');
    expect(s2.since).toBeNull();
    expect(c2).toEqual([{ type: 'halt' }]);
    expect(reduce(s2, { type: 'stop' })[1]).toEqual([]);
  });

  test('an epoch switch mid-proof restarts on the new seed with a rotated secret; tickets and best reset', () => {
    let [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, attempt(3.9));
    [s] = reduce(s, attempt(29.8));
    expect(s).toMatchObject({ tickets: 2, proofs: 2, best: 29.8 });
    // The retarget eases the difficulty from 64 to 16.
    const [s2, cmds] = reduce(s, { type: 'epoch', epoch: epoch(4n, 99n, 1n << 124n), difficultyRatio: 0.25 });
    expect(cmds).toEqual([
      { type: 'halt' },
      { type: 'mine', epoch: 4n, seed: 99n, target: 1n << 124n, secretId: 2 },
    ]);
    expect(s2).toMatchObject({ tickets: 0, best: null, proofs: 2 });
    expect(s2.job?.secretId).toBe(2);
    // A proof scored by the old job can land after the switch: it keeps that job's bar and verdict.
    const [s3] = reduce(s2, attempt(40, 1, false, 64));
    expect(s3.samples.map((x) => [x.bar, x.win])).toEqual([
      [64, false],
      [64, false],
      [64, false],
    ]);
    expect(s2.ledger[0]).toMatchObject({ kind: 'epoch', text: 'epoch 4 opened · difficulty 16.0 (×0.25)' });
    // The same epoch reported again is a no-op.
    expect(reduce(s2, { type: 'epoch', epoch: epoch(4n, 99n) })[1]).toEqual([]);
  });

  test('the ledger records attempts, wins, mints and failures newest first, 200 lines deep', () => {
    let [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, attempt(1.2));
    [s] = reduce(s, attempt(29.8));
    [s] = reduce(s, attempt(3.9));
    expect(s.ledger.map((l) => l.kind)).toEqual(['attempt', 'attempt', 'attempt']);
    expect(s.ledger[1]).toMatchObject({ n: 2, score: 29.8, best: true });
    expect(s.ledger[0]).toMatchObject({ n: 3, score: 3.9, best: false });
    [s] = reduce(s, attempt(51.4, 9000, true));
    expect(s.ledger[0]).toMatchObject({ kind: 'win', n: 4, score: 51.4 });
    expect(s.winAt).toBe(9000);
    [s] = reduce(s, { type: 'winner', epoch: 3n, secretId: 1 });
    [s] = reduce(s, { type: 'claimed', block: 184209, reward: '4 tYACA', ...MINTED });
    expect(s.ledger[0]).toMatchObject({
      kind: 'minted',
      text: '4 tYACA, privately',
      links: { block: 184209, tx: MINTED.txHash },
    });
    expect(s.wins).toBe(1);
    [s] = reduce(s, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, { type: 'failed', error: 'claim reverted' });
    expect(s.ledger[0]).toMatchObject({ kind: 'failed', text: 'claim reverted' });
    for (let i = 0; i < 250; i++) [s] = reduce(s, attempt(1));
    expect(s.ledger).toHaveLength(200);
    expect(new Set(s.ledger.map((l) => l.id)).size).toBe(200);
  });

  test('the samples keep the last three minutes; the rate is over the last 20 proofs', () => {
    expect(SAMPLE_SPAN_MS).toBe(180_000);
    let [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    for (let i = 0; i < 80; i++) [s] = reduce(s, attempt(2, i * 3000));
    expect(s.samples.length).toBe(61); // t ∈ [57 s, 237 s]
    expect(s.samples[0]?.t).toBe(57_000);
    expect(s.recent).toHaveLength(20);
    expect(proofsPerMinute(s.recent)).toBe(20);
  });

  test('a winner for the current job is submitted; one for a stale job or secret is discarded', () => {
    const [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    expect(reduce(s, { type: 'winner', epoch: 3n, secretId: 1 })[1]).toEqual([{ type: 'submit' }]);
    expect(reduce(s, { type: 'winner', epoch: 2n, secretId: 1 })[1]).toEqual([
      { type: 'discard', reason: 'won against a closed epoch' },
    ]);
    expect(reduce(s, { type: 'winner', epoch: 3n, secretId: 0 })[1][0]?.type).toBe('discard');
    const [claiming] = reduce(s, { type: 'winner', epoch: 3n, secretId: 1 });
    expect(claiming.phase).toBe('claiming');
    // While claiming, an epoch switch does not restart mining (the claim decides first).
    expect(reduce(claiming, { type: 'epoch', epoch: epoch(4n) })[1]).toEqual([]);
    expect(reduce(claiming, { type: 'claimed', block: 1, reward: '4', ...MINTED })[0].phase).toBe('idle');
  });

  test('the claim walks proving → sent (with the expiry) → waiting → minted; the mint survives the restart and the next proof, fades after ten seconds, and a new claim replaces it', () => {
    let [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, { type: 'winner', epoch: 3n, secretId: 1, at: 1000 });
    expect(s.claim).toMatchObject({ step: 'proving', wonAt: 1000, since: 1000, done: [] });
    [s] = reduce(s, { type: 'sent', txHash: '0xab', expiresAt: 600, at: 41_000 });
    expect(s.claim).toMatchObject({
      step: 'sent',
      wonAt: 1000,
      since: 41_000,
      done: [40_000],
      txHash: '0xab',
      expiresAt: 600,
    });
    [s] = reduce(s, { type: 'included', block: 9, at: 50_000 });
    expect(s.claim).toMatchObject({ step: 'waiting', done: [40_000, 9000] });
    [s] = reduce(s, { type: 'claimed', block: 9, reward: '4 tYACA', ...MINTED, at: 51_000 });
    expect(s).toMatchObject({ phase: 'idle', claim: null, minted: { ...MINTED, at: 51_000 }, wins: 1 });
    expect(s.ledger[0]).toMatchObject({ kind: 'minted', links: { block: 9, tx: '0xt' } });
    // The controller restarts mining at once and the next proof lands seconds later: neither clears the mint.
    [s] = reduce(s, { type: 'start', epoch: epoch(3n) });
    expect(s.minted).toMatchObject({ ...MINTED, block: 9 });
    [s] = reduce(s, attempt(2));
    expect(s.minted).toMatchObject({ ...MINTED, block: 9 });
    // Freshness is the display's business, from the mint's own clock.
    expect(mintedFresh(s.minted, 51_000 + 5_000)).toBe(true);
    expect(mintedFresh(s.minted, 51_000 + MINTED_FRESH_MS)).toBe(false);
    expect(mintedFresh(null, 0)).toBe(false);
    // A stop keeps the record but the display is stale by then; a new claim replaces it.
    [s] = reduce(s, { type: 'stop' });
    expect(s.minted).toMatchObject({ block: 9 });
    [s] = reduce(s, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, { type: 'winner', epoch: 3n, secretId: s.secretId, at: 70_000 });
    expect(s.phase).toBe('claiming');
    expect(s.minted).toBeNull();
  });

  test('an unrecognised failure is not tried again by itself: checks go on, Retry is one more attempt after a check, only from idle', () => {
    let [s, id] = claimingWin(0n);
    let cmds: Command[];
    [s, cmds] = reduce(s, failure('other', 1, false, 0n, 'Failed to verify the generated proof!'));
    expect(s).toMatchObject({ phase: 'idle', job: null, claim: null, notice: null });
    expect(cmds).toEqual([{ type: 'halt' }, { type: 'retry-in', ms: 5_000 }]);
    expect(noteOf(s, id)).toMatchObject({ outcome: 'other', retry: true });
    expect(attemptScheduled(s)).toBe(false);
    [s, cmds] = reduce(s, { type: 'due', blocked: false });
    expect(cmds).toEqual([{ type: 'check' }]);
    [s, cmds] = reduce(s, open);
    expect(s.phase).toBe('idle');
    expect(cmds).toEqual([{ type: 'retry-in', ms: 15_000 }]);
    expect(noteOf(s, id)).toMatchObject({ outcome: 'other', retry: true });
    [s, cmds] = reduce(s, { type: 'retry' });
    expect([s.phase, cmds]).toEqual(['idle', [{ type: 'check' }]]);
    [s, cmds] = reduce(s, open);
    expect(s).toMatchObject({ phase: 'claiming', notice: null });
    expect(cmds).toEqual([{ type: 'submit' }]);
    expect(noteOf(s, id)).toEqual({ step: 'proving', recover: 'reprove', attempt: 2 });
    // Not while claiming, and not while mining: a retry is only for a win that waits.
    expect(reduce(s, { type: 'retry' })).toEqual([s, []]);
    let m = initial;
    [m] = reduce(m, { type: 'start', epoch: epoch(0n) });
    expect(reduce(m, { type: 'retry' })).toEqual([m, []]);
  });

  test('the schedule: 5 s before the second attempt, 30 s before the third, then the three-tries line; checks slow after five; a pause or a switch defers them', () => {
    let [s, id] = claimingWin(57n);
    let cmds: Command[];
    [s, cmds] = reduce(s, failure('anchor-pruned', 1, false, 57n));
    expect(cmds).toEqual([{ type: 'halt' }, { type: 'retry-in', ms: 5_000 }]);
    expect(noteOf(s, id)).toEqual({ recover: 'anchor-pruned', attempt: 2 });
    expect(attemptScheduled(s)).toBe(true);
    // A pause or a switch holds the check; its end runs it.
    expect(reduce(s, { type: 'due', blocked: true })[1]).toEqual([]);
    expect(reduce(s, { type: 'unblocked' })[1]).toEqual([{ type: 'check' }]);
    expect(reduce(initial, { type: 'unblocked' })[1]).toEqual([]);
    [s, cmds] = reduce(s, open);
    expect(cmds).toEqual([{ type: 'submit' }]);
    expect(s.recovery.fore?.attempts).toBe(2);
    [s, cmds] = reduce(s, failure('anchor-pruned', 2, false, 57n));
    expect(cmds).toEqual([{ type: 'halt' }, { type: 'retry-in', ms: 30_000 }]);
    [s] = reduce(s, open);
    [s, cmds] = reduce(s, failure('anchor-pruned', 3, false, 57n));
    expect(cmds).toEqual([{ type: 'halt' }, { type: 'retry-in', ms: 15_000 }]);
    expect(noteOf(s, id)).toEqual({ recover: 'spent', until: 57n, retry: true });
    expect(attemptScheduled(s)).toBe(false);
    // No fourth attempt by itself: the checks go on, five 15 s apart, then a minute apart.
    const waits: Command[] = [];
    for (let i = 0; i < 6; i++) {
      [s, cmds] = reduce(s, open);
      waits.push(...cmds);
    }
    expect(waits.map((c) => (c.type === 'retry-in' ? c.ms : c.type))).toEqual([
      15_000, 15_000, 15_000, 15_000, 60_000, 60_000,
    ]);
    expect(s.phase).toBe('idle');
    // Retry: one more attempt past the three.
    [s] = reduce(s, { type: 'retry' });
    [s, cmds] = reduce(s, open);
    expect(cmds).toEqual([{ type: 'submit' }]);
    expect(noteOf(s, id)).toEqual({ step: 'proving', recover: 'anchor-pruned', attempt: 4 });
  });

  test('Stop while an attempt is scheduled: none comes, nothing resumes, Retry stays; Start is a check, then one more attempt', () => {
    let [s, id] = claimingWin();
    let cmds: Command[];
    [s] = reduce(s, failure('lost', 1, true));
    expect(attemptScheduled(s)).toBe(true);
    [s, cmds] = reduce(s, { type: 'stop' });
    expect(cmds).toEqual([]);
    expect(attemptScheduled(s)).toBe(false);
    expect(noteOf(s, id)).toEqual({ recover: 'stopped', until: 3n, retry: true });
    // The checks go on: an open ticket is not attempted, a closed one resumes nothing.
    [s, cmds] = reduce(s, open);
    expect([s.phase, cmds]).toEqual(['idle', [{ type: 'retry-in', ms: 15_000 }]]);
    const [closed, after] = reduce(s, { type: 'checked', verdict: 'closed', watching: true });
    expect(after).toEqual([{ type: 'retry-in', ms: 15_000 }]);
    expect(closed.recovery).toMatchObject({ fore: null, watching: true });
    // The page's own restart leaves a waiting win alone; the user's Start checks, then attempts.
    expect(reduce(s, { type: 'start', epoch: epoch(3n) })).toEqual([s, []]);
    [s, cmds] = reduce(s, { type: 'start', epoch: epoch(3n), user: true });
    expect([s.phase, cmds]).toEqual(['idle', [{ type: 'check' }]]);
    [s, cmds] = reduce(s, open);
    expect(cmds).toEqual([{ type: 'submit' }]);
    expect(noteOf(s, id)).toEqual({ step: 'proving', recover: 'resend', attempt: 2 });
  });

  test('a win that can no longer mint lets mining go on: its sends stay watched; not minted once the checkpointed tip agrees', () => {
    let [s, id] = claimingWin();
    [s] = reduce(s, { type: 'sent', txHash: '0x1', expiresAt: 600 });
    [s] = reduce(s, failure('expired', 1, true));
    expect(s).toMatchObject({ phase: 'idle', job: null, claim: null, notice: null });
    expect(noteOf(s, id)).toEqual({ recover: 'checking' });
    const waiting = s;
    const [closed, c1] = reduce(s, { type: 'checked', verdict: 'closed', watching: true });
    expect(c1).toEqual([{ type: 'resume' }, { type: 'retry-in', ms: 15_000 }]);
    expect(noteOf(closed, id)).toEqual({ recover: 'checking' });
    const [told, cmds] = reduce(closed, { type: 'not-minted', lineId: id, sent: true, watching: false });
    expect(cmds).toEqual([]);
    expect(noteOf(told, id)).toEqual({ outcome: 'discarded', sent: true });
    const [gone, c2] = reduce(waiting, { type: 'checked', verdict: 'not-minted', watching: false });
    expect(c2).toEqual([{ type: 'resume' }]);
    expect(noteOf(gone, id)).toEqual({ outcome: 'discarded', sent: true });
    // The resume mines the epoch open now, under a fresh secret.
    const [mining, c3] = reduce(gone, { type: 'start', epoch: epoch(4n, 9n) });
    expect(mining).toMatchObject({ phase: 'mining', secretId: 2 });
    expect(c3).toEqual([{ type: 'mine', epoch: 4n, seed: 9n, target: 1n << 122n, secretId: 2 }]);
  });

  test("adopted beside a newer claim: the old line ✓ and one count, the claim in hand's phase, job and claim untouched; found again, ignored", () => {
    let [s, old] = claimingWin();
    [s] = reduce(s, failure('lost', 1, true));
    [s] = reduce(s, { type: 'checked', verdict: 'closed', watching: true });
    [s] = reduce(s, { type: 'start', epoch: epoch(4n) });
    [s] = reduce(s, attempt(80, 200, true));
    [s] = reduce(s, { type: 'winner', epoch: 4n, secretId: s.job?.secretId ?? -1 });
    [s] = reduce(s, { type: 'sent', txHash: '0xnew', expiresAt: 900 });
    const before = s;
    const found: Event = {
      type: 'adopted',
      lineId: old,
      fore: false,
      watching: false,
      reward: '4 tYACA',
      block: 7,
      ...MINTED,
    };
    const [adoptedBeside, cmds] = reduce(s, found);
    expect(cmds).toEqual([]);
    expect(adoptedBeside.phase).toBe('claiming');
    expect(adoptedBeside.job).toBe(before.job);
    expect(adoptedBeside.claim).toBe(before.claim);
    expect(adoptedBeside.minted).toBeNull();
    expect(adoptedBeside.wins).toBe(before.wins + 1);
    expect(noteOf(adoptedBeside, old)).toEqual({ outcome: 'minted' });
    expect(adoptedBeside.ledger[0]).toMatchObject({ kind: 'minted', links: { block: 7, tx: MINTED.txHash } });
    expect(reduce(adoptedBeside, found)).toEqual([adoptedBeside, []]);
    // The win mining waited on resumes it once settled, unless a Stop came since.
    let [w, id] = claimingWin();
    [w] = reduce(w, failure('lost', 1, true));
    const settled = reduce(w, { ...found, lineId: id, fore: true });
    expect(settled[1]).toEqual([{ type: 'resume' }]);
    expect(settled[0]).toMatchObject({ phase: 'idle', wins: 1, recovery: { fore: null } });
    expect(settled[0].minted).toMatchObject({ block: 7 });
    [w] = reduce(w, { type: 'stop' });
    expect(reduce(w, { ...found, lineId: id, fore: true })[1]).toEqual([]);
  });

  test("a watched win's revert: its own line says so, the rebuild runs, and a running miner halts for it", () => {
    let [s, old] = claimingWin();
    [s] = reduce(s, failure('lost', 1, true));
    [s] = reduce(s, { type: 'checked', verdict: 'closed', watching: true });
    [s] = reduce(s, { type: 'start', epoch: epoch(4n) });
    const [r, cmds] = reduce(s, {
      type: 'failed',
      error: 'claim 0x1…0001 reverted in a block',
      kind: 'reverted',
      stale: true,
      watching: false,
      lineId: old,
    });
    expect(cmds).toEqual([{ type: 'halt' }]);
    expect(r).toMatchObject({ phase: 'recovering', job: null, notice: { kind: 'reverted' } });
    expect(noteOf(r, old)).toEqual({ outcome: 'reverted', stale: true });
    expect(reduce(r, { type: 'recovered' })[1]).toEqual([]);
  });

  test('a reverted or blocked claim enters recovering; recovered returns to idle, paused waits', () => {
    let [s] = reduce(initial, { type: 'start', epoch: epoch(3n) });
    [s] = reduce(s, { type: 'winner', epoch: 3n, secretId: 1 });
    for (const kind of ['reverted', 'delivery-blocked'] as const) {
      const [r, cmds] = reduce(s, { type: 'failed', error: 'reverted', kind });
      expect(r).toMatchObject({ phase: 'recovering', job: null, notice: { kind: 'reverted' } });
      expect(cmds).toEqual([]);
      expect(reduce(r, { type: 'start', epoch: epoch(3n) })[1]).toEqual([]);
    }
    const [r] = reduce(s, { type: 'failed', error: 'reverted', kind: 'reverted' });
    const [ok] = reduce(r, { type: 'recovered' });
    expect(ok).toMatchObject({ phase: 'idle', notice: null });
    expect(ok.ledger[0]).toMatchObject({ kind: 'epoch', text: 'chain view rebuilt · notes recovered' });
    const [paused] = reduce(r, { type: 'paused', until: 100 + 25 * 60_000, at: 100 });
    expect(paused.phase).toBe('idle');
    expect(paused.notice).toMatchObject({ kind: 'paused', until: 100 + 25 * 60_000 });
    expect(paused.notice?.body).toMatch(/Mining resumes about \d\d:\d\d\./);
  });

  test('offline shows a card that online clears, without touching any other notice', () => {
    const [off] = reduce(initial, { type: 'offline', since: 0 });
    expect(off.notice?.kind).toBe('offline');
    expect(reduce(off, { type: 'online' })[0].notice).toBeNull();
    const [dead] = reduce(initial, { type: 'prover-dead', error: 'gone' });
    expect(reduce(dead, { type: 'online' })[0].notice?.kind).toBe('prover-dead');
  });

  test('overlapping node pauses: the one still standing shows when the other clears', () => {
    let s = initial;
    [s] = reduce(s, { type: 'behind', ageS: 240 });
    [s] = reduce(s, { type: 'offline', since: 0 });
    expect(s.notice?.kind).toBe('offline');
    [s] = reduce(s, { type: 'online' });
    expect(s.notice?.kind).toBe('behind');
    [s] = reduce(s, { type: 'offline', since: 0 });
    [s] = reduce(s, { type: 'caught-up' });
    expect(s.notice?.kind).toBe('offline');
    [s] = reduce(s, { type: 'online' });
    expect(s.notice).toBeNull();
    // A recovery ends its own card; a pause still in force keeps its explanation.
    [s] = reduce(s, { type: 'behind', ageS: 240 });
    [s] = reduce(s, { type: 'failed', error: 'reverted', kind: 'reverted' });
    expect(s.notice?.kind).toBe('reverted');
    [s] = reduce(s, { type: 'recovered' });
    expect(s.notice?.kind).toBe('behind');
  });

  test('other failures halt and keep the message', () => {
    const [s] = reduce(initial, { type: 'start', epoch: epoch(1n) });
    const [failed, cmds] = reduce(s, { type: 'failed', error: 'worker crashed' });
    expect(failed).toMatchObject({ phase: 'idle', notice: { kind: 'failed', body: 'worker crashed' } });
    expect(cmds).toEqual([{ type: 'halt' }]);
    expect(reduce(failed, { type: 'start', epoch: epoch(1n) })[0].notice).toBeNull();
  });

  test('a proof keeps what a hover says of it: its number in the epoch, its proving time, its wall clock', () => {
    let [s] = reduce(initial, { type: 'start', epoch: epoch(0n) });
    [s] = reduce(s, attempt(3, 100));
    [s] = reduce(s, attempt(5, 200));
    expect(s.samples[1]).toMatchObject({ t: 200, score: 5, n: 2, proveMs: 3000, at: 1_700_000_000_200 });
  });

  test("a claim's span opens at the win and closes however the claim ends; retry, adoption, a dead prover and the window's trim", () => {
    const win = (s0: typeof initial, t: number) => {
      let [s] = reduce(s0, attempt(70, t, true));
      [s] = reduce(s, { type: 'winner', epoch: 0n, secretId: s.job?.secretId ?? -1, t: t + 40 });
      return s;
    };
    let [s] = reduce(initial, { type: 'start', epoch: epoch(0n) });
    s = win(s, 1_000);
    const id = s.ledger[0]?.id ?? null;
    // From the win, not from the message that reported it 40 ms later.
    expect(s.claimSpans).toEqual([{ id, t0: 1_000, t1: null }]);
    [s] = reduce(s, { type: 'stop', t: 2_000 });
    expect(s.claimSpans[0]?.t1).toBeNull();
    [s] = reduce(s, { type: 'claimed', reward: '4', block: 9, ...MINTED, t: 31_000 });
    expect(s.claimSpans).toEqual([{ id, t0: 1_000, t1: 31_000, outcome: 'minted' }]);

    // A failure closes it failed; the retry is a second span from the retry, not from the old win.
    [s] = reduce(s, { type: 'start', epoch: epoch(0n) });
    s = win(s, 40_000);
    const second = s.ledger[0]?.id ?? null;
    [s] = reduce(s, { type: 'failed', error: 'the node went away', kind: 'other', t: 45_000 });
    [s] = reduce(s, { type: 'retry', t: 48_000 });
    [s] = reduce(s, { ...open, t: 50_000 });
    expect(s.claimSpans.slice(1)).toEqual([
      { id: second, t0: 40_000, t1: 45_000, outcome: 'failed' },
      { id: second, t0: 50_000, t1: null },
    ]);
    // Any path that drops the claim closes the span: here the prover dying under it.
    [s] = reduce(s, { type: 'prover-dead', error: 'gone', t: 55_000 });
    expect(s.claimSpans[2]).toEqual({ id: second, t0: 50_000, t1: 55_000, outcome: 'failed' });

    // Found in a block after all: the transaction of the earlier span did land.
    let [r] = reduce(initial, { type: 'start', epoch: epoch(0n) });
    r = win(r, 1_000);
    const rid = r.ledger[0]?.id ?? null;
    [r] = reduce(r, { ...failure('lost', 1, true, 0n), t: 9_000 });
    [r] = reduce(r, {
      type: 'adopted',
      lineId: rid,
      fore: true,
      watching: false,
      reward: '4',
      block: 9,
      ...MINTED,
      t: 12_000,
    });
    expect(r.claimSpans.map((c) => [c.t0, c.t1, c.outcome])).toEqual([[1_000, 9_000, 'minted']]);

    // Spans leave with the window: three minutes after one ended, the next event drops it.
    [s] = reduce(s, { type: 'online', t: 31_000 + SAMPLE_SPAN_MS + 1 });
    expect(s.claimSpans.map((c) => c.t0)).toEqual([40_000, 50_000]);
    // An event that changes nothing returns the state it was given.
    expect(reduce(s, { type: 'included', block: 1, t: 60_000 })[0]).toBe(s);
  });

  test('an abandoned prover is terminal: start is refused until the page reloads', () => {
    const [s] = reduce(initial, { type: 'start', epoch: epoch(1n) });
    const [dead, cmds] = reduce(s, { type: 'prover-dead', error: 'prover keeps crashing; reload the page' });
    expect(cmds).toEqual([]);
    expect(dead).toMatchObject({ phase: 'idle', job: null, proverDead: true });
    expect(reduce(dead, { type: 'start', epoch: epoch(1n) })).toEqual([dead, []]);
  });
});
