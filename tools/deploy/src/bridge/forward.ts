// Forwarding a version's exits: every `ExitRecorded` the miner logged, its Outbox witness from the
// source node once the exit's epoch settled, archived to deployments/witnesses/<profile>.jsonl so
// a forward outlives the node, then consumed on the portal in batches under the forwarder key. A
// send-ahead is forwarded only against the announced record of the version it lands on, and only
// when the miner that version registered is the announced one.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { OutboxAbi } from '@aztec-foundation/l1-artifacts/OutboxAbi';
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { exitRecordedEvent, readExits } from '@yacana/bridge/exits';
import { type ForwardArgs, yacanaPortalAbi } from '@yacana/bridge/portal';
import { leafIdOf } from '@yacana/bridge/signatures';
import {
  type ArchivedExit,
  archiveEntry,
  archiveLine,
  type ExitScope,
  exitMessageContent,
  fetchWitness,
  forwardArgsFromArchive,
  outboxLeaf,
  type RecordedExit,
  readArchive,
  rootOf,
} from '@yacana/bridge/witness';
import { MINER_ARTIFACT_PATH } from '@yacana/miner-core/artifacts';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import { getContract, type Hex, type Log, parseEventLogs } from 'viem';
import type { Deployment } from '../deploy.ts';
import { confirmed, minerBytes32, type Operator, writeOpts } from './operator.ts';

const repo = resolve(import.meta.dir, '../../../..');

/** Leaves per `forwardMany`: keeps the stated gas limit well inside a block. */
export const MAX_BATCH = 20;

export interface ForwardOptions {
  /** The version whose exits are forwarded: its record, and a node that still serves it. */
  source: Deployment;
  sourceNodeUrl?: string;
  /** The announced deployment a send-ahead may land on; without it, or with another miner registered, every K2 is held. */
  target?: Deployment;
  /** Relative to the repo root; defaults to deployments/witnesses/<profile>.jsonl. */
  archive?: string;
  /** The source node is gone: forward what the archive holds, read nothing. */
  fromArchive?: boolean;
  /** Leaves per transaction, 1 to MAX_BATCH. */
  batch?: number;
}

export type Kind2Refusal = 'no target record' | 'the live miner is not the announced one';

export interface ForwardReport {
  archived: number;
  /** Exits whose epoch has not settled on the source yet: no witness, nothing archived. */
  pending: number[];
  /** A send-ahead's `inboxIndex` names the message its claim consumes on the target; an exit's is 0. */
  forwarded: { index: number; leafId: bigint; inboxIndex: bigint }[];
  /** By the source exit's index; `reason` is the leaf's revert data (see `errorName`). */
  failed: { index: number; reason: Hex }[];
  refusedKind2: false | Kind2Refusal;
}

export const archivePath = (profile: string, archive?: string): string =>
  resolve(repo, archive ?? `deployments/witnesses/${profile}.jsonl`);

const scopeOf = (source: Deployment): ExitScope => ({
  chainId: BigInt(source.chainId),
  rollupVersion: BigInt(source.rollupVersion),
  miner: AztecAddress.fromStringUnsafe(source.miner),
  portal: EthAddress.fromString(source.portal as string),
});

const leafOf = (
  scope: ExitScope,
  exit: Pick<ArchivedExit, 'kind' | 'amount' | 'aux' | 'recipientOrRedeemKey'>,
) =>
  outboxLeaf(
    scope,
    exitMessageContent(
      { ...exit, amount: BigInt(exit.amount) },
      EthAddress.fromString(exit.recipientOrRedeemKey),
    ),
  );

/** Reads what the source node logged and archives every settled exit not archived yet. */
export async function archiveExits(
  opts: ForwardOptions,
): Promise<{ entries: ArchivedExit[]; pending: number[] }> {
  const path = archivePath(opts.source.profile, opts.archive);
  const known = existsSync(path) ? readArchive(readFileSync(path, 'utf8')) : [];
  const version = BigInt(opts.source.rollupVersion);
  const mine = known.filter((e) => e.version === version.toString());
  if (opts.fromArchive) return { entries: mine, pending: [] };
  const node = createAztecNodeClient(opts.sourceNodeUrl ?? opts.source.nodeUrl, {
    maxBatchSize: NODE_MAX_BATCH,
  });
  const scope = scopeOf(opts.source);
  const event = await exitRecordedEvent(loadContractArtifact(await Bun.file(MINER_ARTIFACT_PATH).json()));
  const pending: number[] = [];
  let page = await readExits(node, scope.miner, event);
  for (;;) {
    for (const exit of page.exits) {
      if (archivedAlready(mine, exit)) continue;
      const entry = await witnessOf(node, scope, exit, version);
      if (!entry) {
        pending.push(exit.index);
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, archiveLine(entry));
      mine.push(entry);
    }
    if (!page.nextCursor) break;
    page = await readExits(node, scope.miner, event, { afterEvent: page.nextCursor });
  }
  return { entries: mine, pending };
}

/** Whether the archive already holds this exit; a line at its index that describes another exit is an error. */
const archivedAlready = (mine: ArchivedExit[], exit: RecordedExit): boolean => {
  const known = mine.find((e) => e.index === exit.index);
  if (!known) return false;
  if (!sameExit(known, exit))
    throw new Error(
      `the archive's line for exit ${exit.index} describes another exit (${known.txHash}): remove it and archive again`,
    );
  return true;
};

/** The archive line and the node's log name one exit: the same transaction and the same leaf fields. */
export const sameExit = (a: ArchivedExit, e: RecordedExit): boolean =>
  a.txHash.toLowerCase() === e.txHash.toLowerCase() &&
  a.kind === e.kind &&
  BigInt(a.amount) === e.amount &&
  a.aux.toLowerCase() === e.aux.toLowerCase() &&
  a.recipientOrRedeemKey.toLowerCase() === e.recipientOrRedeemKey.toLowerCase();

const witnessOf = async (
  node: ReturnType<typeof createAztecNodeClient>,
  scope: ExitScope,
  exit: RecordedExit,
  version: bigint,
): Promise<ArchivedExit | undefined> => {
  const leaf = outboxLeaf(scope, exitMessageContent(exit, EthAddress.fromString(exit.recipientOrRedeemKey)));
  const witness = await fetchWitness(node, exit.txHash, leaf);
  return witness ? archiveEntry(version, exit, witness) : undefined;
};

/** Why send-aheads are held, or `false` when the announced target is the one the live version registered. */
async function kind2Refusal(op: Operator, target: Deployment | undefined): Promise<false | Kind2Refusal> {
  if (!target) return 'no target record';
  const count = await op.registry.read.numberOfVersions();
  const canonical = await op.registry.read.getVersion([count - 1n]);
  const info = await op.portal.read.versionInfo([canonical]);
  if (info.registered && info.miner.toLowerCase() !== minerBytes32(target).toLowerCase())
    return 'the live miner is not the announced one';
  return false;
}

const outboxOf = async (op: Operator, version: bigint) => {
  const rollup = await op.registry.read.getRollup([version]);
  const address = await getContract({
    address: rollup,
    abi: RollupAbi,
    client: op.publicClient,
  }).read.getOutbox();
  return getContract({ address, abi: OutboxAbi, client: op.publicClient });
};

/**
 * The entries the source version's Outbox has not seen consumed (a leaf id repeats across epochs:
 * both identify it), each first checked against the root the Outbox holds for its epoch.
 */
async function unconsumed(
  op: Operator,
  source: Deployment,
  entries: ArchivedExit[],
): Promise<ArchivedExit[]> {
  const outbox = await outboxOf(op, BigInt(source.rollupVersion));
  const scope = scopeOf(source);
  const out: ArchivedExit[] = [];
  for (const e of entries) {
    const epoch = BigInt(e.epoch);
    const root = await outbox.read.getRootData([epoch, BigInt(e.numCheckpointsInEpoch)]);
    if (rootOf(leafOf(scope, e), e.path, BigInt(e.leafIndex)) !== root.toLowerCase())
      throw new Error(
        `the archived witness of exit ${e.index} (epoch ${e.epoch}) does not match the Outbox root: remove its line and archive again`,
      );
    if (
      !(await outbox.read.hasMessageBeenConsumedAtEpoch([
        epoch,
        leafIdOf({ path: e.path, leafIndex: BigInt(e.leafIndex) }),
      ]))
    )
      out.push(e);
  }
  return out;
}

const batchSize = (batch: number | undefined): number => {
  const size = batch ?? 10;
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH)
    throw new Error(`batch must be a whole number from 1 to ${MAX_BATCH}, not ${batch}`);
  return size;
};

/** Archives, then forwards every unconsumed exit of the source version in batches. */
export async function forwardAll(op: Operator, opts: ForwardOptions): Promise<ForwardReport> {
  const size = batchSize(opts.batch);
  const version = BigInt(opts.source.rollupVersion);
  const { entries, pending } = await archiveExits(opts);
  const refusedKind2 = await kind2Refusal(op, opts.target);
  const due = (await unconsumed(op, opts.source, entries)).filter((e) => !refusedKind2 || e.kind !== 2);
  const report: ForwardReport = {
    archived: entries.length,
    pending,
    forwarded: [],
    failed: [],
    refusedKind2,
  };
  // A gas estimate cannot see through `forwardMany`'s try/catch: the cheapest "successful" run is
  // the one where every leaf runs out of its stipend and is logged as failed. So the limit is
  // stated: each leaf's stipend plus what the batch spends around it (calldata, the copy into the
  // self-call, a failure's event), plus the transaction's own base. Unused gas is refunded.
  const leafGas = await op.portal.read.LEAF_GAS();
  for (let i = 0; i < due.length; i += size) {
    const slice = due.slice(i, i + size);
    const args: ForwardArgs[] = slice.map((e) => forwardArgsFromArchive(e));
    const gas = (leafGas + 60_000n) * BigInt(slice.length) + 120_000n;
    const txHash = await confirmed(op, () =>
      op.portal.write.forwardMany([version, args], { ...writeOpts(op), gas }),
    );
    collect(report, slice, await op.publicClient.getTransactionReceipt({ hash: txHash }));
  }
  return report;
}

/** Reads one batch's outcome off its receipt: a `Forwarded` per consumed leaf, a `LeafFailed` per position. */
function collect(report: ForwardReport, slice: ArchivedExit[], receipt: { logs: Log[] }): void {
  for (const log of parseEventLogs({ abi: yacanaPortalAbi, logs: receipt.logs })) {
    if (log.eventName === 'Forwarded') {
      const entry = slice.find(
        (e) =>
          BigInt(e.epoch) === log.args.epoch &&
          leafIdOf({ path: e.path, leafIndex: BigInt(e.leafIndex) }) === log.args.leafId,
      );
      if (entry)
        report.forwarded.push({
          index: entry.index,
          leafId: log.args.leafId,
          inboxIndex: log.args.inboxIndex,
        });
    } else if (log.eventName === 'LeafFailed') {
      const entry = slice[Number(log.args.position)];
      if (entry) report.failed.push({ index: entry.index, reason: log.args.reason });
    }
  }
}
