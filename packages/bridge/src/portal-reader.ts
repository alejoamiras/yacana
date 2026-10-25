// The portal and the Registry read through an Ethereum RPC: a version's standing and flows, the
// canonical version, the events a crossing's fate is in. No wallet, no signature — the miner's
// bridge, the operator script and the stats page read through the same functions.
import { OutboxAbi } from '@aztec-foundation/l1-artifacts/OutboxAbi';
import { RegistryAbi } from '@aztec-foundation/l1-artifacts/RegistryAbi';
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import type { Hex, PublicClient } from 'viem';
import { scanLogs } from './logs.ts';
import { yacanaPortalAbi } from './portal.ts';

export interface PortalAddresses {
  portal: Hex;
  registry: Hex;
  /** Where log scans start. */
  deployBlock: bigint;
}

export interface VersionStanding {
  registered: boolean;
  miner: Hex;
  registryIndex: bigint;
  flipAt: bigint;
  /** The version after next's observation on the portal; zero while unrecorded. */
  afterNextAt: bigint;
  /** Seconds of pause spent on this version, against the budget. */
  pausedSeconds: bigint;
  paused: boolean;
  /** Unix seconds the pause runs to; zero or past when not paused. */
  pausedUntil: bigint;
  headroom: bigint;
  /** Unix seconds; the max uint256 while open-ended. */
  deadline: bigint;
  retireSent: boolean;
  depositsClosed: boolean;
}

/** What has crossed a version's portal record and what its turnstile allows now. */
export interface VersionFlows extends VersionStanding {
  version: bigint;
  /** What left the version through the portal: exits minted on Ethereum and send-aheads forwarded on. */
  exited: bigint;
  /** What arrived into the version: deposits and send-aheads forwarded in. */
  inbound: bigint;
  /** What may ever have left by now: the schedule's cumulative bound, frozen at the flip. */
  cap: bigint;
  launchAt: bigint;
}

/** The turnstile's fixed policy: the exit schedule, the allowance and the pause limits. */
export interface PortalPolicy {
  perHour: bigint;
  allowance: bigint;
  exitFloor: bigint;
  pauseMax: bigint;
  pauseBudget: bigint;
}

type Portal = { address: Hex; abi: typeof yacanaPortalAbi };
type Registry = { address: Hex; abi: typeof RegistryAbi };

/** A version's record, standing and flows, and the portal's own policy and keys. */
function versionReads(client: PublicClient, portal: Portal, a: PortalAddresses) {
  /**
   * The deadline is arithmetic over four of these reads: a transition recorded or a pause lifted
   * between them would give a combination that never existed on chain, so a caller that computes
   * with them pins one block (`at`) and measures against that block's timestamp.
   */
  const turnstile = (version: bigint, at?: bigint) => {
    const block = at === undefined ? {} : { blockNumber: at };
    const read = (functionName: 'flipAt' | 'afterNextAt' | 'isPaused' | 'headroom' | 'deadline') =>
      client.readContract({ ...portal, functionName, args: [version], ...block });
    return Promise.all([
      client.readContract({ ...portal, functionName: 'versionInfo', args: [version], ...block }),
      read('flipAt') as Promise<bigint>,
      read('afterNextAt') as Promise<bigint>,
      read('isPaused') as Promise<boolean>,
      read('headroom') as Promise<bigint>,
      read('deadline') as Promise<bigint>,
    ]);
  };
  const standingOf = ([v, flipAt, afterNextAt, paused, headroom, deadline]: Awaited<
    ReturnType<typeof turnstile>
  >) => ({
    registered: v.registered,
    miner: v.miner,
    registryIndex: BigInt(v.registryIndex),
    retireSent: v.retireSent,
    depositsClosed: v.depositsClosed,
    flipAt: BigInt(flipAt),
    afterNextAt: BigInt(afterNextAt),
    pausedSeconds: BigInt(v.pausedSeconds),
    paused,
    pausedUntil: BigInt(v.pausedUntil),
    headroom,
    deadline,
  });
  return {
    /** `at` pins every read to one L1 block; without it each is at `latest`. */
    async standing(version: bigint, at?: bigint): Promise<VersionStanding> {
      return standingOf(await turnstile(version, at));
    },
    /** The standing with what crossed: the stats page's card per version. */
    async flows(version: bigint): Promise<VersionFlows> {
      const [read, cap] = await Promise.all([
        turnstile(version),
        client.readContract({ ...portal, functionName: 'cap', args: [version] }),
      ]);
      const [v] = read;
      return {
        ...standingOf(read),
        version,
        exited: v.exited,
        inbound: v.inbound,
        cap,
        launchAt: BigInt(v.launchAt),
      };
    },
    /** Every version Yacana registered on the portal, in registration order. */
    async registered(): Promise<bigint[]> {
      const count = await client.readContract({ ...portal, functionName: 'registeredCount' });
      const out: bigint[] = [];
      for (let i = 0n; i < count; i++)
        out.push(await client.readContract({ ...portal, functionName: 'registeredVersions', args: [i] }));
      return out;
    },
    async policy(): Promise<PortalPolicy> {
      const [perHour, allowance, exitFloor, pauseMax, pauseBudget] = await Promise.all([
        client.readContract({ ...portal, functionName: 'PER_HOUR' }),
        client.readContract({ ...portal, functionName: 'ALLOWANCE' }),
        client.readContract({ ...portal, functionName: 'EXIT_FLOOR' }),
        client.readContract({ ...portal, functionName: 'PAUSE_MAX' }),
        client.readContract({ ...portal, functionName: 'PAUSE_BUDGET' }),
      ]);
      return {
        perHour,
        allowance,
        exitFloor: BigInt(exitFloor),
        pauseMax: BigInt(pauseMax),
        pauseBudget: BigInt(pauseBudget),
      };
    },
    operators: () => client.readContract({ ...portal, functionName: 'operators' }),
    /** The forwarders listed now: every `ForwarderSet`, the last word per address kept. */
    async forwarders(): Promise<Hex[]> {
      const logs = await scanLogs(client, {
        ...portal,
        eventName: 'ForwarderSet',
        fromBlock: a.deployBlock,
        toBlock: await client.getBlockNumber({ cacheTime: 0 }),
      });
      const listed = new Map<Hex, boolean>();
      for (const l of logs) listed.set(l.args.forwarder.toLowerCase() as Hex, l.args.listed);
      return [...listed].filter(([, on]) => on).map(([f]) => f);
    },
  };
}

/** The Registry's versions and their rollups; the portal's stamp of a transition and of a registration. */
function registryReads(client: PublicClient, portal: Portal, registry: Registry, a: PortalAddresses) {
  return {
    /** Unix seconds of the block that registered `version` on the portal, or undefined while it is not. */
    async registeredAt(version: bigint): Promise<bigint | undefined> {
      const [log] = await scanLogs(client, {
        ...portal,
        eventName: 'VersionRegistered',
        args: { version },
        fromBlock: a.deployBlock,
        toBlock: await client.getBlockNumber({ cacheTime: 0 }),
        first: true,
      });
      return log ? (await client.getBlock({ blockNumber: log.blockNumber })).timestamp : undefined;
    },
    /** The Registry's canonical version and its index. */
    async canonical(): Promise<{ version: bigint; index: bigint }> {
      const count = await client.readContract({ ...registry, functionName: 'numberOfVersions' });
      const index = count - 1n;
      return {
        version: await client.readContract({ ...registry, functionName: 'getVersion', args: [index] }),
        index,
      };
    },
    /** The version at Registry index `index`. */
    versionAt: (index: bigint) =>
      client.readContract({ ...registry, functionName: 'getVersion', args: [index] }),
    /** The Rollup contract of `version`: where its epochs' proofs and deadlines are read. */
    rollupOf: (version: bigint) =>
      client.readContract({ ...registry, functionName: 'getRollup', args: [version] }),
    /** Ethereum's clock: the latest block's timestamp, what the portal measures a pause or a deadline against. */
    blockTime: async (): Promise<bigint> => (await client.getBlock({ blockTag: 'latest' })).timestamp,
    /**
     * The L1 block the Registry made `version` canonical in: below it the version's Rollup emitted
     * nothing. One filtered `getLogs` over the chain (both arguments are indexed); an RPC that
     * refuses the range answers undefined, and the caller falls back to a later floor.
     */
    async canonicalAt(version: bigint): Promise<bigint | undefined> {
      try {
        const [log] = await client.getContractEvents({
          ...registry,
          eventName: 'CanonicalRollupUpdated',
          args: { version },
          fromBlock: 0n,
          toBlock: 'latest',
          strict: true,
        });
        return log?.blockNumber;
      } catch {
        return undefined;
      }
    },
    /** Whether the portal has stamped Registry index `index`. */
    async transitionSeen(index: bigint): Promise<boolean> {
      return (await client.readContract({ ...portal, functionName: 'transitions', args: [index] })) !== 0n;
    },
  };
}

/** One leaf's fate on Ethereum: nullified, forwarded, redeemed; and every arrival for the landing scan. */
function leafReads(client: PublicClient, portal: Portal, registry: Registry, a: PortalAddresses) {
  const tip = () => client.getBlockNumber({ cacheTime: 0 });
  const outboxOf = async (version: bigint) => {
    const rollup = await client.readContract({ ...registry, functionName: 'getRollup', args: [version] });
    return client.readContract({ address: rollup, abi: RollupAbi, functionName: 'getOutbox' });
  };
  return {
    /** Whether `version`'s Outbox nullified the leaf: forwarded or redeemed already. */
    async consumed(version: bigint, epoch: bigint, leafId: bigint): Promise<boolean> {
      return client.readContract({
        address: await outboxOf(version),
        abi: OutboxAbi,
        functionName: 'hasMessageBeenConsumedAtEpoch',
        args: [epoch, leafId],
      });
    },
    /** The root `version`'s Outbox holds for an epoch (zero until proven), lowercased: what a witness must fold to. */
    async outboxRoot(version: bigint, epoch: bigint, numCheckpoints: bigint): Promise<Hex> {
      const root = await client.readContract({
        address: await outboxOf(version),
        abi: OutboxAbi,
        functionName: 'getRootData',
        args: [epoch, numCheckpoints],
      });
      return root.toLowerCase() as Hex;
    },
    /** The `Forwarded` event of one leaf, if any. */
    async forwarded(version: bigint, epoch: bigint, leafId: bigint) {
      const [log] = await scanLogs(client, {
        ...portal,
        eventName: 'Forwarded',
        args: { version, epoch, leafId },
        fromBlock: a.deployBlock,
        toBlock: await tip(),
        first: true,
      });
      return log
        ? { txHash: log.transactionHash, inboxIndex: log.args.inboxIndex, target: log.args.target }
        : undefined;
    },
    async redeemed(version: bigint, epoch: bigint, leafId: bigint) {
      const [log] = await scanLogs(client, {
        ...portal,
        eventName: 'Redeemed',
        args: { version, epoch, leafId },
        fromBlock: a.deployBlock,
        toBlock: await tip(),
        first: true,
      });
      return log ? { txHash: log.transactionHash, recipient: log.args.recipient } : undefined;
    },
    arrivals: () => readArrivals(client, portal, a),
  };
}

/** The portal and the Registry read through the page's RPC; no wallet, no signature. */
export const portalReader = (client: PublicClient, a: PortalAddresses) => {
  const portal: Portal = { address: a.portal, abi: yacanaPortalAbi };
  const registry: Registry = { address: a.registry, abi: RegistryAbi };
  return {
    ...versionReads(client, portal, a),
    ...registryReads(client, portal, registry, a),
    ...leafReads(client, portal, registry, a),
  };
};

/** Every send-ahead forwarded into any version and every deposit, from the deploy block: the landing's raw material. */
async function readArrivals(client: PublicClient, portal: Portal, a: PortalAddresses) {
  const toBlock = await client.getBlockNumber({ cacheTime: 0 });
  const [forwarded, deposited] = await Promise.all([
    scanLogs(client, { ...portal, eventName: 'Forwarded', fromBlock: a.deployBlock, toBlock }),
    scanLogs(client, { ...portal, eventName: 'Deposited', fromBlock: a.deployBlock, toBlock }),
  ]);
  return {
    forwarded: forwarded
      .filter((l) => l.args.kind === 2)
      .map((l) => ({
        secretHash: l.args.aux,
        source: l.args.version,
        target: l.args.target,
        amount: l.args.amount,
        inboxIndex: l.args.inboxIndex,
        txHash: l.transactionHash,
        epoch: l.args.epoch,
        leafId: l.args.leafId,
      })),
    deposited: deposited.map((l) => ({
      sender: l.args.sender,
      secretHash: l.args.secretHash,
      version: l.args.version,
      amount: l.args.amount,
      inboxIndex: l.args.inboxIndex,
      txHash: l.transactionHash,
    })),
  };
}
export type PortalReader = ReturnType<typeof portalReader>;
