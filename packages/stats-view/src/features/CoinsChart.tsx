// Where the coins are, since launch: the emission as a line, what is on Aztec under it in violet,
// what is on Ethereum between the two in grey. One Plot, redrawn when the series or the width move.
import * as Plot from '@observablehq/plot';
import { useEffect, useRef } from 'react';
import type { CoinsPoint } from '../bridge-beat';
import { useWidth } from '../charts/plot';

const HEIGHT = 170;

export function CoinsChart({ points, symbol }: { points: CoinsPoint[]; symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el || width === 0 || points.length === 0) return;
    const x = (d: CoinsPoint) => new Date(d.t * 1000);
    const last = points[points.length - 1] as CoinsPoint;
    const plot = Plot.plot({
      width,
      height: HEIGHT,
      marginLeft: 44,
      marginRight: 16,
      marginTop: 16,
      marginBottom: 24,
      style: {
        background: 'transparent',
        color: 'var(--ink-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
      },
      x: { type: 'utc', label: null, ticks: 4 },
      y: { label: null, grid: true, ticks: 4, tickFormat: (v: number) => v.toLocaleString('en-US') },
      marks: [
        Plot.areaY(points, {
          x,
          y1: 0,
          y2: 'aztec',
          fill: 'var(--uv)',
          fillOpacity: 0.35,
          curve: 'step-after',
        }),
        Plot.areaY(points, {
          x,
          y1: 'aztec',
          y2: 'total',
          fill: 'var(--ink)',
          fillOpacity: 0.16,
          curve: 'step-after',
        }),
        Plot.lineY(points, { x, y: 'total', stroke: 'var(--uv)', strokeWidth: 1.5, curve: 'step-after' }),
        Plot.text([last], {
          x,
          y: 'aztec',
          text: () => `on Aztec · ${last.aztec.toLocaleString('en-US')} ${symbol}`,
          dy: 12,
          textAnchor: 'end',
          fill: 'var(--uv-2)',
        }),
        Plot.text([last], {
          x,
          y: 'total',
          text: () => `on Ethereum · ${last.ethereum.toLocaleString('en-US')}`,
          dy: -6,
          textAnchor: 'end',
          fill: 'var(--ink-2)',
        }),
      ],
    });
    el.replaceChildren(plot);
    return () => plot.remove();
  }, [points, width, symbol]);
  return (
    <figure
      aria-label="where the coins are, since launch: on Aztec in violet, on Ethereum in grey"
      className="m-0 w-full"
      data-testid="coins-chart"
      data-points={points.length}
    >
      <div ref={ref} className="min-h-[170px] w-full [&_svg]:overflow-visible" />
    </figure>
  );
}
