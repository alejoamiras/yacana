/// <reference lib="webworker" />
import './shims/node-globals';
import '@yacana/web-kit/browser/node-guard';
import '@yacana/web-kit/pinned-crs';
import { BackendType, Barretenberg } from '@aztec-foundation/bb.js';
import type { WorkArtifact } from '@yacana/miner-core/work';
import { purgeCrsCache } from '@yacana/web-kit/pinned-crs';
import { createProverLoop } from './prover-loop';
import { createWorkerBackend } from './worker-backend';
import type { FromWorker, ToWorker } from './worker-protocol';

const backend = createWorkerBackend({
  post: (m: FromWorker) => self.postMessage(m),
  async loadArtifact() {
    // bb.js prefers its IndexedDB copy of the CRS over any download: only bytes that went through
    // the pinned path may be there, so the cache is dropped before the backend is created.
    await purgeCrsCache();
    return (await (await fetch('/artifacts/yacana_work.json')).json()) as WorkArtifact;
  },
  api: (threads) => Barretenberg.new({ threads, backend: BackendType.WasmWorker }),
});

const loop = createProverLoop(backend, (m) => self.postMessage(m));
self.onmessage = (e: MessageEvent<ToWorker>) => loop.handle(e.data);
