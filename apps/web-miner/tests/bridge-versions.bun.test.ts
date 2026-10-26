// The other versions a refresh reads for the rows that belong to them: a few per refresh, in turn,
// only those with a crossing still under way, the rest kept from the last reading. A recovery
// file can name any number of versions; the RPC never sees them all at once. On the prototype with
// fake dependencies, as bridge-reads does.
process.env.VITE_ROLLUP_VERSION = '5';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Crossing } from '@yacana/bridge/journal';
import type { VersionStanding } from '@yacana/bridge/portal-reader';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { BridgeSession } from '../src/bridge/session.ts';
import type { BridgeView } from '../src/state.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const standing: VersionStanding = {
  registered: true,
  miner: `0x${'0a'.repeat(20)}`,
  registryIndex: 0n,
  paused: false,
  pausedUntil: 0n,
  headroom: 500n,
  deadline: (1n << 256n) - 1n,
  flipAt: 0n,
  afterNextAt: 0n,
  pausedSeconds: 0n,
  retireSent: false,
  depositsClosed: false,
};
const crossing = (version: string, state: Crossing['state']): Crossing => ({
  id: `c${version}-${state}`,
  kind: 2,
  chainId: '31337',
  portal: `0x${'be'.repeat(20)}`,
  version,
  index: 0,
  amount: '7',
  state,
  createdAt: 0,
  updatedAt: 0,
  ethAddress: `0x${'22'.repeat(20)}`,
});

/** `otherVersions` on the real prototype: the journal and the reader are the case's. */
function sessionOver(journal: Crossing[]) {
  const asked: string[] = [];
  const s = Object.create(BridgeSession.prototype) as Record<string, unknown>;
  s.ctx = { version: 5n };
  s.versionsFrom = 0;
  s.journal = { list: async () => journal };
  s.reader = {
    standing: async (v: bigint) => {
      asked.push(v.toString());
      return standing;
    },
  };
  const read = (prev: BridgeView['versions']) =>
    (
      BridgeSession.prototype as unknown as {
        otherVersions: (
          block: { number: bigint | null; timestamp: bigint },
          floor: bigint,
          prev: BridgeView['versions'],
        ) => Promise<BridgeView['versions']>;
      }
    ).otherVersions.call(s, { number: 100n, timestamp: 1_800_000_000n }, 86_400n, prev);
  return { read, asked };
}

describe('the other versions a refresh reads', () => {
  test('two per refresh in turn, only those with a crossing under way; the rest keep their last reading', async () => {
    const journal = [
      crossing('1', 'held'),
      crossing('2', 'held'),
      crossing('3', 'held'),
      crossing('4', 'minted-l2'),
      crossing('5', 'held'),
    ];
    const { read, asked } = sessionOver(journal);
    const first = await read(undefined);
    expect(asked).toEqual(['1', '2']);
    expect(Object.keys(first ?? {})).toEqual(['1', '2']);
    const second = await read(first);
    expect(asked.slice(2)).toEqual(['3', '1']);
    // V4 has nothing under way and V5 is this build: neither is read, ever.
    expect(Object.keys(second ?? {}).sort()).toEqual(['1', '2', '3']);
    await read(second);
    expect(asked.slice(4)).toEqual(['2', '3']);
  });
});
