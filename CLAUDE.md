# yacana

Privately mineable token on Aztec whose mining work is Barretenberg proving: a miner proves a fixed Noir circuit per
nonce, the ticket is Poseidon2 over the whole UltraHonk proof, a ticket below the target wins, and the winner claims
through a private Aztec transaction that verifies the proof in-circuit and mints privately. Bitcoin-style difficulty:
epochs close after `N` accepted claims and the target rescales by actual/expected time, clamped to [¼, 4].

**Plan**: `implementations-plan/elixir-core/plan.md` (§2 mechanism, §4 security, §6 phases with gates, §9
post-implementation). Hand-off: `implementations-plan/elixir-core/context.md`. Lessons: `implementations-plan/elixir-core/lessons/`.
Phase 1 measurements: `implementations-plan/elixir-core/spike-results.md`.

## Workspaces (Bun)

Four folders, one layer each, and production code imports its own layer or below: `apps/` (what ships, layer 3), `packages/` (shared TypeScript, 2), `protocol/` (Noir, Aztec and Solidity, 1) and `tools/` (operators, the rig, run isolation, 0 — anything may be imported from a tool, and no production file imports one). A workspace is reached by its `@yacana/<name>` and an exported subpath, never by a path — except the config-time edges `scripts/boundaries.test.ts` lists (a Vite config loading `web-kit`'s base by path, since Vite bundles configs under the ambient Node), and `tools/` may import anything. `scripts/boundaries.test.ts` and `scripts/layout.test.ts` hold the rules.

| Workspace | Owns |
|---|---|
| `apps/site` | The three apps as one origin: `src/assemble.ts` (`dist/{,mine,stats}`, the shared assets once at the root, `_headers`, `_redirects`, `build.json`; production guards), `src/artifact.ts` (the checks on an emitted production build), `wrangler.jsonc` (the Worker: custom domain, assets directory, SPA fallback), `www/` (the www → apex redirect Worker), `v5/wrangler.jsonc` (the versioned origin's Worker `yacana-v5`, fed by `YACANA_APP_ROLE=old bun run site:build` → `dist-old`), the record's `bridge` and `migration` blocks into the apps, the witness archives served at `/witnesses/<rollupVersion>.jsonl`, the assembled-site E2E under `wrangler dev` |
| `apps/web-miner` | React + Vite miner on `packages/ui`: embedded wallet (IndexedDB), sponsored FPC, W proved by bb.js in a Worker — or through Presto, the visitor's native prover (`presto-consent.ts`: the consent record `yacana.presto` under a Web Lock, the revoke the page acts on at once; `presto.ts`: the endpoint per mode, the local-network permission, Presto's standing, the fix-it copy — nothing reaches 127.0.0.1 before the card's Look or a remembered yes under a granted permission; `features/use-presto.ts`: the one reading the rail and Settings share; `worker-backend.ts`: the Worker's endpoint, its revoke; `presto-prover.ts`: the prover that falls back to WASM inside itself verifies its first native proof in the Worker and a native win against the job's own inputs; `tx-prover.ts`: the wallet's private-kernel prover on Presto's SDK, WASM when it steps aside, its phases naming who proves on the dialog and the claim line; `features/PrestoBanner.tsx`: Presto's billboard when absent, the miner's row when in the way; the ✦ suffix, `native` and the dimmed slider follow what actually proved), pinned CRS (`web-kit`'s `crs.lock.json`, served from `/crs`), Vitest specs, Playwright E2E on the isolated network (a headless Presto beside it when installed); ships at `/mine/` of the assembled site (`wrangler.jsonc` for local `wrangler dev` parity only); the bridge (`src/bridge/`: the session that rereads every crossing from both chains, the IndexedDB journal, the flows, wagmi for the injected Ethereum wallet; `bridge/rows.ts` the one reading of the journal — every crossing's row, the count waiting for the user, why a money button is off; `features/ActivityList`; `features/dialogs/` the one 440 px transaction dialog every money flow shares: `Send`, `ToEthereum`, `FromEthereum`, `Claim` (the claim on Ethereum, the forward, the redeem), `SendAhead`, `Wins` (this device's wins, opened from the ledger's footer on Mine); `OldApp` the old origin's one page, on the same dialogs; `OldTabNotice`), `bridge.e2e.ts` / `origin.e2e.ts` driven by the rig |
| `apps/web-stats` | Observatory, Bridge and Verify (`/stats`, `/stats/bridge`, `/stats/verify`) as `@yacana/stats-view`'s shell: `main.tsx` (the guard's node slot and, with a bridge record, its Ethereum slot; the store, the clients, the runtime with the history fill), `App.tsx` (the header, `Freshness`, the node banner, the footer, the title), `routes.ts` (`apps/site` imports its `Route`); the App's Vitest spec, the screenshot gate (`test:visual`, pinned Playwright image; the bridge page on a recorded portal), Playwright E2E (a mocked node on the captured fixture + the live isolated deployment) |
| `apps/web-landing` | The landing (`/`): seven sections from the copy deck (`src/copy.ts`), the live strip through the reader, `VITE_LAUNCH_MODE` hero, the OG card (`public/og.html` → `og.png` via `bun run og-card`), the standalone `/faq` (`routes/Faq.tsx`, `copy.faq`) and the announcement line; Vitest specs, Playwright E2E on the isolated network |
| `packages/miner-core` | Platform-agnostic TS: proof → fields → ticket digest, domain separators, retarget mirror, claim builder, key derivation, `reader.ts` (node-only storage reads through the slot table), `metrics.ts`, `csv.ts`; `scripts/gen-slots.ts`; `fixtures/` (captured epoch histories) |
| `packages/bridge` | The crossing protocol every side shares: `content.ts` (message contents, three-way vectors with Noir and Solidity), `secrets.ts` (secrets and redeem keys from the master), `signatures.ts` (EIP-712 forward / redeem), `witness.ts` (Outbox witnesses, the archive lines), `exits.ts` (the miner's exit logs), `journal.ts` (a crossing's states and facts), `queue.ts`, `recovery.ts` (the recovery file), `portal-reader.ts` (viem reads for the page and the stats), `policy.ts` (the immutable policy from the params), `record.ts`, `deadline.ts`, `flip.ts` |
| `packages/ui` | Design system shared by the surfaces: `theme.css` (tokens, dark default + `.light`, self-hosted Hanken Grotesk / JetBrains Mono), shadcn-style primitives, StatusPill, Kpi, Mark + `faviconDataUrl`, ScoreLoop, ProofLedger, Stepper, Preflight, EpochRail, PowerSlider, PrestoCard (the way to say yes to Presto, and its standing after), Tip (a dotted word explained on hover or focus; its own provider) and Popover on radix, Marks, ThemeProvider, the bridge's drawn vocabulary (HeroCard, Trail, ActivityRow, AmountBlock, Note, Timeline, StackedBar; `bridge-types.ts`); Vitest specs (`*.vitest.tsx`) |
| `packages/web-kit` | What the apps share below the components: `src/config.ts` (one env source of truth: `deployments/site.env` + `deployments/<profile>.json` → Vite `define`, the production guards), `src/headers.ts` (CSP/COOP/COEP per environment), `src/vite-base.ts` (`siteVite`, the module report, `bbVersion`), `src/browser/{connection,node,node-guard,node-health,format,slots,host,explorer,eth-rpc,navigation}.ts` (the page-side connection config, the node as a setting: URL rules, the probe, the switchable client; the fetch guard every context installs first — same origin, the node in use and a candidate under check pass, everything else throws; formatting; the slot-table and layout fetches; the preview host rule; the explorer links; the L1 reads; the in-app navigation event both routers and the URL-held views listen for), `src/browser/vite-env.d.ts` (the apps' ambient types, `/// <reference types="@yacana/web-kit/vite-env" />`), `src/pinned-crs.ts` + `crs.lock.json` (the pinned CRS every prover fetches from `/crs`), `scripts/{fetch-crs,copy-artifacts,copy-slots}.ts` (every app's prebuild), `src/shims/` (`detect-node` for the browser build) |
| `packages/stats-view` | The stats pages and what reads them, over a host's store, clients and router: `runtime.ts` (`createStatsRuntime`: one instance's boot, poll, history fill, bridge poller and clock; `start`/`stop`/`dispose`; `yieldTo` holds every read it starts; it never points the guard — the host sets the endpoints and hands it the clients), `pages.tsx` (`StatsPages`: the announcement, the error card, the page; `host.ts` the host's paths, navigation and FAQ), `state.ts`, `url-state.ts` (`?epoch=`, `?from=`); the page reads in two beats (`beats.ts`: the fixed slots, then a 48-epoch window; every tile has a skeleton), the strip's window (`window.ts`) over a map of every epoch (`map-geometry.ts`, `features/EpochMap.tsx`), the map filled one page per poll (`history-fill.ts`) and carried between visits by a validated, capped `localStorage` cache (`history-cache.ts`), four Observable Plot charts, the table with CSV/JSON, the calculator, the deployment record; the bridge page (`bridge-beat.ts`, `bridge.ts`, `features/Bridge.tsx`, `features/CoinsChart.tsx`: six figures, the version's phases, where the coins are, a card per registered version, the portal's state, the keys and rules), the announcement line, Verify's Ethereum tile; Vitest specs, the runtime's bun spec |
| `protocol/work-circuit` | Noir work circuit `W` (`crates/lib` + `crates/yacana_work`), the VK-embedding verifier `crates/verify_w`, generated VK / proof-layout manifest, fixture proofs, `scripts/` (`prove.ts`, the `check:*` evidence scripts on `bb-verify.ts`'s three-way verdict, `export-vk.ts`, `layout-manifest.ts`, the pinned `toolchain.ts`) |
| `protocol/contracts` | Aztec contracts (Nargo workspace): `yacana_miner` and `yacana_bridge_hashes`; aztec-standards token as a git dep (`v5.2.0`) |
| `protocol/portal` | `YACA.sol` (ERC-20, the portal its only minter) and `YacanaPortal.sol` (the turnstile: per-version cap, pause, deadline; forward, redeem, deposit, retire), `YacanaHashes.sol`, Foundry tests under `test/`, the generated ABI under `abi/` (`bun protocol/portal/scripts/abi.ts`, CI diffs it); `bun run portal:build` / `portal:test` through the pinned `aztec-forge` |
| `tools/deploy` | `src/deploy.ts` (a profile's miner + token → `deployments/<profile>.json`; `YACANA_PORTAL` the portal it trusts, `YACANA_CONTINUE_FROM` a continuation), `scripts/l1-deploy.ts` (YACA + the portal through Foundry, the record's `bridge` block; `--anvil` for CI), `scripts/bridge.ts` + `src/bridge/` (the operator script: `status`, `register`, `note-transitions`, `pause`/`pause-all`/`unpause`, `close-deposits`, `set-forwarder`, `retire`, `forward` with the witness archive, `note-stop`/`retire-node` the record's lifecycle notes through `lifecycle.ts`; `run.ts` deploys the bridge for one local run), `launch.ts`, `soak.ts`, `epoch-stats.ts` |
| `tools/harness` | The upgrade rig's cases (`tests/*.bun.test.ts`: `flip` H0, `bridge` H1/H6/H9/H10, `deposit` H2, `migration` H3/H4/H6/H11, `never-settled` H5, `skip-version` H7, `browser` and `origin` through the page) on `tools/localnet/src/upgrade-rig.ts`; `src/` the rig's user, sponsored fees, the bridge and miner deploys; `bun run rig -- <case>…\|all` |
| `tools/localnet` | Run isolation: `src/registry.ts` (the port registry at `~/.agents/ports.md`), `src/isolated-node.ts` (one local network per run, its data under `.localnet/`), `bin/agent.sh` (`bun run e2e:agent`: a command against a fresh network), `src/toolchain.ts` (the pinned binaries from `.aztecrc` and `toolchain.lock.json`); `presto.ts` (a headless Presto for one run: registry port, per-run `PRESTO_HOME`, the lock-pinned native `bb`, `AZTEC_BB_VERSION`, SIGTERM first) and `install-presto-server.sh` (the pinned release by committed digest); `upgrade-rig.ts` (the isolated network upgrading itself: a second rollup, the governance vote through the node's clock, a pinned node on the new version, anvil's cheat codes for the clock) and `rig.ts` (`bun run rig -- <case>…\|all`) |

## Toolchain

- **Aztec 5.2.0 only** (`.aztecrc`): `aztec-nargo` (Noir 1.0.0-beta.25), `aztec compile` (transpiles public bytecode
  and writes Chonk VKs — plain `aztec-nargo compile` is not enough for contracts), `aztec-txe`, `bb` from
  `~/.aztec/versions/5.2.0`. Never bare `nargo`. `bb --version` prints `5.2.0-nightly.20260807` for this release.
- **Bun ≥ 1.4** for everything (PM, runtime, `bun:test`). Biome lints and formats. Vitest only for React components.
- Supply chain: `bunfig.toml` enforces a 7-day npm min-age; the linker is **hoisted** (Vite's pre-bundler cannot
  resolve the aztec packages' transitive imports under the isolated layout); CI installs with a frozen lockfile;
  GitHub Actions are pinned by commit SHA.

## Commands

```
bun run lint           # biome + sort-package-json --check
bun run lint:fix
bun run lint:shell     # shellcheck on tools/localnet/bin/*.sh and hooks
bun run lint:actions   # actionlint
bun run typecheck      # tsc -b --force over the solution: every workspace's project and the root scripts (one workspace: bun run --cwd <ws> typecheck)
bun test               # all bun:test suites (packages + scripts)
bun run contracts:compile / contracts:test
bun run e2e:agent -- <cmd>   # run <cmd> against a fresh isolated local network (AZTEC_NODE_URL set)
bun run e2e:agent -- bun test tools/deploy                             # the live suite: miner-core and the reader against a deployment
bun run e2e:agent -- bun run --cwd apps/web-miner test:e2e           # web miner in headless Chromium (a Vite build in e2e mode; E2E_SERVER=dev for the dev server); with presto-server installed the run gets a headless Presto and presto.e2e.ts runs; every run ends with a breakdown (rig, per spec, browser proving from the prover's console events) in e2e/.breakdown.json
E2E_SHARD=cockpit bun run e2e:agent -- bun run --cwd apps/web-miner test:e2e   # one shard of e2e/shards.json (CI runs them as a matrix); the shard must execute exactly its files' inventory (e2e/proof-inventory.ts)
E2E_PROVERLESS=1 E2E_SHARD=cockpit …                                     # the shard on a build whose PXE skips transaction proving (CI does this for every shard but `canary`); the meter then fails any test that proves
E2E_SHARD=canary bun run e2e:agent -- bun run --cwd apps/web-miner test:e2e    # the real-proving canary: a claim with a bound public input altered is refused at proving, the untampered one mints
E2E_DELAY_SENDTX_MS=20000 …                                              # hold every aztec_sendTx: the breakdown's submission column must rise while proving stays put
bun run --cwd apps/web-miner test:replay                             # the signed-out tests against e2e/replay/recording.json, no node (the PR lane); re-record after the miner artifact, the layouts or the SDK move: bun run e2e:agent -- bun apps/web-miner/e2e/replay/setup.ts record
bash tools/localnet/bin/install-presto-server.sh   # the pinned headless Presto (1.1.1, digest committed) into ~/.local/bin; PRESTO_URL=http://127.0.0.1:<port> bun test apps/web-miner/tests/presto-live.bun.test.ts against one you started
bun run test:components        # every package's Vitest specs (ui, web-miner, web-stats, web-landing)
bun run e2e:agent -- bun run --cwd apps/web-stats test:e2e          # stats page in headless Chromium (production build)
bun run e2e:agent -- bun run --cwd apps/web-landing test:e2e        # landing in headless Chromium (production build): the copy, the live strip, the links
bun run artifacts:commit       # refresh the committed miner + work-circuit artifacts from target/ (CI diffs them)
bun run site:build             # assemble the production site into apps/site/dist (Cloudflare's build command)
bun run e2e:agent -- bun run site:e2e   # the assembled site under wrangler dev: paths, headers, build.json
bun run site:deploy            # assemble the production site and `wrangler deploy` it (needs a Cloudflare login)
bun run site:wrangler -- <args>  # the site's pinned wrangler from the site's folder (what Workers Builds' deploy command calls); `deploy --dry-run` uploads nothing
YACANA_APP_ROLE=old bun run site:build   # the versioned origin's build (apps/site/dist-old, the yacana-v5 Worker of v5/wrangler.jsonc)
bun run portal:build / portal:test       # YACA + the portal through the pinned aztec-forge (Foundry tests)
bun run rig -- flip|all|browser|origin|<case>   # the upgrade rig: the local network flips itself; the migration cases; the holder's side through the page (tmux; each case boots its own network)
YACANA_L1_RPC_URL=… YACANA_L1_PRIVATE_KEY=… YACANA_REGISTRY=… YACANA_OPERATORS=… bun tools/deploy/scripts/l1-deploy.ts deployments/<profile>.json   # YACA + the portal, the record's bridge block
YACANA_L1_PRIVATE_KEY=… [YACANA_RECORD=…] bun run bridge -- status|register|note-transitions|pause|pause-all|unpause|close-deposits|set-forwarder|retire|forward|note-stop|retire-node   # the operator script (docs/upgrades.md); the last two write the record alone
AZTEC_NODE_URL=… YACANA_DEPLOYER_SECRET=… YACANA_PORTAL=0x… [YACANA_LAUNCH_AT=<unix s>] [YACANA_CONTINUE_FROM=deployments/<old>.json] bun run deploy   # deploy the generated profile → deployments/<profile>.json (announce before launch_at; a continuation starts after the source's last epoch)
AZTEC_NODE_URL=… bun run launch -- commit|reveal|open   # launch lottery of the recorded deployment (anyone; see docs/deployments.md)
AZTEC_NODE_URL=… bun run soak -- --hours 2 --epochs 24     # headless soak miner with a hashrate schedule
bun run epoch:stats            # epoch history of deployments/<profile>.json from public storage (--json <file> keeps the rows)
bun packages/miner-core/scripts/gen-slots.ts   # the slot table the stats/landing read path fetches (packages/miner-core/generated/slots, gitignored)
bun run --cwd apps/web-miner dev | build   # both run scripts/prebuild.ts first (pinned CRS, artifacts, slot table)
bun tools/localnet/src/isolated-node.ts --smoke
bun run --cwd protocol/work-circuit check:proofs   # prove → determinism → mutation → WASM: the evidence docs/threat-model.md cites (needs compiled work-circuit); each step alone as prove, check:determinism, check:mutation, check:wasm
bun run --cwd protocol/work-circuit manifest       # the proof-layout manifest (codegen runs it)
```

## Conventions

- Complexity budgets (Biome, error level): cognitive ≤ 15 everywhere; ≤ 80 non-blank lines per production
  function. Never suppress complexity rules in new code.
- Run isolation: never hardcode ports, never kill by name. Ports come from `~/.agents/ports.md` via
  `tools/localnet/src/registry.ts`; services run detached in their own process group; teardown kills only owned groups.
  Data dirs live under `.localnet/` (real disk, gitignored). A sandbox on 8080 belongs to someone else.
- Long local runs (proof checks, e2e) go in `tmux`; they die with the agent shell otherwise.
- Proof validity is only checked by real proving: the ACVM (nargo test, TXE, PXE simulation) accepts any bytes in
  the recursion black box. Tests about proofs must prove.
- Comments say what the code cannot; no references to plans, phases or reviews in code.
- Conventional commits (commitlint), signed. Feature branches only; PRs open only at the Delivery step of plan §9.
- Tests: the smallest set that proves the behaviour and catches the expected failures. External-system code gets one
  real-data integration test under `describe.skipIf(!ENV)`.
- The owner's global `~/.claude/CLAUDE.md` and the `my-stack`, `run-isolation`, `blueprint` skills apply.
