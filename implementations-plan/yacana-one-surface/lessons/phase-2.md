# P2 · One word: difficulty — lessons

## What changed
- `apps/web-miner/src/lib/words.ts` owns the miner's difficulty sentences: the epoch tips (the difficulty tip carries
  the live number, "At difficulty 64.0, about one proof in 64 wins."), the next difficulty ("147.8 (×2.31)"), the
  chart's popover as [before, bold, after] triples, the line caption, the empty caption, the signed-out KPI sub, the
  ledger's epoch line (shared by the reducer and the ledger's first line) and the mini window's tip.
- Rail rows: difficulty · expected epoch time · next difficulty, if closed now. KPI: best difficulty this epoch.
- `packages/ui`: the hover card ("#128 · reached 23.4 · below the difficulty"), the retarget mark
  ("epoch 23 · difficulty 12.3 → 48.6"), the default caption ("difficulty 64.0 · reach it and you win"), the aria
  label (no "score loop"), the grid rendering's labels, `proof-line`'s "reached". `PipView` passes its caption.
- Stats: every reader-facing count says "wins" (table head and its "4th win", the detail's KPI and badge, the
  open-epoch and minted units, "wins / hour", "since you opened", the difficulty chart's tip, `sentence()`, which also
  says "faster than the difficulty assumed"). Test ids, the CSV/JSON `claims` keys and the bridge's "claimed" (a
  different act) stay.

## Decisions
- The miner formats difficulty with `toFixed(1)` in `words.ts` (as it always has) rather than importing
  `difficultyLabel` from `@yacana/ui`: `words.ts` is imported by the pure reducer, and the two agree below 1e6.
- Without odds (difficulty < 1.5) the tip falls back to "At difficulty D, about one proof in D wins." and the pop-out
  tip to "How hard a win is right now."
- The axis title stays a prop without a default: a default would give every roomy calm loop a title column.

## Facts
- `scripts/layout.test.ts` compares tsconfig roots with `git ls-files`: a new, unstaged `.ts` file fails it
  ("every tracked TypeScript file…"). Stage new files before the fast layers.
- No image tools on this machine; `sharp` from the repo's `node_modules` (`dist/index.cjs`) diffs baselines
  (scratch script: changed-row bands, before/after crops).

## Gate (2026-09-23)
- Fast layers: lint 0 · `bun test` 0 (586 pass, 42 skip, 0 fail) · typecheck 0 · `test:components` 0 (ui 87,
  landing 14, stats 84, miner 132) · replay 0 (9 passed).
- Grep over `apps/web-miner/src` and `packages/ui/src` (string literals and JSX text, tests and comments excluded):
  no "score", "the bar", "target length", "clear it", "next bar"; what remains is type fields and identifiers.
- `test:visual -- --update-snapshots` in `mcr.microsoft.com/playwright:v1.62.1-noble`: 8 regenerated; each diff
  inspected: bridge ×4 = the header's Lucide glyphs only (298 px, rows 18–31); stats ×4 = the glyphs plus
  claims → wins (KPI units and labels, "wins / hour", the sentence re-wrapping, the table head and "4th win", the phone
  table's columns reflowing around the shorter head). Then `test:visual` 8 passed.
