import { type EpochWindow, StatsPages } from '@yacana/stats-view/pages';
import { POLL_MS } from '@yacana/stats-view/runtime';
import {
  fixedAtom,
  historyAtom,
  nowAtom,
  settled,
  statusAtom,
  unsettledAtom,
} from '@yacana/stats-view/state';
import {
  Alert,
  AlertDescription,
  Badge,
  ExternalLink,
  Header,
  type HeaderTab,
  NodeBanner,
  NodeWayOut,
} from '@yacana/ui';
import {
  type Connection,
  defaultNodeUrl,
  NODE_SETTINGS_HREF,
  restoreDefaultNode,
} from '@yacana/web-kit/browser/connection';
import { explorer, explorerBase } from '@yacana/web-kit/browser/explorer';
import { duration } from '@yacana/web-kit/browser/format';
import { previewNotice } from '@yacana/web-kit/browser/host';
import { bannerState, nodeHealth, subscribeNodeHealth } from '@yacana/web-kit/browser/node-health';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';
import { useAtomValue } from 'jotai';
import { useEffect, useSyncExternalStore } from 'react';
import { FAQ_HREF, navigate, pathFor, type Route, useRoute } from './routes';

const links = explorer(explorerBase(import.meta.env.VITE_EXPLORER_URL));
const HOST = { pathFor, navigate, faqHref: FAQ_HREF };

/** Stats · Bridge · Verify · Mine ↗: the miner opens in its own tab, where mining then lives. */
export const statsTabs = (route: Route, go: (route: Route) => void, minerHref: string): HeaderTab[] => [
  {
    label: 'Stats',
    icon: 'stats',
    href: pathFor('stats'),
    current: route === 'stats',
    onSelect: () => go('stats'),
  },
  { label: 'Bridge', href: pathFor('bridge'), current: route === 'bridge', onSelect: () => go('bridge') },
  {
    label: 'Verify',
    icon: 'verify',
    href: pathFor('verify'),
    current: route === 'verify',
    onSelect: () => go('verify'),
  },
  { label: 'Mine', icon: 'mine', href: minerHref, external: true, testId: 'nav-mine' },
];
const TITLE: Record<Route, string> = {
  stats: 'Yacana · Stats',
  bridge: 'Yacana · Bridge',
  verify: 'Yacana · Verify',
};

/**
 * "● block 184,221 · 12 s ago": the last block the node showed, linked, and the age of its slot time.
 * The dot is keyed by the block number, so a new block replays its 240 ms pulse.
 */
function Freshness() {
  const fixed = useAtomValue(fixedAtom);
  const status = useAtomValue(statusAtom);
  const now = useAtomValue(nowAtom);
  // Until beat one lands the pill says so; the block and its age come with it.
  if (!fixed)
    return (
      <span className="font-mono text-2xs text-ink-2" data-testid="freshness-pending">
        {status.phase === 'loading' || status.phase === 'ready' ? 'reading the chain…' : ''}
      </span>
    );
  const age = Math.max(0, Math.floor(now / 1000) - fixed.block.timestamp);
  const n = fixed.block.number;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-ink-2" data-testid="freshness">
      <span
        key={n}
        aria-hidden
        data-block={n}
        className="size-1.5 rounded-full bg-uv-2 animate-in zoom-in-50 fade-in duration-[240ms] motion-reduce:animate-none"
      />
      <ExternalLink
        href={links.block(n)}
        full={String(n)}
        className="text-ink-2"
        data-testid="freshness-block"
      >
        block {n.toLocaleString('en-US')}
      </ExternalLink>
      <span>· {duration(age)} ago</span>
    </span>
  );
}

export function App({
  connection,
  onWindow,
}: {
  connection: Connection;
  onWindow: (w: EpochWindow) => void;
}) {
  const route = useRoute();
  const status = useAtomValue(statusAtom);
  const unsettled = useAtomValue(unsettledAtom);
  const history = useAtomValue(historyAtom);
  useEffect(() => {
    document.title = TITLE[route];
  }, [route]);
  // The miner is at the origin's root whatever this app's base is.
  const minerHref = '/mine/';
  const notice = previewNotice(location.hostname);
  const health = useSyncExternalStore(subscribeNodeHealth, nodeHealth, nodeHealth);
  const now = useAtomValue(nowAtom);
  const onDefault = connection.nodeUrl === defaultNodeUrl() ? undefined : restoreDefaultNode;
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col">
      <Header
        version={ownVersionName()}
        homeHref={pathFor('stats')}
        onHome={() => navigate('stats')}
        mark={status.phase === 'ready' ? 'mining' : 'idle'}
        navLabel="stats"
        tabs={statsTabs(route, navigate, minerHref)}
        right={
          <>
            <Badge variant="net">testnet</Badge>
            <Freshness />
          </>
        }
      />
      <main className="flex flex-col gap-4 p-4 md:p-5" data-settled={settled(history, unsettled) ? '1' : '0'}>
        {notice && (
          <Alert variant="warn" data-testid="preview-banner">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <StatsPages
          page={route}
          host={HOST}
          connection={connection}
          onWindow={onWindow}
          banner={
            <NodeBanner
              state={bannerState(health, now, 2 * POLL_MS)}
              settingsHref={NODE_SETTINGS_HREF}
              onDefault={onDefault}
            />
          }
          wayOut={<NodeWayOut className="mt-2" onDefault={onDefault} settingsHref={NODE_SETTINGS_HREF} />}
        />
        <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-2xs text-ink-2">
          <span>© Yacana · read from public storage · no trackers</span>
          <span data-testid="node">node {new URL(connection.nodeUrl).host}</span>
          <span className="font-mono">source {import.meta.env.VITE_SOURCE_COMMIT.slice(0, 12)}</span>
        </footer>
      </main>
    </div>
  );
}
