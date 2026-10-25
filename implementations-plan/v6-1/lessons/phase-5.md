# Phase 5: docs, the review loop, CI

- Docs: `CLAUDE.md`, `README.md`, `docs/threat-model.md`, `docs/roadmap.md` and four comments name 6.0.0, Noir
  1.0.0-rc.3 and Presto 1.2.1; `git grep` for `5.2.0` leaves only the frozen previous recipe, history and the V5
  records.
- Full local gates before review: lint, `lint:shell`, `lint:actions`, typecheck (48 s), `test:components`,
  `contracts:test`, `portal:test` exit 0; `bun test` 678 pass, 44 skip, 2 fail (the two example-claim assertions).
- Review round 1: Codex found nothing; the Opus leg found three lows and nits (plan §8), all fixed. The one with
  behaviour: a raw-calldata gas estimate loses the revert's ABI, so a refusal surfaces as viem's generic
  `EstimateGasExecutionError`. Estimate through `estimateContractGas` wherever the error's name is read.
