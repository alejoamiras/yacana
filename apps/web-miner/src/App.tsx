import { proofsPerMinute } from '@yacana/miner-core/metrics';
import {
  AccountChip,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Gear,
  Header,
  NodeBanner,
  NodeWayOut,
  StatusPill,
  statusLabel,
  Toaster,
} from '@yacana/ui';
import { defaultNodeUrl, restoreDefaultNode } from '@yacana/web-kit/browser/connection';
import { shortAddress } from '@yacana/web-kit/browser/format';
import { previewNotice } from '@yacana/web-kit/browser/host';
import { bannerState, nodeHealth, subscribeNodeHealth } from '@yacana/web-kit/browser/node-health';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';
import { useAtomValue } from 'jotai';
import { type ReactNode, useCallback, useEffect, useSyncExternalStore } from 'react';
import { isOldRole, lifecycleRecord } from './bridge/env';
import { DesktopOnly } from './components/DesktopOnly';
import type { Connection } from './config';
import { isDesktop } from './desktop';
import { useActivity } from './features/ActivityList';
import { OldTabNotice } from './features/OldTabNotice';
import { PipHost } from './features/PipHost';
import { PreflightTile } from './features/PreflightTile';
import { PrestoBanner } from './features/PrestoBanner';
import { SignInDialog } from './features/SignInDialog';
import { useHotkeys, usePauses, useResumeOnOpen } from './features/use-page-behaviour';
import { pillStatus } from './lib/status';
import { minerTabs, oldTabs } from './lib/tabs';
import { prestoAtom } from './presto';
import { navigate, pathFor, type Route, useRoute } from './routes';
import { Mine } from './routes/Mine';
import { Settings } from './routes/Settings';
import { Wallet } from './routes/Wallet';
import type { Session } from './session';
import { useSettings } from './settings';
import { bootAtom, epochAtom, minerAtom, nowAtom, rulesAtom, signInAtom } from './state';
import { applyTabStatus } from './tab-status';

function useTabStatus(enabled: boolean) {
  const miner = useAtomValue(minerAtom);
  const epoch = useAtomValue(epochAtom);
  const rules = useAtomValue(rulesAtom);
  useEffect(() => {
    if (!enabled) return applyTabStatus({ mark: 'idle' });
    const perMinute = proofsPerMinute(miner.recent);
    applyTabStatus({
      mark: pillStatus(miner) === 'paused' ? 'paused' : miner.phase === 'idle' ? 'idle' : 'mining',
      ...(miner.phase !== 'idle' && perMinute > 0 && { rate: `${perMinute.toFixed(0)}/min` }),
      ...(epoch && rules && { claims: `${epoch.claims}/${rules.N}` }),
    });
  }, [enabled, miner, epoch, rules]);
}

/** The banner calls the numbers stale once the controller would have paused for silence (a minute). */
const STALE_AFTER_MS = 60_000;

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const boot = useAtomValue(bootAtom);
  const miner = useAtomValue(minerAtom);
  const now = useAtomValue(nowAtom);
  const notice = previewNotice(location.hostname);
  const health = useSyncExternalStore(subscribeNodeHealth, nodeHealth, nodeHealth);
  const banner = bannerState(health, now, STALE_AFTER_MS);
  const presto = useAtomValue(prestoAtom);
  const status = boot.phase === 'opening' ? 'opening' : pillStatus(miner, now);
  const waiting = useActivity().needsUser;
  // The old origin: the retired tag, Send ahead and the apex's Stats, no mining status; the account
  // chip leads to Settings, the wallet being the page itself. With the node gone there is no Settings.
  const old = isOldRole();
  const gone = old && lifecycleRecord()?.nodeRetired === true;
  const accountRoute: Route = old ? 'settings' : 'wallet';
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col">
      <Header
        version={old ? `${ownVersionName()} · retired` : ownVersionName()}
        homeHref={pathFor('mine')}
        onHome={() => navigate('mine')}
        mark={miner.phase === 'idle' ? 'idle' : 'mining'}
        navLabel="miner"
        tabs={old ? oldTabs(route, navigate) : minerTabs(route, navigate, undefined, waiting)}
        right={
          <>
            <Badge variant="net">testnet</Badge>
            {!old && (
              <StatusPill status={status} data-testid="phase" data-prover={presto.active ?? undefined}>
                {statusLabel(status)}
                {presto.active === 'presto' && (
                  <>
                    <span className="text-ink-4">·</span>
                    <span className="text-uv-2" data-testid="native">
                      <span className="font-semibold text-uv">✦</span> presto
                    </span>
                  </>
                )}
              </StatusPill>
            )}
            {boot.phase === 'ready' && (
              <AccountChip
                address={shortAddress(boot.account)}
                href={pathFor(accountRoute)}
                onSelect={() => navigate(accountRoute)}
                data-testid="account-chip"
              />
            )}
            {!gone && <Gear href={pathFor('settings')} onSelect={() => navigate('settings')} />}
          </>
        }
      />
      <div className="flex flex-col gap-4 p-4 md:p-5">
        {notice && (
          <Alert variant="warn" data-testid="preview-banner">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <NodeBanner
          state={banner}
          settingsHref={route === 'settings' || old ? undefined : pathFor('settings')}
        />
        {children}
      </div>
    </div>
  );
}

export function App({ connection, session }: { connection: Connection; session: Session }) {
  const boot = useAtomValue(bootAtom);
  const route = useRoute();
  const signIn = useAtomValue(signInAtom);
  const [settings] = useSettings();
  const controller = useCallback(() => session.controller, [session]);
  // Stable: the mini window's view is rendered again whenever `onStart` changes identity.
  const onStart = useCallback(() => session.startMining(), [session]);
  // The fix-it row's Retry is a Look: one entry point consents and probes.
  const onRetry = useCallback(() => void session.lookForPresto(), [session]);
  // The wallet is the account's page: signed out (a sign-out reloads here), the cockpit is the page.
  // On the old origin the page is the wallet: a V5 bookmark of `/wallet` lands on it.
  useEffect(() => {
    if ((boot.phase === 'signedOut' || isOldRole()) && route === 'wallet') navigate('mine');
  }, [boot.phase, route]);
  // Settings stays reachable signed out (the node is changed there); everywhere else the sign-in
  // sits over the cockpit, and the page's keys are its while it shows.
  const dialogShowing =
    route !== 'settings' && (boot.phase === 'opening' || (boot.phase === 'signedOut' && signIn));
  useTabStatus(settings.tabStatus);
  useHotkeys(controller, onStart, session.consent, !dialogShowing);
  usePauses(controller, settings);
  useResumeOnOpen(onStart);
  if (!isDesktop(window)) return <DesktopOnly />;
  const open = boot.phase === 'ready';
  const chain = open || boot.phase === 'signedOut' || boot.phase === 'opening';
  return (
    <Shell>
      {boot.phase === 'error' && (
        <Alert variant="bad" data-testid="boot-error">
          <AlertTitle>Cannot start</AlertTitle>
          <AlertDescription>{boot.message}</AlertDescription>
          {!isOldRole() && (
            <NodeWayOut
              className="mt-2"
              onDefault={connection.nodeUrl === defaultNodeUrl() ? undefined : restoreDefaultNode}
              settingsHref={route === 'settings' ? undefined : pathFor('settings')}
            />
          )}
        </Alert>
      )}
      {boot.phase === 'preflight' && <PreflightTile rows={boot.rows} />}
      <OldTabNotice miner={connection.miner} rollupVersion={import.meta.env.VITE_ROLLUP_VERSION} />
      {chain && route === 'mine' && !isOldRole() && <PrestoBanner onRetry={onRetry} />}
      {chain && route === 'mine' && <Mine controller={controller} onStart={onStart} session={session} />}
      {open && route === 'wallet' && <Wallet session={session} />}
      {route === 'settings' && <Settings connection={connection} controller={controller} session={session} />}
      {route !== 'settings' && <SignInDialog session={session} />}
      <PipHost controller={controller} onStart={onStart} />
      <Toaster />
    </Shell>
  );
}

/**
 * The old origin once its node is gone: the page that says so, under the same header, with no
 * session behind it — nothing here reads the node, so nothing waits on it or offers another.
 */
export function GoneApp() {
  return (
    <Shell>
      <Mine controller={() => undefined} />
    </Shell>
  );
}
