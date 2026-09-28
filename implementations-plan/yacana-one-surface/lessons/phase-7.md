# P7 · The package, web-stats as its shell — lessons

## What changed
- `packages/stats-view` (`@yacana/stats-view`, layer 2): web-stats' reads, charts, features and pages moved with
  `git mv`, the pages under `pages/`. Three seams replace what tied them to one app:
  - `runtime.ts`: `main.tsx`'s boot as an instance (`createStatsRuntime`), its serial queue (`createSerial`),
    timers and boot retry its own. Every publish and store write checks `disposed`; every boot step and timer
    installation checks the active flag; `yieldTo` is asked before every read it starts, through one waiter
    that rechecks each second and releases `false` on stop. The constructor resets the atoms it owns, so a
    successor on a shared store starts from nothing. A `StatsSources` seam (the reader, the reads, the bridge)
    is what the spec fakes.
  - `chain.ts`'s `openReader` takes the host's client and `bridge.ts` exposes `bridgeSource(record, client)`:
    neither calls a guard setter any more. The deadlines moved to the shell with the setters.
  - The pages read `useStatsHost()` (`pathFor`, `navigate`, `faqHref`) instead of web-stats' router;
    `url-state.ts` holds `?epoch=` / `?from=`. `StatsPages` takes a `banner` slot beside `wayOut`, so the node
    banner keeps its place between the announcement and the error card (the baselines saw that order).
- `settled` moved from `beats.ts` to `state.ts`: the shell's settled marker imports the state alone.
- web-stats is the shell: `main.tsx` sets the node slot (`DEFAULT_LIMITS.timeoutMs`) and, with a bridge record,
  the Ethereum slot (10 s), then starts the runtime with the fill; `App.tsx` keeps the header, `Freshness`, the
  banner, the footer and the title; `routes.ts` its paths. The App's test and the route test stay here.
- `web-kit/src/browser/navigation.ts`: one navigation event for both routers and the URL-held views.
- Both apps' `index.css` scan `packages/stats-view/src`.
- CI: `web-stats.yml` runs the package's typecheck, Vitest and bun tests. The layout guard named three more
  workflows whose filters must watch the package: `contracts.yml` and `site.yml` build the site, and
  `web-landing.yml` tests `apps/site`, whose closure now reaches it.

## Found on the way
- The runtime spec asserted that the boot reads before the bridge; the runtime never promised an order (the
  boot awaits its cache key first). It now asserts what matters: nothing read during the yield, one boot after.
- "A late bridge read publishes nothing" let the read land before the dispose: the spec holds it now.
- The grid spec rendered the Stats page outside a host (`VerifyTile` asks the host for its path): it wraps it.

## Gate (2026-09-23)
- `bun run lint` 0 · `bun test` 0 (643 pass, 44 skip; the layout and boundaries guards accept the package) ·
  `bun run typecheck` 0 · `bun run test:components` 0 (ui 87, landing 15, stats-view 83, miner 156, web-stats 2)
  · replay 9/9.
- The runtime spec 9/9, and a mutation run: nine mutations (a publish or a store write after dispose, a timer
  armed while stopped, the poll or the boot ignoring `yieldTo`, the fill not quiet, no reset on construction,
  stop keeping its waiters, a second boot), each failing the spec.
- `bun run --cwd apps/web-stats test:visual` 8/8 against P2's baselines, not regenerated.
- `bun run e2e:agent -- bun run --cwd apps/web-stats test:e2e` 7/7 (1.6 m).

## Codex (arc 4a)
Session `01a0d059-4445-72e3-b1f0-90e15cb81666` at `high`, over `5f92e6a..1371dbb`.

**Round 1** — four material, one minor; each verified against the code and fixed:
1. A disposed boot's continuation persisted the store's history, its successor's by then, under its own
   cache key. `persist` returns once disposed; it covers the boot's path and the fill's.
2. `stop(); start()` in one task while the boot waited on `yieldTo`: `booting` swallowed the start and the
   unwinding boot never came back, so the page stayed loading. A start during a boot sets `bootAgain`; the
   boot boots again on its way out when still live and not booted.
3. A boot waiting out a cooldown had no way out: a failure landing after dispose armed a wait of up to a
   minute, and a stop left a running wait armed. `waitTurn(signal)` (web-kit) resolves at once on abort,
   and `stop()` aborts the instance's controller. A `live()` check before the wait, tried first, proved
   redundant: its mutation went uncaught because the aborted signal alone arms nothing.
4. A fill page queued behind a poll ran after a dispose, a stop or a new yield. The serial callback checks
   `live()` and `yieldTo` when its turn comes.
5. Comments: the header states what a stop leaves running (a batch already out finishes); the recheck
   constant's comment went; `persist` says why it refuses.

Specs: four runtime tests (13 in all); each fix's mutation fails the spec (4/4) and the nine earlier ones
still do (9/9); web-kit's `waitTurn` spec covers the abort. On the fix: `bun run lint` 0, `bun test` 0
(647 pass, 44 skip), `bun run typecheck` 0, `bun run test:components` 0.

Found on the way: the mutation script checked a pattern only when it reached it, and a stale one stopped it
before its restore, leaving two mutations in `runtime.ts`. The diff review caught both before the commit;
the scripts now check every pattern first and restore in `finally`.

**Round 2** — "no new material findings" (verbatim). The four fixes hold (its focused runtime and node-health
run: 35/35). One minor, fixed: a synchronous `stop(); start()` while the bridge's first read waited on
`yieldTo` left the bridge loading until the 30 s tick (the new start found it busy, the cancelled wait
cleared the flag and went home). A cancelled wait now reads again when the instance is live by then. The
stop/start spec asks for the bridge too; its mutation fails it.

**Round 3** (over 1ec094c) — "no new material findings" (verbatim). Converged.
