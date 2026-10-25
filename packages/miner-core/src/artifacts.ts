// Compiled artifacts are build outputs (contracts:compile, work-circuit compile), not committed;
// Node-side consumers resolve them from the sibling packages, the web miner bundles the same files.
import { resolve } from 'node:path';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import type { ContractArtifact } from '@aztec-labs/stdlib/abi';
import type { WorkArtifact } from './work.ts';

const repo = resolve(import.meta.dir, '../../..');
export const MINER_ARTIFACT_PATH = resolve(repo, 'protocol/contracts/target/yacana_miner-YacanaMiner.json');
export const WORK_ARTIFACT_PATH = resolve(repo, 'protocol/work-circuit/target/yacana_work.json');

export const loadMinerArtifact = async (): Promise<ContractArtifact> =>
  loadContractArtifact(await Bun.file(MINER_ARTIFACT_PATH).json());

export const loadWorkArtifact = (): Promise<WorkArtifact> => Bun.file(WORK_ARTIFACT_PATH).json();
