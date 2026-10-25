# STATUS: v6-1

- 2026-10-25 planning started; worktree adopted and registered.
- 2026-10-25 recon: three Sonnet explorers + a scratch spike (W and the contracts under 6.0.0; VK unchanged, proofs incompatible across versions).
- 2026-10-25 decision: regroup a1/keyed/a2 into one PR (plan §6, D1), pending the panel and the orchestrator.
- 2026-10-25 plan drafted with a competing outline; OWNER-ASKS OA1 written.
- 2026-10-25 ORCHY-STEER: the lane also holds issue #77 (Workers Builds fails on main since a rebuild 2026-10-25 15:19 UTC); a phase or small arc before the records, Closes #77.
- 2026-10-25 ORCHY-STEER: #77 moved to lane site-1 (lands first); dropped from this plan; issues none again; the record commits keep a working Workers Build as a precondition. Evidence gathered for it before the move (failing runs end 3 s after queueing; successful ones took ~100 s; no build ran 2026-09-30 → 2026-10-25) goes in the final report.
- 2026-10-25 panel: codex round 1 reject (8 of 9 accepted; delivery rejected), opus conditional approve (outline A; findings folded); OWNER-ASKS OA1 is now the default node's operator; codex round 2 running.
- 2026-10-25 panel: codex round 2 conditional approve (now outline A); final fresh codex pass conditional approve (3 findings folded); plan at the approval gate.
- 2026-10-25 P1 gate pass: toolchain + work-circuit tests 23/23, codegen idempotent (proof + layout version only), contracts:compile, lint:shell, lint.
- 2026-10-25 P2 gate pass: lint, typecheck, components 347, bun test (expected: 2 example-claim + 2 replay-binding until P4), contracts:test 90, check:proofs 4/4, generators clean.
- 2026-10-25 P3 gate pass: portal:build, portal:test 77/77 (LEAF_GAS holds: worst leaf 288,947), abi clean, l1-deploy --anvil; I5 shortfall on geth semantics (41,731 gas), margin 45,000 taken.
