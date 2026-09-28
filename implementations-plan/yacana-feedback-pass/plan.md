---
plan: yacana-feedback-pass
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
hardening: none (no new trust boundary; the one permission-shaped change narrows what the page does unasked)
budget: "recon 2 agents (1 reuse sweep; the test-impact sweep rerun by the driver); codex at high (GPT-6 Astra); one fable audit; code-review off (owner, 2026-09-20)"
status: drafted 2026-09-20; round-1 audits folded (codex reject → reworked, fable conditional approve → conditions folded); the final codex pass rejected twice (round 1: ten findings; round 2: seven), all folded; round 3: conditional approve, its three conditions folded; **approved by the owner 2026-09-21** (defaults accepted, A7 replaced by an automated test on Presto's technique); implemented 2026-09-21, all phases ✓ (the evidence is in `lessons/phase-N.md`); delivered as stack #64 (#61–#63), rebased onto the monorepo layout 2026-09-22, **merged 2026-09-23** — see Outcome
created: 2026-09-20
---

## Outcome

Delivered 2026-09-21 as stack #64 on GitHub: #61 (arc 1, links · stepper · loop · presets · activity row) ←
#62 (arc 2, Presto by consent) ← #63 (arc 3, the balance on top, the tiles, the Wallet). All eight phases ✓;
every arc's codex loop and the cross-arc pass converged ("no new material findings"); the sweep on the final
tree found one consent leak (arc 2, fixed and reviewed) and two spec assumptions (`lessons/phase-8.md`).
The monorepo-layout PRs #54–#59 landed under the stack while it awaited review; it was rebased onto that
layout 2026-09-22 commit by commit, the fast layers and the whole sweep rerun green, and codex reviewed the
rebase as a diff of diffs: "no new material findings" (`lessons/phase-8.md`). Merged by the owner 2026-09-23, bottom-up (`f32794f`, `4244b7d`, `9b190fa` on `main`); Workers Builds deployed it. Its `/goal` and `/loop` seeds are retired.

# yacana-feedback-pass — the first users' feedback, built to the approved boards

Design input (authoritative for every pixel and word): the artifact "Yacana Feedback Pass", round 2, with the
owner's picks of 2026-09-20: **D1=A, D2=A, D3=B, D4=A, D5=A, D6=A, D7=C, D8=A, F1–F9 as drawn**, F2 "Deposit
sent". Its source is kept beside this plan as `boards.html` (a string on a board is the string in the app).
`recon.md` holds the reuse map, the tests that assert on what changes, and the dedup risks.

## 1. Goal

Ship the eight decisions and nine fixes on `/mine` with fidelity, desktop only, in three stacked PRs, every browser
suite adapted inside the phase that breaks it.

**Done means**: every phase's gate green in the transcript (§6); each arc's codex loop converged and the cross-arc
pass converged (§10); three PRs open as one stack with checks green (§7). Merging and deploying are the owner's.

**Out**: mobile; `/stats`, the landing, the portal, contracts; any new Presto capability; renaming "epoch";
Presto's own billboard component; moving `web-stats`' `Term` onto the new tooltip (a follow-up).

## 2. What the boards decided (short form; the boards are authoritative)

| | Decision | One line |
|---|---|---|
| D1·A | Ask before the browser does | Nothing reaches 127.0.0.1 before a click on **Look for Presto** in a row under the power slider: "Have Presto?" · "Native proving, several times faster." · [Look for Presto] Get Presto ↗ · "Your browser will ask first. Nothing leaves your machine." |
| D2·A | The claim on the chart | A violet band from the win to the claim's end between two accent bars: "CLAIMING" while it runs, "CLAIMED · 32 s" dimmed after; amber "DIDN'T LAND · 41 s" on a failure. |
| D3·B | The stepper | The connector is a flex child of the ring's column, as tall as its step; a paragraph shows only under the step that is running, failed or warned. |
| D4·A | Remember Presto | Once Presto has proved here, the next visit opens on a dimmed "Presto · used last time" row, no slider, no request before Start. Settings › Mining: the slider dimmed and locked while Presto proves, one readout, "Get Presto" only without Presto. |
| D5·A | Balance first | The balance tile tops Mine's right column; "+4 tYACA · just now" on its own reserved line under the number for 10 s after a mint. |
| D6·A | Name things, explain on hover | The axis says "SCORE · LOG SCALE"; the bar's caption says what reaching it means; a tick's hover shows that proof; a `?` opens three sentences; the epoch rows are relabelled and carry tooltips. "epoch" stays. |
| D7·C | Wins off the Wallet | The Wallet's balance tile is the number and its buttons; Mine's ledger gets a footer "N wins on this device · all wins ›" opening the list in the 440 px dialog. |
| D8·A | The kind leads | Activity row: a direction icon, "From Ethereum" / "To Ethereum" / "Sent ahead to V6", a signed amount in the unit that reaches or leaves this balance; "found on Ethereum" when the sender is unknown. |
| F1–F9 | The fixes | One ↗ per link · "Deposit sent" · legend "★ win · ✓ minted · ✗ failed · ── epoch", the minted line says "settling" then "final" · three preset buttons · ticks stroked as one path · no horizontal scrollbar in the account dialog · "proofs/min" · one thread readout · no zero address. |

## 3. Architecture & Implementation

Layered, bottom-up: `packages/ui` and the plain fixes, then the Presto consent machine as one reviewable unit with
both of its surfaces, then the routes compose. Cross-checked against `recon.md`'s reuse map.

### 3.1 Presto: consent, memory, revocation (arc 2 — the security-relevant unit)

**One rule: nothing is transmitted to Presto, and no live endpoint is handed out, without consent.** "Presto" is
the scope: a node the user chose on loopback (`site/src/browser/node.ts:19-30`) is their own setting and stays
allowed. Today five places decide on their own; after this plan all read one function. Holding the endpoint as
inert configuration is not a request; permission to transmit is what `consented()` gates.

| Place | Today | After |
|---|---|---|
| `session.ts` `startMining` → `reprobePresto` (mining starts synchronously, the probe runs in the background, `session.ts:852-861`) | probes on every Start | mining unchanged; the background probe runs only when `mayAsk()`, rechecked right before it transmits |
| `boot.ts:283` `prestoFor` (the Worker's endpoint at sign-in) | `prestoEligible(status)` | `∧ consented()` |
| `boot.ts:356` `new TxProver(pre.presto)` (no I/O; the SDK defaults to native and reads `forceLocal` only when `createChonkProof()` begins) | native by default until the mirror first runs | `setForceLocal(true)` **before** the prover is exposed to the wallet |
| `session.ts:717` TxProver mirror (`prestoProvesTx`) | status only | `∧ consented()` |
| `prover.worker.ts:30-34` (the Worker's **own** guard and prover; a `reconfigure` while mining is only queued, `prover-loop.ts:126-129`) | whenever handed an endpoint; a revocation would wait for the running proof, whose witness may not have left yet | handed one only through `prestoFor` / `reconfigure`; a new **`revoke`** message acts at once (below) |
| `session.ts:864` `retryPresto` (the banner's Retry, `App.tsx:140`) | probes | **deleted**; `App.tsx`'s `onRetry` calls `lookForPresto` (one entry point) |

State:

- **Persisted — its own record, not a settings field**: `localStorage['yacana.presto'] = { used: boolean, rev:
  number }`, owned by a new module `presto-consent.ts` (`read()`, `promote(atRev)`, `revoke()`, `subscribe(cb)`;
  storage injected, so it is unit-tested without a browser). `used`: "Presto produced a proof here that the page
  verified". `rev`: the revocation counter, **bumped by every revoke**. `settings.ts` is untouched: no unrelated
  settings write (threads, theme) can ever carry consent, which removes the stale-tab resurrection by
  construction rather than by merging. Per browser profile, not per account, on purpose: the permission it
  mirrors is per origin. An older build never reads the key, so a revert is safe.
  - **Writes are read-modify-write under `navigator.locks.request('yacana.presto', …)`** (Web Storage has no
    locking; without a lock a promotion in tab B could land its stale `rev` over tab A's revoke). `promote(atRev)`
    writes `used: true` only if the stored `rev` still equals `atRev`. Where the Locks API is missing the same
    code runs unlocked: the residual race is two tabs acting within the same task, named in Ask A5.
  - **A failed write** (storage readable, `setItem` throws; or private mode): the module keeps the value in
    memory and **stops reading storage for the rest of the page's life**, so a later successful read of an older
    record cannot overwrite what this page decided.
- **Session** (in `prestoAtom`): `consentRev: number | null` — the record's `rev` at the moment of a click on Look
  this page life; `looking: boolean`; `gen: number` — **monotonic for the page's life**: bumped by every consent
  change, never reset (the reset to `initialPresto` keeps it), so an old lookup can never match a later one. A
  probe publishes only on its own `gen`.
- `consented()` reads the record **fresh at every call**: `used ∨ consentRev === rev`. A revoke anywhere bumps
  `rev`, so every other tab's `consented()` turns false at its next call with no message needed — including the
  case where no tab had `used` yet (two tabs with a click each, before either first proof verified), and a tab
  that was suspended meanwhile: its **page-side** checks (a probe, a Look, the TxProver mirror when it runs, the
  controller's `nativeAllowed()`) see the fresh record. The teardown of what is already running in those tabs is
  driven by the `storage` event, which fires on every committed revoke because `rev` always changes.
  **What this does and does not promise**: a prover already running elsewhere (another tab's Worker, which has no
  storage and takes its authority by message; its TxProver, whose mirror runs on updates, not per request) stops
  initiating native requests **once its notification is processed**; between the committed revoke and that
  moment it may start one more. And when storage itself fails (a write that throws, private mode), consent and
  revocation are **page-local and non-persistent**: no event reaches other tabs, and a page that stopped reading
  storage no longer reconciles through it. Both are named in §4 and Ask A5.
  (The pop-out shares the opener's store, `LoopTile.tsx:96-100`: nothing to do.)
- **Permission**: `lnaAtom: 'pending' | 'granted' | 'prompt' | 'denied' | 'unknown'`, `pending` until the first
  `lnaState()` settles, then kept current by `PermissionStatus.onchange`. `lnaState()`: query
  `{name:'loopback-network'}`; **if that query rejects** (unknown descriptor) query
  `{name:'local-network-access'}`; if that rejects too, or there is no Permissions API, `unknown`. `unknown`
  means **confirmed unsupported**, never "slow": there is no timeout. While `pending`, automatic probing is simply
  unavailable; the background probe path (never `c.start()`, which stays synchronous) awaits the settlement and
  then rechecks `mayAsk()`, `gen` and that mining is still on before it transmits. A click on Look never waits.
- `mayAsk()` = `consented() ∧ lna ∈ {granted, unknown}`.

| `lna` | Automatic probe at Start (when `used`) | The card |
|---|---|---|
| `granted` | yes, silent | remembered → proving |
| `prompt` | **never** | "Presto · used last time" with **Look for Presto** (one explained click this visit) |
| `denied` | never | blocked, with the way to re-allow |
| `unknown` (no descriptor: Firefox, Safari) | yes — accepted limit: a browser that re-asks will show its prompt unprimed | remembered → proving |

Operations (all in `session.ts`, each ≤ 80 lines, exposed to React through one hook `features/use-presto.ts` that
owns the subscriptions and returns `{ standing, look, useBrowser }` for both surfaces):

- `lookForPresto()`: `consentRev = read().rev`, `gen++`, `looking`, probe with `force`; on an unchanged `gen`
  publish the status and `reconfigure(threads, eligible ? endpoint : null, { force: true })`. Also what the
  banner's Retry calls.
- **Promotion — on a proof the page verified itself.** The integration point is **inside
  `PrestoWorkProver.prove()`**, the one awaited boundary that holds the proof bytes, `out` and the witness
  (`miner-core`'s `onAttempt` is synchronous and sees neither; `worker-mine.ts` sees only winners). After
  `wellFormed(proof)` and before reporting `presto`: if this instance has not verified yet, it runs the body of
  the existing `verifyWin` on this proof (public inputs built locally; it needs no winning score). Success sets
  `this.verified` and reports `native-verified`. Failure is `stick('invalid-proof')` and the **same witness** is
  proved locally, so the nonce is neither skipped nor repeated. The flag lives on the prover instance, which **is**
  the build: it survives jobs and resumes and dies with a rebuild. A Stop during the verification needs nothing
  new: `prove()` returns late and the loop's own check discards it. Later native winners keep today's
  verification in `worker-mine.ts`; `verifyWin` returns true at once for the very proof `prove()` just verified
  (identity), so a first proof that wins is verified once.
  The controller calls `promote(consentRev)` on `native-verified` **only if authorization is current**
  (`nativeAllowed()`: `consented()` ∧ the configured endpoint non-null). The same helper guards **every** native
  publication from the Worker: `prover` with `kind: 'presto'`, **`ready` with `prover: 'presto'`
  (`controller.ts:616`) and `presto-phase` (`:635`)** — `reconfigure()` keeps the Worker, so the generation check
  of `controller.ts:218-234` rejects none of them. A sticky `invalid-proof` revokes the memory (`used = false`).
- `useBrowser()` — **revocation is one operation, local first**: the lock is asynchronous and can queue, so
  nothing waits for it. Synchronously: a page-level **`revoking` latch** is set, which makes `consented()` false
  **whatever the record says** (the record may still read `used: true` until the write commits), then the whole
  local teardown below; only then is the locked `revoke()` (`used = false`, `rev++`) awaited, and the latch drops
  when it commits (or when it fails and memory becomes authoritative). `lookForPresto()` awaits a pending revoke
  before it reads `rev`, so a Look right after cannot capture the old revision and be invalidated by the earlier
  revoke. The teardown:
  `consentRev = null`, `gen++` (an answer in flight is dropped before it is published), `prestoAtom` back to
  `initialPresto` **keeping `gen`**, `setAcceleratorEndpoints(null, 0)` in the page realm (which also refuses the
  POST of a transaction that was paused in detection; `forceLocal` alone would not cancel it), the TxProver
  forced local, then **to the Worker: `revoke` first, `reconfigure(threads, null)` second**.
  - **The Worker's `revoke`** (`prover-loop.ts` `handle`, which runs between the awaits of a running proof): it
    bumps a Worker-side `authEpoch`, clears **the Worker's own guard** (`setAcceleratorEndpoints(null, 0)`), and
    calls the current prover's `forceLocal('revoked')`. `prove()` checks `this.stuck` after `noir.execute()`
    (`presto-prover.ts:94`), so a proof still preparing its witness **never reaches `generateProof()`**; the guard
    refuses it even if it did. `build()` captures `authEpoch` at its start and, if it moved, builds WASM and never
    re-registers Presto's URLs: an obsolete build cannot restore the allowlist. `revoked` has no fix-it copy
    (`noticeFor` → null).
  - What is accepted: a proof whose witness **already left** finishes, its result used or discarded as today,
    promoting and publishing nothing. A transmitted witness cannot be recalled (§4).
- `prestoStanding(state, record, lna)` → `'ask' | 'checking' | 'found' | 'remembered' | 'proving' | 'absent' |
  'blocked'` (`found`: the look succeeded while idle, "proves when you start"). One selector, both surfaces.

Surfaces: `packages/ui/src/components/presto-card.tsx` — **new**, presentational (`standing`, `onLook`,
`onUseBrowser`, `compact`), copy verbatim from the boards; consistent with what `ui` already holds (EpochRail,
NodeBanner, ActivityRow). `RailTile.tsx`: `ask|absent|blocked|checking|found` → slider then card; `remembered|
proving` → card only (pick 6A of the polish canvas holds). `routes/Settings.tsx` `MiningTile`: header "mining", no
aside (F8); card first and the slider `disabled` while `remembered|proving`, with "Not in use while Presto proves;
Presto's own speed setting decides. Yacana falls back to these threads if Presto drops out."; `prestoWords` goes.
`PrestoBanner.tsx`: Retry → `look`; the billboard can now only appear after a consented probe came back `offline`
(the owner's answer: keep it beside the row's "Presto didn't answer").

### 3.2 `packages/ui`

- `components/stepper.tsx` — geometry: `grid-cols-[18px_minmax(0,1fr)_fit-content(45%)]`; column one is a flex
  column with the ring and, when not last, a `flex-1` line (`my-1 min-h-3 w-[1.5px]`, `bg-ok/50` under a done
  step). The `::after` at `top-[27px] h-[22px]` goes. The right column loses `whitespace-nowrap` and may wrap
  (this, not a clip, is what fixes F6: `overflow-x-clip` beside `overflow-y:auto` computes to `hidden` and
  `scrollWidth` would still exceed `clientWidth`). `showsDetail(step, i, steps, explain)`: true when `explain`, or
  `state ∈ {active, failed, warn}`, or the step is last and `done` (the outcome line of `Send` and `Claim`).
  `explain` on the five "How it works" screens. In live progress views the two pending one-liners that carry a
  condition move to the `right` column ("pays gas in ETH"; "by Yacana, or by you") so nothing is lost (Ask A3).
  **`Opening.tsx` keeps its own mechanism** (`shown()` strips `detail` because it is the byte count already in
  `right`; the `SUB` line sits under the overall bar in a reserved slot so the dialog's height never moves): it
  gets the geometry only.
- `components/power-slider.tsx` — labels → `<button data-slot="power-preset" data-on>` in a grid; `mergedLabels`
  still merges presets sharing a value; `label` prop (Settings: "browser threads").
- `components/activity-row.tsx` + `bridge-types.ts` — `amount`/`unit`/`direction`/`when` → `kind: 'in' | 'out' |
  'ahead'`, `title`, `meta`, `signed`; icons from `lucide-react` (`ArrowDownIcon`, `ArrowUpIcon`,
  `ArrowRightIcon`), imported directly as `dialog.tsx` imports `XIcon`. Below the header nothing changes.
- `score-loop-model.ts` — `Sample` gains optional `n`, `proveMs`, `at`, **populated in the reducer's `attempt()`**
  (`reducer.ts:233-235` stores none of them today; a reducer test asserts them from a real `attempt` event);
  `ClaimSpan { id, t0, t1, outcome? }`; pure, tested: `calmTicks(samples, …)` (the one path's segments),
  `spanBoxes(spans, now, spanMs)`, `plotGeometry({ width, labelWidth, now, spanMs })` → left, right, span —
  `labelWidth` is the canvas's measured text width and `now` the frame's monotonic time
  (`score-loop.tsx:397-402`), passed in so the function stays pure; the component keeps **the whole snapshot of
  the last drawn frame** and hit-tests against it, which is what makes hover right under reduced motion;
  `nearestSample(…)` (uses `won(sample, difficulty)` for the verdict).
- `components/score-loop.tsx` — **F5**: one `beginPath()` … `stroke()` for all ordinary ticks (no `Path2D`: jsdom
  has none). **D2**: `spans` prop, `drawSpans` under the ticks (fill `uv` 0.20 live / 0.09 ended, two 2 px bars,
  `warn` for `failed`, label inside when it fits else right-aligned above, none when `height <= 80`). **D6**:
  `axisTitle`, `barCaption` (caption moves to the left edge, clear of a win near "now"). **Hover**: extracted as
  `useScoreHover` + `ScoreHoverCard` (`ScoreLoop` is already at the 80-line budget); `pointermove` resolves
  `nearestSample` against the last frame's geometry kept in a ref — **not** inside the rAF loop, which does not
  run under reduced motion (there it calls the still redraw); the loop only highlights. The canvas takes
  `tabIndex={0}` and ←/→ step the hovered sample, so the card is not pointer-only. Off when `height <= 80`.
- `components/tooltip.tsx`, `components/popover.tsx` — **new in arc 3, with their first consumers** (no dead code
  in arc 1): thin radix wrappers in `dialog.tsx`'s shape. `Tip` wraps **its own** `TooltipProvider` (nested
  providers are supported), so specs and the pop-out's second React root need no setup; content gets `z-50`.

### 3.3 `packages/bridge` and the zero address (F9)

`portal-reader.ts` `readArrivals`: `deposited[]` gains `sender`. `journal.ts`: `UNKNOWN_ETH`, `knownEth(c)`. The
field **stays required** (the recovery format, `recovery.ts:89`, is shared with the old origin's deployed build;
K1/K2 need the address for their witness). `landing.ts`: `Arrived` carries `sender`; a landed deposit is created
with it; **the heal lives inside `landed()`**, which already runs inside `journal.adopt`'s single IndexedDB
transaction: after `sameMessage` and **before** the past-arrival early return (every zero row written by today's
build is already past arrival), when `stored.kind === 3 ∧ 'deposited' in a.fact ∧ stored.ethAddress ===
UNKNOWN_ETH`, only `ethAddress` is replaced. K1/K2 can never match. `rows.ts`/`copy.ts`: `titleOf`, `signedOf`,
and `senderOf` (not `partyOf`: `rows.ts:79` has one that feeds sentences); `Claim.tsx:60,72,116` read through
`knownEth` too. Trail's first word for a deposit: "deposit sent".

### 3.4 `packages/web-miner`, the rest

- `controller.ts` `dispatch`: stamps `t: performance.now()` on every event that lacks one — **one place**, not
  eight call sites (`claimed`, `failed` ×4, `winner`, `retry`, `reconciled` carry only `at` or nothing today). The
  `Event` types admit `t?`. A controller test asserts a `claimed` reaching the reducer has `t`, so reducer tests
  cannot pass on timestamps production never sends.
- `lib/reducer.ts`: `claimSpans`, kept **by transition in one wrapper around `reduce`**: `claim` null → non-null
  opens `{ id: claim.lineId, t0: event is winner ? (winAt ?? t) : t, t1: null }`; non-null → null closes the open
  span at `t` (`minted` iff the event is `claimed`, else `failed`) — so `prover-dead`, and any future path, closes
  it. `reconciled` also sets the earlier span with the same `id` to `minted` (that transaction did land). A stale
  winner never opens one (it is discarded before `claiming()`). Spans are trimmed with the samples **and** on
  `stop`/`prover-dead`. Session-only, like the samples: a reload starts empty.
- `LoopTile.tsx` **and its `PipView`**: both pass `spans` (a test holds the pop-out's call site); the tile also
  passes `axisTitle`, `barCaption`, and (arc 3) the `?` popover with the bar's odds ("about 1 proof in N").
- `routes/Mine.tsx`: the right column is one flex column (`BalanceCard`, `RailTile`), `xl:row-span-3`, the grid
  `xl:grid-rows-[auto_auto_1fr]` so a taller right column cannot open gaps on the left; `md` as today with the
  balance over the ledger. `e2e/miner.e2e.ts:78-117` asserts today's order (`key.top > r.bottom`): `placed()` is
  rewritten in the same phase.
- `components/BalanceCard.tsx`: a reserved `min-h-[1.4em]` mono line; while `mintedFresh(minted, now)` (exists,
  `reducer.ts`; `now` from `nowAtom`) it reads `+${amount(PARAMS.REWARD, PARAMS.DECIMALS)} ${SYMBOL} · just now`.
- `features/RailTile.tsx` epoch rows and tips; `features/LedgerTile.tsx` legend, footer;
  `features/dialogs/Wins.tsx` — **new**, `TxDialog` + the `<ol>` moved out of `routes/Wallet.tsx` + `Foot`;
  `lib/claim-copy.ts` "settling" with a title.
- `routes/Wallet.tsx`: `WinsRow`, `WinsList`, the `wins` state go; `ActivityList`'s `wins` prop goes, and with it
  the two other callers: `features/OldApp.tsx:284`, `gallery.vitest.tsx:100`. "private" becomes a `Tip`.

### 3.5 File-level change map

| Package | Added | Modified |
|---|---|---|
| `ui` | `presto-card.tsx`, `tooltip.tsx`, `popover.tsx` (+ vitest each), `stepper.vitest.tsx` | `stepper.tsx`, `power-slider.tsx` (+ spec), `activity-row.tsx`, `bridge-types.ts`, `score-loop.tsx`, `score-loop-model.ts` (+ test), `index.ts`, `signature.vitest.tsx`, `bridge-primitives.vitest.tsx` |
| `bridge` | — | `portal-reader.ts`, `journal.ts` (+ tests; the sender asserted in the existing real-log test) |
| `web-miner` src | `presto-consent.ts`, `features/use-presto.ts`, `features/dialogs/Wins.tsx` | `App.tsx` (`onRetry`), `presto.ts`, `presto-prover.ts` (first-proof verification), `prover-loop.ts` + `prover.worker.ts` + `worker-protocol.ts` (`revoke`, `authEpoch`, `native-verified`), `session.ts`, `boot.ts`, `controller.ts`, `lib/{reducer,claim-copy}.ts`, `bridge/{landing,rows,copy}.ts`, `features/{RailTile,LoopTile,LedgerTile,ActivityList,PrestoBanner,OldApp,OldTabNotice}.tsx`, `features/dialogs/{FromEthereum,ToEthereum,Send,Claim,SendAhead,Wallet}.tsx`, `components/BalanceCard.tsx`, `routes/{Mine,Wallet,Settings}.tsx` |
| `web-miner` tests | `tests/external-link-arrows.bun.test.ts` | `tests/presto-session.bun.test.ts` (its held-response test withdraws consent before the release), `tests/activity-rows.bun.test.ts`, the vitest specs of `recon.md`'s table, `gallery.vitest.tsx`, `e2e/{presto,miner,opening,bridge}.e2e.ts`, **`e2e/replay/lna.replay.ts`** (new) with `e2e/replay/fixtures.ts` (the routing factored out), **`e2e/proof-inventory.ts`** (every new or renamed title; titles are the identity), `e2e/replay/signed-out.replay.ts` |
| repo | `implementations-plan/{.gitignore,.ignore,lessons.md,follow-ups.md,archive/index.md}`, `.gitattributes` | `CLAUDE.md` (the `ui` and `web-miner` rows; it says "the probe at cockpit-ready", which was already untrue), `implementations-plan/index.md` |

Deleted: the Wallet's `WinsRow`/`WinsList`, `session.retryPresto`, `prestoWords`, Settings' `PrestoRow`, the rail's
`PrestoRow`.

### 3.6 Trade-offs and alternatives not taken

- **One persisted fact, consent in session** (fable's simplification, adopted over the draft's three-state
  enum): no board needs a bare click to outlive the page. It removes the adoption migration, the "declined"
  problem, and the case of someone who clicked once without Presto being probed on every later Start.
- **Its own storage record with a revocation counter, not a settings field** (the final pass's second round broke
  the settings-field version twice: a stale tab's unrelated patch could write consent back, and "true → false"
  cannot signal a revoke when the value was already false). A separate key removes the first by construction; a
  counter that always changes solves the second and lets every tab check by reading instead of by being told.
  `BroadcastChannel` was considered and not needed: the `storage` event already fires on every revoke.
- **No silent adoption of an already-granted permission** (the draft had it; both audits broke it: it undid "use
  the browser" on reload, and `granted` can exist for a loopback node or RPC). Existing Presto users click once.
- **Promotion on the first native proof the page verified, not the first verified win** (the final codex pass's
  alternative, adopted over both the draft's shape check and round 1's "verified win"): no hours of waiting, and
  the flag never rests on bytes nobody checked. One honest proof does not guarantee the next: see Ask A4.
- **Spans by transition, not per event**: every present and future path that ends a claim closes its span.
- **Hover card in the DOM, resolved on the pointer event**: themes and wraps; honest about a11y (keyboard
  stepping on a focusable canvas; the canvas stays `role="img"` with its summary label).
- **`ethAddress` stays required** (against the board's "becomes optional").
- **Competing outline — slice by surface** (arc 1 Mine, arc 2 Wallet and dialogs, arc 3 Settings and consent).
  For it: every PR user-visible, each arc aligned with the shard that proves it. Against, and deciding: the
  consent machine must be **one** security-reviewable PR with both its surfaces (the rail and Settings), which a
  surface split cannot give without creating the Presto arc anyway; and the stepper genuinely precedes F6. (That
  `ui` gets reopened is *not* the reason: this plan reopens it in arcs 2 and 3 as well.)

## 4. Security & Adversarial Considerations

- **Threat model.** A static site talking to a user-chosen Aztec node, an Ethereum RPC and, optionally, a local
  prover on loopback. The plan changes *when* loopback is first touched (never before an explained click, or a
  remembered use under a granted permission) and makes withdrawal real.
- **Every authority, one gate** (§3.1's table). The Worker's endpoint, the page's probe, the TxProver's native
  route and the banner's Retry all hang off `consented()`. `useBrowser()` revokes all of them at once, including
  an answer in flight (`gen`, monotonic), a proof in flight (it can neither promote nor publish), the page
  guard's URL list, and every other tab of the origin. **Witness privacy**: the wallet's kernel witness goes to
  Presto only while `consented() ∧` a live eligible status; the TxProver is born forced-local; after
  `useBrowser()` a transaction paused in detection cannot POST (the guard refuses it). What was already
  transmitted cannot be recalled. **The boundary, exactly**: in the tab where it is clicked, revocation is
  synchronous (the latch, the guard, the Worker's `revoke` on receipt) — no new native request starts there. In
  other tabs it is eventual: page-side checks read the fresh record at once, running provers stop when their
  notification is processed, and one more native request can start in that window. With failing storage it does
  not leave the page at all.
- **A dishonest or broken Presto.** It can never mint: every win is verified against the job's own inputs before
  it is claimed (unchanged). It **can** waste the visitor's mining by answering well-formed losing bytes forever;
  verifying the first native proof of each build narrows that and keeps the remembered flag honest, but one good
  proof does not bind the next. Accepted and pre-existing (Ask A4); sampling later proofs is a follow-up line.
- **Loopback probing as fingerprinting.** Proven by server-side evidence, not a page listener (Playwright can miss
  Worker traffic; `presto.e2e.ts` already reads the headless Presto's `server.log`): zero requests across load →
  sign-in → Start → first proof, and again with `resumeOnOpen: true`.
- **Consent in `localStorage`.** Same-origin script can flip it, and can equally call `fetch`: the flag protects
  the experience, the browser's permission is the boundary. `lnaState()` only reads.
- **The Worker is its own realm.** It has its own fetch guard and its own prover, and a `reconfigure` during a
  proof is only queued. Revocation therefore reaches it as a separate, immediate `revoke` (§3.1): guard cleared,
  prover forced local, obsolete builds unable to re-register Presto. P5 proves it with a held witness
  preparation: revoke, release, **zero native POSTs**.
- **Accepted limits** (Ask A5): with Presto remembered and resume-on-open, a loopback request happens at page open
  without a click that visit (permission `granted`, so silent); in a browser without the permission descriptor, a
  remembered Start can surface the browser's prompt unprimed; whenever the permission reads `prompt` again (reset,
  expired, a profile where it does not stick) a remembered user clicks Look once that visit; a permission query
  that never settles means no automatic probe that visit (Look still works); without the Web Locks API, a
  promotion and a revoke racing in two tabs within the same instant can leave Presto remembered; revocation in
  **other** tabs has a propagation window (one more native request can start there); with failing storage,
  consent and revocation are page-local and do not persist.
- **Input at trust boundaries.** `sender` is decoded by viem against the committed ABI and rendered only through
  `shortAddress` as React text. Tooltip and popover content is our own copy plus numbers.
- **Supply chain.** No new dependency (`radix-ui`, `lucide-react` already in `packages/ui`); `bun install
  --frozen-lockfile` stays clean. **Headers**: CSP, COOP, COEP untouched. **Recovery files**: format unchanged.
- **Rollback.** Arcs revert top-down (arc 3 needs arc 1's chart props; arc 2 needs nothing of arc 3). Persisted
  data survives a revert harmlessly: the `yacana.presto` key is never read by older builds, healed rows are valid
  rows.

## 5. Assumptions

**Facts** (verified in the worktree at `06b25d7`)

1. The probe fires from `startMining()` → `reprobePresto()` (`session.ts:852-885`); the signed-out Start and the
   pop-out call the same `onStart` (`LoopTile.tsx:54,144-149`, `App.tsx:139`); `useResumeOnOpen` calls it when the
   boot becomes ready (`use-page-behaviour.ts:106-113`). Nothing else probes.
2. `setAcceleratorEndpoints` is called in the page realm only inside `probePresto` (`presto.ts:192`); the Worker
   registers the URLs itself when handed an endpoint (`prover.worker.ts:30-34`), which `prestoFor` decides.
3. `new TxProver(endpoint)` does no I/O; its native route follows `prestoProvesTx` (`session.ts:717`).
4. The connector is `not-last:after:top-[27px] … h-[22px]` (`stepper.tsx:63`); the right column is
   `whitespace-nowrap` (`stepper.tsx:98`) and the opening prints a failure reason there (`Opening.tsx:19`).
5. `ExternalLink` appends `↗` itself (`external-link.tsx:29-32`).
6. Ordinary ticks are stroked one call each at alpha 0.55 (`score-loop.tsx:283-295, 356`).
7. `claimed`/`failed` are dispatched with `at` only or nothing (`controller.ts:251,644,704,848,978`); `winner`,
   `retry`, `reconciled` have no `t` in their types (`reducer.ts:152-170`); `prover-dead` nulls `claim`
   (`reducer.ts:425-436`); a stale winner is discarded before `claiming()` (`reducer.ts:302-307`).
8. `PrestoWorkProver` reports `presto` after a shape check; only wins are verified (`presto-prover.ts:95`,
   `worker-mine.ts:88`).
9. `claimsAtom` is persisted per deployment and account (`main.tsx:55-82`).
10. `Deposited` carries `sender` (`YacanaPortal.sol:124`); `readArrivals` drops it; `landing.ts:171` zero-fills;
    `journal.adopt` applies `landed()` inside one readwrite transaction (`store.ts:157-169`).
11. `settingsAtom` writes `{...get(base), ...patch}` from a `base` loaded once per page (`settings.ts:79-86`):
    anything stored in that blob can be written back by another tab's unrelated patch. Consent does not live there.
12. `miner.e2e.ts:78-117` asserts the cockpit's child order and that the balance sits under the rail.
13. The replay lane is signed-out only and fails on any spawned Worker (`e2e/replay/fixtures.ts:1-5`): the opening
    checklist cannot be reached there. `opening.e2e.ts` (shard `canary`) cancels mid-opening.
14. `proof-inventory.ts` enumerates every e2e title; an unknown title fails the run.
15. Proverless builds skip transaction proving only; W's mining proofs stay real (`presto.e2e.ts:66-77`).
16. `radix-ui@^1.6.7` exports `Tooltip` and `Popover`; `recording.json` holds no UI copy.
17. `startMining()` starts mining synchronously and probes in the background (`session.ts:852-861`). A
    `reconfigure` during a proof is queued (`prover-loop.ts:126-129`); `prove()` checks `stuck` after
    `noir.execute()` and before `generateProof()` (`presto-prover.ts:94-96`). `miner-core`'s `onAttempt` is
    synchronous and carries no proof bytes (`miner.ts:32,44-55`).
18. The old origin can import a recovery file: `OldApp` mounts `ActivityList`, which mounts `Recovery`, whose
    input calls `session.bridge.importRecovery()` (`OldApp.tsx:280-293`, `ActivityList.tsx:130-161`,
    `bridge/session.ts:1133-1138`).
19. Presto's repo (`github.com/alejoamiras/presto`, read 2026-09-21) tests the permission **for real, headless,
    in CI**: `packages/playground/playwright.lna.config.ts` launches Chromium with
    `--ip-address-space-overrides=<page origin>=public`, which makes a page served from 127.0.0.1 a *public*
    origin and its fetch to the prover a genuine public → loopback request; `e2e/lna.real.spec.ts` then gets
    `denied` from `context.grantPermissions([], { origin })` (CDP's grant rejects every permission left out),
    `granted` from `grantPermissions(['local-network-access'], { origin })` (Playwright ≥ 1.58 maps it to the
    legacy and the split names), `prompt` from a fresh context, asserts **zero hits on the health server** under
    `denied` and `prompt`, and relies on `PermissionStatus`'s `change` for "a grant in the same context recovers
    without a reload" (`playground/src/presto-status.ts:30-66`). This repo has Playwright 1.62.1 (Chromium 151).
    It also explains `presto-mine/lessons/phase-2.md`: "undecided does not block in headless" and "a denied state
    could not be produced" were artefacts of a loopback-served page (same address space, no gate) and of not
    knowing the empty-grant deny, not properties of headless Chromium.

**Inferences** (each with the step that settles it)

- I1. The scrollbar the owner saw is the opening checklist's nowrap right column (mechanism per Fact 4). P2 puts
  the overflow assertion in `opening.e2e.ts` first and sees it red on the old stepper.
  **Refuted in P2 (2026-09-21)**: the assertion passed on the old stepper, and no string the page writes, window
  size or scrollbar type overflows the account dialog in Chromium 151. The mechanism is real only past about
  fifty characters (a 120-character cell: +401 px old, 0 new), so P2 guards the mechanism and does **not** claim
  to have fixed what the owner saw; `lessons/phase-2.md` has the three attempts, `follow-ups.md` the open question.
- I2. Chrome's permission: `prompt` before the first loopback fetch (which then pends), `granted` after Allow,
  `denied` blocks, and `PermissionStatus`'s `change` fires on the transition. **Settled by an automated real
  boundary, the way Presto's own repo does it** (Fact 19): `e2e/replay/lna.replay.ts` in P5c. The evidence names
  the browser's version and the descriptor that answered; an inference never stands in for it.
  **Confirmed in P5c (2026-09-21)** on HeadlessChrome 151, descriptor `loopback-network`, once the page was served
  by IP (the lane's `localhost` bound `::1` alone, which no override names): `lessons/phase-5.md`.
- I4. Under the address-space override the replay fixture behaves as Presto's harness does: the app's own origin
  loads, `route.fulfill` answers for the node never touch the network (so the gate does not apply to them), and
  only the `allow()`-ed fake Presto is a real public → loopback request. Settled by `lna.replay.ts`'s first test
  (the capability asserts); if the node's mocked answers turn out gated, the spec serves them from the app's origin.
- I3. `fit-content(45%)` and `xl:grid-rows-[auto_auto_1fr]` lay out as intended: checked in a browser in P2 / P7.

**Asks** (the owner decides at the gate; defaults in bold)

- A1. Untrack the 27 committed `audit-*.md` / `eli5.html` the blueprint's new ignore rules cover? **No, not in this
  plan** (a follow-up line).
- A2. F9 departs from the board: the field stays required and gets the real sender. **As written.**
- A3. D3·B refined: explainers keep every paragraph; a finished last step keeps its outcome line; two pending
  one-liners move to the right column; the opening keeps its own reserved sub-line. **As written.**
- A4. "Remembered" means **Presto produced a proof here that the page verified itself** (the first native proof
  of each prover build, winner or not), not "a verified win", which could take hours. Accepted with it: a Presto
  that turns dishonest after that proof can still waste mining (never mint); remembering also lets transaction
  proofs route to Presto under the normal eligibility checks, not only which row shows. **As written.** Existing
  Presto users click Look once after this ships (no silent adoption).
- A5. The accepted limits of §4 (seven; the last four rare), and revocation's reach: immediate in the tab where
  it is clicked, eventual in other open tabs, page-local when storage fails. **Accepted.**
- A6. `/harden`: **not recommended** for this plan.
- A7. **Withdrawn (owner, 2026-09-21: "check Presto's tests").** No manual check: I2 is settled by
  `lna.replay.ts` on Presto's own technique (Fact 19), in the fast gate of every phase from P5c on and in CI's
  PR lane. What stays outside any automation is Chrome's prompt bubble itself, which is the browser's code, not
  ours: CDP's grant and deny drive the same permission state, the same pending fetch and the same `change` event
  that a click on it does.

## 6. Phases with validation gates

Fast layers, after every meaningful edit and at every gate:

```sh
bun run lint && bun test
bun run typecheck && bun run --cwd packages/web-miner typecheck
bun run test:components
bun run --cwd packages/web-miner test:replay
```

Every e2e run goes through `bun run e2e:agent -- …` in tmux. A shard passes when **every title of the shard
executed**; proof floors are met only on real-proving runs (proverless runs waive them by design). Real-proving
gates spell `E2E_PROVERLESS=0` so an inherited environment cannot change what they mean (only `'1'` switches it on).

**Before P1** (once per machine): `bunx playwright install chromium` when the build Playwright 1.62.1 pins is
absent (this machine's shared browser directory holds an older one; the permission tests need Chromium ≥ 145),
and `bash scripts/run/install-presto-server.sh`. The `chain` shard holds
`presto.e2e.ts`, whose tests skip without the server, and a shard with a skipped title fails its inventory
(`e2e/run-suite.ts:49-55`): arc 1's gate needs it as much as arc 2's.

### Arc 1 — the plain fixes and `ui`

**P1 ✓ — Links, words, the zero address.** F1 (five callers, three anchors, the scanning test), F2, F3, F7, F9
(§3.3).
**Gate**: fast · pass: the scanning test red before the callers change, green after; `recovery.test.ts` untouched
and green; `landed()` tests: a deposit lands with its sender, a stored zero K3 row past arrival heals, a nonzero
address is kept, K1/K2 rows and twins are untouched, a concurrent state advance inside `adopt` survives · layers:
lint, typecheck, unit, component.

**P2 ✓ — The stepper and the dialog's overflow.** *(The red-first step did not go red: I1 is refuted, see §5 and `lessons/phase-2.md`. The gate below passed as written.)* The overflow assertion into `opening.e2e.ts` at 900×720
(reusing `dialog-geometry`'s `fits`), seen **red** first; then the geometry, `showsDetail`, `explain`, the two
right-column one-liners.
**Gate**: fast, then `E2E_PROVERLESS=0 E2E_SHARD=canary bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e` · pass:
`stepper.vitest.tsx` (one-line step, paragraph step, last done step with detail, `explain`); the opening's
overflow assertion green, with a long failure reason; `sign-in.vitest.tsx` unchanged · layers: + e2e, real proving.

**P3 ✓ — The score loop.** *(One deviation, seen only on a rendered frame: the bar's caption sits under the bar's left end, not above it; `lessons/phase-3.md`.)* `dispatch` stamps `t`; spans by transition; F5; `drawSpans`; `axisTitle`, `barCaption`;
`useScoreHover` + `ScoreHoverCard`; `LoopTile` **and** `PipView` wired.
**Gate**: fast · pass: reducer tests for winner → claimed, winner → failed, `retry`, `reconciled` (earlier span
turns `minted`), `prover-dead`, `stop`, trim; the controller test of Fact 7's fix; model tests for `calmTicks`
(N ticks → one path), `spanBoxes`, `plotGeometry`, `nearestSample` (resized margin, grown window, aged-out
sample); a component test with `getContext` and `clientWidth` mocked asserts one `stroke()` for the ticks and that
the pop-out passes `spans`; hover works with reduced motion on · layers: unit, component.

**P4 ✓ — Presets, then the activity row.** (a) F4 with its spec. (b) D8: `activity-row.tsx`, `bridge-types.ts`,
`rows.ts`, `copy.ts`, the fixtures in `bridge-primitives.vitest.tsx`, `activity-rows.bun.test.ts`,
`gallery.vitest.tsx`. Fast layers after each.
**Gate (arc 1's e2e)**: fast, `YACANA_APP_ROLE=old bun run site:build`, then

```sh
E2E_PROVERLESS=1 E2E_SHARD=cockpit bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
E2E_PROVERLESS=1 E2E_SHARD=chain   bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
E2E_PROVERLESS=1 E2E_SHARD=bridge  bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
bun run rig -- browser origin
```

pass: every title ran; `bridge.e2e.ts` (the rig's `browser` case) now **asserts the strings**, not only
visibility: the deposit dialog ends on "Deposit sent" and the row is titled "From Ethereum" with a signed amount.
The old origin gets the row from the **same** `ActivityList` → `rows.ts` → `ActivityRow` as the apex, with no
origin-specific branch in the row. It could be seeded in the rig through the recovery import it does have (Fact
18), but that means fabricating a recovery file for the rig's deployment and a second full network boot to
re-assert a string the apex e2e and the specs already hold. So, by cost: a component spec renders `OldApp`'s
list over a K3 journal fixture and asserts the same row, the old build compiles, and `rig origin` stays green ·
layers: + e2e on the isolated network. **Then arc 1's codex loop (§10), then `gh stack add yacana-feedback-pass-presto`.**

### Arc 2 — Presto: consent, memory, revocation

**P5 ✓ — The machine, and the way to say yes.** The rule cannot land without its button: the replay lane's fix-it
test reaches Presto through Start today (`signed-out.replay.ts:74-82`) and replay is in every fast gate. So the
switch of behaviour ships **together with** the way to consent. Three checkpoints, the fast layers green at each:

- **5a — foundations, nothing switched.** `presto-consent.ts` (the record, the lock, the failed-write rule, the
  `storage` subscription), `lnaAtom` + `lnaState`, `prestoStanding`, `consented` / `mayAsk` as pure functions.
  No existing entry point reads them yet.
  *Tests*: the record — promote at a stale `rev` is refused; revoke bumps `rev` when `used` was already false
  (**false → false still revokes another tab's click**); an **interleaved** read / revoke / write (a lock double
  that orders the callbacks) never leaves `used: true` behind a revoke; a read that throws, and **a readable
  storage whose writes throw**: successive operations keep this page's decision, and — the stated limit, shown
  with two sessions on one storage double — A's failed revoke neither changes B's record nor notifies B;
  `lnaState` (modern rejects →
  legacy `prompt` / `denied`; no API; both reject); the `prestoStanding` table over (used × click × lna × status).
- **5b — the first proof is verified; the Worker can be told to stop.** `presto-prover.ts` (verification inside
  `prove()`, `native-verified`, the identity short-cut in `verifyWin`), the Worker's `revoke` and `authEpoch`,
  `worker-protocol.ts`. The page does not send `revoke` yet and ignores `native-verified`.
  *Tests* (the prover and the loop with doubles, as `presto-session.bun.test.ts` does today): a first **loser**
  is verified once and reported; a first loser that **fails** is re-proved locally **on the same nonce** with
  reason `invalid-proof`; a Stop during that verification discards the proof and advances nothing twice; a
  resumed job on the same build does not verify again, a rebuilt one does; a first **winner** is verified exactly
  once; **a held witness preparation**: `revoke` arrives during `noir.execute()`, it is released, and the fake
  Presto sees **zero POSTs**; **a held build**: `revoke` during `build()` ends in a WASM prover and the Worker's
  guard refuses Presto's URL.
- **5c — the switch, atomically with the button.** `session.ts` (`lookForPresto`, `useBrowser`, the background
  probe awaiting the permission's settlement, `retryPresto` deleted), `boot.ts` (`prestoFor` gated, the TxProver
  born forced-local), `controller.ts` (`nativeAllowed()` over `native-verified`, `prover`, `ready`,
  `presto-phase`), `use-presto.ts`, `PrestoCard` and its wiring in the rail, `App.tsx`'s `onRetry`, and the
  replay test clicking **Look for Presto**.
  *Tests*: Start with nothing consented makes **no** `probePresto` call, hands no endpoint to the Worker, and
  mining starts at once; remembered + `granted` → one probe, + `prompt` → none; **a permission query held past
  any delay**: mining starts immediately, no probe happens, and a later `prompt`, `denied` or revoke releases
  none; after `useBrowser`, `prestoProvesTx` is false, `prestoFor` is null and the page guard refuses Presto's
  URL; **a held first proof** (Look → the proof starts → `useBrowser` → it lands): `used` stays false, `active`
  stays null; a native `ready` and a `presto-phase` arriving after a revoke publish nothing; **Look → revoke →
  Look** with the first lookup held: its late answer publishes nothing; **a transaction paused in detection**,
  revoked, released: no witness POST; **two sessions on one storage double**: a revoke in A turns B's
  `consented()` false at once and B's `storage` handler tears B down, whether or not `used` was ever true;
  **a held lock**: with the record at `used: true` and the lock double holding `revoke()`, `useBrowser()` has
  already torn down and `consented()` is false; a native `prover` message and a Start while it is pending change
  nothing and probe nothing; a Look clicked meanwhile runs **after** the revoke commits and consents at the new
  `rev`.

  **The permission, for real** (`e2e/replay/lna.replay.ts`, Presto's technique, Fact 19; it settles I2 and I4):
  the spec launches its own Chromium with `--ip-address-space-overrides=<the run's origin>=public` (the port is
  per run, so it cannot sit in the config), reuses the replay fixture's routing (factored out of `fixtures.ts`
  so both share it) and a counting fake Presto like the fix-it test's. It asserts first what it stands on:
  secure context, `targetAddressSpace` in `Request.prototype`, the descriptor that answers, the browser's
  version (all four logged into `lessons/phase-5.md`). Then: **a fresh context reads `prompt`**, and load →
  Start leaves the fake at **zero hits**, remembered or not; **`denied`** (`grantPermissions([], { origin })`)
  with Presto remembered: zero hits, the card reads blocked; **`prompt` → Look → the request pends → a grant in
  the same context**: `change` fires and the card reaches found with no reload; **`granted` with Presto
  remembered**: a reload probes silently, exactly once.

**Gate**: fast, at each checkpoint and at the end · pass: every test above; the replay lane green with the fix-it
test going through the new button and `lna.replay.ts` on a real public → loopback boundary · layers: unit,
component, replay.

**P6 ✓ — Settings, memory on screen, and the proof.** *(Arc 2's codex loop found three consent races the unit suite had not; fixed and regression-tested, `lessons/phase-6.md`.)* Settings › Mining (F8), the remembered and proving rows;
`presto.e2e.ts`: the existing titles click **Look for Presto** first; new titles (added to `proof-inventory.ts`):
*no request reaches Presto before the click* (server.log diff and `context.on('request')`, over load → sign-in →
Start → first proof; again with `resumeOnOpen: true`), *remembered: a reload opens on "used last time" and Start
goes native with no click* (`grantPermissions`), *use the browser: the next claim is proved in the page*.
**Gate (arc 2's e2e)**: fast, then

```sh
E2E_PROVERLESS=0 E2E_SHARD=chain bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e     # real proving: the TxProver's routing is only observable with it
```

pass: no `presto.e2e.ts` title skipped; the zero-requests evidence from the server log; the transaction proof goes
to Presto after consent and to the page after `useBrowser` · layers: + e2e with the headless Presto, real proving.
**Then arc 2's codex loop, then `gh stack add`.**

### Arc 3 — the cockpit and the wallet, composed

**P7 ✓ — Mine.** *(The boards give one tooltip sentence; the other five are written from the rules the page reads. `lessons/phase-7.md`.)* `Tip`, `Popover`; the epoch rows and tips; the `?` popover; the right column and the mint line
(D5); the ledger's footer and `Wins.tsx` (D7); `miner.e2e.ts` `placed()` for the new order.
**Gate**: fast, then `E2E_PROVERLESS=1 E2E_SHARD=cockpit bun run e2e:agent -- bun run --cwd packages/web-miner
test:e2e` · pass: `cockpit.vitest.tsx` (row labels, footer count, the dialog lists `claimsAtom`); the mint line
reads exactly "+4 tYACA · just now", goes after 10 s, and the tile's height is equal with and without it
(asserted in `miner.e2e.ts`, where there is layout); a `Tip` renders inside the pop-out's root · layers: + e2e.

**P8 ✓ — The Wallet, and the sweep.** *(The sweep found one consent leak in arc 2 — a revoke still queued when
the witness was ready — fixed and reviewed; two spec assumptions corrected. `lessons/phase-8.md`.)* The Wallet's
removals, `OldApp.tsx`, the "private" tip; `CLAUDE.md`; `index.md`; then everything:

```sh
E2E_PROVERLESS=1 E2E_SHARD=cockpit bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
E2E_PROVERLESS=0 E2E_SHARD=chain   bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
E2E_PROVERLESS=0 E2E_SHARD=canary  bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
E2E_PROVERLESS=1 E2E_SHARD=bridge  bun run e2e:agent -- bun run --cwd packages/web-miner test:e2e
bun run rig -- browser origin
YACANA_APP_ROLE=old bun run site:build && bun run e2e:agent -- bun run site:e2e
bun run lint:actions
```

pass: all green in the transcript · layers: every layer the repo has. **Then arc 3's codex loop, the cross-arc
pass, Delivery.**

## 7. Delivery — arcs → stacked PRs

| Arc | Branch | Phases | Stacks on | code-review |
|---|---|---|---|---|
| 1 · the plain fixes and `ui` | `worktree-yacana-feedback-pass` (adopted) | P1–P4 | `main` | off |
| 2 · Presto: consent, memory, revocation | `yacana-feedback-pass-presto` | P5–P6 | arc 1 | off |
| 3 · the cockpit and the wallet | `yacana-feedback-pass-surfaces` | P7–P8 | arc 2 | off |

Reverts go top-down (§4). `gh stack init --adopt worktree-yacana-feedback-pass`; at each boundary, after the arc's
loop converged, `gh stack add <next-branch>`. Branches are pushed for checkpointing (`gh stack push`); **no PR,
draft or not, before §10 step 4**. `gh stack merge` is the owner's.

## 8. Decision ledger

| # | Decision | Chosen | Rejected, and why | From |
|---|---|---|---|---|
| L1 | Sequencing | Layers | By surface: cannot give one reviewable consent PR; the stepper precedes F6 | draft; rationale corrected by fable |
| L2 | F9 | Required field, real sender, heal inside `landed()` | Optional field: breaks the shared recovery format and the witness path | draft; placement by both audits |
| L3 | D3·B's rule | `showsDetail` + `explain`; the opening untouched | The board's blanket rule; moving the opening onto it (height jumps, byte count duplicated) | recon; codex 10, fable 20 |
| L4 | Consent storage | One persisted fact + session consent, in **its own record with a revocation counter** (`yacana.presto`), writes under the Locks API | A three-state enum with a silent adoption (the draft). A field of the settings blob: another tab's unrelated patch writes it back, and a merge-on-write is not atomic | fable 23; final codex pass round 2, 1 and 4 |
| L5 | Existing grantees | Click once | Silent adoption: undid "use the browser" on reload; `granted` is not consent to Presto | codex 2, fable 2 |
| L6 | What "remembered" needs | The first native proof of a build, **verified by the page** (`verifyWin`, winner or not), under current authorization | A shape check (the rework's choice): the flag would rest on unchecked bytes, and a late message could undo a revocation. The first verified win (round 1): hours on a hard network | final codex pass 1, 9; Ask A4 |
| L7 | Authority | One `consented()` gate over four places; `useBrowser` revokes all | Gating Start only | codex 1, 3; fable 1, 6 |
| L8 | Chart clock | `dispatch` stamps `t`; spans by transition | Per-call-site stamps; per-event span logic | codex 4, 5; fable 12 |
| L9 | Hover | Pointer-event resolution, keyboard stepping, shared geometry | rAF-driven (dead under reduced motion) | codex 14, fable 22 |
| L10 | Primitives' timing | `Tip`/`Popover` land with their consumers (P7) | In arc 1 with no consumer | fable 29 |
| L11 | Billboard | Kept, after a consented probe | Dropped; or no not-found row | owner |
| L12 | Revocation's reach | Immediate where clicked (a local latch before any lock wait), eventual origin-wide, page-local under failing storage: every tab's `consented()` reads the counter fresh; the `storage` event tears down what runs; the Worker gets its own immediate `revoke` | Page-scoped with a documented limit. "true → false" as the signal: silent when the value was already false. `reconfigure(null)` alone for the Worker: queued behind a proof whose witness has not left yet | final codex pass 10; round 2, 1 and 2 |
| L13 | Where P5 ends, and how it is cut | The machine **with** the rail's card and the replay test, in three green checkpoints (foundations unswitched; verification and the Worker's `revoke`; the switch with its button) | Machine alone, or "machine then card" as two commits: the first fails its own fast gate | final codex pass 3; round 2, 7 |
| L16 | Where the first proof is verified | Inside `PrestoWorkProver.prove()`, state on the instance | In `worker-mine.ts` / `onAttempt`: synchronous, sees no proof bytes, and a flag there resets per job | final codex pass round 2, 5 |
| L18 | How I2 is settled | Automated, on a real public → loopback boundary (`--ip-address-space-overrides`, empty-grant deny), Presto's own technique, in the replay lane | A manual headed-Chrome check by the owner (Ask A7, withdrawn): the two "headless cannot" findings it rested on were artefacts of a loopback-served test page | owner, 2026-09-21; Fact 19 |
| L17 | A permission query that is slow | No timeout: `pending` means no automatic probe; mining never waits | A 1 s cap → `unknown`: fails open, exactly the race it was meant to close | final codex pass round 2, 3 |
| L14 | Where loop fixes land | The earliest affected arc, then sync and rerun | The top arc by default: breaks the top-down revert for exactly the fixes that matter | final codex pass 8 |
| L15 | Old-origin row coverage | A component spec over a journal fixture + the build + `rig origin` | Seeding through the old origin's recovery import (it exists, Fact 18): a fabricated file and a second network boot to re-assert a string from a component with no origin-specific branch. A cost call, not an impossibility | final codex pass 4, corrected in its round 2 |

**Unresolved disagreements**: none. Round 1's "verified win only" and the rework's "shape check" were both
replaced by the final pass's alternative (L6); what stays accepted is named in Ask A4.

## 9. Audit verdicts

**Codex, round 1 (GPT-6 Astra, high): `reject` (blocking 1–3, 8).** Every factual claim was checked against the
code and held. Adopted: 1 (other places enable loopback → §3.1's table), 2 (adoption removed), 3 (revocation as
one operation, `gen`), 4–5 (timestamps, span identity → L8), 7 (`lnaState` fallback and the per-state policy), 8
(server-side evidence, a real-proving `chain` gate), 9 (`proof-inventory.ts`), 10 (the opening keeps its
mechanism), 11 (heal inside `landed()` before the early return), 12 (`OldApp`, `gallery`), 13 (`amount()`,
`mintedFresh`), 14 (hover), 15 (top-down rollback, P4 split into substeps, both chart consumers wired in P3, a
`web-miner` adapter hook). **Rejected**: 6's remedy (promotion only on a verified win) → L6; its sub-point (a
`found` standing) adopted.

**Fable, round 1: `conditional approve`** (conditions 1, 2, 3, 9, 12, 17 before implementation; 4, 5, 18, 20, 21
before arc 2; surface 16). Adopted: 1, 2, 3 (consent only through `settingsAtom`; later superseded by L4, consent leaves the settings blob altogether), 4 (I2's settling step, the
`grantPermissions` test, the non-enforcing-browser limit surfaced), 5, 6, 9 (`miner.e2e.ts` `placed()`, cockpit
in P7's gate — a recon miss: recon grepped `boundingBox`, the spec uses `getBoundingClientRect`), 10–11, 12, 13
(the child fix, not a clip), 14 (`Tip` owns its provider), 15, 16 (→ Asks A3–A5), 17 (the assertion lives in
`opening.e2e.ts`, `canary` in P2's gate), 18 (arc 1's gate runs `chain` and the rig's `origin`), 19 (no `Path2D`,
pure `calmTicks`), 20, 21, 22, 23 (one boolean), 24 (`lnaAtom`), 25, 26, 27, 28, 29. **Rejected**: none.

**Codex, final pass (fresh session, GPT-6 Astra, high): `reject` (blocking 1, 3)**, ten findings, each checked
against the code; all held. Adopted, all ten: 1 (a late `prover` message could undo a revocation → promotion and
publication need current authorization; `gen` monotonic; held-first-proof and Look → revoke → Look tests), 2 (the
TxProver born forced-local; "inert configuration" vs "permission to transmit"; the paused-transaction test; the
rule scoped to Presto, not to a user's loopback node), 3 (`App.tsx:140`; P5 takes the card and the replay test →
L13), 4 (string assertions in `bridge.e2e.ts`; the old origin's honest coverage → L15), 5 (Presto's install before
P1; `E2E_PROVERLESS=0` spelled out), 6 (`pending` is not `unknown`; `lnaReady`; the delayed-query test; I2's
evidence rules → Ask A7), 7 (`plotGeometry`'s real inputs, the frame snapshot, the sample fields populated in
`attempt()`), 8 (fixes in the earliest arc → L14; revalidation after the final sync; 3 failures, not 5; `gh stack
add` at P4/P6 only), 9 (the first native proof verified → L6; "no security gain" withdrawn; the availability
limit named in §4 and A4), 10 (origin-wide revocation → L12). **Rejected**: none. Its "looks fine" list confirmed
L8's transition wrapper, F9's placement, the stepper's consumers, settings outside React, and the real-proving
gate's validity.

**Codex, final pass, round 2 (same session): `reject` (blocking 1, 2).** Six of the ten resolved; seven new
findings, each checked against the code; all held. Adopted, all seven: 1 (consent moves out of the settings blob
into its own record with a revocation counter, writes under the Locks API; the false → false and interleaving
tests → L4, L12), 2 (the Worker's own immediate `revoke`, `authEpoch` against obsolete builds, `nativeAllowed()`
over `ready` and `presto-phase` too; the held-witness and held-build tests → L12), 3 (no timeout; mining stays
synchronous, which the revision had misstated → L17, Fact 17), 4 (a failed write makes memory authoritative for
the page's life), 5 (verification inside `prove()`, state on the instance, the loser / failed-loser / Stop /
resume tests → L16), 6 (the old origin **does** have an import path, Fact 18; component coverage kept, now for
its real reason, cost → L15), 7 (three green checkpoints → L13). **Rejected**: none.

**Codex, final pass, round 3 (same session): `conditional approve (with conditions: specify immediate local
revocation before lock acquisition, and document storage-failure and cross-realm propagation limits in §4/A5)`.**
All seven round-2 findings resolved but one partially; three Medium findings, all adopted: 1 (the `revoking`
latch and the local teardown before any lock wait; a Look ordered after a pending revoke; the held-lock test in
5c), 2 (failing storage makes consent and revocation page-local and non-persistent: §3.1, §4, A5; the two-session
demonstration in 5a), 3 (revocation is synchronous where clicked and eventual elsewhere, with a named propagation
window; "the next byte" withdrawn: §3.1, §4, A5). **Rejected**: none. A stricter cross-tab guarantee would need
transmission-time coordination between realms; not built, by decision: the browser's permission is the boundary,
this is the courtesy layer. Its "looks fine" list: fresh reads at those call sites, the realm separation, a
forced rebuild after `revoked`, and 5b's tests constraining the verification mechanics.

**Conditions met in this revision. The gate's codex requirement stands at `conditional approve`.**

**Owner, 2026-09-21: `conditional approve`** — every default accepted (A1–A6); A7 replaced: "can't you check
Presto's GitHub / tests? I think they already know how to correctly catch those errors." They do (Fact 19): the
manual check is gone, `lna.replay.ts` takes its place in P5c (L18). Not re-audited by codex: it adds a test on a
technique already running in Presto's CI and removes a manual step; it changes no design decision.

## 10. Post-implementation (self-contained — the implementing session executes this from here)

`code_review` is **off**: `/code-review` is not run at any point of this plan.

**Per arc, at its boundary** (after the arc's last gate is green, before `gh stack add`), scoped to the arc's diff
while it is the stack's tip:

1. **Codex audit**: `/codex high` with the arc's diff (`git diff <arc-base>...HEAD`), this `plan.md` with its
   ledger, the arc map ("this is arc N of 3; arc 2 builds the Presto consent machine and `PrestoCard`; arc 3
   composes the cockpit and the wallet on the chart's `spans` / `axisTitle` / `barCaption` props and adds `Tip`,
   `Popover`"), so seams kept for later arcs are not called dead code, and these three asks verbatim:
   - *"What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
     supply-chain / crypto / least-privilege weaknesses?"*
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
     configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code
     works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does,
     restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence
     works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have.
     Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense,
     and exact."*
2. **Fix loop**: check each finding against the code before acting (codex misreads code sometimes); apply what is
   accepted; commit; log the round (findings, accepted, rejected with the reason) in `lessons/phase-N.md`; **resume
   the same codex session** with the fix diff and the same three asks. Repeat until a round brings nothing
   material (rejected nitpicks are not churn). Material findings still arriving after **3 rounds**: stop and bring
   it to the owner.
3. After **all three arcs**: the **cross-arc pass**, a **fresh** codex session over `git diff main...HEAD` asking
   for the seams between arcs, duplication across arcs and drift from this plan, with the same two verbatim rules;
   same loop until clean. **A correctness or security fix lands in the earliest arc it affects** (`gh stack down`
   to that branch, fix, commit, `gh stack sync`), then that arc's gate and every higher arc's gate it can touch
   are rerun: a consent fix parked on arc 3 would vanish with a revert of arc 3 and leave arc 2 defective. Only
   cosmetic or seam-only fixes may stay on the top arc.
4. **Delivery** — the first time any PR exists: `gh stack sync` if `main` moved, **and if the sync changed
   anything, the fast layers plus the shards of the arcs it touched are rerun before submitting**;
   `gh stack submit --auto`, `gh pr edit` each PR's body (what it ships, the boards' link, the gates that passed,
   no local paths), then `gh pr checks --watch` on each.
   Never merge.
5. **Closing, in the delivery PR**: an `## Outcome` block right after this file's front matter (date, status, what
   shipped with PR numbers, what was dropped, one line retiring the seeds below); promote what would bite a
   different task into `implementations-plan/lessons.md` (one line each, pruned against what is there); move open
   follow-ups into `implementations-plan/follow-ups.md` (already known: `web-stats`' `Term` onto `Tip`; the
   ignore-rule migration if A1 stayed "no"; sampling later native proofs against a Presto that turns dishonest). **After the owner merges**: `git mv` this folder under `archive/` in
   its own commit, fix links, move the `index.md` line.

Dispositions for an unattended session: never idle waiting for the owner; when stuck or facing a decision that
would normally go to them, consult `/codex high`, act on the stronger argument, log it in lessons; the same step
failing **3 times** means stop retrying and reassess with codex (the owner's rule); `gh stack add` happens at P4
and P6 only (arc 3 is the top); never merge, deploy, publish, or widen scope past this file.

## Seeds (final, 2026-09-21)

ELI5 companion: https://claude.ai/artifact/JQUGc2kx8UQxkxKiyrtC65, published from
`implementations-plan/yacana-feedback-pass/eli5.html` (local-only source; republishing that path from the
publishing session keeps the URL, any other session passes the URL). Boards:
https://claude.ai/artifact/5wCXNSRNTvwQBDKaWBTYt5 (`boards.html` beside this file).

Run inside this plan's worktree (`agent-worktree resume yacana-feedback-pass`). Use exactly one.

```
/goal All eight phases marked ✓ in implementations-plan/yacana-feedback-pass/plan.md (the phase headers in the file, not the chat), each ✓ backed by its validation gate as written in §6 reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/yacana-feedback-pass/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged for each of the three arcs at its boundary and for the cross-arc pass, each evidenced by a resumed codex round reporting no new material findings, quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run lint && bun test` and `bun run lint:actions` report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/yacana-feedback-pass forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/yacana-feedback-pass/plan.md and lessons/ (authoritative, not the chat). If that path is gone, look under implementations-plan/archive/: the plan closed, STOP. If plan.md has an `## Outcome` block, STOP. Task list empty? Rebuild it from plan.md's phase headers. `git status`, `git log --oneline -5`, `gh stack view`.
2. No task in hand? Take the next pending step of the current phase. After each meaningful edit run the fast layers of §6. Commit (conventional, signed), `gh stack push`.
3. Stuck, or a decision you'd bring to me? `/codex high` with full context, act on the stronger argument, log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, deploy, publish, or widen scope past plan.md.
4. Same step failed 3 times? Stop retrying; reassess with codex.
5. Phase green = its §6 gate passes as written. Run it, paste the result, mark ✓ in plan.md, write the lessons entry, print `LESSONS_FILE=implementations-plan/yacana-feedback-pass/lessons/phase-N.md`, `agent-worktree status yacana-feedback-pass "phase N green: <next>"`. Arc boundary (P4, P6, P8)? Run §10 steps 1–2 on the arc's diff FIRST; after P4 and P6 only, then `gh stack add <next-branch>` (§7; P8 is the top, nothing to add). No /code-review: it is off.
6. All phases ✓ and all three arc loops converged? §10 step 3 (fresh cross-arc codex pass), then step 4 (the first PRs: `gh stack submit --auto`, bodies, `gh pr checks --watch`), then step 5's Outcome block, then a wrap-up: what shipped, every decision debated with codex in plain words, open items. Surface and stop.
```
