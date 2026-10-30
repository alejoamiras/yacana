import { cn, Input, Segmented } from '@yacana/ui';
import { useEffect, useState } from 'react';
import { tokenAmount } from '../copy';
import type { Chain, FeeFundingProvider, FundingReads, Token } from '../provider';

/** A routed token and what the connected wallet holds of it (zero when it holds none). */
export interface Holding {
  readonly token: Token;
  readonly balance: bigint;
}

/**
 * How the picker lists before a search: the held tokens in one list across chains, the held first
 * with every other routed token under its own heading, or the held under one tab per chain.
 */
export type Layout = 'one-list' | 'held-first' | 'by-chain';

/** The provider's chains, once per provider; empty until they load. */
export function useChains(provider: FeeFundingProvider): readonly Chain[] {
  const [chains, setChains] = useState<readonly Chain[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    provider.chains(ctl.signal).then(
      (c) => !ctl.signal.aborted && setChains(c),
      () => {},
    );
    return () => ctl.abort();
  }, [provider]);
  return chains;
}

/** Every token the provider routes with the wallet's balance of it; undefined until both are read. */
export function useHoldings(
  provider: FeeFundingProvider,
  reads: FundingReads,
  owner: string | undefined,
): readonly Holding[] | undefined {
  const [read, setRead] = useState<{ owner: string; holdings: readonly Holding[] }>();
  useEffect(() => {
    if (!owner) return;
    const ctl = new AbortController();
    provider
      .tokens(ctl.signal)
      .then(async (tokens) => {
        const balances = await reads.balances(owner, tokens, ctl.signal);
        return tokens.map((token, i) => ({ token, balance: balances[i] ?? 0n }));
      })
      .then(
        (holdings) => !ctl.signal.aborted && setRead({ owner, holdings }),
        () => {},
      );
    return () => ctl.abort();
  }, [provider, reads, owner]);
  return read && read.owner === owner ? read.holdings : undefined;
}

export const isHeld = (h: Holding): boolean => h.balance > 0n;

/** By symbol or name, or by address: a pasted address finds the token it is. */
export const matches = (t: Token, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return (
    q === '' ||
    t.symbol.toLowerCase().includes(q) ||
    t.name.toLowerCase().includes(q) ||
    (q.startsWith('0x') && t.address.toLowerCase().startsWith(q))
  );
};

const chainRank = (chains: readonly Chain[], id: number): number => {
  const i = chains.findIndex((c) => c.id === id);
  return i < 0 ? chains.length : i;
};

/** Chain order, then symbol: the same token always sits in the same place. */
const ordered = (chains: readonly Chain[], hs: readonly Holding[]): Holding[] =>
  [...hs].sort(
    (a, b) =>
      chainRank(chains, a.token.chainId) - chainRank(chains, b.token.chainId) ||
      a.token.symbol.localeCompare(b.token.symbol),
  );

/** A search reaches every routed token on every chain, the held first; it is the same in every layout. */
export const searched = (chains: readonly Chain[], hs: readonly Holding[], query: string): Holding[] => {
  const hits = hs.filter((h) => matches(h.token, query));
  return [
    ...ordered(chains, hits.filter(isHeld)),
    ...ordered(
      chains,
      hits.filter((h) => !isHeld(h)),
    ),
  ];
};

/** The chains a by-chain picker tabs: those the wallet holds a routed token on, its own chain first. */
export function chainTabs(chains: readonly Chain[], hs: readonly Holding[], walletChain?: number): Chain[] {
  const held = new Set(hs.filter(isHeld).map((h) => h.token.chainId));
  const tabs = chains.filter((c) => held.has(c.id));
  return [...tabs.filter((c) => c.id === walletChain), ...tabs.filter((c) => c.id !== walletChain)];
}

/** What a layout lists before any search: the held tokens (of one tab's chain in `by-chain`), and the rest in `held-first`. */
export function arranged(
  chains: readonly Chain[],
  hs: readonly Holding[],
  layout: Layout,
  tab?: number,
): { held: Holding[]; rest: Holding[] } {
  const held = ordered(
    chains,
    hs.filter((h) => isHeld(h) && (layout !== 'by-chain' || h.token.chainId === tab)),
  );
  const rest =
    layout === 'held-first'
      ? ordered(
          chains,
          hs.filter((h) => !isHeld(h)),
        )
      : [];
  return { held, rest };
}

function Row({ h, chain, onChoose }: { h: Holding; chain: string; onChoose: (h: Holding) => void }) {
  const held = isHeld(h);
  const { token: t } = h;
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        disabled={!held}
        onClick={() => onChoose(h)}
        className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] enabled:hover:text-ink disabled:opacity-60"
        data-testid={`fees-token-${t.chainId}-${t.symbol}`}
        data-held={held}
      >
        <span className="flex min-w-0 flex-col">
          <b className="font-medium text-ink">{t.symbol}</b>
          <span className="truncate text-xs text-ink-3">
            {t.name} · {chain}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-ink-2">
          {held ? tokenAmount(h.balance, t.decimals) : 'not in this wallet'}
        </span>
      </button>
    </li>
  );
}

export function TokenPicker({
  holdings,
  chains,
  layout,
  walletChain,
  onChoose,
  className,
}: {
  /** Undefined while the wallet's balances are read. */
  holdings: readonly Holding[] | undefined;
  chains: readonly Chain[];
  layout: Layout;
  /** The chain the wallet is on: a by-chain picker opens on it. */
  walletChain?: number;
  onChoose: (h: Holding) => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number>();
  const chainName = (id: number) => chains.find((c) => c.id === id)?.name ?? `chain ${id}`;
  const searching = query.trim() !== '';
  const hs = holdings ?? [];
  const tabs = layout === 'by-chain' ? chainTabs(chains, hs, walletChain) : [];
  const tab = picked !== undefined && tabs.some((c) => c.id === picked) ? picked : tabs[0]?.id;
  const { held, rest } = arranged(chains, hs, layout, tab);
  const found = searching ? searched(chains, hs, query) : [];
  const row = (h: Holding) => (
    <Row
      key={`${h.token.chainId}:${h.token.address}`}
      h={h}
      chain={chainName(h.token.chainId)}
      onChoose={onChoose}
    />
  );
  return (
    // Inside a dialog capped to the window the lists scroll on their own, so the search above and what
    // follows the picker stay in view; it never shrinks below the search and two rows, and past that the
    // dialog itself scrolls.
    <div className={cn('flex min-h-40 flex-col gap-3', className)} data-testid="fees-picker">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every token that buys Fee Juice, or paste an address"
        aria-label="Search tokens"
        autoComplete="off"
        spellCheck={false}
        data-testid="fees-search"
      />
      {holdings === undefined && <p className="text-xs text-ink-3">Reading what your wallet holds…</p>}
      {holdings !== undefined && !searching && hs.every((h) => !isHeld(h)) && (
        <p className="text-xs text-ink-2" data-testid="fees-picker-empty">
          This wallet holds nothing that buys Fee Juice.{' '}
          {layout === 'held-first' ? 'What would is listed below.' : 'Search to see what does.'}
        </p>
      )}
      {!searching && tabs.length > 1 && tab !== undefined && (
        <Segmented
          aria-label="Chain"
          value={String(tab)}
          onChange={(v) => setPicked(Number(v))}
          options={tabs.map((c) => ({ value: String(c.id), label: c.name }))}
          className="self-start"
        />
      )}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto" data-testid="fees-token-list">
        <ul className="m-0 flex list-none flex-col p-0">{(searching ? found : held).map(row)}</ul>
        {!searching && rest.length > 0 && (
          <>
            <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">Not in this wallet</p>
            <ul className="m-0 flex list-none flex-col p-0">{rest.map(row)}</ul>
          </>
        )}
        {searching && found.length === 0 && (
          <p className="text-xs text-ink-3">No token that buys Fee Juice matches “{query.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
