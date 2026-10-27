# deploy-2 phase 1: the continuation needs two sources

- `readOpenEpoch` already exists in `packages/miner-core/src/epoch.ts` (the PXE-simulated read the miner and the
  soak use), and `index.ts` re-exports both modules: `tsc -b` refused the duplicate. The reader's helper is
  `readOpenEpochWithSeed`.
- Red check (step 3): with the comparison short-circuited (`announced !== 'node-only' && false`), the three
  `refuses a FIRST_EPOCH | SEED | TARGET the node does not confirm` cases failed ("Expected promise that rejects /
  Received promise that resolved"); the agreeing case and `announcedFromEnv`'s two passed (3 pass, 3 fail).
  Restored from the kept copy.
- The JSON-RPC stub answers `aztec_getPublicStorageAt` by `params[2]` (the slot), normalised through
  `Fr.fromString(...).toString()`; the SDK client sends single and batched calls, both handled.
- Gate: `bun run lint` (after `lint:fix` sorted one import and reflowed `deploy.ts`), `bun run typecheck`,
  `bun test tools/deploy packages/miner-core` → 76 pass, 9 skip (the live suites), 0 fail.
