# fees-1 · phase 1 (a1: the flag and its proof)

- 2026-10-27 the new `devFundFees` line pushed `loadSiteConfig` to cognitive complexity 16 (budget 15). The four
  test-only switches moved into `testSwitches(mode, env)` in `config.ts`; no suppression.
- 2026-10-27 gate: lint 0, typecheck 0, bun test (web-kit + the bundle test) 79 pass. Each miner build took about
  3 s here. Forcing the gate's condition to `true` made the production case receive `apps/web-miner/src/fees/Slot.tsx`.
