// The scan's cases run on a fake chain; `YACANA_SEPOLIA_RPC_URL` adds the same reader against the
// testnet's own Rollup, and `bun run e2e:agent -- bun test packages/bridge` against a real anvil.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { createAztecNodeDebugClient } from '@aztec-labs/stdlib/interfaces/client';
import { createPublicClient, decodeEventLog, type Hex, http } from 'viem';
import { LOG_WINDOW } from './logs.ts';
import { type ProofClient, type ProofFloor, proofReader } from './proofs.ts';

const ROLLUP = `0x${'ab'.repeat(20)}` as Hex;
/** One `L2ProofVerified` log as Sepolia served it for the Aztec testnet's V5 Rollup. */
const recorded = (await Bun.file(resolve(import.meta.dir, '../fixtures/l2-proof-verified.json')).json()) as {
  blockNumber: number;
  logIndex: number;
  topics: Hex[];
  data: Hex;
};

type FakeLog = { blockNumber: bigint; logIndex: number; args: { checkpointNumber: bigint; proverId: Hex } };

/** A chain whose head can move, block timestamps ten times the number, and proof events at given blocks. */
const chain = (head: bigint, events: FakeLog[]) => {
  const calls: [bigint, bigint][] = [];
  const state = { head };
  const client = {
    getBlockNumber: async () => state.head,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ timestamp: (blockNumber ?? 0n) * 10n }),
    getContractEvents: async ({ fromBlock, toBlock }: { fromBlock?: bigint; toBlock?: bigint }) => {
      const [lo, hi] = [fromBlock ?? 0n, toBlock ?? 0n];
      // A real RPC refuses this, so the scan must never ask for it.
      if (lo > hi) throw new Error(`inverted range ${lo}..${hi}`);
      calls.push([lo, hi]);
      return events.filter((e) => e.blockNumber >= lo && e.blockNumber <= hi);
    },
  } as unknown as ProofClient;
  return { client, calls, events, state };
};
const event = (blockNumber: bigint, checkpointNumber: bigint, logIndex = 0): FakeLog => ({
  blockNumber,
  logIndex,
  args: { checkpointNumber, proverId: `0x${'01'.repeat(20)}` },
});
const exact = (block: bigint) => async (): Promise<ProofFloor> => ({ block, exact: true });
/** Refreshes until the scan has an answer: an unfinished one says `unknown` however much it holds. */
const settles = async (reader: { latestProvenAt(): Promise<unknown> }, calls = 16) => {
  let read = await reader.latestProvenAt();
  for (let i = 0; i < calls && read === 'unknown'; i++) read = await reader.latestProvenAt();
  return read;
};
const guessed = (block: bigint) => async (): Promise<ProofFloor> => ({ block, exact: false });

describe("the rollup's latest proof on Ethereum", () => {
  test('a recorded L2ProofVerified log decodes to its checkpoint; the reader answers with its block time', async () => {
    const decoded = decodeEventLog({
      abi: RollupAbi,
      data: recorded.data as Hex,
      topics: recorded.topics as [Hex, ...Hex[]],
    });
    expect(decoded.eventName).toBe('L2ProofVerified');
    const checkpoint = (decoded.args as { checkpointNumber: bigint }).checkpointNumber;
    const c = chain(BigInt(recorded.blockNumber) + 3n, [
      {
        blockNumber: BigInt(recorded.blockNumber),
        logIndex: recorded.logIndex,
        args: decoded.args as FakeLog['args'],
      },
    ]);
    const read = await proofReader(c.client, { rollup: ROLLUP, floor: exact(0n) }).latestProvenAt();
    expect(read).toEqual({
      at: BigInt(recorded.blockNumber) * 10n,
      checkpoint,
      block: BigInt(recorded.blockNumber),
    });
  });

  test('the newest event wins, not the first found; an exact floor reached without one is "none", a guessed one "unknown"', async () => {
    const c = chain(25_000n, [event(100n, 1n), event(20_100n, 7n), event(20_100n, 8n, 1), event(3_000n, 2n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 8 });
    expect(await reader.latestProvenAt()).toEqual({ at: 201_000n, checkpoint: 8n, block: 20_100n });
    // Newest-first: the first window read is the head's.
    expect(c.calls[0]).toEqual([25_000n - LOG_WINDOW + 1n, 25_000n]);
    const empty = chain(25_000n, []);
    expect(await proofReader(empty.client, { rollup: ROLLUP, floor: exact(1_000n) }).latestProvenAt()).toBe(
      'none',
    );
    expect(empty.calls.some(([lo]) => lo === 1_000n)).toBe(true);
    // A floor that is only a guess cannot prove the absence: exhausting it is unknown.
    const guess = chain(25_000n, []);
    expect(await proofReader(guess.client, { rollup: ROLLUP, floor: guessed(1_000n) }).latestProvenAt()).toBe(
      'unknown',
    );
    // A floor above the head is no floor at all.
    const short = chain(10n, []);
    expect(await proofReader(short.client, { rollup: ROLLUP, floor: exact(1_000n) }).latestProvenAt()).toBe(
      'unknown',
    );
  });

  test('a budget exhausted is unknown, and the next call resumes below the last window', async () => {
    const c = chain(45_000n, [event(50n, 1n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 2 });
    expect(await reader.latestProvenAt()).toBe('unknown');
    expect(c.calls).toHaveLength(2);
    expect(await reader.latestProvenAt()).toBe('unknown');
    expect(c.calls[2]?.[1]).toBe(45_000n - 2n * LOG_WINDOW);
    expect(await reader.latestProvenAt()).toEqual({ at: 500n, checkpoint: 1n, block: 50n });
  });

  test('a proof that arrives above a walk already under way is reached once the walk finishes', async () => {
    const c = chain(45_000n, []);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 2, overlap: 5n });
    expect(await reader.latestProvenAt()).toBe('unknown');
    // The chain moves on and a proof lands at the new head, above where the walk started.
    c.state.head = 46_000n;
    c.events.push(event(45_500n, 9n));
    expect(await settles(reader)).toMatchObject({ checkpoint: 9n, block: 45_500n });
  });

  test('an incomplete scan says so: the known proof is kept, never reported while newer blocks are unread', async () => {
    const c = chain(1_000n, [event(900n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 2, overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n });
    c.state.head = 60_000n;
    c.events.push(event(59_000n, 9n));
    // Dating the last proof at block 900 while 59 000 blocks are unread would be a wrong sentence.
    expect(await reader.latestProvenAt()).toBe('unknown');
    // The frontier advances a window per call rather than restarting at the known event.
    expect(await settles(reader)).toMatchObject({ checkpoint: 9n, block: 59_000n });
  });

  test('a walk resumed across calls does not publish on coverage the chain no longer has', async () => {
    const c = chain(50_000n, [event(50n, 1n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), overlap: 5n });
    // Four windows down from 50 000 and the budget is out: nothing found yet.
    expect(await reader.latestProvenAt()).toBe('unknown');
    // The chain retreats and a newer proof lands near the new head, inside blocks the walk read.
    c.state.head = 49_999n;
    c.events.push(event(49_998n, 9n));
    // The old proof at block 50 is not the latest, and must not be reported as it — not even once.
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 9n, block: 49_998n });
  });

  test('a budget of one still catches up: the confirmation never starves the frontier', async () => {
    const c = chain(1_000n, [event(900n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 1, overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n });
    c.state.head = 2_000n;
    c.events.push(event(1_500n, 9n));
    // Re-reading the known event spends the only budgeted call; a frontier left with none never moves.
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 9n, block: 1_500n });
  });

  test('a reorg that takes the known event but leaves an older one in the overlap is still a reorg', async () => {
    const c = chain(1_000n, [event(899n, 3n), event(900n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n, block: 900n });
    c.events.length = 0;
    c.events.push(event(899n, 3n));
    // The overlap is not empty, but its newest event is older than the one reported: 900 is gone.
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 3n, block: 899n });
  });

  test('a proof that appears just below the frontier is read: the forward pass starts behind it', async () => {
    const c = chain(1_000n, [event(900n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n, block: 900n });
    // A short reorg leaves 900 alone and puts a newer proof at 999, below the head already read.
    c.events.push(event(999n, 5n));
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 5n, block: 999n });
  });

  test('a head that retreats does not strand the walk: progress above it is dropped and read again', async () => {
    const c = chain(30_000n, [event(29_000n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), budget: 2, overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n, block: 29_000n });
    // A reorg shortens the chain below everything read so far, then a new proof lands on the new tip.
    c.state.head = 20_000n;
    c.events.length = 0;
    c.events.push(event(19_500n, 9n));
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 9n, block: 19_500n });
  });

  test('a known event is advanced over the overlap: a newer one replaces it, its disappearance is a reorg', async () => {
    const c = chain(1_000n, [event(900n, 4n)]);
    const reader = proofReader(c.client, { rollup: ROLLUP, floor: exact(0n), overlap: 5n });
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 4n });
    // The chain moves on and the next proof lands: the forward walk from the known event finds it.
    c.state.head = 1_010n;
    c.events.push(event(1_005n, 5n));
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 5n, at: 10_050n });
    // A reorg takes it: the overlap around it comes back empty, and the reader forgets rather than reporting it.
    c.events.length = 0;
    expect(await reader.latestProvenAt()).toBe('none');
    c.events.push(event(1_008n, 6n));
    expect(await reader.latestProvenAt()).toMatchObject({ checkpoint: 6n });
  });
});

const nodeUrl = process.env.AZTEC_NODE_URL ?? '';
const l1RpcUrl = process.env.L1_RPC_URL ?? '';

describe.skipIf(!nodeUrl || !l1RpcUrl)('the reader against a real anvil', () => {
  test(
    "the local network's synthetic prove advances the tip and emits no event: the reader says so over real getLogs",
    async () => {
      const node = createAztecNodeClient(nodeUrl);
      const info = await node.getNodeInfo();
      const rollup = info.l1ContractAddresses.rollupAddress.toString() as Hex;
      const client = createPublicClient({ transport: http(l1RpcUrl) });
      // Five slots warped, then the prove the e2e control server uses for a settlement: it writes the
      // outbox roots and the proven tip by cheat code, never `submitEpochRootProof`, so no event exists.
      const debug = createAztecNodeDebugClient(nodeUrl);
      await debug.warpL2TimeAtLeastBy(72 * 5);
      const proven = await debug.prove();
      expect(proven).toBeGreaterThan(0);
      const reader = proofReader(client, { rollup, floor: exact(0n), budget: 8 });
      let read = await reader.latestProvenAt();
      while (read === 'unknown') read = await reader.latestProvenAt();
      expect(read).toBe('none');
      expect(
        await client.readContract({
          address: rollup,
          abi: RollupAbi,
          functionName: 'getProvenCheckpointNumber',
        }),
      ).toBeGreaterThan(0n);
    },
    2 * 60_000,
  );
});

const sepoliaRpc = process.env.YACANA_SEPOLIA_RPC_URL ?? '';

describe.skipIf(!sepoliaRpc)("the Aztec testnet's latest proof on Sepolia", () => {
  test(
    'the reader finds a real event through a public RPC and its time is the block’s',
    async () => {
      const rollup = '0xd73a91bdcf6891c7642f3e460036e1ef2cc23178' as Hex;
      const client = createPublicClient({ transport: http(sepoliaRpc) });
      const head = await client.getBlockNumber();
      const reader = proofReader(client, { rollup, floor: guessed(head - 200_000n), budget: 6 });
      let read = await reader.latestProvenAt();
      for (let i = 0; i < 10 && read === 'unknown'; i++) read = await reader.latestProvenAt();
      if (typeof read !== 'object') throw new Error(`no proof in the last 200k blocks: ${String(read)}`);
      expect(read.at).toBe((await client.getBlock({ blockNumber: read.block })).timestamp);
      expect(read.checkpoint).toBeGreaterThan(0n);
    },
    2 * 60_000,
  );
});
