// Everything between a host's header and its footer; the host hands in its node banner and its way to
// another node.
import { Alert, AlertDescription, AlertTitle } from '@yacana/ui';
import type { Connection } from '@yacana/web-kit/browser/connection';
import { useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { Announcement } from './features/Announcement';
import { type StatsHost, StatsHostProvider, type StatsPage } from './host';
import { Bridge } from './pages/Bridge';
import { Stats } from './pages/Stats';
import { Verify } from './pages/Verify';
import { statusAtom } from './state';
import type { EpochWindow } from './window';

export type { EpochWindow, StatsHost, StatsPage };

export function StatsPages({
  page,
  host,
  connection,
  onWindow,
  banner,
  wayOut,
}: {
  page: StatsPage;
  host: StatsHost;
  connection: Connection;
  onWindow: (w: EpochWindow) => void;
  /** The host's node banner, between the announcement and the error card. */
  banner?: ReactNode;
  /** The host's way to another node, under the error. */
  wayOut: ReactNode;
}) {
  const status = useAtomValue(statusAtom);
  return (
    <StatsHostProvider value={host}>
      <Announcement />
      {banner}
      {status.phase === 'error' && (
        <Alert variant="bad" data-testid="boot-error">
          <AlertTitle>Cannot read this deployment</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
          {wayOut}
        </Alert>
      )}
      {page === 'stats' && <Stats onWindow={onWindow} nodeUrl={connection.nodeUrl} />}
      {page === 'bridge' && <Bridge />}
      {page === 'verify' && <Verify nodeUrl={connection.nodeUrl} />}
    </StatsHostProvider>
  );
}
