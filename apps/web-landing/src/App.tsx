import { Alert, AlertDescription, NodeBanner, TileBoundary } from '@yacana/ui';
import {
  defaultNodeUrl,
  loadConnection,
  NODE_SETTINGS_HREF,
  restoreDefaultNode,
} from '@yacana/web-kit/browser/connection';
import { previewNotice } from '@yacana/web-kit/browser/host';
import { bannerState, nodeHealth, subscribeNodeHealth } from '@yacana/web-kit/browser/node-health';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';
import { useSyncExternalStore } from 'react';
import { copy } from './copy';
import { useNow } from './hooks';
import { POLL_MS } from './live';
import { Faq } from './routes/Faq';
import { Ask, Footer } from './sections/Ask';
import { Bar } from './sections/Bar';
import { Chain, How } from './sections/Chain';
import { Hero } from './sections/Hero';
import { Launch } from './sections/Launch';
import { Money } from './sections/Money';
import { Verify } from './sections/Verify';
import { Why } from './sections/Why';
import { isFaqPath, type LaunchStatus, type LiveStatus, launchMode, migrationRecord } from './state';

/** The one line every page carries while a migration is announced, the FAQ one link away. */
function Announcement() {
  const m = migrationRecord();
  if (!m) return null;
  const day = new Date(Number(m.expectedFlipAt) * 1000).toISOString().slice(0, 10);
  const line = copy.announcement(ownVersionName(), day);
  const cut = line.indexOf('. ') + 1;
  return (
    <div
      role="status"
      className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[6px] border border-uv/50 px-3.5 py-2.5 text-sm text-ink-2 md:mx-5"
      data-testid="announcement"
    >
      <span>
        <b className="font-medium text-ink">{line.slice(0, cut)}</b>
        {line.slice(cut)}
      </span>
      <a href={`${import.meta.env.BASE_URL}faq`} className="whitespace-nowrap text-uv-2 hover:underline">
        {copy.announcementLink}
      </a>
    </div>
  );
}

export function App({
  live,
  launch,
  pathname = location.pathname,
}: {
  live: LiveStatus;
  launch: LaunchStatus;
  pathname?: string;
}) {
  const notice = previewNotice(location.hostname);
  const health = useSyncExternalStore(subscribeNodeHealth, nodeHealth, nodeHealth);
  const banner = bannerState(health, useNow() * 1000, 2 * POLL_MS);
  const faq = isFaqPath(pathname);
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col">
      <Bar live={live.phase === 'ready' && !live.unreachable} />
      {notice && (
        <Alert variant="warn" className="mx-4 mt-4 md:mx-5" data-testid="preview-banner">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Announcement />
      {faq ? (
        <Faq />
      ) : (
        <>
          <div className="mx-4 mt-4 empty:hidden md:mx-5">
            <NodeBanner
              state={banner}
              settingsHref={NODE_SETTINGS_HREF}
              onDefault={loadConnection().nodeUrl === defaultNodeUrl() ? undefined : restoreDefaultNode}
            />
          </div>
          <main>
            <TileBoundary name="hero">
              {launchMode() ? <Launch status={launch} live={live} /> : <Hero status={live} />}
            </TileBoundary>
            <TileBoundary name="money">
              <Money />
            </TileBoundary>
            <TileBoundary name="chain">
              <Chain />
            </TileBoundary>
            <TileBoundary name="how">
              <How />
            </TileBoundary>
            <TileBoundary name="why">
              <Why />
            </TileBoundary>
            <TileBoundary name="verify">
              <Verify />
            </TileBoundary>
            <TileBoundary name="ask">
              <Ask />
            </TileBoundary>
          </main>
        </>
      )}
      <Footer />
    </div>
  );
}
