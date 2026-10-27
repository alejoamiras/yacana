// The mocked fee-funding flow exists only in dev and e2e builds. The define comparison and the `import()`
// share this module: an `import()` guarded by a constant imported from another module survives a
// production build as an orphan chunk.
import { lazy } from 'react';

export type FeesOption = 'a' | 'b' | 'c';
export type FeesPlacement = 'balance' | 'cockpit' | 'settings';

export const PLACEMENT: Readonly<Record<FeesOption, FeesPlacement>> = {
  a: 'balance',
  b: 'cockpit',
  c: 'settings',
};

const optionFrom = (search: string): FeesOption | null => {
  const v = new URLSearchParams(search).get('fees');
  return v === 'a' || v === 'b' || v === 'c' ? v : null;
};

/** The query as the page loaded: in-app navigation drops it, and the flow's switches live in it. */
export const feesSearch: string = import.meta.env.VITE_DEV_FUND_FEES === '1' ? location.search : '';

/** `?fees=a|b|c`; null in a production build. */
export const feesOption: FeesOption | null =
  import.meta.env.VITE_DEV_FUND_FEES === '1' ? optionFrom(feesSearch) : null;

/** The slot each placement mounts; null unless a flagged build was opened with `?fees=`. */
export const FeesSlot =
  import.meta.env.VITE_DEV_FUND_FEES === '1' && feesOption ? lazy(() => import('./fees/Slot')) : null;
