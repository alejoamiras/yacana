import { toCsv } from '@yacana/miner-core/csv';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty } from '@yacana/miner-core/metrics';
import { type EpochRow, rowsToJson } from '@yacana/miner-core/reader';
import { Button, cn, Tile, TileHeader } from '@yacana/ui';
import { firstEpoch } from '@yacana/web-kit/browser/connection';
import { Sk } from './Sk';

const FIRST = firstEpoch();
const clock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);
const HEAD = ['epoch', 'opened (UTC)', 'wins', 'duration', 'vs expected', 'difficulty', 'closed by', 'next'];
/** Rows beyond this scroll inside the tile; the header stays. */
const BODY_MAX = 'max-h-[460px]';
/** The skeleton: eight rows, one 10 px block per column at the canvas's widths. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];
const SKELETON_WIDTHS = [24, 60, 30, 48, 70, 34, 80, 44];
const CELL = 'border-b border-line py-1.5 pr-4';

/** A download the CSP allows: a blob URL on an anchor, revoked once clicked. */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Row({
  r,
  open,
  selected,
  onSelect,
}: {
  r: EpochRow;
  open: boolean;
  selected: number | null;
  onSelect: (e: number | null) => void;
}) {
  const expected = Number(PARAMS.EXPECTED_EPOCH_SECONDS);
  const dur = r.duration ?? 0;
  return (
    <tr
      data-epoch={r.epoch}
      onClick={() => onSelect(open ? null : r.epoch)}
      className={cn('cursor-pointer hover:bg-panel', r.epoch === selected && 'bg-uv-dim')}
    >
      <td className={CELL}>{r.epoch}</td>
      <td className={cn(CELL, 'text-ink-2')}>{clock(r.openedAt)}</td>
      <td className={CELL}>{open ? `${r.claims} of ${PARAMS.N}` : r.claims}</td>
      <td className={CELL}>{open ? 'open' : r.duration === null ? 'not read yet' : `${dur} s`}</td>
      <td className={cn(CELL, 'text-ink-2')}>
        {r.duration === null
          ? '–'
          : `${(dur / expected).toFixed(2)}×${dur > Number(PARAMS.T_MAX) ? ' · capped' : ''}`}
      </td>
      <td className={CELL}>{difficulty(r.target).toFixed(1)}</td>
      <td className={cn(CELL, 'text-ink-2')}>
        {r.closedBy === 'roll' ? 'the escape hatch' : r.closedBy ? `${PARAMS.N}th win` : '–'}
      </td>
      <td className={cn(CELL, 'text-ink-2')}>
        {r.retarget === null ? '–' : `×${(1 / r.retarget).toFixed(2)}`}
      </td>
    </tr>
  );
}

export function Table({
  rows,
  open,
  selected,
  onSelect,
  className,
}: {
  className?: string;
  /** The window's rows; null until they are held: eight skeleton rows, the count and the downloads dashed. */
  rows: readonly EpochRow[] | null;
  open: number | null;
  selected: number | null;
  onSelect: (epoch: number | null) => void;
}) {
  const link = 'h-auto font-mono text-2xs';
  const pending = rows === null || open === null;
  return (
    <Tile className={className}>
      <TileHeader
        aside={
          <span className="flex items-baseline gap-2">
            <span data-testid="table-count">
              {pending ? (
                '— of —'
              ) : (
                <>
                  {rows.length} of {open + 1 - FIRST}
                </>
              )}
            </span>
            · newest first ·
            <Button
              size="sm"
              variant="link"
              className={link}
              disabled={pending}
              onClick={() => rows && download('yacana-epochs.csv', toCsv(rows), 'text/csv')}
              data-testid="download-csv"
            >
              CSV
            </Button>
            ·
            <Button
              size="sm"
              variant="link"
              className={link}
              disabled={pending}
              onClick={() => rows && download('yacana-epochs.json', rowsToJson(rows), 'application/json')}
              data-testid="download-json"
            >
              JSON
            </Button>
          </span>
        }
      >
        epochs
      </TileHeader>
      {/* One scrollport: the sticky head needs separate borders (collapsed ones stay with the rows). */}
      <div className={cn('overflow-auto', BODY_MAX)} data-testid="table-scroll">
        <table className="w-full border-separate border-spacing-0 font-mono text-xs" data-testid="table">
          <thead className="sticky top-0 z-10 bg-raised">
            <tr className="text-left text-ink-2">
              {HEAD.map((h) => (
                <th key={h} className={cn(CELL, 'font-medium')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pending
              ? SKELETON_ROWS.map((i) => (
                  <tr key={i} data-skeleton="">
                    {SKELETON_WIDTHS.map((w, j) => (
                      <td key={HEAD[j]} className={CELL}>
                        <Sk className="h-2.5" style={{ width: w }} />
                      </td>
                    ))}
                  </tr>
                ))
              : [...rows]
                  .reverse()
                  .map((r) => (
                    <Row
                      key={r.epoch}
                      r={r}
                      open={r.epoch === open}
                      selected={selected}
                      onSelect={onSelect}
                    />
                  ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-2xs text-ink-3">
        ↕ scrolls · header stays · the strip's window, newest first
      </p>
    </Tile>
  );
}
