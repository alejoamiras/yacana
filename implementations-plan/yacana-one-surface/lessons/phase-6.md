# P6 · The landing and the flywheel — lessons

## What changed
- `apps/web-landing/src/copy.ts`, `faq-copy.ts`: every `Landing-Copy` row, word for word (the canvas text in
  `canvas/copy.md`), with the reassurance line the owner approved (no gas clause); the numbers still come from
  `PARAMS`. The bar's and the hero's button read "Open the miner" (the landing's own label for that link); the
  network badge stays. The new FAQ question sits under "How is it mined?" in the Mining section; nothing links to
  it, so it lives in `faq-copy.ts` rather than among the linked questions.
- `sections/Why.tsx` (`why`, between How and Verify, in `SECTIONS`, the bar's anchors and `App.tsx`): from `md` up the
  `Fly-A` ring — the circle and four arcs as SVG with path arrowheads on token classes (no `<marker>`, whose fill
  cannot take a class), the four steps as HTML boxes centred on the ring in percent so their prose wraps as the ring
  scales; `role="img"` with a label naming the four steps in ring order, and the centre sentence drawn over it but
  outside the image, so a screen reader still reads it (an image's children are presentational); below `md` the
  same steps as How's numbered list, the sentence under them. Its own test id (`why-loop`): the FAQ's specs count `rule-diagram`.
- `HeroLive.tsx`: the KPI "difficulty", "N wins · by browsers"; `BarChart.tsx`: its label says difficulty and wins.
- `index.html`'s meta description repeats the subhead, so it follows it ("private from everyone").
- `apps/web-miner/src/features/PreflightTile.tsx`: no download size (the live "13.0 of 20 MB" progress stays, owner
  2026-09-23).

## Gate
- Fast layers on the working tree (P5 + P6): lint 0 · `bun test` 0 (633 pass, 44 skip) · typecheck 0 ·
  `test:components` 0 (ui 87, landing 15 with the `Why` spec, stats 84, miner 154) · replay 0 (9 passed).
- The `Why` spec: the four steps in ring order (the boxes and the label), the ring from `md` up and the list below
  it, the centre sentence outside the image, no `rule-diagram` on the landing. Its first draft read the classes
  as one string (`hidden md:block`); Biome's class order is not the author's, so it reads the class list.
- `grep -rn "20 MB"` and `grep -rn "no gas"` over `copy.ts`, `faq-copy.ts` and `index.html`: nothing. "testnet" in
  `copy.ts` only in two code comments; the bar and the hero say "Open the miner". The reassurance line is the
  approved text. `external-link-arrows.bun.test.ts` 1 pass.
- Landing e2e on 58a81d1: 5/5 (49 s) — `why` between How and Verify, the ring shown and the list hidden at 1280,
  the list shown and the ring hidden on a phone, the bar's anchors with "Why", the bar's button "Open the miner".
- Screenshots of the section from a production build at 1440, 1280, 1024, 768 and 390: the ring as drawn, the
  list on a phone. At `xl` the ring gets 620 px (the page is 1120 wide; the canvas drew it at 700 beside a 440 px
  column), and the centre sentence at the canvas's 34 % touched the side boxes; at 30 % it clears them by about
  13 px at 620 and 15 px at 696.

## Codex (arc 3)
Session `01a0d029-9adb-7711-9235-db5c06eeccc3`, effort `high`, over `04d531b..58a81d1`.

**Round 1** — "no new material findings", four minors; each checked against the code and fixed:
1. A dismissal in another tab left this one's strip up (the derived atom caches its read; storage is not a
   dependency), so it came back on the way back to Mine: `useIntroEnds` latches a valid `storage` event for
   the key. Spec: a foreign value leaves the strip, `{ dismissed: true }` puts it away.
2. From `md` up the ring is an image and the list is hidden, and the ring's label named the steps without
   their bodies: the label now reads every step whole, built from the steps the ring and the list draw; the
   spec checks name, title and body in ring order (it compared the label with itself before).
3. The strip, a notice and the upgrade card together (the fourth row template) had no test: a spec renders
   all three.
4. Two narrating comments deleted (`IntroStrip`'s head, `HOW_HREF`'s doc); `Why`'s head cut to its constraint.

**Round 2** (resumed) on a8c3526 — **"no new material findings"** (converged). Codex checked each fix: the
listener validates the key and the value and removes exactly what it added; a storage event never reaches the
document that wrote it, so a dismissal cannot loop between tabs; the label and the list read the same steps; the
fourth template has a spec (a class check, not the browser's placement). One minor taken: the page behaviour's
header comment listed what the hooks' names already say (d6ae3d7).

## Arc 3 gate (2026-09-23)
- On 58a81d1 (P5 + P6): the fast layers as above; landing e2e 5/5 (49 s); the miner's shards cockpit 8/8
  (5.7 m), chain 14/14 (10.7 m), bridge 1/1 (4.0 m), canary 5/5 (6.0 m, real proving).
- On the fix head d6ae3d7 (codex's minors; the landing's files as of e75a2a6): `bun run lint` 0, `bun test` 0
  (633 pass, 44 skip), `bun run typecheck` 0, `bun run test:components` 0 (miner 156, landing 15) on a8c3526 (the
  last commit only deletes a comment); landing e2e 5/5 (49 s); cockpit 8/8 (5.7 m); replay 9/9 (1.2 m).
