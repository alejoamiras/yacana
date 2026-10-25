// The bridge's operations from the page: each runs through the one queue, under the miner's `bridge`
// pause so a proof never fights the prover for memory, and writes its crossing before it sends and
// after it lands.
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { type Contract, NO_WAIT } from '@aztec-labs/aztec.js/contracts';
import { waitForL1ToL2MessageReady } from '@aztec-labs/aztec.js/messaging';
import { waitForTx } from '@aztec-labs/aztec.js/node';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import type { AztecNode } from '@aztec-labs/stdlib/interfaces/client';
import { Tag } from '@aztec-labs/stdlib/logs';
import { TxExecutionResult, type TxHash, TxStatus } from '@aztec-labs/stdlib/tx';
import type { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import { claimLeaf } from '@yacana/bridge/inbox';
import { advance, type Crossing, type CrossingKind, crossingId } from '@yacana/bridge/journal';
import type { OperationQueue } from '@yacana/bridge/queue';
import { type CrossingSecrets, deriveCrossingSecrets, exitLogTag } from '@yacana/bridge/secrets';
import { signForward, signRedeem } from '@yacana/bridge/signatures';
import { forwardArgsFromArchive } from '@yacana/bridge/witness';
import { BaseError, type Hex, UserRejectedRequestError } from 'viem';
import type { FeeFor } from '../feePayer';
import type { ProverKind } from '../presto';
import type { ProverSaid, SendHook, Turn } from '../wallet.ts';
import { depositOnEthereum, forwardOnEthereum, redeemOnEthereum, type WagmiConfig } from './eth.ts';
import { type BridgeStore, scanNextIndex } from './store.ts';

/** The wallet and the contracts bound to it; read at every operation, so a rebuilt chain view is what sends. */
export interface L2Handles {
  wallet: EmbeddedWallet;
  miner: Contract;
  token: Contract;
  fee: FeeFor;
  /**
   * The wallet's turns (`wallet.ts`), whose hook records a send before it is made. Not optional: the
   * record carries the send's expiry, and without that a send whose hash the node does not hold can
   * never be told from one it has not been given yet, so its row would wait for ever.
   */
  turn: Turn;
}

export interface BridgeContext {
  node: AztecNode;
  l2: () => L2Handles;
  from: AztecAddress;
  master: Uint8Array;
  chainId: bigint;
  /** This build's version: the source of a send-ahead or an exit, the destination of a claim. */
  version: bigint;
  portal: Hex;
  yaca: Hex;
  store: BridgeStore;
  queue: OperationQueue;
  /** The miner's pause around a proof; absent when no miner runs (the old app). */
  pause?: (reason: 'bridge') => void;
  release?: (reason: 'bridge') => void;
  /** Resolves once the paused miner's claim in flight has finished; the pause alone lets it run on. */
  settled?: () => Promise<void>;
  /** Ethereum's clock in seconds: what the portal holds a signature's expiry against. */
  l1Now: () => Promise<bigint>;
  /** Asked once the queue reaches the operation, just before anything is signed: throws to refuse it. */
  preflight?: () => Promise<void>;
  /** The device's clock, for the journal's timestamps; a test's stand-in. */
  now?: () => number;
  /** A crossing's own transaction said who proves it: its row's answer. */
  proved?: (id: string, prover: ProverKind) => void;
}

const WAIT = { timeout: 600 };

const scopeOf = (ctx: BridgeContext) => ({
  chainId: ctx.chainId,
  portal: EthAddress.fromString(ctx.portal),
  version: ctx.version,
});

export const secretsFor = (
  ctx: BridgeContext,
  index: number,
  version = ctx.version,
): Promise<CrossingSecrets> => deriveCrossingSecrets(ctx.master, { ...scopeOf(ctx), version }, index);

/** Under the queue and the pause; the pause lifts however the operation ends. */
async function guarded<T>(ctx: BridgeContext, op: () => Promise<T>): Promise<T> {
  return ctx.queue.run(async () => {
    await ctx.preflight?.();
    ctx.pause?.('bridge');
    try {
      // The pause lets a claim already proving finish, and that claim would be the next send the
      // wallet makes: an operation recording its own send must let it through first.
      await ctx.settled?.();
      return await op();
    } finally {
      ctx.release?.('bridge');
    }
  });
}

/** The burn the miner performs on the holder's behalf, authorised for this one call. */
async function burnAuthwit(ctx: BridgeContext, amount: bigint) {
  const nonce = (await import('@aztec-labs/aztec.js/fields')).Fr.random();
  const { wallet, miner, token } = ctx.l2();
  const call = await token.methods.burn_private(ctx.from, amount, nonce).getFunctionCall();
  const witness = await wallet.createAuthWit(ctx.from, { caller: miner.address, call });
  return { nonce, witness };
}

/** The account's next unused index on `version`, from the miner's exit log, by the tags of both kinds. */
export const nextIndexFromChain = (ctx: BridgeContext, version = ctx.version): Promise<number> =>
  scanNextIndex(async (indices) => {
    const tags: Tag[] = [];
    for (const i of indices) {
      const s = await secretsFor(ctx, i, version);
      tags.push(new Tag(await exitLogTag(s.tag)), new Tag(await exitLogTag(s.secretHash)));
    }
    const logs = await ctx.node.getPublicLogsByTags({ contractAddress: ctx.l2().miner.address, tags });
    return indices.map((_, i) => (logs[2 * i]?.length ?? 0) > 0 || (logs[2 * i + 1]?.length ?? 0) > 0);
  });

const fresh = (
  ctx: BridgeContext,
  kind: CrossingKind,
  index: number,
  amount: bigint,
  ethAddress: Hex,
): Crossing => {
  const now = ctx.now?.() ?? Date.now();
  const base = {
    kind,
    chainId: ctx.chainId.toString(),
    portal: ctx.portal,
    version: ctx.version.toString(),
    index,
  };
  return {
    ...base,
    id: crossingId(base),
    amount: amount.toString(),
    state: 'proving',
    createdAt: now,
    updatedAt: now,
    ethAddress,
  };
};

/**
 * Sends with the hash, the expiry and the anchor block committed to the journal first: a send may
 * be included after the page is gone, so nothing reaches the network without the record that finds
 * it again (a commit that fails refuses the send). The hook is the turn's own, so it records this
 * send and no other's; `said` hears who proves it, as the crossing's row does.
 */
async function sendRecorded(
  ctx: BridgeContext,
  c: Crossing,
  send: () => Promise<{ txHash: TxHash }>,
  said?: ProverSaid,
): Promise<Crossing> {
  const hook: SendHook = async (sent) => {
    await ctx.store.update(c.id, (x) => ({
      ...x,
      txHash: sent.txHash,
      expiresAt: String(sent.expiresAt),
      anchorBlock: sent.anchorBlock,
      updatedAt: ctx.now?.() ?? Date.now(),
    }));
  };
  const { txHash } = await ctx.l2().turn(send, {
    hook,
    said: (prover) => {
      ctx.proved?.(c.id, prover);
      said?.(prover);
    },
  });
  await ctx.store.update(c.id, (x) =>
    advance(
      { ...x, txHash: txHash.toString() },
      { now: ctx.now?.() ?? Date.now(), tx: { status: 'pending' } },
    ),
  );
  await waitForTx(ctx.node, txHash, {
    timeout: WAIT.timeout,
    initialDelay: 1,
    waitForStatus: TxStatus.PROPOSED,
  });
  const receipt = await ctx.node.getTxReceipt(txHash);
  if (receipt.executionResult === TxExecutionResult.REVERTED)
    throw new Error(`transaction ${txHash.toString()} reverted`);
  return ctx.store.update(c.id, (x) =>
    advance(x, {
      now: ctx.now?.() ?? Date.now(),
      tx: { status: 'mined', block: Number(receipt.blockNumber ?? 0) },
    }),
  );
}

/** K2: burn `amount` here, commit to the master's secret for this index; lands on the next version. */
export function sendAhead(ctx: BridgeContext, amount: bigint, said?: ProverSaid): Promise<Crossing> {
  return guarded(ctx, async () => {
    const c = await ctx.store.create(
      ctx.version.toString(),
      () => nextIndexFromChain(ctx),
      (index) => fresh(ctx, 2, index, amount, `0x${'00'.repeat(20)}`),
    );
    const secrets = await secretsFor(ctx, c.index);
    await ctx.store.update(c.id, (x) => ({ ...x, ethAddress: secrets.redeemAddress.toString() as Hex }));
    const { nonce, witness } = await burnAuthwit(ctx, amount);
    const { miner, fee } = ctx.l2();
    return sendRecorded(
      ctx,
      c,
      () =>
        miner.methods
          .send_ahead(amount, secrets.secretHash, secrets.redeemAddress, nonce)
          .send({ from: ctx.from, fee: fee as never, authWitnesses: [witness], wait: NO_WAIT }),
      said,
    );
  });
}

/** K1: burn `amount` here for `recipient` on Ethereum. */
export function exitToL1(
  ctx: BridgeContext,
  amount: bigint,
  recipient: Hex,
  said?: ProverSaid,
): Promise<Crossing> {
  return guarded(ctx, async () => {
    const c = await ctx.store.create(
      ctx.version.toString(),
      () => nextIndexFromChain(ctx),
      (index) => fresh(ctx, 1, index, amount, recipient),
    );
    const secrets = await secretsFor(ctx, c.index);
    const { nonce, witness } = await burnAuthwit(ctx, amount);
    const { miner, fee } = ctx.l2();
    return sendRecorded(
      ctx,
      c,
      () =>
        miner.methods
          .exit_to_l1(amount, EthAddress.fromString(recipient), secrets.tag, nonce)
          .send({ from: ctx.from, fee: fee as never, authWitnesses: [witness], wait: NO_WAIT }),
      said,
    );
  });
}

/** Claims a forwarded send-ahead or a deposit here, to this account, with the secret its index derives. */
export function claimArrival(ctx: BridgeContext, c: Crossing, timeoutSeconds = 600): Promise<Crossing> {
  return guarded(ctx, async () => {
    if (!c.inboxIndex) throw new Error('nothing to claim: the crossing has no Inbox message yet');
    const secrets = await secretsFor(ctx, c.index, BigInt(c.version));
    const { miner, fee } = ctx.l2();
    const leaf = claimLeaf(
      {
        chainId: ctx.chainId,
        rollupVersion: ctx.version,
        miner: miner.address,
        portal: EthAddress.fromString(ctx.portal),
      },
      BigInt(c.amount),
      secrets.secretHash,
      BigInt(c.inboxIndex),
    );
    await waitForL1ToL2MessageReady(ctx.node, leaf, { timeoutSeconds });
    const claim = miner.methods.claim_from_l1(
      BigInt(c.amount),
      secrets.secret,
      ctx.from,
      BigInt(c.inboxIndex),
    );
    const { receipt } = await ctx
      .l2()
      .turn(() => claim.send({ from: ctx.from, fee: fee as never, wait: WAIT }), {
        said: (prover) => ctx.proved?.(c.id, prover),
      });
    return ctx.store.update(c.id, (x) =>
      advance(x, {
        now: ctx.now?.() ?? Date.now(),
        claimed: { txHash: receipt.txHash.toString(), block: Number(receipt.blockNumber ?? 0) },
      }),
    );
  });
}

/** The wallet said no: nothing was sent. Anything else (a timeout, a closed prompt) leaves that unknown. */
const refusedByWallet = (e: unknown): boolean =>
  e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError) !== null;

/** A record given up: final, yet the landing scan revives it should Ethereum have its event after all. */
const givenUp = (ctx: BridgeContext, id: string) =>
  ctx.store.update(id, (x) =>
    x.state === 'proving' && !x.l1TxHash
      ? { ...x, state: 'dropped', updatedAt: ctx.now?.() ?? Date.now() }
      : x,
  );

/**
 * K3: one wallet transaction on Ethereum; the crossing is recorded before it, under an index of
 * its own every time. A deposit the wallet never answered is never sent again under the
 * same secret — the wallet may have sent it after all — so the page cannot tell one message from
 * two. One the wallet refused is given up at once; one left open (`resumes`) is given up the
 * moment its replacement is sent; any other waits for Ethereum's event or gives itself up later.
 */
export function deposit(
  ctx: BridgeContext,
  config: WagmiConfig,
  amount: bigint,
  deadline: bigint,
  onStep?: (step: 'deposit') => void,
  resumes?: Crossing,
): Promise<Crossing> {
  return guarded(ctx, async () => {
    // The calldata deadline on the record: Ethereum refuses the deposit past it, whatever the wallet did.
    const c = await ctx.store.create(
      ctx.version.toString(),
      () => nextIndexFromChain(ctx),
      (index) => ({
        ...fresh(ctx, 3, index, amount, `0x${'00'.repeat(20)}`),
        expiresAt: deadline.toString(),
      }),
    );
    const secrets = await secretsFor(ctx, c.index);
    let sent = false;
    const done = await depositOnEthereum(
      config,
      {
        portal: ctx.portal,
        amount,
        secretHash: secrets.secretHash.toString() as Hex,
        version: ctx.version,
        deadline,
      },
      onStep,
      async (txHash) => {
        sent = true;
        await ctx.store.update(c.id, (x) => ({
          ...x,
          l1TxHash: txHash,
          updatedAt: ctx.now?.() ?? Date.now(),
        }));
        if (resumes) await givenUp(ctx, resumes.id);
      },
    ).catch(async (e: unknown) => {
      if (!sent && refusedByWallet(e)) await givenUp(ctx, c.id);
      throw e;
    });
    return ctx.store.update(c.id, (x) =>
      advance(x, {
        now: ctx.now?.() ?? Date.now(),
        deposited: { txHash: done.txHash, inboxIndex: done.inboxIndex.toString() },
      }),
    );
  });
}

const HOUR = 3600n;

/** The redeem key's Forward signature over the send-ahead's leaf and `target`, good for an hour of Ethereum's clock. */
async function holderSignature(
  ctx: BridgeContext,
  c: Crossing,
  args: ReturnType<typeof forwardArgsFromArchive>,
  target: bigint,
): Promise<{ sig: Hex; expiry: bigint }> {
  const secrets = await secretsFor(ctx, c.index, BigInt(c.version));
  const expiry = (await ctx.l1Now()) + HOUR;
  const sig = await signForward(
    secrets.redeemKey,
    { chainId: ctx.chainId, portal: ctx.portal, version: BigInt(c.version), expiry },
    args,
    target,
  );
  return { sig, expiry };
}

/**
 * The holder forwards a witnessed exit or held send-ahead themselves; the wallet pays. A
 * send-ahead's forward into `target` carries the redeem key's signature; an exit to Ethereum is
 * anyone's to forward, and the portal reads no signature for it.
 */
export function selfForward(
  ctx: BridgeContext,
  config: WagmiConfig,
  c: Crossing,
  target: bigint,
): Promise<Crossing> {
  return guarded(ctx, async () => {
    if (!c.witness) throw new Error('the send-ahead has no witness yet');
    const args = forwardArgsFromArchive(c.witness);
    const signed =
      c.kind === 2 ? await holderSignature(ctx, c, args, target) : { sig: '0x' as Hex, expiry: 0n };
    const done = await forwardOnEthereum(config, {
      portal: ctx.portal,
      version: BigInt(c.version),
      args: { ...args, ...signed },
    });
    return ctx.store.update(c.id, (x) =>
      advance(x, {
        now: ctx.now?.() ?? Date.now(),
        forwarded: {
          txHash: done.txHash,
          inboxIndex: done.inboxIndex.toString(),
          target: done.target.toString(),
        },
      }),
    );
  });
}

/** A held send-ahead becomes YACA on Ethereum for `recipient` instead. */
export function redeem(
  ctx: BridgeContext,
  config: WagmiConfig,
  c: Crossing,
  recipient: Hex,
): Promise<Crossing> {
  return guarded(ctx, async () => {
    if (!c.witness) throw new Error('the send-ahead has no witness yet');
    const secrets = await secretsFor(ctx, c.index, BigInt(c.version));
    const expiry = (await ctx.l1Now()) + HOUR;
    const args = forwardArgsFromArchive(c.witness);
    const sig = await signRedeem(
      secrets.redeemKey,
      { chainId: ctx.chainId, portal: ctx.portal, version: BigInt(c.version), expiry },
      args,
      recipient,
    );
    const done = await redeemOnEthereum(config, {
      portal: ctx.portal,
      version: BigInt(c.version),
      args,
      recipient,
      expiry,
      sig,
    });
    return ctx.store.update(c.id, (x) =>
      advance(x, { now: ctx.now?.() ?? Date.now(), redeemed: { txHash: done.txHash, recipient } }),
    );
  });
}
