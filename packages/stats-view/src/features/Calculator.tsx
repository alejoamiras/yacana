import { PARAMS } from '@yacana/miner-core/generated/params';
import { calculator } from '@yacana/miner-core/metrics';
import { Input, KvRow, Label, Sheet, SheetContent, SheetDescription, SheetTitle } from '@yacana/ui';
import { amount, duration } from '@yacana/web-kit/browser/format';
import { useState } from 'react';

const RULES = {
  N: PARAMS.N,
  EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS,
  T_MAX: PARAMS.T_MAX,
  REWARD: PARAMS.REWARD,
};

export function Calculator({
  open,
  onOpenChange,
  network,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  network: number;
  target: bigint;
}) {
  const [text, setText] = useState('10');
  const perMinute = Number(text);
  const r = calculator(perMinute, network, target, RULES);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="calculator-sheet">
        <SheetTitle>What would my rate earn?</SheetTitle>
        <SheetDescription>
          Against the network's ≈ {network.toFixed(2)} proofs/s, the current difficulty and the schedule of{' '}
          {PARAMS.N} × {amount(PARAMS.REWARD, PARAMS.DECIMALS)} {PARAMS.TOKEN_SYMBOL} per{' '}
          {PARAMS.EXPECTED_EPOCH_SECONDS} s. Expectations, not promises: a win could be now or 3× later.
        </SheetDescription>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rate">your proofs per minute</Label>
          <Input
            id="rate"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono"
            data-testid="calc-rate"
          />
        </div>
        <div className="flex flex-col">
          <KvRow
            label="share of the network"
            value={<span data-testid="calc-share">{(r.share * 100).toFixed(1)}%</span>}
          />
          <KvRow label="expected wait for a win" value={duration(r.secondsToWin)} />
          <KvRow
            label="expected per day"
            value={`${amount(r.perDay, PARAMS.DECIMALS, 2)} ${PARAMS.TOKEN_SYMBOL}`}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
