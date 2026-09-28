# yacana-one-surface — recon

Read-only recon on `main` at `9b190fa`: three sonnet Explore agents (a Stats-inside-the-miner mapper, a miner reuse
sweep, a landing and Stats sweep) plus the driver's own checks of the contract, the claim path and the icons.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Node reads for Stats (epochs, genesis, supply) | `packages/miner-core/src/reader.ts` | reuse-as-is |
| L1 portal and registry reads | `packages/bridge/src/portal-reader.ts` ("shared by the miner's bridge, the operator script and the stats page") | reuse-as-is |
| Ethereum RPC client | `packages/web-kit/src/browser/eth-rpc.ts` (both apps already use it) | reuse-as-is |
| Slot table and layouts | `packages/web-kit/src/browser/slots.ts` fetches `/layouts.json` and `/slots/<n>.json` from the origin root; the miner's prebuild already runs `copySlots` | reuse-as-is |
| Fetch guard | `packages/web-kit/src/browser/node-guard.ts` | adapt: one owner for the node and Ethereum slots (below) |
| CSP / COOP / COEP | `packages/web-kit/src/headers.ts`, one root `_headers` (`apps/site/src/assemble.ts:157-160`, `artifact.ts:52-59`) | reuse-as-is: `/stats` is already cross-origin isolated (`apps/site/e2e/site.e2e.ts:63,73,75`) |
| Header and tabs | `packages/ui/src/components/header.tsx` (`HeaderTab`: `label, icon, href, current, external, testId, count, onSelect`) | adapt: both hosts build the same three tabs |
| Theme | `packages/ui/src/theme-provider.tsx` (`yacana.theme`) | reuse-as-is; no second provider when hosted |
| Stats charts | `apps/web-stats/src/charts/{plot.tsx,specs.ts,index.tsx}` (`@observablehq/plot`, which pulls the whole `d3` umbrella) | move to a package |
| Stats pages and features | `apps/web-stats/src/routes/{Stats,Bridge,Verify}.tsx`, `features/*` | adapt → package: `routes/Stats.tsx:13` and `features/VerifyTile.tsx:6` import the app's router directly |
| Stats read protocol | `apps/web-stats/src/{beats,window,history-fill,history-cache,map-geometry}.ts` | reuse-as-is (relocate): pure, injected I/O |
| Stats boot | `apps/web-stats/src/main.tsx:169-201` (reader, beats, a 30 s poll with the history fill, the bridge poller) | build new: a runtime a host starts and stops; the setters leave it |
| Stats router | `apps/web-stats/src/routes.ts` | discard for the hosted case; the miner's router grows the stats routes |
| Route rewrites | `apps/site/src/assemble.ts:71-77` (`MINER_LINKS: Record<Exclude<MinerRoute,'mine'>, true>`) | reuse-as-is if the miner's `Route` gains path-shaped members (`'stats/bridge'` expands to `/mine/stats/bridge /mine/ 200`) |
| Code splitting | dynamic `import()` exists (`features/PrestoBanner.tsx:18`, `bridge/flows.ts:99`); no `React.lazy` route and no `manualChunks` (searched `React.lazy`, `lazy(` in `apps/*/src` and `packages/web-kit/src`; `manualChunks` repo-wide) | build new: the first `React.lazy` route |
| Nullifier lookup ("did my claim land?") | `apps/web-miner/src/bridge/session.ts:856-865` (`findLeavesIndexes('latest', NULLIFIER_TREE, [nullifier])`), `ticketNullifier()` (`packages/miner-core/src/proof.ts:51-53`, siloed) | reuse-as-is |
| Sent-claim reconciliation | `controller.ts` `retryOnce` (787-815), `adopt` (823-845), `fate` (851-863) | reuse-as-is; auto-recovery schedules it |
| Retry gating | `retryEligible` (`tests/retry-eligible.bun.test.ts`) | reuse-as-is |
| Backoff | `packages/web-kit/src/browser/node-health.ts` `grow`/`clamp` (322-323), `waitTurn` (326-343) | adapt: the shape, not the transport semantics |
| Failure injection in e2e | `apps/web-miner/e2e/fixtures.ts:70-84` (`isSendTx` route, today a delay) | adapt: a one-shot error |
| Dismissible notice | none persist a dismissal — `PrestoBanner`, `OldTabNotice`, web-stats `Announcement`, `MigrationCard` are all state-driven; searched `dismiss` and every `'yacana.*'` literal | build new: `yacana.intro`, on the `settings.ts:49-70` parse/load/save convention |
| Landing section frame | `apps/web-landing/src/sections/Section.tsx`; the How pattern `sections/Chain.tsx:82-103` | reuse-as-is; How's numbered `<ol>` is the phone layout of the loop |
| Drawn SVG on theme tokens | `apps/web-landing/src/features/RuleDiagrams.tsx` (`Frame`, `T`, `FILL`/`STROKE` token classes, arrowheads as paths) | adapt: its conventions; the circle geometry is new (searched `cos(`, `sin(`, `Math.PI`, `marker-end`, `<marker` in `web-landing/src`, `ui/src`) |
| Icons | `packages/ui/src/components/icons.tsx` (six hand-drawn glyphs, stroke 1.6); `lucide-react` already a `packages/ui` dependency | adapt: the same `Icon` API over Lucide |

## Facts

### Stats inside the miner
- web-stats boots a second app: node-guard import, `createStore`, `loadConnection`, `openReader` → `setNodeEndpoint(url, 10_000)`
  (`main.tsx:1,31,32,169-191`; `reader.ts:138`), a `setInterval` of 30 s running the poll and the history fill
  (`main.tsx:180-183`, `chain.ts:17`), `startBridge` → `setEthRpcEndpoint(url, 10_000)` and a second 30 s poll
  (`bridge.ts:19,99-137`), its own `ThemeProvider` and store `Provider` (`main.tsx:205-213`).
- The guard's node and Ethereum endpoints are single slots, last write wins (`node-guard.ts:67-89`). The miner sets
  120 s for the node (`boot.ts:94,133`) and 30 s for Ethereum (`session.ts:109`); Stats sets 10 s for both. Hosted
  unchanged, Stats would shorten every miner request's deadline, `sendTx` included.
- Both routers dispatch `'yacana:navigate'` (`web-stats/src/routes.ts:19`, `web-miner/src/routes.ts:16`).
- The miner's `Route` is one segment: `'mine' | 'wallet' | 'settings'` (`routes.ts:3,8-12`); `App.tsx:176-178` renders
  by condition.
- `document.title`: web-stats sets it per route (`App.tsx:103-105`, asserted `stats.e2e.ts:17`); the miner's
  "Report in the tab title and icon" setting owns it on `/mine`.
- The history fill yields only to Stats' own queue (`main.tsx:93-138`, `history-fill.ts:70-77`), blind to the
  miner's claim reads.
- Miner timers already running: epoch 10 s (`controller.ts:43,314`), L1 sampler 15 s (`l1-sampler.ts:11,71`), public
  epoch 30 s (`public-epoch.ts:17,93`), bridge 15 s (`bridge/session.ts:124,640`), a 1 s clock (`main.tsx:92`).
- localStorage: `yacana.theme` and `yacana.connection` are already shared; `yacana.epochs.*` (Stats' history cache,
  512 KB / 8,192 rows, validated, `history-cache.ts:10-27`) collides with nothing.
- `@observablehq/plot` is 1.8 MB unpacked on disk plus 27 `d3-*` packages (5.0 MB); the tree-shaken size is
  unmeasured. Each app builds separately (`assemble.ts:111-117`), so Stats ships twice (`/mine` and `/stats`).
- A new workspace package must satisfy `scripts/layout.test.ts` (workspace globs, a root-referenced `tsconfig`, the
  root `test:components` list, `"vitest run"`) and `scripts/boundaries.test.ts` (exported subpaths, declared
  dependencies, layer direction, no cycles, no relative escape).
- Apps never depend on apps except `apps/site` for route types (`assemble.ts:15-16`); both apps export only
  `./routes` and `./e2e/*`.
- No miner multi-tab lock exists (only Presto consent's Web Lock, `presto-consent.ts:26,177`).
- The landing's bar is not the shared `Header` (`web-landing/src/sections/Bar.tsx`).

### Claims
- A claim lands only while its epoch is open: the private function asserts `open_epoch == e` at its anchor
  (`protocol/contracts/yacana_miner/src/main.nr:188`) and `record_claim` asserts it again with `count <= N` (`:231-233`).
- The claim's nullifier is `Poseidon2([DOM_NULL, digest])` (`:221`): a second send of the same win cannot mint twice,
  and the siloed nullifier (`ticketNullifier`) tells whether it landed.
- Each claim transaction expires at its anchor's timestamp + `CLAIM_TTL_SECONDS` (`:201`); a resend re-anchors.
- "Block hash … not found … a reorg" is the node's (`@aztec/aztec-node` world-state queries): the PXE's anchor block
  was pruned while the claim was being proved; nothing was sent.
- "no effects for 0x…" is ours (`apps/web-miner/src/chain.ts:127`): `waitForTx` saw the claim in a proposed block,
  and the receipt read right after had no effects — the block was pruned between the two reads.
- `submit()` retains the ticket only for `'other'` (`controller.ts:731`); the reducer halts mining on `'other'`
  (`reducer.ts:391-429`); the copy is `claim failed: <reason> · mining paused` (`claim-copy.ts:41-42`).
- Manual Retry already reconciles a known hash (`fate` → `adopt` checks the nullifier in the effects) and resends only
  when `retryEligible` (secret current, epoch open).
- The `'mine'` command clears every secret and the retained ticket (`controller.ts:552-557`): Start forfeits a win.
- `findLeavesIndexes` returns `DataInBlock<bigint> | undefined` (with the block) on Aztec 5.2.0.
- `openWallet` passes no `syncChainTip` (`wallet.ts:122-169`); the PXE option exists.
- The classifier's kinds: `reverted | refused | expired | delivery-blocked | other` (`claim-failure.ts`).

### Miner fixes
- `found` always implies consent (`presto.ts:184-186`). `native` (= `remembered | proving`, `use-presto.ts:38`) has two
  readers: `RailTile.tsx:44` and `Settings.tsx:107,111`. The ✦ suffix and the `[` `]` hotkeys read
  `prestoAtom.active === 'presto'` (`use-page-behaviour.ts:50`), so a slider hidden at `found` would leave the hotkeys
  moving the threads.
- `PIP_SIZE = {360, 190}` (`pip.ts:9`); the footer is one `whitespace-nowrap` row (`LoopTile.tsx:74`); Pop out shows
  only with `settings.pip` (`LoopTile.tsx:296`); the setting is labelled "Mini window" (`Settings.tsx:319`).
- The signed-in Start calls `session.startMining()` synchronously in the click (`LoopTile.tsx:182`, `App.tsx:139`);
  the signed-out Start mines only after the passkey ceremony (`session.ts:462-466`), outside the click's activation.
  `openPip` already calls `requestWindow` synchronously in a click (`LoopTile.tsx:122`, `pip.ts:33-38`).
- The recovery line's "advanced ·" is `ActivityList.tsx:138`; no test reads the word.
- Icons: consumers `header.tsx:118,198`, `account/{Create,Welcome,LogIn}.tsx`; no Bridge icon exists (web-stats'
  Bridge tab has none, `App.tsx:41`). The board's glyphs are Lucide's `Pickaxe`, `Wallet`, `ChartColumn`,
  `ShieldCheck`, `ArrowLeftRight`, `Settings`, `FingerprintPattern` at stroke 1.5.
- Intro strip mount: `Mine.tsx` counts the rows above the cockpit (`above`, :79) into `ROWS[above]` (:44-46).
- Download size: static copy only in `web-landing/src/copy.ts:45` and `PreflightTile.tsx:10`; the live "X of Y MB"
  progress (`opening-steps.ts:60`) is a measurement.

### Words
- Miner: `score`, `the bar`, `target length`, `clear it` live in `RailTile.tsx:90-95,141,144,148`,
  `LoopTile.tsx:84,203-207,268-273,300,318,325`, `LedgerTile.tsx:53`, `score-loop.tsx:165,208,249,706,782` (its default
  caption is what the pop-out shows), `proof-line.tsx:59`.
- "bar" also means progress bars and stacked bars (`opening-steps.ts`, `StackedBar`, the Stepper): no blind replace.
- web-stats already says "difficulty"; its reader-facing "claims" are `Table.tsx:14,59`, `Detail.tsx:81-84`,
  `Observatory.tsx:63`, `charts/specs.ts:471-472`. The CSV and JSON `claims` keys are a data contract
  (`miner-core/src/csv.ts:5`, `reader.ts` `rowsToJson`).
- Landing: `copy.ts:43,45,57-58,64,94,110,117-121,187-212`, `HeroLive.tsx:23,100`, `BarChart.tsx:25,51`.
  `faq-copy.ts:56` looks a question up by its exact text (`linked('How is it mined?')`): the question text is load-bearing.

## Tests the work will move

- Words: `cockpit.vitest.tsx:119,124-131`, `loop-tile.vitest.tsx:52-53,72,82-83`, `ui/score-loop.vitest.tsx:108,112,114,159`,
  `ui/tooltip.vitest.tsx:10-37`, `signature.vitest.tsx:56`, landing `sections.vitest.tsx:81`. No e2e, replay spec or
  recording asserts the miner's prose.
- Claims: `tests/recovery.bun.test.ts:229-252`, `tests/claim-lines.bun.test.ts:99-115`, `src/lib/reducer.test.ts:154-195,263-267,278-311`.
- Presto: `presto-indicator.vitest.tsx:108,113,130`, `settings.vitest.tsx:87,146`, `presto-standing.bun.test.ts:101-108`,
  `e2e/presto.e2e.ts:49,104`, `e2e/replay/lna.replay.ts:170,190`.
- Pop-out: `e2e/miner.e2e.ts:267-294` (toggles "Mini window", then clicks Pop out).
- Icons: `header.vitest.tsx:33,67-73`, `shell.vitest.tsx:47`.
- Landing: `e2e/landing.e2e.ts:86` (section ids) and `:216-221` (anchor labels) are hard-coded; the rule-diagram
  counts (`sections.vitest.tsx:246`, `landing.e2e.ts:187`) mean the loop takes its own test id;
  `apps/web-miner/tests/external-link-arrows.bun.test.ts` scans the landing too.
- Nav: `web-stats/e2e/stats.e2e.ts:304-308`, `web-miner/e2e/miner.e2e.ts:169`, `origin.e2e.ts:36`, `landing.e2e.ts:209-225`.
- Stats screenshots: `apps/web-stats/e2e/visual.e2e.ts`, eight baselines (`/` and `/bridge` × 1280, 1440, 1024, 390) at
  zero tolerance, regenerated only in `mcr.microsoft.com/playwright:v1.62.1-noble` with
  `bun run test:visual -- --update-snapshots`. Docker and that image are present on this machine.

## Inferences (unverified)

- The Stats chunk (Plot + d3 after tree-shaking + the views) is small next to the miner's bb.js and circuit chunks;
  measure it with the module report before and after.
- Chart re-renders run on the main thread beside the prover Worker; no measurement either way.
- The node's rejection of a duplicate nullifier keeps a resend of a landed claim from costing the sponsor anything.
