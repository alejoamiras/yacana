import { cn, TileBoundary } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { isOldRole } from '../bridge/env';
import { BalanceCard } from '../components/BalanceCard';
import type { MinerController } from '../controller';
import { BridgeProviders } from '../features/BridgeProviders';
import { SendAheadDialog } from '../features/dialogs/SendAhead';
import { IntroStrip } from '../features/IntroStrip';
import { LedgerTile } from '../features/LedgerTile';
import { KpiTiles, LoopTile } from '../features/LoopTile';
import { MigrationCard, useMigrationShown } from '../features/MigrationCard';
import { NoticeCard } from '../features/NoticeCard';
import { OldApp } from '../features/OldApp';
import { RailTile } from '../features/RailTile';
import { usePresto } from '../features/use-presto';
import { introAtom } from '../intro';
import { useTileLog } from '../lib/tile-log';
import type { Session } from '../session';
import { balanceAtom, bootAtom, bridgeSessionAtom, minerAtom } from '../state';

/** The guided path over the cockpit: the upgrade card with the send-ahead dialog; what arrives shows in the Wallet. */
function GuidedPath({ session }: { session: Session }) {
  const onError = useTileLog();
  const balance = useAtomValue(balanceAtom);
  const [ahead, setAhead] = useState<false | 'form' | 'how'>(false);
  return (
    <BridgeProviders>
      <TileBoundary name="migration" onError={onError} className="md:col-span-2 xl:col-span-4">
        <MigrationCard
          onSendAhead={() => setAhead('form')}
          onHow={() => setAhead('how')}
          className="md:col-span-2 xl:col-span-4"
        />
      </TileBoundary>
      <SendAheadDialog
        session={session}
        balance={balance ?? 0n}
        open={ahead !== false}
        initial={ahead || 'form'}
        onOpenChange={(o) => !o && setAhead(false)}
      />
    </BridgeProviders>
  );
}

/** The right column is one flex column at `xl` so that, however tall it grows, the left column's rows stay packed. */
const RIGHT = 'contents xl:flex xl:flex-col xl:gap-[14px] xl:col-start-4 xl:row-span-3';
/** The last left row takes the slack; a card above the cockpit (the first visit's strip, a notice, the upgrade card) adds a row before it. */
const ROWS = [
  'xl:grid-rows-[auto_auto_1fr]',
  'xl:grid-rows-[auto_auto_auto_1fr]',
  'xl:grid-rows-[auto_auto_auto_auto_1fr]',
  'xl:grid-rows-[auto_auto_auto_auto_auto_1fr]',
];

/**
 * The balance tops the right column, the epoch tile under it. Between `md` and `xl` the column
 * dissolves: the rail stands beside the balance and the ledger stacked; on a phone the balance is
 * second, right under the loop.
 */
export function Mine({
  controller,
  onStart,
  session,
}: {
  controller: () => MinerController | undefined;
  /** The user's Start (through the session, which re-asks Presto); a bare controller start otherwise. */
  onStart?: () => void;
  /** The bridge's session, when the page has one: the guided path renders over the cockpit. */
  session?: Session;
}) {
  const onError = useTileLog();
  const ready = useAtomValue(bootAtom).phase === 'ready';
  const notice = useAtomValue(minerAtom).notice;
  const intro = useAtomValue(introAtom);
  const presto = usePresto(session);
  // The upgrade card mounts under the bridge's providers and draws nothing while the upgrade is quiet.
  const upgradeShown = useMigrationShown();
  const bridgeOpen = useAtomValue(bridgeSessionAtom) !== null;
  // The versioned origin is one page: nothing is mined there, so no cockpit.
  if (isOldRole()) return <OldApp session={session} />;
  const above = (intro ? 1 : 0) + (notice ? 1 : 0) + (upgradeShown && bridgeOpen && session && ready ? 1 : 0);
  const start = onStart ?? (() => controller()?.start());
  return (
    <div
      className={cn(
        'grid items-start gap-[14px] md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_300px]',
        ROWS[above],
      )}
      data-signed-out={ready ? undefined : ''}
      data-testid="cockpit"
    >
      {intro && <IntroStrip onStart={start} className="md:col-span-2 xl:col-span-4" />}
      {notice && (
        <div className="md:col-span-2 xl:col-span-4">
          <NoticeCard notice={notice} />
        </div>
      )}
      {session && ready && <GuidedPath session={session} />}
      <TileBoundary name="loop" onError={onError} className="md:col-span-2 xl:col-span-3">
        <LoopTile controller={controller} onStart={start} className="md:col-span-2 xl:col-span-3" />
      </TileBoundary>
      <div className={RIGHT} data-testid="right-column">
        <TileBoundary name="balance" onError={onError} className="md:order-3">
          <BalanceCard className="md:order-3" />
        </TileBoundary>
        <TileBoundary name="rail" onError={onError} className="md:order-4 md:row-span-2">
          <RailTile controller={controller} presto={presto} className="md:order-4 md:row-span-2" />
        </TileBoundary>
      </div>
      <TileBoundary name="kpis" onError={onError} className="md:col-span-2 xl:col-span-3">
        <KpiTiles className="md:col-span-2 xl:col-span-3" />
      </TileBoundary>
      <TileBoundary name="ledger" onError={onError} className="md:order-5 xl:col-span-3">
        <LedgerTile controller={controller} className="md:order-5 xl:col-span-3" />
      </TileBoundary>
    </div>
  );
}
