import { cn } from '@yacana/ui';

const R = 5;
const C = 2 * Math.PI * R;

/**
 * A 12 px ring filling over the expected epoch length, full and amber once the escape hatch is open
 * (`hatch` ≤ 0). Decorative: the sub beside it carries the words.
 */
export function EpochRing({
  elapsed,
  expected,
  hatch,
}: {
  elapsed: number;
  expected: number;
  hatch: number;
}) {
  const k = Math.min(1, Math.max(0, elapsed / Math.max(1, expected)));
  const past = hatch <= 0;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      className={cn('inline-block shrink-0 align-[-1px]', past ? 'text-warn' : 'text-uv-2')}
      data-testid="epoch-ring"
      data-past-hatch={past ? '1' : '0'}
    >
      <circle cx="6" cy="6" r={R} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="6"
        cy="6"
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={`${(past ? 1 : k) * C} ${C}`}
        transform="rotate(-90 6 6)"
      />
    </svg>
  );
}
