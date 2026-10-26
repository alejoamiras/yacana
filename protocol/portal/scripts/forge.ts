// `forge` from the pinned Aztec toolchain (never whatever PATH provides), run in this package with
// forge-std resolved from the same toolchain: `@aztec-foundation/l1-artifacts` ships it under l1-contracts/lib,
// and toolchain.lock.json pins that tree's digest, so the tests add no dependency edge of their own.
//   bun scripts/forge.ts build | test [forge args…]
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { toolchainBin } from '@yacana/localnet/toolchain';

const forge = toolchainBin('aztec-forge');
const forgeStd = join(
  dirname(dirname(forge)),
  'node_modules/@aztec-foundation/l1-artifacts/l1-contracts/lib/forge-std/src',
);
if (!existsSync(join(forgeStd, 'Test.sol')))
  throw new Error(`forge-std not found in the toolchain at ${forgeStd}`);

const child = Bun.spawn([forge, ...process.argv.slice(2)], {
  cwd: resolve(import.meta.dir, '..'),
  env: { ...process.env, FOUNDRY_REMAPPINGS: `forge-std/=${forgeStd}/` },
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(await child.exited);
