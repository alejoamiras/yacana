// The operator's side of the bridge: one deployment record, one Ethereum connection, the portal
// and YACA typed. Every command the runbook names is a function in this directory, so the calls
// the harness exercises are the ones an operator runs. Reads need no key; a write needs
// YACANA_L1_PRIVATE_KEY — the operators key, or a listed forwarder's for forwards.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RegistryAbi } from '@aztec-foundation/l1-artifacts/RegistryAbi';
import { yacaAbi, yacanaPortalAbi } from '@yacana/bridge/portal';
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import type { BridgeRecord, Deployment } from '../deploy.ts';

const repo = resolve(import.meta.dir, '../../../..');

export type BridgedDeployment = Deployment & { bridge: BridgeRecord };

export interface OperatorOptions {
  /** The deployment record, relative to the repo root; its `bridge` block names the portal. */
  record: string;
  /** Overrides the record's L1 RPC (a local anvil, a private endpoint). */
  rpcUrl?: string;
  /** The signer for writes; reads work without one. */
  key?: Hex;
}

export interface Operator {
  recordPath: string;
  record: BridgedDeployment;
  chain: Chain;
  publicClient: PublicClient;
  account?: PrivateKeyAccount;
  portal: ReturnType<typeof portalContract>;
  yaca: ReturnType<typeof yacaContract>;
  registry: ReturnType<typeof registryContract>;
}

// Always a wallet client, so every contract carries `write`; without a key it has no account and
// `confirmed` refuses before anything is sent.
type Clients = { public: PublicClient; wallet: WalletClient };
const portalContract = (address: Hex, client: Clients) =>
  getContract({ address, abi: yacanaPortalAbi, client });
const yacaContract = (address: Hex, client: Clients) => getContract({ address, abi: yacaAbi, client });
const registryContract = (address: Hex, client: Clients) =>
  getContract({ address, abi: RegistryAbi, client });

export const loadRecord = (path: string): BridgedDeployment => {
  const record = JSON.parse(readFileSync(resolve(repo, path), 'utf8')) as Deployment;
  if (!record.bridge) throw new Error(`${path} has no bridge block: run the L1 deploy script first`);
  return record as BridgedDeployment;
};

export async function openOperator(opts: OperatorOptions): Promise<Operator> {
  const record = loadRecord(opts.record);
  const rpcUrl = opts.rpcUrl ?? record.bridge.l1RpcUrl;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (String(chainId) !== record.bridge.chainId)
    throw new Error(`${rpcUrl} is chain ${chainId}; the record's bridge is on ${record.bridge.chainId}`);
  const chain = defineChain({
    id: chainId,
    name: `chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = opts.key ? privateKeyToAccount(opts.key) : undefined;
  const wallet = createWalletClient({ ...(account ? { account } : {}), chain, transport: http(rpcUrl) });
  const clients: Clients = { public: publicClient, wallet };
  return {
    recordPath: opts.record,
    record,
    chain,
    publicClient,
    ...(account ? { account } : {}),
    portal: portalContract(record.bridge.portal as Hex, clients),
    yaca: yacaContract(record.bridge.yaca as Hex, clients),
    registry: registryContract(record.bridge.registry as Hex, clients),
  };
}

/** The operator from the environment: YACANA_RECORD (default the profile's), YACANA_L1_RPC_URL, YACANA_L1_PRIVATE_KEY. */
export const operatorFromEnv = (profile: string): Promise<Operator> =>
  openOperator({
    record: process.env.YACANA_RECORD ?? `deployments/${profile}.json`,
    ...(process.env.YACANA_L1_RPC_URL ? { rpcUrl: process.env.YACANA_L1_RPC_URL } : {}),
    ...(process.env.YACANA_L1_PRIVATE_KEY ? { key: process.env.YACANA_L1_PRIVATE_KEY as Hex } : {}),
  });

export const writeOpts = (op: Operator) => ({ account: op.account as PrivateKeyAccount, chain: op.chain });

/** A write's receipt, or a clear refusal when the operator was opened without a key. */
export async function confirmed(op: Operator, send: () => Promise<Hex>): Promise<Hex> {
  if (!op.account) throw new Error('this command writes to Ethereum: set YACANA_L1_PRIVATE_KEY');
  const hash = await send();
  const receipt = await op.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return hash;
}

/** The Registry index whose version is `version`, or undefined when the Registry has not seen it. */
export async function registryIndexOf(op: Operator, version: bigint): Promise<bigint | undefined> {
  const count = await op.registry.read.numberOfVersions();
  for (let i = 0n; i < count; i++) {
    if ((await op.registry.read.getVersion([i])) === version) return i;
  }
  return undefined;
}

/** The miner address as the portal stores it: the Aztec address's 32 bytes. */
export const minerBytes32 = (record: Deployment): Hex => {
  const hex = record.miner.replace(/^0x/, '').toLowerCase();
  return `0x${hex.padStart(64, '0')}`;
};
