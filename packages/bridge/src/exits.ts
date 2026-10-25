// The miner's exits as its public logs record them: the `ExitRecorded` event under its type tag
// (everyone's enumeration, with a cursor), and the same payload under the exit's own tag (the
// owner's handful of candidates in one call).
import { type EventCursor, getPublicEvents } from '@aztec-labs/aztec.js/events';
import type { ContractArtifact, StructType } from '@aztec-labs/stdlib/abi';
import { decodeFunctionSignature, type EventMetadataDefinition, EventSelector } from '@aztec-labs/stdlib/abi';
import type { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import type { AztecNode } from '@aztec-labs/stdlib/interfaces/client';
import type { Hex } from 'viem';
import type { ExitKind } from './portal.ts';
import type { RecordedExit } from './witness.ts';

const EVENT_PATH = 'YacanaMiner::ExitRecorded';

interface ExitRecordedFields {
  index: bigint;
  kind: bigint;
  amount: bigint;
  hash_or_tag: bigint;
  recipient_or_redeem_key: bigint;
}

/** The event's metadata from the compiled artifact, the way the contract codegen derives it. */
export async function exitRecordedEvent(artifact: ContractArtifact): Promise<EventMetadataDefinition> {
  const event = artifact.outputs.structs.events?.find(
    (e): e is StructType => e.kind === 'struct' && e.path === EVENT_PATH,
  );
  if (!event) throw new Error(`the artifact has no ${EVENT_PATH} event`);
  const name = event.path.split('::').at(-1) as string;
  return {
    abiType: event,
    eventSelector: await EventSelector.fromSignature(
      decodeFunctionSignature(
        name,
        event.fields.map((f) => ({ ...f, visibility: 'private' as const })),
      ),
    ),
    fieldNames: event.fields.map((f) => f.name),
  };
}

const hex32 = (v: bigint): Hex => `0x${v.toString(16).padStart(64, '0')}`;
const hex20 = (v: bigint): Hex => `0x${v.toString(16).padStart(40, '0')}`;

/** The log's fields as an exit; a kind or an index the miner cannot emit is refused, not rounded. */
export const recordedExit = (fields: ExitRecordedFields, txHash: string): RecordedExit => {
  if (fields.kind !== 1n && fields.kind !== 2n) throw new Error(`exit log in ${txHash}: kind ${fields.kind}`);
  if (fields.index > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`exit log in ${txHash}: index ${fields.index} is beyond a safe integer`);
  return {
    index: Number(fields.index),
    kind: Number(fields.kind) as ExitKind,
    amount: fields.amount,
    aux: hex32(fields.hash_or_tag),
    recipientOrRedeemKey: hex20(fields.recipient_or_redeem_key),
    txHash,
  };
};

export interface ExitPage {
  exits: RecordedExit[];
  /** Resume strictly after the last exit of this page; absent when the page ended the range. */
  nextCursor?: EventCursor;
}

/** One page of the miner's exits in emission order, from the start or after a cursor. */
export async function readExits(
  node: AztecNode,
  miner: AztecAddress,
  event: EventMetadataDefinition,
  opts: { afterEvent?: EventCursor; fromBlock?: number; toBlock?: number } = {},
): Promise<ExitPage> {
  const { events, nextCursor } = await getPublicEvents<ExitRecordedFields>(node, event, {
    contractAddress: miner,
    ...(opts.afterEvent ? { afterEvent: opts.afterEvent } : {}),
    ...(opts.fromBlock === undefined ? {} : { fromBlock: opts.fromBlock as never }),
    ...(opts.toBlock === undefined ? {} : { toBlock: opts.toBlock as never }),
  });
  return { exits: events.map((e) => recordedExit(e.event, e.metadata.txHash.toString())), nextCursor };
}
