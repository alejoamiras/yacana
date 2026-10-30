// The Ethereum wallet the flow pays from, on the page's one injected connection: with a bridge session
// open the flow sits on the session's config, so a wallet connected for the bridge is connected here.
// With none (signed out under the flag, or a network with no bridge record) the flow builds its own,
// whose storage key keeps its persisted connection and disconnect marker apart from the bridge's;
// once a bridge session opens, that one takes over and the flow's own stays idle. The flow connects
// and reads the account and the chain, and nothing else: no read, transport, signature or write.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { type ReactNode, useEffect } from 'react';
import { type Config, createConfig, createStorage, custom, injected, useAccount, WagmiProvider } from 'wagmi';
import { bridgeChain } from '../bridge/eth';
import { bridgeSessionAtom } from '../state';
import type { FundingRun } from './run';

export const OWN_STORAGE_KEY = 'yacana.fees.wagmi';

let own: Config | undefined;

function ownConfig(chainId: number): Config {
  if (!own) {
    const chain = bridgeChain({ chainId, rpcUrl: '' });
    own = createConfig({
      chains: [chain],
      connectors: [injected()],
      // Connecting asks the wallet alone; a read through this config is a bug, so it fails here rather than reach an RPC.
      transports: {
        [chain.id]: custom({ request: () => Promise.reject(new Error('the fee flow reads no chain')) }),
      },
      multiInjectedProviderDiscovery: true,
      storage: createStorage({ storage: localStorage, key: OWN_STORAGE_KEY }),
    });
  }
  return own;
}

const queries = new QueryClient();

/** `chainId`: the chain the flow's own config names when no bridge session is open. */
export function FeesWallet({ chainId, children }: { chainId: number; children: ReactNode }) {
  const bridge = useAtomValue(bridgeSessionAtom);
  const config = bridge?.config ?? ownConfig(chainId);
  return (
    // Keyed so a session opening mid-visit mounts wagmi afresh on its config rather than swapping it under live hooks.
    <WagmiProvider key={bridge ? 'bridge' : 'own'} config={config}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

/** "One installed wallet": the connectors wagmi built from EIP-6963 announcements, without the generic `injected` it keeps beside them. */
export const announced = <C extends { id: string }>(connectors: readonly C[]): C[] =>
  connectors.filter((c) => c.id !== 'injected');

/** The connected account; quotes are asked for it as the payer. */
export function usePayer(run: FundingRun): ReturnType<typeof useAccount> {
  const account = useAccount();
  useEffect(() => {
    run.payer = account.address ?? '';
  }, [run, account.address]);
  return account;
}
