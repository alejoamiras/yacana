# ci-1 phase 0: planning consults

## Recon (2026-10-25)
- One Sonnet reuse sweep (reuse map in `recon.md`) and one docs fetch for four GitHub Actions facts (the
  branch-protection troubleshooting page now returns 404; the four facts came from the workflow-syntax, conditions,
  expressions and contexts pages).
- The lane brief's claim "no PR workflow has a workflow-level paths filter" did not hold: actionlint has
  `paths: ['.github/**']`.

## Codex r1 (gpt-6.1-sol, high, read-only) — conditional approve
- Accepted all eight findings: `[skip ci]` and invalid YAML as fail-closed platform limits (F9); cancellation
  qualified (a cancelled status job blocks, no promise of `failure`); F5 qualified (dispatch forces `true` only when
  the filter step succeeds); rerun and cancel evidence added to P3; G2 made exact (no `continue-on-error`, no step
  `if:`, the exact `toJSON(needs)` input); P1 gained invalid-`relevant` and unknown-result rows; actionlint move
  recorded as a narrow exception with the 300-file caveat; P3 commits must pass lint and typecheck.
- Codex agreed on TypeScript in `scripts/`, the `install` input on `setup-bun`, a plain shallow checkout, and G3's
  inferred gating over an explicit list.

## Codex final (gpt-6.1-sol, high, fresh session) — conditional approve → approve
- Three conditions, all accepted: G3 rejects job-level `continue-on-error` on covered jobs (it reports `success`
  on failure, actions/toolkit#581); G2 pins the status action's verdict wiring, scoped to that action so setup-bun's
  conditional install stays legal; P3.6 reruns `rig` by job id when `--failed` skips a cancelled job, and I3 is
  promoted only on observed reruns.
- Resumed verification: `approve`, no regression.
