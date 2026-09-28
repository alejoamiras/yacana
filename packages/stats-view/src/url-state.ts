// What the stats page keeps in its URL, so a view is a link: `?epoch=` the selected epoch, `?from=` the
// window's first. Both are replaced in place (no history entry) and survive the host's own query (the node pin).
import { dispatchNavigate, subscribeLocation } from '@yacana/web-kit/browser/navigation';
import * as React from 'react';

const epochParam = (search: string, name: 'epoch' | 'from'): number | null => {
  const v = new URLSearchParams(search).get(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const withParam = (url: URL, name: 'epoch' | 'from', value: number | null): URL => {
  const u = new URL(url);
  if (value === null) u.searchParams.delete(name);
  else u.searchParams.set(name, String(value));
  return u;
};

const replace = (name: 'epoch' | 'from', value: number | null): void => {
  history.replaceState(null, '', withParam(new URL(location.href), name, value));
  dispatchNavigate();
};

/** The selected epoch; null selects the open one. */
export const selectedFromSearch = (search: string): number | null => epochParam(search, 'epoch');
export const withEpoch = (url: URL, epoch: number | null): URL => withParam(url, 'epoch', epoch);
export const select = (epoch: number | null): void => replace('epoch', epoch);

/** The window's first epoch; absent (or not an epoch) is the newest window. */
export const fromSearch = (search: string): number | null => epochParam(search, 'from');
export const withFrom = (url: URL, from: number | null): URL => withParam(url, 'from', from);
export const setFrom = (from: number | null): void => replace('from', from);

export const useFrom = (): number | null =>
  React.useSyncExternalStore(
    subscribeLocation,
    () => fromSearch(location.search),
    () => null,
  );

export const useSelected = (): number | null =>
  React.useSyncExternalStore(
    subscribeLocation,
    () => selectedFromSearch(location.search),
    () => null,
  );
