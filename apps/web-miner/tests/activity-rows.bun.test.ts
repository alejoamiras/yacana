// The Wallet's one reading of the journal, pure: every crossing appears once whichever way it goes,
// the count of rows waiting for the user is the count of rows offering a tap, a finished row folds
// rather than vanishing, and a money button that is off says why. `VITE_ROLLUP_VERSION` is set
// before the modules load: under bun `import.meta.env` is `process.env`.
process.env.VITE_ROLLUP_VERSION = '5';
process.env.VITE_VERSION_INDEX = '0';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Crossing, FADE_AFTER_MS, UNKNOWN_ETH } from '@yacana/bridge/journal';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { TAKING_LONG_AFTER_MS } from '../src/bridge/copy.ts';
import { activity, moneyStanding } from '../src/bridge/rows.ts';
import type { BridgeView } from '../src/state.ts';

// web-kit's fetch guard, held for this suite alone: later suites in the run get the realm's fetch back.
beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const ONE = 10n ** BigInt(PARAMS.DECIMALS);
const PORTAL = `0x${'ab'.repeat(20)}` as const;
const NOW = 1_800_000_000_000;

const crossing = (id: string, patch: Partial<Crossing>): Crossing => ({
  id,
  kind: 1,
  chainId: '11155111',
  portal: PORTAL,
  version: '5',
  index: 0,
  amount: (2n * ONE).toString(),
  state: 'proving',
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  ethAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  ...patch,
});

const standing = {
  registered: true,
  miner: `0x${'0a'.repeat(20)}` as const,
  registryIndex: 0n,
  paused: false,
  pausedUntil: 0n,
  headroom: 500n * ONE,
  deadline: (1n << 256n) - 1n,
  flipAt: 0n,
  afterNextAt: 0n,
  pausedSeconds: 0n,
  retireSent: false,
  depositsClosed: false,
};
const view: BridgeView = { verdict: { kind: 'before' }, standing, readAt: NOW, rpcFailing: false };
const env = { ownVersion: '5', chainId: '11155111' };

describe('the activity reading', () => {
  test('one row per crossing, newest first, whichever way it goes; the count is the rows with a tap', () => {
    const journal = [
      crossing('exit', { state: 'ready', createdAt: NOW - 3_000 }),
      crossing('ahead', { kind: 2, state: 'held', createdAt: NOW - 1_000 }),
      crossing('deposit', { kind: 3, state: 'claimable', inboxIndex: '3', createdAt: NOW - 2_000 }),
      crossing('sent', { state: 'sent', txHash: `0x${'11'.repeat(32)}`, createdAt: NOW - 4_000 }),
    ];
    const a = activity(journal, view, NOW, {}, env);
    expect(a.rows.map((r) => r.c.id)).toEqual(['ahead', 'deposit', 'exit', 'sent']);
    expect(a.rows.map((r) => r.line.chip.word)).toEqual([
      'held for the next version',
      'ready to claim',
      'ready to claim',
      'sent',
    ]);
    // The badge counts the deposit's Claim and the exit's Claim on Ethereum; the held send-ahead
    // offers its redeem as a quiet link beside Yacana's own forward, not as a need.
    expect(a.rows.map((r) => r.line.action?.kind)).toEqual([undefined, 'claim', 'claim-l1', undefined]);
    expect(a.rows[0]?.line.also?.kind).toBe('redeem');
    expect(a.needsUser).toBe(2);
    // The kind leads, and the amount is a signed figure in this balance's unit whichever side it started on.
    const sym = PARAMS.TOKEN_SYMBOL;
    expect(a.rows.map((r) => [r.kind, r.title, r.signed])).toEqual([
      ['ahead', 'Sent ahead to the next version', `−2 ${sym}`],
      ['in', 'From Ethereum', `+2 ${sym}`],
      ['out', 'To Ethereum', `−2 ${sym}`],
      ['out', 'To Ethereum', `−2 ${sym}`],
    ]);
    // An exit names its recipient and a deposit its sender; a send-ahead names nobody.
    expect(a.rows[1]?.meta).toMatch(/^0x709979…79C8 · \d\d:\d\d · /);
    expect(a.rows[0]?.meta).toMatch(/^\d\d:\d\d · /);
    // A send-ahead is money out where it was sent and money in where it lands: the same record, read from here.
    const landing = crossing('l', {
      kind: 2,
      version: '4',
      target: '5',
      state: 'claimable',
      inboxIndex: '7',
    });
    const here = activity([landing], view, NOW, {}, env).rows[0];
    expect([here?.kind, here?.title, here?.signed]).toEqual(['in', 'From another version', `+2 ${sym}`]);
    // A deposit's trail says what happened, never whose wallet it was: one found from another device was not "yours".
    const trails = ['deposited', 'claimable'].map((state) => {
      const d = crossing(state, { kind: 3, state: state as Crossing['state'], inboxIndex: '3' });
      return activity([d], view, NOW, {}, env).rows[0]?.line.trail[0]?.label;
    });
    expect(trails).toEqual(['deposit sent', 'deposit sent']);
    // A deposit found on-chain before its event was read has no sender on record, and says so.
    const found = activity(
      [crossing('d', { kind: 3, state: 'claimable', ethAddress: UNKNOWN_ETH })],
      view,
      NOW,
      {},
      env,
    );
    expect(found.rows[0]?.meta).toMatch(/^found on Ethereum · /);
    expect(JSON.stringify(found.rows[0])).not.toContain('0x000000…');
  });

  test("a hashless send reads as the refresh says, not as the record does; a K2 that needs the upgrade read says it can't", () => {
    const hashless = crossing('h', { state: 'proving' });
    const held = crossing('k', { kind: 2, state: 'held' });
    const a = activity(
      [hashless, held],
      { ...view, verdict: { kind: 'unknown' } },
      NOW,
      { h: 'unfinished' },
      env,
    );
    expect(a.rows.map((r) => r.line.chip.word)).toEqual(["didn't finish", "can't read the upgrade"]);
    expect(a.rows[0]?.line.action?.label).toBe('Bridge again');
    expect(a.rows[1]?.line.action?.kind).toBe('settings');
    // Bridge again is the user's call; Settings is not the row's need.
    expect(a.needsUser).toBe(1);
    // An RPC gone silent after a good read keeps the last verdict on the view, but the rows that
    // turn on it say they cannot read it.
    const silent = activity([held], { ...view, rpcFailing: true }, NOW, {}, env);
    expect(silent.rows[0]?.line.chip.word).toBe("can't read the upgrade");
  });

  test('an urgent claim counts however red its chip; an arrival on another version is claimed there, not here', () => {
    const urgent = crossing('u', { state: 'ready', witness: undefined });
    const a = activity([urgent], { ...view, deadline: { kind: 'any-day' } }, NOW, {}, env);
    expect(a.rows[0]?.line.chip.word).toBe('could close any day');
    expect(a.rows[0]?.line.action?.kind).toBe('claim-l1');
    expect(a.needsUser).toBe(1);
    // A deposit into the version before: the page names only this build and the canonical.
    const old = crossing('d', { kind: 3, version: '4', state: 'claimable', inboxIndex: '1' });
    const b = activity([old], { ...view, canonical: { version: 5n, index: 5n } }, NOW, {}, env);
    expect(b.rows[0]?.line.chip.word).toBe('claim on another version');
    expect(b.rows[0]?.line.action).toBeUndefined();
    expect(b.needsUser).toBe(0);
  });

  test("a crossing from another version is read under that version's deadline and pause, not this build's", () => {
    const heldOnV6 = crossing('k', { kind: 2, state: 'held', version: '5', witness: undefined });
    const v6 = { ...view, canonical: { version: 6n, index: 6n }, deadline: { kind: 'no-flip' as const } };
    const withV5 = {
      ...v6,
      versions: {
        '5': {
          standing: { ...standing, paused: true, pausedUntil: 1_800_100_000n },
          deadline: { kind: 'any-day' as const },
        },
      },
    };
    const a = activity([heldOnV6], withV5, NOW, {}, { ...env, ownVersion: '6' });
    expect(a.rows[0]?.line.chip.word).toBe('could close any day');
    expect(a.rows[0]?.deadline).toBe('until the next Aztec upgrade, which could land any day');
    // Without V5's own reading nothing is assumed: the row falls back to the open-ended phrase.
    const b = activity([heldOnV6], v6, NOW, {}, { ...env, ownVersion: '6' });
    expect(b.rows[0]?.line.chip.word).toBe('held for V6');
    expect(b.rows[0]?.deadline).toBe('while the bridge is open');
  });

  test('a send-ahead from the last version is held for the canonical, by name, before it is forwarded', () => {
    const held = crossing('k', { kind: 2, state: 'held' });
    const a = activity([held], { ...view, canonical: { version: 6n, index: 6n } }, NOW, {}, env);
    expect(a.rows[0]?.line.chip.word).toBe('held for V6');
    expect(a.rows[0]?.title).toBe('Sent ahead to V6');
  });

  test('a held send-ahead is longer than usual only once its destination exists: never before the flip', () => {
    const old = crossing('k', { kind: 2, state: 'held', updatedAt: NOW - TAKING_LONG_AFTER_MS - 1 });
    const registered = { ...view, targetRegisteredAt: BigInt(Math.floor(NOW / 1000)) - 7n * 3600n };
    const before = activity([old], { ...registered, canonical: { version: 5n, index: 5n } }, NOW, {}, env);
    expect(before.rows[0]?.line.chip.word).toBe('held for the next version');
    const after = activity([old], { ...registered, canonical: { version: 6n, index: 6n } }, NOW, {}, env);
    expect(after.rows[0]?.line.chip.word).toBe('longer than usual');
  });

  test('a finished row folds after its week and is never dropped; a claim in flight reads as claiming', () => {
    const old = crossing('old', {
      state: 'minted-l1',
      updatedAt: NOW - FADE_AFTER_MS - 1,
      l1TxHash: `0x${'22'.repeat(32)}`,
    });
    const fresh = crossing('fresh', { kind: 3, state: 'claimable', inboxIndex: '1', createdAt: NOW - 500 });
    const a = activity(
      [old, fresh],
      view,
      NOW,
      {},
      {
        ...env,
        claiming: new Map([['fresh', NOW - 12_000]]),
      },
    );
    expect(a.rows.map((r) => [r.c.id, r.collapsed])).toEqual([
      ['fresh', false],
      ['old', true],
    ]);
    expect(a.rows[0]?.line.chip.word).toBe('claiming · 12 s');
    expect(a.rows[0]?.line.sentence).toBe('Claiming privately, about 20 s.');
    expect(a.rows[0]?.line.progress).toBeCloseTo(0.6);
    expect(a.rows[0]?.line.action).toBeUndefined();
    expect(a.needsUser).toBe(0);
    expect(a.rows[1]?.line.sentence).toBe('2 YACA at 0x709979…79C8.');
    // Through Presto the promise and the bar are Presto's; a claim still to tap promises the same.
    const p = activity([fresh], view, NOW, {}, { ...env, prover: 'presto' });
    expect(p.rows[0]?.line.sentence).toBe(
      'Arrived. Claim it into your private balance: one tap, about 5 s, no fee.',
    );
    const q = activity(
      [fresh],
      view,
      NOW,
      {},
      { ...env, prover: 'presto', claiming: new Map([['fresh', NOW - 3_000]]) },
    );
    expect(q.rows[0]?.line.sentence).toBe('Claiming privately, about 5 s.');
    expect(q.rows[0]?.line.progress).toBeCloseTo(0.6);
    // The row whose proof answered keeps its answer over the page's promise.
    const r = activity(
      [fresh],
      view,
      NOW,
      {},
      {
        ...env,
        prover: 'presto',
        claiming: new Map([['fresh', NOW - 3_000]]),
        provers: new Map([['fresh', 'wasm']]),
      },
    );
    expect(r.rows[0]?.line.sentence).toBe('Claiming privately, about 20 s.');
    // A claim that failed is ready again: its next proof is promised, the last answer is not read.
    const back = activity(
      [fresh],
      view,
      NOW,
      {},
      { ...env, prover: 'presto', provers: new Map([['fresh', 'wasm']]) },
    );
    expect(back.rows[0]?.line.sentence).toContain('about 5 s');
  });
});

describe('why a money button is off', () => {
  test('a silent RPC beats everything; unregistered stops both; closed deposits and a pause stop deposits alone', () => {
    expect(moneyStanding({ ...view, rpcFailing: true }, 'V5', 'V6')).toMatchObject({
      off: new Set(['to-ethereum', 'deposit']),
      settings: true,
    });
    expect(
      moneyStanding({ ...view, standing: { ...standing, registered: false } }, 'V5', 'V6'),
    ).toMatchObject({
      off: new Set(['to-ethereum', 'deposit']),
      reason: 'Bridging opens once Yacana registers V5 on Ethereum, at launch.',
    });
    expect(
      moneyStanding({ ...view, standing: { ...standing, depositsClosed: true } }, 'V5', 'V6'),
    ).toMatchObject({
      off: new Set(['deposit']),
      reason:
        'Deposits into V5 are closed for good. Bridge from Ethereum on V6, at yacana.network, once it opens.',
    });
    const paused = moneyStanding(
      {
        ...view,
        standing: { ...standing, paused: true, pausedUntil: BigInt(Math.floor(NOW / 1000) + 4 * 86_400) },
      },
      'V5',
      'V6',
    );
    expect([...paused.off]).toEqual(['deposit']);
    expect(paused.reason).toStartWith('The bridge is paused until ');
    expect(paused.reason).toEndWith('A bridge to Ethereum can start now; its claim waits.');
    expect(moneyStanding(view, 'V5', 'V6')).toEqual({ off: new Set() });
  });
});
