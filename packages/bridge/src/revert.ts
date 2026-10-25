// The name of the custom error a portal call reverted with. The portal's own errors decode from
// its ABI; a revert that bubbles up from a version's Outbox (a nullified leaf, an epoch with no
// root, a witness off its root) carries that contract's error, so both ABIs are consulted.
import { OutboxAbi } from '@aztec-foundation/l1-artifacts/OutboxAbi';
import { type BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import type { CrossingState } from './journal.ts';
import { yacanaPortalAbi } from './portal.ts';

const abis = [...yacanaPortalAbi, ...OutboxAbi];

/** The custom error revert data encodes (a `LeafFailed` reason, a simulation's), by name; the selector when unknown. */
export const errorName = (data: Hex): string => {
  if (data.length < 10) return data === '0x' ? 'empty' : data;
  try {
    return decodeErrorResult({ abi: abis, data }).errorName;
  } catch {
    return data.slice(0, 10);
  }
};

/** The custom error a thrown viem error reverted with, by name; undefined when it is not a revert. */
export function revertNameOf(e: unknown): string | undefined {
  const reverted = (e as BaseError)?.walk?.((x) => x instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;
  if (reverted.data?.errorName) return reverted.data.errorName;
  const raw = reverted.raw as Hex | undefined;
  return raw ? errorName(raw) : 'reverted';
}

/** What a viem call settled as: `ok`, the revert's error name, or `error` for anything but a revert. */
export async function revertName(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return revertNameOf(e) ?? 'error';
  }
}

/**
 * The row state a holder-facing portal revert means: `_requireOpen`'s three refusals are the
 * standing the next reading would find anyway, so the row's own sentence tells it — in the
 * crossing's own kind, version and dates. Every other revert reaches a holder through a bug or a
 * race the screen already guards, and its raw name says more than a sentence would.
 */
export const REVERT_ROWS: Record<string, Extract<CrossingState, 'headroom' | 'paused' | 'closed'>> = {
  WaitsForHeadroom: 'headroom',
  VersionPaused: 'paused',
  DeadlinePassed: 'closed',
};

/** The row state a thrown error's revert stands for; undefined for anything else. */
export const revertRow = (e: unknown): CrossingState | undefined => {
  const name = revertNameOf(e);
  return name ? REVERT_ROWS[name] : undefined;
};
