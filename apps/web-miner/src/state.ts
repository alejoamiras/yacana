import type { DeadlineReading } from '@yacana/bridge/exit-deadline';
import type { FlipVerdict } from '@yacana/bridge/flip';
import type { Crossing, RowState } from '@yacana/bridge/journal';
import type { VersionStanding } from '@yacana/bridge/portal-reader';
import type { ProofReading } from '@yacana/bridge/proofs';
import type { PreflightRow } from '@yacana/ui';
import type { CrsProgress } from '@yacana/web-kit/pinned-crs';
import { atom } from 'jotai';
import type { BridgeSession } from './bridge/session';
import type { SlotView } from './keys/slot';
import type { MasterRecord } from './keys/store';
import type { EpochInfo, MinerState } from './lib/reducer';
import { initial } from './lib/reducer';
import type { OpeningStep, StepId } from './opening-steps';
import type { ProverKind } from './presto';

/**
 * Why an account did not open, for the note under the button: the prompt ended without a passkey
 * (`dismissed`: WebAuthn cannot tell "none here" from "cancelled"), the authenticator cannot derive
 * a key, no WebAuthn at all, another tab holds the chain view, the slot refused, or anything else.
 */
export type AccountErrorKind =
  | 'dismissed'
  | 'no-prf'
  | 'no-webauthn'
  | 'held-tab'
  | 'slot'
  | 'node'
  /** The proving keys arrived but did not match their pin. */
  | 'pin'
  | 'other';
export interface AccountError {
  kind: AccountErrorKind;
  message: string;
  /** The opening step that failed, once the ceremony was over: the dialog keeps the checklist up. */
  step?: StepId;
}

export type Boot =
  /** Isolation, node, deployment: each row with its evidence (the proving keys stream beside it). */
  | { phase: 'preflight'; rows: PreflightRow[] }
  /**
   * Preflight passed, no account open: the chain shows, the slot decides which screen opens one.
   * `opening` is the checklist as it stood when a step failed, for Retry.
   */
  | {
      phase: 'signedOut';
      slot: SlotView;
      error?: AccountError;
      opening?: OpeningStep[];
      /** The failed attempt typed its words in: a retry of it keeps the empty-account hint. */
      typedWords?: true;
    }
  /** An account is opening; the steps drive the dialog's bar. `key` done means the ceremony is over. */
  | { phase: 'opening'; steps: OpeningStep[] }
  /** `typedWords`: the phrase was typed in to log in, so a mistyped word may have opened a different, empty account. */
  | { phase: 'ready'; account: string; threads: number; record: MasterRecord; typedWords?: true }
  | { phase: 'error'; message: string };

export interface Rules {
  N: number;
  EXPECTED_EPOCH_SECONDS: bigint;
  T_MAX: bigint;
  REWARD: bigint;
}

export const bootAtom = atom<Boot>({ phase: 'preflight', rows: [] });
export const minerAtom = atom<MinerState>(initial);
/**
 * The claim path's reads are out: a recorded win's check from its start, and every read a check, a claim
 * or its rebuild started until that read settles, however long after its deadline.
 */
export const claimReadsAtom = atom(false);
export const epochAtom = atom<EpochInfo | null>(null);
export const rulesAtom = atom<Rules | null>(null);
export const balanceAtom = atom<bigint | null>(null);
/** A mint of this account on this device; `settled` follows the rollup's proof of its block. */
export interface ClaimRecord {
  epoch: bigint;
  block: number;
  at: number;
  txHash?: string;
  nullifier?: string;
  settled?: 'pending' | 'settled' | 'pruned';
}
export const claimsAtom = atom<ClaimRecord[]>([]);
export const logAtom = atom<string[]>([]);
/** The proving keys' download, from page load; the wallet's and the prover's start wait for `done`. */
export const crsAtom = atom<CrsProgress>({ loaded: 0, total: 0, done: false });
/**
 * The account dialog is wanted while no account is open: a device with a stored account wants it on
 * arrival, a new visitor on the click; "Just watch for now" clears it.
 */
export const signInAtom = atom(false);
/** Start mining opened the dialog: mining starts once the account is ready, then the intent is spent. */
export const mineIntentAtom = atom(false);
export const nowAtom = atom(Date.now());

/** The node and the Ethereum RPC the guard admits, and whether a node switch is moving them. */
export interface Endpoints {
  nodeUrl: string;
  ethRpcUrl: string;
  switching: boolean;
}
/** Null until the session exists; a view reading beside the page's own follows it (hosted Stats). */
export const endpointsAtom = atom<Endpoints | null>(null);

/** The open account's crossings, newest first; empty until the bridge session lists them. */
export const journalAtom = atom<Crossing[]>([]);

/** A version's standing and its exit deadline, read in the same L1 block. */
export interface VersionFacts {
  standing: VersionStanding;
  deadline: DeadlineReading;
}

/** What the bridge knows about this version, read through the Ethereum RPC; `unknown` until the first read. */
export interface BridgeView {
  verdict: FlipVerdict;
  /** This version on the portal, once read. */
  standing?: VersionStanding;
  canonical?: { version: bigint; index: bigint };
  /** The exit deadline as read from the transitions and the pause accounting, on Ethereum's clock. */
  deadline?: DeadlineReading;
  /** The same for every other version the journal holds a crossing of, by version: a V5 send read on V6 is judged under V5's clock. */
  versions?: Readonly<Record<string, VersionFacts>>;
  /** Unix seconds the canonical version was registered on the portal, once it is another than this one and registered. */
  targetRegisteredAt?: bigint;
  /** When Ethereum last verified a proof of this version. */
  proof?: ProofReading;
  /** The last successful read of the RPC, or null. */
  readAt: number | null;
  /** The RPC is not answering: new Ethereum-bound exits are held back. */
  rpcFailing: boolean;
}
export const bridgeAtom = atom<BridgeView>({ verdict: { kind: 'unknown' }, readAt: null, rpcFailing: false });
/** What each in-flight crossing reads as on this refresh, by id (`rowState`); derived, never stored. */
export const rowStatesAtom = atom<Readonly<Record<string, RowState>>>({});
/** The private claims this page is proving, by crossing id, with when each tap came: the row's chip and the tab's badge read the same set. */
export const claimingAtom = atom<ReadonlyMap<string, number>>(new Map());
/** Who proved each crossing still proving or claiming, by id; the session's, so a list mounted later reads it too. */
export const crossingProversAtom = atom<ReadonlyMap<string, ProverKind>>(new Map());
/** The open account's bridge session; null while signed out or on a build without a portal. */
export const bridgeSessionAtom = atom<BridgeSession | null>(null);
