# Phase 1 — the check, its generated offsets and its tests

## Baseline (untouched tree)

- `bun run codegen && bun run contracts:compile && bun run artifacts:commit` on the untouched tree reproduced
  every committed file byte for byte (`git status` clean apart from the plan), so `target/` held the unfixed miner
  when the baseline canaries deployed it. (`target/` had held an earlier spike build; `artifacts:commit` also needs
  `codegen` first, which compiles the work circuit.)
- Canary baseline, two runs on the untouched tree (`E2E_SHARD=canary`, all four specs passed, exit 0). The
  canary's one metered proof is the transaction proof of the claim that mints (`proof-inventory.ts:60-62`):
  **10,548 ms** and **10,764 ms** (`durationMs`, from `.localnet/canary-base-{1,2}.report.json`).

## Steps

- Test 11 first, against bb's real stderr: the fixture with slots 32–33 (LOOKUP_INVERSES.x, the point at
  infinity's 0) set to `(Q_LO, Q_HI)` makes native `bb verify` exit 1 with
  `Assertion failed: (value < fq::modulus)` … `Reason : Non-canonical field element: value >= fq::modulus`.
  Before the classification `verify` threw `OperationalError` (the test failed); after it, `{ verified: false,
  wellFormed: false }`.
- `layout-manifest.ts` writes `proof_points.nr` (36 starts, labelled). `proof-layout.json`'s pinned sha256 is
  unchanged.
- Test 10 on the fixture: 31 starts hold on-curve points, 5 hold `(0, 0, 0, 0)`, and none is on the curve with its
  limbs swapped (matches Fact 3), so (b) is not vacuous.
- I7 holds: `aztec-nargo check` accepts `pub(crate) global FIXTURE_PROOF` and the new modules with no new warning.
- Test 8's `proof[0]`: 5013, the first k ≥ 5000 whose ticket (zeros, `proof[32..34] = (Q_LO, Q_HI)`) is below
  2^122, ground once with miner-core's `computeDigest` (the vector tests pin it equal to `ticket_digest`).
- `aztec test` with the fix: all nine new tests green (3–7 and 9 as expected failures), 83 `yacana_miner` tests and
  7 `yacana_bridge_hashes` tests passed; TXE's 8081 was free (probe empty) before each run.
- Mutation run (the call replaced by a comment in `claim`, then `aztec test a_claim_with_a_point_written_as_q_is_refused`):
  `FAIL … error: Test passed when it should have failed`, so without the check the aliased claim mints in TXE and
  nothing else refuses it. `main.nr` restored from a copy and recompiled; the call is back (one occurrence).

## Measurements

| function | gates before | gates after | VK `log n` before → after |
|---|---|---|---|
| `claim` | 31,985 | **34,155** (+2,170) | 15 → **16** |
| `claim_from_l1` | 34,823 | 34,823 | 16 |
| `exit_to_l1` | 19,500 | 19,500 | 16 |
| `send_ahead` | 19,499 | 19,499 | 16 |

`bb gates --scheme chonk` per private function of the compiled artifact; `log n` from the first field of `claim`'s
VK. I1 predicted ≈ 2.2k: measured 2,170 for 72 coordinates, ≈ 30 gates each.

## Gate

The Phase 1 gate, verbatim from plan.md §5, run as one bash script (the worktree guard refuses a heredoc here, so
the same text ran from a scratch file): exit 0, `PHASE 1 GATE PASSED`. 8081 free; codegen clean; `aztec test` 83 +
7 passed with the nine new names present; layouts clean; 23 work-circuit and toolchain tests passed under
`YACANA_REQUIRE_TOOLCHAIN=1` (tests 10 and 11 cannot skip); lint clean.
