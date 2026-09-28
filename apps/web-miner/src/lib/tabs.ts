import { type HeaderTab, type StatsTab, siteTabs, statsTabs } from '@yacana/ui';
import { pathFor, type Route } from '../routes';
import { statsHref } from './apex';

/** Mine · Wallet · Stats, each a page of this app. `waiting`: the Wallet rows that need the user, its badge. */
export const minerTabs = (route: Route, go: (route: Route) => void, waiting = 0): HeaderTab[] =>
  siteTabs({
    current: route === 'mine' || route === 'wallet' ? route : statsPageOf(route) ? 'stats' : null,
    href: pathFor,
    onSelect: { mine: () => go('mine'), wallet: () => go('wallet'), stats: () => go('stats') },
    waiting,
  });

/** The stats page a route shows; null off the stats routes. */
export const statsPageOf = (route: Route): StatsTab | null =>
  route === 'stats'
    ? 'stats'
    : route === 'stats/bridge'
      ? 'bridge'
      : route === 'stats/verify'
        ? 'verify'
        : null;

export const statsRouteOf = (page: StatsTab): Route => (page === 'stats' ? 'stats' : `stats/${page}`);

/** Overview · Bridge · Verify, under the bar on the stats routes. */
export const minerStatsTabs = (page: StatsTab, go: (route: Route) => void): HeaderTab[] =>
  statsTabs({
    current: page,
    href: (p) => pathFor(statsRouteOf(p)),
    onSelect: {
      stats: () => go('stats'),
      bridge: () => go('stats/bridge'),
      verify: () => go('stats/verify'),
    },
  });

/** The old origin's two: Send ahead is its one page, Stats ↗ the apex's. No Wallet: the page is the wallet. */
export const oldTabs = (route: Route, go: (route: Route) => void, stats = statsHref): HeaderTab[] => [
  {
    label: 'Send ahead',
    icon: 'mine',
    href: pathFor('mine'),
    current: route === 'mine',
    onSelect: () => go('mine'),
  },
  { label: 'Stats', icon: 'stats', href: stats, external: true, testId: 'nav-stats' },
];
