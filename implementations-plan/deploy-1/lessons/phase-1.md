# Phase 1 (a1): the creation at the node's quote

- Step 1: `forgeScript` on `Bun.spawn`, both pipes drained with the exit. `bun run portal:build && bun
  tools/deploy/scripts/l1-deploy.ts --anvil` passed (portal and YACA on chain 31337).
- Step 2, red as planned (`YACANA_REQUIRE_TOOLCHAIN=1 bun test tools/deploy/scripts/l1-deploy.test.ts`, before
  `--skip-simulation`): the receipt and the portal address passed (the creation landed), then
  `expect(quotes.length).toBeGreaterThan(0)` failed with `Received: 0`: forge never asked the node. 0 pass, 1
  fail, 701 ms; no timeout.
- Step 3, green after the flag: 1 pass, 5 expect() calls, 1.37 s. `--anvil` still passes.
- Step 4: `portal.yml` (the step with `YACANA_REQUIRE_TOOLCHAIN: '1'`, the filter `packages/bridge/**`,
  `packages/miner-core/**`, `tools/deploy/**`, `!tools/deploy/**/*.md`) and the `docs/deployments.md` clause.
- Gate, 2026-10-26: `bun run lint` 0 (after `biome format` on the test and a `deployBlock` guard for the
  optional field), `bun run typecheck` 0, `bun run lint:actions` 0, `bun run test:components` 0, the test with
  `YACANA_REQUIRE_TOOLCHAIN=1` green, `--anvil` green, the run without the toolchain 0 pass / 3 skip / 0 fail (Bun
  counts the skipped describe's two hooks), the dry run 28,088,860 at Sepolia block 11,995,260.
- **Root `bun test` red, in the new suite only**: `startAnvil`'s `jsonRpcReady` got "blocked endpoint
  http://127.0.0.1:<port>/: not this page, its node, its Ethereum RPC, its accelerator or a candidate" for 60 s.
  web-kit's `node-guard.ts` installs itself over `globalThis.fetch` at import, once per realm, and never
  uninstalls; the web-kit, stats-view and web-miner suites that import it run before `tools/` in the one-realm root
  run. No earlier root-run suite fetched localhost unguarded (the rest skip without env), so the leak was latent.
  The first root run also failed two `scripts/layout.test.ts` checks because the test file was not yet tracked
  (the guard reads `git ls-files`); they pass once it is committed.
- Dead ends: `bun test --isolate` breaks the repo's suite (84 errors, 9 fails, 353 of 747 tests ran, 57 s);
  `bunfig.toml` `[test] isolate = true` is ignored by Bun 1.4.2 (probe in scratch: the leak still crossed files).
- Consult, Codex gpt-6.1-sol high (`01a17642…`): options A (the suite swaps in `Bun.fetch` and restores), B (the
  body in a child process), C (the guard suites get setup and teardown). Verdict **C, outside this lane**: A is a
  compensating monkey-patch (a suite restores only state it changed); B adds a driver and an output contract for
  the leak alone. Agreed: the deploy suite keeps the platform's fetch, the leak is filed, and a1's root gate is
  reported blocked rather than bypassed.
