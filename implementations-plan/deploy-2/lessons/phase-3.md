# deploy-2 phase 3: the pause limit, and the arc gate

- Dedupe: `gh issue list --state all --search "pause unpause same block"` and `--search "pause in:title"`: none.
- Filed #90 ("a pause and an unpause in one block hold a version's exits at no pause budget"), label `known-limit`,
  with the full Foundry reproducer; closed as not planned at once. `gh issue view 90`: CLOSED, NOT_PLANNED,
  `known-limit`.
- Linked from `docs/bridge.md` (the pause bullet and a paragraph in § The operators) and `docs/threat-model.md`'s
  bound row, with the full issue URL as `docs/roadmap.md` links upstream issues. `git diff origin/main -- protocol`
  is empty.
- Arc gate: `bun run lint` 0; `bun run typecheck` 0; root `bun test` first run 1 fail, `vk-pinning.test.ts`
  ("command not found: aztec-nargo", the documented PATH gap), rerun with `~/.aztec/versions/6.0.0/bin` and its
  `node_modules/.bin` on PATH → 709 pass, 44 skip, 0 fail (169 s); `bun run test:components` 0 (349 tests).
- `bun run rig -- skip-version`: the first run failed in 107 s on a missing `protocol/work-circuit/target/
  yacana_work.json` (a fresh worktree; CI runs `bun run codegen` first). After `bun run codegen` (no tree diff),
  `contracts:compile` and `portal:build`: 1 pass in 266 s (estimated 5 min), the `'node-only'` continuation
  deployed and the send-ahead forwarded into it.
- Codex fix loop: r1 clean; Opus (same family) 3 low, fixed in cbfcc9c; r2 (resumed) clean.
