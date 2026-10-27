# fees-1 · phase 4 (a1: the browser scenario)

- 2026-10-27 the scenario measured 47.6 s and 47.5 s (I2 estimated 65 s): the boots under the replay are about 2 s
  each, below the estimate's allowance. The lane went from 1.2 min (9 tests) to 2.0 min (10).
- 2026-10-27 the baseline load waits for `networkidle` after the cockpit shows, so the boot's own same-origin
  fetches (CRS, artifact, slot table) land in the known set before any option runs.
- 2026-10-27 the production first paint is unchanged against trunk (9 chunks; trunk's five production files built
  in place and restored): the module sets differ by `apps/web-miner/src/fees-gate.ts` alone. The flagged e2e build
  shows 12 first-paint chunks with no `src/fees/` module; `Slot` is a lazy 23.9 kB chunk.
- 2026-10-27 forcing `fetch('/fees-probe')` into the mock's quote failed option a with that URL as the stray; reverted.
