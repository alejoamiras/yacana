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
status: a1 merged (#86); a2 amended 2026-10-26 after OA2 (the V5 retirement), in implementation
created: 2026-10-26
---

# site-2: a saved default is no choice; V5's old origin retired

Over the 150-line target: two arcs' change maps, the audit ledger (§7) and the verbatim Codex rules (§8) carry
evidence that cannot be cut.

Two follow-ups of the move to V6:
- **a1.** "Use the default" stores no URL. A saved node equal to a retired default counts as no choice. So a
  returning visitor who saved V5's node boots on V6's default, and a later change of the default strands nobody.
- **a2.** V5's old origin is retired. The repository stops carrying it: `apps/site/v5/` goes, and the V6 app
  carries no old origin until the next version move. The owner deletes the `yacana-v5` Worker and its custom domain
  in the Cloudflare dashboard. The per-version old origin (`v<N>.yacana.network`, deployed by hand at a move) stays.
  The first draft's shared `previous` origin was withdrawn by the owner (OA2); see "a2 as amended" below.

## 1. Scope

- **Issues**: none. **Asks**: ask11 → a2. **Decisions**: P2-01 → a1.
- **UI impact (a1)**, P2-01 (owner, decision page 2, Option B): "A small follow-up change, in its own PR after the
  V6 merge: a saved node equal to a retired default counts as no choice, and "Use the default" stops saving a URL,
  so a later change of the default strands nobody. It needs one unit test and touches nothing the deployment
  pinned." On screen: a visitor who saved V5's node boots on the default instead of meeting "Cannot start". After
  a later "Use the default", the row reads "· default" once the page reloads. Nothing else changes.
- **UI impact (a2)**, ask11 (owner, after OA2): "the versioned old origins stay, V5's comes down now, the V7-move
  preparation is filed as its own issue; the only visible effect is that nothing in the V6 app links V5 any more."
- **Owner asks** (`OWNER-ASKS.md`):
  - OA1: the row right after "Use the default" — answered A by the owner (2026-10-26), built in a1: "compare
    normalized URLs in the row (and the five `onDefault` sites). The row says "· default" and drops the link at once."
  - OA2: answered by the owner (2026-10-26): "the versioned old origins stay, one per retiring version; no shared
    "previous" origin." The planner's a2 is withdrawn. The V7-move preparation (the old-origin Worker deriving its
    name and route from the record) is #87, not this lane.
- **ask11's check** exempts implementations-plan/, docs history and the archived records. The once-only retirement
  note in `docs/upgrades.md` is history of that kind: it names what the owner deletes.
- **Out**: the Ethereum RPC's "Use the default" (same pattern, no decision); any Cloudflare command; deployment
  records, `migration`, bridge, contracts; the rig's `v5.yacana.test`; the role names `versioned`, `old`,
  `oldAppOrigin`, `dist-old`; the existing text of the `Archived —` sections.

## 2. Outcome & Quality Bar

- **For whom**: a returning visitor whose browser saved a node the site no longer defaults to. Also the operator of
  the next version move.
- **Excellent**:
  1. A load ignores a saved retired default, whatever its spelling (`https://h` or `https://h/`). "Use the default"
     leaves no URL behind. A custom node survives every save and load. One unit test proves all three.
  2. The V6 site builds, passes its artifact checks and its E2E with no old origin. Nothing in it links V5. An
     old-role production build without its own origin fails at build time, not as a page that restores nothing.
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
- F7 `VITE_OLD_APP_ORIGIN` is required and parsed today (`config.ts:188`, `url()`), and the production guard parses
  it (:292). Only `OldTabNotice.tsx:16` and `host.ts:19` read it at runtime: the notice hides its link and its
  old-app sentence when it is empty (:53, :62), and `versionedHost()` returns ''. No bridge dialog reads it (grep of
  `apps/`, `packages/`).
- F8 Cloudflare keeps a removed Custom Domain's certificate. Its docs say nothing of the DNS record.
- F9 Wrangler 4.127.1 skips auth on `--dry-run`, and the deploy handler still sends telemetry (Codex, §7 r1 #7).

**Inferences**:
- I1 ask11's "archived deployment records" include the `Archived —` sections of `docs/deployments.md`. No
  `deployments/*.json` names either host, so the narrower reading would exempt nothing.
- I2 After a1, no "Use the default" stores a URL. The retired list still matters for values saved before a1, and
  for a custom URL that later became the default. So append every retired default; it is one line per move.
- I3 (withdrawn with the shared origin: OA2 keeps one origin per version.)
- I4 An old-role build is served from its own origin, and `hostKind` finds `versioned` only by that value. Without
  it the old page reads its host as `unknown` and restores nothing. So a production old-role build must name one.

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

**a2 as amended** (the V5 retirement):
- `git rm -r apps/site/v5`.
- `deployments/site.env:18-21`: both old-origin values empty. The comment says they stay empty until this version
  retires to an origin of its own.
- `packages/web-kit/src/config.ts`: `VITE_OLD_APP_ORIGIN` may be empty; a value must still parse. The production
  guard checks a set value as before. A new `assertOldOrigin` refuses an `old`-role production build without one
  (I4). The docs of `SiteConfig.oldAppOrigin` and `vite-env.d.ts` say empty when none.
- Surfaces (F7): no code change. A gallery case shows the old-tab notice with no origin: the warning and Reload, no
  link, no old-app sentence.
- Tests:
  - `config.test.ts`: production accepts the empty pair. An old-role production build without an origin is refused.
    The examples move to `v6`.
  - `shell.vitest.tsx` and `gallery.vitest.tsx` take a `v6` example.
- Site E2E: the apex is built with no old origin, as production now is. The old role keeps its own (the mechanism).
  The existing old-tab check also asserts no link and no old-app sentence.
- Comments: `assemble.ts:3-4,22`, `host.ts:3`.
- `CLAUDE.md:18,73`.
- `docs/upgrades.md`:
  - Steps 8 and 11 and "Then" use `v<N>`. The Worker config `apps/site/v<N>/wrangler.jsonc` is written into the
    step. Its two `site.env` values are set in the retiring version's worktree before its old-role build.
  - A once-only note: V5's origin is retired, and the owner deletes the `yacana-v5` Worker and the custom domain
    `v5.yacana.network` in the dashboard, with its certificate. The owner deletes by name in the dashboard, never
    with `wrangler delete` from `apps/site`, whose config names the apex.
- `docs/deployments.md`: the origin paragraph (:192-206) describes the mechanism and says this deployment has
  none. Its V5 history moves verbatim to `Archived — 2026-09-13`, with a "Retired 2026-10-26" line.
  `:242`, `:315` and `docs/roadmap.md:28` stay (history).
- *Withdrawn*: the shared `previous` origin (the whole first-draft a2, §7 r1 #2, #4, #5, and the final pass's #2),
  by the owner's OA2 answer.

## 5. Security & Adversarial Considerations

- **Stored input**: `yacana.connection` is same-origin and holds no secret; a script that writes it owns the page.
  a1 only narrows what a stored value does. A crafted URL meets the same probe and guard. `sameNode` never throws
  on garbage. The e2e query pin is untouched.
- **Cloudflare**: deleting a Worker is irreversible, and the lead runs no Cloudflare command. The note names the
  Worker and keeps `wrangler delete` away from the apex's config. It removes the stale certificate and checks the
  end state (`https://v5.yacana.network` no longer answers).
- **Origins and keys**: with no old origin, no host reads as `versioned`, so restore-only never applies on the
  apex. An old-role build without its origin fails closed at build time (I4).
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

### Phase 2 (arc a2): V5's old origin retired ✓
1. Measure `bun run e2e:agent -- bun run site:e2e` on the base, for the wall-clock before.
2. Apply §4 a2.
3. Run `git grep -n -I -E 'v5\.yacana\.network|yacana-v5|v5/wrangler' -- ':!implementations-plan'`. It must print
   only `docs/deployments.md`'s `Archived —` sections, `docs/roadmap.md:28` and the once-only note in
   `docs/upgrades.md`.
4. Build: `bun run site:build` must exit 0 (production, no old origin, the artifact checks). Then
   `YACANA_APP_ROLE=old bun run site:build` must fail with the old-origin guard's message (never-happens), so the
   checks run with and without the guard tripping.

**Validation gate**:
- `bun run lint`, `bun run typecheck`, `bun test`, `bun run test:components` and
  `bun run --cwd apps/web-miner test:replay` exit 0. Step 3 prints only what it names; step 4 behaves as stated.
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

**a1 fix loop, round 1** — Codex (`gpt-6.1-sol`, high, session `01a178e5`): 2 findings. Opus (`general-purpose`,
beside it): 3 findings.

| # | Finding (sev, label) | Disposition |
|---|---|---|
| C1 | A non-string stored `nodeUrl` stops a page from starting (medium, demonstrated, pre-existing at `d58a2d2`) | known limit #85, closed: no build writes one; a same-origin writer owns the page |
| C2 | The test's "control" comment narrates (low) | deleted |
| O1 | Step 6 of the runbook lacks the append (medium, demonstrated) | added to `docs/upgrades.md` step 6 |
| O2 | A retired default that still serves could never be chosen again (low, needs conditions that do not exist yet) | the append is conditional: "unless the old default also serves" the new deployment (runbook and code comment) |
| O3 | Two comments garbled or historical (low) | rewritten |

Round 2 (resumed `01a178e5`, on `10340ed..2281c82`): **clean** — "no new material defect"; C1's known-limit
disposition stands. Converged in 2 rounds. Final head gate: lint 0, typecheck 0, `bun test` 704 pass / 0 fail,
`test:components` 0, `test:replay` 9 passed.

**a2 fix loop, round 1** — Codex (`gpt-6.1-sol`, high, session `01a179c5`): 1 finding. Opus (`general-purpose`,
beside it): 4 findings.

| # | Finding (sev, label) | Disposition |
|---|---|---|
| C1 | Three test comments narrate (low) | two deleted; the E2E one cut to the cross-file fact (`run-setup.ts` builds the apex with no old origin) |
| O1 | Step 8 had the old origin edited and committed in a detached worktree: a trusted origin serving an unreviewed commit, and the retiring apex build linking its tabs nowhere (medium, plausible) | the pair and `v<N>/wrangler.jsonc` reach `main` before step 6, as V5's did from 2026-09-21; step 6 empties them; the pinned `bun run site:wrangler`. No owner ask: V5's move ran so |
| O2 | The guard accepted `https://v6.localhost`, `https://yacana.network.` and any non-subdomain (low, needs an operator's typo) | one check: https and a subdomain of the RP ID; four refused cases; red with it reverted |
| O3 | No test held the old role's landing pairing once `site.env` names no origin (low, demonstrated) | `assertLanding` exported and tested for role `old`; red with the check narrowed to the apex |
| O4 | Two archived lines stay present tense (low) | rejected: round 1 #3 keeps archived lines untouched, and they turn false only when the owner deletes the Worker |

Round 2 (resumed `01a179c5`, on `c6b82e7..44141af`): **clean** — "No new material findings"; it probed the subdomain
check (case, trailing dot, ports, IDN) and matched `assertLanding` against the inline code on 72 cases. Converged in
2 rounds. Final head gate: lint 0, typecheck 0, `bun test` 704 pass / 0 fail, `test:components` 0, `test:replay`
9 passed, `site:build` 0, the old-role build 1 with the guard's message, `site:e2e` 3 passed (1.4 min suite, 121 s
with the network; before: 2.8 min, 207 s).

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
| a2 | 2, close-out | `site-2-a2`, from `origin/main` after #86 | `feat(site): retire v5's old origin; the v6 app carries none` | `Delivers ask11`; P2's decisions quoted; the owner's dashboard step |

- Both PRs go against `main`, and each opens only after its gate and its Codex loop pass. The orchestrator merges in
  order.
- Deviation: a2 branches from `origin/main` once #86 merged, by the implementer brief's rule, not from a1's head.
- No lanes: the arcs are small and serial.

## Seeds (not run: the orchestrator owns ELI5 and seeds)

- `/goal` Phases 1–2 ✓ with their gates quoted; each arc's Codex loop converged (quoted); PRs a1 and a2 open against
  `main` (`gh pr view`), a2 saying `Delivers ask11` and carrying the close-out's archive move (`git show --stat`).
- `/loop 15m` Drive `implementations-plan/site-2`: reality-check plan.md and the PRs; take the next step of §6 or §8;
  decide with Codex at high on `gpt-6.1-sol`; never merge, never run a Cloudflare command.
