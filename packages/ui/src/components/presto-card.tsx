import type * as React from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from './button.tsx';
import { ExternalLink } from './external-link.tsx';

/**
 * Where Presto stands for this page, one word for both surfaces: nothing asked yet, a look under
 * way, found while idle, remembered from an earlier visit, proving now, silent, or kept out by the
 * browser.
 */
export type PrestoStanding = 'ask' | 'checking' | 'found' | 'remembered' | 'proving' | 'absent' | 'blocked';

export interface PrestoCardProps {
  standing: PrestoStanding;
  /** Remembered, but the browser will ask before the next look: the click is needed again this visit. */
  needsLook?: boolean;
  onLook: () => void;
  /** Forgets Presto and proves in the browser; absent when there is nothing to forget. */
  onUseBrowser?: () => void;
  /** Presto's site, for the install link. */
  site: string;
  className?: string;
}

interface Words {
  title: string;
  line: React.ReactNode;
  /** The look button's label; none where a look is not the next step. */
  look?: string;
  foot?: string;
}

const get = (site: string) => (
  <ExternalLink href={site} className="font-sans text-uv-2" data-testid="presto-get">
    Get Presto
  </ExternalLink>
);

function words(standing: PrestoStanding, site: string, needsLook: boolean): Words {
  switch (standing) {
    case 'ask':
      return {
        title: 'Have Presto?',
        line: <>Native proving, several times faster. {get(site)}</>,
        look: 'Look for Presto',
        foot: 'Your browser will ask first. Nothing leaves your machine.',
      };
    case 'checking':
      return { title: 'Presto', line: 'looking on this computer…' };
    case 'found':
      return { title: 'Presto · found', line: 'proves when you start · its own speed setting decides' };
    case 'remembered':
      return needsLook
        ? {
            title: 'Presto · used last time',
            line: 'your browser will ask before it is checked again',
            look: 'Look for Presto',
          }
        : { title: 'Presto · used last time', line: 'checked again when you start' };
    case 'proving':
      return {
        title: 'Presto · native prover',
        line: (
          <>
            proving on this machine ·{' '}
            <ExternalLink href={site} className="font-sans text-uv-2">
              About Presto
            </ExternalLink>
          </>
        ),
      };
    case 'absent':
      return { title: 'Presto didn’t answer.', line: <>Not installed? {get(site)}</>, look: 'Look again' };
    case 'blocked':
      return {
        title: 'Your browser blocked it.',
        line: 'Site settings › Local network access › Allow, then Look again. Mining continues in the browser.',
        look: 'Look again',
      };
  }
}

function Actions({
  w,
  onLook,
  onUseBrowser,
}: { w: Words } & Pick<PrestoCardProps, 'onLook' | 'onUseBrowser'>) {
  if (!w.look && !onUseBrowser) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
      {w.look && (
        <Button size="sm" onClick={onLook} data-testid="presto-look">
          {w.look}
        </Button>
      )}
      {onUseBrowser && (
        <button
          type="button"
          className="text-xs text-ink-2 underline-offset-3 hover:text-ink hover:underline"
          onClick={onUseBrowser}
          data-testid="presto-use-browser"
        >
          use the browser
        </button>
      )}
    </span>
  );
}

/** Presto's row under the power slider and in Settings: its standing, the one button that moves it, the way back. */
export function PrestoCard({
  standing,
  needsLook = false,
  onLook,
  onUseBrowser,
  site,
  className,
}: PrestoCardProps) {
  const w = words(standing, site, needsLook);
  const offer = standing === 'ask';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[8px] border px-3 py-2.5',
        offer ? 'border-line bg-panel' : 'border-uv/40 bg-uv-dim',
        className,
      )}
      data-testid="presto-card"
      data-standing={standing}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[15px] font-bold',
          offer ? 'bg-panel-2 text-uv' : 'bg-uv text-uv-ink',
        )}
      >
        ✦
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold text-ink" data-testid="presto-title">
          {w.title}
        </span>
        <span className="text-xs text-ink-2">{w.line}</span>
        <Actions w={w} onLook={onLook} onUseBrowser={onUseBrowser} />
        {w.foot && <span className="text-2xs text-ink-3">{w.foot}</span>}
      </span>
    </div>
  );
}
