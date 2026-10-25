---
plan: ci-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
budget: "recon 1 Sonnet agent + 1 docs fetch; codex at high (gpt-6.1-sol); code-review off"
hardening: not scheduled
status: drafted 2026-10-25; codex r1 → conditional approve, folded; final fresh pass → conditional approve, folded → approve; awaiting the orchestrator
created: 2026-10-25
---

# ci-1: one status check per pull-request workflow

No check on `main` always appears and concludes: a gated job that is skipped reports "Success", and a workflow
skipped by its path filter reports nothing. This plan gives each of the 13 pull-request workflows one job,
`<workflow>-status`, that always runs, needs every other job, and runs one shared verdict. The orchestrator then
makes those 13 names the required checks. Recon: `recon.md`.

## Scope

- **In**: `scripts/ci-status.ts` (the verdict) and its test; `.github/actions/status`; an `install` input on
  `.github/actions/setup-bun`; a `status` job in the 13 workflows; actionlint's filter moved from the workflow into a
  `changes` job; guard tests G1–G3 in `scripts/layout.test.ts`; one `CLAUDE.md` line; GitHub evidence for ask1's Check.
- **Out** (lane brief): branch protection and rulesets (no call to that API); `e2e.yml` and other non-PR workflows;
  which jobs run, their globs, runners or timeouts (one narrow exception, F2); new test jobs; `follow-ups.md`.
- **Issues**: none. **Asks**: ask1 → arc a1.

## UI impact

- ask1: Give every pull-request workflow one aggregate status job, `<workflow>-status`, that always runs and needs
  every other job in its workflow. It fails unless each gated job ended `success` where the change filter marked it
  relevant and `skipped` where it did not, an exact state machine, so a cancelled, failed or never-started job
  fails it. Those status jobs become the required checks on main. Check: a PR touching one package shows every
  status green with only that package's jobs run, and a deliberately failing job turns its workflow's status red.
  — Nothing a person sees in the product changes. UI impact: none. `OWNER-ASKS.md`: none.

## Outcome & Quality Bar

- **For whom**: the owner and the orchestrator merging PRs, and the next maintainer who adds a job.
- **Excellent**: (1) A required check never reads green while a job it covers failed, was cancelled or never ran,
  and the guard fails when a job is missing from its workflow's `status.needs`. (2) The verdict is one tested
  function; a red status prints each job's result next to the result it expected.
- **Good enough**: no step summary, no annotations, no merge-queue (`merge_group`) trigger.

## Assumptions

**Facts** (citations in recon.md)
- F1. 13 workflows run on `pull_request`; every gated job's `if:` is exactly `needs.changes.outputs.relevant ==
  'true'`; miner-core has no `changes` job and one ungated job; no `concurrency:` key exists.
- F2. **Did not hold**: actionlint has a workflow-level `paths: ['.github/**']`, and GitHub leaves a path-skipped
  workflow's checks "Pending", blocking a PR that requires them. Narrow exception to "no filter changes": the same
  glob moves into a `changes` job. The same jobs run, except on diffs over 300 files, where dorny lists more files
  than GitHub's native filter reads.
- F3. A job skipped by `if:` reports "Success" even when required, so the status job is never skippable: `if:
  always()` (true even when the run is cancelled), never `!cancelled()`. If cancellation stops the status job
  itself, it concludes `cancelled`, which still blocks; the plan does not promise `failure` in that case.
- F4. `needs.<job>.result` ∈ {`success`, `failure`, `cancelled`, `skipped`}; `needs` holds direct dependencies only.
- F5. On a dispatch whose filter step succeeds, `_changes.yml` forces `relevant=true`; if the filter fails, the
  override is skipped, `changes` fails, and the verdict fails.
- F6. Every filter watches its own workflow file and `.github/actions/**`, so this PR runs every gated job.
- F7. TypeScript under `.github/` belongs to no tsc project and fails the layout guard; `scripts/*.ts` is
  typechecked and linted, and miner-core runs `scripts/` tests on every PR.
- F8. `setup-bun` always runs `bun install --frozen-lockfile`; the verdict needs no dependency.
- F9. Platform limits, fail-closed: a `[skip ci]` head commit or an invalid workflow file yields no status check, so
  the PR stays blocked until a push fixes it. Disposition: documented in the `CLAUDE.md` line, nothing built.

**Inferences**
- I1. `toJSON(needs)` carries a reusable-workflow job's `outputs.relevant` (documented). This PR's run proves it:
  without it every status fails.
- I2. dorny emits exactly `'false'` when nothing matches (its pinned `src/main.ts`); P3 proves it on GitHub.
- I3. A partial rerun re-runs the job's dependents (GitHub's partial re-runs post), so the status re-evaluates; P3
  proves it.

**Asks** (unattended: working assumption, then proceed)
- A1. P3 opens one draft PR based on the arc branch, never on `main`, and closes it unmerged. Working
  assumption: allowed, because it is ask1's own Check and nothing else shows the not-relevant path on GitHub.

## Architecture & Implementation

- **Verdict** `scripts/ci-status.ts`: `verdict(needs: Record<string, { result: string; outputs?: Record<string,
  string> }>): { ok: boolean; lines: string[] }`. `relevant` is `needs.changes.outputs.relevant` when `changes` is
  needed, else `'true'`. A job expects `success` when it is `changes` or `relevant === 'true'`, `skipped` when
  `relevant === 'false'`, and nothing otherwise (a filter that never concluded fails every line). Empty `needs`
  fails. The entry (`import.meta.main`) parses `process.env.NEEDS`, prints `<job>: <result>, expected <want>` per
  job and exits 1 on any mismatch; a missing or invalid `NEEDS` exits non-zero.
- **Action** `.github/actions/status/action.yml`: input `needs`; steps `./.github/actions/setup-bun` with
  `install: 'false'`, then `bun scripts/ci-status.ts` with `NEEDS: ${{ inputs.needs }}` in `env` (never inlined in
  `run:`). `setup-bun` gains `install` (default `'true'`, step `if: inputs.install == 'true'`; callers unchanged).
- **Status job** (each workflow): id `status`, `name: <file stem>-status`, `needs:` every other job id,
  `if: always()`, `runs-on: ubuntu-latest`, `timeout-minutes: 5`; steps: the pinned `actions/checkout` (shallow),
  then `uses: ./.github/actions/status` with `needs: ${{ toJSON(needs) }}`. Workflow-level `contents: read` only.
- **Guard** (`scripts/layout.test.ts`, `describe('workflows')`; jobs keep their ids):
  - G1: a PR workflow's `on.pull_request` is empty (no paths or branches filter).
  - G2: each PR workflow has job `status` with that exact name, `if: always()`, `needs` equal as a set to every
    other job id, no `continue-on-error`, and exactly the two steps above with no step `if:` and `with.needs`
    exactly `${{ toJSON(needs) }}`; the status action's own steps are exactly `./.github/actions/setup-bun` with
    `install: 'false'` and `run: bun scripts/ci-status.ts` with `env.NEEDS: ${{ inputs.needs }}`, with no `if:` or
    `continue-on-error`; no other job in any workflow shares a status name.
  - G3: the reading the verdict relies on. With a `changes` job, every other non-status job has
    `if: CHANGES_GATE` and needs `changes`; without one, no non-status job has an `if:`. No covered job sets
    job-level `continue-on-error` (it turns a failure into `success`; miner-core's step-level audit stays).
- **Change map**: add `scripts/ci-status.ts`, `scripts/ci-status.test.ts`, `.github/actions/status/action.yml`;
  modify `.github/actions/setup-bun/action.yml`, the 13 workflows, `scripts/layout.test.ts`, `CLAUDE.md`.
- **Alternatives not taken**: a reusable workflow names its check `status / <job>`, not a bare name; bash + jq
  avoids Bun on the runner but leaves the verdict outside biome and tsc; an explicit `gated` list per workflow
  repeats each job's `if:` (G3 pins the one reading); a second `oven-sh/setup-bun` pin drifts; a sparse checkout adds
  configuration in 13 places for no measured gain.

## Security & Adversarial Considerations

- **Threat model**: a PR author, fork included, controls the workflow, action and script text that runs on their
  PR, so they can make their own status pass (or add a same-named job in a new workflow, which G2 flags unless the
  guard is edited too). Required checks gate accidents; review gates intent.
- **Least privilege**: the status job inherits `contents: read`, gets no secret and no wider token scope.
- **Injection**: `toJSON(needs)` reaches the script through `env`; the outputs come from our own filter.
- **Spoofing**: pinning the required checks' source app is the orchestrator's protection setting (reported here,
  not done); it does not stop a same-repository workflow, which is the review boundary above.
- **Supply chain**: no new third-party action or npm package; the existing checkout and setup-bun SHA pins.
- Crypto, frontend, contracts, publishing: N/A.

## Phases

### P1 — the verdict and its test ✓
1. Add `scripts/ci-status.ts` as specified.
2. Add `scripts/ci-status.test.ts` with one table through `verdict`. The ok rows: ran and relevant, skipped and not
   relevant, no filter and ran. The failing rows: failed, cancelled, never started (`skipped` while relevant),
   filter failed (no output), filter succeeded without a valid `relevant`, an unknown result, ran while not
   relevant, no filter and skipped, empty `needs`.
3. In the same file, spawn the entry twice: exit 0 on an ok input, exit 1 with the mismatch line on a failing one.
- **Gate**: `bun test scripts/ci-status.test.ts && bun run lint && bun run typecheck` exit 0. Layers: unit, lint,
  typecheck.

### P2 — the action, the 13 status jobs, the guard, the doc
1. Add the `install` input to `setup-bun`, then add the `status` action.
2. Move actionlint's glob into a `changes` job that calls `_changes.yml`; gate `actionlint` on `CHANGES_GATE`.
3. Add the `status` job to the 13 workflows.
4. Add G1–G3. Check G2 once by hand: remove `test` from one `status.needs`, see G2 fail, restore it.
5. Add one `CLAUDE.md` Conventions line: the 13 names, the rule, F9's limits, where the guard lives.
- **Gate**: `bun run lint:actions && bun run lint && bun run typecheck && bun test && bun run test:components` exit
  0. Layers: lint, typecheck, unit (guard included), component.

### P3 — ask1's Check on GitHub (after the arc PR's 13 statuses are green)
Warning: every commit here must pass lint and typecheck, or miner-core's status turns red too.
1. Branch `ci-1-status-evidence` from the arc branch. Add a comment-only change to `tools/harness/src/user.ts`.
2. Open a draft PR with the arc branch as base, titled `chore(ci): status evidence, do not merge`.
3. Poll `gh pr checks` in bounded loops. Pass: 13 statuses green; of the gated jobs only harness's `rig` ran.
4. Push a commit that makes `tools/harness/tests/flip.bun.test.ts` throw on load (`if (process.env.CI) throw …`).
   Pass: `harness-status` red, the other 12 green.
5. Push a commit that removes the throw. Cancel the harness run while `rig` runs (`gh run cancel`). Pass:
   `harness-status` concludes `failure` or `cancelled`, never `success` or `skipped`.
6. Rerun that run's failed jobs (`gh run rerun <id> --failed`). If `rig` is not among the rerun jobs, rerun its
   job (`gh run rerun --job <job-id>`). Record each attempt's job conclusions. Pass: `rig` and `harness-status` rerun
   and go green; I3 holds only then.
7. Paste each step's check table, head SHA and run URL into the arc PR body. Close the draft PR unmerged and delete
   its branch.
- **Gate**: the four tables above, as `gh pr checks` printed them.

## Delivery

Single arc **a1** = P1–P3, one PR against `main` from `worktree-ci-1`, carrying this plan; `code_review: off`.
Title `ci: one status check per pull-request workflow`; body: what and why, the gates run, the P3 evidence,
`Delivers ask1`. No issue to close. Parallelism: none (P2 depends on P1).

## Post-implementation

1. Comments: invariants and whys only, no plan or review references. Log attempts in `lessons/phase-N.md`. Stop
   after 3 failures on one step.
2. After P2 is green, run the Codex fix loop on the net diff from the plan commit:
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`, sending the diff,
   this plan, the adversarial ask, and verbatim: *"Report bugs and small, targeted improvements only. Do not propose
   speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes
   each real problem. If code works and is clear, leave it alone."* and *"Audit the comments for value per character.
   Flag any comment that narrates what the code visibly does, restates its line, references implementation plans /
   phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
   constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or
   LLM, pays to re-read: they must be few, dense, and exact."* Triage, fix, commit, resume with `resume-codex.sh`
   until a round has no new material finding; hard stop at 3 rounds. A fix that adds state, a lifecycle, a
   protocol, a recovery policy or a public contract is a plan change: stop.
3. Push, `gh pr create`, poll checks until the 13 statuses are green, then P3.
4. Close-out (the repo has no `implementations-plan/README.md`, so blueprint's): merge `origin/main` and reread
   `lessons.md` and `archive/index.md`; add `## Outcome` after the front matter (date, status, shipped,
   `Known limits:`, `Open items:`, seeds retired); promote at most one lesson; file open items as issues; delete
   `STATUS.md`; `git mv implementations-plan/ci-1 implementations-plan/archive/ci-1` in its own commit; add one line
   to `archive/index.md`. No `index.md` row.
5. Do not merge. After the orchestrator merges: `agent-worktree done ci-1 --merged`; relay a refusal verbatim.

## Audit

| Round | Reviewer | Verdict | Accepted | Rejected (reason) |
|---|---|---|---|---|
| r1 | Codex gpt-6.1-sol high | conditional approve | 1 `[skip ci]`/invalid YAML → F9; 2 cancel wording → F3, P3.5; 3 → F5; 4 rerun → P3.6; 5 G2 exact rules, P1 rows; 6 TS, `install` input, shallow checkout (agrees); 7 F2 exception and 300-file caveat; 8 P3 lint warning, SHAs and URLs | none |
| final | Codex gpt-6.1-sol high, fresh session | conditional approve | 1 G3 rejects job-level `continue-on-error` on covered jobs; 2 G2 pins the status action's verdict wiring; 3 P3.6 reruns `rig` by job id if `--failed` skips it, I3 promoted only on observed reruns | none |
| final-v | same session, resumed | **approve** | folds verified, no regression | — |

Size: about 200 lines against light's 150; the quoted ask, the verbatim fix-loop rules and the P3 evidence steps
carry the excess.

## Seeds (drafts; not run — the orchestrator owns execution)

```
/goal P1–P3 of implementations-plan/ci-1/plan.md marked ✓, each gate's output in the transcript; codex fix loop converged (a resumed pass reporting no new material findings, quoted); PR against main open with the 13 <workflow>-status checks green and the P3 evidence in its body; close-out archive commit shown with git show --stat; bun test and bun run lint exit 0.
```
```
/loop 15m Drive implementations-plan/ci-1 forward: read plan.md and lessons/, run the next unchecked phase and its gate, then the post-implementation steps in order; never merge, never touch branch protection; poll CI in bounded loops; after 3 failures on one step, stop and report.
```
