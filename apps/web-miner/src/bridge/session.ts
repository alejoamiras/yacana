// The bridge as the open account sees it: its journal (the store, mirrored into an atom), the
// portal's standing and the flip verdict read through the Ethereum RPC, the arrivals waiting for
// it, and the operations the sheets call. One instance per open account, started with it and
// stopped with it; nothing sends or claims on its own — every crossing begins with a tap.
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { getEpochAtSlot } from '@aztec-labs/stdlib/epoch-helpers';
import { siloNullifier } from '@aztec-labs/stdlib/hash';
import type { AztecNode } from '@aztec-labs/stdlib/interfaces/client';
import { Tag } from '@aztec-labs/stdlib/logs';
import { computeFeeJuiceMessageNullifier } from '@aztec-labs/stdlib/messaging';
import { MerkleTreeId } from '@aztec-labs/stdlib/trees';
import { TxHash } from '@aztec-labs/stdlib/tx';
import {
  checkpointProven,
  epochProven,
  proofDeadline,
  type RollupReads,
  rollupReads,
} from '@yacana/bridge/deadline';
import { readDeadline } from '@yacana/bridge/exit-deadline';
import { flipVerdict } from '@yacana/bridge/flip';
import { claimLeaf } from '@yacana/bridge/inbox';
import {
  advance,
  type Crossing,
  destinationOf,
  type Facts,
  hashless,
  inFlight,
  type RowState,
  rowState,
} from '@yacana/bridge/journal';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { type ProofFloor, type ProofReader, type ProofReading, proofReader } from '@yacana/bridge/proofs';
import { OperationQueue } from '@yacana/bridge/queue';
import type { BridgeRecord } from '@yacana/bridge/record';
import { asHint, parseRecoveryFile, type RecoveryFile, recoveryFile } from '@yacana/bridge/recovery';
import { exitLogTag } from '@yacana/bridge/secrets';
import { leafIdOf } from '@yacana/bridge/signatures';
import {
  type ArchivedExit,
  archiveEntry,
  type ExitScope,
  exitMessageContent,
  fetchWitness,
  forwardArgsFromArchive,
  outboxLeaf,
  type RecordedExit,
  readArchive,
  verifiedArchiveEntry,
} from '@yacana/bridge/witness';
import { nodeHealth } from '@yacana/web-kit/browser/node-health';
import type { createStore } from 'jotai';
import {
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  parseEventLogs,
  TransactionReceiptNotFoundError,
} from 'viem';
import { readBalanceSnapshot, saveBalanceSnapshot } from '../bridge/snapshot.ts';
import type { Connection } from '../config';
import { fingerprintOf } from '../keys/classes';
import {
  type BridgeView,
  bridgeAtom,
  type ClaimRecord,
  claimingAtom,
  claimsAtom,
  crossingProversAtom,
  journalAtom,
  rowStatesAtom,
  type VersionFacts,
} from '../state';
import type { ProverSaid } from '../wallet.ts';
import { servedBuild, staleTab } from './env.ts';
import {
  depositCall,
  forwardCall,
  type PortalReader,
  portalReader,
  type WagmiConfig,
  wagmiConfigFor,
} from './eth.ts';
import { type PayerFunds, payerFunds } from './eth-balance.ts';
import { type FactReads, factsFor } from './facts.ts';
import {
  claimArrival,
  deposit,
  exitToL1,
  type L2Handles,
  nextIndexFromChain,
  redeem,
  secretsFor,
  selfForward,
  sendAhead,
} from './flows.ts';
import { arrivalCandidates, landed, matchArrivals, twinOf } from './landing.ts';
import { type BridgeStore, openBridgeStore, SCAN_WINDOW } from './store.ts';

type Store = ReturnType<typeof createStore>;

export interface BridgeSessionDeps {
  store: Store;
  node: AztecNode;
  /** The wallet and the contracts as they stand now; a rebuilt chain view replaces them under the session. */
  l2: () => L2Handles;
  from: AztecAddress;
  master: Uint8Array;
  connection: Connection;
  record: BridgeRecord;
  /** The miner's pause around a proof, and the wait for a claim the pause let finish; absent on the old app, which mines nothing. */
  controller?: {
    pause(reason: 'bridge'): void;
    release(reason: 'bridge'): void;
    claimSettled(): Promise<void>;
  };
  now?: () => number;
}

const REFRESH_MS = 15_000;
/** Mints asked about per refresh, newest first; the batch rotates so every open one is reached. */
const SETTLE_AT_MOST = 8;
/** Other versions read per refresh: a journal is the user's, and a recovery file can name any number. */
const VERSIONS_AT_MOST = 2;

/** `n` items from `from` (wrapping), so consecutive calls walk the whole list. */
export function rotate<T>(items: readonly T[], from: number, n: number): T[] {
  if (!items.length) return [];
  const start = from % items.length;
  return [...items.slice(start), ...items.slice(0, start)].slice(0, n);
}
/** One refresh reads each chain's clock once: every deadline in it is measured against one sample. */
const CLOCK_MS = 2_000;
/** The portal's events are scanned again every so many refreshes: a forward by Yacana lands while the page is open. */
const LANDING_EVERY = 4;

/** A crossing after one reading, and whether that reading answered: a failure is not a fact. */
interface Reread {
  crossing: Crossing;
  read: 'answered' | 'failed';
}

/** The archive the site serves for `version`, or null when it serves none (a 404, or no site). */
async function fetchArchive(version: string): Promise<string | null> {
  const root = (import.meta.env.BASE_URL ?? '/').replace(/\/mine\/?$/, '/');
  try {
    const res = await fetch(`${root}witnesses/${version}.jsonl`, { cache: 'no-store' });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  }
}
/** One scan derives at most this many indices per version, whatever a file or a counter claims. */
const MAX_LANDING_INDICES = 2_000;

/**
 * What a holder is about to pay for, so the wallet's ETH can be read against it first. A
 * send-ahead's forward and its redeem are left out on purpose: the portal takes those from anyone
 * who carries the redeem key's signature, so making one to price a button would hand the RPC the
 * authority to forward or redeem before the holder chose. Their cost stays unknown.
 */
export type PayerAsk = { kind: 'deposit'; amount: bigint } | { kind: 'claim'; crossing: Crossing };

export class BridgeSession {
  readonly config: WagmiConfig;
  readonly reader: PortalReader;
  private readonly client: PublicClient;
  private readonly ctx: Parameters<typeof sendAhead>[0];
  private readonly journal: BridgeStore;
  private readonly reads: FactReads;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  private constants: Promise<{ epochDuration: number }> | undefined;
  private l1Clock: { at: number; value: Promise<bigint> } | undefined;
  private readonly rollups = new Map<string, Promise<RollupReads>>();
  /** The served witness archives by version, kept once read; a miss is asked for again next refresh. */
  private readonly archives = new Map<string, Promise<ArchivedExit[]>>();
  private readonly scope: ExitScope;
  private readonly proofs: ProofReader;
  /** The portal's `EXIT_FLOOR`, immutable: read once. */
  private floor: Promise<bigint> | undefined;
  /** The proof scan's floor, read once: the Registry's canonical block, or the portal's deploy block as a bound. */
  private canonicalFloor: Promise<ProofFloor> | undefined;
  /** Registration times by version, once seen: a registration never moves. */
  private readonly registeredAt = new Map<string, bigint>();
  private refreshes = 0;
  private settleFrom = 0;
  private versionsFrom = 0;
  private closed = false;
  private suspended = false;

  private constructor(
    private readonly d: BridgeSessionDeps,
    owner: string,
  ) {
    const chainId = Number(d.record.chainId);
    const client = createPublicClient({ transport: http(d.connection.ethRpcUrl, { retryCount: 0 }) });
    this.client = client;
    this.config = wagmiConfigFor({
      chainId,
      rpcUrl: d.connection.ethRpcUrl,
      ...(import.meta.env.VITE_L1_EXPLORER_URL !== 'off'
        ? { explorerUrl: import.meta.env.VITE_L1_EXPLORER_URL }
        : {}),
    });
    this.reader = portalReader(client, {
      portal: d.record.portal as Hex,
      registry: d.record.registry as Hex,
      deployBlock: BigInt(d.record.deployBlock ?? 0),
    });
    this.journal = openBridgeStore({ chainId: d.record.chainId, portal: d.record.portal as Hex, owner });
    this.ctx = {
      node: d.node,
      l2: d.l2,
      from: d.from,
      master: d.master,
      chainId: BigInt(d.record.chainId),
      version: BigInt(import.meta.env.VITE_ROLLUP_VERSION),
      portal: d.record.portal as Hex,
      yaca: d.record.yaca as Hex,
      store: this.journal,
      queue: new OperationQueue(),
      ...(d.controller
        ? {
            pause: (r: 'bridge') => d.controller?.pause(r),
            release: (r: 'bridge') => d.controller?.release(r),
            settled: async () => await d.controller?.claimSettled(),
          }
        : {}),
      l1Now: () => this.l1Now(),
      preflight: () => this.preflight(),
      proved: (id, prover) => d.store.set(crossingProversAtom, (m) => new Map(m).set(id, prover)),
      ...(d.now ? { now: d.now } : {}),
    };
    this.rollups.set(
      this.ctx.version.toString(),
      Promise.resolve(rollupReads(client, import.meta.env.VITE_ROLLUP_ADDRESS as Hex)),
    );
    this.scope = {
      chainId: this.ctx.chainId,
      rollupVersion: this.ctx.version,
      miner: d.l2().miner.address,
      portal: EthAddress.fromString(d.record.portal),
    };
    this.reads = this.factReads(this.scope);
    this.proofs = proofReader(client, {
      rollup: import.meta.env.VITE_ROLLUP_ADDRESS as Hex,
      floor: () => this.proofFloor(),
    });
  }

  /**
   * Where the scan may stop. The Registry's own record of this version becoming canonical is below
   * every proof of it; the portal's deploy block is only a bound (the portal may have been deployed
   * after a proof), so a scan that exhausts it says "unknown", never "no proof".
   */
  private proofFloor(): Promise<ProofFloor> {
    this.canonicalFloor ??= this.reader
      .canonicalAt(this.ctx.version)
      .then((block) =>
        block === undefined
          ? { block: BigInt(this.d.record.deployBlock ?? 0), exact: false }
          : { block, exact: true },
      )
      .catch((e: unknown) => {
        this.canonicalFloor = undefined;
        throw e;
      });
    return this.canonicalFloor;
  }

  private exitFloor(): Promise<bigint> {
    this.floor ??= this.reader.policy().then(
      (p) => p.exitFloor,
      (e: unknown) => {
        this.floor = undefined;
        throw e;
      },
    );
    return this.floor;
  }

  /**
   * Unix seconds the canonical version was registered on the portal: what a held send-ahead's
   * "longer than usual" counts from. Read for whichever version is canonical, this build's
   * included — the next version's own page is where a send-ahead from the last one lands.
   */
  private async targetRegisteredAt(canonical: bigint): Promise<bigint | undefined> {
    const key = canonical.toString();
    const known = this.registeredAt.get(key);
    if (known !== undefined) return known;
    const at = await this.reader.registeredAt(canonical);
    if (at !== undefined) this.registeredAt.set(key, at);
    return at;
  }

  /**
   * The connected wallet's ETH against the call it is about to make, on this session's RPC: read
   * before the wallet is asked, and again on the click, so the page says "no ETH for the gas"
   * itself. A call that cannot be built or estimated leaves the cost unknown, never zero.
   */
  async payerFunds(account: Hex, ask: PayerAsk): Promise<PayerFunds> {
    const call = await this.payerCall(ask).catch(() => undefined);
    return payerFunds(this.config, account, call);
  }

  private async payerCall(ask: PayerAsk) {
    const portal = this.ctx.portal;
    if (ask.kind === 'deposit') {
      // The portal stores the secret hash without reading it, so any 32 non-zero bytes price the
      // same: the cheapest word would understate the calldata gas, this one does not.
      const deadline = (await this.l1Now()) + 3600n;
      const secretHash = `0x${'11'.repeat(32)}` as Hex;
      return depositCall({ portal, amount: ask.amount, secretHash, version: this.ctx.version, deadline });
    }
    const c = ask.crossing;
    if (!c.witness || c.kind !== 1) throw new Error('nothing to claim on Ethereum');
    // An exit's claim carries no signature: anyone may forward it, so pricing it authorises nothing.
    const args = forwardArgsFromArchive(c.witness);
    return forwardCall({ portal, version: BigInt(c.version), args });
  }

  /** The Rollup of a crossing's own version: this build's from its record, an earlier one's from the Registry. */
  private rollupFor(version: string): Promise<RollupReads> {
    let r = this.rollups.get(version);
    if (!r) {
      r = this.reader.rollupOf(BigInt(version)).then((address) => rollupReads(this.client, address));
      r.catch(() => this.rollups.delete(version));
      this.rollups.set(version, r);
    }
    return r;
  }

  /** The record's own version is the one this build's node serves; an earlier version's chain is not here. */
  private servesVersion(c: Crossing): boolean {
    return BigInt(c.version) === this.ctx.version;
  }

  /**
   * The send's log by the tag the master derives: a record that lost its hash (the page closed
   * after the send) is named again by the chain, and the hash rejoins the journal.
   */
  private async txByTag(c: Crossing): Promise<Facts['tx']> {
    const secrets = await secretsFor(this.ctx, c.index, BigInt(c.version));
    const tag = new Tag(await exitLogTag(c.kind === 1 ? secrets.tag : secrets.secretHash));
    const [logs] = await this.d.node.getPublicLogsByTags({
      contractAddress: this.d.l2().miner.address,
      tags: [tag],
    });
    const log = logs?.[0];
    if (!log) return undefined;
    const block = Number(log.blockNumber);
    return {
      status: 'mined',
      block,
      epoch: (await this.epochOfBlock(block)).toString(),
      txHash: log.txHash.toString(),
    };
  }

  /**
   * An earlier version's witness from the archive the site serves (`/witnesses/<version>.jsonl`,
   * committed by the operator once the exits settled): the only source once that version's node is
   * gone. The leaf names that version's own miner, the one the portal registered for it, not this
   * build's; the entry is believed only once its fold reaches that version's Outbox root. A miss
   * drops the cached file, so a republished archive is read at the next refresh.
   */
  private async archivedWitness(c: Crossing): Promise<ArchivedExit | undefined> {
    if (c.kind === 3) return undefined;
    const version = BigInt(c.version);
    const [entries, scope, secrets] = await Promise.all([
      this.archiveEntries(c.version),
      this.sourceScope(c.version),
      secretsFor(this.ctx, c.index, version),
    ]);
    const aux = (c.kind === 1 ? secrets.tag : secrets.secretHash).toString() as Hex;
    const entry = await verifiedArchiveEntry(entries, { ...c, kind: c.kind }, aux, scope, (epoch, n) =>
      this.reader.outboxRoot(version, epoch, n),
    );
    if (!entry) this.archives.delete(c.version);
    return entry;
  }

  /** The leaf scope of a crossing's own version: its miner is the one the portal registered for it, not this build's. */
  private async sourceScope(version: string): Promise<ExitScope> {
    const standing = await this.reader.standing(BigInt(version));
    return {
      ...this.scope,
      rollupVersion: BigInt(version),
      miner: AztecAddress.fromStringUnsafe(standing.miner),
    };
  }

  /** The served archive's entries, parsed once and kept until a lookup misses. */
  private archiveEntries(version: string): Promise<ArchivedExit[]> {
    const cached = this.archives.get(version);
    if (cached) return cached;
    const entries = fetchArchive(version).then((text) => (text === null ? [] : readArchive(text)));
    entries.catch(() => this.archives.delete(version));
    this.archives.set(version, entries);
    return entries;
  }

  /** For a version no node serves: a verified archive entry names the epoch of a send that lost it; the hash stays the record's. */
  private async txFromArchive(c: Crossing): Promise<Facts['tx']> {
    const w = await this.archivedWitness(c);
    return w ? { status: 'mined', epoch: w.epoch } : undefined;
  }

  /** The exit as the miner logged it, with the aux the master re-derives: the tag (K1) or the secret hash (K2). */
  private async recordedExit(c: Crossing): Promise<RecordedExit> {
    const secrets = await secretsFor(this.ctx, c.index, BigInt(c.version));
    return {
      index: c.index,
      kind: c.kind as 1 | 2,
      amount: BigInt(c.amount),
      aux: (c.kind === 1 ? secrets.tag : secrets.secretHash).toString() as Hex,
      recipientOrRedeemKey: c.ethAddress,
      txHash: c.txHash as string,
    };
  }

  /** The siloed nullifier the miner's claim of this message leaves in the tree. */
  private async claimNullifier(
    c: Crossing,
    scope: ExitScope,
  ): Promise<import('@aztec-labs/foundation/curves/bn254').Fr> {
    const secrets = await secretsFor(this.ctx, c.index, BigInt(c.version));
    const leaf = claimLeaf(scope, BigInt(c.amount), secrets.secretHash, BigInt(c.inboxIndex as string));
    return siloNullifier(scope.miner, await computeFeeJuiceMessageNullifier(leaf, secrets.secret));
  }

  /** Each source of a crossing's facts behind one function: the node, the rollup, the portal, the destination. */
  private factReads(scope: ExitScope): FactReads {
    const d = this.d;
    const witnessLeaf = (c: Crossing) =>
      c.witness
        ? {
            epoch: BigInt(c.witness.epoch),
            leafId: leafIdOf({ path: c.witness.path, leafIndex: BigInt(c.witness.leafIndex) }),
          }
        : undefined;
    return {
      tx: async (c) => {
        if (!this.servesVersion(c)) return this.txFromArchive(c);
        if (!c.txHash) return this.txByTag(c);
        // Both read before the receipt, because both are what makes a missing one mean anything: a
        // hash the node does not hold reads as dropped, and that covers one a block could still
        // take and one whose block this node never had. Read afterwards, the tip could be past an
        // expiry the send made it under, and a send included in between would be called dropped.
        const [expired, served] = await Promise.all([this.pastExpiry(c), this.servesHistory(c)]);
        const r = await d.node.getTxReceipt(TxHash.fromString(c.txHash));
        if (r.status === 'dropped') return expired && served ? { status: 'dropped' } : undefined;
        if (r.status === 'pending') return { status: 'pending' };
        const block = Number(r.blockNumber ?? 0);
        return { status: 'mined', block, epoch: (await this.epochOfBlock(block)).toString() };
      },
      epochOfBlock: async (c, block) =>
        this.servesVersion(c) ? (await this.epochOfBlock(block)).toString() : undefined,
      proofDeadline: async (c, epoch) => proofDeadline(await this.rollupFor(c.version), epoch),
      // A block settles with its checkpoint; the epoch's number alone says a proof of the epoch began to land.
      epochProven: async (c, epoch) => {
        const rollup = await this.rollupFor(c.version);
        if (!this.servesVersion(c) || c.block === undefined) return epochProven(rollup, epoch);
        const checkpoint = await this.checkpointOfBlock(c.block, c.txHash);
        // A transaction the node no longer holds is not proven whatever the epoch says: the deadline names what it was.
        if (checkpoint === 'gone') return false;
        if (checkpoint === 'unknown') return epochProven(rollup, epoch);
        if (typeof checkpoint === 'object') {
          // Its epoch and deadline are read again from the new block at the next refresh.
          await this.journal.update(c.id, (s) => ({
            ...s,
            block: checkpoint.moved,
            epoch: undefined,
            proofDeadline: undefined,
          }));
          return false;
        }
        return checkpointProven(rollup, checkpoint);
      },
      witness: async (c) => {
        if (!this.servesVersion(c)) return this.archivedWitness(c);
        const exit = await this.recordedExit(c);
        const leaf = outboxLeaf(
          { ...scope, rollupVersion: BigInt(c.version) },
          exitMessageContent(exit, EthAddress.fromString(exit.recipientOrRedeemKey)),
        );
        const w = await fetchWitness(d.node, exit.txHash, leaf);
        return w ? archiveEntry(BigInt(c.version), exit, w) : undefined;
      },
      portal: async (c) => {
        const standing = await this.reader.standing(BigInt(c.version));
        const canonical = await this.reader.canonical();
        const target =
          canonical.version === BigInt(c.version) ? undefined : await this.reader.standing(canonical.version);
        return {
          paused: standing.paused,
          hasHeadroom: standing.headroom >= BigInt(c.amount),
          deadlinePassed: (await this.l1Now()) > standing.deadline,
          canonicalIsNewer: canonical.index > standing.registryIndex,
          ...(target ? { canonicalRegistered: target.registered } : {}),
        };
      },
      forwarded: async (c) => {
        const w = witnessLeaf(c);
        if (!w) return undefined;
        const f = await this.reader.forwarded(BigInt(c.version), w.epoch, w.leafId);
        return f
          ? { txHash: f.txHash, inboxIndex: f.inboxIndex.toString(), target: f.target.toString() }
          : undefined;
      },
      redeemed: async (c) => {
        const w = witnessLeaf(c);
        return w ? this.reader.redeemed(BigInt(c.version), w.epoch, w.leafId) : undefined;
      },
      messageReady: async (c) => {
        if (!c.inboxIndex || !this.landsHere(c)) return false;
        const secrets = await secretsFor(this.ctx, c.index, BigInt(c.version));
        const leaf = claimLeaf(scope, BigInt(c.amount), secrets.secretHash, BigInt(c.inboxIndex));
        return (await d.node.getL1ToL2MessageMembershipWitness('latest', leaf)) !== undefined;
      },
      claimed: async (c) => {
        if (!c.inboxIndex || !this.landsHere(c)) return undefined;
        const [leaf] = await d.node.findLeavesIndexes('latest', MerkleTreeId.NULLIFIER_TREE, [
          await this.claimNullifier(c, scope),
        ]);
        return leaf ? { txHash: c.claimTxHash ?? '', block: Number(leaf.l2BlockNumber) } : undefined;
      },
      l1Tx: (c) => this.depositReceipt(c),
      nowSeconds: () => this.l1Now(),
    };
  }

  /**
   * A deposit's receipt on Ethereum: the Inbox message it made, a revert, "not yet" — or
   * `unreadable`, which is none of those. The event must be this deposit's: the portal's own log,
   * for this version and amount, under the secret hash this index derives. A receipt that names
   * something else leaves the record where it is.
   */
  private async depositReceipt(c: Crossing): Promise<Awaited<ReturnType<FactReads['l1Tx']>>> {
    if (!c.l1TxHash) return undefined;
    let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>;
    try {
      receipt = await this.client.getTransactionReceipt({ hash: c.l1TxHash });
    } catch (e) {
      // Only "no such receipt" is an answer; anything else (no RPC, a refused request) is not.
      return e instanceof TransactionReceiptNotFoundError ? undefined : 'unreadable';
    }
    if (receipt.status !== 'success') return { status: 'reverted' };
    const secrets = await secretsFor(this.ctx, c.index, BigInt(c.version));
    const mine = parseEventLogs({
      abi: yacanaPortalAbi,
      eventName: 'Deposited',
      logs: receipt.logs,
    }).find(
      (l) =>
        l.address.toLowerCase() === this.ctx.portal.toLowerCase() &&
        l.args.secretHash.toLowerCase() === secrets.secretHash.toString().toLowerCase() &&
        l.args.version === BigInt(c.version) &&
        l.args.amount === BigInt(c.amount),
    );
    return mine ? { status: 'mined', inboxIndex: mine.args.inboxIndex.toString() } : 'unreadable';
  }

  /** Whether the crossing's destination is this build's version: only its own node can see the claim. */
  private landsHere(c: Crossing): boolean {
    const destination = destinationOf(c);
    return destination !== undefined && BigInt(destination) === this.ctx.version;
  }

  /**
   * Ethereum's clock: the latest block's timestamp, which the portal measures every deadline and
   * signature expiry against. The device's clock is not consulted: a chain whose clock runs ahead
   * of the device's would refuse every signature dated from the device.
   */
  private l1Now(): Promise<bigint> {
    if (this.d.now) return Promise.resolve(BigInt(Math.floor(this.d.now() / 1000)));
    const at = Date.now();
    if (!this.l1Clock || at - this.l1Clock.at > CLOCK_MS) {
      const value = this.client.getBlock({ blockTag: 'latest' }).then((b) => b.timestamp);
      value.catch(() => {
        if (this.l1Clock?.value === value) this.l1Clock = undefined;
      });
      this.l1Clock = { at, value };
    }
    return this.l1Clock.value;
  }

  /** One per open account: the journal is keyed by the master's fingerprint. */
  static async open(d: BridgeSessionDeps): Promise<BridgeSession> {
    return new BridgeSession(d, await fingerprintOf(d.master));
  }

  private async epochOfBlock(block: number): Promise<bigint> {
    this.constants ??= this.d.node.getL1Constants();
    const { epochDuration } = await this.constants;
    const b = await this.d.node.getBlock(block as never);
    if (!b) throw new Error(`block ${block} is not on this node`);
    return BigInt(getEpochAtSlot(b.header.globalVariables.slotNumber, { epochDuration }));
  }

  /**
   * The checkpoint a block was proposed in, what the rollup's proof covers one checkpoint at a
   * time; `gone` when the node no longer holds the transaction there (pruned, or reorganised out),
   * `unknown` when it has nothing to say yet (behind, or a claim without its hash).
   */
  private async checkpointOfBlock(
    block: number,
    txHash?: string,
  ): Promise<bigint | 'gone' | 'unknown' | { moved: number }> {
    if (txHash) {
      const r = await this.d.node.getTxReceipt(TxHash.fromString(txHash));
      if (r.status === 'dropped') return 'gone';
      if (r.status === 'pending' || r.blockNumber === undefined) return 'unknown';
      // Re-included at another height after a reorganisation: the record follows its transaction.
      if (Number(r.blockNumber) !== block) return { moved: Number(r.blockNumber) };
    }
    const b = await this.d.node.getBlock(block as never);
    if (!b) return 'unknown';
    return BigInt((b as unknown as { checkpointNumber: bigint | number }).checkpointNumber);
  }

  /** Lists the journal, reads the standing, scans arrivals once, then refreshes every 15 s. */
  async start(): Promise<void> {
    await this.publishJournal();
    try {
      await this.refresh();
    } finally {
      this.schedule();
    }
  }

  /** The refresh timer, unless the session is closed or suspended meanwhile (a start is asynchronous). */
  private schedule(): void {
    if (this.closed || this.suspended) return;
    this.timer ??= setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private unschedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Closed for good: no refresh runs after this, and no resume brings it back. */
  stop(): void {
    this.closed = true;
    this.unschedule();
    this.d.store.set(crossingProversAtom, new Map());
  }

  /** Resolves once every operation queued so far has settled: what a sign-out waits for before the page goes. */
  drain(): Promise<void> {
    return this.ctx.queue.drain();
  }

  /**
   * A node switch's freeze: new operations are refused with `reason`, the refreshes stop, and what is
   * out (operations, a refresh) is waited for, so no reading or signing straddles two nodes.
   */
  async suspend(reason: string): Promise<void> {
    this.ctx.queue.refuse(reason);
    this.suspended = true;
    this.unschedule();
    await this.ctx.queue.drain();
    await this.refreshing?.catch(() => {});
  }

  /** The switch is over: operations and the refreshes again (unless closed meanwhile). */
  resume(): void {
    this.ctx.queue.refuse(null);
    this.suspended = false;
    this.schedule();
  }

  private async publishJournal(): Promise<Crossing[]> {
    const list = (await this.journal.list()).sort((a, b) => b.createdAt - a.createdAt);
    this.d.store.set(journalAtom, list);
    this.forgetProvers(list);
    return list;
  }

  /** An answer outlives its proof only while its crossing still proves or claims. */
  private forgetProvers(list: readonly Crossing[]): void {
    const { store } = this.d;
    const held = store.get(crossingProversAtom);
    const proving = new Set(list.filter((c) => c.state === 'proving').map((c) => c.id));
    const keep = (id: string) => proving.has(id) || store.get(claimingAtom).has(id);
    const kept = new Map([...held].filter(([id]) => keep(id)));
    if (kept.size !== held.size) store.set(crossingProversAtom, kept);
  }

  /** The portal's standing and the flip verdict, then every in-flight crossing's next reading. */
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshImpl().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refreshImpl(): Promise<void> {
    const now = this.d.now?.() ?? Date.now();
    const version = this.ctx.version;
    const prev = this.d.store.get(bridgeAtom);
    let view: BridgeView;
    try {
      // One L1 block for the deadline: a transition recorded or a pause lifted between these reads
      // would make a standing that never was, and disagree with the portal's own `deadline()`.
      const block = await this.client.getBlock({ blockTag: 'latest' });
      const [standing, canonical, retired, floor] = await Promise.all([
        this.reader.standing(version, block.number ?? undefined),
        this.reader.canonical(),
        this.minerRetired(),
        this.exitFloor(),
      ]);
      const versions = await this.otherVersions(block, floor, prev.versions);
      view = {
        verdict: flipVerdict({
          buildVersion: version,
          registryCanonical: canonical.version,
          minerRetired: retired,
          nodeVersion: null,
        }),
        standing,
        canonical,
        deadline: readDeadline({ ...standing, floor, l1Now: block.timestamp }),
        versions,
        readAt: now,
        rpcFailing: false,
        // Best effort, kept from the last refresh when unread: neither says whether the RPC answers.
        targetRegisteredAt:
          (await this.targetRegisteredAt(canonical.version).catch(() => undefined)) ??
          (prev.canonical?.version === canonical.version ? prev.targetRegisteredAt : undefined),
        proof: await this.proofs.latestProvenAt().catch((): ProofReading => prev.proof ?? 'unknown'),
      };
    } catch {
      view = { ...prev, rpcFailing: true };
    }
    this.d.store.set(bridgeAtom, view);
    if (view.rpcFailing) return;
    if (this.refreshes++ % LANDING_EVERY === 0) await this.landing().catch(() => {});
    this.d.store.set(rowStatesAtom, await this.rowStates(now));
    await this.publishJournal();
    await this.settleMiningClaims();
  }

  /**
   * The standing and deadline of the other versions the journal holds a crossing under way of, in
   * the same L1 block as this version's, a few per refresh; a version not read this time, or whose
   * read fails, keeps its last reading.
   */
  private async otherVersions(
    block: { number: bigint | null; timestamp: bigint },
    floor: bigint,
    prev: BridgeView['versions'],
  ): Promise<BridgeView['versions']> {
    const own = this.ctx.version.toString();
    // A completed row needs no live deadline: only the versions with a crossing under way count.
    const versions = [...new Set((await this.journal.list()).filter(inFlight).map((c) => c.version))].filter(
      (v) => v !== own,
    );
    const out: Record<string, VersionFacts> = {};
    for (const v of versions) if (prev?.[v]) out[v] = prev[v];
    const batch = rotate(versions, this.versionsFrom, VERSIONS_AT_MOST);
    this.versionsFrom += VERSIONS_AT_MOST;
    const read = async (v: string): Promise<[string, VersionFacts | undefined]> => [
      v,
      await this.reader
        .standing(BigInt(v), block.number ?? undefined)
        .then((standing) => ({
          standing,
          deadline: readDeadline({ ...standing, floor, l1Now: block.timestamp }),
        }))
        .catch(() => prev?.[v]),
    ];
    for (const [v, facts] of await Promise.all(batch.map(read))) if (facts) out[v] = facts;
    return out;
  }

  /**
   * Whether every block that could still carry the send is built: the sequencer refuses a
   * transaction whose expiry is below the block it would build, so a tip past it settles the
   * question. A record with no expiry recorded carries no evidence either way, and is never past.
   */
  private async pastExpiry(c: Crossing): Promise<boolean> {
    if (!c.expiresAt) return false;
    const at = await this.sourceTipAt();
    return at !== null && at > BigInt(c.expiresAt);
  }

  /** The timestamp of the node's tip; one reading per clock window, so a refresh judges by one sample. */
  private sourceTipAt(): Promise<bigint | null> {
    const at = Date.now();
    if (!this.tipClock || at - this.tipClock.at > CLOCK_MS) this.tipClock = { at, value: this.readTip() };
    return this.tipClock.value;
  }

  private async readTip(): Promise<bigint | null> {
    try {
      const tip = await this.d.node.getBlockNumber();
      const data = await this.d.node.getBlockData(tip);
      return data ? BigInt(data.header.globalVariables.timestamp) : null;
    } catch {
      return null;
    }
  }

  /**
   * Whether the node in use can speak for this crossing's history: it serves the crossing's own
   * version, passed the deployment check, and holds the send's anchor block — the archiver's
   * history is contiguous, so from there it indexes every block the send could be in. A node
   * missing that block (synced from a snapshot after the send, a pruned history) cannot say a send
   * never happened, whatever its tip says. Honest answers assumed: a node that lies about its
   * blocks is trusted for everything else here too.
   */
  private async servesHistory(c: Crossing): Promise<boolean> {
    if (c.anchorBlock === undefined) return false;
    if (!this.servesVersion(c) || nodeHealth().deploymentOk !== true) return false;
    return (await this.d.node.getBlockData(c.anchorBlock as never).catch(() => undefined)) !== undefined;
  }

  /** The same reach, for the send whose hash was never recorded: the only record a missing log speaks for. */
  private async covers(c: Crossing): Promise<boolean> {
    return hashless(c) && (await this.servesHistory(c));
  }

  /**
   * The mining ledger's ✓ is final once the rollup's proof covers the claim's block; a nullifier
   * gone from a node past that block means the block was pruned with its epoch. The same two
   * readings as a crossing's claim, on the device's record of mints.
   */
  private async settleMiningClaims(): Promise<void> {
    const open = this.d.store.get(claimsAtom).filter((c) => c.txHash && c.settled === 'pending');
    if (!open.length) return;
    const rollup = await this.rollupFor(this.ctx.version.toString());
    const batch = rotate([...open].reverse(), this.settleFrom, SETTLE_AT_MOST);
    this.settleFrom += SETTLE_AT_MOST;
    for (const c of batch) {
      let settled: ClaimRecord['settled'] | undefined;
      try {
        settled = await this.miningSettlement(c, rollup);
      } catch {
        continue; // asked again next refresh
      }
      if (settled && settled !== 'pending')
        this.d.store.set(claimsAtom, (all) =>
          all.map((x) => (x.txHash === c.txHash ? { ...x, settled } : x)),
        );
    }
  }

  private async miningSettlement(c: ClaimRecord, rollup: RollupReads): Promise<ClaimRecord['settled']> {
    const checkpoint = await this.checkpointOfBlock(c.block, c.txHash);
    if (checkpoint === 'gone') {
      // Pruned only from a node that has reached the claim's block; the nullifier's absence confirms it.
      if ((await this.d.node.getBlockNumber()) < c.block || !c.nullifier) return 'pending';
      const [leaf] = await this.d.node.findLeavesIndexes('latest', MerkleTreeId.NULLIFIER_TREE, [
        Fr.fromString(c.nullifier),
      ]);
      return leaf ? 'pending' : 'pruned';
    }
    if (typeof checkpoint === 'object') {
      // Re-included at another height: the record follows, and is asked about there next time.
      this.d.store.set(claimsAtom, (all) =>
        all.map((x) => (x.txHash === c.txHash ? { ...x, block: checkpoint.moved } : x)),
      );
      return 'pending';
    }
    if (checkpoint === 'unknown') return 'pending';
    return (await checkpointProven(rollup, checkpoint)) ? 'settled' : 'pending';
  }

  /**
   * Every crossing still in flight reread, and what its row then says; a mint waiting on its
   * epoch's proof is rechecked instead. The node's tip is sampled before the readings, so a "no
   * log" answer is never older than the tip it is measured against — a tip read afterwards could
   * be past an expiry the send still made it under.
   */
  private async rowStates(now: number): Promise<Record<string, RowState>> {
    const journal = await this.journal.list();
    const tipAt = journal.some(hashless) ? await this.sourceTipAt() : null;
    const rows: Record<string, RowState> = {};
    for (const c of journal) {
      if (inFlight(c)) {
        const { crossing, read } = await this.reread(c, now);
        rows[c.id] = rowState(crossing, {
          // A failed read is not an absence: the row waits instead of offering a second send.
          sourceTipAt: read === 'answered' ? tipAt : null,
          covered: await this.covers(crossing),
        });
      } else if (c.state === 'minted-l2' && !c.claimSettled && this.landsHere(c))
        await this.recheckClaim(c, now);
    }
    return rows;
  }

  /**
   * One reading applied to the record as stored now: an operation that landed while the facts
   * were being read (a forward, a claim) is not rolled back by them. `read` says whether the
   * reading answered at all — a `failed` one proves nothing about what is or is not on chain.
   */
  private async reread(c: Crossing, now: number): Promise<Reread> {
    let next: Crossing;
    let read: Reread['read'] = 'answered';
    try {
      next = advance(c, await factsFor(this.reads, c, now));
    } catch (e) {
      read = 'failed';
      next = { ...c, error: e instanceof Error ? e.message.split('\n')[0] : String(e), updatedAt: now };
    }
    if (next === c) return { crossing: c, read };
    const crossing = await this.journal.update(c.id, (stored) =>
      stored.updatedAt === c.updatedAt && stored.state === c.state ? next : stored,
    );
    return { crossing, read };
  }

  /**
   * A minted record is asked about until its claim's epoch is proven — on every visit, however
   * late: a claim whose block was pruned with its epoch has no nullifier any more and is offered
   * again; one whose epoch is proven is settled and asked no more.
   */
  private async recheckClaim(c: Crossing, now: number): Promise<void> {
    try {
      const claimed = await this.reads.claimed(c);
      if (!claimed) {
        // Absence means pruning only from a node that has reached the claim's block; a node behind it knows nothing yet.
        if (c.claimBlock === undefined || (await this.d.node.getBlockNumber()) < c.claimBlock) return;
        // The hash of the undone claim stays: it is the row's only evidence that this was claimed
        // once, which is a different sentence from an arrival nobody has touched. A new claim
        // overwrites it.
        await this.journal.update(c.id, (stored) =>
          stored.state === 'minted-l2'
            ? { ...stored, state: 'claimable', claimBlock: undefined, updatedAt: now }
            : stored,
        );
        return;
      }
      // The block the nullifier is in now: a claim made again after a pruning has a newer one.
      const block = claimed.block;
      const checkpoint = await this.checkpointOfBlock(block, c.claimTxHash || undefined);
      const settled =
        typeof checkpoint === 'bigint' &&
        (await checkpointProven(await this.rollupFor(this.ctx.version.toString()), checkpoint));
      if (settled || c.claimBlock !== block)
        await this.journal.update(c.id, (stored) =>
          stored.state === 'minted-l2'
            ? { ...stored, claimBlock: block, ...(settled ? { claimSettled: true } : {}) }
            : stored,
        );
    } catch {
      /* the node or the RPC did not answer: the record keeps its state until they do */
    }
  }

  private async minerRetired(): Promise<boolean | null> {
    try {
      const view = (await this.d.l2().miner.methods.bridge_state().simulate({ from: this.d.from })) as {
        result?: unknown[];
      };
      const retired = view.result?.[2];
      return typeof retired === 'boolean' ? retired : null;
    } catch {
      return null;
    }
  }

  /**
   * Send-aheads forwarded here from earlier versions and deposits into this one, as cards with a
   * Claim: windows of indices up to the scan's bound (this version's chain names the account's
   * last index, an earlier version's cannot), each arrival applied to the record as stored, in the
   * transaction that reserves its index; a message under an index another message holds gets its
   * own row.
   */
  async landing(): Promise<void> {
    const versions = { sources: await this.sourceVersions(), current: this.ctx.version };
    const scope = { chainId: this.ctx.chainId, portal: EthAddress.fromString(this.ctx.portal) };
    const arrivals = await this.reader.arrivals();
    const now = this.d.now?.() ?? Date.now();
    const floor = await this.indicesInUse([...versions.sources, versions.current]);
    for (let from = 0; from < MAX_LANDING_INDICES; from += SCAN_WINDOW) {
      const candidates = await arrivalCandidates(this.d.master, scope, versions, SCAN_WINDOW, from);
      const arrived = matchArrivals(arrivals, candidates, {
        chainId: this.d.record.chainId,
        portal: this.ctx.portal,
        current: this.ctx.version,
      });
      for (const a of arrived) {
        const { crossing } = await this.journal.adopt(a.crossing(now), (stored) => landed(stored, a, now));
        const twin = twinOf(crossing, a, now);
        if (twin) await this.journal.adopt(twin, (stored) => (stored ? landed(stored, a, now) : twin));
      }
      // This version's chain names the highest index used; an earlier version's cannot, so its bound is walked whole.
      if (arrived.length === 0 && from + SCAN_WINDOW >= floor && versions.sources.length === 0) break;
    }
    await this.publishJournal();
  }

  /** One past the highest index of any of `versions` this device or the chain knows the account used. */
  private async indicesInUse(versions: bigint[]): Promise<number> {
    const journal = await this.journal.list();
    let floor = 0;
    for (const version of versions) {
      const held = journal
        .filter((c) => BigInt(c.version) === version)
        .reduce((max, c) => Math.max(max, c.index + 1), 0);
      const reserved = (await this.journal.nextIndex(version.toString())) ?? 0;
      const onChain = version === this.ctx.version ? await nextIndexFromChain(this.ctx).catch(() => 0) : 0;
      floor = Math.max(floor, held, reserved, onChain);
    }
    return floor;
  }

  /** The node's tip timestamp, held for one clock window; the L1 clock's counterpart. */
  private tipClock: { at: number; value: Promise<bigint | null> } | undefined;

  /** The Registry's versions before this one: where a send-ahead to here may have come from. */
  private async sourceVersions(): Promise<bigint[]> {
    const canonical = await this.reader.canonical().catch(() => null);
    if (!canonical) return [];
    const standing = await this.reader.standing(this.ctx.version).catch(() => null);
    const mine = standing?.registered ? standing.registryIndex : canonical.index;
    const out: bigint[] = [];
    for (let i = 0n; i < mine; i++) out.push(await this.reader.versionAt(i));
    return out;
  }

  /** Both burns are refused unless the portal routes this version's exits to this build's miner: a leaf from another sender never crosses. */
  async sendAhead(amount: bigint, said?: ProverSaid): Promise<Crossing> {
    return this.after(async () => {
      await this.registeredHere(this.ctx.version, 'exits');
      return sendAhead(this.ctx, amount, said);
    });
  }
  async exitToL1(amount: bigint, recipient: Hex, said?: ProverSaid): Promise<Crossing> {
    return this.after(async () => {
      await this.registeredHere(this.ctx.version, 'exits');
      return exitToL1(this.ctx, amount, recipient, said);
    });
  }
  /** Refused when the portal routes this version's deposits to a miner other than this build's. */
  async deposit(amount: bigint, onStep?: (step: 'deposit') => void, resumes?: Crossing): Promise<Crossing> {
    return this.after(async () => {
      await this.registeredHere(this.ctx.version, 'deposits');
      const deadline = (await this.l1Now()) + 3600n;
      return deposit(this.ctx, this.config, amount, deadline, onStep, resumes);
    });
  }
  async claim(c: Crossing): Promise<Crossing> {
    // A new attempt starts from the promise: the last attempt's answer may not have been pruned yet.
    this.d.store.set(crossingProversAtom, (m) => new Map([...m].filter(([id]) => id !== c.id)));
    return this.after(() => claimArrival(this.ctx, c));
  }
  /**
   * An exit goes to Ethereum. A send-ahead goes into the live version, which must be this build's
   * — its record names the miner the portal must route to; the old origin offers no forward.
   */
  async selfForward(c: Crossing): Promise<Crossing> {
    return this.after(async () => {
      const canonical = await this.reader.canonical();
      if (c.kind === 2) {
        if (canonical.version !== this.ctx.version)
          throw new Error(
            'forward it from the live version’s page: this build is not the version it lands on',
          );
        await this.registeredHere(canonical.version, 'send-aheads');
      }
      return selfForward(this.ctx, this.config, c, canonical.version);
    });
  }
  async redeem(c: Crossing, recipient: Hex): Promise<Crossing> {
    return this.after(() => redeem(this.ctx, this.config, c, recipient));
  }

  /** The portal routes `version`'s messages to its registered miner: it must be this build's. */
  private async registeredHere(version: bigint, what: string): Promise<void> {
    const standing = await this.reader.standing(version);
    const mine = this.d.l2().miner.address.toString().toLowerCase();
    if (!standing.registered || standing.miner.toLowerCase() !== mine)
      throw new Error(`the portal does not route ${what} to this build’s miner; update the page first`);
  }

  /**
   * Once the queue reaches an operation, before anything is signed: the site must still serve
   * this tab's build, and the Ethereum RPC must answer — a crossing nobody can watch is not made.
   */
  private async preflight(): Promise<void> {
    const served = await servedBuild();
    if (
      staleTab(served, {
        miner: this.d.l2().miner.address.toString(),
        rollupVersion: this.ctx.version.toString(),
      })
    )
      throw new Error('Yacana has been redeployed since this page loaded: reload before you send or claim.');
    await this.reader.canonical().catch(() => {
      throw new Error('the Ethereum RPC is not answering: nothing is sent until it does');
    });
  }

  private async after(op: () => Promise<Crossing>): Promise<Crossing> {
    try {
      return await op();
    } finally {
      await this.publishJournal();
    }
  }

  /** Every crossing of this account on this portal, as a file to keep. */
  async exportRecovery(): Promise<RecoveryFile> {
    return recoveryFile(
      { chainId: this.d.record.chainId, portal: this.ctx.portal, account: this.d.from.toString() },
      await this.journal.list(),
    );
  }

  /**
   * Restores the file's crossings the journal does not hold, their ended states as hints the chain
   * confirms. A witnessed crossing must be this master's (its aux is the tag or the secret hash the
   * master derives for that index) and its witness must fold to its version's Outbox root, or the
   * file is refused whole: another account's, a forged one, or one edited to point a crossing at
   * someone else's leaf.
   */
  async importRecovery(text: string): Promise<number> {
    const file = parseRecoveryFile(text, { chainId: this.d.record.chainId, portal: this.ctx.portal });
    for (const c of file.crossings) if (c.witness && c.kind !== 3) await this.verifyImported(c, c.kind);
    let restored = 0;
    for (const c of file.crossings) if (await this.adoptImported(await this.importedHint(c))) restored++;
    await this.publishJournal();
    return restored;
  }

  /**
   * A file's word on a send's arrival holds only when the portal's event agrees on the target and
   * the message; otherwise the send resumes as its witness stands. A claim on another version's
   * chain cannot be re-read here, so an agreed arrival keeps the file's word on it.
   */
  private async importedHint(c: Crossing): Promise<Crossing> {
    const arrived = c.kind === 2 && (c.target !== undefined || c.inboxIndex !== undefined);
    if (arrived && !(await this.forwardedAsSaid(c))) {
      const {
        target: _t,
        inboxIndex: _i,
        l1TxHash: _l,
        claimTxHash: _c,
        claimBlock: _b,
        claimSettled: _s,
        ...rest
      } = c;
      return asHint({ ...rest, state: c.witness ? 'witnessed' : 'sent' });
    }
    return c.state === 'minted-l2' && !this.landsHere(c) ? c : asHint(c);
  }

  /** A file's row the journal holds under another message (another device's send under the same index) gets its own row, keyed by its leaf. */
  private async adoptImported(hint: Crossing): Promise<boolean> {
    const { added, crossing } = await this.journal.adopt(hint, (stored) => stored);
    if (added || hint.kind !== 2 || !hint.witness || crossing.amount === hint.amount) return added;
    const twin = { ...hint, id: `${hint.id}:w:${hint.witness.epoch}:${hint.witness.leafIndex}` };
    return (await this.journal.adopt(twin, (stored) => stored)).added;
  }

  private async forwardedAsSaid(c: Crossing): Promise<boolean> {
    if (c.kind !== 2) return true;
    if (!c.witness || c.target === undefined || c.inboxIndex === undefined) return false;
    const f = await this.reader.forwarded(
      BigInt(c.version),
      BigInt(c.witness.epoch),
      leafIdOf({ path: c.witness.path, leafIndex: BigInt(c.witness.leafIndex) }),
    );
    return f !== undefined && f.target.toString() === c.target && f.inboxIndex.toString() === c.inboxIndex;
  }

  private async verifyImported(c: Crossing, kind: 1 | 2): Promise<void> {
    const version = BigInt(c.version);
    const s = await secretsFor(this.ctx, c.index, version);
    const aux = (kind === 1 ? s.tag : s.secretHash).toString() as Hex;
    if (c.witness?.aux.toLowerCase() !== aux.toLowerCase())
      throw new Error(`crossing ${c.id} is not this account’s`);
    const verified = await verifiedArchiveEntry(
      [c.witness],
      { ...c, kind },
      aux,
      await this.sourceScope(c.version),
      (epoch, n) => this.reader.outboxRoot(version, epoch, n),
    );
    if (!verified) throw new Error(`crossing ${c.id}’s witness does not fold to V${c.version}’s Outbox root`);
  }

  /** The balance the previous version's build last saw for this master, if this origin kept one. */
  previousBalance(previousVersion: string, token: string) {
    return readBalanceSnapshot(this.d.master, {
      chainId: this.d.record.chainId,
      rollupVersion: previousVersion,
      token,
      account: this.d.from.toString(),
    });
  }

  /** Written on every balance read: what the next version's build shows as "you still had". */
  rememberBalance(balance: bigint): Promise<void> {
    return saveBalanceSnapshot(
      this.d.master,
      {
        chainId: this.d.record.chainId,
        rollupVersion: import.meta.env.VITE_ROLLUP_VERSION,
        token: import.meta.env.VITE_YACANA_TOKEN,
        account: this.d.from.toString(),
      },
      { balance, at: this.d.now?.() ?? Date.now() },
    );
  }
}
