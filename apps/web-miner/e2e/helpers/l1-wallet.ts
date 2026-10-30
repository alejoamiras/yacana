// An injected EIP-1193 wallet for the page, answered from Node: `window.ethereum` (and an EIP-6963
// announcement, so wagmi's picker lists it by name) forwards every request through an exposed
// function to a viem wallet client over the run's anvil, signing with a key that never enters the
// page. The wrong-chain, refusal, open-prompt and account-change cells drive it through the control
// it returns. Modelled on nulo's tools fixture; no code shared.
import { type BrowserContext, expect, type Page } from '@playwright/test';
import { type Address, createWalletClient, defineChain, type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface L1WalletOptions {
  rpcUrl: string;
  privateKey: Hex;
  /** The chain the wallet reports at first; a page asking for another gets a `wallet_switchEthereumChain`. */
  chainId: number;
  name?: string;
}

export type RejectKind = 'signature' | 'transaction';

export interface L1WalletControl {
  readonly address: Address;
  /** How often the page asked for one wallet-side method, held and refused calls included. */
  calls(method: string): number;
  /** Every method the page asked, in order, before any is answered: node reads included. */
  asked(): readonly string[];
  /** The chain `eth_chainId` answers; a change emits `chainChanged` in every page of the context. */
  setChainId(chainId: number): Promise<void>;
  /** Swaps the signing key; emits `accountsChanged`. */
  setAccount(privateKey: Hex): Promise<void>;
  /** The next request of that kind is refused with EIP-1193 code 4001. */
  rejectNext(kind: RejectKind): void;
  /**
   * The next request of that kind (to `to` when given) never answers — a wallet whose prompt the
   * user left open; the page that made it must be reloaded to get past it.
   */
  holdNext(kind: RejectKind, match?: { to?: Address }): void;
  /** Holds still armed: zero once the held request arrived and parked. */
  holdsArmed(): number;
}

type Rpc = { method: string; params?: unknown[] };

const USER_REJECTED = { code: 4001, message: 'User rejected the request.' };
export const WALLET_NAME = 'Yacana test wallet';
const ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#7c5cff"/></svg>')}`;

/** JSON turned every bigint into a string on the way over; the ABI types say which ones to restore. */
function coerceTyped(
  types: Record<string, { name: string; type: string }[]>,
  type: string,
  value: unknown,
): unknown {
  const fields = types[type];
  if (!fields || typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (value as Record<string, unknown>)[f.name];
    if (/^u?int\d*$/.test(f.type)) out[f.name] = typeof v === 'string' ? BigInt(v) : v;
    else if (f.type.endsWith('[]'))
      out[f.name] = Array.isArray(v) ? v.map((x) => coerceTyped(types, f.type.slice(0, -2), x)) : v;
    else out[f.name] = coerceTyped(types, f.type, v);
  }
  return out;
}

/** The `eth_signTypedData_v4` payload as viem signs it: the domain's chain id numeric, `EIP712Domain` out of `types`. */
function typedDataOf(json: string) {
  const typed = JSON.parse(json) as {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  const domain = {
    ...typed.domain,
    chainId: typed.domain.chainId === undefined ? undefined : Number(typed.domain.chainId),
  };
  const { EIP712Domain: _domain, ...types } = typed.types;
  return {
    domain,
    types,
    primaryType: typed.primaryType,
    message: coerceTyped(types, typed.primaryType, typed.message) as Record<string, unknown>,
  };
}

export async function installL1Wallet(context: BrowserContext, o: L1WalletOptions): Promise<L1WalletControl> {
  const chain = (id: number) =>
    defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [o.rpcUrl] } },
    });
  let account = privateKeyToAccount(o.privateKey);
  let chainId = o.chainId;
  let client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) });
  // As a real wallet: `eth_accounts` is empty until the page asked once; from then on (reloads
  // included) wagmi reconnects on its own, which is what a returning user sees.
  let authorized = false;
  const rejections = new Set<RejectKind>();
  const holds: { kind: RejectKind; to?: Address }[] = [];
  const counts: Record<string, number> = {};
  const log: string[] = [];
  const count = (method: string) => {
    counts[method] = (counts[method] ?? 0) + 1;
  };
  const refuse = (kind: RejectKind) => {
    if (rejections.delete(kind)) throw USER_REJECTED;
  };
  /** A matching hold is consumed and the call parks forever; a hold for another target stays armed. */
  const takeHold = (kind: RejectKind, to?: string): Promise<never> | undefined => {
    const i = holds.findIndex(
      (h) => h.kind === kind && (h.to === undefined || h.to.toLowerCase() === to?.toLowerCase()),
    );
    if (i < 0) return undefined;
    holds.splice(i, 1);
    return new Promise<never>(() => {});
  };
  const emit = (event: string, payload: unknown) =>
    Promise.all(
      context
        .pages()
        .map((p) =>
          p.evaluate(([e, v]) => window.__yacanaL1Emit?.(e, v), [event, payload] as const).catch(() => {}),
        ),
    );
  const switchChain = async (id: number) => {
    chainId = id;
    client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) });
    await emit('chainChanged', `0x${id.toString(16)}`);
  };

  /** The wallet-side methods; anything else is a node read, proxied to anvil as-is. */
  const wallet: Record<string, (params: unknown[]) => Promise<unknown>> = {
    eth_requestAccounts: async () => {
      authorized = true;
      return [account.address];
    },
    eth_accounts: async () => (authorized ? [account.address] : []),
    eth_chainId: async () => `0x${chainId.toString(16)}`,
    wallet_switchEthereumChain: async (params) => {
      count('wallet_switchEthereumChain');
      await switchChain(Number.parseInt((params[0] as { chainId: string }).chainId, 16));
      return null;
    },
    wallet_addEthereumChain: async (params) => {
      await switchChain(Number.parseInt((params[0] as { chainId: string }).chainId, 16));
      return null;
    },
    wallet_requestPermissions: async () => [{ parentCapability: 'eth_accounts' }],
    wallet_revokePermissions: async () => {
      authorized = false;
      return null;
    },
    eth_sendTransaction: (params) => {
      count('eth_sendTransaction');
      refuse('transaction');
      const tx = params[0] as { to?: Address; data?: Hex; value?: Hex; gas?: Hex };
      const held = takeHold('transaction', tx.to);
      if (held) return held;
      return client.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    },
    eth_signTypedData_v4: (params) => {
      count('eth_signTypedData_v4');
      refuse('signature');
      const held = takeHold('signature');
      if (held) return held;
      return account.signTypedData(typedDataOf(params[1] as string));
    },
    personal_sign: (params) => {
      count('personal_sign');
      refuse('signature');
      const held = takeHold('signature');
      if (held) return held;
      return account.signMessage({ message: { raw: params[0] as Hex } });
    },
  };
  const handle = (rpc: Rpc) => {
    const params = rpc.params ?? [];
    const method = wallet[rpc.method];
    return method ? method(params) : client.request({ method: rpc.method, params } as never);
  };

  // YACANA_E2E_TRACE_L1=1 prints every request and its outcome to the runner's stdout.
  const trace =
    process.env.YACANA_E2E_TRACE_L1 === '1' ? (line: string) => console.log(`[l1] ${line}`) : () => {};
  await context.exposeFunction('__yacanaL1Request', async (json: string) => {
    const rpc = JSON.parse(json) as Rpc;
    log.push(rpc.method);
    try {
      const result = await handle(rpc);
      trace(`${rpc.method} → ${JSON.stringify(result)?.slice(0, 80)}`);
      return JSON.stringify({ result });
    } catch (e) {
      const err = e as { code?: number; message?: string; shortMessage?: string };
      trace(`${rpc.method} ✗ ${err.shortMessage ?? err.message ?? String(e)}`);
      return JSON.stringify({
        error: { code: err.code ?? -32000, message: err.shortMessage ?? err.message ?? String(e) },
      });
    }
  });
  await context.addInitScript(
    ({ name, icon }: { name: string; icon: string }) => {
      const listeners = new Map<string, Set<(v: unknown) => void>>();
      const provider = {
        isYacanaTestWallet: true,
        async request(args: { method: string; params?: unknown[] }) {
          const reply = JSON.parse(await window.__yacanaL1Request(JSON.stringify(args))) as {
            result?: unknown;
            error?: { code: number; message: string };
          };
          if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
          return reply.result;
        },
        on(event: string, fn: (v: unknown) => void) {
          listeners.set(event, (listeners.get(event) ?? new Set()).add(fn));
          return provider;
        },
        removeListener(event: string, fn: (v: unknown) => void) {
          listeners.get(event)?.delete(fn);
          return provider;
        },
      };
      window.__yacanaL1Emit = (event, value) => {
        for (const fn of listeners.get(event) ?? []) fn(value);
      };
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: false });
      // EIP-6963: announced now and on every request, so a picker mounted later still lists it.
      const info = Object.freeze({
        uuid: crypto.randomUUID(),
        name,
        icon,
        rdns: 'network.yacana.testwallet',
      });
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }),
        );
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    },
    { name: o.name ?? WALLET_NAME, icon: ICON },
  );

  return {
    get address() {
      return account.address;
    },
    calls: (method) => counts[method] ?? 0,
    asked: () => [...log],
    setChainId: switchChain,
    async setAccount(privateKey) {
      account = privateKeyToAccount(privateKey);
      client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) });
      await emit('accountsChanged', [account.address]);
    },
    rejectNext(kind) {
      rejections.add(kind);
    },
    holdNext(kind, match) {
      holds.push({ kind, ...(match?.to ? { to: match.to } : {}) });
    },
    holdsArmed: () => holds.length,
  };
}

/** The test wallet connected in the open sheet: picked from the list, or already back through wagmi's reconnect. */
export async function connectTestWallet(page: Page): Promise<void> {
  const row = page.getByTestId('eth-account');
  // wagmi may still be reconnecting a wallet the page connected before: the picker or the row, then.
  await expect(row.or(page.getByTestId('wallet-picker'))).toBeVisible({ timeout: 30_000 });
  if (!(await row.isVisible())) {
    // One installed wallet is one "Connect wallet" button; several are listed by name.
    const options = page.getByTestId('wallet-option');
    await ((await options.count()) === 1
      ? options.first()
      : options.filter({ hasText: WALLET_NAME })
    ).click();
  }
  // The connected row is the account's chip (its short address), not the wallet's name.
  await expect(row).toContainText(/0x[0-9a-fA-F]{4,}…[0-9a-fA-F]{4}/);
}

declare global {
  interface Window {
    __yacanaL1Request: (json: string) => Promise<string>;
    __yacanaL1Emit?: (event: string, value: unknown) => void;
  }
}
