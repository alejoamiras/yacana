// The one frame every money flow shares. What a dialog says is its own; how it is laid out is here.

import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@yacana/ui';
import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A dialog that can outgrow the window: anchored a fifth of the way down (24 to 180 px), never closer
 * than 24 px to the bottom, scrolling inside past that. Centred and uncapped, its title and its action
 * would leave the window.
 */
export const FITS_WINDOW =
  'top-[clamp(24px,20vh,180px)] max-h-[calc(100vh_-_clamp(24px,20vh,180px)_-_24px)] translate-y-0 overflow-y-auto';

export function TxDialog({
  open,
  onOpenChange,
  eyebrow,
  title,
  body,
  locked = false,
  fitsWindow = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogContent>, 'title'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  /** While something proves or a wallet is being asked: no close, no dismiss. */
  locked?: boolean;
  /** Content that can be longer than the window: the account dialog's rule, `FITS_WINDOW`. */
  fitsWindow?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !locked && onOpenChange(false)}>
      <DialogContent
        size="tx"
        className={cn(fitsWindow && FITS_WINDOW, className)}
        hideClose={locked}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onInteractOutside={(e) => locked && e.preventDefault()}
        {...props}
      >
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.14em] text-uv-2">
            {eyebrow}
          </span>
          <DialogTitle className="text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink">
            {title}
          </DialogTitle>
          {body ? (
            <DialogDescription className="text-sm leading-[1.5] text-ink-2 [text-wrap:pretty]">
              {body}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A summary row: the label, the value, and a second line under the value when there is one. */
export function Row({
  label,
  children,
  sub,
  className,
  ...props
}: React.ComponentProps<'div'> & { label: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div
      data-slot="summary-row"
      className={cn(
        'flex items-start justify-between gap-4 border-t border-line py-2.5 text-[13px] first:border-t-0',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-ink-2">{label}</span>
      <span className="flex min-w-0 flex-col items-end text-right text-ink">
        <span>{children}</span>
        {sub !== undefined && <span className="font-mono text-2xs text-ink-3">{sub}</span>}
      </span>
    </div>
  );
}

export const Rows = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex flex-col', className)}>{children}</div>
);

/** The line under a stepper: what the user may do now. */
export function Foot({ children, ...props }: React.ComponentProps<'p'>) {
  return (
    <p className="border-t border-line pt-3 text-xs leading-[1.5] text-ink-3 [text-wrap:pretty]" {...props}>
      {children}
    </p>
  );
}

/** The primary action and, to its right, the quiet way out or the quiet extra. */
export function Actions({
  children,
  quiet,
  below,
}: {
  children: React.ReactNode;
  quiet?: React.ReactNode;
  /** One small mono line under the row: what pressing the button costs. */
  below?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {children}
        {quiet}
      </div>
      {below !== undefined && <p className="font-mono text-2xs text-ink-3">{below}</p>}
    </div>
  );
}

export function Primary({ className, variant = 'uv', ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant={variant} size="lg" className={cn('h-[44px] px-5 text-[15px]', className)} {...props} />
  );
}

export function Quiet({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'text-[13px] text-ink-2 underline decoration-ink-4 underline-offset-3 hover:text-ink disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** A screen reached from a quiet link, with the way back at the top. */
export function Back({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-ink"
      data-testid="back"
    >
      <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
        <path
          d="M10 3 5 8l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back
    </button>
  );
}

/** Under the amount: the refusal on the left when there is one, the balance on the right. */
export function AmountBelow({ line, balance }: { line: string | null; balance: string }) {
  return (
    <span className="flex justify-between gap-3">
      {line !== null && (
        <span className="text-bad" data-testid="amount-refusal">
          {line}
        </span>
      )}
      <span className="ml-auto">balance {balance}</span>
    </span>
  );
}

/**
 * A key that changes on every opening. A dialog keyed on it mounts afresh each time: the last run's
 * screens and fields never show through, and a reopen during the last run's fade-out starts a new
 * dialog instead of reviving the closing one, which Radix keeps mounted until its exit animation
 * ends and can leave stuck with its overlay up.
 */
export function useOpening(open: boolean): number {
  const [state, setState] = useState({ open, run: 0 });
  if (state.open !== open) setState({ open, run: open ? state.run + 1 : state.run });
  return state.run;
}

/**
 * Whether the dialog is still open, as read after an await: a click's work that outlives a close
 * (a validation still running when Cancel came) must not send. An owner that unmounts the dialog
 * instead of closing it never renders `open` false, so unmounting reads as closed too.
 */
export function useLive(open: boolean): () => boolean {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    ref.current = open;
    return () => {
      ref.current = false;
    };
  }, [open]);
  return useCallback(() => ref.current, []);
}

/**
 * One click's work at a time: a second click while the first is still validating or asking the
 * wallet does nothing, and the button reads busy meanwhile. The guard is synchronous — set before
 * the first await — so two clicks in one tick cannot both pass.
 */
export function useOnce(): { busy: boolean; once: (work: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const once = useCallback(async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, once };
}

/** Seconds since `since`, ticking while it is set: the running step's right column. */
export function useElapsed(since: number | undefined): number | undefined {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since === undefined ? undefined : Math.max(0, now - since);
}

export const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`;

/** A unix-seconds string as the clock reads it, UTC: "17:03". */
export const hhmm = (unix: string): string => new Date(Number(unix) * 1000).toISOString().slice(11, 16);

/** The first line of an error, which is what the wallet or the node said before the stack. */
export const firstLine = (e: unknown): string =>
  e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e);
