---
plan: site-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
hardening: not scheduled
budget: "recon: 1 Sonnet sweep + the driver's clean-room runs; codex gpt-6.1-sol at high; code-review off"
status: drafted 2026-10-25; codex approve (§7); Phase 1 ✓ 2026-10-25 → outcome H (every probe red); Phase 2 not run; blocked on the owner's log reading
created: 2026-10-25
---

# site-1: Workers Builds green again (#77)

Every Workers Builds run of `yacana` fails since 2026-10-25, about 3 s after it is queued, so every PR is UNSTABLE.
The tree still builds byte for byte in a clean room of the image's documented environment, and nobody here can read
the build log. Probe builds that each change one tool field, with red controls on either side, find a change in the
tree that turns the build green. If none does, the plan stops and hands the owner the log reading.

## 1. Scope

- **Issues**: #77 → arc a1. **Asks**: none.
- **UI impact**: none. Owner decisions recorded for this lane: none, and nothing a person sees changes. The Phase 2
  gate proves the assembled `dist` is byte-identical to `513bd01`'s when both are built with the same commit id.
- **Out**: the Cloudflare dashboard, the API, tokens, `wrangler login`, manual or production deploys (a branch
  build's automatic preview version is in, §3 A1); the site's content and headers;
  `ci-1`'s status jobs.

## 2. Outcome & Quality Bar

- **For whom**: the orchestrator, who merges only once checks are green, and the maintainer who next moves the
  toolchain (lane `v6-1`).
- **Excellent**: (1) the PR head's `Workers Builds: yacana` check is green, and a red control on either side of the
  candidate shows that the change flipped it (an intermittent fault stays possible; the PR head re-proves it). Otherwise the arc stops with the owner's exact reading order and the
  evidence. (2) The Bun that Cloudflare builds with is the Bun CI tests with, held by a test.
- **Good enough**: name the cause only as far as the evidence reaches. Move no other tool.

## 3. Assumptions

Over the 150-line target: the Codex-required verbatim rules (§8), the audit table (§7) and the six-outcome probe tree
carry evidence that cannot be cut.

**Facts** (sources in `recon.md`):
- F1 `513bd01` in the clean room (Ubuntu 24.04, Node 24.21.0, Bun 1.4.0 or 1.4.3, root, 4 CPUs/8 GB, CI variables,
  shallow fetch, npm 10.9.2 first on `PATH`) installs, builds and dry-runs green. Its pages equal production's.
- F2 Bun is pinned at `package.json:66` (`packageManager`) and `.github/actions/setup-bun/action.yml:9` (every
  workflow); `engines.bun` is `>=1.4.0`. No check keeps the two pins equal. Prose names 1.4.0 at `bunfig.toml:16`,
  `scripts/test-preload.ts:1,3` and `docs/deployments.md:106`.
- F3 Bun 1.4.2 also lacks `expect.addEqualityTesters` (`typeof` → `undefined`), so the preload stays.
- F4 The orchestrator reads each failed build as ending about 3 s after it was queued (build `738d6190…`: 15:19:48 →
  15:19:51). Green builds took about 100 s. GitHub's check suites closed 22 s and 53 s after they opened for red
  builds, and after 85 s for the fastest green one.
- F5 On the same account, `unleashed` (`packageManager: bun@1.4.2`, no `engines`) built green on 2026-10-24, and
  `presto` (Bun 1.4.2) on 2026-10-25. Both builds came after the image change.
- F6 A branch push runs Workers Builds alone: every workflow fires on `pull_request` or dispatch. `ci-1` (PR #75)
  edits `setup-bun/action.yml` and `scripts/layout.test.ts`, but not line 9 and not `the root manifest` block.
- F7 The bundles embed the build's commit id (`VITE_SOURCE_COMMIT`, `packages/web-kit/src/config.ts:318`), read
  from `CF_PAGES_COMMIT_SHA ?? GITHUB_SHA ?? git rev-parse HEAD` (`packages/web-kit/src/vite-base.ts:39-43`).

**Claims of #77**: the failing runs and the 2026-09-30 deploy hold (live `build.json` = `513bd01`). "Passes
locally" ran on the host's Bun 1.4.2, not the pin; F1 covers the pin. Whether the trigger is in the tree is not established: the
same tree built green on 2026-09-30 and builds in the clean room (F1), and the probes test the rest. The npm-10.9.2 lead does not hold: nothing in the build calls npm, and F1 stays
green with it first on `PATH`. Done "on `main`" happens at the orchestrator's merge.

**Inferences** (the probes test them; none is promoted as fact unless a probe or the log shows it):
- I0: from F4, the failure comes before the build command runs, where no clean room reaches.
- I1: the builder fails on something in our manifest's tool fields: `bun@1.4.0`, or `engines.bun` (F5's green
  project has neither).
- I2: a yacana-only Cloudflare setting fails every build: the repository connection, the trigger, a deleted or
  rolled build token, or the build minutes. No probe can prove I2; only the log can.

**Asks**: A1, the probe pushes, is resolved. The common brief lets a lane push its own feature branches, and the
lane brief names branch pushes as the proof. A green probe uploads a no-traffic preview version and a branch alias,
the trigger's normal output for every branch (`docs/deployments.md:106-108`). Both outlive the deleted branch, as
every PR branch's do; this is accepted.

## 4. Architecture & Implementation (compact)

**Phase 1, the probes.** Each probe is a commit on `origin/main`, pushed as `site-1-probe-<id>`, with the real build
and deploy commands. Only the conclusion of `Workers Builds: yacana` on the probe's SHA is read. Durations are
recorded, never decided on. A timeout (25 min), a cancel or a missing check is inconclusive (**H**).

| Probe | Commit on `origin/main` | Reading |
|---|---|---|
| Q0 control | an empty commit | red expected. Green → **S** |
| Q1 | the two pin lines → `1.4.2` | green → Q0b. Red → Q3 |
| Q3 | without `engines`, both pins at 1.4.0 | green → Q0b. Red → Q4 |
| Q4 | Q1 without `engines` | green → Q0b. Red → Q2 |
| Q2 | without `packageManager` and `engines` | green → **P**. Red → **H** |
| Q0b control | a new empty commit, after the first green candidate | red → that candidate's outcome. Green → **S** |

- **Outcomes**: **B** (Q1 green): Phase 2 moves both pins to 1.4.2. **B″** (Q4): it also drops `engines`. **B′**
  (Q3): it drops `engines` and keeps both pins at 1.4.0. Each ships exactly the probe that turned green.
- **H**: no tree change turned the build green, or the reading is inconclusive. The arc ends `LEAD_BLOCKED` and hands
  the owner this reading order. First, the complete build details and log of build `738d6190…` or the latest probe,
  from the top, before "Initializing build environment" too. Then only the setting the log names, among: Workers &
  Pages → `yacana` → Settings → Build → the Git repository connection; the API token on both triggers (only on the
  stale-token error: create one and select it); both triggers' root directory and commands against
  `docs/deployments.md:99-106`; the account's Workers Builds minutes.
- **P**: only a manifest without `packageManager` builds. The arc ends `LEAD_BLOCKED` with the log first, then the
  owner's choice: `BUN_VERSION` in the dashboard, or no `packageManager` in the tree.
- **S**: a control went green, so Cloudflare's side recovered or fails intermittently. The arc comments the evidence on
  #77 and reports without a PR.
- **Phase 2 change map (B)**: `package.json:66` → `bun@1.4.2`. `setup-bun/action.yml:9` → `1.4.2`. One test in
  `scripts/layout.test.ts`, `the root manifest`: setup-bun's `bun-version` equals the `packageManager` version.
  `docs/deployments.md:106`: Bun 1.4.2 comes from `packageManager`, the builder installs that version itself, and the
  PR's Workers Builds check proves a bump. `bunfig.toml:16` and `scripts/test-preload.ts:1,3`: "1.4.0" → "1.4.2"
  (F3). `bun.lock` stays unchanged. **B″** adds dropping `engines` (Bun does not enforce it; the pin is the floor).
  **B′** drops `engines` only, with the test and no version edits. The docs line then records that a build with it
  failed and one without it built.
- **Trade-offs**: *probes, not the fix pushed straight to the PR*: a red control on either side supports the candidate
  (an intermittent fault stays possible), and the PR branch then carries only the change that held. *1.4.2, not 1.4.3* (the image's
  default) *or 1.4.4* (3 days old, inside the 7-day gate): this account builds 1.4.2 green through the same
  `packageManager` path (F5), and the host's gates run on it. *No `BUN_VERSION`*: dashboard-only, and it hides the
  pin from the tree. *No dropping `packageManager`*: the build's Bun would float with Cloudflare's defaults. *The pin
  test*: it guards the invariant this fix creates, that CI tests the Bun that ships; `v6-1` moves the toolchain next.
  *Timing probes (the first draft)* and *a no-op deploy* (the second): dropped. A queue or a cancel can fake a
  duration, and Cloudflare may fail a build that uploads nothing, which would fake a red.

## 5. Security & Adversarial Considerations

- **Threat model and least privilege**: the build environment holds the deploy token. Probes run only what any branch
  push runs and never print the environment. Their public branches hold no secret; a green one's preview version
  stays, with no traffic, like any PR branch's. The lane uses no token, dashboard or API: only GitHub reads and its
  own branch pushes.
- **Supply chain**: Bun 1.4.2 (released 2026-09-05, past the 7-day gate) reaches CI through `oven-sh/setup-bun`,
  pinned by SHA. setup-bun downloads and runs the release asset without a checksum, so trust ends at Bun's GitHub
  release. In builds it reaches us through Cloudflare's installer, whose integrity checks are unknown. The npm age
  gate does not cover tool downloads. This lane adds no checksum machinery: the pin moves within the same trust
  boundary. The lockfile stays frozen and unchanged, and no dependency is added.
- **Frontend**: the served bytes must not move (the §6 byte gate).

## 6. Phases

### Phase 1 — Separate the tree from the dashboard with paired probes ✓ (outcome H)
1. Wait until no Cloudflare build of this repo is in flight (`gh api …/commits/<sha>/check-suites`).
2. For each probe in §4 order, run `git switch -c site-1-probe-<id> origin/main`. Commit the probe and push it, then
   run `git switch worktree-site-1`.
3. Poll the probe's check run in bounded `until` loops (≤ 9 min per call). Give up at 25 min, and record that as
   inconclusive.
4. Record its SHA, conclusion and duration. Delete the probe branch, local and remote.

**Validation gate**: one outcome (B, B′, B″, H, P or S) is reached. `lessons/phase-1.md` and `STATUS.md` hold every
probe. `git ls-remote origin 'refs/heads/site-1-probe-*'` prints nothing. Layers: live Workers Builds.

### Phase 2 — Pin what Cloudflare builds (outcomes B, B′, B″ only) — not run (outcome H)
1. Apply the §4 change map.
2. Move one pin alone, and see the new test fail. Restore the pin, and log the run.

**Validation gate**: each command exits 0:
- `bun install --frozen-lockfile && git diff --exit-code bun.lock`
- `bun run lint && bun run typecheck && bun test && bun run test:components && bun run lint:actions`
- the clean room (Ubuntu 24.04, Node 24.21.0, the pinned Bun from its release zip with `bunx` linked) on clones of the
  head and of `513bd01`. Each runs `unset CF_PAGES_COMMIT_SHA; export GITHUB_SHA=513bd015fdf170d1ea7c64d3dac1e967c3715233`,
  then `bun install --frozen-lockfile && bun run site:build`; the head also runs `bun run site:wrangler versions
  upload --dry-run`.
- `diff -r` of the two `dist` folders prints nothing.

After delivery, the PR head's `Workers Builds: yacana` check must be `success`. Layers: lint/typecheck, unit (the
layout test), integration (the clean room), live Workers Builds. E2E: none, because no spec, app code or served byte
moves; the PR's CI runs every suite on the new pin.

## 7. Audit log

**Codex audit** (`gpt-6.1-sol`, high, session `01a173d3`): **conditional approve** (conditions: repair the byte
gate, remove timing diagnoses, resolve A1, bound outcome T). Every finding was adopted:

| # | Finding (sev, label) | Disposition |
|---|---|---|
| 1 | The dist gate fails across commits (high, demonstrated: F7) | both builds pin `GITHUB_SHA`; full equality |
| 2 | F4 is check-suite time, and provisioning is not shown (medium) | F4 restated; I1 stays an inference; the lesson claims only what a probe shows |
| 3 | A queue can fake a 300 s marker; 90–300 s undefined (high, plausible) | timing dropped; pass/fail only (the no-op deploy it suggested was dropped in the final pass) |
| 4 | P2 changes everything at once (medium, demonstrated) | Q2/Q3 strip only the two tool fields; the bare project is gone |
| 5 | A1 assumed; previews outlive branches (medium, plausible) | push authority cited; "probes upload nothing" superseded by the final pass: green probes' previews are accepted (A1) |
| 6 | setup-bun runs the download unchecked (low, plausible) | the trust boundary is stated (§5); no new machinery |
| 7 | Outcome T unbounded, no gate (medium, demonstrated) | every non-B outcome is a handoff; Phase 2 runs only for B/B′/B″ |

**Final fresh pass** (`gpt-6.1-sol`, high, session `01a173da`): **conditional approve** (conditions: repair the byte
gate, treat negative probes as inconclusive, complete the probe branches, clarify B′). Every finding was adopted:

| # | Finding (sev, label) | Disposition |
|---|---|---|
| 1 | `GITHUB_SHA=… a && b` reaches only `a` (high, demonstrated) | exported before both commands; `CF_PAGES_COMMIT_SHA` unset |
| 2 | A no-op deploy may fail healthy probes (high, plausible) | no-op dropped; probes deploy for real; all-red is **H** |
| 3 | Q2 red cut off Q3/Q4 (high, plausible) | Q1 → Q4 → Q3 run first; Q2 is the fallback evidence |
| 4 | B′ shipped a combination no probe built (medium, demonstrated) | B′ keeps both 1.4.0 pins; each outcome ships its probe |
| 5 | Stage and causation stated as fact (medium, demonstrated) | F4 is timestamps only; I0 holds the stage |
| 6 | The reading order skipped pre-initialization errors (medium, plausible) | the whole log first; change only what it names |
| 7 | Inconclusive had no gate (low, demonstrated) | timeouts, cancels and missing checks are **H** |

Resumed (round 2): **conditional approve** — run Q3 before Q4 so the narrowest change wins; drop the two surviving
over-claims; mark row 5 above superseded and narrow "deploys". All three adopted.

Resumed (round 3, verification): **approve** — "no remaining material findings or regressions".

## 8. Post-implementation (executed from here, by this plan alone)

- Write comments to the bar as you code. Log attempts in `lessons/phase-N.md`. Run `agent-worktree status site-1
  "<gate>"` at each gate. Stop after 3 failures on one step.
- **Codex fix loop** (B, B′, B″): `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only
  gpt-6.1-sol` on the arc diff against `origin/main`. Send this plan, the adversarial ask and these two rules
  verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
  configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works
  and is clear, leave it alone."* *"Audit the comments for value per character. Flag any comment that narrates what
  the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph
  where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
  have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense,
  and exact."* After each round's fixes, resume the same session. Stop when a round finds nothing material (hard stop
  at 3, then surface). An Opus `general-purpose` review of the diff runs alongside round 1. Record each round in §7. A
  fix that adds state, a lifecycle, a protocol, a recovery policy or a contract is a plan change: stop.
- **Then** run the Phase 2 gate again on the final head. Push, open the PR (§9), and run `gh pr checks <n> --watch`
  once, bounded.
- **Close-out** (the PR's final commits): run `git merge origin/main`, and read what changed in `index.md` and
  `lessons.md`. Write `## Outcome` after the front matter: date, status, shipped, `Known limits:`, `Open items:`, the
  seeds retired. Promote one lesson: since 2026-10-23 Workers Builds installs the `packageManager` version itself,
  and probes that change one tool field between red controls find a tree fix without the log. Add only what the
  probes showed.
  File open items as issues, searching `gh issue list --state all --search` first. Delete `STATUS.md`. Then
  `git mv implementations-plan/site-1 implementations-plan/archive/site-1` in its own commit, plus one line in
  `archive/index.md`; no `index.md` row.
- **Where open work lives**: a gap that outlives the plan → an issue with a `Record` link. A product call or an
  external wait → `owner-decision` / `blocked:external`. A suspected weakness → a private draft advisory. A path that
  needs unsupported conditions → a closed `known-limit` issue. Rejected or done → an Outcome line.
- **Teardown** follows the orchestrator's merge: `agent-worktree done site-1 --merged`, the last command, never
  forced.

## 9. Delivery

One arc, one PR against `main`, from `worktree-site-1`, which carries this plan's commit. Title (B): `fix(site): pin
bun 1.4.2, the version workers builds provisions`. The body gives what changed and why, the probe table, and the
gates with their outcomes; it says `Closes #77`. Outcomes H, P and S open no PR. No lanes; the phases are serial.

## Seeds (not run: the orchestrator owns ELI5 and seeds)

- `/goal` Phase 1 reached one outcome; for B, B′ or B″, Phase 2's gate passed, the Codex loop converged (quoted), the PR
  is open with `Closes #77`, its `Workers Builds: yacana` is success, and the close-out's archive move is shown.
- `/loop 15m` Drive `implementations-plan/site-1`: reality-check plan.md and the PR's checks; take the next step of §6
  or §8; decide with Codex at high; never merge; at H, P or S, stop and report.
