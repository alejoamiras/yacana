import { useAtomValue } from 'jotai';
import { feesOption, feesSearch } from '../fees-gate';
import { bootAtom } from '../state';
import { standsIn } from './entry';
import { MOCK_CHAINS, mockFunding, scriptFrom } from './mock';
import { OptionD } from './options/D';
import { OptionE } from './options/E';
import { OptionF } from './options/F';
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

const OPTIONS = { d: OptionD, e: OptionE, f: OptionF } as const;

export default function Slot() {
  const boot = useAtomValue(bootAtom);
  const signedIn = boot.phase === 'ready' || standsIn(feesSearch);
  const Option = OPTIONS[feesOption ?? 'e'];
  return (
    <FeesWallet chainId={MOCK_CHAINS[0]?.id ?? 0}>
      <Option {...funding()} signedIn={signedIn} />
    </FeesWallet>
  );
}
