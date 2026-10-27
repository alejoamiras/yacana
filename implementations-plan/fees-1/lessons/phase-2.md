# fees-1 · phase 2 (a1: the provider, the mock, the machine, the runner)

- 2026-10-27 the machine keeps the trade's steps as an array in the quote's order rather than a record by phase:
  every view walks them in order, and a direct route has no swap entry to skip. §4 now says so.
- 2026-10-27 three events joined the §4 list: `started` (the runner stamps `since`, and `next` stops naming a step
  already started), `quoteFailed` (the quote state carries an `error` line) and `lapse` (a shown quote ran out; its
  `id` keeps a stale timer from dropping the quote that replaced it).
- 2026-10-27 gate: lint 0, typecheck 0, web-miner Vitest 165 pass, bun test 5 pass. Removing the step abort from the
  runner's `cancel` failed the runner case on `signal.aborted`; restored.
