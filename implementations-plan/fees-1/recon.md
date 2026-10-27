# fees-1 recon (2026-10-27, base `91dfb30`)

Two Sonnet Explore sweeps (product surface; build and test infrastructure) plus the planner's own reads. Paths are
repo-relative; `src/` means `apps/web-miner/src/`.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| How the page pays fees | `src/wallet.ts:147-160`: `SponsoredFeePaymentMethod` on the `SponsoredFPC` (salt `SPONSORED_FPC_SALT`); `src/feePayer.ts` hands it to every operation (`claim`, `roll`, `transfer`, `bridge`) | untouched (out of scope) |
| A Fee Juice balance read | none in the repo. Searched `getFeeJuiceBalance`, `FeeJuice`, `feeJuice`, `insufficient` in `apps/`, `packages/`. The only hit is `computeFeeJuiceMessageNullifier` in `src/bridge/session.ts:434` (message plumbing). The SDK has `getFeeJuiceBalance` (`@aztec-labs/aztec.js` 6.0.0, `api/utils`) | build new, in the mock only |
| The SDK's real Fee Juice path | `L1FeeJuicePortalManager.bridgeTokensPublic(to, amount)` approves, then calls `depositToAztecPublic(to, amount, secretHash)` and returns `{claimAmount, claimSecret, messageLeafIndex}` (`aztec.js/dest/ethereum/portal_manager.js:153-200`); `FeeJuicePaymentMethodWithClaim` claims inside the first transaction it pays for (`claim_and_end_setup`) | the phase list follows it; no code |
| The 440 px dialog | `src/features/dialogs/Frame.tsx`: `TxDialog` (`eyebrow`, `title`, `body`, `locked`), `Row`/`Rows`, `Foot`, `Actions` (`quiet`, `below`), `Primary`, `Quiet`, `Back`, `AmountBelow`, `useOpening`, `useLive`, `useOnce`, `useElapsed`, `firstLine` | reuse as is |
| A flow's phases on screen | `Stepper` (`pending/active/done/failed/warn`, `right`, `detail`, `ms`) in every money dialog; `HeroCard` + `Trail` in `MigrationCard`; `Timeline` (`todo/on/done/bad`) only in stats-view's bridge page | reuse as is (one per option) |
| Amount and quote figures | `AmountField` (+ `AmountBelow`) in four dialogs; `AmountBlock` has no app user yet; `Kpi` | reuse as is |
| Asides and errors | `Note` (`neutral/warn/ok/bad/uv`), `Alert variant="bad"`, `Tip` (not used in any dialog yet) | reuse as is |
| Chain and token picker, search | none. Searched `Command`, `combobox`, `Select`, `listbox`, `search` in `packages/ui/src`; `token`, `chain.?name` in `src/`. Closest: `Segmented`, `RadioCards`, `Input`, `Popover` | build new inside `src/fees/` |
| Flow state | dialog-local `Step` unions in `useState` (Send, Claim, FromEthereum); a pure reducer with tests for the miner (`src/lib/reducer.ts`, `reducer.test.ts`); jotai atoms in `src/state.ts` | adapt: a pure reducer + an in-memory atom |
| Time on screen | `useElapsed`, `seconds`, `fmtSeconds`, `clockMinutes`, `nowAtom` | reuse as is |
| A development flag | none generic (searched `featureFlag`, `__DEV__`, `isDev`, `devFlag`, `import.meta.env.(DEV|MODE|PROD)`). The precedent is `VITE_E2E_PROVERLESS`: a `SiteConfig` field resolved only off production (`packages/web-kit/src/config.ts:184`: production takes no env), a `viteDefine` entry, a const in `src/wallet.ts:24`, the refusal in `apps/site/src/artifact.ts:84` | adapt: same shape |
| Proof that a production build carries nothing | `apps/web-miner/tests/proverless-marker.bun.test.ts` builds the miner per mode (about 2 s each in CI run 40585067152); `scripts/check-chunks.ts` reads `YACANA_MODULE_REPORT`'s `web-miner.chunks.json` (first paint only, on the replay lane's e2e build) | adapt: a production build's chunk graph, every chunk |
| A browser scenario with no node | the replay lane (`e2e/replay/*.replay.ts`): an e2e-mode build, the node answered from `recording.json`, any other origin aborted and failed; 9 tests in 1.2 min, job 2 min (same run). Signed out the cockpit and Settings render; Wallet redirects to Mine | reuse as is |
| Captures light and dark | `signed-out.replay.ts`' `render()` writes PNGs to `e2e/.renders/` (CI artifact); `apps/web-stats` `test:visual` is a pinned-image gate with no theme loop; theme is `localStorage['yacana.theme']` | the shots lead's tooling; a1 adds no gate |
| A query switch | `?node=…` (`web-kit/browser/connection.ts:84-95`) and `?presto=` (`src/presto.ts:66`), both behind `VITE_E2E_QUERY_OVERRIDES` on loopback | adapt: the flow's own switches live in modules only flagged builds have |

## Facts the plan rests on

- R1. Every page transaction is paid by the sponsored FPC; a visitor never holds Fee Juice. Copy says so today: Send's
  "Fee · none · Yacana sponsors it" (`Send.tsx:211`), "one tap, no fee" (`bridge/copy.ts:273`, `FromEthereum.tsx:187`).
- R2. No fee shortfall is shown anywhere; a failed send shows `firstLine(e)`. The L1 shortfall pattern is
  `noEth` + the "payer-no-eth" `Note` (`FromEthereum.tsx:90`).
- R3. A claim's transaction expires `CLAIM_TTL_SECONDS = 600` after its anchor (`protocol/contracts/yacana_miner/src/params.nr:5`,
  `main.nr:202`). FromEthereum promises "a few minutes" for an L1→Aztec crossing.
- R4. What becomes public when an account funds its own fees: `DepositToAztecPublic` carries `to`, the Aztec
  address, on Ethereum (`portal_manager.js:169-195`); Fee Juice balances are public; a transaction paid by the
  account names it as `feePayer` in the private kernel tail's public inputs (`stdlib/dest/kernel/private_kernel_tail_circuit_public_inputs.d.ts:71`).
- R5. Signed out, Mine renders the cockpit with the balance card ("—", "Log in") and Settings renders; Wallet
  navigates to Mine (`App.tsx:193`, `BalanceCard.tsx`, `signed-out.replay.ts:66-95`).
- R6. The cockpit sizes its rows by how many cards sit above it: `ROWS` has four entries for 0-3 cards (`routes/Mine.tsx:50-55`, `:83`).
- R7. `bun test apps/web-miner` runs in web-miner.yml's `test` job; the replay lane and `check-chunks.ts` in its
  `replay` job. Shards are dispatch-only evidence (`e2e.yml`), not a gate.
- R8. A new replay test needs its file and titles in `REPLAYED` (`e2e/proof-inventory.ts:115`); the "original
  nineteen" sum counts sharded and moved tests only (`tests/e2e-inventory.bun.test.ts:66-86`), so a new replay-only
  test does not change it. Recon B's claim that it must be bumped did not hold.
- R9. A pure spec under `src/` imports `vitest` (`lib/reducer.test.ts`, `settings.test.ts`); bun-only specs live in
  `tests/*.bun.test.ts` (`scripts/layout.test.ts` holds the runner rule).
- R10. `window.yacana` hooks install in every build (`src/main.tsx:93`); nothing of the flow may hang off them.

## Collisions and risks

- `src/features/dialogs/*` use `Step` for their local unions; ui exports `Step` too. Name the flow's states otherwise.
- A dev-only module reached through a module-level const may survive minification; the define comparison must sit
  in the expression that guards the dynamic import, and a production build's chunk graph is the judge.
- With the flag on in the replay build, nothing may change for the other replay tests: the flow mounts only on its
  query switch.
- `CLAUDE.md`'s `apps/web-miner` row lists the dialogs; a2 updates it for the kept option.

## Open work

`gh issue list --state open`: #87 only (site, unrelated). Closed known limits searched for `fee`, `sponsor`: none.
