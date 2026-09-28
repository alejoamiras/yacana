# P3 · Presto, the mini window, Start, the recovery line — lessons

## What changed
- `prestoDecides(state, record, lna)` in `presto.ts`: the standing is found, remembered or proving. Mining only
  tells found from proving, so it is not an input (computed at `mining = false`, where proving reads as found).
  `PrestoView.native` → `decides`; the rail hides the slider, Settings locks it, and `[` `]` read the same predicate
  (the hotkeys now take the page's `Consent`). The found line: "proves when you start · its own speed setting decides".
- The mini window belongs to the shell: `pipWindowAtom`, `openPip(store)` (gated on `userActivation.isActive`,
  one pending request shared, a refusal or missing API resolves to `null`), `PipHost` mounted once in `App` (renders
  `PipView` into whatever window the atom holds; `pagehide` clears it). Pop out is always shown where supported and
  disabled while a window is open. `PIP_SIZE` 360 × 216, footer in two wrapping rows.
- `useStartClick(onStart)`: signed in, the window first when `pipOnStart` is on, then mining; signed out, intent +
  sign-in + the probe, as before. The keys and the resume on open still call `onStart`.
- Setting `pipOnStart` (default off) replaces `pip`; the old key drops on parse. Row: "Open the mini window when
  mining starts", hint "your Start click opens it; browsers don't let a page open it when you switch tabs".
- The recovery line: "save a recovery file · restore from a file · N crossings saved" (no "advanced ·").

## Facts
- Headless Playwright opens the Document PiP window as a page with the context's viewport (1280 wide): the e2e sets
  the PiP page to 360 × 216 before measuring, which is what a headed browser gives for `requestWindow(PIP_SIZE)`.
- Measured: the window 360, the document 360, both footer rows 336 (the 12 px padding each side), right edges 348.
- `PrestoStatus`'s unavailable reasons are `error | offline | secure-connection-unavailable | version-mismatch |
  permission-blocked`, without `protocol`; the bun test's `as unknown as` cast hid that.
- A fresh worktree has no `protocol/contracts/target`: the browser suites need `bun run codegen`,
  `bun run contracts:compile` (and `portal:build` for the bridge shard) first, as CI does. Codegen left the tree
  unchanged.
- The e2e title changed, so `e2e-breakdown.bun.test.ts`'s zero-floor example now uses the prover-crash title.

## Gate (2026-09-23)
- Fast layers: lint 0 · `bun test` 0 (588 pass, 42 skip) · typecheck 0 · `test:components` 0 (miner 140 incl.
  the new `pip-host.vitest.tsx`, the found → absent cases in `presto-indicator` and `settings`, the `[` spec) ·
  replay 0 (9 passed). `presto-standing.bun.test.ts`: the `prestoDecides` table (found, remembered, proving true;
  absent, checking, consent revoked, permission denied, the WASM fallback false). `settings.test.ts`: `pipOnStart`
  off by default, the old `pip` dropped.
- `E2E_PROVERLESS=1 … test:e2e -- e2e/miner.e2e.ts --grep "the mini window"`: 1 passed (Pop out with the page
  fonts; two rows inside 360 px; open across /mine → /mine/wallet → /mine; with the setting on, Start opens it and
  mines, Stop from the window; with `requestWindow` refused, Start still mines).

## Arc 1 gate (2026-09-23, on 26ebfa4)
- Fast layers as above. Miner shards: cockpit 7/7, chain 12/12 (Presto headless beside it), bridge 1/1, canary 4/4
  on real proving (the tampered claim refused at proving, then minted; 6.5 min). Stats: `test:e2e` 0,
  `test:visual` 0 on the eight regenerated baselines.
- A shard's build and the replay lane both write `apps/web-miner/test-results`: the replay lane (Playwright
  wipes its output dir at start) must never run while a miner shard does; sources may change once a shard's
  tests are running (they serve a finished build).

## Codex, arc 1 (GPT-6 Astra, high; session 01a0cf70-8a8f-7481-92b0-353be148fa38)
Round 1 on 26ebfa4 — "Material findings remain". All six verified against the code:
1. material, fixed — the mini window's Start called `onStart` directly: signed out (Pop out is now always offered)
   it only probed Presto. Now `useStartClick`, disabled while an account opens; a spec clicks it signed out.
2. material, fixed — `pagehide` was attached by `PipHost`'s passive effect after the atom was set: a close in
   between left a dead window in the atom. `openPip` now attaches it (with the theme observer) before publishing,
   refuses a window already closed and drops a closed one it finds in the atom; specs for both.
3. minor, fixed — the window kept the theme it opened with; now a MutationObserver carries the class over.
4. minor, fixed — plan §3.1 says the next difficulty goes through `difficultyLabel`; `words.ts` wrote
   `toFixed(1)`. `@yacana/ui` exports its pure `score-loop-model` so `words.ts` (and through it the reducer) stays
   free of React; the rail, the KPI and the window's footer take the same label.
5. minor, fixed — the dormant `Marks` chip said "claims".
6. minor, fixed — the hotkeys comment claimed a key cannot grant activation (it can: keydown is an
   activation-triggering event); now it states the policy. `use-start-click.ts`'s paragraph cut to its constraint;
   `words.ts`'s name-restating comment removed.
Fast layers on c62512a: lint 0, `bun test` 0 (589 pass), typecheck 0, components 0 (miner 144).
Round 2 on c62512a — **"no new material findings"** (converged). One minor, fixed: the spec's iframes and their
theme observers outlived each test, and the theme case passed with `theme.disconnect()` deleted; the frames now close
(pagehide) and leave after each test, and the case asserts the class stops following after the close (checked: it
fails with the disconnect removed). Codex also confirmed `{ once: true }` on the window's own `pagehide` (the opener's
navigation closes the window per the Document PiP spec) and the new export against `scripts/boundaries.test.ts`.
