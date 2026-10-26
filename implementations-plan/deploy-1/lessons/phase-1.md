# Phase 1 (a1): the creation at the node's quote

- Step 1: `forgeScript` on `Bun.spawn`, both pipes drained with the exit. `bun run portal:build && bun
  tools/deploy/scripts/l1-deploy.ts --anvil` passed (portal and YACA on chain 31337).
- Step 2, red as planned (`YACANA_REQUIRE_TOOLCHAIN=1 bun test tools/deploy/scripts/l1-deploy.test.ts`, before
  `--skip-simulation`): the receipt and the portal address passed (the creation landed), then
  `expect(quotes.length).toBeGreaterThan(0)` failed with `Received: 0`: forge never asked the node. 0 pass, 1
  fail, 701 ms; no timeout.
- Step 3, green after the flag: 1 pass, 5 expect() calls, 1.37 s. `--anvil` still passes.
