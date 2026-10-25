# ci-1 recon

Base: `origin/main` at `513bd01`. One Sonnet reuse sweep plus a docs fetch; the driver read every workflow,
`scripts/layout.test.ts` and the composite actions.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| A job comparing other jobs' results | Nothing. Searched `.github/` and the repo for `needs.*.result`, `toJSON(needs)`, `cancelled()`, `result ==`, `-status`. The one job-level `always()` is `e2e.yml` `web-miner-report` (dispatch-only, merges shard reports) | build new; copy that job's shape (`if: always()`, `timeout-minutes: 5`, checkout then a local action) |
| The change filter | `.github/workflows/_changes.yml`: output `relevant`, `'true'`/`'false'` from dorny, forced `true` on `workflow_dispatch` | reuse as-is; actionlint starts calling it |
| Shared CI logic | composite actions `setup-bun`, `setup-aztec`, `setup-presto` (bash steps; `setup-presto` runs a repo script) | adapt: a fourth action, `status` |
| Bun on a runner | `setup-bun/action.yml`: `oven-sh/setup-bun@0c5077e5… # v2`, Bun 1.4.0, then always `bun install --frozen-lockfile` | adapt: an `install` input (default `'true'`) |
| Workflow guard | `scripts/layout.test.ts`: parses every workflow with `Bun.YAML` (l. 61–83), every `.github/actions/<dir>/action.yml` (l. 84–88); `CHANGES_GATE` (l. 151); every `*.test.ts` must run in a PR lane (l. 288–310); every tracked `.ts` must belong to exactly one tsc project (l. 448–507) | adapt: three new tests in `describe('workflows')` |
| YAML parsing | `import { YAML } from 'bun'` (layout.test.ts:8); no `yaml` dependency declared | reuse as-is |
| Typed root scripts | `scripts/tsconfig.json` includes `./*.ts` only; biome lints `scripts/*.ts` | reuse: the verdict lives at `scripts/ci-status.ts` (TS under `.github/` belongs to no tsc project and fails the guard) |
| Test runs in CI | `miner-core.yml` runs `bun test … scripts …` on every PR, no filter | reuse: `scripts/ci-status.test.ts` is covered |
| Spawning a script from a test | `scripts/rename-guard.test.ts:30` (bun `$` with `.cwd(repo)`), `apps/web-miner/tests/presto-prover.bun.test.ts:147` (`Bun.spawnSync`) | reuse the pattern |
| CI docs | `CLAUDE.md` is the only live place (Toolchain, Commands); no `docs/ci*`; no doc names a job or a required check | adapt: one Conventions line |

## Facts the plan rests on

- PR workflows (13): actionlint, contracts, deploy, harness, miner-core, portal, site, ui, web-kit, web-landing,
  web-miner, web-stats, work-circuit. `e2e.yml` is dispatch-only; `_changes.yml` is `workflow_call`.
- Every gated job's `if:` is exactly `needs.changes.outputs.relevant == 'true'` (contracts:48, deploy:37, harness:47,
  portal:35, site:45, ui:32, web-kit:40, web-landing:43, web-miner:45 and :62, web-stats:41 and :60,
  work-circuit:38). No other job-level `if:` in a PR workflow.
- `miner-core.yml` has no `changes` job; its one job is ungated. `actionlint.yml` has no `changes` job and a
  workflow-level `pull_request.paths: ['.github/**']` filter: **the lane brief's claim that no PR workflow has a
  workflow-level paths filter does not hold** for actionlint.
- No `concurrency:` key anywhere in `.github/`.
- Every filter watches its own workflow file, `.github/actions/**` and `_changes.yml`; miner-core runs always and
  actionlint watches `.github/**`. A PR adding `.github/actions/status/` therefore runs every gated job.
- Check-run names on PR #74 repeat: `Lint + typecheck + component tests` ×4, `Compile + test` ×2,
  `changes / Detect changes` ×11.
- GitHub docs: a workflow skipped by path filtering leaves its checks "Pending" and a PR requiring them "will be
  blocked from merging" (workflow syntax, `on.pull_request.paths`); "A job that is skipped will report its status as
  "Success". It will not prevent a pull request from merging, even if it is a required check." (using conditions);
  `always()` "returns `true`, even when canceled"; `needs.<job>.result` is `success`, `failure`, `cancelled` or
  `skipped`, and `needs` holds direct dependencies only (contexts).
- Repo is public (Actions minutes free). Branch protection has no required checks today
  (`monorepo-layout/lessons/phase-5.md:171`).

## Open work and collisions

`gh issue list` searches for "status check" and closed `known-limit` "CI": none. No open PRs. No other lane in this
repository. `implementations-plan/follow-ups.md` still exists on a repository with issues; its migration is not
this lane's.
