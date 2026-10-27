---
plan: deploy-2
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
budget: "recon 1 Sonnet agent; codex at high (gpt-6.1-sol); code-review off"
hardening: not scheduled
status: approved by the final Codex pass 2026-10-27 (awaiting the orchestrator)
created: 2026-10-27
---

# deploy-2: a continuation checked against a second source, the lottery secret kept private, the pause limit filed

ask21, three items. (1) A continuation deploy takes the source's last epoch, seed and target from one node answer.
It now needs the operator's tuple too and refuses any disagreement. (2) The launch lottery writes its secret 0664,
after the commit. It now writes it 0600 and exclusively, before the commit. (3) The portal's per-second pause
accounting becomes a closed `known-limit` issue, linked from the docs. Recon: `recon.md`.

## Scope

- **In**: `tools/deploy/src/deploy.ts` and `continuation.test.ts`; `tools/deploy/scripts/launch.ts`, a new
  `launch.test.ts` and `epoch-stats.ts`; one helper in `packages/miner-core/src/reader.ts`; the three rig callers;
  `docs/upgrades.md` step 6, `docs/bridge.md`, `docs/threat-model.md:56`, `CLAUDE.md`'s command lines; one closed issue.
- **Out** (lane brief): the portal contract, `deployments/` beyond reading, every keyed or networked command, the
  other operator scripts' secret handling, any CI gate made advisory.
- **Issues**: none to close. a1 files one closed `known-limit` issue (P3). **Asks**: ask21 → a1.

## UI impact

The lane brief records one decision: "none: nothing a person sees changes (two operator scripts, their tests, docs
and one issue)". UI impact: none on any app. Operator consoles change: the deploy's refusals, and one more line from
`epoch:stats` (A2). `OWNER-ASKS.md`: none.

## Outcome & Quality Bar

- **For whom**: the operator who deploys a continuation or runs a launch lottery, on their own machine.
- **Excellent**: (1) A single node answer can no longer put a wrong epoch, seed or target into a miner, where they
  are immutable. A refusal names each disagreeing field with both values. A stub-node test proves it. (2) Other
  local users cannot read the lottery secret, no run overwrites it, and it is on disk before its commitment lands.
- **Good enough**: the operator picks the second source and the docs say how. Agreement is not finality (Fact 3).

## Assumptions

**Facts**
1. `continuationOf` reads the open epoch, its target and seed from `source.nodeUrl` at `latest`
   (`deploy.ts:272-286`). `verifyOnChain` checks the new miner against those same values (`:109-111`,
   `:192-196`). With the `YACANA_CONTINUE_*` tuple set, the node is not read at all (`:245-266`).
2. **Did not hold**: "the values the committed source record carries". V5's record (`testnet-2026-09-28.json`) and
   V6's (`testnet.json`) carry no last epoch, seed or target. They carry `params.INITIAL_TARGET` and `GENESIS_SEED`,
   which are genesis inputs. A record's `continuation` block holds its own start, not its source's end. So the tuple
   is the second source.
3. `roll()` has no retired check (`yacana_miner/src/main.nr:249-266`; `record_claim` has one at `:232`). After
   `T_MAX`, anyone may roll a retired version. So two reads can agree on epoch E while E + 1 opens later. No claim
   mints after retirement, so nothing is lost. Step 6 of `docs/upgrades.md` says so (A3).
4. No tool shows an open epoch's seed: `epoch-stats.ts:35` reads without it, and Verify shows the genesis seed only
   (`Verify.tsx:110`).
5. `launch.ts` sends the commit at `:79` and calls `Bun.write` at `:80`. Scratch reproduction on this host's Bun
   1.4.2 under umask 002: `Bun.write` gives 0664, also with `{ mode: 0o600 }`. `writeFileSync(p, s, { mode: 0o600,
   flag: 'wx' })` gives 0600, and a second call throws `EEXIST`.
6. `commit_launch` refuses a second commitment from one account (`main.nr:135`). Both recorded deployments
   launched at once (`launchAt` = `launchedAt`), so neither ran a lottery.
7. The pause charges its interval up front, `unpause` refunds `pausedUntil − now` (`YacanaPortal.sol:477-497`), and
   `isPaused` is `pausedUntil > block.timestamp` (`:269`). **Demonstrated**: a throwaway Foundry test ran three
   blocks of `pause(V1, 1)`, a refused `forward`, `unpause(V1)`. It ended with `pausedSeconds` 0 and the deadline
   unchanged, and the next `forward` passed.
8. **Did not hold**: "a third-party forwarder" limits the pause path. Every forward passes `_requireOpen`
   (`:331`), whoever sends it. `forwardMany` logs a failed leaf (`LeafFailed`) and goes on (`:312-320`).

**Inferences**
- I1 (plausible but unverified): a lagging or misrouted node answers an earlier open epoch. The continuation then
  reuses V5's epoch numbers with an old seed and target, immutably, and `register` is write-once.
- I2: the pause path needs the operators key, sight of the exit before inclusion, and an order on both sides of it
  in one block. Private order flow hides the exit but guarantees nothing. Exploitability on mainnet: unknown. Today
  only Sepolia's portal carries the path.

**Asks** (working assumptions; no owner question)
- A1: a continuation needs an answering source node. Today's tuple-only path for a dead node goes: one source is
  what ask21 refuses, and the runbook deploys the continuation (step 6) long before the node retires (step 12).
- A2: `epoch:stats` ends with the open epoch's tuple, so the operator can read it from a second node.
- A3: Fact 3 is a known limit, which the program files as a closed issue, but the brief names one issue. a1 writes
  it into `docs/upgrades.md` step 6 and the Outcome, and files nothing. The final report asks the orchestrator
  whether to file it.

## Architecture & Implementation

- **`reader.ts`**: `readOpenEpoch(node, miner, layout, load, limits?)` → `{ epoch, target, seed }`. It wraps the
  existing `readOpenEpochNumber` + `readEpochs(withSeed)` pair, which `deploy.ts` and `epoch-stats.ts` both need.
- **`deploy.ts`**: `continuationOf(sourceRecord, announced: Announced | 'node-only')`, where `Announced` is
  `{ firstEpoch, sourceSeed, sourceTarget }`. It always reads the source node. With `'node-only'` it returns the
  node's values; only the rig passes it. With `announced`, any field that differs throws, naming each one with both
  values. `announcedFromEnv()` requires all three `YACANA_CONTINUE_*` keys, so the CLI always has two sources. The
  doc comment drops "taken as given".
- **`epoch-stats.ts`**: after the table, one line `YACANA_CONTINUE_FIRST_EPOCH=<open + 1> YACANA_CONTINUE_SEED=…
  YACANA_CONTINUE_TARGET=…` (the open epoch's seed and target), read from `AZTEC_NODE_URL` or the record's node.
- **`launch.ts`**: export `writeLaunchSecret(path, secret)`, which calls `writeFileSync` with `mode: 0o600` and
  `flag: 'wx'`. The body moves under `if (import.meta.main)`. `commit` writes the fresh secret, then sends. The
  refusal of an existing file stays. Its message adds that an interrupted commit may still have landed, so the
  file must be kept for `reveal`.
- **Rig**: `migration`, `skip-version` and `browser` call `continuationOf(v5.recordPath, 'node-only')`.

| Alternative | Why not |
|---|---|
| A second node read automatically (`YACANA_CONTINUE_NODE`) | New config; the brief names the tuple |
| Keep the tuple-only path for a retired node | One source decides again (Codex r1, accepted) |
| `assertDeployment` on the source node | A consistency check answered by that same node: no freshness, no authentication |
| `commit` resends a stored commitment | A retry policy with obligations (an uncertain send, another deployment) (Codex r1, accepted) |
| A module `src/launch-secret.ts` | The scripts' pattern is export + `import.meta.main` (`epoch-stats.ts`, `l1-deploy.ts`) |
| An injected node object in the test | The HTTP stub runs the real resolution and client, as the brief asks |

## Security & Adversarial Considerations

- **A lying or lagging source node** (I1) must now also match the operator's read. The docs ask for that read from
  another node. Two correlated endpoints can still agree on a wrong view; agreement is a consistency check.
- **A local user on the operator's machine**: 0600 and `wx` keep the secret from other unprivileged users and from
  an overwrite. They do not protect it from the same user or root, and a file written by the old code keeps its
  mode.
- **The operators key against the portal** (Fact 7, I2): the owner keeps this as a limit. The policy is immutable in
  the deployed portal, and the fix needs the next portal.
- No new secret, dependency or contract change.

## Phases

### P1 (a1): the continuation needs two sources — ✓ 2026-10-27

1. Add `readOpenEpoch` and `announcedFromEnv`. Change `continuationOf`, the CLI, `epoch-stats.ts` and the rig callers.
2. Rewrite `continuation.test.ts` with a `Bun.serve({ port: 0 })` JSON-RPC stub (`aztec_getPublicStorageAt`,
   batch-aware, as `history-transport.bun.test.ts`) and a record in a `mkdtempSync` dir.
   - An agreeing tuple returns the node's continuation, and `'node-only'` returns the same (success control).
   - `test.each` over target, seed and first epoch: a wrong value is refused, and the message names it.
   - `announcedFromEnv` with one key missing is refused.
3. Remove the comparison and run the file: the three refusals must fail. Restore it.
4. Update `deploy.ts`'s header, `docs/upgrades.md` step 6 and `CLAUDE.md`. Step 6 says: read the tuple with
   `AZTEC_NODE_URL=<another V5 node> bun run epoch:stats -- <record>`, set it, deploy, and read again on a mismatch.
   It also says that anyone may still roll V5 after `T_MAX`, so two agreeing reads are not proof of V5's last epoch.
   Deviation (the tree wins): the helper is `readOpenEpochWithSeed`; `epoch.ts` already exports a `readOpenEpoch`.

**Validation gate**: `bun run lint && bun run typecheck && bun test tools/deploy packages/miner-core`. Pass: exit 0,
and step 3's failures quoted in `lessons/phase-1.md`. Layers: lint, typecheck, unit (stub node over HTTP).

### P2 (a1): the lottery secret — ✓ 2026-10-27

1. Write `launch.test.ts`. In a `mkdtempSync` dir under `process.umask(0o002)`, restored after: the first
   `writeLaunchSecret` leaves mode 0600, and the JSON reads back. A second call throws `EEXIST`, and the file is
   unchanged.
2. Run it against a `Bun.write` body: it must fail on the mode (0664). Then switch to `writeFileSync`: it must pass.
3. Move the body under `import.meta.main`, write before the send, and reword the refusal.

**Validation gate**: `bun run lint && bun run typecheck && bun test tools/deploy`. Pass: exit 0, and step 2's
failure quoted in `lessons/phase-2.md`. Layers: lint, typecheck, unit (real file system).

### P3 (a1): the pause limit, filed and linked — ✓ 2026-10-27 (#90)

1. Dedupe: `gh issue list --state all --search "pause unpause same block"` must show none.
2. File the issue with the label `known-limit`, in #82's shape, naming no plan, review or audit:
   - What happens (demonstrated, Fact 7): the path with its two calls. Paste the complete Foundry test as the
     reproducer: the operators as caller, the order in one block, `vm.roll` and `vm.warp`, every assertion.
   - Impact: exits held shut at zero budget, the deadline never extended. It needs I2's conditions. A bracketed
     `forwardMany` loses that version's leaves, not the whole batch.
   - Disposition: the policy is immutable in the deployed portal. Reopen when a new portal is designed or deployed:
     it charges each pause a minimum that `unpause` never refunds. Close it as not planned at once.
3. Link it: one paragraph in `docs/bridge.md` § "The operators", and one clause each on the pause bullet
   (`docs/bridge.md:35-38`) and the bound row (`docs/threat-model.md:56`).

**Validation gate**: `gh issue view <n> --json state,stateReason,labels` shows CLOSED, NOT_PLANNED and
`known-limit`. `bun run lint` exits 0. `git diff --stat origin/main -- protocol` is empty.

### Arc gate (a1) — ✓ 2026-10-27

`bun run lint && bun run typecheck && bun test && bun run test:components`, then `bun run rig -- skip-version`
(the `'node-only'` path end to end; estimated 5 min, measured in `lessons/phase-3.md`). Pass: every command exits 0.

## Delivery

One arc, one PR against `main`: a1 = P1–P3 on `worktree-deploy-2`, carrying this plan. Title `fix(deploy): a
continuation needs two sources; the lottery secret stays private`. Body: what and why, the gates with outcomes,
`Delivers ask21`, the issue number. `code_review: off`. The close-out is the PR's last commits. No parallelism.

## Post-implementation

1. Comments state invariants and whys only, never a plan, phase, review or issue. Log every attempt in
   `lessons/phase-N.md`. Stop after 3 failures on one step. Run `agent-worktree status deploy-2 "<line>"` at each gate.
2. After the arc gate, run the Codex fix loop on `git diff origin/main...HEAD` with
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`. Send the diff,
   this plan, the adversarial ask and the two lines about `.env` and `~/.agents/orchy/`. Add verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
     configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code
     works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does,
     restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence
     works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have.
     Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense,
     and exact."*

   Triage, fix, commit, and `resume-codex.sh` until a round has no new material finding; stop hard at 3 rounds. A
   fix that adds state, a lifecycle, a protocol, a recovery policy or a public contract is a plan change: stop.
3. Push the branch and run `gh pr create`. Poll the checks in bounded loops until they are green.
4. Close-out, on the same PR (the repo has no `implementations-plan/README.md`, so blueprint's close-out):
   merge `origin/main` and reread `lessons.md` and `archive/index.md`; add `## Outcome` after the front matter
   (date, status, shipped, `Known limits: #<n>`, `Open items:`, A3's answer, seeds retired); promote to `lessons.md` with a
   pruning pass (`Bun.write` ignores `mode` on Bun 1.4.2; `roll()` stays open after retirement); delete `STATUS.md`;
   then `git mv implementations-plan/deploy-2 implementations-plan/archive/deploy-2` in its own commit, with one line
   in `archive/index.md` and no row in `index.md`.
5. Do not merge. After the orchestrator merges, run `agent-worktree done deploy-2 --merged`, and relay any refusal
   verbatim.

## Audit

| Round | Reviewer | Verdict | Accepted | Rejected (reason) |
|---|---|---|---|---|
| r1 | Codex gpt-6.1-sol high | reject | 1 the tuple-only path for a retired node bypasses the second source → removed (A1); 2 `commit` resending a stored commitment is a retry policy → the refusal stays, reworded; 3 agreement is not finality (`roll()` after retirement) → Fact 3, a closed known limit; 4 `assertDeployment` is a consistency check, Fact 2's genesis params → reworded; 5 a third-party forwarder does not escape the bracket → Fact 8, and the bound's two other statements get the link; 6 `epoch:stats`' line is operator-visible → UI impact says so; 7 0600 protects from other users only → Security | none |
| final | Codex gpt-6.1-sol high, fresh session | conditional approve | 1 the second issue exceeds the brief's "one issue" → reconciled in A3 and UI impact, droppable by the orchestrator; 2 a missing log line does not prove a commit failed → the refusal says keep the file; 3 Fact 6 overstated → only the records' immediate launch; 4 the reproducer must survive → the full test goes into the issue (kept in scratch until then); `FIRST_EPOCH = open + 1` spelled out | none |
| final-v | same session, resumed | conditional approve | resolve A3 before filing → a1 files nothing for Fact 3; the docs say it, the report asks the orchestrator | — |
| final-v2 | same session, resumed | **approve** | the fold verified, no regression | — |
| fix r1 | Codex gpt-6.1-sol high + Opus 5.5 (same family) | Codex **clean**; Opus 3 low | Opus 1: `epoch:stats` could be run against the record's own node unseen → the line names the origin read and flags the record's own; Opus 2: a tuple without `YACANA_CONTINUE_FROM` deployed a genesis → refused; Opus 3: the coverage row overstated the rig → corrected, `skip-version` added; a shadowed `node` renamed | Opus test gaps (the write-before-send order, the CLI passing `'node-only'`): both sit in `import.meta.main` blocks; testing them means restructuring the scripts for a test, and the code is two adjacent lines |
| fix r2 | Codex, same session resumed | **clean** | the fixes verified, no regression; converged in 2 rounds | — |

Size: about 230 lines against light's 150. The verbatim fix-loop rules, two claims that did not hold and the
issue specification carry the excess.

## Seeds (drafts; not run — the orchestrator owns execution)

```
/goal P1–P3 and the arc gate of implementations-plan/deploy-2/plan.md marked ✓ with their gates' output in the transcript (the refusals failing without the comparison, the mode test failing on Bun.write); the closed known-limit issue's state quoted; the codex fix loop converged (a resumed pass with no new material finding, quoted); the PR against main open with Delivers ask21 and checks green; the close-out archive commit shown with git show --stat; bun test and bun run lint exit 0.
```
```
/loop 15m Drive implementations-plan/deploy-2 forward: read plan.md and lessons/, run the next unchecked phase and its gate, then the post-implementation steps; never run a keyed or networked command, never merge; poll CI in bounded loops; after 3 failures on one step, stop and report.
```
