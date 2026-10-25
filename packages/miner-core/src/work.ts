import { type Barretenberg, UltraHonkBackend } from '@aztec-foundation/bb.js';
import { Noir } from '@aztec-foundation/noir-noir_js';
import { Fr } from '@aztec-labs/foundation/curves/bn254';

/** The compiled work circuit as nargo emits it (bytecode + ABI); loaded by the caller. */
export interface WorkArtifact {
  bytecode: string;
  abi: unknown;
}

export interface WorkInputs {
  domain: Fr;
  seed: Fr;
  epoch: bigint;
  minerCommit: Fr;
  nonce: bigint;
}

export interface WorkResult {
  /** 410 × 32 bytes, big-endian fields; the ticket is hashed over exactly this. */
  proof: Uint8Array;
  /** W's public output, supplied to `claim` as `out`. */
  out: Fr;
}

export interface WorkProver {
  prove(inputs: WorkInputs): Promise<WorkResult>;
  destroy(): Promise<void>;
}

export class BbJsWorkProver implements WorkProver {
  private readonly noir: Noir;
  private readonly backend: UltraHonkBackend;

  constructor(
    artifact: WorkArtifact,
    private readonly api: Barretenberg,
  ) {
    // Noir's artifact type is stricter than the JSON we load; the shape is the compiled circuit.
    this.noir = new Noir(artifact as ConstructorParameters<typeof Noir>[0]);
    this.backend = new UltraHonkBackend(artifact.bytecode, api);
  }

  async prove(inputs: WorkInputs): Promise<WorkResult> {
    const { witness, returnValue } = await this.noir.execute({
      domain: inputs.domain.toString(),
      seed: inputs.seed.toString(),
      epoch: inputs.epoch.toString(),
      miner_commit: inputs.minerCommit.toString(),
      nonce: inputs.nonce.toString(),
    });
    const { proof } = await this.backend.generateProof(witness, { verifierTarget: 'noir-recursive-no-zk' });
    return { proof, out: Fr.fromString(String(returnValue)) };
  }

  destroy(): Promise<void> {
    return this.api.destroy();
  }
}
