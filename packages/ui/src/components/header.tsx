import type * as React from 'react';
import { cn } from '../lib/cn.ts';
import type { MarkState } from '../mark.ts';
import { Badge } from './badge.tsx';
import { Icon, type IconName } from './icons.tsx';
import { Mark } from './mark.tsx';

export interface HeaderTab {
  label: string;
  icon?: IconName;
  href: string;
  current?: boolean;
  /** Opens in a new tab and carries the ↗; mining lives in this one. */
  external?: boolean;
  testId?: string;
  /** How many things behind this tab need the user; zero and undefined both draw nothing. */
  count?: number;
  /** In-app navigation: the click is intercepted and the href kept for the address bar and middle clicks. */
  onSelect?: () => void;
}

export interface HeaderProps extends Omit<React.ComponentProps<'header'>, 'children'> {
  /** The version tag by the logo ("V5"). */
  version: string;
  homeHref: string;
  tabs: readonly HeaderTab[];
  /** Testnet badge · status pill · account chip / Log in · gear. */
  right?: React.ReactNode;
  mark: MarkState;
  navLabel?: string;
  onHome?: () => void;
}

/** In-app navigation on a plain primary click; a modified one (a new tab, a window) keeps the link's own behaviour. */
const select = (onSelect?: () => void) =>
  onSelect &&
  ((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onSelect();
  });

export function Brand({
  version,
  homeHref,
  mark,
  onHome,
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & {
  version: string;
  homeHref: string;
  mark: MarkState;
  onHome?: () => void;
}) {
  return (
    <a
      href={homeHref}
      data-slot="brand"
      className={cn('flex items-center gap-2 text-[15px] font-semibold text-ink', className)}
      onClick={select(onHome)}
      {...props}
    >
      <Mark state={mark} />
      Yacana{' '}
      <span
        className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-[0.08em] text-ink-3"
        data-testid="brand-version"
      >
        {version}
      </span>
    </a>
  );
}

/**
 * One header for the apps: the brand, the destinations as tabs with icons, and the app's own right side.
 * Under `md` the tabs drop to a second row that scrolls sideways, so a phone keeps every destination.
 */
export function Header({
  version,
  homeHref,
  tabs,
  right,
  mark,
  navLabel,
  onHome,
  className,
  ...props
}: HeaderProps) {
  return (
    <header
      data-slot="header"
      className={cn(
        'flex min-h-[52px] flex-wrap items-center gap-x-5 border-b border-line px-5 md:h-[52px] md:flex-nowrap',
        className,
      )}
      {...props}
    >
      <Brand version={version} homeHref={homeHref} mark={mark} onHome={onHome} className="max-md:py-3" />
      <nav
        className="flex gap-[18px] text-[13px] max-md:order-last max-md:basis-full max-md:overflow-x-auto max-md:[scrollbar-width:none]"
        aria-label={navLabel}
      >
        {tabs.map((t) => (
          <a
            key={t.href}
            href={t.href}
            aria-current={t.current ? 'page' : undefined}
            data-testid={t.testId}
            {...(t.external && { target: '_blank', rel: 'noopener noreferrer' })}
            onClick={select(t.onSelect)}
            className={cn(
              'inline-flex shrink-0 items-center gap-[7px] border-b-2 border-transparent pt-[15px] pb-[13px] text-ink-2 hover:text-ink max-md:pt-2 max-md:pb-2.5',
              t.current && 'border-ink text-ink',
            )}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <Badge variant="uv" className="px-1.5 py-px text-[10px]" data-testid="tab-count">
                {t.count}
              </Badge>
            )}
            {t.external && (
              <>
                {' '}
                <span className="text-[10px] text-ink-4">↗</span>
              </>
            )}
          </a>
        ))}
      </nav>
      {right !== undefined && (
        <span className="ml-auto flex shrink-0 items-center gap-2.5 max-md:py-2">{right}</span>
      )}
    </header>
  );
}

/** The row under the bar: a section's pages as small tabs, and the host's own line at its right. */
export function SubTabs({
  tabs,
  aside,
  className,
  ...props
}: React.ComponentProps<'nav'> & { tabs: readonly HeaderTab[]; aside?: React.ReactNode }) {
  return (
    <nav
      data-slot="sub-tabs"
      className={cn('flex items-center gap-1.5 border-b border-line px-5 py-2.5', className)}
      {...props}
    >
      {tabs.map((t) => (
        <a
          key={t.href}
          href={t.href}
          aria-current={t.current ? 'page' : undefined}
          data-testid={t.testId}
          onClick={select(t.onSelect)}
          className={cn(
            'rounded-[5px] border border-transparent px-2.5 py-[7px] font-mono text-xs leading-none font-medium text-ink-2 hover:text-ink',
            t.current && 'border-line-2 bg-panel text-ink',
          )}
        >
          {t.label}
        </a>
      ))}
      {aside !== undefined && (
        <span className="ml-auto font-mono text-[11.5px] font-medium text-uv-2">{aside}</span>
      )}
    </nav>
  );
}

/** The account's dot: one gradient for every account, drawn from the tokens. */
export function Avatar({ className }: { className?: string }) {
  return (
    <i
      aria-hidden
      className={cn('size-4 shrink-0 rounded-full', className)}
      style={{
        background:
          'conic-gradient(from 20deg, var(--uv), color-mix(in srgb, var(--uv) 45%, var(--ground)), var(--uv-2), var(--uv))',
      }}
    />
  );
}

export function AccountChip({
  address,
  href,
  onSelect,
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & { address: string; href: string; onSelect?: () => void }) {
  return (
    <a
      href={href}
      data-slot="account-chip"
      className={cn(
        'inline-flex items-center gap-[7px] rounded-[6px] border border-line py-1 pr-2 pl-[5px] font-mono text-[11.5px] text-ink-2 hover:text-ink',
        className,
      )}
      onClick={select(onSelect)}
      {...props}
    >
      <Avatar />
      {address}
    </a>
  );
}

export function Gear({
  href,
  onSelect,
  label = 'Settings',
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & { href: string; onSelect?: () => void; label?: string }) {
  return (
    <a
      href={href}
      aria-label={label}
      data-slot="gear"
      className={cn(
        'inline-flex size-[30px] items-center justify-center rounded-[6px] border border-line text-ink-2 hover:text-ink',
        className,
      )}
      onClick={select(onSelect)}
      {...props}
    >
      <Icon name="settings" size={15} />
    </a>
  );
}
