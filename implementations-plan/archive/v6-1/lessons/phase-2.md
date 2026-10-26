# Phase 2: npm 6.0.0, the SDK fallout, the regenerated artifacts

- **G1.** The young set on 2026-10-25 (cutoff seven days back) was the same 45 names as at planning. The 44 not
  already excluded went into `minimumReleaseAgeExcludes`; `bun install` (1.4.2) wrote a lock holding each at one
  version (`6.0.0`; `presto-noir` `2.0.0`), no `@aztec/` entry and one `viem@2.57.1`. With the exemption removed,
  `bunx bun@1.4.0 install --frozen-lockfile` passed in the tree and in a fresh copy (package files, `bun.lock` and
  `bunfig.toml` only, `--ignore-scripts`): a frozen install does not re-apply the age gate (I1 holds on CI's Bun).
- **Breaking changes the tree hit, beyond the scopes:** `createAztecNodeClient(url, options)` replaced the
  positional `(url, versions, fetch)` (the transport contract is unchanged, and 5.2.0 already batched), and
  `AztecAsyncMap` gained `getManyAsync` (the kv-store's own map suite covers the memory store's).
- **The address separator.** The frozen V2 recipe on the 6.0.0 SDK reproduces all three of `derive.test.ts`'s
  5.2.0 golden addresses and the planning spike's vector. The 6.0.0 account class is `0x222287bf…659b`.
- **I2** holds at the source: aztec.js 6.0.0's `waitForTx` texts are 5.2.0's, and a mined receipt still carries no
  revert reason (`node_tx_receipt.js` builds it without `error`). CRS files, ranges, hosts and cache keys are
  unchanged in bb.js 6.0.0; bb 6.0.0 still exits 1 for a refused proof and for a missing file alike.
- **Measurements.** Miner class `0x05f5edc215509252395ebf2d1cdded27f0815fc7c7d1486783ddadf072b2269d` (the planning
  spike's). Gates (`aztec profile gates`): `claim` 31,390 (5.2.0: 34,155), `claim_from_l1` 33,740 (34,823),
  `exit_to_l1` 18,712 (19,500), `send_ahead` 18,711 (19,499): `claim` drops to `log n` 15.
- **Expected failures beyond the plan's two.** `replay-binding.bun.test.ts` refuses the committed recording
  (bound to the 5.2.0 artifacts and SDK) until P4 re-records it: that is its guard working. Recorded in plan §8.
- Gate: lint, typecheck, `test:components` (347) exit 0; `bun test` 674 pass / 5 fail, the five being the two
  example-claim assertions and the two replay-binding tests (plus one boundaries rule fixed and re-run: 13 pass);
  `contracts:test` 83 + 7 (8081 free); `check:proofs` all four pass (10 native proves → 1 proof; 410 single-field
  flips, 50 multi-field, 8 point substitutions, wrong inputs and VK, the ZK proof: none verify; WASM byte-identical);
  generators re-run clean; `git grep '@aztec/'` leaves `docs/roadmap.md` only (P5).
