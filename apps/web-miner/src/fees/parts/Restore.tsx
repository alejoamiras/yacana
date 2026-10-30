// Loading a funding's recovery file: refused unread above the size cap, checked against this
// network, then resumed from what the provider has for its commitment. A refused file changes nothing.

import { cn, Note } from '@yacana/ui';
import { type ReactNode, useRef, useState } from 'react';
import type { FundingRun } from '../run';

export function Restore({
  run,
  label,
  className,
}: {
  run: FundingRun;
  label: ReactNode;
  className?: string;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // A second file chosen while the first is read supersedes it: only the latest load's outcome shows.
  const latest = useRef(0);
  const load = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Cleared at once, so choosing the same file again fires again.
    input.value = '';
    if (!file) return;
    const n = ++latest.current;
    setReading(true);
    setRefused(null);
    const line = await run.restore(file);
    if (n !== latest.current) return;
    setReading(false);
    setRefused(line);
  };
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label className="cursor-pointer self-start text-xs text-ink-2 underline underline-offset-3 hover:text-ink">
        {reading ? 'Reading the file…' : label}
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => void load(e.currentTarget)}
          data-testid="fees-restore"
        />
      </label>
      {refused && (
        <Note tone="bad" title="This file cannot resume a funding." data-testid="fees-restore-error">
          {refused}
        </Note>
      )}
    </div>
  );
}
