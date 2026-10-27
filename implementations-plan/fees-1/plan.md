---
plan: fees-1
tier: mid
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
hardening: not scheduled
budget: "recon: 2 Sonnet sweeps; codex gpt-6.1-sol at high; code-review off"
status: drafted 2026-10-27; final Codex pass approve; awaiting the orchestrator's approval
created: 2026-10-27
---

# fees-1: the web miner's "Fund fees" flow, three options behind a development flag

Over the 350-line target: the options table, the capture matrix and the two-reviewer ledger (§7) are evidence the
owner's pick and the audits rest on.

On the live network the sponsored fee payment contract pays every page transaction. A visitor holds no Fee Juice,
and every Aztec transaction needs some. This lane designs the flow that gets an account Fee Juice: pick a token on a
chain, read a quote, watch the trade's phases until the Fee Juice arrives. The design comes before the SDK behind it
exists. a1 builds three options in the real product, behind a flag production never carries, on a mocked provider.
A shots lead captures them light and dark, and the owner picks one on a decision page. a2 keeps the pick, still
mocked and still behind the flag.

## 1. Scope

- **Issues**: none. **Asks**: ask18 → a2 (a1 delivers no ask). **Owner decisions recorded**: none.
- **UI impact (a1)**: no recorded decision applies, and nothing reaches a visitor. The flow exists only when
  `VITE_DEV_FUND_FEES` resolves, which `loadSiteConfig` never does in production. `apps/web-miner/tests/fund-fees-absent.bun.test.ts`
  proves it: a production build with the flag in its env has no `apps/web-miner/src/fees/` module in any chunk.
- **UI impact (a2)**: the owner's pick on the lane's decision page, quoted by id and text in the a2 prompt; still
  behind the flag, so still nothing a visitor sees.
- **Owner asks** (`OWNER-ASKS.md`): OA1, what the flow says becomes public; OA2, what the visitor asks for and what
  Fee Juice buys; OA3, when the entry shows. Each ships now in the form written there, and none blocks a1.
- **Out**: the real provider and its SDK, any network call, LI.FI code, mainnet, persistence (a reload forgets a
  mocked trade), the sponsored fee payer and every real transaction path, Presto, the bridge dialogs' behaviour, the
  claim path's failure handling, the flag flip.

## 2. Outcome & Quality Bar

- **For whom**: first the owner, who picks from screenshots and one line per option. Later a miner on a network
  with no sponsor, who must hold Fee Juice before a win can be claimed.
- **Excellent**:
  1. Each option reaches every state through a URL and a click recipe (§6, Shots), in both themes: entry, picker,
     quote with its countdown, the wallet's ask, each phase running or late, each failure, and done.
  2. A failure says what happened, what was not lost, and the one thing to do. A retry reruns only the failed
     phase, and a finished phase never runs twice. The machine's specs prove both.
  3. A production build carries none of it (the bundle test). From navigation to done, the flow adds no fetch to
     what the same page fetches without it (the scenario's request log).
  4. The three options share one provider, one machine and one set of test ids. So a2 is a deletion plus polish,
     and the scenario survives it but for its loop and title.
- **Good enough**: mock data is static and plausible, not priced. Copy follows the dialogs' tone, and a2 polishes
  the picked option's copy. No persistence, no real L1 wallet.

## 3. Assumptions

**Facts** (sources in `recon.md`):
- F1 The sponsored FPC pays every transaction (`src/wallet.ts:147-160`, `src/feePayer.ts`). Nothing reads a Fee Juice
  balance. Copy promises "no fee" (R1).
- F2 SDK 6.0.0's real path: approve, then `depositToAztecPublic(to, amount, secretHash)` on L1, then the L1→L2 message,
  then a claim on Aztec inside the first transaction it pays for (`FeeJuicePaymentMethodWithClaim`). The phases
  follow it: swap or bridge, deposit, message, claim.
- F3 A win mints only while its epoch is open (`claim-check.ts:73-88`). An epoch closes on its fourth claim, or by a
  roll once it has been open for `T_MAX` (`main.nr:231-253`); difficulty targets 300 s epochs (`params.nr:2-3`). A
  claim's transaction expires 600 s after its anchor, and a new attempt re-anchors (`controller.ts:1051-1063`). A
  crossing takes "a few minutes" (`FromEthereum.tsx:187`). So the epoch of a win found without fees may close
  before Fee Juice arrives.
- F4 Funding one's own fees makes three things public: the deposit names the Aztec account on Ethereum, the Fee
  Juice balance is public, and each self-paid transaction names the account as fee payer (R4).
- F5 Signed out, Mine (with the balance card) and Settings render, and Wallet redirects to Mine (R5).
- F6 The cockpit's `ROWS` covers zero to three cards above it (R6).
- F7 The production-only config and the define follow `VITE_E2E_PROVERLESS` (`config.ts:184,210`, `config.test.ts:68`).
  Vite puts every `VITE_*` process variable into `import.meta.env` unless a define overrides it, so the define is
  the guard that carries weight.
- F8 A miner build takes about 2 s in CI (`proverless-marker.bun.test.ts`, run 40585067152). The replay lane ran 9 tests
  in 1.2 min, and its job took 2 min.
- F9 A new replay-only test needs only its `REPLAYED` entry. The "original nineteen" sum is untouched (R8).
- F10 The replay fixture aborts and records any request off the app origin and the recording, and any worker or
  websocket (`fixtures.ts:56-73`). It passes same-origin requests.
- F11 Vite 8.2.2 drops a define-guarded `import()` when the comparison and the `import()` sit in one module, inline or
  through a module-level const. An `import()` guarded by a const imported from another module leaves an orphan
  chunk. Toy builds in the lane's scratch folder showed both, and Codex reproduced the second.

**Inferences** (I1 became F11):
- I2 One scenario that loops the three options takes about 65 s: about 12.6 s of mock time per option, plus boots,
  typing, the Settings hop and one baseline load. Measured in P4 against a 70 s ceiling.
- I3 The views survive a real provider, because they read phase events. The interface itself is provisional: its
  retry guarantee is the mock's. A real provider needs five things: receipts and reconciliation (a `run()` that
  broadcast and lost track would deposit twice); the deposit's outputs (claim secret, message hash, leaf index),
  journaled before the L1 transaction; the claim as the page wallet's own transaction; the source wallet's address;
  and two signatures for approve and deposit. That is separate approved work, listed in the close-out's issue.

**Asks** (no owner to ask, so each runs on its working assumption):
- A1 Mock chains and tokens. Assumed: Ethereum (ETH, USDC, Fee Juice), Base (ETH, USDC), Arbitrum (ETH, USDC), with
  fixed balances and rates.
- A2 (moved to OA2: what the visitor types shapes every quote screen.)
- A3 Signed out, the flagged build uses a fixed stand-in account, so the flow is reachable without a node. The
  decision page says the captures are signed out with a stand-in.

## 4. Architecture & Implementation

**Shape.** All flow code lives in `apps/web-miner/src/fees/`, reached only through one gate file. Three production
files mount a slot each, and in production every slot is `null`.

```ts
// src/fees/provider.ts: provisional (I3); a1 and a2 ship only `mock.ts` behind it
export type Phase = 'swap' | 'deposit' | 'message' | 'claim';
export interface Chain { readonly id: number; readonly name: string }
export interface Token { readonly chainId: number; readonly address: string; readonly symbol: string;
  readonly name: string; readonly decimals: number; readonly balance: bigint }
export interface Cost { readonly label: string; readonly amount: bigint; readonly symbol: string; readonly decimals: number }
export interface QuoteStep { readonly phase: Phase; readonly etaSeconds: number; readonly signs: boolean; readonly via?: string }
export interface Quote { readonly id: string; readonly from: Token; readonly amountIn: bigint;
  readonly feeJuiceOut: bigint; readonly feeJuiceMin: bigint; // 18 decimals
  readonly costs: readonly Cost[]; readonly steps: readonly QuoteStep[]; readonly expiresAt: number } // unix ms
export type PhaseEvent = { kind: 'signing' } | { kind: 'sent'; tx: string } | { kind: 'late' };
export type FailureReason = 'rejected' | 'expired' | 'failed';
export class FundingError extends Error { constructor(readonly reason: FailureReason, message: string) }
export interface FeeFundingProvider {
  chains(signal: AbortSignal): Promise<readonly Chain[]>;
  tokens(chainId: number, signal: AbortSignal): Promise<readonly Token[]>;
  quote(from: Token, amountIn: bigint, recipient: string, signal: AbortSignal): Promise<Quote>;
  /** Resolves when the step is done; rejects with FundingError. Running a failed step again is the retry. */
  run(phase: Phase, quote: Quote, on: (e: PhaseEvent) => void, signal: AbortSignal): Promise<void>;
  feeJuiceBalance(account: string, signal: AbortSignal): Promise<bigint>;
}
```

- **`mock.ts`**: `mockProvider(script, timing)`, importing only `provider.ts`. A quote takes 0.7 s and lives 30 s. A
  wallet ask takes 1.2 s. Swap and deposit take 1.5 s each, the message 2.5 s, the claim 2 s. The quoted ETAs read
  like real ones (about 6 min in all). The Fee Juice token on Ethereum has no swap step. `scriptFrom(search)` reads
  two switches with closed vocabularies, and anything else reads as none:
  - `fees-fail`, each injected once: `expired` (the first step refuses the quote); `rejected` (the first wallet ask
    is refused: the swap's on a swap route, the deposit's when the token is Fee Juice); `late` (the message reports
    late at 1.5 s and finishes at 5 s); `claim` (the claim fails).
  - `fees-hold`: `sign` (the first wallet ask never answers), or a phase name (that phase never finishes after its
    signature). A hold ends only on abort. With `fees-fail=late`, the held message still reports late first.
- **`machine.ts`**: a pure reducer with no clock of its own (`now` rides in events).
  - States: `idle | pick | quote{token, amountIn, quote|null, refreshed, error} | trade{quote, steps: StepState[] (the quote's order), failure|null} | done{quote, received}`.
    `StepState.status` is `todo | signing | running | late | done | failed`. Nothing is named `Step`, which ui exports.
  - Events: `open, choose, amount, quoted, quoteFailed, lapse, back, confirm, started, step, stepDone, stepFailed, retry, reset`.
  - `next(state)` names the phase the runner must start: the quote's first step not done, with none in flight and
    no failure.
  - `confirm` on an expired quote returns to `quote` with no quote. `stepFailed(expired)` before any step is done
    returns to `quote` with `refreshed`: the quote ran out, which is not a failure. `refreshed` stays until the next
    confirm or input, so its note holds still for a capture.
  - `retry` resets only the failed step to `todo`. When nothing has landed and the quote has expired, it returns to
    `quote` instead. `late` holds until the step is done.
  - Invariants: a done step never leaves `done`; at most one step is in flight; `done` follows the last step.
- **`run.ts`**: `FundingRun`, one per tab, created by `Slot.tsx` on first use. It holds the state for
  `useSyncExternalStore`, starts `provider.run` for `next(state)` with an `AbortController`, and dispatches the
  outcome. It re-quotes on the amount (debounced 300 ms) and when a shown quote expires. `reset()` aborts what is in
  flight. An outcome counts only while its controller is current, and a quote only while its token and amount match
  the state's. Recon's verdict was an atom; a tab singleton is needed because B's card must outlive a route change.
- **Shared views**:
  - `parts/TokenPicker.tsx`: a chain `Segmented`, a search `Input`, token rows with balances.
  - `parts/QuoteView.tsx`: `AmountField` + `AmountBelow`, checked by `amountRefusal`/`parseAmount` from
    `features/withdraw-form.ts`. Then `Row`s: you get (about, at least), costs, arrives in, "new quote in 0:24".
  - `parts/Choose.tsx`: the picker-then-quote screens A's and B's dialogs share, and `Held`, the account's Fee
    Juice, remounted when a trade lands.
  - `views.tsx` maps state to `Stepper` steps, `Trail` items or `Timeline` items; each phase's name is a span
    carrying the test id and the machine's status.
  - `copy.ts` holds phase labels and failure lines, with no ✦ (nothing proves).
  - Test ids every option shares: `fees-entry`, `fees-search`, `fees-token-<symbol>`, `fees-amount`,
    `fees-quote`, `fees-countdown`, `fees-go`, `fees-step-<phase>` (`data-state`: the machine's status),
    `fees-refreshed`, `fees-failure`, `fees-retry`, `fees-done`, `fees-held`. A chain is the `Segmented`'s radio by
    its name ("Base"): `Segmented` takes no per-option test id, and ui stays untouched.
- **The gate** `src/fees-gate.ts` is the only production-reachable file. One expression holds the define comparison,
  the query and the `import()` (F11):
  `FeesSlot = import.meta.env.VITE_DEV_FUND_FEES === '1' && option ? lazy(() => import('./fees/Slot')) : null`.
  `feesOption` is `?fees=a|b|c`, read once at load and null otherwise. Read once, it survives in-app navigation.
  With the flag on and no `?fees=`, nothing loads, so the other replay tests are unchanged. If a real build ever
  keeps the chunk, the named fallback is a production-only `resolve.alias` of the Slot to an empty module, as
  `vite-base.ts:206-216` stubs the provers.

**The options.** They differ in where the flow lives and how the phases show. All three share the machine, the
picker and the quote.

| | Where it lives | Phases shown as | Failure and late | Reuses |
|---|---|---|---|---|
| **A · the wallet's dialog** | A "fees" line under the cockpit's balance (`BalanceCard`): "fees · none · Fund fees". Then the 440 px `TxDialog`: picker, quote, progress. Reopening from the line shows the progress; with the dialog closed, the line names the running phase. | The vertical `Stepper` (the bridge dialogs' grammar): elapsed time on the right, the active step's line, a `Foot` "You can close this". `locked` while the wallet is asked. | The failed step in red, an `Alert` with what happened and what was kept, `Primary` "Try again" (or "Get a new quote"). Late: the step in `warn`. | `TxDialog`, `Row(s)`, `Actions`, `Foot`, `Primary`, `Quiet`, `Back`, `AmountField`, `Stepper`, `Alert`, `Note` |
| **B · before you mine** | A `HeroCard` above the cockpit, where the upgrade card sits: "Fund fees before you mine". One line says why (a win counts only while its epoch is open, and the epoch may close before Fee Juice could arrive). Actions: "Fund fees" and "How it works". Picker and quote open in the 440 px dialog; on confirm the dialog closes and the card carries the trade. | The card's `Trail` of stations (swap › deposit › crossing › claim › ready), one status line under it, the elapsed time. | Tone `bad`, the title says what failed, the action is "Try again". Late: tone `warn`. Done: tone `ok`, "Fees ready: 12.4 Fee Juice", and Dismiss returns the card to its entry. | `HeroCard`, `Trail` (the upgrade card's grammar), A's dialog screens for picking and quoting |
| **C · a fees tile in Settings** | A full-width "fees" tile under the network tile: a `Kpi` of Fee Juice, then the form inline (a picker in a `Popover` with search, `AmountField`, the quote as an `AmountBlock`). After confirming, the form gives way to the progress. | A horizontal `Timeline` (the stats bridge page's grammar), each phase's line under its dot. | The dot goes `bad`, and a `Note tone="bad"` holds the action. Late: the phase's line says so (`Timeline` has no warn). Done: the `Kpi` updates. | `Tile`, `Kpi`, `AmountBlock`, `Timeline`, `Note`, `Popover`, `Input` |

**Recommendation: B.** The stop that costs a miner is a win's claim. A win counts only while its epoch is open,
epochs target 5 minutes, and a crossing takes minutes (F3). So the flow belongs before Start, on the page a
miner watches, and B is the one option that stands before Start. That placement is the planner's judgment, not a
measurement. B's progress stays in view while mining runs, in the upgrade card's grammar. A is the cheapest to keep,
being the bridge dialogs' own grammar, but its entry is one line of the balance card. C suits a later network where
a sponsor and own fees coexist and fees become a setting, but Settings is off the miner's path.

**File map.**
- New: `src/fees-gate.ts`, `src/fees/{provider,mock,machine,run,copy}.ts`, `src/fees/{Slot,views}.tsx`,
  `src/fees/parts/{TokenPicker,QuoteView,Choose}.tsx`, `src/fees/options/{A,B,C}.tsx`, `src/fees/machine.test.ts`,
  `src/fees/fees.vitest.tsx`, `tests/fund-fees-absent.bun.test.ts`, `e2e/replay/fund-fees.replay.ts`.
- Modified: `packages/web-kit/src/config.ts` (`devFundFees`, the define), `config.test.ts`, `browser/vite-env.d.ts`;
  `src/components/BalanceCard.tsx` (slot `balance`); `src/routes/Mine.tsx` (slot `cockpit`, a fifth `ROWS` entry,
  the count); `src/routes/Settings.tsx` (slot `settings`); `e2e/replay/setup.ts` (`VITE_DEV_FUND_FEES: '1'`);
  `e2e/proof-inventory.ts` (`REPLAYED`).
- a2 deletes the two options not picked, their slots and spec cases, and updates the `apps/web-miner` row of
  `CLAUDE.md`.

**Trade-offs not taken**: outline Y (D1); a trade stream instead of `run(phase)` (D2); a clock-driven "late" in the
machine (D3); a string marker scanned in the artifact (D4); a visual gate with baselines (D5); the artifact config
refusal (D6).

## 5. Security & Adversarial Considerations

- **Threat model**: the mock leaking to production. A visitor would see a "trade" that moves nothing. No funds are
  at risk, because nothing asks a wallet, but the screen would mislead. Visitor safety does not hang on the chunk's
  absence: in production the gate is `null` at runtime either way. The absence is the ask's own check.
  - Production config takes no env, so `devFundFees` is false there, and the define writes `""` over any env value.
  - The define folds the gate to `null`, and the `import()` goes with it (F11).
  - The bundle test is the evidence. It reads every chunk report a production build writes (the page's and the
    Worker's), and no `apps/web-miner/src/fees/` id may appear in any chunk.
- **Input at a trust boundary**: `fees`, `fees-fail` and `fees-hold` are query input read only in flagged builds,
  against closed vocabularies; anything else is off. React escapes every string the mock returns.
- **No network, no wallet**: `src/fees/` imports no networked module: no wagmi, no viem transport, no node client,
  no wallet, no direct `fetch`. Pure helpers such as `withdraw-form`'s amount parsing are fine. The replay fixture
  fails the scenario on any request off the app origin, any worker or any websocket (F10). The page fetches
  same-origin files by itself at boot (the pinned CRS, the miner artifact, the slot table, `/build.json`). So the
  scenario first loads the page without `?fees=` and keeps the same-origin paths it fetched. Then, from navigation
  to done, every fetch or XHR must go to the recording's node, to one of those paths, or to `/build.json`.
- **Least privilege, supply chain, cryptography**: no new dependency, secret, workflow or permission. No
  cryptography: mock hashes are fixed strings.
- **Domain risks the real lane inherits** (recorded in the close-out's issue, not built):
  - Privacy (F4): funding one's own fees links the L1 wallet to the account, and makes the account's transactions,
    private claims included, attributable to it as fee payer (OA1).
  - Loss: a real deposit's claim secret must be journaled before the L1 transaction, as the bridge does
    (`FromEthereum.tsx:147`), or the Fee Juice cannot be claimed. A lost receipt must not deposit twice (I3).
  - Swaps: slippage (`feeJuiceMin` is in the interface for it), approval scope, a front-run route.

## 6. Phases

### Phase 1 (a1): the flag and its proof ✓
1. Add `devFundFees: mode !== 'production' && env.VITE_DEV_FUND_FEES === '1'` to `SiteConfig`. Add its define and its
   env type. Add one `config.test.ts` case: production ignores it, and dev and e2e honour it.
2. Write `src/fees-gate.ts`, and a `src/fees/Slot.tsx` that renders nothing yet. Mount the slot in `BalanceCard`,
   `Mine` and `Settings`, each as `{FeesSlot && <Suspense fallback={null}><FeesSlot at="…" /></Suspense>}`, so a
   flagged build reaches it.
3. Write `tests/fund-fees-absent.bun.test.ts`. It runs two builds with `YACANA_MODULE_REPORT` set to a temporary
   folder, and reads every `*.chunks.json` there:
   - an e2e build with the flag: some chunk carries `apps/web-miner/src/fees/Slot.tsx` (the success control);
   - a production build with `VITE_DEV_FUND_FEES=1` in the env: no chunk carries any `apps/web-miner/src/fees/` id.
- **Validation gate**: `bun run lint && bun run typecheck && bun test packages/web-kit apps/web-miner/tests/fund-fees-absent.bun.test.ts`.
  Pass: exit 0, both new cases green. Then break it on purpose: make the gate's condition `true`, see the
  production case fail, and revert. Layers: lint, typecheck, unit, build.

### Phase 2 (a1): the provider, the mock, the machine, the runner ✓
1. Write `provider.ts`, `mock.ts`, `machine.ts` and `run.ts` as in §4.
2. Write `machine.test.ts` (Vitest, pure, also run by `bun test`). It holds five cases, each with a success control:
   - a swap route and a direct route run every step in order to `done`;
   - a failed claim retries only the claim, and no done step reruns;
   - `expired` before any step lands returns to a fresh quote, and after the swap lands a retry continues;
   - `late` shows, then clears on done;
   - `scriptFrom` maps hostile and unknown values to none.
3. Write the runner's case in `fees.vitest.tsx`, on fake timers. `reset` aborts the step in flight, and at most one
   `run` is pending. A completion or a quote that arrives after `reset`, or for an amount since changed, changes
   nothing.
- **Validation gate**: `bun run lint && bun run typecheck && bun run --cwd apps/web-miner test:components && bun test apps/web-miner/src/fees`.
  Pass: exit 0, the six new cases green. Layers: lint, typecheck, unit.

### Phase 3 (a1): the three options ✓
1. Write `parts/`, `views.tsx`, `copy.ts`, `options/A.tsx`, `B.tsx` and `C.tsx`, and route the slots in `Slot.tsx`
   (a → `balance`, b → `cockpit`, c → `settings`).
2. In `Mine`, count B's card in `above` through the gate's `feesOption`, and add the fifth `ROWS` entry.
3. Add six cases to `fees.vitest.tsx`, on the mock with fake timers:
   - one per option: entry → picker (search "usd") → quote → confirm → done;
   - A through `fees-fail=rejected`, then Try again;
   - the quote's countdown refreshes the quote;
   - A's dialog closed and reopened mid-trade shows the same progress.
- **Validation gate**: `bun run lint && bun run typecheck && bun run test:components && bun test apps/web-miner &&
  YACANA_MODULE_REPORT=apps/web-miner/e2e/replay/.modules bun run --cwd apps/web-miner build && bun apps/web-miner/scripts/check-chunks.ts apps/web-miner/e2e/replay/.modules`.
  Pass: exit 0. `cockpit.vitest.tsx` and `settings.vitest.tsx` pass unchanged. The bundle test is still green with
  the real modules. check-chunks prints the same first paint. Layers: lint, typecheck, unit, component, build.

### Phase 4 (a1): the browser scenario
1. Set `VITE_DEV_FUND_FEES: '1'` in `replayEnv`.
2. Write `e2e/replay/fund-fees.replay.ts`, one test: "the mocked fee funding runs end to end in every option,
   through a failed claim and its retry".
   - For a, b and c it opens `replay.url({ fees, 'fees-fail': 'claim' })`, for c going through the gear to
     Settings. It picks Base and USDC by search, types 25, waits for the quote, and confirms.
   - In b, it goes to Settings by the gear and back while the trade runs. The card must show the trade, not the
     entry.
   - It waits for the claim to fail, retries, and waits for `fees-done`.
   - Before the options, it loads the page once without `?fees=` and keeps the same-origin paths it fetched. From
     each option's navigation to done, every fetch or XHR must go to the recording's node, to one of those paths, or
     to `/build.json` (§5).
   - Failure mode it proves: the flow wired into the real page (gate, slots, lazy chunk, the runner across a route
     change) completes, and asks nothing of the network, same origin included.
   - Why not cheaper: Vitest renders in jsdom, without the built gate, the lazy chunk or the fixture's accounting.
   - Runtime: estimate about 65 s (I2), ceiling 70 s. Over it, run the failure and retry in one option only: the
     machine's specs already prove a per-phase retry.
3. Add its `REPLAYED` entry.
- **Validation gate**: `bun run lint && bun run typecheck && bun test apps/web-miner/tests/e2e-inventory.bun.test.ts &&
  YACANA_MODULE_REPORT=apps/web-miner/e2e/replay/.modules bun run --cwd apps/web-miner test:replay && bun apps/web-miner/scripts/check-chunks.ts apps/web-miner/e2e/replay/.modules`,
  at retry 0. Pass: 10 passed; the lane's wall-clock before (1.2 min, 9 tests) and after is recorded. Then break it
  on purpose: add a same-origin `fetch` to the mock's `quote()`, see the scenario fail, and revert. Layers: lint,
  typecheck, unit, e2e.
- **a1 arc gate** (on the arc's head, after its Codex loop): `bun run lint && bun run typecheck && bun test && bun run test:components &&
  bun run --cwd apps/web-miner test:replay && bun run site:build`. Pass: exit 0. `site:build` runs the production
  assembly and its artifact checks.

### Shots (orchestrator, between a1 and a2; no phase here)
The shots lead captures through the replay lane's Playwright fixture, never a bare browser. The served build points
its node at `127.0.0.1:1`, and only `e2e/replay/fixtures.ts` answers it, so a plain browser on `setup.ts serve` gets
the boot error. Concretely: an uncommitted spec in `e2e/replay/`, run with `-c playwright.replay.config.ts`, using
`replay.url(...)` and the fixture's service-worker blocking and teardown, as `signed-out.replay.ts`' `render()` does.
It sets `localStorage['yacana.theme']` (`dark` or `light`) before load, at 1280 and 1440 wide. Each state is a URL
plus a click recipe; the test ids are shared by the three options. For c, start at the gear. These captures are
signed out with a stand-in account, and the decision page says so. A signed-in shot of each entry in place needs
the live lane (`bun run e2e:agent`, with the e2e helpers' passkey sign-in); that is the orchestrator's call.

| State | Query after `?presto=off&fees=<a\|b\|c>` | Recipe, then capture when |
|---|---|---|
| entry | none | load; `fees-entry` visible |
| picker | none | click `fees-entry`, the radio named "Base", type "usd" in `fees-search` |
| quote | none | then `fees-token-USDC`, type 25 in `fees-amount`; `fees-quote` visible |
| wallet ask | `&fees-hold=sign` | then `fees-go`; `fees-step-swap` is `signing` |
| each phase running | `&fees-hold=swap`, `&fees-hold=deposit`, `&fees-hold=message`, `&fees-hold=claim` | then `fees-go`; `fees-step-<phase>` has `data-state="running"` |
| late | `&fees-fail=late&fees-hold=message` (reports late at 1.5 s, then holds) | then `fees-go`; `fees-step-message` has `data-state="late"` |
| quote ran out | `&fees-fail=expired` | then `fees-go`; the refreshed quote's note visible |
| wallet refused | `&fees-fail=rejected` (USDC: the swap's ask; Fee Juice on Ethereum: the deposit's) | then `fees-go`; `fees-failure` visible |
| claim failed | `&fees-fail=claim` | then `fees-go`; `fees-failure` visible |
| done | none | then `fees-go`; `fees-done` visible |

### Phase 5 (a2): the pick
1. Keep the picked option. Delete the other two, their slots and their spec cases. `?fees` becomes a presence
   switch.
2. Give the scenario one option, and update its title and its `REPLAYED` entry.
3. Polish the copy to the owner's decision text, and apply OA1, OA2 and OA3 as answered.
4. Update the `apps/web-miner` row of `CLAUDE.md`.
- **Validation gate**: the a1 arc gate's commands. Pass: exit 0, the scenario green at retry 0, its runtime
  recorded. Layers: lint, typecheck, unit, component, e2e, build.

## 7. Audit log and decision ledger

**Verdicts**:
- Codex r1 (`gpt-6.1-sol`, high): conditional approve. Its conditions were the network proof, the epoch premise,
  the phase gates, and the capture and test gaps.
- Opus (Plan agent): conditional approve. Its conditions were the Phase 1 order, a named fallback for I1, the URL
  claim, two asks to the owner, I3, and a scenario ceiling.
- Final fresh Codex pass (`gpt-6.1-sol`, high, a new session): r1 conditional approve (request accounting through
  quoting, fixture-backed captures, the swap and deposit recipes, F3's wording); r2 conditional approve (boot's own
  fetches, one leftover "often"); r3 **approve**: "Both conditions are resolved … No remaining findings or new
  contradictions identified."

**Accepted** (both reviewers unless marked):
- Phase 1's success control was unreachable until slots mounted. The slots now mount in P1.
- The win's deadline is its epoch, not the 600 s TTL (Codex). F3 and B's copy say so.
- I1 needed the orphan-chunk case (Codex reproduced it; so did the planner). It is now F11, and the gate keeps the
  comparison, the query and the `import()` in one expression. The fallback alias is named (Opus).
- F10 did not prove "no request": same-origin passes. The scenario logs requests from confirm to done (Codex).
- I3 overpromised. The interface is provisional, and its five gaps go to the close-out issue.
- Stale outcomes after `reset` or a changed amount are ignored, and the runner case tests it (Codex).
- Captures: a URL plus a click recipe, a stable expired note, and the decision page saying "signed out".
- Flag on with no `?fees=` still loaded the Slot chunk. The option now sits in the gate's expression (Opus).
- B's Dismiss returns the card to its entry, so no empty row is left (Opus).
- The runner's fake-timer case moved to `fees.vitest.tsx`, since `src/**/*.test.ts` also runs under bun (Opus).
- The component list showed five cases: the sixth is A's close and reopen. The scenario now hops route in b.
- Amounts reuse `withdraw-form`'s `amountRefusal`/`parseAmount` (Codex).
- OA1's note no longer implies funding switches the payer (Codex). A2 moved to OA2, and OA3 (when the entry shows)
  was added (Opus).
- The scenario has a 70 s ceiling with a named cut (Opus). Line drift was fixed in `recon.md` and F7 (Opus).
- Final pass:
  - The request log starts at navigation, not at confirm, and a forced same-origin `fetch` must fail it. The
    resumed check found that boot fetches the CRS and the artifact itself. So the log allows a baseline load's
    same-origin paths, rather than a hand-kept list that would break when boot changes.
  - The shots go through the replay fixture, because the served build's node answers only there.
  - The matrix gains the swap and deposit holds, and the late-then-hold rule.
  - F3 says epochs target 300 s and close on the fourth claim or a roll, so "may" replaces "likely".

**Decisions** (D1–D6, both views where they differed):
- D1 X over Y. Both reviewers agree: the brief asks for the real product, and Y would defer integration until after
  the pick. Y's dev route would also need an entry in `apps/site`'s `MINER_LINKS` (Opus).
- D2 `run(phase)` over a trade stream. A stream hides which phase a retry restarts. Codex adds that neither shape
  solves an uncertain broadcast, so that problem goes to I3's issue.
- D3 "late" comes from the provider, not a clock in the machine. The machine stays pure, and the mock shows it in
  seconds.
- D4 The chunk graph over a string marker. A marker proves one module absent; the graph proves every one.
- D5 No visual gate. The options are proposals that a2 deletes or rewrites, and the captures are evidence.
- D6 No artifact refusal for `devFundFees`.
  - Codex would keep it, relabelled, as config redundancy. Opus would drop it, because it reads nothing from the
    artifact and `devFundFees` is false in production by construction.
  - Dropped. `config.test.ts` asserts the same fact, and the bundle test is the evidence.
- Rejected:
  - Folding the bundle check into `proverless-marker.bun.test.ts`'s builds (Opus, optional). It mixes two concerns
    to save about 4 s.
  - Extracting `withdraw-form`'s amount helpers (Codex, conditional). The module's one SDK import is a pure address
    parser, and it is already in the first paint.

## 8. Post-implementation

- Write comments to the bar as you code: invariants and whys, no plan, phase or review references. Log attempts in
  `lessons/phase-N.md`. Run `agent-worktree status fees-1 "<gate>"` at each gate. Stop after 3 failures on one step.
- **Codex fix loop, per arc**, after the arc's phases are green:
  - Run `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` on the arc's
    diff against its base.
  - Send this plan, the arc map ("a1 of a1 → shots → a2"; a2 deletes the options not picked), the adversarial ask
    and these two rules verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative
    abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
    problem. If code works and is clear, leave it alone."* *"Audit the comments for value per character. Flag any
    comment that narrates what the code visibly does, restates its line, references implementation plans / phases
    / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
    constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or
    LLM, pays to re-read: they must be few, dense, and exact."*
  - Every prompt carries: "Never open, read, list, source or print `.env` or `.env.local`." and "Never open, list or
    search `~/.agents/orchy/` or `~/.config/`."
  - Resume the same session after each round's fixes. Stop when a round finds nothing material; hard stop at 3,
    then surface.
  - A fix that adds state, a lifecycle, a protocol, a recovery policy or a contract is a plan change: stop.
  - Record each round in §7, and rerun the arc gate on the final head.
- **Close-out** (a2's final commits):
  - Run `git merge origin/main`, and read what changed in `index.md` and `lessons.md`.
  - Write `## Outcome` after the front matter: date, status, shipped, `Known limits:`, `Open items:`, seeds retired.
  - Promote a lesson only if it generalizes (F11 does). Delete `STATUS.md`.
  - File the real-provider requirements as one issue (label `enhancement`, a `Record` link): I3's five gaps, the
    privacy rows (OA1), `feeJuiceMin`, and the flag flip.
  - In its own commit, run `git mv implementations-plan/fees-1 implementations-plan/archive/fees-1`. Add one line to
    `archive/index.md`, and no `index.md` row.
- **Where open work lives**: a gap that outlives the plan is an issue with a `Record` link; a product call is an
  `owner-decision` issue; a suspected weakness is a private draft advisory; a path needing unsupported conditions is
  a closed `known-limit` issue; rejected or done is an Outcome line.
- **Teardown** follows the orchestrator's last merge: `agent-worktree done fees-1 --merged`, never forced.

## 9. Delivery

| Arc | Phases | Branch | PR title | Body |
|---|---|---|---|---|
| a1 | 1–4 | `worktree-fees-1` (carries this plan) | `feat(web-miner): three fund-fees options behind a development flag` | no issue, no ask; the options by letter with one line each; the flag and the bundle test; replay wall-clock before and after |
| a2 | 5, close-out | `fees-1-a2`, from `origin/main` after a1 merges | `feat(web-miner): the picked fund-fees flow, still mocked and flagged` | `Delivers ask18`; the owner's pick quoted by id and text |

- Each PR goes against `main` and opens only after its gate and its Codex loop pass. The orchestrator merges, and
  spawns the shots lead between the arcs. a2 waits for the owner's pick.
- No lanes: the phases share the gate and the machine, so they are serial.

## Seeds (not run: the orchestrator owns ELI5 and seeds)

- `/goal` Phases 1–5 ✓ with their gates quoted. Each arc's Codex loop converged (quoted). PRs a1 and a2 are open
  against `main` (`gh pr view`). a2 says `Delivers ask18`, quotes the pick, and carries the archive move
  (`git show --stat`).
- `/loop 15m` Drive `implementations-plan/fees-1`. Reality-check plan.md and the PRs, then take the next step of §6
  or §8. Decide with Codex at high on `gpt-6.1-sol`. Never merge; never start a2 before the owner's pick.
