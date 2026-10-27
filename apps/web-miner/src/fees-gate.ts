// The mocked fee-funding flow exists only in dev and e2e builds. The define comparison and the `import()`
// share this module: an `import()` guarded by a constant imported from another module survives a
// production build as an orphan chunk.
import { lazy } from 'react';

/** The options under design, each in its own place: a line under the balance, a card over the cockpit, a Settings tile. */
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

/** `?fees=a|b|c`, read once at load so in-app navigation keeps it; null in a production build. */
export const feesOption: FeesOption | null =
  import.meta.env.VITE_DEV_FUND_FEES === '1' ? optionFrom(location.search) : null;

/** The slot each placement mounts; null unless a flagged build was opened with `?fees=`. */
export const FeesSlot =
  import.meta.env.VITE_DEV_FUND_FEES === '1' && feesOption ? lazy(() => import('./fees/Slot')) : null;
