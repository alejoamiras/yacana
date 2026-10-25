// The two storage layouts the read path needs, as a committed fixture, so the reader, the slot
// table and the stats page depend on no compiled artifact. `contracts.yml` regenerates it and fails
// on a diff.
//   bun packages/miner-core/scripts/export-layouts.ts
import { resolve } from 'node:path';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import { loadMinerArtifact } from '../src/artifacts.ts';

export const LAYOUTS_PATH = resolve(import.meta.dir, '../fixtures/storage-layout.json');

const slots = (layout: Record<string, { slot: { toString(): string } }>) =>
  Object.fromEntries(Object.entries(layout).map(([name, v]) => [name, v.slot.toString()]));

export async function exportLayouts(): Promise<string> {
  const miner = (await loadMinerArtifact()).storageLayout;
  const tokenPath = Bun.resolveSync(
    '@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json',
    resolve(import.meta.dir, '../../..'),
  );
  const token = loadContractArtifact(await Bun.file(tokenPath).json()).storageLayout;
  return `${JSON.stringify({ miner: slots(miner), token: slots(token) }, null, 2)}\n`;
}

if (import.meta.main) {
  await Bun.write(LAYOUTS_PATH, await exportLayouts());
  console.log(`wrote ${LAYOUTS_PATH}`);
}
