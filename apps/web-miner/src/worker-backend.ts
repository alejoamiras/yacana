// The prover Worker's backend behind the loop: builds the prover a config asks for, mines over it,
// and withdraws Presto's authority at once when told. Its Worker globals are injected so a revoke
// that lands in the middle of a build can be tested outside a Worker.
import type { Barretenberg } from '@aztec-foundation/bb.js';
import { BbJsWorkProver, type WorkArtifact, type WorkProver } from '@yacana/miner-core/work';
import { setAcceleratorEndpoints } from '@yacana/web-kit/browser/node-guard';
import { ACCELERATOR_DEADLINE_MS, acceleratorUrls, downloadPhases, type PrestoEndpoint } from './presto';
import { PrestoWorkProver } from './presto-prover';
import type { ProverBackend } from './prover-loop';
import { mineFrom } from './worker-mine';
import type { FromWorker, MineJob, ProverConfig } from './worker-protocol';

export interface WorkerBackendDeps {
  post: (m: FromWorker) => void;
  /** W's compiled circuit, after whatever the realm must do before a backend exists (the CRS purge). */
  loadArtifact: () => Promise<WorkArtifact>;
  api: (threads: number) => Promise<Barretenberg>;
}

export function createWorkerBackend({ post, loadArtifact, api }: WorkerBackendDeps): ProverBackend {
  let prover: WorkProver | undefined;
  /** Read when a WASM prover is built: Presto's fallback builds one lazily, after the count may have changed. */
  let wasmThreads = 1;
  /** Moves on every revoke; a build that started before one may not admit Presto when it finishes. */
  let authEpoch = 0;

  const nativeProver = (artifact: WorkArtifact, presto: PrestoEndpoint): WorkProver =>
    new PrestoWorkProver(artifact, () => api(wasmThreads), presto, {
      prover: (kind, t) => post({ type: 'prover', kind, sticky: t.sticky, reason: t.reason }),
      phase: downloadPhases((phase) => post({ type: 'presto-phase', phase })),
      verified: () => post({ type: 'native-verified' }),
    });

  async function build({ threads, presto }: ProverConfig): Promise<WorkProver> {
    const epoch = authEpoch;
    // Set before the wait below: a `threads` message that lands during it is the newer count.
    wasmThreads = threads;
    const artifact = await loadArtifact();
    if (!presto || authEpoch !== epoch) {
      setAcceleratorEndpoints(null, 0);
      return new BbJsWorkProver(artifact, await api(wasmThreads));
    }
    // This realm's guard learns Presto's URLs before the SDK's first probe; WASM is built only on demand.
    setAcceleratorEndpoints(acceleratorUrls(presto), ACCELERATOR_DEADLINE_MS);
    return nativeProver(artifact, presto);
  }

  return {
    async init(config) {
      const t0 = performance.now();
      prover = await build(config);
      post({
        type: 'ready',
        threads: config.threads,
        initMs: performance.now() - t0,
        prover: prover instanceof PrestoWorkProver ? 'presto' : 'wasm',
      });
    },
    async destroy() {
      await prover?.destroy();
      prover = undefined;
    },
    threads(threads) {
      wasmThreads = threads;
    },
    revoke() {
      authEpoch++;
      setAcceleratorEndpoints(null, 0);
      if (prover instanceof PrestoWorkProver) prover.forceLocal('revoked');
    },
    mine(job: MineJob, keepGoing) {
      if (!prover) throw new Error('prover not initialised');
      return mineFrom(prover, job, job.startNonce, keepGoing, post);
    },
  };
}
