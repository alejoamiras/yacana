---
plan: deploy-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
budget: "recon 1 Sonnet agent + 1 web fetch; codex at high (gpt-6.1-sol); code-review off"
hardening: not scheduled
status: completed 2026-10-26
created: 2026-10-26
---

## Outcome

- **Date**: 2026-10-26. **Status**: completed.
- **Shipped**: a1, PR #84 (squash-merged as `d58a2d2`). It covered #80: the L1 creation goes out at the node's `eth_estimateGas` × 1.3 (`--skip-simulation`), `forgeScript` is async, a test runs a Sepolia-priced proxy in front of anvil, and the portal lane runs it. It also covered #83: every bun suite that loads web-kit's fetch guard installs it in setup and uninstalls it last. a2, PR #89 (#81): the V6 portal and YACA are marked verified in `docs/deployments.md`, after the orchestrator's keyed K5 (`l1-verify.ts deployments/testnet.json` from ba5aae8, both "Pass - Verified"). The lane then read both pages back without a key.
- **Rejected**: these alternatives were considered and not taken (see Architecture and Audit):
  - a gas multiplier from an environment variable;
  - a creation sent with viem;
  - `--isolate`, a fetch swap inside the deploy suite, or a child-process driver as the answer to the leak.
- **Known limits**: #82, the V6 deployment's own limit (`LEAF_GAS`), filed with PR #79. Nothing in this lane touches it.
- **Open items**: none.
- **Seeds**: the `/goal` and `/loop` at the bottom are retired. They are a record, not instructions.

# deploy-1: the L1 creation at the node's gas, and the V6 contracts verified

On Sepolia, `l1-deploy.ts` broadcasts the portal's creation at forge's simulated gas. Since Sepolia's fork of
2026-10-06 that gas is about 7× too low, so the V6 broadcast ran out of gas (#80). Arc a1 makes forge take the
node's own estimate. Arc a2 marks the V6 portal and YACA verified in `docs/deployments.md` once Etherscan shows them
verified (#81). Recon: `recon.md`. Evidence: `lessons/phase-0.md`.

## Scope

- **In**: `tools/deploy/scripts/l1-deploy.ts`, its new test, `.github/workflows/portal.yml`, two places in
  `docs/deployments.md`, and the forge-gas line of `implementations-plan/lessons.md`.
- **Out** (lane brief): `protocol/portal`, `deployments/`, every keyed command, the mainnet profile, any CI gate
  made advisory.
- **Issues**: #83 and #80 → a1 (#83 joined a1 by the orchestrator's amendment of 2026-10-26). #81 → a2.
  **Asks**: none.

## UI impact

The lane brief records no owner decision: "nothing a person sees changes (a deploy script and two documentation
rows)". UI impact: none. `OWNER-ASKS.md`: none.

## Outcome & Quality Bar

- **For whom**: the operator who runs the next L1 deploy, and the reader who checks the V6 contracts on Etherscan.
- **Excellent**: (1) The next deploy pays what the target node quotes, with no flag to set and no ratio to know.
  A test fails if the creation goes out below the node's quote. (2) The docs say "verified" only after Etherscan
  shows it.
- **Good enough**: forge's 130 % margin stays, with no operator option. No committed test calls Sepolia; the
  read-only dry run is a gate step.

## Assumptions

**Facts**
1. Today forge runs `script script/Deploy.s.sol:Deploy --rpc-url <url> --broadcast --json` through
   `Bun.spawnSync`, with no gas flag (`l1-deploy.ts:76-88`).
2. The pinned forge 1.8.5 (`script --help`) has `--skip-simulation` and `-g, --gas-estimate-multiplier`, whose
   default is 130.
3. The spike put an anvil behind a proxy that multiplies `eth_estimateGas` answers.
   - Without a flag, forge never asked for an estimate. It sent its simulation, 3,980,712 × 1.3 = 5,174,925, which
     is exactly the limit of the failed Sepolia creation `0x533825f2…`.
   - With `--skip-simulation`, forge asked once and sent the answer × 1.3 (×8: 31,845,696 → 41,399,404). It
     still printed `returns`.
   - With `--gas-estimate-multiplier 800`, forge multiplied the simulation blindly.
   - With operators = 0, forge failed in its local run ("ZeroOperators()") and asked and sent nothing.
4. An in-process server cannot answer forge while `Bun.spawnSync` blocks the event loop. The spike's first try
   hung until forge timed out.
5. On chain (public RPC): `0x533825f2…` had a limit of 5,174,925, used all of it, and has status 0. The creation
   `0x2ac8c122…` was sent by hand at the node's 28,088,860 × 1.3 = 36,515,518. It used 27,866,530 and has
   status 1. **Did not hold**: #80's "simulated … at 5,175,949 gas". The simulation measured 3,980,712, and the
   limit was 5,174,925, as `docs/deployments.md:189` says.
6. The deployed code is 15,317 B (YacanaPortal) + 2,202 B (YACA), as #80 says.
7. The tested pinned anvil configurations do not price the creation as Sepolia does. Anvil 1.8.5 charges
   3,980,712 both at its default and under `--hardfork amsterdam`, and a fork of Sepolia runs in anvil's own EVM.
   **Did not hold as stated**: the brief's "a fork that prices deposits as Sepolia does". The test therefore models
   Sepolia's quote, and the dry run of Fact 13 runs Sepolia's own EVM.
8. Anvil refuses a transaction above its 30 M block gas limit by default. Sepolia's limit is 199,804,307.
9. `l1-deploy.ts:21-24` resolves forge at import, and `deploy.yml` and `miner-core.yml` run `bun test
   tools/deploy` without the toolchain. `bb-verify.test.ts:9-17` is the repo's gate for this case.
10. The portal's constructor stores the Registry and does not call it (`YacanaPortal.sol:165-169`).
11. The isolated network, and through it the rig, starts anvil with `startAnvil`'s arguments
    (`isolated-node.ts:152-156`). So `--anvil` in CI runs `deployL1`'s path on the same anvil configuration.
12. Etherscan at 2026-10-26 02:42 UTC: both pages show "Contract: Unverified".
13. Dry run, read-only and without a key (Sepolia block 11,995,218): the pinned `aztec-cast estimate --create`
    of the on-chain creation's input, from its sender, returns 28,088,860. A node's estimate executes the node's
    own EVM, so the quote × 1.3 = 36,515,518 covers the 27,866,530 the creation used. The initcode from
    `portal:build` is byte-identical to the on-chain one (20,352 B, before 512 B of constructor arguments).

**Inferences**
- I1: For this one-creation script, skipping forge's replay loses nothing: a revert fails in the local run first
  (Fact 3). Do not generalise this to other scripts.
- I2: × 1.3 is a margin over a correct quote. On Sepolia it left 24 % unused (Fact 5). It is no defence against a
  wrong quote (see Security).

**Asks** (working assumptions; no owner question)
- A1: a2 waits for the orchestrator's keyed K5. The lane never runs it.
- A2: no environment variable for the multiplier. The brief asks for the smaller of the two designs.

## Architecture & Implementation

- **The fix**: add `--skip-simulation` to forge's arguments, with a one-line why: forge's own EVM (prague,
  `foundry.toml`) lags a chain that reprices, so the node's `eth_estimateGas` × 130 % prices each transaction.
- **Async forge**: `forgeScript` moves to `Bun.spawn`. It drains stdout and stderr together, awaits the exit, and
  `deployL1` awaits it. The parsing and the errors stay the same. Fact 4 is the reason.
- **Test seams**: export `startAnvil` and `ANVIL_KEY`. `startAnvil(extraArgs: string[] = [])` adds the arguments to
  anvil's own. The CLI passes none, so `--anvil` keeps anvil's 30 M block cap. If readiness fails, `startAnvil`
  kills its anvil and releases its port before it rethrows; today it leaks both.
- **The test** (`tools/deploy/scripts/l1-deploy.test.ts`) uses the `bb-verify.test.ts` gate:
  1. In `beforeAll` (timeout 90 s, above the 60 s readiness deadline), run `startAnvil(['--gas-limit',
     '60000000'])`. 60 M is the room the test's own quote needs (41.4 M). `afterAll` stops the proxy and anvil.
  2. Put an in-process `Bun.serve({ hostname: '127.0.0.1', port: 0 })` in front of it. It forwards every request.
     It multiplies each `eth_estimateGas` result for a creation (no `to`) by 8, which is Sepolia's quote over
     forge's simulation (28,088,860 / 3,980,712, rounded up). It records each answer.
  3. Run `deployL1` through the proxy, with `registry` = the operators' address (Fact 10).
  4. Read the creation from anvil at `deployBlock`.
  - Assert at least one quote. Never-happens: the creation's gas limit is below the largest quote. Discrimination:
    its `gasUsed` × 1.3 (forge's simulated limit) is below that quote. Success control: the receipt succeeded,
    and its `contractAddress` is the returned portal.
  - It proves that forge follows the node's quote, not that it runs Sepolia's EVM (Fact 7). A batched request has
    no `method`, so it is not priced and the test fails. Timeout 60 s (cold compile 7.4 s, warm run about 3 s).
- **CI**: `portal.yml` runs the test after `portal:build`, with `YACANA_REQUIRE_TOOLCHAIN: '1'`. The filter swaps
  `tools/deploy/scripts/l1-deploy.ts` and `packages/bridge/fixtures/**` for `tools/deploy/**`,
  `!tools/deploy/**/*.md`, `packages/bridge/**` and `packages/miner-core/**`, as `scripts/layout.test.ts` requires.
- **Docs**: `docs/deployments.md:162` gains one clause: the script sends each transaction at the node's estimate ×
  1.3 (`--skip-simulation`), so the RPC it names must be trusted.

| Alternative | Why not |
|---|---|
| `--gas-estimate-multiplier` from an env var | It scales forge's wrong price by a ratio the operator must know. 130 fails Sepolia, and 800 overpays elsewhere and breaks on the next repricing |
| The script asks for the estimate and sends the creation with viem | It replaces forge's broadcast and rebuilds the initcode: more code for the same number |
| Resolve forge lazily in `l1-deploy.ts` | It changes production code for a test; the dynamic-import gate is the repo's pattern |
| `--disable-block-gas-limit` in every `startAnvil` | It hides a block-cap failure from the `--anvil` rehearsal (Codex r1) |
| The test in `deploy.yml` | That lane has no toolchain; the portal job already has it and the build, in about 40 s |
| A rig case that deploys the bridge | Its setup mines and proves for up to 15 min; Fact 11 covers the same path |

## Security & Adversarial Considerations

- **Threat model**: the RPC is the operator's chosen endpoint. It is already trusted for state, nonce, fees and
  broadcast. It now also sets the creation's gas. A quote that is too low makes the creation run out of gas, and
  the operator loses the fee. A quote that is too high fails the send, either at the block cap or at the balance
  check. Both are operational failures, which the docs clause states. Retries or a second provider would add
  coordination for no proven gain.
- **Secrets**: unchanged. The key goes from the environment into the forge script, never into argv. The test
  uses anvil's public key only, on a chain it owns.
- **Supply chain**: no new dependency. Actions stay pinned by SHA, and the workflow keeps `contents: read`.
- **Contracts**: no source change. Exposure to reorg and replay is unchanged: one creation, bound to its nonce.

## Phases

### P0 (a1, amendment): #83, every guard suite gives the realm back — ✓ 2026-10-26

The orchestrator added #83 to a1 (2026-10-26): it was the one red command in P1's gate. The fix: each bun suite
that loads web-kit's fetch guard installs it in its setup and calls a new tests-only `uninstallNodeGuard()` last
in its teardown, which puts back the fetch the guard replaced and drops its realm marker. Only the guard knows
that fetch: `original` is bound, and `setOriginalFetch` re-points it. The guard's behaviour in a page is unchanged.

- The suites (31, by a probe that ran each file alone and read the realm after it): web-kit `eth-rpc`,
  `node-guard`, `node-health`, `node`; stats-view `history-transport`, `runtime`; web-landing `chain`, `live`; and 23
  web-miner suites. Those that set a fake as `globalThis.fetch` before the guard now arm the fake only through
  `setOriginalFetch`, so the uninstall puts back the real fetch.
- Bun runs `afterAll` hooks in registration order, so the uninstall is the last teardown. A suite's own teardown
  that puts back a wrapper of the guard (the CRS stand-in in `presto-prover`) runs before it.
- Left as is: `pinned-crs.bun.test.ts` leaves the CRS interceptor, which forwards to the fetch it found. A leaked
  `location` breaks nothing demonstrated.

**Validation gate**: the probe over all 133 files finds no suite that leaves the guard. The root `bun test`
passes at retry 0, with `l1-deploy.test.ts` in it. With the guard's refusal disabled, the suites that test the
guard fail both alone and after another guard suite's teardown.

### P1 (a1): the creation at the node's quote — ✓ 2026-10-26

1. Make `forgeScript` async. Run `bun run portal:build && bun tools/deploy/scripts/l1-deploy.ts --anvil`: it must
   still pass.
2. Export the seams, with `startAnvil`'s cleanup on a failed start, and write the test. Run it against the script without the flag. It must fail on the gas
   assertion (no quote, a limit of 5,174,925), not on a timeout. Record the output in `lessons/phase-1.md`.
3. Add `--skip-simulation`. Run the test again: it must pass.
4. Change `portal.yml` (step and filter) and add the `docs/deployments.md` clause.

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun test && bun run test:components && bun run lint:actions`
  and `bun run portal:build && YACANA_REQUIRE_TOOLCHAIN=1 bun test tools/deploy/scripts/l1-deploy.test.ts && bun
  tools/deploy/scripts/l1-deploy.ts --anvil`. Then run `HOME=<empty scratch dir> bun test
  tools/deploy/scripts/l1-deploy.test.ts`, which stands for a lane without the toolchain. Then run the dry run
  (read-only, no key): `C=~/.aztec/versions/6.0.0/bin/aztec-cast; R=https://ethereum-sepolia-rpc.publicnode.com;
  T=0x2ac8c12229ddf0cd5931a9242beee78099a7d42eebf7b2f6ed2126b377b4fb2c; $C estimate --rpc-url $R --from $($C tx $T
  from --rpc-url $R) --create $($C tx $T input --rpc-url $R)`.
- Pass: every command exits 0, and `scripts/layout.test.ts` passes. The test fails at step 2 and passes after step
  3. The run without the toolchain reports 1 skip and 0 failures. The dry run prints at least 27,866,530; quote it
  in the PR body.
- Layers: lint, typecheck, unit, integration (forge and anvil), and a read-only call to Sepolia.

### P2 (a2): the two rows verified (only once Etherscan shows both) — ✓ 2026-10-26
1. Read both `#code` pages with a web fetch. Each must show "Contract Source Code Verified", its name
   (`YacanaPortal`, `YACA`) and compiler v0.8.30. If either does not, stop and report.
2. In `docs/deployments.md:178-179`, change "Etherscan verification pending" to "verified". Add `#code` to both
   address links, as the rows at `:249-250` have it.

**Validation gate**: quote step 1's markers and the time of the read in `lessons/phase-2.md`. `bun run lint`
exits 0. `git diff --stat origin/main` shows `docs/deployments.md` and the plan folder only.

Deviations (the tree and the orchestrator win): the base is `origin/main` at ba5aae8, two merges past a1's
d58a2d2; the rows sit at `:179-180` and the archived `#code` rows at `:243-244`; Etherscan's marker now reads
"Source Code Verified (Exact Match)"; each row also carries the date and, as the orchestrator asked, the compiler
settings Etherscan shows.

## Delivery

- **a1** = P1 on `worktree-deploy-1`, carrying this plan. PR against `main`: `fix(deploy): send the l1 creation
  at the node's gas estimate`, `Closes #80`, `Closes #83`. `code_review: off`. a1 = P0 then P1.
- **a2** = P2 on `deploy-1-a2` from `origin/main`. Start it only after a1 has merged and Etherscan shows both
  contracts verified. PR `docs(deployments): the v6 portal and yaca verified on etherscan`, `Closes #81`. It
  carries the close-out. If Etherscan is not ready when a1 is delivered, stop after a1 and report it.
- No parallelism: a2 waits on an external step.

## Post-implementation

1. Comments state invariants and whys, with no plan, phase, review or issue references. Log every attempt in
   `lessons/phase-N.md`. Stop after 3 failures on one step.
2. After each arc's gate, run the Codex fix loop on that arc's diff with
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`.
   - Send the diff, this plan and the adversarial ask. Add the two lines about `.env` and `~/.agents/orchy/`.
   - Add verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If
     code works and is clear, leave it alone."*
   - Add verbatim: *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph
     where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it
     doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be
     few, dense, and exact."*
   - Triage, fix, commit, and resume with `resume-codex.sh` until a round has no new material finding. Stop hard
     at 3 rounds. A fix that adds state, a lifecycle, a protocol, a recovery policy or a public contract is a plan
     change: stop.
3. Push the arc's branch and run `gh pr create`. Poll the checks in bounded loops until they are green.
4. Close-out, in a2's PR. The repo has no `implementations-plan/README.md`, so use blueprint's close-out:
   - Merge `origin/main`, then reread `lessons.md` and `archive/index.md`.
   - Add `## Outcome` after the front matter: date, status, shipped, `Known limits:`, `Open items:`, seeds retired.
   - Rewrite the forge-gas line of `lessons.md`: `l1-deploy.ts` passes `--skip-simulation`, so forge sends
     `eth_estimateGas` × 1.3. Add that anvil 1.8.5's amsterdam prices a creation like prague.
   - File open items as issues and delete `STATUS.md`.
   - Run `git mv implementations-plan/deploy-1 implementations-plan/archive/deploy-1` in its own commit. Add one
     line to `archive/index.md` and no row to `index.md`.
5. Do not merge. After the orchestrator merges a2, run `agent-worktree done deploy-1 --merged`. If it refuses,
   relay the refusal verbatim.

## Audit

| Round | Reviewer | Verdict | Accepted | Rejected (reason) |
|---|---|---|---|---|
| r1 | Codex gpt-6.1-sol high | reject | 1 `spawnSync` blocks an in-process proxy → async `forgeScript` (Fact 4); 2 the test proves the quote is followed, not Sepolia's EVM → stated, Fact 7; 3 the RPC's quote is a new reliance → Security, docs clause, I2; 4 no global `--disable-block-gas-limit` → `startAnvil(extraArgs)`; 6 the rig's callers → Fact 11 by trace | 5 claim the proxy's port from the registry: `port: 0` is the repo's pattern for in-process test servers (`inbox-sync.test.ts:4`, `worker-backend.bun.test.ts:17`), and the kernel's port cannot collide; 6's rig run: Fact 11 covers the path, at 15 min less |
| final | Codex gpt-6.1-sol high, fresh session | conditional approve | 1 the Sepolia criterion rested on history → the dry run on Sepolia itself (Fact 13, in the P1 gate), Fact 7 narrowed to the tested anvil configurations; 2 `startAnvil` leaked its anvil and port on a failed start → cleanup before the rethrow, `beforeAll`/`afterAll` with a 90 s start | none |
| final-v | same session, resumed | **approve** | folds verified, no regression | — |
| impl | Codex gpt-6.1-sol high (root `bun test` red) | C, outside the lane | the leak filed as #83; a1 reported blocked, no bypass | A: the suite swaps in `Bun.fetch` (a compensating monkey-patch); B: a child-process driver (a contract for the leak alone) |
| fix r1 | Codex gpt-6.1-sol high + Opus 5.5 (same family) | 1 + 5 low | Codex 1 / Opus 4: `uninstallNodeGuard`'s doc read as if wrappers survived → rewritten; Opus 1: health wiring stays on the dropped state → one clause in that doc; Opus 2: two stale comments, a dead `setNodeGate(null)` → fixed, removed; Opus 3: `presto-session` teardown threw before the uninstall on a failed setup → `fake?.`; Opus 4: one comment repeated in 24 suites → deleted; Opus 5: "code deposit 7×" → "the portal's creation 7×" | none |
| fix r2 | Codex, same session resumed | **clean** | the six folds verified, no new material finding; converged in 2 rounds | — |
| a2 r1 | Codex gpt-6.1-sol high + Opus 5.5 (same family) | Codex **clean**; Opus 2 low | Opus 1: the gate's marker and the archived rows' lines differ from P2's text → recorded under Deviations; Opus 2: the row's date rested on K5's report alone → the lane's own reads (unverified 02:42 UTC, verified 22:45 UTC) pin it; converged in 1 round | — |

Size: about 230 lines against light's 150. The verbatim fix-loop rules, the test's specification, the dry run
and the evidence for two claims that did not hold carry the excess.

## Seeds (drafts; not run — the orchestrator owns execution)

```
/goal P1 of implementations-plan/deploy-1/plan.md marked ✓ with its gate's output in the transcript (the test failing on the gas assertion before the flag and passing after; the toolchain-less run skipped); codex fix loop converged on a1 (a resumed pass with no new material finding, quoted); PR against main open with Closes #80 and its checks green; then P2 and its PR with Closes #81 and the close-out archive commit (git show --stat) once a1 has merged and Etherscan shows both contracts verified; bun test and bun run lint exit 0.
```
```
/loop 15m Drive implementations-plan/deploy-1 forward: read plan.md and lessons/, run the next unchecked phase and its gate, then the post-implementation steps; start P2 only when a1 has merged and Etherscan shows both contracts verified; never run a keyed command, never merge; poll CI in bounded loops; after 3 failures on one step, stop and report.
```
