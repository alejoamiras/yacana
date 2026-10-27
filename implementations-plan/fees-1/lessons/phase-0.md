# fees-1 · phase 0 (planning)

- 2026-10-27 recon: two Sonnet sweeps. One sweep claimed a new replay test must bump the "original nineteen" sum in
  `tests/e2e-inventory.bun.test.ts`. It does not: the sum counts sharded and moved tests only (R8).
- 2026-10-27 I1 tested (Vite 8.2.2, a toy build in the lane's scratch folder): a dynamic import guarded by
  `import.meta.env.VITE_X === '1'` is dropped when the define is `""`, whether the comparison sits inline or in a
  module-level const; the flagged build emits the chunk. I1 becomes F11; the bundle test still judges the real build.
- 2026-10-27 Codex r1 (gpt-6.1-sol, high, read-only; session 01a17f4c-50a4-73c0-8349-923d597578f1): conditional
  approve, ten findings, all accepted in substance (§7). Two corrected the planner's facts: a win's deadline is its
  epoch staying open, not the claim's 600 s TTL; and an `import()` guarded by an imported const leaves an orphan chunk
  (reproduced here on Vite 8.2.2). One corrected the plan's sequencing: a Phase 1 positive control needs the slots
  mounted in Phase 1.
- 2026-10-27 Opus (Plan agent): conditional approve, twelve findings; ten accepted, the optional build-sharing and
  the artifact refusal (kept by Codex, dropped here on Opus's argument) recorded as D6 and a rejection (§7). It also
  caught the line drift in recon's citations, and that the gate as first written loaded the Slot chunk on every
  flagged page.
- 2026-10-27 final fresh Codex pass (session 01a17f5c-ac12-7ca0-ae23-247cf20b793b): r1 conditional approve (four
  conditions), r2 conditional approve (the page fetches the CRS and the miner artifact same-origin at boot, so a
  navigation-wide request log needs a baseline; one leftover "often"), r3 approve.
