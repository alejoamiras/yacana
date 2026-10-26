---
plan: site-2
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
hardening: not scheduled
budget: "recon: 1 Sonnet sweep; codex gpt-6.1-sol at high; code-review off"
status: planned 2026-10-26 — codex r1 conditional approve (6 adopted); final fresh pass conditional approve (3 adopted) → resumed: approve; awaiting the orchestrator's approval
created: 2026-10-26
---

# site-2: a saved default is no choice; the previous origin

Over the 150-line target: two arcs' change maps, the audit ledger (§7) and the verbatim Codex rules (§8) carry
evidence that cannot be cut.

Two follow-ups of the move to V6:
- **a1.** "Use the default" stores no URL. A saved node equal to a retired default counts as no choice. So a
  returning visitor who saved V5's node boots on V6's default, and a later change of the default strands nobody.
- **a2.** The old origin stops naming a version. It becomes `previous.yacana.network` on the Worker
  `yacana-previous`. Every version move deploys the retiring version's last build there. The V5 Worker and its
  domain come down in an operator step.

## 1. Scope

- **Issues**: none. **Asks**: ask11 → a2. **Decisions**: P2-01 → a1.
- **UI impact (a1)**, P2-01 (owner, decision page 2, Option B): "A small follow-up change, in its own PR after the
  V6 merge: a saved node equal to a retired default counts as no choice, and "Use the default" stops saving a URL,
  so a later change of the default strands nobody. It needs one unit test and touches nothing the deployment
  pinned." On screen: a visitor who saved V5's node boots on the default instead of meeting "Cannot start". After
  a later "Use the default", the row reads "· default" once the page reloads. Nothing else changes.
- **UI impact (a2)**, ask11 (owner): "the only visible effect is the old-tab notice and any link to the old origin
  now naming previous.yacana.network."
- **Owner asks** (`OWNER-ASKS.md`):
  - OA1: the row right after "Use the default" — answered A by the owner (2026-10-26), built in a1: "compare
    normalized URLs in the row (and the five `onDefault` sites). The row says "· default" and drops the link at once."
  - OA2: one previous origin replaces the version before it — open with the owner; a2 waits for it.
- **ask11's check, amended once**: the once-only retirement section of `docs/upgrades.md` names `v5.yacana.network`
  and `yacana-v5`. An instruction that deletes a Worker must name it (§7 r1 #5).
- **Out**: the Ethereum RPC's "Use the default" (same pattern, no decision); any Cloudflare command; deployment
  records, `migration`, bridge, contracts; the rig's `v5.yacana.test`; the role names `versioned`, `old`,
  `oldAppOrigin`, `dist-old`; the existing text of the `Archived —` sections.

## 2. Outcome & Quality Bar

- **For whom**: a returning visitor whose browser saved a node the site no longer defaults to. Also the operator of
  the next version move.
- **Excellent**:
  1. A load ignores a saved retired default, whatever its spelling (`https://h` or `https://h/`). "Use the default"
     leaves no URL behind. A custom node survives every save and load. One unit test proves all three.
  2. A move needs one `deploy -c previous/wrangler.jsonc` from the retiring version's checkout, with no DNS, Worker
     or `site.env` edit. Every step that redeploys from a kept checkout first checks what the origin serves.
- **Good enough**: archived docs keep their text; the rig keeps its names.

## 3. Assumptions

**Facts** (sources in `recon.md`):
- F1 `connection.ts` is the one writer of `yacana.connection`, and the three apps share it. Every "Use the default"
  path ends in `saveConnection`: `restoreDefaultNode` :46, `NodeTile.tsx:232` after the switch, `session.ts:825`.
- F2 The only default before V6 was `https://v5.testnet.rpc.aztec-labs.com` (git history of `site.env` and its
  predecessors).
- F3 `NodeTile` stores `URL.href`, so a bare host gains a slash. `restoreDefaultNode` stores the raw `site.env` value.
  A match must normalize both.
- F4 `defaultNodeUrl()` reads the env live, while `defaults` is captured at import. Vitest stubs after import.
- F5 Nothing in CI or Workers Builds reads `apps/site/v5/`. The old origin is deployed by hand (step 8).
- F6 `OldTabNotice` links `VITE_OLD_APP_ORIGIN`, and only when `/build.json` names another miner or rollup.
- F7 The guards accept `https://previous.yacana.network` (`config.ts:292-295`). The suffix
  `-yacana-previous.alejo-amiras.workers.dev` fits `PREVIEW_SUFFIX` (:265) and cannot match the apex's.
- F8 Cloudflare keeps a removed Custom Domain's certificate. Its docs say nothing of the DNS record.
- F9 Wrangler 4.127.1 skips auth on `--dry-run`, and the deploy handler still sends telemetry (Codex, §7 r1 #7).

**Inferences**:
- I1 ask11's "archived deployment records" include the `Archived —` sections of `docs/deployments.md`. No
  `deployments/*.json` names either host, so the narrower reading would exempt nothing.
- I2 After a1, no "Use the default" stores a URL. The retired list still matters for values saved before a1, and
  for a custom URL that later became the default. So append every retired default; it is one line per move.
- I3 One origin serves one version. A move replaces the version before it. Holders of that version lose its page
  only if it still proves when the next flip comes. The FAQ promises the old app "while it [proves]"
  (`faq-copy.ts:83`). → OA2.

**Asks**: none open.

## 4. Architecture & Implementation (compact)

**a1**, in `connection.ts`:
- `RETIRED_DEFAULT_NODES = ['https://v5.testnet.rpc.aztec-labs.com']`. Its comment names the obligation (I2).
- `sameNode(a, b)`: `new URL(a).href === new URL(b).href`, false on a parse error.
- `fromStorage` drops a stored `nodeUrl` that equals a retired default.
- `saveConnection` stores no `nodeUrl` when the caller's own `c.nodeUrl` equals the current default
  (`defaultNodeUrl()`, F4) or a retired one. A merged value it only carries over stays as it is, so an RPC save
  changes nothing about the node. The write-landed check stays (`"{}"` is a write).
- Callers stay as they are; the one write carries the rule. `docs/upgrades.md` step 6 gains the append.
- *Not taken*:
  - A `site.env` key: plumbing for one reader, and P2-01 says "touches nothing the deployment pinned".
  - Per-caller fixes: three copies of the rule.
  - Dropping a stored *current* default on read: a label change beyond P2-01 (§7 r1 #1).
  - Falling back from a failing saved node at boot: a recovery policy that overrides real choices.

**a2**:
- `git mv apps/site/v5/wrangler.jsonc apps/site/previous/wrangler.jsonc`. Set `name` to `yacana-previous` and the
  route to `previous.yacana.network`. The comments name `-c previous/wrangler.jsonc` and the one-version rule.
- `deployments/site.env:18-21`: the origin and suffix move to `previous`, and the comment names `yacana-previous`.
- Tests:
  - `config.test.ts:171,194,203,213` and `shell.vitest.tsx:154-166` move to `previous`.
  - `gallery.vitest.tsx:434` moves to `previous` and asserts the notice's `href` (§7 r1 #6).
- Comments: `assemble.ts:3-4,22`, `host.ts:3`, and `origin.e2e.ts:2` (stale: the rig uses `v5.yacana.test`).
- Site E2E: `run-setup.ts:5,104,113`, `run.ts:5`, `site.e2e.ts:111` move to `previous.localhost`.
- `CLAUDE.md:18,73`.
- `docs/upgrades.md` steps 8, 11, 12 and "Then":
  - The kept worktree is `../yacana-previous`, and the deploy is `bun run site:wrangler deploy -c previous/wrangler.jsonc`.
  - The move replaces the version before it (I3).
  - Before step 11's or 12's redeploy, `https://previous.yacana.network/build.json` must name the worktree's miner
    and rollup version. If it names a later one, remove the stale worktree instead.
  - The origin is never taken down at a deadline; only the worktree goes.
  - The first deploy, at the next move, creates the domain. Until then nothing serves it.
- `docs/upgrades.md`, new "Once: retire the V5 origin" (amended check):
  1. In the dashboard, remove the custom domain `v5.yacana.network` from `yacana-v5`.
  2. Delete its DNS record if it stayed, and its edge certificate.
  3. Delete the Worker by name in the dashboard, never with `wrangler delete` from `apps/site`, whose config names
     the apex `yacana`.
  4. Check that `https://v5.yacana.network` no longer answers.
- `docs/deployments.md`:
  - The origin paragraph (:192-206) and its heading describe the previous origin.
  - Its dated V5 history moves word for word to the end of `Archived — 2026-09-13`.
  - :242 and :315 stay as written.
- `docs/roadmap.md:28`: "its Worker" replaces the name.

## 5. Security & Adversarial Considerations

- **Stored input**: `yacana.connection` is same-origin and holds no secret; a script that writes it owns the page.
  a1 only narrows what a stored value does. A crafted URL meets the same probe and guard. `sameNode` never throws
  on garbage. The e2e query pin is untouched.
- **Cloudflare**: deleting a Worker is irreversible, and the lead runs no Cloudflare command. The runbook names
  the Worker and keeps `wrangler delete` away from the apex's config. It removes the stale certificate and checks
  the end state. The `build.json` check stops a stale worktree from overwriting a later version.
- **Origins and keys**: `previous.yacana.network` sits under the RP ID `yacana.network`, so the apex's passkeys
  restore there (restore only, `host.ts`). `workers_dev` stays off. Previews fit only their own suffix.
- **Supply chain / crypto**: no dependency or cryptographic change.

## 6. Phases

### Phase 1 (arc a1): a saved default is no choice ✓
1. Apply §4 a1.
2. Add `packages/web-kit/src/browser/connection.test.ts` with one test:
   - Stub `localStorage` with a Map, and set `VITE_AZTEC_NODE_URL=https://node.example` around the calls.
     Restore both afterwards.
   - Warning: another suite may have loaded the module first, with other `defaults` (§7 final #1). So compare a
     load only with the same module's load from empty storage, never with a literal default.
   - A stored V5 default with a slash loads as from empty storage, and the stored RPC stays.
   - A stored current default with a slash loads as stored.
   - Saving the current default (slash form) or the V5 default returns true and stores no `nodeUrl`; the RPC stays.
   - A stored current default with a slash stays byte for byte after a save of the RPC alone.
   - Control: a custom node is stored and loads.
3. In `node-tile.vitest.tsx:120`, add an assertion: after "Use the default", the stored JSON has no `nodeUrl`.
3b. OA1 = A: export `isDefaultNode(url)` (today's default, compared normalized) from `connection.ts`. Use it in
    `NodeTile.tsx:71` and the five `onDefault` sites (`apps/web-miner/src/App.tsx:101`, `routes/Stats.tsx:43`,
    `apps/web-stats/src/App.tsx:114`, `apps/web-landing/src/App.tsx:80`, `sections/HeroLive.tsx:66`). The one unit
    test reads it in both spellings. One `node-tile.vitest.tsx` test shows the row read "· default" with no link
    for a slash-spelled default, and "· custom" with the link for another node (control).
4. Revert the read rule, then the write rule. The new test must fail each time. Log both runs.

**Validation gate**: `bun run lint`, `bun run typecheck`, `bun test`, `bun run test:components` and
`bun run --cwd apps/web-miner test:replay` exit 0 (the replay lane added by the orchestrator at approval). Step 4's
two red runs are in `lessons/phase-1.md`. Layers: lint/typecheck, unit, component. E2E: none. No spec moves, and
the unit test covers this storage logic; the PR's CI runs the shards.

### Phase 2 (arc a2): the previous origin
1. Apply §4 a2.
2. Run `git grep -n -I -E 'v5\.yacana\.network|yacana-v5|v5/wrangler' -- ':!implementations-plan'`. It must print
   only the `Archived —` sections of `docs/deployments.md` and the once-only section of `docs/upgrades.md`.
3. Run `git grep -n 'v5\.localhost' -- apps/site`. It must print nothing.
4. Build: `bun run site:build`, then `YACANA_APP_ROLE=old bun run site:build`.
5. Run `WRANGLER_SEND_METRICS=false bun run site:wrangler deploy --dry-run -c previous/wrangler.jsonc`. Run it with
   no Cloudflare token in the environment. It deploys and uploads nothing, and its exit 0 is the packaging check.

**Validation gate**:
- `bun run lint`, `bun run typecheck`, `bun test`, `bun run test:components`, both builds and the dry run exit 0.
- `apps/site/dist-old/build.json` says role `old`. `apps/site/previous/wrangler.jsonc` names `yacana-previous`,
  the route `previous.yacana.network` and `../dist-old`. The dry run prints no name, so this is read from the file.
- `bun run e2e:agent -- bun run site:e2e` passes at retry 0. The PR body gives its wall-clock before and after.
- Layers: lint/typecheck, unit, component, integration (assembly and its production guards), e2e (the site).

## 7. Audit log

**Codex round 1** (`gpt-6.1-sol`, high, session `01a178ac`): **conditional approve** (conditions: narrow a1's
read, keep archived history, bound the reused origin and the operator's steps). Six findings, all adopted:

| # | Finding (sev, label) | Disposition |
|---|---|---|
| 1 | Dropping a stored current default on read changes a label beyond P2-01 (medium, demonstrated) | read drops retired only; write drops what the caller saves |
| 2 | A kept worktree can redeploy over a later version; a deadline teardown would kill the shared origin (high, plausible) | the `build.json` precondition; never take the origin down; OA2 |
| 3 | Past-tensing archived lines rewrites history and can claim a retirement early (medium, demonstrated) | :242 and :315 untouched; the dated paragraph moves verbatim |
| 4 | The grep gate fails on two rig comments (low, demonstrated) | the stale `origin.e2e.ts:2` is fixed; the gate is split, and `v5.localhost` is checked in `apps/site` only |
| 5 | The once-only step contradicts ask11's literal check (medium, demonstrated) | the check is amended for that one section (§1) |
| 6 | The tests miss retired-on-write and the notice's link (low, demonstrated) | both added to the one test and the gallery spec |

On its seven disputed points it agreed: the constant over a `site.env` key; the step kept in `docs/upgrades.md`; the
rig and role names kept. On I2 it found the obligation overstated for defaults set after a1; the plan keeps the
one-line append, which also covers a custom URL that later became the default. On the dry run (F9) it noted that a
dry run needs no login, but telemetry still runs: hence `WRANGLER_SEND_METRICS=false`.

**Final fresh pass** (`gpt-6.1-sol`, high, session `01a178b6`; the first attempt `01a178b4` failed on model
capacity and was retried once): **conditional approve** (conditions: isolate the test from module caching, correct
the dry-run evidence, test an RPC-only save). Three findings, all adopted; it kept the six round-1 dispositions and
found no new owner ask:

| # | Finding (sev, label) | Disposition |
|---|---|---|
| 1 | Bun shares one module registry: `defaults` may come from an earlier suite (medium, demonstrated by a reproducer) | the test compares with the same module's empty-storage load; `bun test` runs it beside the Session suites |
| 2 | Wrangler's dry run prints no Worker name (low, demonstrated: `wrangler-dist/cli.js:150856`) | the name, route and assets are read from the config; the dry run stays the packaging check |
| 3 | No assertion holds the caller-only write rule (low, demonstrated gap) | an RPC-only save over a stored current default, in the same test |

Resumed (verification): **approve** — "No material regression found in these revisions. No settled disposition
needs reopening, and no additional owner ask is needed."

**Deviation in a1** (tree over plan): the full `bun test` exposed `stats-view/tests/runtime.bun.test.ts` reassigning
`process.env`, which detaches `import.meta.env` from every later suite. That suite now restores in place
(`lessons/phase-1.md`). The plan's module-cache warning holds as well.

## 8. Post-implementation

- Write comments to the bar as you code. Log attempts in `lessons/phase-N.md`. Run `agent-worktree status site-2
  "<gate>"` at each gate. Stop after 3 failures on one step.
- **Codex fix loop, per arc**:
  - Run `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` on the arc's
    diff against its base.
  - Send this plan, the arc map ("arc N of 2"), the adversarial ask and these two rules verbatim: *"Report bugs and
    small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new
    layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
    alone."* *"Audit the comments for value per character. Flag any comment that narrates what the code visibly
    does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a
    sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
    have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few,
    dense, and exact."*
  - Every prompt carries: "Never open, read, list, source or print `.env` or `.env.local`." and "Never open, list or
    search `~/.agents/orchy/` or `~/.config/`."
  - Resume the same session after each round's fixes. Stop when a round finds nothing material. Hard stop at 3,
    then surface.
  - A fix that adds state, a lifecycle, a protocol, a recovery policy or a contract is a plan change: stop.
  - Record each round in §7. Rerun the phase gate on the final head.
- **Close-out** (a2's final commits):
  - Run `git merge origin/main`, and read what changed in `index.md` and `lessons.md`.
  - Write `## Outcome` after the front matter: date, status, shipped, `Known limits:`, `Open items:`, seeds retired.
  - Promote a lesson only if one generalizes. Delete `STATUS.md`.
  - In its own commit, run `git mv implementations-plan/site-2 implementations-plan/archive/site-2`. Add one line to
    `archive/index.md`, and no `index.md` row.
- **Where open work lives**: a gap that outlives the plan → an issue with a `Record` link; a product call →
  `owner-decision`; a suspected weakness → a private draft advisory; a path needing unsupported conditions → a
  closed `known-limit` issue; rejected or done → an Outcome line.
- **Teardown** follows the orchestrator's last merge: `agent-worktree done site-2 --merged`, never forced.

## 9. Delivery

| Arc | Phases | Branch | PR title | Body |
|---|---|---|---|---|
| a1 | 1 | `worktree-site-2` (carries this plan) | `fix(web-kit): a saved default node is no choice` | P2-01 by id and text; no issue |
| a2 | 2, close-out | `site-2-previous`, from a1's final head | `feat(site): the previous origin, unversioned` | `Delivers ask11`; the operator's steps (§4 "Once" now; the first `previous` deploy at the next move); the amended check |

- Both PRs go against `main`, and each opens only after its gate and its Codex loop pass. The orchestrator merges in
  order.
- a2's PR says it builds on a1. After a1 merges, run `git merge origin/main` into a2, with no rewrite.
- No lanes: the arcs are small and serial.

## Seeds (not run: the orchestrator owns ELI5 and seeds)

- `/goal` Phases 1–2 ✓ with their gates quoted; each arc's Codex loop converged (quoted); PRs a1 and a2 open against
  `main` (`gh pr view`), a2 saying `Delivers ask11` and carrying the close-out's archive move (`git show --stat`).
- `/loop 15m` Drive `implementations-plan/site-2`: reality-check plan.md and the PRs; take the next step of §6 or §8;
  decide with Codex at high on `gpt-6.1-sol`; never merge, never run a Cloudflare command.
