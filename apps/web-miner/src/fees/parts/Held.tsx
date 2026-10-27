import { useEffect, useState } from 'react';
import { fj } from '../copy';
import type { OptionProps } from '../run';

/** Reads once per mount: an owner keys it on whether a trade has landed, so a landing reads again. */
export function Held({ provider, account }: Omit<OptionProps, 'run'>) {
  const [held, setHeld] = useState<bigint>();
  useEffect(() => {
    const ctl = new AbortController();
    provider.feeJuiceBalance(account, ctl.signal).then(
      (v) => !ctl.signal.aborted && setHeld(v),
      () => {},
    );
    return () => ctl.abort();
  }, [provider, account]);
  return <span data-testid="fees-held">{held === undefined ? '…' : held === 0n ? 'none' : fj(held)}</span>;
}
