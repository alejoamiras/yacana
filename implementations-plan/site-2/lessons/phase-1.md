# site-2 phase 1 (arc a1)

- The new unit test passed alone and failed in the full `bun test`. Cause: `packages/stats-view/tests/runtime.bun.test.ts`
  restored the env with `process.env = env`, a fresh object, while `import.meta.env` stays on the original. Every
  later suite's `process.env` write then missed the modules that read `import.meta.env`. Demonstrated by running the
  pair in order: 14 pass / 1 fail before the fix, 15 / 0 after. Fixed at the cause: the suite restores in place.
- Red runs, each with one rule reverted:
  - the read rule (`isRetiredDefault` in `fromStorage`): the new test fails;
  - the write rule (the `delete next.nodeUrl`): the new test fails;
  - OA1's compare in `NodeTile.tsx`: the new row spec fails, and the other 5 pass.
- Gate (2026-10-26): `bun run lint` 0, `bun run typecheck` 0, `bun test` 0 (704 pass, 44 skip, 0 fail),
  `bun run test:components` 0 (ui 90, web-landing 15, stats-view 83, web-stats 2, web-miner 158),
  `bun run --cwd apps/web-miner test:replay` 0 (9 passed, 1.3 min).
- Fix loop round 1: Codex `01a178e5` (2 findings), Opus beside it (3 findings). The runbook append was missing
  (plan §4 named it). A pre-existing non-string-storage crash went to known limit #85.
