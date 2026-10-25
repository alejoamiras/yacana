# site-1 lessons, phase 1 (the probes)

Every probe was a commit on `origin/main` (`513bd01`), pushed as its own branch with the real build and deploy commands, read by the conclusion of `Workers Builds: yacana`. Each branch was deleted after its reading.

| Probe | Change | SHA | Conclusion | Check suite (UTC) |
|---|---|---|---|---|
| Q0 control | empty commit | `7b07a65` | failure | 16:25:11 → 16:25:19 (build `40591265…`) |
| Q1 | `packageManager` and setup-bun → 1.4.2 | `3a0dc23` | failure | 16:25:39 → 16:25:48 |
| Q3 | no `engines` (pins 1.4.0) | `9d3f306` | failure | 16:26:08 → 16:26:16 |
| Q4 | 1.4.2 pins and no `engines` | `f8a370d` | failure | 16:26:33 → 16:26:41 |
| Q2 | no `packageManager`, no `engines` | `34f2b8b` | failure | 16:26:59 → 16:27:07 (build `3a892308…`) |

- 2026-10-25 · Outcome **H**: no tool-field change turns the build green; every build dies 8–9 s after it opens, whatever the manifest says. This establishes neither I2 nor the failing stage. Root cause: unknown until the owner reads the log.
- 2026-10-25 · Consult: Codex `gpt-6.1-sol` high, session `01a173da` (resumed): an orphan-tree probe (no history, a no-op deploy) would change the next action too little, because its green would bypass build and deploy together and its red stays inconclusive. Stop at H, hand off the log. Adopted: the lane stops.
- 2026-10-25 · A Workers Builds failure that is independent of the tree is cheap to show: five probes in under three minutes, each red within 10 s. Run the paired probes before planning any toolchain move.
