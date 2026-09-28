// Every epoch since launch as a bar at its absolute cell, the window box over the 48 shown, and
// the day axis under it. A click centres the window on the epoch under the pointer; the box drags.

import type { EpochRow } from '@yacana/miner-core/reader';
import { cn } from '@yacana/ui';
import { firstEpoch } from '@yacana/web-kit/browser/connection';
import { memo, type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from 'react';
import { useWidth } from '../charts/plot';
import { barsFor, dayTicks, epochAtX, MAP_HEIGHT, type Tone, thinTicks, windowBox } from '../map-geometry';
import { centredFrom, newestFrom, normaliseFrom } from '../window';

const FIRST = firstEpoch();

const FILL: Record<Tone, string> = {
  harder: 'color-mix(in srgb, var(--uv) 50%, transparent)',
  easier: 'var(--ink-4)',
  roll: 'color-mix(in srgb, var(--warn) 75%, transparent)',
  open: 'var(--uv-2)',
};

export interface EpochMapProps {
  /** Every held row, linked; the bars. */
  rows: readonly EpochRow[];
  open: number;
  /** The window's first epoch. */
  from: number;
  launchAt: number;
  onWindow: (from: number | null) => void;
}

/**
 * The box follows the pointer while it drags and the URL gets the window once on release: a drag
 * is one window change, not one per pixel (each would fetch).
 */
function useDragWindow(open: number, from: number, onWindow: (from: number | null) => void) {
  const [live, setLive] = useState<number | null>(null);
  /** The same value outside React's batching: the release reads it once, whatever Strict Mode replays. */
  const liveRef = useRef<number | null>(null);
  const start = useRef<{ x: number; from: number; width: number } | null>(null);
  const move = useCallback((f: number | null) => {
    liveRef.current = f;
    setLive(f);
  }, []);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const rail = e.currentTarget.parentElement;
      if (!rail || e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, from, width: rail.getBoundingClientRect().width };
      move(from);
    },
    [from, move],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = start.current;
      if (!s || s.width <= 0) return;
      const cells = Math.round(((e.clientX - s.x) / s.width) * (open + 1 - FIRST));
      move(Math.min(newestFrom(open, FIRST), Math.max(FIRST, s.from + cells)));
    },
    [open, move],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      start.current = null;
      const f = liveRef.current;
      move(null);
      if (f !== null && f !== from) onWindow(normaliseFrom(f, open, FIRST));
    },
    [from, open, onWindow, move],
  );
  return { from: live ?? from, dragging: live !== null, onPointerDown, onPointerMove, onPointerUp };
}

function DayAxis({
  rows,
  launchAt,
  open,
  width,
}: {
  rows: readonly EpochRow[];
  launchAt: number;
  open: number;
  width: number;
}) {
  const ticks = thinTicks(dayTicks(rows, launchAt, open, FIRST), width);
  return (
    <div className="relative h-4 border-line border-t font-mono text-2xs text-ink-3" data-testid="day-axis">
      {ticks.map((t, i) => (
        <span
          key={t.label}
          className={cn(
            'absolute top-0.5 whitespace-nowrap',
            i === 0 ? 'left-0' : i === ticks.length - 1 ? 'right-0' : '-translate-x-1/2',
          )}
          style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${t.x * 100}%` }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** Memoised: the page re-renders every second for its clock; the map's inputs change on a read or a window move. */
export const EpochMap = memo(function EpochMap({ rows, open, from, launchAt, onWindow }: EpochMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const drag = useDragWindow(open, from, onWindow);
  const bars = barsFor(rows, open, FIRST);
  const box = windowBox(drag.from, open, FIRST);
  const click = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    onWindow(centredFrom(epochAtX((e.clientX - rect.left) / rect.width, open, FIRST), open, FIRST));
  };
  return (
    <div ref={ref} className="flex flex-col" data-testid="epoch-map">
      <div
        className="relative h-[26px] cursor-crosshair touch-none select-none"
        onPointerDown={click}
        data-testid="map-rail"
      >
        <svg
          className="absolute inset-x-0 top-1 w-full"
          style={{ height: MAP_HEIGHT }}
          viewBox={`0 0 1 ${MAP_HEIGHT}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          aria-hidden
          data-testid="map-bars"
        >
          {bars.map((b) => (
            <rect key={b.epoch} x={b.x} width={b.w} y={MAP_HEIGHT - b.h} height={b.h} fill={FILL[b.tone]} />
          ))}
        </svg>
        <div
          role="slider"
          aria-label="the window on the map"
          aria-valuemin={FIRST}
          aria-valuemax={newestFrom(open, FIRST)}
          aria-valuenow={drag.from}
          tabIndex={-1}
          data-testid="map-window"
          data-dragging={drag.dragging ? '' : undefined}
          className="absolute inset-y-0 min-w-[3px] cursor-grab rounded-[2px] border border-uv-2 bg-uv/12 data-[dragging]:cursor-grabbing"
          style={{ left: `${box.x * 100}%`, width: `${box.w * 100}%` }}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerUp}
        />
      </div>
      <DayAxis rows={rows} launchAt={launchAt} open={open} width={width} />
    </div>
  );
});
