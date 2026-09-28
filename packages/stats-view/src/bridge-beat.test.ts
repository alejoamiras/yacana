import type { VersionFlows } from '@yacana/bridge/portal-reader';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { describe, expect, test } from 'vitest';
import {
  chainNow,
  exitLimitLine,
  headroomLine,
  kpisOf,
  pauseLine,
  pauseRule,
  phasesOf,
  readBridge,
  sampleBlocks,
  versionLine,
  whereOf,
} from './bridge-beat';

const ONE = 10n ** BigInt(PARAMS.DECIMALS);
const NEVER = (1n << 256n) - 1n;
const NOW = 1_800_000_000;
const policy = {
  perHour: 12n * ONE,
  allowance: 100n * ONE,
  exitFloor: 3600n,
  pauseMax: 30n * 86400n,
  pauseBudget: 60n * 86400n,
};
const live: VersionFlows = {
  version: 5n,
  registered: true,
  miner: `0x${'11'.repeat(32)}`,
  registryIndex: 5n,
  flipAt: 0n,
  afterNextAt: 0n,
  paused: false,
  headroom: 128n * ONE,
  deadline: NEVER,
  retireSent: false,
  depositsClosed: false,
  exited: 40n * ONE,
  inbound: 3n * ONE,
  cap: 165n * ONE,
  pausedUntil: 0n,
  pausedSeconds: 0n,
  launchAt: 1_799_000_000n,
};

describe('the bridge read', () => {
  test('every registered version with its flows, the canonical version, the policy and the keys', async () => {
    const calls: string[] = [];
    const reader = {
      registered: async () => [5n, 6n],
      flows: async (v: bigint) => {
        calls.push(`flows ${v}`);
        return { ...live, version: v, registryIndex: v };
      },
      canonical: async () => ({ version: 6n, index: 6n }),
      policy: async () => policy,
      operators: async () => `0x${'aa'.repeat(20)}` as const,
      forwarders: async () => [`0x${'bb'.repeat(20)}` as const],
      blockTime: async () => BigInt(NOW),
    };
    const s = await readBridge(reader, 7);
    expect(s.versions.map((v) => v.version)).toEqual([5n, 6n]);
    expect(s.canonical.version).toBe(6n);
    expect(s.forwarders).toHaveLength(1);
    expect(s.readAt).toBe(7);
    expect(s.chainTime).toBe(BigInt(NOW));
    // The chain's clock moves with the wall clock since the read, never backwards.
    expect(chainNow(s, 7 + 90_000)).toBe(NOW + 90);
    expect(chainNow(s, 0)).toBe(NOW);
    expect(calls.sort()).toEqual(['flows 5', 'flows 6']);
  });
});

describe('the sentences', () => {
  test('the limit grows before the upgrade and is frozen after it; a pause holds it, the last day ends it', () => {
    expect(exitLimitLine(live, policy, NOW)).toBe(
      `128 ${PARAMS.TOKEN_SYMBOL} may leave V5 right now · grows 12 ${PARAMS.TOKEN_SYMBOL} an hour; withdrawals beyond it wait for it to grow, until the upgrade freezes it.`,
    );
    expect(exitLimitLine({ ...live, launchAt: BigInt(NOW + 3600) }, policy, NOW)).toContain(
      'from the launch on 2027-01-15; withdrawals beyond it wait for it.',
    );
    expect(exitLimitLine({ ...live, flipAt: 1_799_500_000n }, policy, NOW)).toContain(
      'froze at the upgrade; 40',
    );
    expect(exitLimitLine({ ...live, flipAt: 1_799_500_000n }, policy, NOW)).toContain('cannot leave.');
    expect(exitLimitLine({ ...live, paused: true }, policy, NOW)).toBe(
      `128 ${PARAMS.TOKEN_SYMBOL} may leave V5 once the pause ends · 40 ${PARAMS.TOKEN_SYMBOL} has left.`,
    );
    expect(exitLimitLine({ ...live, deadline: BigInt(NOW - 1) }, policy, NOW)).toBe(
      `last day 2027-01-15 · 40 ${PARAMS.TOKEN_SYMBOL} has left; nothing more leaves V5.`,
    );
  });

  test('the exit limit as a row says why nothing leaves: paused, frozen, or past the last day', () => {
    expect(headroomLine(live, policy, NOW)).toBe(
      `128 ${PARAMS.TOKEN_SYMBOL} may leave now · grows 12 ${PARAMS.TOKEN_SYMBOL} an hour`,
    );
    expect(headroomLine({ ...live, paused: true }, policy, NOW)).toBe(
      `128 ${PARAMS.TOKEN_SYMBOL} once the pause ends`,
    );
    expect(headroomLine({ ...live, flipAt: 1_799_500_000n }, policy, NOW)).toContain('frozen at the upgrade');
    expect(headroomLine({ ...live, deadline: BigInt(NOW - 1) }, policy, NOW)).toBe(
      'last day passed · nothing more leaves',
    );
  });

  test("the pause is the portal's word, not the clock's; a running one says how much budget it spent", () => {
    expect(pauseLine(live, policy, NOW)).toBe('not paused · 0 s of 60.0 d used');
    expect(pauseRule(policy)).toContain('up to 30.0 d a call, 60.0 d in total per version');
    const paused = { ...live, paused: true, pausedUntil: BigInt(NOW + 7200), pausedSeconds: 86400n };
    expect(pauseLine(paused, policy, NOW)).toContain('paused for 2.0 h more · 1.0 d of 60.0 d used');
    // The device's clock past the portal's end while the portal still says paused: no negative duration.
    expect(pauseLine({ ...paused, pausedUntil: BigInt(NOW - 5) }, policy, NOW)).toContain('paused · 1.0 d');
    expect(pauseLine({ ...live, pausedUntil: BigInt(NOW + 7200) }, policy, NOW)).toContain('not paused');
  });

  test("a version's line: live, flipped (the last day in its readings), unrecorded, ahead of the flip, or not registered", () => {
    const at5 = { canonical: { version: 5n, index: 5n }, policy, chainTime: BigInt(NOW) };
    expect(versionLine(live, at5)).toBe('the live version · mining, deposits and withdrawals here');
    expect(versionLine({ ...live, depositsClosed: true }, at5)).toContain('deposits closed');
    const at6 = { ...at5, canonical: { version: 6n, index: 6n } };
    // Both transitions recorded: a date. The version after next unseen: the floor while it lasts, then the cliff.
    expect(versionLine({ ...live, flipAt: 1_799_500_000n, afterNextAt: 1_801_000_000n }, at6)).toBe(
      'upgraded from on 2027-01-09 · last day 2027-01-26',
    );
    expect(versionLine({ ...live, flipAt: BigInt(NOW - 60) }, at6)).toBe(
      'upgraded from on 2027-01-15 · last day 2027-01-15 at the earliest',
    );
    expect(versionLine({ ...live, flipAt: 1_799_500_000n }, at6)).toBe(
      'upgraded from on 2027-01-09 · could close any day',
    );
    expect(versionLine(live, at6)).toBe('upgraded from · the upgrade not yet recorded on the portal');
    expect(versionLine({ ...live, version: 7n, registryIndex: 7n }, at6)).toBe(
      'registered ahead of the upgrade · not live yet',
    );
    expect(versionLine({ ...live, registered: false }, at5)).toBe('not registered on the portal yet');
  });

  test('the phases: announced from the record, the upgrade and the retire from the portal, the last day from the deadline', () => {
    const at = { policy, chainTime: BigInt(NOW) };
    const quiet = phasesOf(live, null, NOW, at).map((s) => `${s.id}:${s.state}`);
    expect(quiet).toEqual(['launched:done', 'announced:todo', 'flip:todo', 'retire:todo', 'closes:todo']);
    const announced = phasesOf(
      live,
      { toIndex: '1', announcedAt: '1799900000', expectedFlipAt: '1800500000' },
      NOW,
      at,
    );
    expect(announced[1]).toMatchObject({ state: 'done', label: 'V1 announced' });
    expect(announced[1]?.detail).toBe('Jan 14 · send ahead before Jan 21');
    expect(announced[2]).toMatchObject({ state: 'on', label: 'V1 canonical' });
    const flipped = phasesOf(
      { ...live, flipAt: 1_799_500_000n, retireSent: true, afterNextAt: 1_801_000_000n },
      null,
      NOW,
      at,
    );
    expect(flipped.map((s) => `${s.id}:${s.state}`)).toEqual([
      'launched:done',
      'announced:done',
      'flip:done',
      'retire:on',
      'closes:on',
    ]);
    // Ethereum saw the retire message sent; the last proof, which is the version going quiet, it never announces.
    expect(flipped[3]).toMatchObject({
      label: 'V5 goes quiet',
      detail: 'retire message sent · mining ends when the miner consumes it · proving may stop any time',
    });
    expect(flipped[4]?.detail).toBe('Jan 26 · plus paused days');
    // Past the floor with the version after next unseen: the cliff, on; past a recorded date: done.
    const cliff = phasesOf({ ...live, flipAt: 1_799_500_000n }, null, NOW, at);
    expect(cliff[4]).toMatchObject({ state: 'bad', detail: 'could close any day · V7 going live ends it' });
    const past = phasesOf({ ...live, flipAt: 1_799_500_000n, afterNextAt: 1_799_600_000n }, null, NOW, at);
    expect(past[4]).toMatchObject({ state: 'done', detail: 'Jan 10 · passed' });
  });
});

describe('the block sampler', () => {
  test('keeps at most the bound, the first and the last always among them', () => {
    const blocks = Array.from({ length: 240 }, (_, i) => BigInt(1000 + i));
    for (const n of [1, 119, 120, 121, 239, 240]) {
      const picked = sampleBlocks(blocks.slice(0, n), 120);
      expect(picked.length).toBeLessThanOrEqual(120);
      expect(picked[0]).toBe(1000n);
      expect(picked.at(-1)).toBe(BigInt(1000 + n - 1));
    }
    expect(sampleBlocks(blocks.slice(0, 50), 120)).toEqual(blocks.slice(0, 50));
  });
});

describe('where a version’s coins are', () => {
  test('the miner’s figures belong to the build’s version; another version’s are unknown, not zero', async () => {
    const reader = {
      registered: async () => [5n, 6n],
      flows: async (v: bigint) => ({ ...live, version: v, registryIndex: v }),
      canonical: async () => ({ version: 6n, index: 6n }),
      policy: async () => policy,
      operators: async () => `0x${'aa'.repeat(20)}` as const,
      forwarders: async () => [],
      blockTime: async () => BigInt(NOW),
    };
    const s = await readBridge(reader, 7);
    const miner = { exited: 41n * ONE, claimedFromL1: 0n };
    const [v5, v6] = s.versions as [VersionFlows, VersionFlows];
    const here = (segments: ReturnType<typeof whereOf>, id: string) =>
      segments.find((x) => x.id === id)?.figure;
    expect(here(whereOf(v6, s, miner, 10n * ONE, '6'), 'here')).toBe('10');
    expect(here(whereOf(v6, s, miner, 10n * ONE, '6'), 'transit')).toBe('1');
    expect(here(whereOf(v5, s, miner, 10n * ONE, '6'), 'here')).toBe('—');
    expect(here(whereOf(v5, s, miner, 10n * ONE, '6'), 'transit')).toBe('—');
  });
});

describe('the share on Ethereum', () => {
  test('is of all minted while one version has minted, and unsaid once YACA spans versions', async () => {
    const reader = (versions: bigint[]) => ({
      registered: async () => versions,
      flows: async (v: bigint) => ({ ...live, version: v, registryIndex: v }),
      canonical: async () => ({ version: versions.at(-1) as bigint, index: versions.at(-1) as bigint }),
      policy: async () => policy,
      operators: async () => `0x${'aa'.repeat(20)}` as const,
      forwarders: async () => [],
      blockTime: async () => BigInt(NOW),
    });
    const extras = { yacaSupply: 40n * ONE, events: [], lastCrossingAt: null };
    const miner = { exited: 40n * ONE, claimedFromL1: 0n };
    const one = { ...(await readBridge(reader([5n]), 7)), extras };
    const ethereum = (s: typeof one) => kpisOf(s, s.versions[0], miner, 60n * ONE, NOW, 'anvil')[0]?.sub;
    expect(ethereum(one)).toContain('40 % of all minted');
    const two = { ...(await readBridge(reader([5n, 6n]), 7)), extras };
    expect(ethereum(two)).not.toContain('%');
  });
});
