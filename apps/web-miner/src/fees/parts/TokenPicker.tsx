import { cn, Input, Segmented } from '@yacana/ui';
import { useEffect, useState } from 'react';
import { tokenAmount } from '../copy';
import type { Chain, FeeFundingProvider, Token } from '../provider';

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

function useTokens(provider: FeeFundingProvider, chainId: number | undefined): readonly Token[] | undefined {
  const [loaded, setLoaded] = useState<{ chainId: number; tokens: readonly Token[] }>();
  useEffect(() => {
    if (chainId === undefined) return;
    const ctl = new AbortController();
    provider.tokens(chainId, ctl.signal).then(
      (tokens) => !ctl.signal.aborted && setLoaded({ chainId, tokens }),
      () => {},
    );
    return () => ctl.abort();
  }, [provider, chainId]);
  return loaded && loaded.chainId === chainId ? loaded.tokens : undefined;
}

const matches = (t: Token, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return q === '' || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
};

/** A chain, a search, the tokens the wallet holds there. */
export function TokenPicker({
  provider,
  chains,
  onChoose,
  className,
}: {
  provider: FeeFundingProvider;
  chains: readonly Chain[];
  onChoose: (token: Token) => void;
  className?: string;
}) {
  const [picked, setPicked] = useState<number>();
  const [query, setQuery] = useState('');
  const chainId = picked ?? chains[0]?.id;
  const tokens = useTokens(provider, chainId);
  const shown = tokens?.filter((t) => matches(t, query));
  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="fees-picker">
      {chainId !== undefined && (
        <Segmented
          aria-label="Chain"
          value={String(chainId)}
          onChange={(v) => setPicked(Number(v))}
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          className="self-start"
        />
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tokens"
        aria-label="Search tokens"
        autoComplete="off"
        spellCheck={false}
        data-testid="fees-search"
      />
      <ul className="m-0 flex list-none flex-col p-0">
        {shown?.map((t) => (
          <li key={t.address} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onChoose(t)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] hover:text-ink"
              data-testid={`fees-token-${t.symbol}`}
            >
              <span className="flex min-w-0 flex-col">
                <b className="font-medium text-ink">{t.symbol}</b>
                <span className="truncate text-xs text-ink-3">{t.name}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-ink-2">
                {tokenAmount(t.balance, t.decimals)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown?.length === 0 && <p className="text-xs text-ink-3">No token here matches “{query.trim()}”.</p>}
    </div>
  );
}
