// The wallet's transaction prover on Presto. The SDK meters WASM proofs with the PXE's event; this
// adapter logs the same event for a proof Presto made, with the phases' timings.
import { type PrestoPhase, type PrestoPhaseData, PrestoProver } from '@alejoamiras/presto';
import { createLogger } from '@aztec-labs/foundation/log';
import type { PrivateExecutionStep } from '@aztec-labs/stdlib/kernel';
import { type PrestoEndpoint, type ProverKind, prestoConfig } from './presto';

const log = createLogger('web-miner:tx-prover');

export type TxPhase = (phase: PrestoPhase, data?: PrestoPhaseData) => void;

export class TxProver extends PrestoProver {
  /** The UI's listener for the proof under way; the meter's own tracking never depends on it. */
  onPhase: TxPhase | null = null;
  /** Told when a proof starts and when it ends, a thrown one included. */
  onProof: ((state: 'start' | 'end') => void) | null = null;
  #forced = false;
  #local = false;
  #marks: Record<string, number> = {};
  #t0 = 0;

  constructor(endpoint: PrestoEndpoint) {
    let note: (phase: PrestoPhase) => void = () => {};
    super({
      presto: prestoConfig(endpoint),
      onPhase: (phase, data) => {
        note(phase);
        this.onPhase?.(phase, data);
      },
    });
    // A fallback selects WASM, whose proof the SDK logs itself; `proved` is either side's (the
    // client says it of a remote proof too).
    note = (phase) => {
      this.#marks[phase] = Math.round(performance.now() - this.#t0);
      if (phase === 'fallback') this.#local = true;
    };
  }

  override setForceLocal(force: boolean) {
    this.#forced = force;
    super.setForceLocal(force);
  }

  override async createChonkProof(steps: PrivateExecutionStep[]) {
    this.#local = this.#forced;
    this.#marks = {};
    this.#t0 = performance.now();
    this.onProof?.('start');
    try {
      const proof = await super.createChonkProof(steps);
      if (!this.#local)
        log.info('Generated ClientIVC proof through Presto', {
          eventName: 'client-ivc-proof-generation',
          duration: performance.now() - this.#t0,
          prover: 'presto' satisfies ProverKind,
          phases: this.#marks,
        });
      return proof;
    } finally {
      this.onProof?.('end');
    }
  }
}
