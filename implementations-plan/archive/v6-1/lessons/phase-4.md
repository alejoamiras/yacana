# Phase 4: the isolated network, the recordings, the browser suites, the rig

- **The network's L1 deploy picked the wrong forge.** 6.0.0 resolves Foundry binaries as `$FORGE_BIN`, then
  `~/.aztec/current/internal-bin`, `~/.aztec/current/bin/aztec-forge`, `~/.foundry/bin`, `PATH`
  (`@aztec-labs/ethereum` `foundry_binary.js`). `current` on this machine is 6.0.0-rc.3, whose forge refuses 6.0.0's
  `--disable-external-identification`: the smoke failed in 7 s. The rig already named `FORGE_BIN` for its own
  deploys; `isolated-node.ts` now names the pinned one for the `aztec` child too (a caller's `FORGE_BIN` wins). CI
  installs only the pin, so `current` is the pin there and CI never saw this. Smoke then passed in 37 s.
- **bb.js 6.0.0 cannot prove two transactions at once in one process.** The live suite's burst (2N wallets in one
  process) failed with "No circuit loaded. Call ChonkLoad first." and a witness-size assertion. 6.0.0's
  `AztecClientBackend.prove` awaits each stateful step (`chonkStart`, `chonkLoad`, `chonkAccumulate`, `chonkProve`)
  on `Barretenberg.initSingleton`'s one instance, where 5.2.0 queued them synchronously, so two provers' steps now
  interleave. One wallet is safe (its PXE runs one job at a time), and every other site makes one wallet per
  process; the browser has one per page. The burst now takes turns at proving for its own duration (restored
  after), keeping simulation and sending concurrent: 4 accepted, 4 reverted in public and paid, 61 s wall. Adding
  `@aztec-labs/bb-prover` and `@aztec-labs/simulator` to pass a custom prover instead would have changed the lock
  under the age gate (G1: no other change). Worth an upstream report (not filed: outward-facing).
- Step 1: smoke 37 s; `bun run e2e:agent -- bun test tools/deploy` 23 pass, 1 skip, 2 fail (the two example-claim
  assertions, as in P2), 415 s.
- **The read-only apps did not build on 6.0.0.** `@aztec-labs/stdlib` and `@aztec-labs/foundation` now import
  `CircuitKind` from bb.js at module load (four sites), and the non-proving apps resolve bb.js to
  `web-kit`'s `no-prover.ts`, which did not export it: web-stats and web-landing failed `vite build`, so
  `site:build` (Workers Builds' command) was broken from P2 on; no P2 gate built a site. `CircuitKind` is a plain
  enum, so the stub now carries its names and values as data. `site:build` then passed (three apps).
- Step 2: the replay re-recorded (13 answers, 93 s) and the visual fixture (132 answers, 81 s). `test:replay` 9/9
  (74 s), `check-chunks` (first paint 9 chunks, no stats module; Stats 357.6 kB on first opening),
  `replay-binding` 3/3. The eight screenshots differed by 0.01 of their pixels; every diff was data: addresses,
  the rollup version chip, epoch timings, the launch date (Sep 13 → Oct 25, the recording's day), and the bridge
  chart's "since launch" axis stretched to it. Layout and type unchanged at 1280 and 390. Regenerated in the
  pinned image; `test:visual` 8/8 (21 s).
- **The pruned-anchor fault stopped firing.** 6.0.0's PXE pins its anchored reads as the new `{ number, hash }`
  block parameter (`blockHeader.toBlockParameter()`), not a bare hash, so `pruneAnchorOnce`'s string-only matcher
  never matched: the claim minted and the test waited out its 10 minutes. The node's error for a missing hash is
  unchanged for every hash-bearing form (`node_world_state_queries.js` `#throwOnUndefinedBlockData`), so the
  miner's `ANCHOR_PRUNED` classifier still holds; the matcher now reads the hash from either form. 6.0.0's PXE
  also caches hash-pinned reads (`caching_aztec_node.js`), which the fault does not depend on.
- **Two suites in one worktree race on the prebuild.** Running `chain` and `bridge` at once in this checkout, one
  copied `packages/miner-core/generated/slots` while the other regenerated it (ENOENT). Each lane is one checkout's
  run at a time; not a code fault. `chain` alone then passed.
- Step 3, web-miner shards at retry 0: `cockpit` 8/8 (5.3 min), `chain` 14/14 (12.7 min), `bridge` 5/5 (5.8 min),
  all prover-less; `canary` 5/5 real (7.1 min, 50 s proving). Presto 1.2.1 from the committed digest: its log asks
  for Aztec 6.0.0 and proves on `bb="bundled"` (10 proofs in `chain`), and its `PRESTO_HOME` is 16 KB with no
  downloaded `bb` (F8 holds). The breakdown's `prestoProofs` counts transaction proofs, which a prover-less shard
  skips, so the native evidence is Presto's own log and the Presto specs' assertions.
- Then: web-stats 7/7 (155 s), web-landing 5/5 (110 s), `site:e2e` 3/3 (163 s). `bun run rig -- all` 13 pass across
  flip, bridge, browser, deposit, migration, never-settled, origin and skip-version (1,778 s), so I4's anvil
  base-fee stall did not reproduce and no flag went in. The migration and browser cases ran the operator's
  `retire` with its new margin and a deposit through the page.
- **Wall-clocks.** Local runs here against 5.2.0's last green `e2e.yml` (2026-09-21, CI job times with setup):
  cockpit 5.3 min (CI 8.9), chain 12.7 (9.8), bridge 5.8 (7.2), canary 7.1 (13.5), web-stats 2.6 (6.3),
  web-landing 1.8 (5.5), rig 29.6 (28.2). Not like for like: P5's dispatch gives 6.0.0's CI times.
