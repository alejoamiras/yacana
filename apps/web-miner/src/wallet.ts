// The page's own wallet: an embedded PXE with the prover on, a persistent PXE store keyed by the
// rollup, and an in-memory WalletDB so no spend secret ever reaches disk. Accounts come from the
// vault (a passkey or the twelve words) and are registered again on every open.
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { createLogger } from '@aztec-labs/foundation/log';
import { AztecIndexedDBStore } from '@aztec-labs/kv-store/deprecated/indexeddb';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import type { Tx } from '@aztec-labs/stdlib/tx';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import { claimGasLimits } from '@yacana/miner-core/claim';
import type { AccountFields } from '@yacana/miner-core/keys/derive';
import { PROVERLESS_MARKER } from '@yacana/web-kit/config';
import type { Fee, Node } from './chain';
import { type FeePayer, feePayer } from './feePayer';
import { type ProverKind, txProvingAfter } from './presto';
import type { TxProver } from './tx-prover';
import { MemoryKvStore } from './wallet/memory-store';

/** An e2e build may ask the PXE to skip proving; `PROVERLESS_MARKER` must stay inside this flag's branch. */
export const PROVERLESS = import.meta.env.VITE_E2E_PROVERLESS === '1';

/** A transaction as it left for the node; the expiry (unix s) is the one the sequencer enforces. */
export interface SentTx {
  txHash: string;
  expiresAt: number;
  /** The block it was built against: the earliest it can land after. */
  anchorBlock: number;
}

/** Runs before one send reaches the node; a rejection refuses that send. */
export type SendHook = (sent: SentTx) => Promise<void>;
/** Told who proves a transaction, as its proof says (again if it falls back). */
export type ProverSaid = (prover: ProverKind) => void;
export interface TurnOwn {
  hook?: SendHook;
  said?: ProverSaid;
}
/** The wallet for one transaction's simulation, proof and submission: see `sendObserver`. */
export type Turn = <T>(op: () => Promise<T>, own?: TurnOwn) => Promise<T>;

export interface OpenedWallet {
  wallet: EmbeddedWallet;
  /** A claim's fee; `feeFor` gives every other operation its own. */
  fee: Fee;
  feeFor: FeePayer['for'];
  /** The PXE's IndexedDB name: one namespace per rollup, shared by every key on this device. */
  pxeDb: string;
  /** The last transaction the wallet handed to the node. */
  lastSent: () => SentTx | undefined;
  turn: Turn;
}

/** Stores are per rollup, not per L1 chain: two rollups on Sepolia must never share PXE state. */
export const pxeNamespace = async (node: Node, chainId: bigint): Promise<string> => {
  const info = await node.getNodeInfo();
  return `yacana-pxe-${chainId}-${info.rollupVersion}-${info.l1ContractAddresses.rollupAddress.toString()}`;
};

export const sentOf = (tx: Tx): SentTx => ({
  txHash: tx.getTxHash().toString(),
  expiresAt: Number(tx.data.expirationTimestamp),
  anchorBlock: Number(tx.data.constants.anchorBlockHeader.globalVariables.blockNumber),
});

/**
 * Every send observed synchronously, and the wallet taken one transaction at a time. A `turn` runs
 * `op` after the turns before it and passes on once `op`'s send has reached the node (or `op` ended
 * without one): simulation, proof and submission are one holder's, the wait for a block is nobody's.
 * So the holder's `hook` — run before its transaction reaches the node, where a record can be made
 * durable first and a rejection refuses the send — and its `said` can only meet its own transaction.
 * A send outside any turn goes straight through.
 */
export function sendObserver(onSend: (sent: SentTx) => void) {
  let tail: Promise<void> = Promise.resolve();
  let holder: (TurnOwn & { pass: () => void }) | undefined;
  return {
    sendTx(target: Pick<Node, 'sendTx'>, tx: Tx): ReturnType<Node['sendTx']> {
      const sent = sentOf(tx);
      onSend(sent);
      const h = holder;
      holder = undefined;
      const out = h?.hook ? h.hook(sent).then(() => target.sendTx(tx)) : target.sendTx(tx);
      return out.finally(() => h?.pass());
    },
    turn<T>(op: () => Promise<T>, own: TurnOwn = {}): Promise<T> {
      const before = tail;
      let pass = () => {};
      tail = new Promise<void>((r) => {
        pass = r;
      });
      const mine = { ...own, pass };
      return before
        .then(() => {
          holder = mine;
          return op();
        })
        .finally(() => {
          if (holder === mine) holder = undefined;
          pass();
        });
    },
    /** The turn holder's listener for who proves its transaction. */
    said: (): ProverSaid | undefined => holder?.said,
  };
}

/** The wallet's node with `sendTx` observed: nothing else exposes a sent transaction's expiry. */
const observeSends = (node: Node, observer: ReturnType<typeof sendObserver>): Node =>
  new Proxy(node, {
    get(target, prop) {
      if (prop === 'sendTx') return (tx: Tx) => observer.sendTx(target, tx);
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });

/** Nothing half-open survives a failure: a retry must find the namespace unheld. */
export async function openWallet(node: Node, chainId: bigint, prover?: TxProver): Promise<OpenedWallet> {
  const pxeDb = await pxeNamespace(node, chainId);
  const pxeStore = await AztecIndexedDBStore.open(createLogger('web-miner'), pxeDb, false);
  let sent: SentTx | undefined;
  const observer = sendObserver((s) => {
    sent = s;
  });
  const observed = observeSends(node, observer);
  if (prover) {
    let on: ProverKind | null = null;
    prover.onProof = () => {
      on = null;
    };
    prover.onPhase = (phase) => {
      const next = txProvingAfter(on, phase);
      if (next !== null && next !== on) observer.said()?.(next);
      on = next;
    };
  }
  let wallet: EmbeddedWallet | undefined;
  try {
    if (PROVERLESS) console.warn(`${PROVERLESS_MARKER}: this build sends transactions unproved`);
    wallet = await EmbeddedWallet.create(observed, {
      pxe: { proverEnabled: !PROVERLESS, store: pxeStore, proverOrOptions: prover },
      walletDb: { store: new MemoryKvStore() },
    });
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(SPONSORED_FPC_SALT),
    });
    await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
    const fee: Fee = {
      paymentMethod: new SponsoredFeePaymentMethod(fpc.address),
      gasSettings: { gasLimits: await claimGasLimits(node) },
    };
    return {
      wallet,
      fee,
      feeFor: feePayer(fee).for,
      pxeDb,
      lastSent: () => sent,
      turn: observer.turn,
    };
  } catch (e) {
    if (wallet) await wallet.stop().catch(() => {});
    else await pxeStore.close().catch(() => {});
    throw e;
  }
}

/** Idempotent: the wallet checks the PXE for the instance before registering it again. */
export const registerAccount = async (w: OpenedWallet, fields: AccountFields): Promise<AztecAddress> =>
  (await w.wallet.createSchnorrInitializerlessAccount(fields.secret, fields.salt, fields.signingKey)).address;

const DELETE_GRACE_MS = 10_000;

/** A blocked delete queues every later open of the name until the other connection closes. */
export class ChainViewHeldError extends Error {
  constructor() {
    super('another tab holds this account’s chain view open; close it and reload this page');
    this.name = 'ChainViewHeldError';
  }
}

/** Waits for the old connection to let go; another tab holding the namespace open blocks it for good. */
const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    let blocked: ReturnType<typeof setTimeout> | undefined;
    req.onsuccess = () => {
      clearTimeout(blocked);
      resolve();
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      blocked = setTimeout(() => reject(new ChainViewHeldError()), DELETE_GRACE_MS);
    };
  });

/**
 * Lost-race recovery: drops the PXE namespace (this device's whole chain view) and rebuilds it from
 * the chain for one account. A reverted claim is not in the chain's logs, so the fresh sync never
 * learns of the delivery index the old view was stuck on; the notes come back the way a new device
 * recovers them.
 */
export async function resetAccountView(
  previous: OpenedWallet,
  node: Node,
  chainId: bigint,
  fields: AccountFields,
  prover?: TxProver,
): Promise<OpenedWallet> {
  await previous.wallet.stop();
  await deleteDatabase(previous.pxeDb);
  const opened = await openWallet(node, chainId, prover);
  try {
    await registerAccount(opened, fields);
  } catch (e) {
    await opened.wallet.stop().catch(() => {});
    throw e;
  }
  return opened;
}
