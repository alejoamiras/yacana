import { dispatchNavigate, subscribeLocation } from '@yacana/web-kit/browser/navigation';
import * as React from 'react';

export type Route = 'mine' | 'wallet' | 'settings' | 'stats' | 'stats/bridge' | 'stats/verify';

const PAGES: readonly Route[] = ['wallet', 'settings', 'stats', 'stats/bridge', 'stats/verify'];

const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
// `bridge/env`'s `isOldRole`, read here: `apps/site` type-imports this module, and that one's closure
// needs the apps' Vite env types.
const oldRole = (): boolean => import.meta.env.VITE_APP_ROLE === 'old';

/**
 * The route under the app's base, read from its first two segments; anything else is the cockpit, and so
 * are the stats paths on the old origin, which has no stats pages.
 */
export const routeFromPath = (pathname: string): Route => {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const [first = '', second] = rest.split('/').filter(Boolean);
  const route = [`${first}/${second}`, first].find((p): p is Route => PAGES.includes(p as Route));
  return !route || (route.startsWith('stats') && oldRole()) ? 'mine' : route;
};

export const pathFor = (route: Route): string => `${base}/${route === 'mine' ? '' : route}`;

/** Settings stays reachable signed out (the node is changed there) and Stats reads without an account. */
export const signInShowsOn = (route: Route): boolean => route !== 'settings' && !route.startsWith('stats');

/** What the wallet opens on arrival: the Send dialog, or the words backup on the way to Sign out. */
export type Intent = 'send' | 'backup';

/** `intent` rides in history state, read once by the wallet. */
export const navigate = (route: Route, intent?: Intent): void => {
  history.pushState(intent ? { intent } : null, '', pathFor(route));
  dispatchNavigate();
};

/** Reads and clears a navigation intent, so a reload or a back does not reopen the sheet. */
export const takeIntent = (): Intent | undefined => {
  const intent = (history.state as { intent?: Intent } | null)?.intent;
  if (intent) history.replaceState(null, '', location.href);
  return intent;
};

export const useRoute = (): Route =>
  React.useSyncExternalStore(
    subscribeLocation,
    () => routeFromPath(location.pathname),
    () => 'mine',
  );
