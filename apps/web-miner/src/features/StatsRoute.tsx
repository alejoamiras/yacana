// The stats routes' frame in the miner's own chunk: the pages load on first opening, and a load that
// fails stays on this card while the cockpit, the prover and the mini window carry on.
import { Alert, AlertDescription, Button, type StatsTab } from '@yacana/ui';
import type { Connection } from '@yacana/web-kit/browser/connection';
import { Component, lazy, type ReactNode, Suspense, useState } from 'react';
import { redeployed, servedBuild } from '../bridge/env';

type StatsModule = typeof import('../routes/Stats');

/** The chunk a failed import names: Chromium and Firefox put its URL in the message, WebKit does not. */
const failedChunk = (e: unknown): string | undefined =>
  /dynamically imported module: (\S+)/i.exec(e instanceof Error ? e.message : '')?.[1];

// The document keeps a failed module fetch for good (its module map answers every later import() of
// that URL without the network), so each retry asks for the chunk under a URL of its own. Loaded once,
// the module is every later mount's: a second instance would bring a second host onto the store.
let failed: string | undefined;
let retries = 0;
let loading: Promise<StatsModule> | undefined;
const load = (): Promise<StatsModule> =>
  (loading ??= (
    failed
      ? (import(/* @vite-ignore */ `${failed.split('?')[0]}?retry=${++retries}`) as Promise<StatsModule>)
      : import('../routes/Stats')
  ).catch((e: unknown) => {
    loading = undefined;
    failed ??= failedChunk(e);
    throw e;
  }));

class LoadBoundary extends Component<
  { onRetry: () => void; children: ReactNode },
  { failed: boolean; redeployed: boolean }
> {
  state = { failed: false, redeployed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    void servedBuild().then((b) => this.setState({ redeployed: redeployed(b) }));
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const gone = this.state.redeployed;
    const retry = !gone && failed !== undefined;
    return (
      <Alert variant="bad" data-testid="stats-unavailable" data-redeployed={gone || undefined}>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {gone
              ? 'Yacana has been updated since this tab opened: Stats opens after a reload, which stops mining.'
              : retry
                ? 'Stats could not be fetched. Mining goes on.'
                : 'Stats could not be fetched. Mining goes on; this browser fetches it again only on a reload, which stops mining.'}
          </span>
          <Button
            size="sm"
            variant="danger"
            onClick={retry ? this.props.onRetry : () => location.reload()}
            data-testid="stats-retry"
          >
            {retry ? 'Try again' : 'Reload to open Stats'}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}

export function StatsRoute({ page, connection }: { page: StatsTab; connection: Connection }) {
  // React.lazy keeps a rejected load for good: each attempt is a lazy of its own.
  const [attempt, setAttempt] = useState(() => ({ n: 0, Stats: lazy(load) }));
  const { Stats } = attempt;
  return (
    <LoadBoundary key={attempt.n} onRetry={() => setAttempt(({ n }) => ({ n: n + 1, Stats: lazy(load) }))}>
      <Suspense fallback={null}>
        <Stats page={page} connection={connection} />
      </Suspense>
    </LoadBoundary>
  );
}
