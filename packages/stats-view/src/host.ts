// What the pages need from the app that shows them, instead of importing its router: where each page
// lives, how to go there, and where the FAQ is.
import { createContext, useContext } from 'react';

export type StatsPage = 'stats' | 'bridge' | 'verify';

export interface StatsHost {
  pathFor: (page: StatsPage) => string;
  navigate: (page: StatsPage) => void;
  faqHref: string;
}

const HostContext = createContext<StatsHost | null>(null);

export const StatsHostProvider = HostContext.Provider;

export function useStatsHost(): StatsHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('a stats page rendered outside its host');
  return host;
}
