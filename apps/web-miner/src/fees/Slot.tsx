import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { type FeesPlacement, feesOption, PLACEMENT } from '../fees-gate';
import { bootAtom } from '../state';
import { mockProvider, scriptFrom } from './mock';
import { OptionA } from './options/A';
import { OptionB } from './options/B';
import { OptionC } from './options/C';
import type { OptionProps } from './parts/Choose';
import { FundingRun } from './run';

/** Signed out, the flow quotes for this fixed account, so every state is reachable without a node. */
export const STAND_IN = `0x${'0'.repeat(60)}fee5`;

const OPTIONS = { a: OptionA, b: OptionB, c: OptionC } as const;

let shared: Omit<OptionProps, 'account'> | undefined;

/** One runner per tab, made on first use: B's card finds its trade again after a trip to Settings. */
function funding(): Omit<OptionProps, 'account'> {
  if (!shared) {
    const provider = mockProvider(scriptFrom(location.search));
    shared = { provider, run: new FundingRun(provider) };
  }
  return shared;
}

export default function Slot({ at }: { at: FeesPlacement }) {
  const boot = useAtomValue(bootAtom);
  const { run, provider } = funding();
  const account = boot.phase === 'ready' ? boot.account : STAND_IN;
  useEffect(() => {
    run.recipient = account;
  }, [run, account]);
  if (!feesOption || PLACEMENT[feesOption] !== at) return null;
  const Option = OPTIONS[feesOption];
  return <Option run={run} provider={provider} account={account} />;
}
