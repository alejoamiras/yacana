import { dispatchNavigate, subscribeLocation } from '@yacana/web-kit/browser/navigation';
import * as React from 'react';

export type Route = 'stats' | 'verify' | 'bridge';

const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** `/stats`, `/stats/verify` and `/stats/bridge` under the app's base; anything else is the observatory. */
export const routeFromPath = (pathname: string): Route => {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const first = rest.split('/').filter(Boolean)[0];
  return first === 'verify' || first === 'bridge' ? first : 'stats';
};

/** The FAQ on the landing: the origin's root, whatever this app's base. */
export const FAQ_HREF = `${(import.meta.env.BASE_URL ?? '/').replace(/\/stats\/?$/, '/')}faq`;

export const pathFor = (route: Route): string => `${base}/${route === 'stats' ? '' : route}`;

export const navigate = (route: Route): void => {
  history.pushState(null, '', pathFor(route));
  dispatchNavigate();
};

export const useRoute = (): Route =>
  React.useSyncExternalStore(
    subscribeLocation,
    () => routeFromPath(location.pathname),
    () => 'stats',
  );
