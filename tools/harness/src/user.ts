// A holder on one version: a fresh account, a wallet master of its own (the crossing secrets derive
// from it exactly as the app's would), a mined balance when a case needs one, and the miner's
// bridge calls as the app makes them — with the authwit the burn needs, with the message leaf a
// claim consumes.
import { cpus } from 'node:os';
import { BackendType, Barretenberg } from '@aztec-foundation/bb.js';
import { waitForL1ToL2MessageReady } from '@aztec-labs/aztec.js/messaging';
import { randomBytes } from '@aztec-labs/foundation/crypto/random';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import type { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { claimLeaf } from '@yacana/bridge/inbox';
import { type CrossingScope, type CrossingSecrets, deriveCrossingSecrets } from '@yacana/bridge/secrets';
import { type L2Side, openL2 } from '@yacana/deploy/bridge/l2';
import type { Deployment } from '@yacana/deploy/deploy';
import { loadWorkArtifact } from '@yacana/miner-core/artifacts';
import { buildClaim, claimGasLimits } from '@yacana/miner-core/claim';
import { readOpenEpoch } from '@yacana/miner-core/epoch';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { mineEpoch } from '@yacana/miner-core/miner';
import { deployDomain } from '@yacana/miner-core/proof';
import { newEpochSecret } from '@yacana/miner-core/secret';
import { BbJsWorkProver, type WorkProver } from '@yacana/miner-core/work';

export interface User extends L2Side {
  /** The account's secret and the wallet master: what reopens the same holder on another node. */
  secret: Fr;
  master: Uint8Array;
  scope: CrossingScope;
  deployment: Deployment;
}

export async function openUser(
  deployment: Deployment,
  nodeUrl = deployment.nodeUrl,
  identity: { secret: Fr; master: Uint8Array } = { secret: Fr.random(), master: randomBytes(32) },
): Promise<User> {
  const l2 = await openL2(deployment, identity.secret, nodeUrl);
  return {
    ...l2,
    secret: identity.secret,
    master: identity.master,
    scope: {
      chainId: l2.chainId,
      portal: EthAddress.fromString(deployment.portal as string),
      version: l2.rollupVersion,
    },
    deployment,
  };
}

const unwrap = <T>(p: Promise<unknown>): Promise<T> => p.then((r) => (r as { result: T }).result);

export const balanceOf = (u: User, of: AztecAddress = u.from): Promise<bigint> =>
  unwrap<bigint>(u.token.methods.balance_of_private(of).simulate({ from: u.from }));

export async function workProver(): Promise<WorkProver> {
  const api = await Barretenberg.new({
    threads: Math.max(1, cpus().length - 1),
    backend: BackendType.WasmWorker,
  });
  return new BbJsWorkProver(await loadWorkArtifact(), api);
}

/** One real W proof and one real claim: the reward lands in the user's private balance. */
export async function mineOnce(u: User, prover: WorkProver): Promise<bigint> {
  const view = await readOpenEpoch(u.miner, u.from);
  const domain = await deployDomain(u.chainId, u.rollupVersion, u.miner.address.toField(), PARAMS.VERSION);
  const secret = newEpochSecret();
  const winner = await mineEpoch(prover, {
    domain,
    seed: new Fr(view.params.seed),
    epoch: view.epoch,
    secret,
    recipient: u.from.toField(),
    target: view.params.target,
  });
  if (!winner) throw new Error('mining stopped without a winner');
  const claim = buildClaim(u.miner, {
    epoch: view.epoch,
    nonce: winner.nonce,
    out: winner.out,
    secret,
    proofFields: winner.proofFields,
    recipient: u.from,
  });
  const fee = { ...u.fee, gasSettings: { gasLimits: await claimGasLimits(u.node) } };
  await claim.send({ from: u.from, fee, wait: { timeout: 900 } });
  return BigInt(PARAMS.REWARD);
}

export const crossing = (u: User, index: number): Promise<CrossingSecrets> =>
  deriveCrossingSecrets(u.master, u.scope, index);

/** The burn the miner performs on the holder's behalf, authorised for this one call. */
async function burnAuthwit(u: User, amount: bigint) {
  const nonce = Fr.random();
  const call = await u.token.methods.burn_private(u.from, amount, nonce).getFunctionCall();
  const witness = await u.wallet.createAuthWit(u.from, { caller: u.miner.address, call });
  return { nonce, witness };
}

const wait = { timeout: 600 };

export async function sendAhead(u: User, amount: bigint, index: number) {
  const secrets = await crossing(u, index);
  const { nonce, witness } = await burnAuthwit(u, amount);
  const { receipt } = await u.miner.methods
    .send_ahead(amount, secrets.secretHash, secrets.redeemAddress, nonce)
    .send({ from: u.from, fee: u.fee, authWitnesses: [witness], wait });
  return { secrets, txHash: receipt.txHash.toString() };
}

export async function exitToL1(u: User, amount: bigint, recipient: EthAddress, index: number) {
  const secrets = await crossing(u, index);
  const { nonce, witness } = await burnAuthwit(u, amount);
  const { receipt } = await u.miner.methods
    .exit_to_l1(amount, recipient, secrets.tag, nonce)
    .send({ from: u.from, fee: u.fee, authWitnesses: [witness], wait });
  return { secrets, txHash: receipt.txHash.toString() };
}

/** Consumes a deposit or a forwarded send-ahead at Inbox `index` with its secret; mints to `recipient`. */
export async function claimFromL1(
  u: User,
  amount: bigint,
  secret: Fr,
  secretHash: Fr,
  index: bigint,
  recipient: AztecAddress = u.from,
  timeoutSeconds = 600,
) {
  const leaf = claimLeaf(
    { chainId: u.chainId, rollupVersion: u.rollupVersion, miner: u.miner.address, portal: u.scope.portal },
    amount,
    secretHash,
    index,
  );
  await waitForL1ToL2MessageReady(u.node, leaf, { timeoutSeconds });
  const { receipt } = await u.miner.methods
    .claim_from_l1(amount, secret, recipient, index)
    .send({ from: u.from, fee: u.fee, wait });
  return receipt.txHash.toString();
}

/** What the harness sends when a call must fail: the error's first line, or `ok`. */
export const outcome = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'ok',
    (e: Error) => e.message.split('\n')[0] ?? 'error',
  );
