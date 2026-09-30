# Phase 2 — artifacts, docs, real proving

## Steps

- `bun run artifacts:commit` rewrote only the miner artifact (the work circuit's is unchanged); committed. A second
  `artifacts:commit` after lint-staged left the tree clean, so the committed bytes are what the script writes.
- Replay lane re-recorded on the isolated network (`setup.ts record`: 13 answers, exit 0); `test:replay` 9 passed.
- Docs (committed before the Phase 1 gate, which needs a clean tree): `docs/threat-model.md` — the guarantee now
  names the one reduced encoding per point and the unconstrained cells; a new "Re-encoded proof points" row; the
  disabled-row row restated as the unconstrained-witness class with ≈ 54.5 % / ≈ 1.83× stated as an estimate, not a
  bound; line 64 "estimated"; the Presto row "an element ≥ r"; the contracts row's test count (83 miner tests: 52
  TXE, 7 vectors, 7 encoding, the rest unit); the out-of-scope line. `CLAUDE.md`: the contracts and work-circuit rows
  name `proof_points.nr`.

## Real proving (I2)

The canary's one metered proof is the transaction proof of the claim that mints (`proof-inventory.ts:60-62`),
`durationMs` from each run's Playwright report. Every run: the tampered claim refused at proving (`Failed to verify
the generated proof!`), the restored claim minted, all four shard specs passed.

| run | before (unfixed miner) | after (fixed miner) |
|---|---|---|
| 1 | 10,548 ms | 10,710 ms |
| 2 | 10,764 ms | 12,495 ms |
| mean | 10,656 ms | 11,603 ms (**+8.9 %**) |

Below the +15 % line I2 set for surfacing, on the mean. The spread is wide (run 1 +0.5 %, run 2 +16 % against the
baseline mean) with two samples a side on a shared machine. The gate's own canary run is a third after-fix sample:
**10,975 ms** (+3.0 %); over the three, the after-fix mean is 11,393 ms (**+6.9 %**).

## Gate

The Phase 2 gate, verbatim from plan.md §5, run as one bash script from a scratch file: exit 0,
`PHASE 2 GATE PASSED`. Codegen and the artifact clean after a fresh compile and `artifacts:commit`; replay 9
passed; the canary shard 4 passed (the tampered claim refused at proving, the restored claim minted); typecheck
and lint clean; `bun test` 590 pass, 42 skip, 0 fail (632 tests, 122 files); actionlint clean.
