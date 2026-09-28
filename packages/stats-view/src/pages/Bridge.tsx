// `/stats/bridge`: the six figures, the phases of this build's version, where the coins
// are, a card per registered version, the portal's state and the bridge on Ethereum. The portal's
// side comes from one read over the Ethereum RPC; the miner's side (the supply, its counters, the
// epochs) from the observatory's own beats.

import type { BridgeRecord, MigrationRecord } from '@yacana/bridge/record';
import { Alert, AlertDescription, AlertTitle, TileBoundary } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import {
  BridgeCoins,
  BridgeKpis,
  BridgePhases,
  BridgePortal,
  BridgeTurnstile,
  BridgeVersions,
  NoBridge,
} from '../features/Bridge';
import { bridgeAtom, fixedAtom, nowAtom, rowsAtom } from '../state';

const record = (): BridgeRecord | null =>
  import.meta.env.VITE_BRIDGE ? (JSON.parse(import.meta.env.VITE_BRIDGE) as BridgeRecord) : null;
const migration = (): MigrationRecord | null =>
  import.meta.env.VITE_MIGRATION ? (JSON.parse(import.meta.env.VITE_MIGRATION) as MigrationRecord) : null;

export function Bridge() {
  const status = useAtomValue(bridgeAtom);
  const now = useAtomValue(nowAtom);
  const fixed = useAtomValue(fixedAtom);
  const rows = useAtomValue(rowsAtom) ?? [];
  const bridge = record();
  if (!bridge || status.phase === 'none') return <NoBridge />;
  const snapshot = status.phase === 'ready' ? status.snapshot : null;
  const mine = snapshot?.versions.find((v) => v.version.toString() === import.meta.env.VITE_ROLLUP_VERSION);
  const miner = fixed?.miner;
  const supply = fixed?.supply;
  return (
    <div className="flex flex-col gap-4" data-testid="bridge">
      {status.phase === 'error' && (
        <Alert variant="bad" data-testid="bridge-error">
          <AlertTitle>Cannot read the portal</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}
      {status.phase === 'ready' && status.unreachable && (
        <Alert variant="warn" data-testid="bridge-stale">
          <AlertDescription>
            The Ethereum RPC is not answering; these are the last numbers read.
          </AlertDescription>
        </Alert>
      )}
      {snapshot && (
        <TileBoundary name="bridge-kpis">
          <BridgeKpis
            snapshot={snapshot}
            live={mine}
            miner={miner}
            supply={supply}
            now={now}
            chainId={bridge.chainId}
          />
        </TileBoundary>
      )}
      <TileBoundary name="bridge-phases">
        <BridgePhases version={mine} migration={migration()} snapshot={snapshot} />
      </TileBoundary>
      {snapshot && (
        <TileBoundary name="bridge-coins">
          <BridgeCoins rows={rows} snapshot={snapshot} now={now} />
        </TileBoundary>
      )}
      {snapshot && (
        <TileBoundary name="bridge-versions">
          <BridgeVersions snapshot={snapshot} miner={miner} supply={supply} />
        </TileBoundary>
      )}
      {snapshot && (
        <div className="grid gap-4 md:grid-cols-2">
          <TileBoundary name="bridge-turnstile">
            <BridgeTurnstile
              snapshot={snapshot}
              live={mine}
              miner={miner}
              now={now}
              chainId={bridge.chainId}
            />
          </TileBoundary>
          <TileBoundary name="bridge-portal">
            <BridgePortal snapshot={snapshot} record={bridge} chainId={bridge.chainId} />
          </TileBoundary>
        </div>
      )}
    </div>
  );
}
