import type { EpochRow } from '@yacana/miner-core/reader';
import { Tile, TileBoundary, TileHeader } from '@yacana/ui';
import type { ReactNode } from 'react';
import { type ChartProps, Difficulty, Duration, Emission, Retarget } from '../charts/index.tsx';

function ChartTile({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tile className={className}>
      <TileHeader aside={aside}>{title}</TileHeader>
      <TileBoundary name={`chart:${title}`}>{children}</TileBoundary>
    </Tile>
  );
}

/** Before beat two the charts draw their axes over no data (the specs' empty branch); `rows` is null then. */
export function ChartRows({
  rows,
  open,
  ...rest
}: Omit<ChartProps, 'rows' | 'open'> & { rows: readonly EpochRow[] | null; open: number | null }) {
  const charts: ChartProps = { ...rest, rows: rows ?? [], open: open ?? 0 };
  return (
    <>
      <ChartTile
        title="difficulty"
        aside={`per epoch, log scale · ${rows?.length ?? '—'} epochs`}
        className="border-line-2 md:col-span-6"
      >
        <Difficulty {...charts} />
      </ChartTile>
      <div className="grid gap-[14px] md:col-span-6 md:grid-cols-3" data-testid="small-multiples">
        <ChartTile title="emission" aside="against the schedule">
          <Emission {...charts} />
        </ChartTile>
        <ChartTile title="epoch duration" aside="amber = the escape hatch">
          <Duration {...charts} />
        </ChartTile>
        <ChartTile title="retarget at each close" aside="violet harder · grey easier">
          <Retarget {...charts} />
        </ChartTile>
      </div>
    </>
  );
}
