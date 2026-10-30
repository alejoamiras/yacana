import { useAtomValue } from 'jotai';
import { feesSearch } from '../fees-gate';
import { bootAtom } from '../state';
import { standsIn } from './entry';
import { MOCK_CHAINS, mockFunding, scriptFrom } from './mock';
import { OptionB } from './options/B';
import { FundingRun, type OptionProps } from './run';
import { FeesWallet } from './wallet';

let shared: Omit<OptionProps, 'signedIn'> | undefined;

/** One runner per tab: the card finds its trade again after a trip to Settings. */
function funding(): Omit<OptionProps, 'signedIn'> {
  if (!shared) {
    const { provider, reads } = mockFunding(scriptFrom(feesSearch));
    const scope = {
      chainId: import.meta.env.VITE_CHAIN_ID,
      rollupVersion: import.meta.env.VITE_ROLLUP_VERSION,
    };
    shared = { provider, reads, run: new FundingRun(provider, scope) };
  }
  return shared;
}

export default function Slot() {
  const boot = useAtomValue(bootAtom);
  const signedIn = boot.phase === 'ready' || standsIn(feesSearch);
  return (
    <FeesWallet chainId={MOCK_CHAINS[0]?.id ?? 0}>
      <OptionB {...funding()} signedIn={signedIn} />
    </FeesWallet>
  );
}
