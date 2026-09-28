// The key flows the screens drive: create a passkey or words key, open a known one, restore one,
// back it up, forget it; the wallet's withdraw. Each resolves to a running miner or leaves the
// screen with a message.
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';
import { masterFromPrf } from '@yacana/miner-core/keys/derive';
import {
  entropyOf,
  generateWords,
  masterFromMnemonic,
  normaliseWords,
} from '@yacana/miner-core/keys/mnemonic';
import {
  type EthRpcProbe,
  probeEthRpc,
  resetEthRpcHealth,
  startEthRpcHealth,
} from '@yacana/web-kit/browser/eth-rpc';
import { duration } from '@yacana/web-kit/browser/format';
import { keysAllowed, relyingParty } from '@yacana/web-kit/browser/host';
import { type NodeProbe, probeNode } from '@yacana/web-kit/browser/node';
import { setAcceleratorEndpoints, setEthRpcEndpoint } from '@yacana/web-kit/browser/node-guard';
import { nodeHealth, resetL1, waitTurn } from '@yacana/web-kit/browser/node-health';
import { CrsPinError } from '@yacana/web-kit/pinned-crs';
import type { createStore } from 'jotai';
import type { Hex } from 'viem';
import {
  expectedOf,
  type Preflighted,
  preflight,
  type Started,
  SwitchFailed,
  startSession,
  switchNodeLive,
} from './boot';
import { bridgeRecord, isOldRole } from './bridge/env';
import { BridgeSession } from './bridge/session';
import {
  type Deployment,
  loadArtifact,
  readPublicBalance,
  recipientKnown,
  type Sent,
  sendWithdraw,
  type Withdrawal,
} from './chain';
import { type Connection, ethRpcPinnedByQuery, saveConnection } from './config';
import type { MinerController } from './controller';
import { feePayer } from './feePayer';
import { currentAccountClassId } from './keys/classes';
import { assertPasskey, createPasskey, NoPrfError, NoWebAuthnError } from './keys/passkey';
import {
  cancel,
  commit,
  type Intent,
  type Reservation,
  readSlot,
  release,
  reserve,
  SlotError,
  type SlotView,
  stage,
} from './keys/slot';
import {
  addressOf,
  base64url,
  currentAddress,
  findRecordFor,
  fromBase64url,
  type MasterRecord,
  openAccount,
  openPhrase,
  putRecord,
  seal,
  setStayOpen,
} from './keys/store';
import { type L1Sampler, startL1Sampler } from './l1-sampler';
import { initialSteps, keyStepLabel, type OpeningStep, type StepId } from './opening-steps';
import {
  initialPresto,
  lnaAtom,
  mayAsk,
  type ProverKind,
  prestoAtom,
  prestoEligible,
  prestoProvesTx,
  probePresto,
  txProvingAtom,
  watchLna,
} from './presto';
import { type Consent, isConsented, consent as pageConsent } from './presto-consent';
import { loadSettings, saveSettings } from './settings';
import {
  type AccountError,
  balanceAtom,
  bootAtom,
  bridgeAtom,
  bridgeSessionAtom,
  endpointsAtom,
  epochAtom,
  logAtom,
  mineIntentAtom,
} from './state';
import type { TxProver } from './tx-prover';
import { ChainViewHeldError } from './wallet';

type Store = ReturnType<typeof createStore>;

/** The guard's deadline for one Ethereum RPC request: a silent RPC must fail, not hang a refresh. */
const ETH_RPC_DEADLINE_MS = 30_000;

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** What the ceremony hands the opening; `reservation` is committed once the account is verified open. */
interface Ceremony {
  record: MasterRecord;
  master: Uint8Array;
  words?: string;
  reservation?: Reservation;
  /** The phrase was typed in (a login), not shown from a fresh record. */
  typed?: true;
}

/** The JSON-RPC client's transport failures: a network error, or a status the node (or the guard's cooldown answer) returned. */
const NODE_REQUEST = /^Error (?:fetching from host|\d{3} from server) /;

/** The note the dialog draws for a failed opening, by what failed. `node` needs a node request that failed while the transport is down. */
export const classifyAccountError = (e: unknown): AccountError => {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof NoPrfError) return { kind: 'no-prf', message };
  if (e instanceof NoWebAuthnError) return { kind: 'no-webauthn', message };
  if (e instanceof ChainViewHeldError) return { kind: 'held-tab', message };
  if (e instanceof SlotError) return { kind: 'slot', message };
  if (e instanceof DOMException && e.name === 'NotAllowedError') return { kind: 'dismissed', message };
  if (e instanceof CrsPinError) return { kind: 'pin', message };
  if (NODE_REQUEST.test(message) && nodeHealth().transport.kind !== 'ok') return { kind: 'node', message };
  return { kind: 'other', message };
};

/** The failed step's right column, a few words: the note under the checklist says the rest. */
const reasonOf = (e: AccountError, step: StepId): string => {
  if (step === 'crs') return 'download failed';
  if (e.kind === 'held-tab') return 'held by another tab';
  if (e.kind !== 'node') return 'failed';
  const t = nodeHealth().transport;
  return t.kind === 'silent' ? `no answer for ${duration((Date.now() - t.since) / 1000)}` : 'no answer';
};

const credentialsOf = (records: MasterRecord[]): Uint8Array[] =>
  records.flatMap((r) => (r.credentialId ? [fromBase64url(r.credentialId)] : []));

/** Runs the work a freshly derived master feeds; if that work throws, the master is zeroed first. */
async function owning<T>(master: Uint8Array, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    master.fill(0);
    throw e;
  }
}

/** The wallet's turns, which the bridge cannot do without: see `L2Handles.turn`. */
const turnOf = (d: Deployment): NonNullable<Deployment['turn']> => {
  if (!d.turn) throw new Error('this chain view cannot record a send before it is made');
  return d.turn;
};

export class Session {
  private pre: Preflighted | undefined;
  controller: MinerController | undefined;
  /** The page's consent record (injected in tests); the hooks read it through here. */
  readonly consent: Consent;
  /** One node switch at a time: a tile remount must not start a second against the same account. */
  private switching: Promise<void> | undefined;
  private switchingUrl: string | undefined;
  /** A switch that failed left no working wallet: further node choices reboot rather than live-switch. */
  private dead = false;
  private wallet: (() => EmbeddedWallet) | undefined;
  /** The open key's master, in memory for the tab's life (convenience mode switches need it). */
  private master: Uint8Array | undefined;
  /** A words key's phrase, for the backup screen; sealed at rest, never in the store as text. */
  private words: string | undefined;
  record: MasterRecord | undefined;
  /** The slot as last read or published: its revision is what every reservation and release is checked against. */
  private slot: SlotView | undefined;
  /** What the attempt adopted: the wallet getter the bridge reads through after a rebuild. */
  private started: Started | undefined;
  /** An RPC change's bridge reopening in flight. */
  private reopening: Promise<void> | undefined;
  /** The open account's bridge, when the build carries a portal; opened before `ready` is published. */
  bridge: BridgeSession | undefined;
  private ethRpc: string;
  /** The rollup's L1 view for the node's standing; lives as long as the page. */
  readonly l1: L1Sampler | undefined;
  private unsubBalance: (() => void) | undefined;
  private unsubFlip: (() => void) | undefined;
  private unsubTxProver: (() => void) | undefined;

  /**
   * The open attempt: its generation and the AbortController Cancel aborts. `ceremony`: the OS prompt
   * is up, Cancel is inert; `adopted`: adoption has begun (the commit, then the bridge), Cancel is over.
   */
  private attempt:
    | { id: number; abort: AbortController; ceremony: boolean; adopted: boolean; done: Promise<void> }
    | undefined;
  private attemptSeq = 0;

  readonly ready: Promise<void>;

  private readonly startImpl: typeof startSession;
  private readonly preflightImpl: typeof preflight;
  private readonly createPasskey: typeof createPasskey;
  private readonly assertPasskey: typeof assertPasskey;

  constructor(
    private readonly store: Store,
    private readonly connection: Connection,
    // Injectable for tests: the real ones open the wallet / run the preflight against a node / touch
    // WebAuthn / read the page's storage and the browser's permission.
    deps: {
      startImpl?: typeof startSession;
      preflightImpl?: typeof preflight;
      createPasskey?: typeof createPasskey;
      assertPasskey?: typeof assertPasskey;
      consent?: Consent;
      permissions?: Pick<Permissions, 'query'>;
    } = {},
  ) {
    this.startImpl = deps.startImpl ?? startSession;
    this.preflightImpl = deps.preflightImpl ?? preflight;
    this.createPasskey = deps.createPasskey ?? createPasskey;
    this.assertPasskey = deps.assertPasskey ?? assertPasskey;
    this.consent = deps.consent ?? pageConsent;
    this.consent.subscribe(() => this.onConsentChange());
    watchLna(store, deps.permissions ?? globalThis.navigator?.permissions);
    store.sub(lnaAtom, () => this.onLnaChange());
    this.ethRpc = connection.ethRpcUrl;
    this.publishEndpoints(false);
    // The guard admits the RPC in use from the first request. L1 is the record's: a build without a
    // portal never asks it, unless an e2e page pins an RPC of its own.
    if (bridgeRecord() || ethRpcPinnedByQuery()) {
      setEthRpcEndpoint(this.ethRpc, ETH_RPC_DEADLINE_MS);
      startEthRpcHealth();
      const expected = expectedOf(connection);
      this.l1 = startL1Sampler({
        rpcUrl: () => this.ethRpc,
        rollup: expected.rollupAddress,
        chainId: expected.chainId,
        log: (line) =>
          store.set(logAtom, (l) => [...l.slice(-199), `${new Date().toISOString().slice(11, 19)} ${line}`]),
      });
    }
    this.ready = this.runPreflight();
  }

  /** A preflight the node failed (throttled or silent) is shown, then tried again once the node is usable. */
  private async runPreflight(): Promise<void> {
    try {
      this.pre = await this.preflightImpl(this.store, this.connection);
      const boot = this.store.get(bootAtom);
      if (boot.phase === 'signedOut') this.slot = boot.slot;
    } catch (e) {
      this.store.set(bootAtom, { phase: 'error', message: e instanceof Error ? e.message : String(e) });
      if (nodeHealth().transport.kind === 'ok') return;
      await waitTurn();
      return this.runPreflight();
    }
  }

  private get rpId(): string {
    return relyingParty(location.hostname);
  }

  private guardHost(purpose: 'create' | 'restore'): void {
    if (!keysAllowed(location.hostname, purpose))
      throw new Error(
        purpose === 'create' && keysAllowed(location.hostname, 'restore')
          ? `Accounts are restored here, not created. Create one at ${import.meta.env.VITE_RP_ID}.`
          : `Accounts cannot be created or restored on this host. Open ${import.meta.env.VITE_RP_ID}.`,
      );
  }

  private async slotView(): Promise<SlotView> {
    this.slot = await readSlot();
    return this.slot;
  }

  /** Back to the signed-out cockpit with the error; `id` names the attempt speaking, if any. */
  private async fail(e: unknown, id?: number, opening?: OpeningStep[], typed?: true): Promise<void> {
    const slot = await this.slotView();
    if (id !== undefined && this.attempt?.id !== id) return; // a replacement began meanwhile
    const error = classifyAccountError(e);
    const active = opening?.find((s) => s.state === 'active');
    if (!active) {
      this.store.set(bootAtom, { phase: 'signedOut', slot, error });
    } else {
      // The step that failed stays on the checklist with its reason; Retry keeps what arrived.
      const steps = opening?.map((s) =>
        s === active ? { ...s, state: 'failed' as const, reason: reasonOf(error, active.id) } : s,
      );
      this.store.set(bootAtom, {
        phase: 'signedOut',
        slot,
        error: { ...error, step: active.id },
        opening: steps,
        ...(typed && { typedWords: true }),
      });
    }
    // No account came up: the public epoch feeds the cockpit again.
    this.pre?.publicEpoch.start();
  }

  /**
   * A cancellable opening. A previous attempt is aborted and its cleanup awaited first (one PXE at a
   * time; a queued attempt superseded meanwhile never prompts). The ceremony (an OS passkey prompt,
   * or the words work) runs under the new attempt with Cancel inert; then `startImpl` runs the steps,
   * honouring the signal between them. Whatever an attempt made and the session did not adopt — a
   * controller, a wallet, the master — is disposed, stopped or zeroed before it ends; a cancel returns
   * to `signedOut` with no error and the public poll takes the epoch back; a superseded attempt
   * publishes nothing, even from a publish already in flight.
   */
  private runAttempt(keyLabel: string, ceremony: () => Promise<Ceremony>): Promise<void> {
    if (!this.pre) return this.fail(new Error('preflight has not finished'));
    const prev = this.attempt;
    const id = ++this.attemptSeq;
    const abort = new AbortController();
    const steps = initialSteps(keyLabel);
    const key = steps.find((step) => step.id === 'key');
    if (key) key.state = 'active'; // the ceremony is the active step; `done` means Cancel works
    this.store.set(bootAtom, { phase: 'opening', steps });
    const attempt = { id, abort, ceremony: true, adopted: false, done: Promise.resolve() };
    this.attempt = attempt;
    const run = this.attemptBody(id, abort, keyLabel, ceremony, prev).finally(() => {
      if (this.attempt?.id === id) this.attempt = undefined;
    });
    attempt.done = run;
    return run;
  }

  private async attemptBody(
    id: number,
    abort: AbortController,
    keyLabel: string,
    ceremony: () => Promise<Ceremony>,
    prev: Session['attempt'],
  ): Promise<void> {
    const mine = () => this.attempt?.id === id;
    let master: Uint8Array | undefined;
    let started: Started | undefined;
    let reservation: Reservation | undefined;
    let published: OpeningStep[] | undefined;
    let typed: true | undefined;
    // Whatever the steps returned that the session did not adopt: disposed, and its wallet stopped —
    // awaited, so `done` (and a successor, and the signed-out publish) come after the namespace is free.
    // A reservation not committed hands its lease back (its staged record stays for the next load).
    const discard = async () => {
      if (reservation) {
        const r = reservation;
        reservation = undefined;
        await cancel(r).catch(() => {});
      }
      if (!started || started.controller === this.controller) return;
      const s = started;
      started = undefined;
      s.controller.dispose();
      await s
        .wallet()
        .stop()
        .catch(() => {});
    };
    try {
      // The predecessor ends first (it sees itself superseded and publishes nothing) so two attempts
      // never hold the PXE namespace at once; a queued attempt superseded meanwhile never prompts.
      if (prev) {
        prev.abort.abort();
        await prev.done.catch(() => {});
      }
      // A switch in flight settles first: `switchNode` refuses to start under an attempt, and the
      // attempt must not start under a switch (its wallet would open on the node being left).
      if (this.switching) await this.switching.catch(() => {});
      if (!mine()) return;
      abort.signal.throwIfAborted();
      const t0 = performance.now();
      const c = await ceremony();
      master = c.master;
      reservation = c.reservation;
      typed = c.typed;
      const keyMs = performance.now() - t0;
      if (!mine()) return;
      (this.attempt as { ceremony: boolean }).ceremony = false; // the prompt is done: Cancel works
      abort.signal.throwIfAborted();
      started = await this.startImpl(this.store, this.pre as Preflighted, this.connection, c.record, master, {
        signal: abort.signal,
        keyLabel,
        keyMs,
        publish: (steps) => {
          if (!mine()) return;
          published = steps;
          this.store.set(bootAtom, { phase: 'opening', steps });
        },
      });
      if (!mine()) return;
      abort.signal.throwIfAborted(); // a cancel that landed as the last step settled
      if (this.attempt?.id === id) this.attempt.adopted = true;
      reservation = await this.adopt(reservation, c.record);
      this.adoptController(started.controller);
      this.wallet = started.wallet;
      this.master = master;
      this.record = c.record;
      this.words = c.words;
      master = undefined; // the session owns it now
      this.started = started;
      this.bindTxProver(started.txProver);
      await this.openBridge();
      this.store.set(bootAtom, {
        phase: 'ready',
        account: currentAddress(c.record, await currentAccountClassId()),
        threads: started.threads,
        record: c.record,
        ...(c.typed && { typedWords: true }),
      });
      this.spendIntent();
    } catch (e) {
      await discard();
      if (!mine()) return; // a stale attempt publishes nothing
      // A cancel wins over whatever the abort made the steps throw (a download that failed later).
      if (isAbort(e) || abort.signal.aborted) await this.toSignedOut(id);
      else await this.fail(e, id, published, typed);
    } finally {
      master?.fill(0);
      await discard();
    }
  }

  /** A revoke while the account was opening found no controller to tell: the one adopted hears it now. */
  private adoptController(c: MinerController): void {
    this.controller = c;
    if (c.currentPresto && !this.consented()) c.revoke();
  }

  /**
   * The account is verified open: the slot takes it. A refusal (the slot changed under a stale
   * lease) ends the attempt like any other failure; the open wallet is discarded with it.
   */
  private async adopt(r: Reservation | undefined, record: MasterRecord): Promise<undefined> {
    if (!r) return;
    await commit(r);
    this.slot = { record, staged: null, revision: r.revision };
  }

  /**
   * Aborts the open in flight, once its ceremony is over and until the slot adopts the account, and
   * waits for its cleanup to finish. Past adoption the account is open and Sign out is the way back.
   */
  async cancelOpening(): Promise<void> {
    const a = this.attempt;
    if (!a || a.ceremony || a.adopted) return;
    this.store.set(mineIntentAtom, false);
    a.abort.abort();
    await a.done.catch(() => {});
  }

  /** Start mining opened the dialog: the account is ready, so mining starts, and the intent is spent. */
  private spendIntent(): void {
    if (!this.store.get(mineIntentAtom)) return;
    this.store.set(mineIntentAtom, false);
    this.startMining();
  }

  /** Cancel on a failed checklist: the note stays with Welcome, the checklist does not come back. */
  hideOpeningFailure(): void {
    const boot = this.store.get(bootAtom);
    if (boot.phase !== 'signedOut' || !boot.opening) return;
    const { opening: _, ...rest } = boot;
    this.store.set(bootAtom, rest);
  }

  /** Back to the signed-out cockpit with no error (a cancel); the public poll feeds the chain again. */
  private async toSignedOut(id: number): Promise<void> {
    const slot = await this.slotView();
    if (this.attempt?.id !== id) return; // a replacement began meanwhile: its opening stands
    this.store.set(bootAtom, { phase: 'signedOut', slot });
    this.pre?.publicEpoch.start();
  }

  /** The slot reserved before the prompt; a ceremony that throws hands the lease back. */
  private async reserved(intent: Intent, work: (r: Reservation) => Promise<Ceremony>): Promise<Ceremony> {
    const r = await reserve((this.slot ?? (await this.slotView())).revision, intent);
    try {
      return { ...(await work(r)), reservation: r };
    } catch (e) {
      await cancel(r).catch(() => {});
      throw e;
    }
  }

  /** The record is staged before the wallet opens: a boot failure must not lose a fresh passkey. */
  async createWithPasskey(): Promise<void> {
    return this.runAttempt(keyStepLabel('passkey'), () => {
      this.guardHost('create');
      return this.reserved('create', async (r) => {
        const { credentialId, prf } = await this.createPasskey({
          rpId: this.rpId,
          userName: 'Yacana account',
          exclude: credentialsOf(r.known),
        });
        const master = await masterFromPrf(prf);
        return owning(master, async () => {
          const record: MasterRecord = {
            v: 1,
            id: crypto.randomUUID(),
            method: 'passkey',
            createdAt: Date.now(),
            credentialId: base64url(credentialId),
            askEveryOpen: !loadSettings().stayOpen,
            backedUp: false,
            account: { address: await addressOf(master, 0), index: 0 },
          };
          if (!record.askEveryOpen) record.sealed = await seal(master, record);
          await stage(r, record);
          return { record, master };
        });
      });
    });
  }

  /**
   * The slot's record (Welcome back): one touch, restricted to its credential, or none when the
   * secret is sealed on this device. `record` names the kind for the dialog; the slot is re-read.
   * `typed`: the record came from words typed in this session (a retry of that login keeps its hint).
   */
  async open(record: MasterRecord, typed?: true): Promise<void> {
    const keyLabel = keyStepLabel(record.method === 'passkey' ? 'passkey' : 'words');
    return this.runAttempt(keyLabel, () =>
      this.reserved('open', async (r) => {
        const target = r.record as MasterRecord;
        const opened = target.sealed
          ? await openAccount(target)
          : await this.masterFromCeremony(target).then((m) => owning(m, () => openAccount(target, m)));
        return owning(opened.master, async () => ({
          record: opened.record,
          master: opened.master,
          words: target.method === 'words' ? await openPhrase(target) : undefined,
          ...(typed && { typed }),
        }));
      }),
    );
  }

  private async masterFromCeremony(record: MasterRecord): Promise<Uint8Array> {
    if (record.method !== 'passkey' || !record.credentialId)
      throw new Error('this account needs its twelve words to open');
    const { prf } = await this.assertPasskey({
      rpId: this.rpId,
      allow: [fromBase64url(record.credentialId)],
    });
    return masterFromPrf(prf);
  }

  /**
   * Log in on an empty slot: a discoverable request. A master this device knows (a record signed
   * out, or one from before the slot) takes its record back; a new one gets a record.
   */
  async restoreWithPasskey(): Promise<void> {
    return this.runAttempt(keyStepLabel('passkey'), () => {
      this.guardHost('restore');
      return this.reserved('login', async (r) => {
        const { credentialId, prf } = await this.assertPasskey({ rpId: this.rpId });
        const master = await masterFromPrf(prf);
        return owning(master, async () => {
          const existing = await findRecordFor(r.known, master);
          const record: MasterRecord = existing ?? {
            v: 1,
            id: crypto.randomUUID(),
            method: 'passkey',
            createdAt: Date.now(),
            credentialId: base64url(credentialId),
            askEveryOpen: true,
            backedUp: false,
            account: { address: await addressOf(master, 0), index: 0 },
          };
          await stage(r, record);
          return openAccount(record, master);
        });
      });
    });
  }

  /** A fresh phrase; the key exists only once the screen calls `createWithWords` with it. */
  newWords(): string {
    this.guardHost('create');
    return generateWords();
  }

  /** Words keys seal their entropy: nothing re-derives it, and a skipped backup can be shown later. */
  async createWithWords(phrase: string, backedUp: boolean): Promise<void> {
    return this.runAttempt(keyStepLabel('words'), () => {
      this.guardHost('create');
      return this.reserved('create', (r) => this.wordsRecord(r, phrase, backedUp));
    });
  }

  /** A fresh sealed words record, staged, and its master (derived here unless the caller already has it). */
  private async wordsRecord(
    r: Reservation,
    phrase: string,
    backedUp: boolean,
    derived?: Uint8Array,
  ): Promise<Ceremony> {
    const master = derived ?? (await masterFromMnemonic(phrase));
    return owning(master, async () => {
      const record: MasterRecord = {
        v: 1,
        id: crypto.randomUUID(),
        method: 'words',
        createdAt: Date.now(),
        askEveryOpen: false,
        backedUp,
        account: { address: await addressOf(master, 0), index: 0 },
      };
      record.sealed = await seal(entropyOf(phrase), record);
      await stage(r, record);
      return { record, master, words: normaliseWords(phrase) };
    });
  }

  /** Log in with the words: the phrase takes its record back if this device has one, or gets a new (sealed) one. */
  async restoreWithWords(phrase: string): Promise<void> {
    return this.runAttempt(keyStepLabel('words'), () => {
      this.guardHost('restore');
      return this.reserved('login', async (r) => {
        const master = await masterFromMnemonic(phrase);
        return owning(master, async () => {
          const existing = await findRecordFor(r.known, master);
          if (!existing)
            return { ...(await this.wordsRecord(r, normaliseWords(phrase), true, master)), typed: true };
          await stage(r, existing);
          const opened = await openAccount(existing, master);
          return { record: opened.record, master: opened.master, words: normaliseWords(phrase), typed: true };
        });
      });
    });
  }

  /** The open words key's phrase, for the backup screen; never stored, only re-shown from memory. */
  get openWords(): string | undefined {
    return this.record?.method === 'words' ? this.words : undefined;
  }

  async markBackedUp(): Promise<void> {
    if (!this.record) return;
    this.record = { ...this.record, backedUp: true };
    await putRecord(this.record);
    const boot = this.store.get(bootAtom);
    if (boot.phase === 'ready') this.store.set(bootAtom, { ...boot, record: this.record });
  }

  /**
   * Sign out; the dialog gates the call. The open account's claim being sent and its queued bridge
   * operations finish first (the page reloads, and would abandon them), then the slot lets the
   * record go and the session ends. Signed out (Welcome's "Use a different account"), only the slot moves.
   */
  async forget(record: MasterRecord): Promise<void> {
    const open = this.record?.id === record.id;
    if (open) {
      await this.controller?.drain().catch(() => {});
      await this.bridge?.drain().catch(() => {});
    }
    await release(record.id, (await this.slotView()).revision);
    if (!open) {
      this.store.set(bootAtom, { phase: 'signedOut', slot: await this.slotView() });
      return;
    }
    this.closeBridge();
    location.reload();
  }

  /**
   * The bridge for the adopted account: the journal under the master's fingerprint, the portal
   * through the RPC in use, the wallet and contracts read at each operation (a rebuild replaces
   * them). A bridge that fails to open is logged; the account opens without it.
   */
  private async openBridge(): Promise<void> {
    const record = bridgeRecord();
    const pre = this.pre;
    const started = this.started;
    const master = this.master;
    if (!record || !pre || !started || !master) return;
    const c = started.controller;
    try {
      const bridge = await BridgeSession.open({
        store: this.store,
        node: pre.node,
        from: c.address,
        l2: () => ({
          wallet: started.wallet(),
          miner: c.deployment.miner,
          token: c.deployment.token,
          fee: feePayer(c.feeSettings).for('bridge'),
          // Every wallet this app opens is observed, so this holds; a deployment without the hook
          // could not record a send before making it, and the bridge refuses rather than send blind.
          turn: turnOf(c.deployment),
        }),
        master,
        connection: { ...this.connection, ethRpcUrl: this.ethRpc },
        record,
        controller: c,
      });
      this.bridge = bridge;
      this.store.set(bridgeSessionAtom, bridge);
      // The flip ends mining on this version: the controller retires, and no start brings it back.
      this.unsubFlip = this.store.sub(bridgeAtom, () => {
        if (this.store.get(bridgeAtom).verdict.kind === 'flipped') c.retire();
      });
      // Every balance read leaves the snapshot the next version's build shows as "you still had".
      this.unsubBalance = this.store.sub(balanceAtom, () => {
        const b = this.store.get(balanceAtom);
        if (b !== null) void bridge.rememberBalance(b).catch(() => {});
      });
      void bridge
        .start()
        .catch((e: unknown) => c.log(`bridge: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e) {
      c.log(`bridge did not open: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The wallet's prover goes to Presto only under consent, and while the page's own probe says it
   * serves the kernel's scheme and the Worker has not given up on it (sticky): what the pre-proof
   * line promises is what the SDK is allowed, and a denied or dead Presto is not sent a witness per
   * proof. Who actually proves is told to the transaction's own turn (`wallet.ts`).
   */
  private bindTxProver(prover: TxProver | undefined): void {
    this.unsubTxProver?.();
    this.unsubTxProver = undefined;
    this.store.set(txProvingAtom, null);
    if (!prover) return;
    const mirror = () =>
      prover.setForceLocal(!(this.consented() && prestoProvesTx(this.store.get(prestoAtom))));
    mirror();
    const offStore = this.store.sub(prestoAtom, mirror);
    const offConsent = this.consent.subscribe(mirror);
    this.unsubTxProver = () => {
      offStore();
      offConsent();
    };
  }

  private closeBridge(): void {
    this.unsubBalance?.();
    this.unsubBalance = undefined;
    this.unsubFlip?.();
    this.unsubFlip = undefined;
    this.bridge?.stop();
    this.bridge = undefined;
    this.store.set(bridgeSessionAtom, null);
  }

  /** The Ethereum RPC in use (the saved setting, or the build's default). */
  get ethRpcUrl(): string {
    return this.ethRpc;
  }

  /** Whether `url` serves the portal's chain and knows the portal; the same check the boot makes. */
  probeEthRpc(url: string, deadlineMs = 10_000): Promise<EthRpcProbe> {
    const record = bridgeRecord();
    if (!record) throw new Error('this build has no bridge');
    return probeEthRpc(url, { chainId: BigInt(record.chainId), portal: record.portal as Hex }, deadlineMs);
  }

  /** Saves the RPC, points the guard at it, and reopens the bridge over it; the account stays open. */
  async switchEthRpc(url: string): Promise<void> {
    // A bridge reopened now would not be the suspended one: it waits for the node switch.
    if (this.switching) throw new Error('a node switch is underway; change the RPC when it is done');
    if (!saveConnection({ ethRpcUrl: url }))
      throw new Error('The browser refused to save the setting; free some site storage and try again.');
    this.ethRpc = url;
    setEthRpcEndpoint(url, ETH_RPC_DEADLINE_MS);
    this.publishEndpoints(false);
    resetEthRpcHealth();
    resetL1();
    void this.l1?.switched();
    if (!this.bridge) return;
    this.closeBridge();
    // Tracked: a node switch begun meanwhile waits for the reopened bridge, so it is the one it suspends.
    this.reopening = this.openBridge().finally(() => {
      this.reopening = undefined;
    });
    await this.reopening;
  }

  /** The node in use; the switch target's identity was checked by the caller (the Node tile's probe). */
  get nodeUrl(): string | undefined {
    return this.pre?.switchable.current();
  }

  /**
   * The deployment check plus the tip and latency of `url`; on the node in use it rides the page's
   * handle. Works before or without a successful preflight (a dead saved node is when it matters most).
   */
  async probeNode(url: string, deadlineMs = 10_000): Promise<NodeProbe> {
    const pre = this.pre;
    const layout =
      pre?.minerArtifact.storageLayout ?? (await loadArtifact('yacana_miner-YacanaMiner')).storageLayout;
    const inUse = pre !== undefined && url === pre.switchable.current();
    return probeNode(
      url,
      pre?.expected ?? expectedOf(this.connection),
      layout,
      deadlineMs,
      inUse ? () => pre.node : undefined,
    );
  }

  /**
   * Points every holder at another node without a reload: mining pauses, whatever is in flight
   * finishes, the handle moves, an open account's chain view is rebuilt from the new node, mining
   * resumes. The caller checked the candidate against this deployment first.
   */
  async switchNode(url: string): Promise<void> {
    // A terminal failure abandoned the wallet, and no preflight means nothing to move under: either
    // way the saved setting takes effect on a fresh boot. Reload only once the write lands.
    if (this.dead || !this.pre) {
      if (!saveConnection({ nodeUrl: url }))
        throw new Error('The browser refused to save the setting; free some site storage and try again.');
      return location.reload();
    }
    // Until the attempt adopts its controller there is nothing to drain: a swap under it would leave
    // the opening wallet on a node the guard no longer admits.
    if (this.attempt)
      throw new Error('an account is opening; cancel it or let it finish before changing the node');
    if (this.switching) {
      if (this.switchingUrl === url) return this.switching; // the same switch, already underway
      throw new Error('a node switch is already underway; wait for it to finish');
    }
    const pre = this.pre;
    const publicOnly = !this.controller;
    this.switchingUrl = url;
    this.publishEndpoints(true);
    this.switching = (async () => {
      // Signed out, the public poll is the only reader: drained before the swap (a read out on the old
      // node is waited for and lands nowhere), the epoch it guarded against regressing cleared; it
      // restarts on the new node once the swap settled.
      if (publicOnly) {
        await pre.publicEpoch.stop();
        this.store.set(epochAtom, null);
      }
      // The bridge's operations and readings finish on the node they started on; none may start until
      // the switch is over, or it would be signed against one node's view and sent to another.
      await this.reopening;
      await this.bridge?.suspend('a node switch is underway; try again when it is done').catch(() => {});
      await switchNodeLive({ controller: this.controller, switchable: pre.switchable, url });
    })()
      .catch((e: unknown) => {
        // The former node's view came back: the row says "Kept …" and nothing else changes.
        if (e instanceof SwitchFailed && e.kept) throw e;
        // A rebuild that failed on both nodes left no working wallet: the boot error carries the
        // way out, and the next node choice reboots rather than live-switching a dead account.
        this.dead = true;
        const message = e instanceof Error ? e.message : String(e);
        this.store.set(bootAtom, {
          phase: 'error',
          message: `the node changed but its chain view could not be rebuilt (${message}); use another node or reload`,
        });
        throw e;
      })
      .finally(() => {
        this.bridge?.resume();
        if (publicOnly) pre.publicEpoch.start();
        this.switching = undefined;
        this.switchingUrl = undefined;
        this.publishEndpoints(false);
      });
    return this.switching;
  }

  /** The guard's two slots as they stand, for the views that read beside the page (a switch in flight, or not). */
  private publishEndpoints(switching: boolean): void {
    const nodeUrl = this.pre?.switchable.current() ?? this.connection.nodeUrl;
    this.store.set(endpointsAtom, { nodeUrl, ethRpcUrl: this.ethRpc, switching });
  }

  /**
   * The user's Start: mining begins now; with Presto consented to and the browser not about to
   * prompt, it is asked afresh in the background and an answer that changes its eligibility rebuilds
   * the prover at the next nonce. The automatic resumes (after a claim, an expired claim) never come
   * through here.
   */
  startMining(): void {
    // The versioned origin's build mines nothing, nor does a version flipped away from: every
    // Start — a button, a key, a setting, the resume on open — is inert.
    if (isOldRole() || this.store.get(bridgeAtom).verdict.kind === 'flipped') return;
    this.controller?.start();
    void this.autoProbe();
  }

  /** Whether this build looks for Presto at all (`?presto=off` and the old role do not). */
  get looksForPresto(): boolean {
    return this.pre?.presto != null;
  }

  /** Presto may be transmitted to right now: remembered here, or this page's Look at the current revision. */
  consented(): boolean {
    return isConsented(this.consent.read(), this.store.get(prestoAtom).consentRev);
  }

  /** Resolves once the browser has said where it stands on loopback; never on a timer. */
  private lnaSettled(): Promise<void> {
    if (this.store.get(lnaAtom) !== 'pending') return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.store.sub(lnaAtom, () => {
        if (this.store.get(lnaAtom) === 'pending') return;
        off();
        resolve();
      });
    });
  }

  /**
   * Start's probe, when it may run without a prompt: it waits for the permission to settle, then
   * rechecks everything it stands on — consent, the permission, the same consent generation, the
   * same controller with no Stop since — right before it transmits. A Start after the Worker gave
   * up on native brings it back: only a rebuild can, and the config is unchanged, so it is forced.
   */
  private async autoProbe(): Promise<void> {
    if (!this.pre?.presto || !this.consented()) return;
    const c = this.controller;
    const stops = c?.stopCount;
    const gen = this.store.get(prestoAtom).gen;
    await this.lnaSettled();
    if (!mayAsk(this.consented(), this.store.get(lnaAtom))) return;
    if (this.store.get(prestoAtom).gen !== gen || this.controller !== c || c?.stopCount !== stops) return;
    const rebuild = this.store.get(prestoAtom).fallbackReason !== undefined;
    await this.probe(gen, stops, rebuild);
  }

  /**
   * The user's Look for Presto (the card's button, the fix-it row's Retry): consent for this page
   * at the record's current revision, then a fresh probe whose answer rebuilds the prover with or
   * without the endpoint. A revoke still committing is waited for, so the click cannot capture a
   * revision it is about to lose; "use the browser" meanwhile moves the generation and the click is
   * dropped.
   */
  async lookForPresto(): Promise<void> {
    if (!this.pre?.presto) return;
    const before = this.store.get(prestoAtom).gen;
    await this.consent.settled();
    if (this.store.get(prestoAtom).gen !== before) return;
    const rev = this.consent.read().rev;
    let gen = 0;
    this.store.set(prestoAtom, (s) => {
      gen = s.gen + 1;
      return { ...s, consentRev: rev, looking: true, gen };
    });
    await this.probe(gen, this.controller?.stopCount, true);
  }

  /**
   * One probe, published only on its own consent generation and while consent still stands: a
   * revoke here bumps `gen`, one from another tab that found nothing native to tear down moves
   * only the record, and either way the answer lands nowhere. The prover is touched only while the
   * controller that was mining when the probe left is still mining (a Stop withdraws the interest).
   */
  private async probe(gen: number, stops: number | undefined, rebuild: boolean): Promise<void> {
    const pre = this.pre;
    const c = this.controller;
    if (!pre?.presto) return;
    const status = await probePresto(pre.presto, true).catch(() => null);
    if (this.store.get(prestoAtom).gen !== gen || !this.consented()) return;
    this.store.set(prestoAtom, (s) => ({ ...s, status, probedAt: Date.now(), looking: false }));
    if (!c || this.controller !== c || c.stopCount !== stops) return;
    const endpoint = prestoEligible(status) ? pre.presto : null;
    if (endpoint) c.reconfigure(c.currentThreads, endpoint, { force: rebuild });
    else if (c.currentPresto) c.reconfigure(c.currentThreads, null);
  }

  /**
   * "Use the browser": consent withdrawn, local first. Everything native in this page is torn down
   * synchronously, then the record's revoke is awaited; the record already reads as no consent from
   * the call. Other tabs learn through the `storage` event and tear their own down.
   */
  async chooseBrowser(): Promise<void> {
    this.withdrawNative();
    await this.consent.revoke().catch(() => {});
  }

  /** The synchronous teardown: the atom (keeping `gen`), the page guard, the wallet's prover, the Worker. */
  private withdrawNative(): void {
    this.store.set(prestoAtom, (s) => ({ ...initialPresto, gen: s.gen + 1 }));
    setAcceleratorEndpoints(null, 0);
    this.started?.txProver?.setForceLocal(true);
    this.controller?.revoke();
  }

  /**
   * The browser answering late: a Look made under `prompt` is held by the prompt until the SDK's
   * deadline and reads as absent; the grant that follows (the bubble, or site settings) fires
   * `change`, and the click already given is asked again — no reload, no second click.
   */
  private onLnaChange(): void {
    const p = this.store.get(prestoAtom);
    if (this.store.get(lnaAtom) !== 'granted' || p.consentRev === null || p.looking || !this.consented())
      return;
    if (p.status && prestoEligible(p.status)) return;
    this.store.set(prestoAtom, (s) => ({ ...s, looking: true }));
    void this.probe(p.gen, this.controller?.stopCount, true);
  }

  /** A change of the record from anywhere: with consent gone and something native still standing, tear it down. */
  private onConsentChange(): void {
    if (this.consented()) return;
    const p = this.store.get(prestoAtom);
    if (p.consentRev !== null || p.status !== null || this.controller?.currentPresto) this.withdrawNative();
  }

  /** Whether anything on the chain or in the wallet knows the recipient as a contract. */
  async recipientKnown(to: AztecAddress): Promise<boolean> {
    if (!this.pre || !this.wallet) throw new Error('no open account');
    return recipientKnown(this.wallet(), this.pre.node, to);
  }

  /**
   * Mining pauses around the send so the prover and the transfer proof never fight for memory.
   * A balance read failing after the transfer is in a block cannot fail the call, or the same
   * transfer would be sent again.
   */
  async withdraw(w: Withdrawal, said?: (prover: ProverKind) => void): Promise<Sent> {
    const c = this.controller;
    if (!c) throw new Error('no open account');
    c.pause('withdraw');
    try {
      return await c.track(async () => {
        const sent = await sendWithdraw(c.deployment, c.address, c.feeSettings, w, said);
        await c.refresh().catch((e: unknown) => c.log(`balance after withdraw: ${String(e)}`));
        return sent;
      });
    } finally {
      c.release('withdraw');
    }
  }

  publicBalance(owner: string): Promise<bigint> {
    const c = this.controller;
    if (!c) throw new Error('no open account');
    return readPublicBalance(c.deployment, c.address, AztecAddress.fromStringUnsafe(owner));
  }

  /** Settings → "stay open on this device": seals the master now or drops the ciphertext. */
  async setStayOpen(stayOpen: boolean): Promise<void> {
    if (!this.record || !this.master) return;
    this.record = await setStayOpen(this.record, this.master, stayOpen);
    saveSettings({ ...loadSettings(), stayOpen });
    const boot = this.store.get(bootAtom);
    if (boot.phase === 'ready') this.store.set(bootAtom, { ...boot, record: this.record });
  }
}
