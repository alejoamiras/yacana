// bun: the controller against a fake worker and fake contracts. The lost-race reset is injected
// (`recover`), so what is checked is the orchestration: the rebuilt view is read (re-sync), mining
// resumes on it, a delivery still blocked after a rebuild gets the pause; and a claim that did not land
// is checked against a node that answers as the pinned SDK does (receipts as its classes, a block's
// effects only with `includeTransactions`, reads per tip) before anything is sent again.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import {
  DroppedTxReceipt,
  MinedTxReceipt,
  PendingTxReceipt,
  type TxEffect,
  TxExecutionResult,
  TxHash,
  TxStatus,
} from '@aztec/stdlib/tx';
import { ticketNullifier } from '@yacana/miner-core/proof';
import { createStore } from 'jotai';
import type { Deployment, Fee } from '../src/chain.ts';
import { MinerController, type Rebound } from '../src/controller.ts';
import { winNote } from '../src/lib/claim-copy.ts';
import { balanceAtom, claimsAtom, minerAtom } from '../src/state.ts';
import type { SentTx, TurnOwn } from '../src/wallet.ts';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';

/** Consent as the controller tests need it: in force, with nothing to remember. */
const OPEN = { allowed: () => true, promote() {}, forget() {} };

class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: ToWorker[] = [];
  postMessage(m: ToWorker) {
    this.sent.push(m);
    if (m.type === 'init')
      queueMicrotask(() => this.emit({ type: 'ready', threads: 1, initMs: 0, prover: 'wasm' }));
  }
  terminate() {}
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}

const sim = (result: unknown) => ({ simulate: async () => ({ result }) });

/** The reads the controller makes, a claim whose send is scripted, and a balance to tell views apart. */
const fakeDeployment = (
  balance: bigint | (() => Promise<bigint>),
  send: () => Promise<unknown>,
  epoch: () => Promise<bigint> = async () => 3n,
): Deployment =>
  ({
    node: {
      getL1Constants: async () => ({ slotDuration: 36, epochDuration: 32, proofSubmissionEpochs: 1 }),
    },
    miner: {
      address: AztecAddress.fromBigIntUnsafe(7n),
      methods: {
        open_epoch: () => ({ simulate: async () => ({ result: await epoch() }) }),
        epoch_params: () => sim({ target: 1n << 122n, seed: 7n, opened_at: 0n }),
        claims_in: () => sim(1n),
        claim: () => ({ send }),
      },
    },
    token: {
      methods: {
        balance_of_private: () => ({
          simulate: async () => ({ result: typeof balance === 'bigint' ? balance : await balance() }),
        }),
      },
    },
    lastSent: () => undefined,
  }) as unknown as Deployment;

const fee = {
  paymentMethod: { getAsset: () => undefined },
  gasSettings: { gasLimits: {} },
} as unknown as Fee;
const account = AztecAddress.fromBigIntUnsafe(11n);
const winner: Extract<FromWorker, { type: 'winner' }> = {
  type: 'winner',
  epoch: 3n,
  secretId: 1,
  nonce: 1n,
  out: '0x1',
  proofFields: [],
  digest: '0x2',
  attempts: 1,
  prover: 'wasm',
};
const REVERTED = new Error(
  'Transaction 0x1 reverted: app_logic_reverted. Reason: Assertion failed: stale claim',
);
const BLOCKED = new Error('Simulation error: Nullifier read request failed for note 0x3');

const settle = async (done: () => boolean, ms = 8_000) => {
  for (let i = 0; i < ms / 10 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lost-race recovery', () => {
  let store: ReturnType<typeof createStore>;
  let worker: FakeWorker;
  beforeEach(() => {
    store = createStore();
    worker = new FakeWorker();
  });

  const boot = async (deployment: Deployment, recover: () => Promise<Rebound>, readDeadlineMs?: number) => {
    const controller = new MinerController({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment,
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover,
      readDeadlineMs,
    });
    await controller.ready();
    await controller.begin();
    controller.start();
    await settle(() => worker.sent.some((m) => m.type === 'mine'));
    return controller;
  };

  test('a reverted claim rebuilds the view, reads it, and mining resumes on the rebuilt deployment', async () => {
    let recovered = 0;
    const rebuilt = fakeDeployment(9n, () => Promise.reject(BLOCKED));
    const controller = await boot(
      fakeDeployment(5n, () => Promise.reject(REVERTED)),
      async () => {
        recovered++;
        return { deployment: rebuilt, fee, rebuilt: true };
      },
    );
    expect(store.get(balanceAtom)).toBe(5n);
    worker.emit(winner);
    await settle(() => store.get(minerAtom).phase === 'mining' && recovered === 1);
    expect(store.get(balanceAtom)).toBe(9n);
    expect(controller.deployment).toBe(rebuilt);
    expect(store.get(minerAtom).notice).toBeNull();
    expect(store.get(minerAtom).ledger.map((l) => l.kind)).toEqual(['epoch', 'failed']);
    expect(worker.sent.filter((m) => m.type === 'mine')).toHaveLength(2);
    // Neither the winner nor the failure is sent with a monotonic time: the chart's span has both ends
    // only because the dispatch stamps them.
    const [span] = store.get(minerAtom).claimSpans;
    expect(span?.outcome).toBe('failed');
    expect(span?.t1 ?? Number.NaN).toBeGreaterThanOrEqual(span?.t0 ?? Number.NaN);

    // Still blocked right after the rebuild: the honest pause, not another rebuild.
    worker.emit({ ...winner, secretId: 2 });
    await settle(() => store.get(minerAtom).notice?.kind === 'paused');
    expect(recovered).toBe(1);
    const until = store.get(minerAtom).notice?.until ?? 0;
    expect(until - Date.now()).toBeGreaterThan(2 * 32 * 36 * 1000 - 5000);
    expect(store.get(minerAtom).phase).toBe('idle');
    controller.dispose();
  });

  test('Stop during a claim that reverts: the view is rebuilt and read, mining does not resume', async () => {
    const rebuilt = fakeDeployment(9n, () => Promise.reject(BLOCKED));
    const controller = await boot(
      fakeDeployment(5n, () => Promise.reject(REVERTED)),
      async () => ({ deployment: rebuilt, fee, rebuilt: true }),
    );
    worker.emit(winner);
    expect(store.get(minerAtom).phase).toBe('claiming');
    controller.stop();
    await settle(() => controller.deployment === rebuilt && store.get(minerAtom).phase === 'idle');
    expect(store.get(balanceAtom)).toBe(9n);
    expect(worker.sent.filter((m) => m.type === 'mine')).toHaveLength(1);
    controller.dispose();
  });

  test('a drop that fails but reopens falls back to the pause on the reopened view', async () => {
    const reopened = fakeDeployment(5n, () => Promise.reject(REVERTED));
    const controller = await boot(
      fakeDeployment(5n, () => Promise.reject(REVERTED)),
      async () => ({
        deployment: reopened,
        fee,
        rebuilt: false,
      }),
    );
    worker.emit(winner);
    await settle(() => store.get(minerAtom).notice?.kind === 'paused');
    expect(store.get(minerAtom).notice?.body).toMatch(/Mining resumes about \d\d:\d\d\./);
    expect(controller.deployment).toBe(reopened);
    controller.dispose();
  });

  test('no wallet at all after a failed rebuild is terminal: reload', async () => {
    const controller = await boot(
      fakeDeployment(5n, () => Promise.reject(REVERTED)),
      () => Promise.reject(new Error('another tab holds this key’s chain view open')),
    );
    worker.emit(winner);
    await settle(() => store.get(minerAtom).proverDead);
    expect(store.get(minerAtom).notice?.kind).toBe('prover-dead');
    expect(store.get(minerAtom).notice?.body).toContain('another tab holds this key’s chain view open');
    expect(store.get(minerAtom).notice?.title).toContain('reload the page');
    controller.dispose();
  });

  test('a rebuilt view that cannot be read is not declared recovered; Start reads it again', async () => {
    let reads = 0;
    const flaky = fakeDeployment(
      9n,
      () => Promise.reject(BLOCKED),
      async () => {
        if (reads++ === 0) throw new Error('fetch failed');
        return 3n;
      },
    );
    const controller = await boot(
      fakeDeployment(5n, () => Promise.reject(REVERTED)),
      async () => ({
        deployment: flaky,
        fee,
        rebuilt: true,
      }),
    );
    worker.emit(winner);
    await settle(() => store.get(minerAtom).notice?.kind === 'failed');
    expect(store.get(minerAtom)).toMatchObject({ phase: 'idle' });
    expect(store.get(minerAtom).notice?.body).toContain('press Start');
    expect(store.get(balanceAtom)).toBe(5n);
    controller.start();
    controller.start();
    await settle(() => store.get(minerAtom).phase === 'mining');
    expect(store.get(minerAtom).notice).toBeNull();
    expect(store.get(balanceAtom)).toBe(9n);
    expect(store.get(minerAtom).ledger.map((l) => l.kind)).toEqual(['epoch', 'failed', 'failed']);
    // The second Start joined the same read: a Stop now is not undone by a second completion.
    controller.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(store.get(minerAtom).phase).toBe('idle');
    expect(worker.sent.filter((m) => m.type === 'mine')).toHaveLength(2);
    controller.dispose();
  });

  test('a read that outlives its deadline writes nothing over a newer one', async () => {
    let calls = 0;
    // Read 0 (boot) answers at once; read 1 answers late with a stale balance; read 2 at once.
    const balance = () =>
      new Promise<bigint>((resolve) => {
        const n = calls++;
        setTimeout(() => resolve(n === 1 ? 1n : n === 2 ? 2n : 5n), n === 1 ? 150 : 0);
      });
    const controller = await boot(
      fakeDeployment(balance, () => Promise.reject(REVERTED)),
      () => Promise.reject(new Error('unused')),
      50,
    );
    await expect(controller.refresh()).rejects.toThrow(/no answer/);
    await controller.refresh();
    expect(store.get(balanceAtom)).toBe(2n);
    await new Promise((r) => setTimeout(r, 150));
    expect(store.get(balanceAtom)).toBe(2n);
    controller.dispose();
  });
});

/** What a send's receipt says: in the pool, unknown to the node, or in a block. */
type Receipt = 'pending' | 'dropped' | { block: number; reverted?: true };

/** One claim attempt, from its building on: `gate` holds it in flight until the test lets it go. */
type Plan = { gate?: Promise<void> } & (
  | { before: Error }
  | { refused: Error; expiresAt?: number }
  | { receipts: Receipt[]; expiresAt?: number }
);

type Read = 'getTxReceipt' | 'findLeavesIndexes' | 'getPublicStorageAt';
/** A read, or a read pinned to one tip. */
type NodeRead = Read | `${Read}@${'latest' | 'checkpointed'}`;

const MINER = AztecAddress.fromBigIntUnsafe(7n);
const OPEN_SLOT = new Fr(1n);
const RETIRED_SLOT = new Fr(2n);
const nowS = () => Math.floor(Date.now() / 1000);
/** The hash of the node's `n`th claim attempt. */
const hashOf = (n: number) => TxHash.fromBigInt(0xa0n + BigInt(n)).toString();

const PRUNED = new Error(
  'Block hash 0x2766 not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred.',
);
const COLLISION = new Error(
  'C++ simulation failed: AVM simulation failed: [R_NULLIFIER_INSERTION] UNRECOVERABLE ERROR! Nullifier collision: Attempted to emit duplicate siloed nullifier 0x2f59.',
);
const NOT_OPEN = new Error('Simulation error: Assertion failed: epoch is not open');
const EXPIRED = new Error('Invalid tx: Invalid expiration timestamp');

/**
 * A node whose chain the test writes: the miner's open epoch and retirement at the latest and the
 * checkpointed tips, the claims sent and the receipts each answers (one per read, the last standing),
 * the nullifier tree, and blocks gone or served without their effects.
 */
class FakeNode {
  latest = { open: 3n, retired: false, time: nowS() };
  /** The page's reads of the open epoch fail while set; the checks' storage reads still answer. */
  epochDown = false;
  checkpointed = { open: 3n, retired: false, time: nowS(), leaves: new Map<string, number>() };
  /** Nullifiers at the latest tip beyond those of the sends in blocks. */
  leaves = new Map<string, number>();
  missing = new Set<number>();
  hollow = new Set<number>();
  /** Sends a block carries whatever their receipts say. */
  carried = new Map<number, string[]>();
  plans: Plan[] = [];
  attempts = 0;
  /** Hashes that reached the node. */
  sent: string[] = [];
  reads = new Map<string, number>();
  storageReads = 0;
  waiting = new Set<NodeRead>();
  private txs = new Map<string, { nonce: bigint; receipts: Receipt[]; now: Receipt }>();
  private last: SentTx | undefined;
  private holder: TurnOwn | undefined;
  private held = new Map<NodeRead, Promise<void>>();

  constructor(private readonly tickets: Map<bigint, string>) {}

  /** The receipts `hash` answers from its next read on. */
  script(hash: string, receipts: Receipt[]) {
    const tx = this.txs.get(hash);
    if (tx) tx.receipts = receipts;
  }

  /** Holds every read of `method` until the release it returns. */
  hold(method: NodeRead): () => void {
    let release = () => {};
    this.held.set(
      method,
      new Promise<void>((r) => {
        release = r;
      }),
    );
    return () => {
      this.held.delete(method);
      release();
    };
  }

  private async gate(method: Read, tip?: string) {
    const key = [`${method}@${tip}`, method].find((k) => this.held.has(k as NodeRead)) as
      | NodeRead
      | undefined;
    const g = key && this.held.get(key);
    if (!key || !g) return;
    this.waiting.add(key);
    await g;
    this.waiting.delete(key);
  }

  private effect(hash: string, nonce: bigint, reverted = false): TxEffect {
    const ticket = this.tickets.get(nonce) ?? '0x0';
    // A reverted claim keeps only its transaction's own nullifier: the ticket's is discarded with the revert.
    const nullifiers = [Fr.fromString(hash), ...(reverted ? [] : [Fr.fromString(ticket)])];
    return { txHash: TxHash.fromString(hash), nullifiers, noteHashes: [new Fr(9n)] } as unknown as TxEffect;
  }

  private leafAt(nullifier: string): number | undefined {
    const extra = this.leaves.get(nullifier);
    if (extra !== undefined) return extra;
    for (const tx of this.txs.values())
      if (typeof tx.now === 'object' && !tx.now.reverted && this.tickets.get(tx.nonce) === nullifier)
        return tx.now.block;
    return undefined;
  }

  async submit(nonce: bigint): Promise<{ txHash: TxHash }> {
    const n = ++this.attempts;
    const plan = this.plans[n - 1];
    if (!plan) throw new Error(`no plan for attempt ${n}`);
    await plan.gate;
    if ('before' in plan) throw plan.before;
    const hash = hashOf(n);
    this.last = { txHash: hash, expiresAt: plan.expiresAt ?? nowS() + 600, anchorBlock: 1 };
    await this.holder?.hook?.(this.last);
    this.sent.push(hash);
    if ('refused' in plan) throw plan.refused;
    this.txs.set(hash, { nonce, receipts: [...plan.receipts], now: 'pending' });
    return { txHash: TxHash.fromString(hash) };
  }

  async getTxReceipt(txHash: TxHash, opts?: { includeTxEffect?: boolean }) {
    await this.gate('getTxReceipt');
    const hash = txHash.toString();
    this.reads.set(hash, (this.reads.get(hash) ?? 0) + 1);
    const tx = this.txs.get(hash);
    if (!tx) return new DroppedTxReceipt(txHash, 'Tx dropped by P2P node');
    tx.now = tx.receipts.shift() ?? tx.now;
    const r = tx.now;
    if (r === 'pending') return new PendingTxReceipt(txHash, undefined);
    if (r === 'dropped') return new DroppedTxReceipt(txHash, 'Tx dropped by P2P node');
    const effect = opts?.includeTxEffect ? this.effect(hash, tx.nonce, r.reverted) : undefined;
    const result = r.reverted ? TxExecutionResult.REVERTED : TxExecutionResult.SUCCESS;
    // Block hash, slot and epoch are never read; the branded numbers take a cast.
    return new MinedTxReceipt(
      txHash,
      TxStatus.PROPOSED,
      result,
      0n,
      undefined as never,
      r.block as never,
      1 as never,
      0,
      1 as never,
      effect,
      undefined,
    );
  }

  async findLeavesIndexes(tip: string, _tree: unknown, [leaf]: Fr[]) {
    await this.gate('findLeavesIndexes', tip);
    const key = leaf?.toString() ?? '';
    const block = tip === 'checkpointed' ? this.checkpointed.leaves.get(key) : this.leafAt(key);
    return [block === undefined ? undefined : { l2BlockNumber: block, l2BlockHash: undefined, data: 0n }];
  }

  async getBlock(n: number | 'latest' | 'checkpointed', opts?: { includeTransactions?: boolean }) {
    if (n === 'latest' || n === 'checkpointed')
      return { header: { globalVariables: { timestamp: BigInt(this[n].time) } } };
    if (this.missing.has(n)) return undefined;
    const header = { globalVariables: { blockNumber: n } };
    // The effects come only on request, as the node's block responses carry them.
    if (!opts?.includeTransactions) return { header };
    const own = [...this.txs]
      .filter(([, t]) => typeof t.now === 'object' && t.now.block === n)
      .map(([h, t]) => this.effect(h, t.nonce, typeof t.now === 'object' && t.now.reverted));
    const extra = (this.carried.get(n) ?? []).map((h) => this.effect(h, this.txs.get(h)?.nonce ?? 1n));
    return { header, body: { txEffects: this.hollow.has(n) ? [] : [...own, ...extra] } };
  }

  async getPublicStorageAt(tip: string, _at: AztecAddress, slot: Fr) {
    await this.gate('getPublicStorageAt', tip);
    this.storageReads++;
    const s = tip === 'checkpointed' ? this.checkpointed : this.latest;
    if (slot.equals(OPEN_SLOT)) return new Fr(s.open);
    return new Fr(s.retired ? 1n : 0n);
  }

  async getL1Constants() {
    return { slotDuration: 36, epochDuration: 32, proofSubmissionEpochs: 1 };
  }

  /** No tip for the poll's sample beside its refresh: the page-wide health store stays out of these tests. */
  async getCheckpointNumber(): Promise<number> {
    throw new Error('no tip here');
  }

  deployment(): Deployment {
    const lazy = (v: () => unknown) => ({ simulate: async () => ({ result: v() }) });
    return {
      node: this,
      miner: {
        address: MINER,
        artifact: { storageLayout: { open_epoch: { slot: OPEN_SLOT }, retired: { slot: RETIRED_SLOT } } },
        methods: {
          open_epoch: () =>
            lazy(() => {
              if (this.epochDown) throw new Error('fetch failed');
              return this.latest.open;
            }),
          epoch_params: () => sim({ target: 1n << 122n, seed: 7n, opened_at: 0n }),
          claims_in: () => sim(1n),
          claim: (_epoch: bigint, nonce: bigint) => ({ send: () => this.submit(nonce) }),
        },
      },
      token: { methods: { balance_of_private: () => sim(5n) } },
      lastSent: () => this.last,
      turn: <T>(op: () => Promise<T>, own?: TurnOwn) => {
        this.holder = own;
        return op().finally(() => {
          this.holder = undefined;
        });
      },
    } as unknown as Deployment;
  }
}

describe('claim recovery', () => {
  const T = 20_000;
  const WIN2: typeof winner = { ...winner, epoch: 4n, nonce: 2n, digest: '0x3' };
  let TICKET = '';
  let tickets: Map<bigint, string>;
  let store: ReturnType<typeof createStore>;
  let worker: FakeWorker;
  let node: FakeNode;
  /** Every sentence each win line has said, in order. */
  let said: Map<number, string[]>;

  beforeAll(async () => {
    TICKET = (await ticketNullifier(Fr.fromString(winner.digest), MINER)).toString();
    const second = (await ticketNullifier(Fr.fromString(WIN2.digest), MINER)).toString();
    tickets = new Map([
      [winner.nonce, TICKET],
      [WIN2.nonce, second],
    ]);
  });
  beforeEach(() => {
    store = createStore();
    worker = new FakeWorker();
    node = new FakeNode(tickets);
    said = new Map();
    store.sub(minerAtom, () => {
      for (const l of store.get(minerAtom).ledger) {
        const text = l.kind === 'win' ? winNote(l.claim, Date.now())?.text : undefined;
        const seen = said.get(l.id) ?? [];
        if (text && seen.at(-1) !== text) said.set(l.id, [...seen, text]);
      }
    });
  });

  const boot = async (
    o: { recover?: () => Promise<Rebound>; delay?: (ms: number) => number; deadline?: number } = {},
  ) => {
    const controller = new MinerController({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: node.deployment(),
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: o.recover ?? (async () => ({ deployment: node.deployment(), fee, rebuilt: true })),
      recoveryDelay: o.delay ?? ((ms) => ms / 1000),
      readDeadlineMs: o.deadline,
    });
    await controller.ready();
    await controller.begin();
    controller.start();
    await settle(() => mines() === 1);
    return controller;
  };

  const mines = () => worker.sent.filter((m) => m.type === 'mine').length;
  const minedEpoch = () => {
    const last = worker.sent.filter((m) => m.type === 'mine').at(-1);
    return last?.type === 'mine' ? last.job.epoch : undefined;
  };
  /** A winning proof on its own line, then its winner: the claim starts. */
  const win = (w = winner): number => {
    worker.emit({ ...w, type: 'attempt', proveMs: 1, score: 70, win: true, target: 1n << 122n });
    const id = store.get(minerAtom).ledger[0]?.id ?? -1;
    worker.emit(w);
    return id;
  };
  const noteOf = (id: number) => store.get(minerAtom).ledger.find((l) => l.id === id)?.claim;
  const textOf = (id: number) => winNote(noteOf(id), Date.now())?.text;
  const actionOf = (id: number) => winNote(noteOf(id), Date.now())?.action;
  const phase = () => store.get(minerAtom).phase;
  const wins = () => store.get(minerAtom).wins;
  const mintedLines = () => store.get(minerAtom).ledger.filter((l) => l.kind === 'minted');
  const gate = () => {
    let open = () => {};
    const shut = new Promise<void>((r) => {
      open = r;
    });
    return { shut, open };
  };
  const spent =
    'couldn’t claim after 3 tries: the node keeps dropping blocks · the win stays claimable until epoch 3 closes';
  const lostLine = 'the node lost sight of it · checking the chain for your claim';

  test(
    'a pruned anchor: the same ticket is proved again, sent once, minted on its line; mining resumes',
    async () => {
      node.plans = [{ before: PRUNED }, { receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(said.get(id)).toContain('the node dropped the block it was reading · proving again, try 2 of 3');
      expect([node.attempts, node.sent.length, wins()]).toEqual([2, 1, 1]);
      await settle(() => mines() === 2);
      c.dispose();
    },
    T,
  );

  test(
    'three pruned anchors: nothing sent, the three-tries line with Retry, no fourth attempt while the checks go on; Retry is one more',
    async () => {
      node.plans = [{ before: PRUNED }, { before: PRUNED }, { before: PRUNED }, { receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === spent);
      expect(actionOf(id)).toBe('Retry');
      const reads = node.storageReads;
      await sleep(200);
      expect(node.storageReads).toBeGreaterThan(reads);
      expect([node.attempts, node.sent.length, mines(), phase()]).toEqual([3, 0, 1, 'idle']);
      expect(textOf(id)).toBe(spent);
      expect(await c.retryPendingClaim()).toBe(true);
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.attempts).toBe(4);
      c.dispose();
    },
    T,
  );

  test(
    'lost: a later receipt finds it in a block, adopted with no second send',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending', { block: 6 }] }];
      const c = await boot();
      const id = win();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(said.get(id)).toContain(lostLine);
      expect(node.sent).toHaveLength(1);
      expect(mintedLines()).toHaveLength(1);
      expect(mintedLines()[0]).toMatchObject({ links: { block: 6, tx: hashOf(1) } });
      expect(store.get(claimsAtom)).toHaveLength(1);
      await settle(() => mines() === 2);
      c.dispose();
    },
    T,
  );

  test(
    'lost, then dropped with its nullifier in the tree: the block is read with its transactions, adopted, no second send',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'dropped'] }];
      node.leaves.set(TICKET, 6);
      node.carried.set(6, [hashOf(1)]);
      const c = await boot();
      const id = win();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.sent).toHaveLength(1);
      expect(mintedLines()[0]).toMatchObject({ links: { block: 6 } });
      c.dispose();
    },
    T,
  );

  test(
    'the claim that closed its epoch, its effects missing: adopted, never "not claimed"; mining resumes on the epoch open now',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending', { block: 6 }] }];
      const c = await boot();
      const id = win();
      node.latest.open = 4n;
      node.checkpointed.open = 4n;
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(said.get(id)?.some((t) => t.startsWith('not claimed'))).toBe(false);
      await settle(() => mines() === 2);
      expect(minedEpoch()).toBe(4n);
      c.dispose();
    },
    T,
  );

  test(
    'dropped, absent, its epoch open: sent again; both sends are checked, each until its own expiry',
    async () => {
      const t0 = nowS();
      node.plans = [
        { receipts: [{ block: 5 }, 'dropped'], expiresAt: t0 + 100 },
        { receipts: [{ block: 8 }, 'dropped'], expiresAt: t0 + 600 },
      ];
      const c = await boot();
      const id = win();
      await settle(() => node.sent.length === 2 && noteOf(id)?.step === undefined);
      expect(said.get(id)).toContain('it didn’t land · sending again, try 2 of 3');
      // The epoch closes at the latest tip: the secret goes, mining goes on, both sends are watched.
      node.latest.open = 4n;
      await settle(() => mines() === 2 && textOf(id) === 'checking the chain for your claim');
      expect(minedEpoch()).toBe(4n);
      node.checkpointed.open = 4n;
      node.checkpointed.time = t0 + 300;
      await settle(() => textOf(id) === 'not claimed: the epoch closed before the claim landed');
      const read = () => [node.reads.get(hashOf(1)) ?? 0, node.reads.get(hashOf(2)) ?? 0];
      const before = read();
      await sleep(200);
      const [a, b] = read();
      expect(a).toBeGreaterThan(before[0] ?? 0);
      expect(b).toBeGreaterThan(before[1] ?? 0);
      // Past the later expiry at the checkpointed tip, neither can land: the watch ends.
      node.checkpointed.time = t0 + 700;
      await sleep(200);
      const done = read();
      await sleep(200);
      expect(read()).toEqual(done);
      expect(node.attempts).toBe(2);
      c.dispose();
    },
    T,
  );

  test(
    'the original lands after the second attempt: its collision settles nothing twice, the original is adopted',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending', 'dropped', { block: 7 }] }, { before: COLLISION }];
      const c = await boot();
      const id = win();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(said.get(id)).toEqual(
        expect.arrayContaining([
          lostLine,
          'it didn’t land · sending again, try 2 of 3',
          'checking the chain for your claim',
        ]),
      );
      expect([node.attempts, node.sent, wins(), mintedLines().length]).toEqual([2, [hashOf(1)], 1, 1]);
      expect(store.get(claimsAtom)).toHaveLength(1);
      c.dispose();
    },
    T,
  );

  test(
    'the second attempt refused at simulation while the original lands and closes the epoch: the original is adopted, never "not claimed"',
    async () => {
      const closes = gate();
      node.plans = [
        { receipts: [{ block: 5 }, 'pending', 'dropped', { block: 7 }] },
        { gate: closes.shut, before: NOT_OPEN },
      ];
      const c = await boot();
      const id = win();
      await settle(() => node.attempts === 2);
      node.latest.open = 4n;
      node.checkpointed.open = 4n;
      closes.open();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(said.get(id)?.some((t) => t.startsWith('not claimed'))).toBe(false);
      expect([wins(), node.sent.length]).toEqual([1, 1]);
      c.dispose();
    },
    T,
  );

  test(
    'every send expired, the epoch open: the ticket is sent again; nothing sent and the epoch closed only at the latest tip decides nothing until the checkpointed tip agrees',
    async () => {
      node.plans = [{ refused: EXPIRED, expiresAt: nowS() - 1 }, { receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect([node.attempts, node.sent.length, wins()]).toEqual([2, 2, 1]);
      c.dispose();

      // Nothing ever left: the three tries spent, then the version retires at the latest tip only.
      const s = new FakeNode(tickets);
      node = s;
      store = createStore();
      worker = new FakeWorker();
      s.plans = [{ before: PRUNED }, { before: PRUNED }, { before: PRUNED }];
      const c2 = await boot();
      const id2 = win();
      await settle(() => textOf(id2) === spent);
      s.latest.retired = true;
      await settle(() => mines() === 2 && textOf(id2) === 'checking the chain for your claim');
      await sleep(150);
      expect(textOf(id2)).toBe('checking the chain for your claim');
      s.checkpointed.retired = true;
      await settle(() => textOf(id2) === 'not claimed: the epoch closed before the claim went out');
      expect(s.sent).toHaveLength(0);
      c2.dispose();
    },
    T,
  );

  test(
    'its nullifier in the tree but the block gone, or served without it: unresolved, no attempt, no discard; adopted once the block carries it',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'dropped'] }];
      node.leaves.set(TICKET, 6);
      node.missing.add(6);
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === lostLine);
      await sleep(150);
      expect([node.attempts, phase(), mines(), textOf(id)]).toEqual([1, 'idle', 1, lostLine]);
      node.missing.delete(6);
      node.hollow.add(6);
      await sleep(150);
      expect([node.attempts, textOf(id)]).toEqual([1, lostLine]);
      node.hollow.delete(6);
      node.carried.set(6, [hashOf(1)]);
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.sent).toHaveLength(1);
      c.dispose();
    },
    T,
  );

  test(
    'a stale revert on record when the epoch reads closed: the revert recovery runs, not the closed-epoch path',
    async () => {
      let recovered = 0;
      node.plans = [{ receipts: [{ block: 5 }, 'pending', { block: 6, reverted: true }] }];
      const c = await boot({
        recover: async () => {
          recovered++;
          return { deployment: node.deployment(), fee, rebuilt: true };
        },
      });
      const id = win();
      node.latest.open = 4n;
      node.checkpointed.open = 4n;
      await settle(() => recovered === 1 && phase() === 'mining');
      expect(textOf(id)).toBe(
        "didn't land: the epoch closed first · the sponsor paid, your proof is unspent · re-syncing, about a minute",
      );
      expect(said.get(id)?.some((t) => t.startsWith('not claimed'))).toBe(false);
      expect(node.sent).toHaveLength(1);
      c.dispose();
    },
    T,
  );

  test(
    'a live send that reverts after its epoch closed at both tips: reported on its own line once the newer claim is done, then the revert recovery',
    async () => {
      let recovered = 0;
      const newer = gate();
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }, { gate: newer.shut, receipts: [{ block: 10 }] }];
      const c = await boot({
        recover: async () => {
          recovered++;
          return { deployment: node.deployment(), fee, rebuilt: true };
        },
      });
      const old = win();
      await settle(() => textOf(old) === lostLine);
      node.latest.open = 4n;
      node.checkpointed.open = 4n;
      await settle(
        () => textOf(old) === 'not claimed: the epoch closed before the claim landed' && mines() === 2,
      );
      const fresh = win({ ...WIN2, secretId: 2 });
      await settle(() => node.attempts === 2);
      node.script(hashOf(1), [{ block: 9, reverted: true }]);
      await sleep(300);
      expect([recovered, textOf(old)]).toEqual([0, 'not claimed: the epoch closed before the claim landed']);
      newer.open();
      await settle(() => noteOf(fresh)?.outcome === 'minted' && recovered === 1);
      expect(textOf(old)).toBe(
        "didn't land: the epoch closed first · the sponsor paid, your proof is unspent · re-syncing, about a minute",
      );
      await settle(() => phase() === 'mining');
      c.dispose();
    },
    T,
  );

  test(
    'its epoch closed while unresolved: mining resumes and the watch goes on; it adopts while a newer claim is in flight, leaving that claim alone, the win counted once',
    async () => {
      const newer = gate();
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }, { gate: newer.shut, receipts: [{ block: 10 }] }];
      const c = await boot();
      const old = win();
      await settle(() => textOf(old) === lostLine);
      node.latest.open = 4n;
      await settle(() => mines() === 2 && textOf(old) === 'checking the chain for your claim');
      expect(store.get(minerAtom).recovery).toMatchObject({ fore: null, watching: true });
      const fresh = win({ ...WIN2, secretId: 2 });
      await settle(() => node.attempts === 2);
      const inFlight = store.get(minerAtom);
      node.script(hashOf(1), [{ block: 9 }]);
      await settle(() => noteOf(old)?.outcome === 'minted');
      const s = store.get(minerAtom);
      expect([s.phase, s.job, s.claim, s.wins]).toEqual(['claiming', inFlight.job, inFlight.claim, 1]);
      newer.open();
      await settle(() => noteOf(fresh)?.outcome === 'minted');
      await sleep(100);
      expect([wins(), mintedLines().length, store.get(claimsAtom).length]).toEqual([2, 2, 2]);
      c.dispose();
    },
    T,
  );

  test(
    'Stop, then a watched or a waiting win lands: adopted, and no mining starts',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot();
      const old = win();
      await settle(() => textOf(old) === lostLine);
      // Stopped while it waits: it lands, mining stays off.
      c.stop();
      expect(textOf(old)).toBe('stopped · the win stays claimable until epoch 3 closes');
      node.script(hashOf(1), [{ block: 9 }]);
      await settle(() => noteOf(old)?.outcome === 'minted');
      await sleep(100);
      expect([mines(), phase()]).toEqual([1, 'idle']);
      c.dispose();

      // Watched after the resume's `mine` command, then Stop: it lands, mining stays off.
      node = new FakeNode(tickets);
      store = createStore();
      worker = new FakeWorker();
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c2 = await boot();
      const w = win();
      await settle(() => textOf(w) === lostLine);
      node.latest.open = 4n;
      await settle(() => mines() === 2);
      c2.stop();
      node.script(hashOf(1), [{ block: 9 }]);
      await settle(() => noteOf(w)?.outcome === 'minted');
      await sleep(100);
      expect([mines(), phase()]).toEqual([2, 'idle']);
      c2.dispose();
    },
    T,
  );

  test(
    'a pause while the next attempt waits defers it; the release runs it',
    async () => {
      const first = gate();
      node.plans = [{ gate: first.shut, before: PRUNED }, { receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      c.pause('hidden');
      first.open();
      await settle(() => noteOf(id)?.recover === 'anchor-pruned');
      await sleep(150);
      expect([node.attempts, phase()]).toEqual([1, 'idle']);
      c.release('hidden');
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.attempts).toBe(2);
      await settle(() => mines() === 2);
      c.dispose();
    },
    T,
  );

  test(
    'Start with a win waiting: the check first, and mining once it settles; with only a watch, mining at once',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === lostLine);
      c.stop();
      c.start();
      await sleep(150);
      expect([mines(), phase(), node.attempts]).toEqual([1, 'idle', 1]);
      node.script(hashOf(1), [{ block: 9 }]);
      await settle(() => noteOf(id)?.outcome === 'minted' && mines() === 2);
      await sleep(100);
      expect(mines()).toBe(2);
      c.dispose();

      node = new FakeNode(tickets);
      store = createStore();
      worker = new FakeWorker();
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c2 = await boot();
      const w = win();
      await settle(() => textOf(w) === lostLine);
      node.latest.open = 4n;
      await settle(() => mines() === 2);
      c2.stop();
      c2.start();
      expect(phase()).toBe('mining');
      await settle(() => mines() === 3);
      c2.dispose();
    },
    T,
  );

  test(
    'Stop while an attempt is scheduled: none is sent, Retry stays, nothing resumes',
    async () => {
      node.plans = [{ before: PRUNED }, { receipts: [{ block: 5 }] }];
      const c = await boot({ delay: (ms) => ms / 50 });
      const id = win();
      await settle(() => noteOf(id)?.recover === 'anchor-pruned');
      c.stop();
      expect([textOf(id), actionOf(id)]).toEqual([
        'stopped · the win stays claimable until epoch 3 closes',
        'Retry',
      ]);
      await sleep(300);
      expect([node.attempts, mines(), phase()]).toEqual([1, 1, 'idle']);
      expect(await c.retryPendingClaim()).toBe(true);
      await settle(() => noteOf(id)?.outcome === 'minted');
      await sleep(100);
      expect([mines(), phase()]).toEqual([1, 'idle']);
      c.dispose();
    },
    T,
  );

  test(
    'Stop, then Retry, then the win is found landed: adopted, and mining stays stopped as when it mints',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === lostLine);
      c.stop();
      expect(await c.retryPendingClaim()).toBe(true);
      node.script(hashOf(1), [{ block: 9 }]);
      await settle(() => noteOf(id)?.outcome === 'minted');
      await sleep(100);
      expect([mines(), phase(), node.sent.length]).toEqual([1, 'idle', 1]);
      c.dispose();
    },
    T,
  );

  test(
    'Stop, Retry, then the waiting win’s send reverts: the view is rebuilt, mining stays stopped',
    async () => {
      let recovered = 0;
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot({
        recover: async () => {
          recovered++;
          return { deployment: node.deployment(), fee, rebuilt: true };
        },
      });
      const id = win();
      await settle(() => textOf(id) === lostLine);
      c.stop();
      expect(await c.retryPendingClaim()).toBe(true);
      node.script(hashOf(1), [{ block: 9, reverted: true }]);
      await settle(() =>
        store
          .get(minerAtom)
          .ledger.some((l) => l.kind === 'epoch' && l.text === 'chain view rebuilt · notes recovered'),
      );
      await sleep(100);
      expect([recovered, mines(), phase()]).toEqual([1, 1, 'idle']);
      c.dispose();
    },
    T,
  );

  test.each([
    ['rebuilt', true],
    ['reopened', true],
    ['rebuilt', false],
    ['reopened', false],
  ] as const)(
    'Retry on a waiting win whose check finds a watched one reverted (view %s, Stop first: %p): mining comes back only without a Stop',
    async (view, stopFirst) => {
      node.plans = [
        { receipts: [{ block: 5 }, 'pending'] },
        { before: new Error('Circuit execution failed: x') },
        { receipts: [{ block: 12 }] },
      ];
      const c = await boot({
        recover: async () => ({ deployment: node.deployment(), fee, rebuilt: view === 'rebuilt' }),
        delay: (ms) => ms / 10,
      });
      const a = win();
      await settle(() => textOf(a) === lostLine);
      node.latest.open = 4n;
      await settle(() => mines() === 2 && phase() === 'mining');
      const b = win({ ...WIN2, secretId: 2 });
      await settle(() => actionOf(b) === 'Retry');
      if (stopFirst) c.stop();
      node.script(hashOf(1), [{ block: 9, reverted: true }]);
      expect(await c.retryPendingClaim()).toBe(true);
      // The reopened view waits out finality; its timer's release is what the test stands in for.
      if (view === 'reopened') {
        await settle(() => store.get(minerAtom).notice?.kind === 'paused');
        c.release('lost-race');
      }
      await settle(() => noteOf(b)?.outcome === 'minted');
      await sleep(100);
      expect([mines(), phase(), node.attempts]).toEqual(stopFirst ? [2, 'idle', 3] : [3, 'mining', 3]);
      c.dispose();
    },
    T,
  );

  test(
    'Stop with a win waiting, a pause, then Start: the Start is kept, its attempt runs at the release, then mining',
    async () => {
      node.plans = [{ before: PRUNED }, { receipts: [{ block: 5 }] }];
      const c = await boot({ delay: (ms) => ms / 50 });
      const id = win();
      await settle(() => noteOf(id)?.recover === 'anchor-pruned');
      c.stop();
      c.pause('offline');
      c.start();
      await sleep(150);
      expect([node.attempts, phase()]).toEqual([1, 'idle']);
      c.release('offline');
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.attempts).toBe(2);
      await settle(() => mines() === 2);
      c.dispose();
    },
    T,
  );

  test(
    'Stop while an attempt is under way: it sends and settles to idle, nothing resumes; a node switch meanwhile waits for it',
    async () => {
      const second = gate();
      node.plans = [{ before: PRUNED }, { gate: second.shut, receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      await settle(() => node.attempts === 2);
      c.stop();
      expect(store.get(minerAtom)).toMatchObject({ phase: 'claiming', stopping: true });
      c.pause('switch');
      let drained = false;
      const drain = c.drain().then(() => {
        drained = true;
      });
      await sleep(150);
      expect(drained).toBe(false);
      second.open();
      await drain;
      expect([noteOf(id)?.outcome, phase(), node.sent.length]).toEqual(['minted', 'idle', 1]);
      c.endSwitch();
      c.release('switch');
      await sleep(100);
      expect(mines()).toBe(1);
      c.dispose();
    },
    T,
  );

  describe.each(['getTxReceipt', 'findLeavesIndexes', 'getPublicStorageAt'] as const)(
    'a check held at %s',
    (method) => {
      test.each(['stop', 'switch', 'dispose'] as const)(
        'then %s: nothing new is scheduled and the phase settles',
        async (act) => {
          node.plans = [{ refused: EXPIRED }, { receipts: [{ block: 5 }] }];
          const c = await boot({ delay: (ms) => ms / 50 });
          const release = node.hold(method);
          win();
          await settle(() => node.waiting.has(method));
          let drained: Promise<void> | undefined;
          if (act === 'stop') c.stop();
          if (act === 'switch') {
            c.pause('switch');
            drained = c.drain();
          }
          if (act === 'dispose') c.dispose();
          release();
          await drained;
          await sleep(200);
          expect([node.attempts, mines(), phase()]).toEqual([1, 1, 'idle']);
          c.dispose();
        },
        T,
      );
    },
  );

  test(
    'a switch while a check lets a win go: the release still reaches the page, and mining resumes when the switch ends',
    async () => {
      node.plans = [{ before: PRUNED }, { before: PRUNED }, { before: PRUNED }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === spent);
      const release = node.hold('getPublicStorageAt@checkpointed');
      node.latest.open = 4n;
      await settle(() => node.waiting.has('getPublicStorageAt@checkpointed'));
      c.pause('switch');
      const drained = c.drain();
      release();
      await drained;
      expect(textOf(id)).toBe('checking the chain for your claim');
      c.endSwitch();
      c.release('switch');
      await settle(() => mines() === 2 && phase() === 'mining');
      c.dispose();
    },
    T,
  );

  test(
    'an unrecognised failure is not tried again by itself; Retry is one more attempt',
    async () => {
      node.plans = [{ before: new Error('Circuit execution failed: x') }, { receipts: [{ block: 5 }] }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === 'claim failed: Circuit execution failed: x · mining paused');
      expect(actionOf(id)).toBe('Retry');
      await sleep(150);
      expect([node.attempts, mines(), phase()]).toEqual([1, 1, 'idle']);
      expect(await c.retryPendingClaim()).toBe(true);
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.attempts).toBe(2);
      c.dispose();
    },
    T,
  );

  test(
    'Stop during a claim that fails: no attempt and no resume, not even through a hidden tab',
    async () => {
      const first = gate();
      node.plans = [{ gate: first.shut, refused: EXPIRED }];
      const c = await boot();
      const id = win();
      c.stop();
      c.pause('hidden');
      first.open();
      await settle(() => textOf(id) === 'stopped · the win stays claimable until epoch 3 closes');
      c.release('hidden');
      await sleep(150);
      expect([node.attempts, mines(), phase()]).toEqual([1, 1, 'idle']);
      c.dispose();
    },
    T,
  );

  test(
    'a pause that comes while a check reads: the attempt it finds due waits for the release',
    async () => {
      node.plans = [{ before: PRUNED }, { receipts: [{ block: 5 }] }];
      const release = node.hold('getPublicStorageAt@latest');
      const c = await boot();
      const id = win();
      await settle(() => node.waiting.has('getPublicStorageAt@latest'));
      c.pause('bridge');
      release();
      await sleep(150);
      expect([node.attempts, phase()]).toEqual([1, 'idle']);
      c.release('bridge');
      await settle(() => noteOf(id)?.outcome === 'minted');
      expect(node.attempts).toBe(2);
      c.dispose();
    },
    T,
  );

  test(
    'Stop while a watched win’s revert rebuilds the view: the rebuild finishes, mining stays stopped',
    async () => {
      const rebuild = gate();
      let recovered = 0;
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot({
        recover: async () => {
          recovered++;
          await rebuild.shut;
          return { deployment: node.deployment(), fee, rebuilt: true };
        },
      });
      const old = win();
      await settle(() => textOf(old) === lostLine);
      node.latest.open = 4n;
      await settle(() => mines() === 2 && phase() === 'mining');
      node.script(hashOf(1), [{ block: 9, reverted: true }]);
      await settle(() => recovered === 1);
      c.stop();
      rebuild.open();
      await settle(() =>
        store
          .get(minerAtom)
          .ledger.some((l) => l.kind === 'epoch' && l.text === 'chain view rebuilt · notes recovered'),
      );
      await sleep(100);
      expect([mines(), phase()]).toEqual([2, 'idle']);
      c.dispose();
    },
    T,
  );

  test(
    'the resume after a win let go reads first: a failed read mines nothing on the closed epoch, the next good poll resumes on the open one',
    async () => {
      node.plans = [{ before: PRUNED }, { before: PRUNED }, { before: PRUNED }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === spent);
      node.epochDown = true;
      node.latest.open = 4n;
      await settle(() => textOf(id) === 'checking the chain for your claim');
      await sleep(150);
      expect(mines()).toBe(1);
      node.epochDown = false;
      await (c as unknown as { poll(): Promise<void> }).poll();
      await settle(() => mines() === 2);
      expect(minedEpoch()).toBe(4n);
      c.dispose();
    },
    T,
  );

  test(
    'a switch while a check decides a watched win: nothing is decided across it, and the next check says not claimed',
    async () => {
      node.plans = [{ before: PRUNED }, { before: PRUNED }, { before: PRUNED }];
      const c = await boot();
      const id = win();
      await settle(() => textOf(id) === spent);
      node.latest.open = 4n;
      await settle(() => mines() === 2 && textOf(id) === 'checking the chain for your claim');
      const release = node.hold('getPublicStorageAt@checkpointed');
      node.checkpointed.open = 4n;
      await settle(() => node.waiting.has('getPublicStorageAt@checkpointed'));
      c.pause('switch');
      const drained = c.drain();
      release();
      await drained;
      expect(textOf(id)).toBe('checking the chain for your claim');
      c.endSwitch();
      c.release('switch');
      await settle(() => textOf(id) === 'not claimed: the epoch closed before the claim went out');
      c.dispose();
    },
    T,
  );

  test(
    'a browser clock ahead of the chain: a send pending before its expiry in chain time is never sent again',
    async () => {
      const t0 = nowS();
      node.plans = [
        { receipts: [{ block: 5 }, 'pending'], expiresAt: t0 + 600 },
        { receipts: [{ block: 8 }] },
      ];
      const c = await boot();
      const real = Date.now;
      Date.now = () => real() + 20 * 60_000;
      try {
        const id = win();
        await settle(() => textOf(id) === lostLine);
        await sleep(200);
        expect([node.attempts, node.sent.length]).toEqual([1, 1]);
      } finally {
        Date.now = real;
      }
      c.dispose();
    },
    T,
  );

  test(
    'a check’s read past its deadline counts as unknown; a switch still drains the read itself',
    async () => {
      node.plans = [{ receipts: [{ block: 5 }, 'pending'] }];
      const c = await boot({ deadline: 50 });
      const id = win();
      await settle(() => textOf(id) === lostLine);
      const release = node.hold('findLeavesIndexes@latest');
      await settle(() => node.waiting.has('findLeavesIndexes@latest'));
      await sleep(100);
      c.pause('switch');
      let drained = false;
      const drain = c.drain().then(() => {
        drained = true;
      });
      await sleep(150);
      expect(drained).toBe(false);
      release();
      await drain;
      c.dispose();
    },
    T,
  );
});
