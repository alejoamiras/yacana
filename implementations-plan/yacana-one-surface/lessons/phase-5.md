# P5 · The intro strip — lessons

## What changed
- `apps/web-miner/src/intro.ts`: `yacana.intro` holds `{ dismissed: true }`; `parseIntro` accepts nothing else, a
  storage that throws reads as "not dismissed" and a write that throws dismisses for the page only
  (`introAtom`'s in-memory flag).
- `features/IntroStrip.tsx`: the `Cold-Strip` copy (reward and symbol from `PARAMS`), Start mining through
  `useStartClick` (the cockpit's refusals and the signed-out sign-in with its intent), "How it works ↗" to the
  landing's `/#how` in a new tab (`noopener noreferrer`, the arrow `aria-hidden`, "(opens in a new tab)" for screen
  readers), a × (`aria-label="Dismiss"`).
- `routes/Mine.tsx`: the strip is the cockpit's first child across every column, joins the `above` count, and
  `ROWS` gains the fourth template (strip + notice + upgrade card + the slack row).
- `useIntroEnds` (in `use-page-behaviour.ts`, mounted by `App`): the first `mining` phase puts the strip away for
  good, whichever page or control started it (the cockpit, the strip, Space, a resume on open, the mini window).

## Gate
- Fast layers on the working tree: lint 0 · typecheck 0 · `test:components` 0 (ui 87, landing 14, stats 84, miner
  154 with `intro-strip.vitest.tsx`'s six) · replay 0 (9 passed, the strip on every signed-out page) · `bun test`
  631 pass, 2 fail, both guards doing their job: `scripts/layout.test.ts` refuses a project file the index does
  not track (the three new files, staged before the rerun) and `e2e-inventory.bun.test.ts` counts the suite's
  titles (the strip's title is the new addition). Rerun of both: 24 pass.
- The spec's harness mounts `useIntroEnds` itself, so it could not see `App` forget the hook: the cockpit shard's
  power test now asserts the strip is up after the account opens and gone once mining runs, on the real session.
- Cockpit shard on c6992ef: 8/8 (5.4 min) — the strip's title (shown, put away by its ×, still away after a
  reload), the first test with the strip dismissed before its layout checks, the power test's strip assertions.
