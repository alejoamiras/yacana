// The Ethereum side from the page: wagmi's injected connector with EIP-6963 discovery (every
// installed wallet by name and icon, no WalletConnect) over the hoisted viem, the four writes a
// holder makes (deposit, forward, redeem, note a transition), and the portal's reads over
// the RPC in use, which need no wallet at all. Gas comes from the injected wallet, except for a write
// that sends an Inbox message (`inboxWriteGas`); the redeem key's signatures are made in `flows.ts`,
// never by the wallet.

import { type ForwardArgs, yacanaPortalAbi } from '@yacana/bridge/portal';
import { type Chain, type ContractFunctionArgs, defineChain, type Hex, parseEventLogs } from 'viem';
import { createConfig, http, injected } from 'wagmi';
import { getAccount, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { inboxWriteGas } from './eth-balance.ts';

export interface EthSettings {
  chainId: number;
  rpcUrl: string;
  /** The explorer's origin, or undefined for none. */
  explorerUrl?: string;
}

const NAMES: Record<number, string> = { 1: 'Ethereum', 11155111: 'Sepolia', 31337: 'Local Ethereum' };

export const bridgeChain = (s: EthSettings): Chain =>
  defineChain({
    id: s.chainId,
    name: NAMES[s.chainId] ?? `chain ${s.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [s.rpcUrl] } },
    ...(s.explorerUrl ? { blockExplorers: { default: { name: 'Explorer', url: s.explorerUrl } } } : {}),
  });

/** One chain, the page's RPC for reads, every injected wallet the browser announces as a connector. */
export const wagmiConfigFor = (s: EthSettings) => {
  const chain = bridgeChain(s);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(s.rpcUrl, { retryCount: 0 }) },
    multiInjectedProviderDiscovery: true,
  });
};
export type WagmiConfig = ReturnType<typeof wagmiConfigFor>;

/** The struct as the ABI types it; `ForwardArgs` is the same shape, spelled once for the whole client. */
type PortalForwardArgs = ContractFunctionArgs<typeof yacanaPortalAbi, 'nonpayable', 'forward'>[1];
const asPortalArgs = (a: ForwardArgs): PortalForwardArgs =>
  ({ ...a, kind: a.kind as number }) as PortalForwardArgs;

/** The connected account, or an error that names the missing step. */
export function connectedAccount(config: WagmiConfig): Hex {
  const { address, isConnected } = getAccount(config);
  if (!isConnected || !address) throw new Error('connect an Ethereum wallet first');
  return address;
}

/**
 * Asks the wallet to move to the portal's chain when it is elsewhere. The connection's chain, not
 * the config's: a wallet on a chain the config does not list leaves the config on its own chain.
 */
export async function ensureChain(config: WagmiConfig, chainId: number): Promise<void> {
  if (getAccount(config).chainId !== chainId) await switchChain(config, { chainId });
}

/**
 * The account and chain a write is pinned to. Named on every write: wagmi skips the chain check
 * when no `chainId` is given, so a wallet switched during a prompt would sign the next request
 * elsewhere or as someone else instead of failing.
 */
async function pinnedSigner(config: WagmiConfig): Promise<{ account: Hex; chainId: number }> {
  const account = connectedAccount(config);
  const chainId = config.chains[0].id;
  await ensureChain(config, chainId);
  return { account, chainId };
}

const mined = async (config: WagmiConfig, hash: Hex) => {
  const receipt = await waitForTransactionReceipt(config, { hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return receipt;
};

export interface DepositParams {
  portal: Hex;
  amount: bigint;
  secretHash: Hex;
  version: bigint;
  /** Unix seconds after which the portal refuses it: the review's own stale bound. */
  deadline: bigint;
}

/** The three holder calls as viem takes them: written by the wallet, estimated for the payer's funds first. */
export const depositCall = (p: DepositParams) =>
  ({
    address: p.portal,
    abi: yacanaPortalAbi,
    functionName: 'deposit',
    args: [p.amount, p.secretHash, p.version, p.deadline],
  }) as const;
export const forwardCall = (p: { portal: Hex; version: bigint; args: ForwardArgs }) =>
  ({
    address: p.portal,
    abi: yacanaPortalAbi,
    functionName: 'forward',
    args: [p.version, asPortalArgs(p.args)],
  }) as const;
export const redeemCall = (p: {
  portal: Hex;
  version: bigint;
  args: ForwardArgs;
  recipient: Hex;
  expiry: bigint;
  sig: Hex;
}) =>
  ({
    address: p.portal,
    abi: yacanaPortalAbi,
    functionName: 'redeem',
    args: [
      p.version,
      asPortalArgs({ ...p.args, expiry: p.expiry, sig: p.sig }),
      p.recipient,
      p.expiry,
      p.sig,
    ],
  }) as const;

/**
 * A deposit is one transaction from the wallet: the portal burns the sender's YACA itself (the
 * token's burn is the portal's alone and spends no allowance), and the event names the Inbox
 * message the claim consumes.
 */
export async function depositOnEthereum(
  config: WagmiConfig,
  p: DepositParams,
  onStep?: (step: 'deposit') => void,
  onSent?: (txHash: Hex) => Promise<void>,
): Promise<{ txHash: Hex; inboxIndex: bigint }> {
  const signer = await pinnedSigner(config);
  onStep?.('deposit');
  const call = depositCall(p);
  const gas = await inboxWriteGas(config, signer.account, call);
  const txHash = await writeContract(config, { ...signer, ...call, gas });
  await onSent?.(txHash);
  const receipt = await mined(config, txHash);
  const [deposited] = parseEventLogs({ abi: yacanaPortalAbi, eventName: 'Deposited', logs: receipt.logs });
  if (!deposited) throw new Error(`deposit ${txHash} emitted no Deposited event`);
  return { txHash, inboxIndex: deposited.args.inboxIndex };
}

/** The holder's own forward: `args.sig` carries the redeem key's signature; the wallet pays the gas. */
export async function forwardOnEthereum(
  config: WagmiConfig,
  p: { portal: Hex; version: bigint; args: ForwardArgs },
): Promise<{ txHash: Hex; inboxIndex: bigint; target: bigint }> {
  const signer = await pinnedSigner(config);
  const call = forwardCall(p);
  const gas = await inboxWriteGas(config, signer.account, call);
  const txHash = await writeContract(config, { ...signer, ...call, gas });
  const receipt = await mined(config, txHash);
  const [forwarded] = parseEventLogs({ abi: yacanaPortalAbi, eventName: 'Forwarded', logs: receipt.logs });
  if (!forwarded) throw new Error(`forward ${txHash} emitted no Forwarded event`);
  return { txHash, inboxIndex: forwarded.args.inboxIndex, target: forwarded.args.target };
}

export async function redeemOnEthereum(
  config: WagmiConfig,
  p: { portal: Hex; version: bigint; args: ForwardArgs; recipient: Hex; expiry: bigint; sig: Hex },
): Promise<{ txHash: Hex }> {
  const txHash = await writeContract(config, { ...(await pinnedSigner(config)), ...redeemCall(p) });
  await mined(config, txHash);
  return { txHash };
}

/** Records a Registry transition the portal has not seen; anyone may, and a forward after a flip must. */
export async function noteTransitionOnEthereum(
  config: WagmiConfig,
  portal: Hex,
  index: bigint,
): Promise<Hex> {
  const txHash = await writeContract(config, {
    ...(await pinnedSigner(config)),
    address: portal,
    abi: yacanaPortalAbi,
    functionName: 'noteTransition',
    args: [index],
  });
  await mined(config, txHash);
  return txHash;
}

export {
  type PortalAddresses,
  type PortalReader,
  portalReader,
  type VersionStanding,
} from '@yacana/bridge/portal-reader';
