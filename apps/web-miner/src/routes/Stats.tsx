// Stats as pages of the miner, loaded the first time they are opened; `hostedRuntime` owns when its reads leave.
import { StatsPages } from '@yacana/stats-view/pages';
import { NodeWayOut, type StatsTab } from '@yacana/ui';
import { type Connection, defaultNodeUrl, restoreDefaultNode } from '@yacana/web-kit/browser/connection';
import { useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import { bridgeRecord } from '../bridge/env';
import { FAQ_HREF } from '../lib/apex';
import { statsRouteOf } from '../lib/tabs';
import { navigate, pathFor } from '../routes';
import { endpointsAtom } from '../state';
import { createStatsHost, hostedRuntime, type StatsHost } from './stats-host';

const HOST = {
  pathFor: (p: StatsTab) => pathFor(statsRouteOf(p)),
  navigate: (p: StatsTab) => navigate(statsRouteOf(p)),
  faqHref: FAQ_HREF,
};

type Store = ReturnType<typeof useStore>;

let host: StatsHost | undefined;

const hostFor = (store: Store, connection: Connection): StatsHost =>
  (host ??= createStatsHost(store, (e) => hostedRuntime(e, { store, connection, bridge: !!bridgeRecord() })));

export default function Stats({ page, connection }: { page: StatsTab; connection: Connection }) {
  const store = useStore();
  const endpoints = useAtomValue(endpointsAtom);
  useEffect(() => hostFor(store, connection).show(), [store, connection]);
  const shown = endpoints
    ? { ...connection, nodeUrl: endpoints.nodeUrl, ethRpcUrl: endpoints.ethRpcUrl }
    : connection;
  return (
    <StatsPages
      page={page}
      host={HOST}
      connection={shown}
      onWindow={(w) => void host?.runtime()?.showWindow(w)}
      wayOut={
        <NodeWayOut
          className="mt-2"
          onDefault={shown.nodeUrl === defaultNodeUrl() ? undefined : restoreDefaultNode}
          settingsHref={pathFor('settings')}
        />
      }
    />
  );
}
