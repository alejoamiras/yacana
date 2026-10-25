# site-1 recon: Workers Builds red since 2026-10-25 (#77)

Recon read `origin/main` at `513bd01`, the tree Cloudflare last built green. One Sonnet reuse sweep plus the
driver's own reproduction; scratch outputs are outside the repository.

## Reuse map

| Capability needed | Existing code found | Verdict |
|---|---|---|
| The Bun pin Workers Builds installs | `package.json:66` `packageManager: bun@1.4.0` (read by the builder, `docs/deployments.md:106`) | adapt (the one behavioural pin) |
| The Bun pin CI installs | `.github/actions/setup-bun/action.yml:9` `bun-version: 1.4.0`; every workflow goes through it | adapt (move with the first) |
| A check that the two pins agree | none: searched `packageManager\|setup-bun\|bun-version` in `scripts/*.test.ts`, `tools/localnet/src`; `toolchain.lock.json` covers Aztec/bb/nargo/forge/anvil only | adapt `scripts/layout.test.ts` (already parses composite actions with Bun's `YAML` and reads manifests) |
| Prose naming the pinned Bun | `bunfig.toml:16`, `scripts/test-preload.ts:1,3`, `docs/deployments.md:106`; `CLAUDE.md:39` says `≥ 1.4` (a floor, stays true) | adapt (the first three name a version) |
| Runtime reads of the Bun version | none: searched `Bun\.version\|versions\.bun\|BUN_VERSION\|bun-version\|bun@` | n/a |
| Env the site build reads | `CF_PAGES_COMMIT_SHA ?? GITHUB_SHA ?? git rev-parse HEAD` (`packages/web-kit/src/vite-base.ts:39-43`), `CF_PAGES` guard (`apps/site/src/assemble.ts:147`), `YACANA_*`; no `CI`, `WORKERS_CI*`, `NODE_ENV` | reuse-as-is |
| Subprocesses of the build | `bunx vite build` per app (`apps/site/src/assemble.ts:122`), `git rev-parse` (`vite-base.ts:43`) | reuse-as-is |
| Network fetches of the build | the CRS from `packages/web-kit/crs.lock.json` hosts (`packages/web-kit/scripts/fetch-crs.ts:15`), sha256-checked; the npm registry through `bun install` | reuse-as-is |

## Evidence

1. **The tree builds, byte for byte.** A fresh clone of `513bd01` in `ubuntu:24.04` (the image's OS) with Node
   24.21.0 (the image's default) and Bun 1.4.0 (the `packageManager` pin), no caches, runs `bun install
   --frozen-lockfile` (878 packages, 4 s), `bun run site:build` and `bun run site:wrangler versions upload --dry-run`
   green. Bun 1.4.3 (the image's default) is green too. A second run adds the image's documented limits and
   variables: root user, 4 CPUs, 8 GB, `CI`, `WORKERS_CI*`, a shallow fetch, the image's npm 10.9.2 first on `PATH`,
   the builder's automatic install before the build command. It is green. Its `/`, `/mine/`, `/stats/` and
   `/crs/g1_compressed.dat` are byte-identical to what `yacana.network` serves (its `build.json`: commit `513bd01`).
2. **The fetches still answer.** The frozen lockfile installs from the registry with no cache, the CRS hosts serve
   the pinned bytes, and Bun 1.4.0 is downloadable as npm `bun`, `@oven/bun-linux-x64` and the GitHub release zip.
3. **The image changed in the window.** cloudflare-docs records the tooling defaults (Node 24.18.0 → 24.21.0, Bun
   1.2.15 → 1.4.3, changelog dated 2026-10-14, the docs reverted that day and restored 2026-10-24) and, on
   2026-10-23, a new step: "Before the build installs dependencies, it installs the [`packageManager`] version you
   set" (changelog `2026-10-23-workers-builds-pin-npm-version`). yacana's last green build was 2026-09-30, its first
   red 2026-10-25 15:01 UTC.
4. **The failures are early.** Check suites (created at the push, closed at the result): red `91aa11f` 22 s,
   `b5f4f01` 53 s; green yacana builds took 85 s at the fastest (`9b190fa`), 197 s on `496c7d8`. A clean-room
   install plus build alone takes about 35 s on 4 CPUs, so the 22 s build died in setup, clone or install.
5. **Same account, other Workers, green after the change.** Account `0f1688fc…`: `unleashed` (`packageManager:
   bun@1.4.2`) green 2026-10-24 21:03 UTC; `presto` (`.bun-version` 1.4.2) green 2026-10-25 13:30–13:35 UTC. So
   the image, the account's builders and the GitHub app work for Bun projects pinned to 1.4.2.
6. **What carries no signal.** Cloudflare's PR comment reads "❌ Deployment failed" for every failed Workers build
   (25 of 25 sampled across GitHub), so it does not name the step. The check run's text is empty. The build log needs
   the owner's dashboard login.
7. **Open work.** `gh issue list --state all --search "Workers Builds"`: only #77. No closed `known-limit` issue on
   builds. Other lanes: `ci-1` (PR #75, workflows), `v6-1` (later `package.json`, `bun.lock`, toolchain).

## Collision risks

- `v6-1` will move `package.json` and the toolchain: this lane lands first and touches only the Bun pin lines.
- `ci-1` edits workflows; this lane edits only `.github/actions/setup-bun/action.yml:9`.
