// What the connected Ethereum wallet can pay, read before it is asked, so "no ETH for the gas" is
// the page's own sentence and not the wallet's error. Either number may be unreadable, and unknown
// is null, never zero: a wallet that might have paid must not be refused.
import { INBOX_BUCKET_GAS } from '@yacana/bridge/inbox';
import type { Abi, ContractFunctionArgs, ContractFunctionName, Hex } from 'viem';
import { estimateContractGas } from 'viem/actions';
import { estimateFeesPerGas, getBalance, getPublicClient } from 'wagmi/actions';
import type { WagmiConfig } from './eth.ts';

export interface PayerFunds {
  /** Wei the wallet holds on the portal's chain. */
  balance: bigint | null;
  /** Wei the call would cost at the fee the RPC quotes now. */
  cost: bigint | null;
  /** Null until both are known. */
  enough: boolean | null;
}

export const UNKNOWN_FUNDS: PayerFunds = { balance: null, cost: null, enough: null };

export interface PortalCall<
  abi extends Abi,
  name extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
> {
  address: Hex;
  abi: abi;
  functionName: name;
  args: ContractFunctionArgs<abi, 'nonpayable' | 'payable', name>;
}

/** The payer's ETH against `call`'s cost from `account`; a call that cannot be estimated leaves the cost unknown. */
export async function payerFunds<
  abi extends Abi,
  name extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
>(config: WagmiConfig, account: Hex, call: PortalCall<abi, name> | undefined): Promise<PayerFunds> {
  if (!getPublicClient(config)) return UNKNOWN_FUNDS;
  const balance = await getBalance(config, { address: account })
    .then((b) => b.value)
    .catch(() => null);
  const cost = call ? await costOf(config, account, call).catch(() => null) : null;
  return { balance, cost, enough: balance === null || cost === null ? null : balance >= cost };
}

async function costOf<abi extends Abi, name extends ContractFunctionName<abi, 'nonpayable' | 'payable'>>(
  config: WagmiConfig,
  account: Hex,
  call: PortalCall<abi, name>,
): Promise<bigint> {
  const [gas, fees] = await Promise.all([
    inboxWriteGas(config, account, call).then((g) => g ?? estimateCall(config, account, call)),
    estimateFeesPerGas(config),
  ]);
  return gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
}

/** Whether the portal sends an Inbox message on `call`: a deposit, or a send-ahead's forward. */
const writesInbox = (call: { functionName: string; args: readonly unknown[] }): boolean =>
  call.functionName === 'deposit' ||
  (call.functionName === 'forward' && (call.args[1] as { kind?: number } | undefined)?.kind === 2);

/**
 * The gas limit the page names for a write that sends an Inbox message, and prices its payer at: the
 * estimate plus `INBOX_BUCKET_GAS`. Undefined for any other call, whose wallet estimates it as usual.
 */
export async function inboxWriteGas<
  abi extends Abi,
  name extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
>(config: WagmiConfig, account: Hex, call: PortalCall<abi, name>): Promise<bigint | undefined> {
  if (!writesInbox(call as { functionName: string; args: readonly unknown[] })) return undefined;
  return (await estimateCall(config, account, call)) + INBOX_BUCKET_GAS;
}

/** Through the ABI, so a refusal is the portal's named error, as the wallet's own estimate made it. */
function estimateCall<abi extends Abi, name extends ContractFunctionName<abi, 'nonpayable' | 'payable'>>(
  config: WagmiConfig,
  account: Hex,
  call: PortalCall<abi, name>,
): Promise<bigint> {
  const client = getPublicClient(config);
  if (!client) throw new Error("no RPC for the portal's chain");
  return estimateContractGas(client, { ...call, account } as never);
}
