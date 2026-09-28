import '@yacana/web-kit/browser/node-guard';
import './index.css';
import { DEFAULT_LIMITS } from '@yacana/miner-core/reader';
import { createStatsRuntime } from '@yacana/stats-view/runtime';
import { ThemeProvider } from '@yacana/ui';
import { loadConnection } from '@yacana/web-kit/browser/connection';
import { ethRpcClient } from '@yacana/web-kit/browser/eth-rpc';
import { nodeClient } from '@yacana/web-kit/browser/node';
import { setEthRpcEndpoint, setNodeEndpoint } from '@yacana/web-kit/browser/node-guard';
import { markRead, startNodeHealth } from '@yacana/web-kit/browser/node-health';
import { createStore, Provider } from 'jotai';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const ETH_RPC_DEADLINE_MS = 10_000;

const store = createStore();
const connection = loadConnection();
// A read the reader gave up on ends with it: one deadline per request, no transport retries (the SDK's
// default would keep an abandoned read alive through three more attempts).
setNodeEndpoint(connection.nodeUrl, DEFAULT_LIMITS.timeoutMs);
const bridged = !!import.meta.env.VITE_BRIDGE;
if (bridged) setEthRpcEndpoint(connection.ethRpcUrl, ETH_RPC_DEADLINE_MS);
startNodeHealth();

const runtime = createStatsRuntime({
  store,
  connection,
  node: nodeClient(connection.nodeUrl),
  eth: bridged ? ethRpcClient(connection.ethRpcUrl) : undefined,
  fill: true,
  onFresh: () => markRead(),
});
runtime.start();

declare global {
  interface Window {
    yacanaStats?: { store: typeof store; poll: () => Promise<void> };
  }
}
window.yacanaStats = { store, poll: runtime.poll };

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Provider store={store}>
        <App connection={connection} onWindow={(w) => void runtime.showWindow(w)} />
      </Provider>
    </ThemeProvider>
  </StrictMode>,
);
