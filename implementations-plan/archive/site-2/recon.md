# site-2 recon

Base: `origin/main` at `d58a2d2` (2026-10-26). One Sonnet reuse sweep plus the driver's own reads.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Persist the chosen node | `packages/web-kit/src/browser/connection.ts`: key `yacana.connection`, `fromStorage` :79, `loadConnection` :92, `saveConnection` :98, `restoreDefaultNode` :43, `defaultNodeUrl` :37 (live read) | adapt: one predicate on read and write |
| "Use the default", every path | `restoreDefaultNode` (Cannot start card, node banner: `apps/web-miner/src/App.tsx:101`, `routes/Stats.tsx:43`, `apps/web-stats/src/App.tsx:114`, `apps/web-landing/src/App.tsx:80`, `sections/HeroLive.tsx:66`); Settings `NodeTile.tsx:247-250` → `save` → `saveConnection` :232; `session.ts:825` (dead or no preflight) | reuse: all three end in `saveConnection` |
| Unit test of the setting | none for `connection.ts` (searched `packages/web-kit/src/**/*.test.ts`); bun:test is web-kit's runner; `node.test.ts` shows the global-stub pattern | build new: `connection.test.ts` |
| Component coverage | `apps/web-miner/src/components/node-tile.vitest.tsx:99` clicks `node-default`, asserts only `switchNode` | adapt: one storage assertion |
| The old origin's Worker | `apps/site/v5/wrangler.jsonc` (`yacana-v5`, `v5.yacana.network`, `../dist-old`, `workers_dev: false`, `preview_urls: true`) | adapt: move to `apps/site/previous/` |
| The origin in the build | `deployments/site.env:18-21` → `packages/web-kit/src/config.ts` (`url('VITE_OLD_APP_ORIGIN')`, `previewSuffixOf`, `assertProductionEthereum`) → `viteDefine` | reuse: values change, no code |
| Host classification | `packages/web-kit/src/browser/host.ts` (`versionedHost`, `hostKind`) | reuse; comment only |
| Old-tab notice | `apps/web-miner/src/features/OldTabNotice.tsx:16,62-64`: `VITE_OLD_APP_ORIGIN`, rendered at `App.tsx:211` when `/build.json` names another miner or rollup | reuse |
| Site E2E | `apps/site/e2e/run-setup.ts:104` (`v5.localhost`), `site.e2e.ts:111` | adapt: `previous.localhost` |

## Facts the plan rests on

- The only default node the site has carried before V6 is `https://v5.testnet.rpc.aztec-labs.com` (`git log --all -S'VITE_AZTEC_NODE_URL='`: `f2bf7a6`, `98f4c59`, `5108131`; `ddb4c09` moved it to `https://aztec-testnet.drpc.org`).
- `NodeTile` saves `parseNodeUrl(…).href`, so its "Use the default" stores `https://aztec-testnet.drpc.org/`, with a slash that `site.env` lacks. On V5 it stored `https://v5.testnet.rpc.aztec-labs.com/`. `restoreDefaultNode` stores the raw `site.env` value.
- The three apps share the module and the key: same origin, `connection.ts:2`.
- Bun has no `localStorage` (`typeof localStorage` → `undefined`); under bun `import.meta.env` is `process.env`.
- No workflow, `scripts/layout.test.ts`, `scripts/boundaries.test.ts`, `biome.json`, tsconfig or package script names `apps/site/v5`. `apps/site/package.json` deploys the apex only. Workers Builds deploys the `yacana` Worker (`docs/deployments.md:106`). The old origin is deployed by hand (`docs/upgrades.md` step 8).
- `v5.yacana.network` / `yacana-v5` outside `implementations-plan/`:
  - config: `apps/site/v5/wrangler.jsonc`, `deployments/site.env:19-21`;
  - comments: `apps/site/src/assemble.ts:3-4,22`, `packages/web-kit/src/browser/host.ts:3`;
  - tests: `packages/web-kit/src/config.test.ts:171,194,203,213`, `apps/web-miner/src/shell.vitest.tsx:154-166`, `gallery.vitest.tsx:434`;
  - current docs: `CLAUDE.md:18,73`, `docs/upgrades.md:83-86,114,130`, `docs/deployments.md:192-206`, `docs/roadmap.md:28`;
  - archived sections of `docs/deployments.md`: :242 (2026-09-28), :315 (2026-09-05).
  - No `deployments/*.json` names either host.
- The rig names its own simulated retiring version `v5.yacana.test` (`tools/harness/tests/origin.bun.test.ts:88,109`, `playwright.rig.config.ts:20`). The site E2E names `v5.localhost`.
- Cloudflare docs (Custom Domains, 2026-09-29): removing a Custom Domain does **not** delete its certificate ("must manually remove the certificate … SSL/TLS > Edge Certificates"). They are silent on whether its DNS record goes, and on what `wrangler delete` removes beyond "the Worker and all associated … resources". [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [wrangler delete](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## Collisions and risks

- `connection.ts`'s `defaults` is captured at import, but `vi.stubEnv` changes the env later. The new predicate must read `defaultNodeUrl()` live, or the component spec sees the wrong default.
- `apps/web-miner/e2e/proof-inventory.ts:108` keys on the `origin.e2e.ts` title ("versioned origin"). Retitle nothing.
- `site.e2e.ts:111` (`fromNode`) and `run-setup.ts:104` must rename together.
- `apps/site` holds the apex's `wrangler.jsonc` (`yacana`). A `wrangler delete` run from there that ignored `--name` would target the apex.
- No open issue overlaps (`gh issue list`: only #81). Closed known limits: #82 only, unrelated.
