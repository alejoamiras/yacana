import { Preflight, type PreflightRow, Tile } from '@yacana/ui';

/** The preflight's rows while it runs: the cockpit takes over the moment it passes. */
export function PreflightTile({ rows }: { rows: PreflightRow[] }) {
  return (
    <Tile>
      <h2 className="label-mono mb-3">preflight</h2>
      <Preflight rows={rows} />
      <p className="mt-4 text-xs text-ink-2">
        The proving keys download in the background and are checked against their pinned hashes.
      </p>
    </Tile>
  );
}
