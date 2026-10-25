# ci-1 phase 3

## Workers Builds red on #75 and #76 (orchestrator note: reproduce the build, find whether the diff causes it)
- `Workers Builds: yacana` failed on #75 (91aa11f) and on the evidence PR #76; the check run carries only a
  dashboard link, and Cloudflare stamps `started_at == completed_at` on successes too, so duration says nothing.
- The check-run rerequest API answers 404 to a user token (only the creating app may rerequest).
- Reproduced the build step locally at 91aa11f: `bun install --frozen-lockfile && bun run site:build` exit 0;
  `bun run site:wrangler versions upload --dry-run` exit 0; 653 files, none over 20 MB.
- Bisect: pushed a probe branch at main's head 513bd01, which Cloudflare built green on 2026-09-30; its
  non-production build fails too (738d6190), then the probe branch was deleted. The diff is not the cause; the
  Cloudflare build logs (dashboard, the owner's login) hold it.

## ask1's Check (draft PR #76, based on the arc branch, closed unmerged)
- b8dfbff, a comment in `tools/harness/src/user.ts`: 13 statuses green; `rig` and miner-core's ungated job ran,
  the 13 other gated jobs skipped.
- eeec42e, a CI-only throw at the top of the flip case: `harness-status` red (`rig: failure, expected success`).
- de6d243, the throw removed, the run cancelled while `rig` ran: the status job still ran and concluded `failure`
  (`rig: cancelled, expected success`).
- `gh run rerun --failed` on that run: attempt 2 reran the cancelled `rig` and `harness-status`, both green, with
  `changes` kept from attempt 1.
