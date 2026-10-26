# site-2 phase 2 (arc a2)

- Baseline `site:e2e` first stopped on a missing `protocol/contracts/target/yacana_miner-YacanaMiner.json`: the
  target folder is gitignored, so a fresh worktree needs `bun run contracts:compile` (53 s) first. Then 3 passed,
  2.8 min suite, 207 s with the network.
- `loadSiteConfig` reached cognitive complexity 16 once the old origin became optional. Lifting `parsedUrl` to the
  module (the `?? ''` inside it) brought it back under 15, with no suppression.
- `assemble.test.ts` expected the old role's pairing error. The new guard stops the build earlier, so the test now
  expects the guard's message.
- The first `site:e2e` after the change: 1 passed, 2 failed. The apex `wrangler dev` died with an empty `✘ [ERROR]`
  right after serving `/mine/assets/index-*.js`, which also refused test 3 (ECONNREFUSED). The browser saw three
  500s before that. Host load average was 112–127. No reader of the old origin can fail on an empty one:
  `versionedHost` catches, `OldTabNotice` reads `|| undefined`, the headers never read it, and the web-miner E2E
  already builds without one. One rerun: 3 passed, 1.6 min suite, 128 s with the network, the new assertions
  included.
- Gate (2026-10-26): `bun run lint` 0, `bun run typecheck` 0, `bun test` 0 (704 pass, 44 skip, 0 fail),
  `bun run test:components` 0 (ui 90, web-landing 15, stats-view 83, web-stats 2, web-miner 159),
  `bun run --cwd apps/web-miner test:replay` 0 (9 passed, 1.3 min). `bun run site:build` 0 (production, with the
  artifact checks); `YACANA_APP_ROLE=old bun run site:build` 1 with "an old-role build needs VITE_OLD_APP_ORIGIN, the
  origin it is served from". The grep prints only the archived sections of `docs/deployments.md`,
  `docs/roadmap.md:28` and the retirement note in `docs/upgrades.md`.
