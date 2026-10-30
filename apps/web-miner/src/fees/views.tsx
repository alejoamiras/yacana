// The trade as each option draws it. Every phase's name carries `fees-step-<phase>` and the machine's
// status, so one scenario and one set of captures drive all three options.

import type { Step, TimelineItem, TrailItem } from '@yacana/ui';
import { useSetAtom } from 'jotai';
import type * as React from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { feesCardAtom } from '../fees-gate';
import { duration } from '../lib/format';
import { phaseLine, phaseName, STATION } from './copy';
import { type Funding, IN_FLIGHT, landed, type Shown, type StepState, type StepStatus } from './machine';
import type { FundingReads, QuoteStep, Standing } from './provider';

const STEPPER: Readonly<Record<StepStatus, Step['state']>> = {
  todo: 'pending',
  signing: 'active',
  running: 'active',
  late: 'warn',
  done: 'done',
  failed: 'failed',
};

const TRAIL: Readonly<Record<StepStatus, TrailItem['state']>> = {
  todo: 'todo',
  signing: 'on',
  running: 'on',
  late: 'warn',
  done: 'done',
  failed: 'bad',
};

// The timeline has no warn: a late phase stays current and its line says so.
const TIMELINE: Readonly<Record<StepStatus, TimelineItem['state']>> = {
  todo: 'todo',
  signing: 'on',
  running: 'on',
  late: 'on',
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

function rows(s: Shown): { step: StepState; plan: QuoteStep }[] {
  return s.quote.steps.map((plan, i) => ({
    plan,
    step: s.at === 'done' ? { phase: plan.phase, status: 'done' } : (s.steps[i] as StepState),
  }));
}

export const flight = (s: Funding): StepState | undefined =>
  s.at === 'trade' ? s.steps.find((x) => IN_FLIGHT.has(x.status)) : undefined;

const about = (seconds: number) => `about ${duration(seconds)}`;

export const stepperSteps = (s: Shown, elapsed: number | undefined): Step[] =>
  rows(s).map(({ step, plan }) => ({
    id: step.phase,
    label: <Mark step={step}>{phaseName(step.phase, s.quote)}</Mark>,
    state: STEPPER[step.status],
    ms: IN_FLIGHT.has(step.status) ? elapsed : undefined,
    right: step.status === 'todo' ? about(plan.etaSeconds) : undefined,
    detail: step.status === 'done' || step.status === 'failed' ? undefined : phaseLine(step.status, plan),
  }));

export const trailItems = (s: Shown): TrailItem[] => [
  ...rows(s).map(({ step }) => ({
    id: step.phase,
    label: <Mark step={step}>{STATION[step.phase]}</Mark>,
    state: TRAIL[step.status],
  })),
  { id: 'ready', label: 'ready', state: s.at === 'done' ? 'done' : 'todo' },
];

function timelineLine(step: StepState, plan: QuoteStep, elapsed: number | undefined): string {
  if (step.status === 'todo') return about(plan.etaSeconds);
  if (step.status === 'done') return 'done';
  if (step.status === 'failed') return 'did not go through';
  const line = phaseLine(step.status, plan);
  return elapsed === undefined ? line : `${line} ${duration(elapsed / 1000)}`;
}

export const timelineItems = (s: Shown, elapsed: number | undefined): TimelineItem[] =>
  rows(s).map(({ step, plan }) => ({
    id: step.phase,
    label: <Mark step={step}>{STATION[step.phase]}</Mark>,
    detail: timelineLine(step, plan, elapsed),
    state: TIMELINE[step.status],
  }));

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
