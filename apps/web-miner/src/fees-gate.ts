// The mocked fee-funding flow exists only in dev and e2e builds. The define comparison and the `import()`
// share this module: an `import()` guarded by a constant imported from another module survives a
// production build as an orphan chunk.
import { atom } from 'jotai';
import { lazy } from 'react';

export type FeesOption = 'b';

const optionFrom = (search: string): FeesOption | null => {
  const v = new URLSearchParams(search).get('fees');
  return v === 'b' ? v : null;
};

/** The query as the page loaded: in-app navigation drops it, and the flow's switches live in it. */
export const feesSearch: string = import.meta.env.VITE_DEV_FUND_FEES === '1' ? location.search : '';

/** `?fees=b`; null in a production build. */
export const feesOption: FeesOption | null =
  import.meta.env.VITE_DEV_FUND_FEES === '1' ? optionFrom(feesSearch) : null;

/** The flow's card over the cockpit; null unless a flagged build was opened with `?fees=`. */
export const FeesSlot =
  import.meta.env.VITE_DEV_FUND_FEES === '1' && feesOption ? lazy(() => import('./fees/Slot')) : null;

/** True while the flow draws its card over the cockpit, which then counts it as a row. Never set in production. */
export const feesCardAtom = atom(false);
