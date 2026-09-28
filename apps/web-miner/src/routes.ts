import { dispatchNavigate, subscribeLocation } from '@yacana/web-kit/browser/navigation';
import * as React from 'react';

export type Route = 'mine' | 'wallet' | 'settings';

const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** `/mine`, `/mine/wallet`, `/mine/settings` under the app's base; anything else is the cockpit. */
export const routeFromPath = (pathname: string): Route => {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const first = rest.split('/').filter(Boolean)[0];
  return first === 'wallet' || first === 'settings' ? first : 'mine';
};

export const pathFor = (route: Route): string => `${base}/${route === 'mine' ? '' : route}`;

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
