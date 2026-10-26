# Phase 0: recon, the spike, the panel

## The spike (2026-10-25; copies in the lane's scratch folder, nothing in the tree changed)

- **W under 6.0.0.** The crates were copied and `verify_w`'s `bb_proof_verification` set to `v6.0.0`. Then
  `aztec-nargo compile --workspace` (rc.3, 1.8 s), then `aztec-nargo execute --package yacana_work` (output
  `0x2403e6fa…1a96`, equal to the fixture's public output).
  - `bb gates`: 4,105 opcodes and 151,728 rows under both versions.
  - `bb write_vk -t noir-recursive-no-zk`: 3,680 bytes; `cmp` with `fixtures/yacana_work/vk` and `vk_hash` gives
    no difference, and field 0 (`log n`) is 18 in both.
  - `bb prove`: 13,120 bytes in 2 s on 32 threads. Two runs are byte-equal, and `bb verify` passes.
  - Cross-version: the committed 5.2.0 proof fails 6.0.0's `bb verify`, and the 6.0.0 proof fails 5.2.0's. 352 of
    410 fields differ, the first at index 36.
  - bb.js 6.0.0 (`BackendType.Wasm`, 8 threads, 4.6 s): the WASM proof equals the native one and verifies.
- **The contracts under 6.0.0.** The sources were copied, keeping the `protocol/` layout for the path dependency
  on `work-circuit/crates/lib`. Only the Nargo homes changed (`aztec-labs-eng/aztec-nr` `v6.0.0` dir `aztec`;
  `bb_proof_verification` and aztec-standards `v6.0.0`). `aztec compile --workspace`: exit 0 in 59 s, with the new
  warning "Tests should be in a dedicated test crate". The miner class id, by `getContractClassFromArtifact`
  (6.0.0), is `0x05f5edc215509252395ebf2d1cdded27f0815fc7c7d1486783ddadf072b2269d`.
- **A write outside the lane.** `aztec compile` derives Chonk VKs through bb, which caches them under
  `~/.bb/<version>/vk_cache` whatever the project. The run added four `.vk` files and their four locks there. They
  were removed (only the files created by this run), and no other shared cache changed (`~/.bb-crs`, `~/nargo`,
  `~/.aztec`). Implementation runs will write that cache as any `aztec compile` does; it is the toolchain's own.
- A recon explorer wrote `bb --help` output to a file under `/tmp` against its brief. The file held help text only
  and was removed.

## The age gate (G1)

**Method.** Walk the 6.0.0 roots' dependency closure from the npm registry: exact pins resolve to themselves, and
ranges resolve to the newest non-prerelease version older than the cutoff (what `minimumReleaseAge` does). List
every resolved version younger than seven days. The roots are every package the tree depends on, in its 6.0.0
name: the 12 `@aztec-labs/` packages, `@aztec-foundation/{bb.js,noir-noir_js,l1-artifacts,aztec-standards}`,
`@alejoamiras/{presto@6.0.0,presto-noir@2.0.0,presto-core@1.2.1,presto-banners@1.0.0}` and `viem@2.57.1`. `bun
install` stays the arbiter: a name the walk missed fails the install by name.

**Result on 2026-10-25** (cutoff 2026-10-18T15:00Z): 45 young packages, all published 2026-10-22, the last at
17:05:41Z. Names (bun ignores scope globs, so each is listed):
`@alejoamiras/presto` `@alejoamiras/presto-noir` (already excluded by name)
`@aztec-foundation/aztec-standards` `@aztec-foundation/bb-avm-sim` `@aztec-foundation/bb-avm-sim-darwin-arm64`
`@aztec-foundation/bb-avm-sim-darwin-x64` `@aztec-foundation/bb-avm-sim-linux-arm64`
`@aztec-foundation/bb-avm-sim-linux-x64` `@aztec-foundation/bb.js` `@aztec-foundation/cdb`
`@aztec-foundation/ipc-runtime` `@aztec-foundation/l1-artifacts` `@aztec-foundation/noir-acvm_js`
`@aztec-foundation/noir-noir_codegen` `@aztec-foundation/noir-noir_js` `@aztec-foundation/noir-noirc_abi`
`@aztec-foundation/noir-types` `@aztec-foundation/wsdb` `@aztec-foundation/wsdb-darwin-arm64`
`@aztec-foundation/wsdb-darwin-x64` `@aztec-foundation/wsdb-linux-arm64` `@aztec-foundation/wsdb-linux-x64`
`@aztec-labs/accounts` `@aztec-labs/aztec.js` `@aztec-labs/bb-prover` `@aztec-labs/blob-lib` `@aztec-labs/constants`
`@aztec-labs/entrypoints` `@aztec-labs/ethereum` `@aztec-labs/foundation` `@aztec-labs/key-store` `@aztec-labs/kv-store`
`@aztec-labs/native` `@aztec-labs/noir-contracts.js` `@aztec-labs/noir-protocol-circuits-types`
`@aztec-labs/protocol-contracts` `@aztec-labs/pxe` `@aztec-labs/simulator` `@aztec-labs/sqlite3mc-wasm`
`@aztec-labs/standard-contracts` `@aztec-labs/stdlib` `@aztec-labs/telemetry-client` `@aztec-labs/wallet-sdk`
`@aztec-labs/wallets` `@aztec-labs/world-state`.
`viem@2.57.1` was published 2026-09-29 and needs nothing. From 2026-10-29T17:06Z the list is empty.

## `@aztec/` imports per workspace (2026-10-25)

apps/web-miner 112, tools/deploy 89, packages/bridge 52, packages/miner-core 39, tools/harness 25, tools/localnet
25, packages/stats-view 8, packages/web-kit 7, apps/web-stats 5, apps/web-landing 4, apps/site 1,
protocol/work-circuit 1. `protocol/portal`'s 40 are Solidity imports through its own `@aztec/=src/aztec/` remapping.

## Consults

- **Codex round 1** (2026-10-25, gpt-6.1-sol, high, read-only; session kept for resumes). Verdict *reject*: P1's
  gate impossible (the 5.2.0 fixture fails `export-vk` under 6.0.0), OA1's population wrong (records get a
  fingerprint only on reopen, never at creation), and delivery contradicting the brief. Nine findings; eight
  accepted, the delivery one rejected with reasons (plan §8). The script's own temp dir sits under `/tmp`
  (`/tmp/codex-*`); later calls set `TMPDIR` to the lane's scratch, and the resume reuses the first run's dir.
- **Opus 5.5 Plan audit** (2026-10-25, background agent, 95 tool calls, 16 min). Verdict *conditional approve*,
  Outline A. It found what Codex missed: `example-claim.test.ts` and `derive.test.ts` both move with the address
  separator, string paths typecheck cannot see, D4 conflicting with G1, and F9's target being a later version. One
  finding rejected: F8 holds (the Presto app README's environment table, not the top-level README, is specific).
- **Probes behind the fold** (public, keyless): Aztec Labs runs no V6 host (`v6.testnet.rpc.aztec-labs.com` does
  not resolve; the v5 host still reports 5.0.0 / 1821665230). `v5.yacana.network/build.json` names miner
  `0x058c…f38f`, the apex `0x0364…014c` (the current record). The 6.0.0 Inbox opens a bucket per L1 block
  timestamp (`Inbox.sol:257-289`), which is what I5 measures.
- **Codex round 2** (2026-10-25, resumed session, high). Verdict *conditional approve*. It moved to Outline A on
  the Workers Builds fact (the check runs on every branch and blocks every lane's merge). It confirmed D3's frozen
  recipe by tracing 6.0.0's `computeAddress`. New: the example-claim test fails at two lines, not one; a padded
  deposit needs the same padding in the "no ETH" check; I3's limit belongs in the close-out. All accepted.
- **Final fresh Codex pass** (2026-10-25, new session, high). Verdict *conditional approve*: `e2e.yml`'s rig job
  already runs `browser` and `origin` (accepted in part; its fix of editing the workflow rejected), K1's `cast`
  named no RPC (accepted), and recon still described two superseded calls (accepted). The machine's sandbox
  opt-in ran it as `approve-for-me`; the tree was unchanged afterwards (`git status`).
