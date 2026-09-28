// The window's 48 epochs, one block each, width = duration, colour = what happened next: the
// retarget controller, visible. Under it the map of every epoch since launch with the window drawn
// over it; ‹ › page, a click or a drag on the map moves the window, ← → step, the URL keeps both.

import type { EpochRow } from '@yacana/miner-core/reader';
import { Badge, Button, cn } from '@yacana/ui';
import { firstEpoch } from '@yacana/web-kit/browser/connection';
import { useEffect } from 'react';
import type { FillState } from '../history-fill';
import { type EpochWindow, newerFrom, newestFrom, olderFrom } from '../window';
import { EpochMap } from './EpochMap';
import { Sk } from './Sk';

export interface StripProps {
  /** The window's rows, linked; null until they are held (beat two, or a window being fetched). */
  rows: readonly EpochRow[] | null;
  /** Every held row, linked: the map. */
  all: readonly EpochRow[];
  /** The chain's open epoch; a row without closing facts that is not it is closed, unread. */
  open: number | null;
  window: EpochWindow | null;
  selected: number | null;
  onSelect: (epoch: number | null) => void;
  /** Unix seconds "now" for the open epoch's width (the last block's time). */
  now: number;
  launchAt: number | null;
  onWindow: (from: number | null) => void;
  fill: FillState;
}

const MIN = 6;
const FIRST = firstEpoch();
const clock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);
const HINT =
  '48 epochs at a time · drag the window on the map, or ‹ › to page · the table follows · the URL keeps the window';

/** Colour by the next epoch: harder (retarget < 1) violet, easier grey, a roll amber. */
export const tone = (r: EpochRow, open: number): string => {
  if (r.epoch === open) return 'bg-panel border border-uv/60';
  if (r.duration === null) return 'bg-panel border border-dashed border-ink-3';
  if (r.closedBy === 'roll') return 'bg-warn/70';
  return (r.retarget ?? 1) < 1 ? 'bg-uv/70' : 'bg-ink-3';
};

/**
 * ← → from `current` (the open epoch when nothing is selected): the neighbour's epoch, null for the
 * open one, 'older' / 'newer' past an edge of the window. A selection outside the window steps in
 * from the right (←) or asks for the newer window (→).
 */
export function step(
  rows: readonly EpochRow[],
  current: number,
  dir: -1 | 1,
  open: number,
): number | null | 'older' | 'newer' {
  const i = rows.findIndex((r) => r.epoch === current);
  const last = rows[rows.length - 1];
  if (i < 0) return dir < 0 ? (last?.epoch ?? null) : 'newer';
  const j = i + dir;
  if (j < 0) return 'older';
  if (j >= rows.length) return last && last.epoch < open ? 'newer' : null;
  const e = (rows[j] as EpochRow).epoch;
  return e === open ? null : e;
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

/** The strip's row before its rows are held: the 28 px block and its two captions, at their widths. */
function RowSkeleton() {
  return (
    <>
      <Sk className="h-7 w-full" />
      <div className="flex justify-between gap-3">
        <Sk className="h-2.5 w-[90px]" />
        <Sk className="h-2.5 w-[140px]" />
      </div>
    </>
  );
}

function Row({
  rows,
  open,
  openRow,
  current,
  onSelect,
  now,
}: {
  rows: readonly EpochRow[];
  open: number;
  /** The open epoch's row from everything held: the window may be historical. */
  openRow: EpochRow | undefined;
  current: number;
  onSelect: (e: number | null) => void;
  now: number;
}) {
  // Width is a flex weight (seconds, clamped), so the row shares the container; many rows scroll.
  const widths = rows.map((r) =>
    Math.max(MIN, Math.min(400, (r.duration ?? Math.max(0, now - r.openedAt)) / 6)),
  );
  const lastClosed = rows.length >= 2 ? rows[rows.length - 2] : undefined;
  const first = rows[0];
  return (
    <>
      <div
        className="flex h-7 items-stretch gap-px overflow-x-auto"
        role="listbox"
        aria-label="epochs, oldest to newest"
      >
        {rows.map((r, i) => (
          <button
            type="button"
            key={r.epoch}
            role="option"
            aria-selected={r.epoch === current}
            aria-label={`epoch ${r.epoch}`}
            data-epoch={r.epoch}
            onClick={() => onSelect(r.epoch === open ? null : r.epoch)}
            style={{ flexGrow: widths[i], flexBasis: 0 }}
            className={cn(
              '@container min-w-[6px] shrink-0 overflow-hidden rounded-[2px] px-1 text-left font-mono text-2xs transition-[flex-grow] duration-200',
              tone(r, open),
              r.epoch === current && 'ring-2 ring-ink',
              r === lastClosed &&
                'motion-safe:animate-in motion-safe:slide-in-from-right-2 motion-safe:duration-[240ms]',
            )}
          >
            <span className="hidden rounded-[2px] bg-ground/75 px-[3px] text-ink @min-[24px]:inline">
              {r.epoch}
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-between gap-3 font-mono text-2xs text-ink-3">
        <span data-testid="strip-from">
          {first?.epoch === 0 ? 'launch' : `epoch ${first?.epoch ?? '—'}`}{' '}
          {first ? clock(first.openedAt) : ''}
        </span>
        <span>
          {openRow ? clock(openRow.openedAt) : '—'} · epoch {open} open
        </span>
      </div>
    </>
  );
}

/** What an arrow key does at `current` in `win`: a selection, a page (with the landing row), or nothing at the start. */
export function arrow(
  key: 'ArrowLeft' | 'ArrowRight',
  rows: readonly EpochRow[],
  current: number,
  win: EpochWindow,
  open: number,
): { select?: number | null; window?: number | null } | null {
  const next = step(rows, current, key === 'ArrowLeft' ? -1 : 1, open);
  if (next === 'older')
    return win.from === FIRST ? null : { window: olderFrom(win, open, FIRST), select: win.from - 1 };
  if (next === 'newer')
    return { window: newerFrom(win, open, FIRST), select: win.to + 1 >= open ? null : win.to + 1 };
  return { select: next };
}

function useArrowKeys(
  rows: readonly EpochRow[] | null,
  open: number | null,
  win: EpochWindow | null,
  current: number | null,
  onSelect: (e: number | null) => void,
  onWindow: (from: number | null) => void,
) {
  useEffect(() => {
    if (!rows || open === null || !win || current === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || typing(e.target)) return;
      e.preventDefault();
      const move = arrow(e.key, rows, current, win, open);
      if (!move) return;
      if (move.window !== undefined) onWindow(move.window);
      if (move.select !== undefined) onSelect(move.select);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, current, open, win, onSelect, onWindow]);
}

function Controls({
  win,
  open,
  current,
  fill,
  onWindow,
}: {
  win: EpochWindow | null;
  open: number | null;
  current: number | null;
  fill: FillState;
  onWindow: (from: number | null) => void;
}) {
  const ready = win !== null && open !== null;
  // The note once the fill has measured what is missing and not yet reached the chain's first epoch.
  const incomplete = fill.readTo !== null && fill.readTo > FIRST;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-ink-3">
        {HINT}
        {incomplete && (
          <span data-testid="fill-note">
            {' '}
            · older epochs are read a page at a time; the map fills over visits
          </span>
        )}
      </p>
      <span className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!ready || win.from === FIRST}
          onClick={() => ready && onWindow(olderFrom(win, open, FIRST))}
          data-testid="window-older"
        >
          ‹ older
        </Button>
        <Button
          size="sm"
          disabled={!ready || win.from === newestFrom(open, FIRST)}
          onClick={() => ready && onWindow(newerFrom(win, open, FIRST))}
          data-testid="window-newer"
        >
          newer ›
        </Button>
        {current === null ? (
          <Sk className="h-[22px] w-[72px]" />
        ) : (
          <Badge variant="uv" data-testid="strip-selected">
            epoch {current}
          </Badge>
        )}
      </span>
    </div>
  );
}

export function Strip(p: StripProps) {
  const { rows, all, open, window: win, selected, onSelect, now, launchAt, onWindow, fill } = p;
  const current = selected ?? open;
  useArrowKeys(rows, open, win, current, onSelect, onWindow);
  const ready = open !== null && win !== null && launchAt !== null;
  return (
    <div data-testid="strip" data-skeleton={ready && rows ? undefined : ''} className="flex flex-col gap-2">
      {rows && open !== null ? (
        <Row
          rows={rows}
          open={open}
          openRow={all.find((r) => r.epoch === open)}
          current={current as number}
          onSelect={onSelect}
          now={now}
        />
      ) : (
        <RowSkeleton />
      )}
      {ready ? (
        <EpochMap rows={all} open={open} from={win.from} launchAt={launchAt} onWindow={onWindow} />
      ) : (
        <Sk className="h-[26px] w-full" />
      )}
      <Controls win={win} open={open} current={current} fill={fill} onWindow={onWindow} />
    </div>
  );
}
