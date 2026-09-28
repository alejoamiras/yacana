import type { ReactNode } from 'react';
import { type StatsHost, StatsHostProvider } from '../src/host';

/** The host the specs render under: the public app's paths, a navigation that goes nowhere. */
export const HOST: StatsHost = {
  pathFor: (page) => `/stats/${page === 'stats' ? '' : page}`,
  navigate: () => {},
  faqHref: '/faq',
};

export const hosted = (ui: ReactNode) => <StatsHostProvider value={HOST}>{ui}</StatsHostProvider>;
