# P8 · Routes, runtime, guard, bar, chunk — lessons

## What changed
- **web-kit.** `QUIET` (`Symbol.for('yacana.quiet-request')`) on a request's `init` makes that request quiet on
  both guard paths: a node request marked so neither opens nor extends a cooldown, an Ethereum one never
  reaches RPC health. A quiet outcome that started before the cooldown opened is ignored, as an early success
  already was; the probe started after it still ends it. `quietNodeClient` (its own JSON-RPC fetch: the SDK's
  `defaultFetch` builds `init` itself) and `quietEthRpcClient` (viem spreads `fetchOptions` into `init`, so the
  symbol survives) send only marked requests, each with a 10 s deadline.
- **Routes.** `stats`, `stats/bridge`, `stats/verify` join the miner's routes (two segments parsed); the old role
  resolves them to `mine`. `assemble.ts` rewrites the three paths to `/mine/`; the old origin's list keeps
  Wallet and Settings only. `site.e2e.ts` serves the three cross-origin isolated, each on its page.
- **The bar.** `packages/ui`'s `siteTabs` (Mine · Wallet · Stats, labels, icons, test ids and order once) and
  `statsTabs` in `SubTabs` (Overview · Bridge · Verify under the bar, an aside at its right). The miner passes
  in-app selection for all three and "mining here · N proofs/min · N win(s)" as the aside while mining;
  web-stats passes links for Mine and Wallet. Verify left the top level.
- **The hosted runtime.** The session publishes `endpointsAtom` wherever a guard slot moves (a node switch's
  start and end, success or rollback; an RPC change). `routes/Stats.tsx` loads on first opening; its module
  holds `createStatsHost`: one runtime per endpoint pair, disposed the moment a switch begins, a fresh one when
  it ends, started only while Stats shows. Hosted reads: quiet clients, `fill: false`, no `onFresh`, and one
  `hostedBusy` (a claim in flight, the node anything but ok, the guard not yet on the runtime's node) that holds
  both a batch's start (`yieldTo`) and each node request inside one (its turn, which also parks while Stats is
  hidden, with no timer); a dispose refuses what waits. No per-read timer: the client's 10 s deadline starts
  when a request leaves, so a wait for a turn fails nothing.
- **The shell.** On the stats routes the sign-in dialog stays away and the page's keys are the browser's;
  `features/StatsRoute.tsx` is the boundary: Try again, or Reload to open Stats after a redeploy.
- **The chunk.** The module report writes each chunk's modules, imports and size beside its module list, its
  directory read from the repo root; `apps/web-miner/scripts/check-chunks.ts` fails when a stats-view or Plot
  module rides the first paint. The replay lane builds with the report and runs the check.
- **E2E.** `e2e/stats-host.e2e.ts`, four tests in the bridge shard: the tour while mining (the chunk refused
  then loaded, the three pages, back and forward, no reload, the mini window, the proofs and the guard's slots,
  a stats-view class computed, Space); Stats first opened during a held claim, then an Ethereum switch with the
  old runtime's portal read held open; a node switch while on Stats; a direct visit before the preflight
  points the guard. The web-stats baselines are regenerated for the new bar and row.

## Deviations from the plan
- The sub row is `packages/ui`'s `SubTabs` + `statsTabs`, not a `SubNav` in `@yacana/stats-view/pages`: it is
  the bar's second row on both hosts, drawn with the bar's vocabulary, and the miner fills its aside.
- The hold has a third condition: the guard not on the runtime's node yet. A direct visit to `/mine/stats`
  reaches the page before the preflight points the guard, and every hosted read would fail as a blocked
  endpoint.
- `stats-host.e2e.ts` runs in the `bridge` shard, not `cockpit`: the Ethereum switch needs a build with a portal,
  and only bridge-mode runs have one.
- "Try again (a fresh `import()`)" cannot work: a document keeps a failed module fetch for good. Probed on
  Playwright's Chromium 151 against a 404-then-200 server: the same URL imported three times hit the network
  once; the same module under `?retry=1` fetched anew and shared the dependencies already loaded. Try again now
  imports the chunk under a query URL taken from the failure's message (Chromium and Firefox name it); where
  the browser names none (WebKit), the card offers the reload. The e2e's refused-then-loaded path is this fix
  running.

## Found on the way
- `routes.ts` imported `bridge/env` for the old role, and `apps/site` type-imports `routes.ts`: the site's
  typecheck then needed the apps' Vite env types. The old role is read in `routes.ts` itself.
- The module report dir was resolved against the build's cwd (`apps/web-miner` under `bun run --cwd`), so the
  replay lane's relative dir landed inside the app. It resolves from the repo root now; the lane passed 9/9 and
  the check read its report (first paint 9 chunks; Stats 355.9 kB, one chunk).
- The layout guard wanted `packages/stats-view/**` in `web-miner.yml`'s filter once the miner depended on it.
- `toHaveCount(0)` retries until it holds, so it cannot say "never shown". With the host's `dispose()` removed,
  the old runtime did publish its held read's failure (instrumented: `ready unreachable=true` 17 ms after the
  abort), and the assertion waited until the successor's next read, 30 s on, cleared the stale card. What must
  never show is now counted at once; the same mutation then fails the spec.
- The loader asked for the chunk again on every mount: once a retry had loaded it, the next opening fetched
  `?retry=0`, a second module instance whose second host also followed the store. The loader now keeps its
  promise for the document and numbers retries per document.
- A hosted e2e cannot tell the runtime's reads from the miner's on the wire, so each case pins an observable
  only the right runtime can produce: a held `operators()` call (the miner's own reads never make one), a
  claim minted after the switch, the guard's slots read through its registered symbol.

- The first visit asserted the bar's Stats at `/mine/stats`, the assembled site's path; the miner's own
  e2e build has base `/`, where its Stats is `/stats`. Every earlier cockpit run on this code had been
  interrupted, so the assertion first ran in the final gate and failed there. It now asserts the route's
  end and that the tab has no `target` (an external Stats opens a new tab) (e3ea574).

## Mutations
- web-kit, against its specs: the node path or the RPC path ignoring the mark, an early quiet outcome
  counting, RPC health hearing quiet outcomes, either quiet client unmarked — 6/6 caught.
- The host, the session, the routes, the rewrites and the tabs, against their specs: no dispose on a change,
  a switch in flight keeping its runtime, a new runtime started while hidden, the last hide leaving it running,
  no publication as a switch begins or on an RPC change, the second segment ignored, the old role keeping the
  stats paths, a stats path without its rewrite, the old origin rewriting Stats, Stats never current —
  11/11 caught; each command passes unmutated.
- The e2e: Try again on the failed URL (test 1: Stats never loads), no claim in `yieldTo` (test 2: read
  during the held claim), the runtime on the boot node (test 3: "blocked endpoint", 23.6 s), the host never
  disposing (test 2: the stale card, once counted), no guard condition in `yieldTo` (test 4: the error card,
  1.4 s), the loader before it kept its promise (test 1: `+ "?retry=0"` among the chunk's fetches) — 6/6
  caught.
- Codex round 1's fixes, against their specs: the RPC body unbounded, the node client ignoring its turn, busy
  only before a cooldown's deadline, busy ignoring a claim — caught (the two on `whenFree` and the dispose
  signal went with round 2's rework).
- Round 2's, against their specs: an infinite read deadline arming a timer, the genesis or the lottery on the
  module's default deadline, the reader opened without the host's limits, a finite hosted deadline, the
  client without turns, a stop leaving the turns shown, a dispose leaving them open, a timer while hidden, a
  hidden request leaving when free, a closed turns asked again — 11/11 caught.

## Gate
At f13783b, every step one after another (the builds share dist folders):
- lint 0 · `bun test` 0 (669 pass, 44 skip, 0 fail; 713 tests in 130 files) · typecheck 0 ·
  `test:components` 0 (ui 90, stats-view 83, landing 15, web-stats 2, miner 157).
- Replay 9/9 with the module report; check-chunks "first paint: 9 chunks, no stats module · Stats on first
  opening: 1 chunk(s), 356.9 kB"; the old origin's build 0; actionlint 0; `test:visual` 8/8.
- Landing e2e 5/5, stats e2e 7/7, site e2e 3/3 (`/mine/stats/` among its paths).
- Miner shards: chain 14/14, bridge 5/5 (the four `stats-host.e2e.ts` tests beside the bridge's), canary
  5/5, cockpit 7/8: the first visit's Stats href assertion expected the assembled site's path (Found on the
  way). Fixed in e3ea574; the cockpit shard then passed 8/8 at e3ea574.

## Codex (arc 4b)
Session `01a0d0c8-cb83-7a50-832b-0914a106d557`, high.

- **Round 1** — "Changes required: two material defects remain; both reproduced with in-memory requests
  (high confidence)." (1, material) `yieldTo` gates whole batches: a batch's follow-ups ignored a claim, a
  stop and a dispose, and a follow-up released past a cooldown's deadline took the recovery slot, so the
  miner's next request got the synthetic 429. (2, material) viem's timeout ends at the headers: a stalled
  body outlived the RPC client's 10 s. (3, minor) two App.tsx doc comments narrated their JSX; the
  inventory comment recounted additions. Fixed in 88603cd (web-kit: a quiet request waits for its `turn`;
  a `fetchFn` bounds the body) and 5f63f38 (miner: `hostedBusy` holds for any transport but ok, each node
  request waits for it, dispose refuses the waiting). Kept the inventory comment: it is the only legend for
  its sum's terms (codex agreed in round 2).
- **Round 2** — "Two material defects remain: admission waits consume the reader's timeout, and survive
  navigation away from Stats (high confidence)." (1, material) the reader's 10 s timer starts at the read,
  so a claim begun mid-batch failed the boot with nothing sent, the abandoned request leaving once the claim
  ended. (2, material) a hide left the waiters polling and let them leave while hidden. (3, minor) the
  route's header said no request leaves during a claim; the Ethereum ones do. Fixed: `ReadLimits.timeoutMs`
  of `Infinity` arms no timer, the runtime opens its reader with the host's limits and every beat reads under
  them; the hosted runtime moved into `stats-host.ts` with turns that its start, stop and dispose show, hide
  and close. One spec composes the host, the runtime, the quiet client through the guard and the reader.
- **Round 3** — "no new material findings" / "No additional minor findings." Codex reran round 2's
  failure through `hostedRuntime`: after a 10.2 s claim Stats stayed loading with zero fetches, then fetched
  and reached ready. Converged.

## Codex (the final cross-arc pass)
A fresh session over `9b190fa..HEAD`, `01a0d0fd-bcdd-7033-a576-b61366b39657`, high.

- **Round 1** (on d1eb1ea) — "Four material integration bugs remain; confidence high." Each verified in the
  code, each fixed with a spec a mutation of the fix fails (9/9):
  1. The claim's recovery reconciles while the miner is idle or mining, and hosted Stats held only for
     `claiming` and the rebuild (`recovering`): its reads went beside every receipt, nullifier and eligibility
     read of a recovery. The controller now says when a check reads (`claimCheckAtom`, set around `checkAll`,
     cleared in its `finally`), and `claimBusy` holds the hosted reads for it (1cc90d1).
  2. A hosted boot's quiet failure leaves the node's health ok, and the boot retried only after a cooldown:
     Stats stayed on its error until shown again. A boot failing at ok health retries a poll later, its error
     kept up meanwhile; a stop ends the wait (8e8f83b). The public page gains the same retry.
  3. The routers read `/mine/stats/` as `/mine/stats`, but only bare paths had a rewrite: a direct load of a
     slash form served the landing (so did `/mine/wallet/`, from before this stack). Every nested deep link
     has both spellings as exact rules; the site e2e loads `/mine/stats/` (f7556ee).
  4. The mini window's Start, signed out, set the sign-in wherever the page was; Stats and Settings mount
     none, so nothing showed. It goes to Mine first; `signInShowsOn` is the one rule (cdaeed9).
  5. (minor) the inventory's tally is named in code (d9b202b); the hosted runtime's doc says an Ethereum
     batch waits for the busy state only to start.
- **Round 2** (on d9b202b) — "One material finding remains: the recovery gate still releases before some
  reconciliation I/O finishes. Confidence: high." A check gives a read up at its 30 s deadline while the node
  may serve it for 120 s, and the flag cleared with the check. The controller counts its check reads until
  their promises settle and publishes `checking || checkReads > 0`; the deadline/drain spec asserts the flag
  holds past the check and clears once the held read lands (a181e64; 3/3 mutations caught). Codex found the
  rest sound: the signed commits, the boot retry, the sixteen exact rewrite sources, the navigation.
- **Round 3** (on a181e64) — "Two material gaps remain in the read-lifetime guarantee (high confidence;
  both reproduced)." (1) An adoption refreshed through `refresh()`, outside the counted reads: a refresh
  given up at its deadline ended the check with the balance simulation still out. A claim's refresh in
  `minted()` and the rebuild's first read did the same once their phase ended. (2) `canMint` answered
  `unknown` on the first rejected storage read while its sibling was still out, so the counted promise,
  the flag and the switch's drain all ended early. Fixed in ceccd25: a refresh the claim path starts (in a
  check, a claim or the rebuild) counts until it settles, and `canMint` waits for both reads
  (`allSettled`); `claimCheckAtom` became `claimReadsAtom`. Three specs (a held adoption balance, a held
  rebuild read, a failed storage read beside a held one); 4/4 mutations caught. The unit counted is our
  own call: the node requests inside one PXE simulation are the wallet's, and count as that one read.
  **A third material round in a row, surfaced to the owner** (plan: "Still material after three rounds:
  stop and surface to the owner"). As in arc 2, it is logged here and in the final report and the loop
  goes on: each round's findings are narrower cases of one family (how long a claim-path read outlives
  the hosted-Stats hold), each fix small and backed by a spec.
- **Round 4** (on ceccd25) — "One material gap remains: retrying the rebuilt view from idle bypasses the
  read counter (high confidence; reproduced)." A rebuilt view whose first read fails leaves the miner idle
  with `unread` set; Start reads it again outside both claim phases and outside a check, so that refresh
  went uncounted. `onClaimPath()` (a check, a claim or its rebuild, or the rebuilt view unread) decides
  what a refresh counts; the rebuild spec now holds Start's retry too (f13783b; 5/5 mutations caught with
  round 3's). (minor) the canMint spec's helper comment restated the helper: deleted. Codex found the rest
  sound, the PXE boundary included. Checked beside it: the claim's own send and `sent.wait()` are awaited
  inside `claiming` (the SDK's `retryUntil` checks its timeout between receipt reads, never over one), and
  a revert's `getL1Constants` runs inside `recovering`.
- **Round 5** (on f13783b) — "no new material findings" / "No numbered findings; confidence is high for
  this follow-up." Codex confirmed `onClaimPath()` covers Start's retry and the polls while the view is
  unread, that counted reads keep the flag through their own settlement whatever the deadline, the phase
  or `unread` do, and that the SDK awaits each receipt read before its retry timeout. Converged.
- **On e3ea574** (test-only, after the gate) — "no new material findings": "The assertion matches both
  build bases, and checking that `target` is absent catches the existing external-tab behavior."
