import type { HeaderTab } from './header.tsx';

export type SiteTab = 'mine' | 'wallet' | 'stats';
export type StatsTab = 'stats' | 'bridge' | 'verify';

interface TabsOf<T extends string> {
  current: T | null;
  href: (tab: T) => string;
  /** In-app navigation, per tab; a tab without one is a plain link. */
  onSelect?: Partial<Record<T, () => void>>;
}

const tab = <T extends SiteTab | StatsTab>(
  o: TabsOf<T>,
  id: T,
  label: string,
  testId: string,
): HeaderTab => ({
  label,
  href: o.href(id),
  current: o.current === id,
  testId,
  onSelect: o.onSelect?.[id],
});

/** Mine · Wallet · Stats: the bar over the miner's pages and the public stats' alike. */
export const siteTabs = (o: TabsOf<SiteTab> & { waiting?: number }): HeaderTab[] => [
  { ...tab(o, 'mine', 'Mine', 'nav-mine'), icon: 'mine' },
  { ...tab(o, 'wallet', 'Wallet', 'nav-wallet'), icon: 'wallet', count: o.waiting },
  { ...tab(o, 'stats', 'Stats', 'nav-stats'), icon: 'stats' },
];

/** Overview · Bridge · Verify: the stats pages, in the row under the bar. */
export const statsTabs = (o: TabsOf<StatsTab>): HeaderTab[] => [
  tab(o, 'stats', 'Overview', 'sub-stats'),
  tab(o, 'bridge', 'Bridge', 'sub-bridge'),
  tab(o, 'verify', 'Verify', 'sub-verify'),
];
