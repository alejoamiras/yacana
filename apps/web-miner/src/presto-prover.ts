// The work prover through Presto: the same circuit and witness as bb.js, proved by the native app
// when it answers and by the WASM backend inside the same object when it does not — on the same
// witness, so the mining loop (which holds this prover for a whole run of nonces) never notices.
import {
  type PrestoPhase,
  PrestoUltraHonkBackend,
  PrestoUnavailableError,
  type VerifierTarget,
} from '@alejoamiras/presto-noir';
import type { Barretenberg } from '@aztec-foundation/bb.js';
import { Noir } from '@aztec-foundation/noir-noir_js';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { PROOF_FIELDS } from '@yacana/miner-core/proof';
import type { WorkArtifact, WorkInputs, WorkProver, WorkResult } from '@yacana/miner-core/work';
import { W_VK_BYTES } from '@yacana/work-circuit/generated/vk';
import { type FallbackCause, type PrestoEndpoint, type ProverKind, prestoConfig } from './presto';

const TARGET: VerifierTarget = 'noir-recursive-no-zk';
/** The bb release both provers must share, or their proofs would differ for one witness. */
export const BB_VERSION = '6.0.0';
/** Busy answers in a row (429/503/408/413 — other tabs share Presto's queue) before WASM is for good. */
const TRANSIENT_LIMIT = 3;

export interface ProverTransition {
  /** True when WASM is now the prover for the rest of this Worker's life (until a rebuild). */
  sticky: boolean;
  reason?: FallbackCause;
}

export interface PrestoProverHooks {
  /** Every change of what actually proved: the page's ✦ follows this, not the construction. */
  prover: (kind: ProverKind, t: ProverTransition) => void;
  phase?: (p: PrestoPhase) => void;
  /** This build's first native proof verified against its own inputs: what "Presto proved here" means. */
  verified?: () => void;
}

const field = (v: Fr | bigint): string => (v instanceof Fr ? v : new Fr(v)).toString();

/** bn254's scalar modulus, big-endian: bb.js throws on an element at or above it instead of rejecting the proof. */
const MODULUS_BYTES = Buffer.from(Fr.MODULUS.toString(16).padStart(64, '0'), 'hex');

/** W's proof shape with every element canonical — the only bytes the digest and the verifier may see. */
function wellFormed(proof: Uint8Array): boolean {
  if (proof.length !== PROOF_FIELDS * 32) return false;
  for (let i = 0; i < proof.length; i += 32) {
    if (Buffer.from(proof.subarray(i, i + 32)).compare(MODULUS_BYTES) >= 0) return false;
  }
  return true;
}

/**
 * Resolves behind the messages already queued for this realm's never-transferred ports: HTML
 * delivers those as one FIFO, and the Worker's own port is one of them. A transferred port has its
 * own queue and no such ordering; none carries the revoke.
 */
const queuedMessages = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });

export class PrestoWorkProver implements WorkProver {
  private readonly noir: Noir;
  private readonly backend: PrestoUltraHonkBackend;
  private stuck: FallbackCause | undefined;
  private transients = 0;
  private reported: ProverKind | null = null;
  private last: ProverKind = 'wasm';
  /**
   * The first native proof of this build, once it verified; every later one is trusted as today
   * (a win is still verified before it is claimed). Lives with the build: a rebuild verifies again.
   */
  private verifiedProof: Uint8Array | undefined;

  constructor(
    artifact: WorkArtifact,
    api: () => Promise<Barretenberg>,
    endpoint: PrestoEndpoint,
    private readonly on: PrestoProverHooks,
  ) {
    this.noir = new Noir(artifact as ConstructorParameters<typeof Noir>[0]);
    // `fallback: 'none'`: the typed reason decides here whether WASM is for one witness or for good.
    this.backend = new PrestoUltraHonkBackend(artifact.bytecode, api, {
      bbVersion: BB_VERSION,
      presto: prestoConfig(endpoint),
      fallback: 'none',
      verificationKey: { bytes: W_VK_BYTES, verifierTarget: TARGET },
      onPhase: (p) => on.phase?.(p),
    });
  }

  /** What proves the next witness. */
  get active(): ProverKind {
    return this.stuck ? 'wasm' : 'presto';
  }

  /** Who made the last proof returned — a busy Presto's witness was proved in WASM even while `active` is native. */
  get lastProver(): ProverKind {
    return this.last;
  }

  async prove(inputs: WorkInputs): Promise<WorkResult> {
    const { witness, returnValue } = await this.noir.execute({
      domain: inputs.domain.toString(),
      seed: inputs.seed.toString(),
      epoch: inputs.epoch.toString(),
      miner_commit: inputs.minerCommit.toString(),
      nonce: inputs.nonce.toString(),
    });
    const out = Fr.fromString(String(returnValue));
    // The execute above can be one synchronous run: a revoke posted during it is still a queued
    // message when it returns. The queue gets its turn, then the witness leaves only if none landed.
    await queuedMessages();
    if (this.stuck) return { proof: await this.local(witness), out };
    const proof = await this.native(inputs, witness, out);
    return { proof: proof ?? (await this.local(witness)), out };
  }

  /** Presto's proof of `witness`, or null when this one is WASM's (the reason recorded). */
  private async native(inputs: WorkInputs, witness: Uint8Array, out: Fr): Promise<Uint8Array | null> {
    let proof: Uint8Array;
    try {
      proof = (await this.backend.generateProof(witness, { verifierTarget: TARGET })).proof;
    } catch (e) {
      if (!(e instanceof PrestoUnavailableError)) throw e;
      if (e.reason === 'transient' && ++this.transients < TRANSIENT_LIMIT)
        this.report('wasm', { sticky: false });
      else this.stick(e.reason);
      return null;
    }
    // The SDK checks whole fields, not W's count nor canonicity: a foreign answer never reaches the digest.
    if (!wellFormed(proof)) {
      this.stick('malformed-response');
      return null;
    }
    if (!this.verifiedProof) {
      if (!(await this.check(inputs, { proof, out }))) {
        this.stick('invalid-proof');
        return null;
      }
      this.verifiedProof = proof;
      if (!this.stuck) this.on.verified?.();
    }
    this.transients = 0;
    this.last = 'presto';
    // Revoked while the proof was out: it is used, but nothing native is announced.
    if (!this.stuck) this.report('presto', { sticky: false });
    return proof;
  }

  /**
   * A native winning proof checked against the job's own public inputs. The very object `prove()`
   * verified as this build's first is trusted as is: that holds only because the bytes are never
   * mutated and the mining loop hands it back with the inputs and output it was proved for. False
   * means the accelerator lied or broke: the caller flips to WASM and re-proves the nonce.
   */
  verifyWin(inputs: WorkInputs, result: WorkResult): Promise<boolean> {
    return result.proof === this.verifiedProof ? Promise.resolve(true) : this.check(inputs, result);
  }

  /** The WASM verifier over W's public inputs in order (`out` came from the local execute), never anything Presto said. */
  private async check(inputs: WorkInputs, result: WorkResult): Promise<boolean> {
    const publicInputs = [
      inputs.domain,
      inputs.seed,
      inputs.epoch,
      inputs.minerCommit,
      inputs.nonce,
      result.out,
    ].map(field);
    try {
      return await this.backend.verifyProof(
        { proof: result.proof, publicInputs },
        { verifierTarget: TARGET },
      );
    } catch {
      // The verifier throws on malformed input; from an accelerator that is a failed verification, not a crash.
      return false;
    }
  }

  /** WASM for good, with the reason the page shows; a rebuild is the only way back to native. */
  forceLocal(reason: FallbackCause): void {
    this.stick(reason);
  }

  destroy(): Promise<void> {
    return this.backend.destroy();
  }

  private stick(reason: FallbackCause) {
    if (this.stuck) return;
    this.stuck = reason;
    this.backend.setForceLocal(true);
    this.reported = 'wasm';
    this.on.prover('wasm', { sticky: true, reason });
  }

  private report(kind: ProverKind, t: ProverTransition) {
    if (this.reported === kind) return;
    this.reported = kind;
    this.on.prover(kind, t);
  }

  /** One witness through the backend's own WASM path; native is tried again next time unless stuck. */
  private async local(witness: Uint8Array): Promise<Uint8Array> {
    this.backend.setForceLocal(true);
    try {
      const { proof } = await this.backend.generateProof(witness, { verifierTarget: TARGET });
      this.last = 'wasm';
      return proof;
    } finally {
      if (!this.stuck) this.backend.setForceLocal(false);
    }
  }
}
