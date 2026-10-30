// The trade as each option draws it. Every station carries `fees-step-<phase>` and the machine's
// status, so one scenario and one set of captures drive all three options; the recovery file's
// station, `fees-step-file`, reads `waiting` until the file is saved.

import type { TrailItem } from '@yacana/ui';
import { useSetAtom } from 'jotai';
import type * as React from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { feesCardAtom } from '../fees-gate';
import { STATION } from './copy';
import { type Funding, IN_FLIGHT, landed, type Shown, type StepState, type StepStatus } from './machine';
import type { FundingReads, Standing } from './provider';

const TRAIL: Readonly<Record<StepStatus, TrailItem['state']>> = {
  todo: 'todo',
  signing: 'on',
  running: 'on',
  late: 'warn',
  done: 'done',
  failed: 'bad',
};

function Mark({ step, children }: { step: StepState; children: React.ReactNode }) {
  return (
    <span data-testid={`fees-step-${step.phase}`} data-state={step.status}>
      {children}
    </span>
  );
}

const stepsOf = (s: Shown): StepState[] =>
  s.at === 'done' ? s.quote.steps.map((x) => ({ phase: x.phase, status: 'done' })) : [...s.steps];

export const flight = (s: Funding): StepState | undefined =>
  s.at === 'trade' ? s.steps.find((x) => IN_FLIGHT.has(x.status)) : undefined;

/** A trade whose recovery file is not saved yet: no step may start. */
export const unsaved = (s: Funding): boolean => s.at === 'trade' && s.saved === null;

export const trailItems = (s: Shown): TrailItem[] => [
  {
    id: 'file',
    label: (
      <span data-testid="fees-step-file" data-state={unsaved(s) ? 'waiting' : 'done'}>
        file
      </span>
    ),
    state: unsaved(s) ? 'on' : 'done',
  },
  ...stepsOf(s).map((step) => ({
    id: step.phase,
    label: <Mark step={step}>{STATION[step.phase]}</Mark>,
    state: TRAIL[step.status],
  })),
  { id: 'ready', label: 'ready', state: s.at === 'done' ? 'done' : 'todo' },
];

/**
 * Whether a stopped trade's retry asks for a new quote first: nothing landed and the quote ran out, as the
 * machine's retry decides. Flips at the quote's expiry while the failure stands.
 */
export function useRequotes(s: Funding): boolean {
  const waiting = s.at === 'trade' && s.failure !== null && !landed(s);
  const expiresAt = s.at === 'trade' ? s.quote.expiresAt : 0;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(id);
  }, [waiting, expiresAt]);
  return waiting && now >= expiresAt;
}

/** The account's standing, read when the flow comes to rest (idle or done); undefined until the first answer. */
export function useStanding(reads: FundingReads, at: Funding['at']): Standing | undefined {
  const [standing, setStanding] = useState<Standing>();
  useEffect(() => {
    if (at !== 'idle' && at !== 'done') return;
    const ctl = new AbortController();
    reads.standing(ctl.signal).then(
      (x) => !ctl.signal.aborted && setStanding(x),
      () => {},
    );
    return () => ctl.abort();
  }, [reads, at]);
  return standing;
}

/** Tells the cockpit whether the flow's card is drawn, before paint, so its rows never count an absent card. */
export function useCardCounted(drawn: boolean): void {
  const set = useSetAtom(feesCardAtom);
  useLayoutEffect(() => {
    set(drawn);
    return () => set(false);
  }, [set, drawn]);
}
