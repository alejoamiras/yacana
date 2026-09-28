import { PARAMS } from '@yacana/miner-core/generated/params';
import { Button, cn } from '@yacana/ui';
import { useSetAtom } from 'jotai';
import { introAtom } from '../intro';
import { HOW_HREF } from '../lib/apex';
import { amount } from '../lib/format';
import { useStartClick } from './use-start-click';

const REWARD = `${amount(PARAMS.REWARD, PARAMS.DECIMALS)} ${PARAMS.TOKEN_SYMBOL}`;

export function IntroStrip({ onStart, className }: { onStart: () => void; className?: string }) {
  const dismiss = useSetAtom(introAtom);
  const startClick = useStartClick(onStart);
  return (
    <section
      aria-label="About Yacana"
      data-testid="intro"
      className={cn(
        'flex flex-col gap-4 rounded-[10px] border border-uv/40 bg-uv-dim px-5 py-[18px] md:flex-row md:items-center md:gap-7',
        className,
      )}
    >
      <div className="flex grow flex-col gap-2">
        <p className="eyebrow">new here?</p>
        <p className="text-[19px] font-semibold tracking-[-0.01em]">
          Yacana is private money, mined by proving.
        </p>
        <p className="max-w-[760px] text-xs text-ink-2">
          Your browser proves a small circuit over and over. Each proof is a lottery ticket: one that reaches
          the difficulty mints {REWARD} into an account only you can open. The prover is Barretenberg, the one
          Aztec runs on, so the race to mine faster is a race to make Aztec faster.
        </p>
      </div>
      <div className="flex flex-none items-center gap-4">
        <Button variant="uv" data-testid="intro-start" onClick={startClick}>
          Start mining
        </Button>
        <a
          href={HOW_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-ink-2 underline decoration-ink-4 underline-offset-3 hover:text-ink"
        >
          How it works
          <span aria-hidden> ↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="intro-dismiss"
          onClick={() => dismiss()}
          className="size-7 rounded-md text-lg leading-none text-ink-3 outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          ×
        </button>
      </div>
    </section>
  );
}
