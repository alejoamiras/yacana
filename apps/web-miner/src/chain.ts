// Everything that touches a node: the deployment's contracts on a wallet, epoch reads, the claim
// and roll transactions.
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import { type createAztecNodeClient, waitForTx } from '@aztec/aztec.js/node';
import type { ContractArtifact } from '@aztec/stdlib/abi';
import type { Gas } from '@aztec/stdlib/gas';
import { type TxEffect, TxStatus } from '@aztec/stdlib/tx';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';
import { buildClaim } from '@yacana/miner-core/claim';
import { NO_EFFECTS } from '@yacana/miner-core/claim-failure';
import { readOpenEpoch, readRules } from '@yacana/miner-core/epoch';
import type { EpochInfo } from './lib/reducer';
import type { ProverSaid, SentTx, Turn } from './wallet';

export type Node = ReturnType<typeof createAztecNodeClient>;

export interface Fee {
  paymentMethod: { getAsset(): unknown } & object;
  gasSettings: { gasLimits: Gas };
}

export interface Deployment {
  node: Node;
  miner: Contract;
  token: Contract;
  /** The last transaction the wallet behind `miner` handed to the node. */
  lastSent: () => SentTx | undefined;
  /** The wallet's turns (`wallet.ts`); absent on a deployment with no observed wallet. */
  turn?: Turn;
}

/** A send takes the wallet's turn where there is one to take. */
const turnOf = (d: Deployment): Turn => d.turn ?? ((op) => op());

export const loadArtifact = async (name: string): Promise<ContractArtifact> =>
  loadContractArtifact(await (await fetch(`/artifacts/${name}.json`)).json());

/** Registers the miner and token instances (fetched from the node) with the wallet. */
export async function attachDeployment(
  wallet: EmbeddedWallet,
  node: Node,
  addresses: { miner: string; token: string },
  minerArtifact: ContractArtifact,
  lastSent: () => SentTx | undefined = () => undefined,
  turn?: Turn,
): Promise<Deployment> {
  const tokenArtifact = await loadArtifact('token_contract-Token');
  const contracts = [] as Contract[];
  for (const [address, art] of [
    [addresses.miner, minerArtifact],
    [addresses.token, tokenArtifact],
  ] as const) {
    const at = AztecAddress.fromStringUnsafe(address);
    const instance = await node.getContract(at);
    if (!instance) throw new Error(`no contract at ${address} on this node`);
    await wallet.registerContract(instance, art);
    contracts.push(Contract.at(at, art, wallet));
  }
  const [miner, token] = contracts as [Contract, Contract];
  return { node, miner, token, lastSent, ...(turn ? { turn } : {}) };
}

export const readEpoch = async (d: Deployment, from: AztecAddress): Promise<EpochInfo> => {
  const v = await readOpenEpoch(d.miner, from);
  return {
    epoch: v.epoch,
    seed: v.params.seed,
    target: v.params.target,
    openedAt: v.params.openedAt,
    claims: v.claims,
  };
};

export const readEpochRules = (d: Deployment, from: AztecAddress) => readRules(d.miner, from);

export interface ClaimArgs {
  epoch: bigint;
  nonce: bigint;
  out: string;
  secret: string;
  proofFields: string[];
  recipient: AztecAddress;
}

export interface ClaimSent {
  txHash: string;
  /** Unix seconds; the sequencer drops the claim past this. Unknown if the send was not observed. */
  expiresAt: number | undefined;
  /** Resolves once the claim is in a proposed block, with that transaction's effects. */
  wait(): Promise<{ block: number; effect: TxEffect }>;
}

const CLAIM_WAIT_S = 900;

/**
 * Proves the claim in-page and hands it to the node; inclusion is a separate wait. `sent` hears the
 * transaction as it leaves, before the node answers (only where the wallet takes turns): a send the
 * node then refuses, or whose answer is lost, is still known.
 */
export async function sendClaim(
  d: Deployment,
  from: AztecAddress,
  fee: Fee,
  c: ClaimArgs,
  own: { said?: ProverSaid; sent?: (tx: SentTx) => void } = {},
): Promise<ClaimSent> {
  const interaction = buildClaim(d.miner, {
    epoch: c.epoch,
    nonce: c.nonce,
    out: Fr.fromString(c.out),
    secret: Fr.fromString(c.secret),
    proofFields: c.proofFields.map((f) => Fr.fromString(f)),
    recipient: c.recipient,
  });
  const { sent: onSent, said } = own;
  const { txHash } = await turnOf(d)(() => interaction.send({ from, fee: fee as never, wait: NO_WAIT }), {
    said,
    ...(onSent && { hook: async (tx: SentTx) => onSent(tx) }),
  });
  const sent = d.lastSent();
  return {
    txHash: txHash.toString(),
    expiresAt: sent?.txHash === txHash.toString() ? sent.expiresAt : undefined,
    wait: async () => {
      await waitForTx(d.node, txHash, {
        timeout: CLAIM_WAIT_S,
        initialDelay: 1,
        waitForStatus: TxStatus.PROPOSED,
      });
      const receipt = await d.node.getTxReceipt(txHash, { includeTxEffect: true });
      if (!receipt.txEffect) throw new Error(`${NO_EFFECTS} ${txHash.toString()}`);
      return { block: Number(receipt.blockNumber ?? 0), effect: receipt.txEffect };
    },
  };
}
export const sendRoll = async (d: Deployment, from: AztecAddress, fee: Fee): Promise<void> => {
  await turnOf(d)(() => d.miner.methods.roll().send({ from, fee: fee as never, wait: { timeout: 900 } }));
};

export const readBalance = async (d: Deployment, from: AztecAddress): Promise<bigint> =>
  ((await d.token.methods.balance_of_private(from).simulate({ from })) as { result: bigint }).result;

export const readPublicBalance = async (
  d: Deployment,
  from: AztecAddress,
  owner: AztecAddress,
): Promise<bigint> =>
  ((await d.token.methods.balance_of_public(owner).simulate({ from })) as { result: bigint }).result;

export interface Withdrawal {
  to: AztecAddress;
  amount: bigint;
  /** private: notes to the recipient, nothing public. public: recipient and amount on chain. */
  mode: 'private' | 'public';
}

export interface Sent {
  block: number;
  txHash: string;
}

/** The token's transfer from private balance; nonce 0 (a self-call needs no authwit). */
export async function sendWithdraw(
  d: Deployment,
  from: AztecAddress,
  fee: Fee,
  w: Withdrawal,
  said?: ProverSaid,
): Promise<Sent> {
  const call =
    w.mode === 'private'
      ? d.token.methods.transfer_private_to_private(from, w.to, w.amount, 0)
      : d.token.methods.transfer_private_to_public(from, w.to, w.amount, 0);
  const sent = await turnOf(d)(() => call.send({ from, fee: fee as never, wait: { timeout: 900 } }), {
    said,
  });
  const receipt = (sent as { receipt?: { blockNumber?: number; txHash?: { toString(): string } } }).receipt;
  return { block: Number(receipt?.blockNumber ?? 0), txHash: receipt?.txHash?.toString() ?? '' };
}

/**
 * Whether anything knows `to` as a contract: a private transfer to an address nobody has deployed
 * mints notes nobody can read. Knowing the instance is not knowing that its owner syncs.
 */
export async function recipientKnown(wallet: EmbeddedWallet, node: Node, to: AztecAddress): Promise<boolean> {
  const meta = await wallet.getContractMetadata(to).catch(() => undefined);
  if (meta?.instance) return true;
  return (await node.getContract(to)) !== undefined;
}
