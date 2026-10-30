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
budget: "recon: 2 Sonnet sweeps (a1) + 1 (revision); codex gpt-6.1-sol at high; code-review off"
status: a1 merged (#93, e8b7d06); revised 2026-10-30 for a2, the shots and a3; final fresh Codex pass approve (r3); awaiting the orchestrator's approval
created: 2026-10-27
revised: 2026-10-30
---

# fees-1: the web miner's "Fund fees" flow, behind a development flag

Over the 350-line target (about 510 lines): the ask27 options table, the capture matrix and three audit rounds
carry the owner's next pick and the audits. a1's full plan and ledger are this file at `52bec6b`.

On a network with no sponsor every Aztec transaction needs Fee Juice, and a visitor holds none. This lane designs
the flow that funds an account: in the real product, behind a flag production never carries, on a mocked provider,
before the SDK behind it exists. a1 (merged) built three placements and the owner picked B. This revision plans the
rest: a2 keeps B, builds ask25 and the entry rule, and adds ask27's options D, E and F on top of B; a shots lead
captures them; the owner picks; a3 keeps the pick, still mocked and flagged, and closes the plan.

## 1. Scope

- **Issues**: none. **Asks**: ask18 → a3; ask25 → a3; ask27 → a3. a2 delivers none.
- **Owner decisions recorded** (2026-10-30), the form a2 and a3 build on:
  - P3-01 = B: "Before you mine: a card over the cockpit; on confirm it carries the trade as a trail and stays through a trip to Settings."
  - P3-03 = S: "As it ships: spend an amount of a token, read the Fee Juice it buys."
  - P3-04 = I: "Only signed in, only on a network with no sponsor, and only while the account's Fee Juice is below what a claim costs."
- **UI impact (a2)**: P3-01 B, P3-03 S and P3-04 I as quoted; ask25 as its line says ("the token picker offers every
  token the provider can route to Fee Juice, searchable across chains, never a hand-picked list; the flow funds
  private Fee Juice: the Aztec account is never shown or named (not on Ethereum, not in the quote), no public
  balance and no payer note, and the claim that mints pays from the private balance"); ask27's options D, E and F
  (§4) for the owner's next decision page. All behind the flag, so nothing reaches a visitor. Anything else visible
  ships in the "what ships now" form of `OWNER-ASKS.md` OA4–OA7.
- **UI impact (a3)**: the ask27 pick from the next decision page, quoted by id and text, and OA4–OA7 as answered;
  still behind the flag.
- **Out**: the real provider and its SDK (nothing imports it); any network call from the flow (no live quote, no
  L1 transaction or balance read, no portal call); a chain switch (the mock's signatures never reach the wallet);
  mainnet; the sponsored fee payer and the wallet's fee path; Presto; the bridge's behaviour (its connect screen and
  download are reused as they are); the flag flip.

## 2. Outcome & Quality Bar

- **For whom**: the owner, picking from captures and one line per option; later a signed-in miner on a network
  with no sponsor, whose wins need Fee Juice to claim.
- **Excellent**:
  1. Every state of every option is reachable by a URL and a click recipe in both themes (§6, Shots), connect, an
     empty wallet, the save and the restore with its refusals included.
  2. The money-shaped rules live in the reducer and are tested: no step runs before the visitor started the
     recovery file's download; a restored funding never reruns a landed step; nothing below the claim minimum can
     be confirmed; a retry reruns only the failed step.
  3. The account stays unnamed: no quote call, file, file name or screen carries it.
  4. The recovery file round-trips in a real browser: save, clear the site data, load it, finish the claim.
  5. No production build carries the flow (the bundle test); from navigation to done the flow adds no same-origin
     request and no node method the page does not already call, and the wallet is asked only the account, chain and
     permission methods.
- **Good enough**: mock data is plausible, not priced; a3 polishes the copy of the pick only.

## 3. Assumptions

**Facts** (sources in `recon.md`). a1's F1–F11 hold (`52bec6b` §3): the sponsored FPC pays every page transaction
(F1); a win mints only while its epoch is open (F3); the flag resolves only off production and the define is the
guard (F7); the replay fixture refuses every other origin, websocket and worker (F10); a define-guarded `import()`
folds only beside its comparison (F11). F4 is superseded by ask25's design. New:
- F12 The installed FeeJuice (`@aztec-labs/protocol-contracts` artifact) has `claim` and `claim_and_end_setup`
  (private), `balance_of_public`, `check_balance`, `_increase_public_balance`, `public_dispatch` (public): no private
  balance. The Fee Juice portal has `depositToAztecPublic` (it names `to`), `distributeFees` and views. aztec.js
  6.0.0's `PrivateFeePaymentMethod` is `@deprecated Is not supported on mainnet`.
- F13 The real provider's testnet behaviour (data, not requirements): it connects its own Aztec wallet
  (wallet-sdk); it has no holdings query and reads balances through its own RPCs for the rows on screen; private gas
  goes to a private fee-payment contract with the Aztec recipient zeroed in the calldata, while the deposit's
  sender, token and amount are public; its backup is a JSON file whose record is sealed under a key from an Ethereum
  signature; it keeps its record in local storage from before the first signature; quotes last 60 s; a claim needs
  about 30 Fee Juice; from Sepolia it takes the fee asset 1:1, test tokens, Uniswap's default list or a pasted
  ERC-20, from Base Sepolia USDC only; a cross-chain quote needs both wallets connected; end to end takes 2–4 min.
- F14 The miner's injected connection is `wagmiConfigFor` (`src/bridge/eth.ts:33-41`): one chain, the generic
  `injected()` plus EIP-6963 discovery, an http transport to the page's RPC. Connect and reconnect talk only to the
  injected provider (connect also asks `wallet_requestPermissions` and swallows a refusal,
  `@wagmi/core/src/connectors/injected.ts:115-139`); reads hit the RPC. wagmi builds each EIP-6963 announcement into an
  `injected()` connector whose id is the wallet's rdns (`@wagmi/core/src/createConfig.ts:121-124`) and keeps the
  generic one (id `injected`) beside it, so one installed wallet makes two connectors. `BridgeProviders` renders
  nothing without a bridge session (signed in, with a bridge record), and an e2e build carries no bridge record
  unless its run hands one (`packages/web-kit/src/config.ts:236`). The Slot mounts outside it (`routes/Mine.tsx:106`).
- F15 Nothing reads an ERC-20 balance or batches reads; the chain definition names no `multicall3`; the fetch guard
  admits only the Ethereum RPC in use (`web-kit/src/browser/node-guard.ts`); `QUIET` keeps optional reads out of RPC
  health.
- F16 The bridge's recovery file (`packages/bridge/src/recovery.ts:10-30`) holds no secret: secrets re-derive from
  the account's master by HKDF labels (`secrets.ts:38-77`); the master (passkey PRF or mnemonic) lives in memory for
  the tab (`src/session.ts:179`). The file names the account, and its file name carries the account's first ten
  characters (`features/recovery.ts:12`). Load is a hidden file input (`ActivityList.tsx:151`); the bridge e2e saves
  with `waitForEvent('download')` and loads with `setInputFiles` (`bridge.e2e.ts:185-245`).
- F17 Nothing says whether a network has a sponsor, and no Aztec fee is estimated; a claim's gas limits come from
  `claimGasLimits(node)` (`src/wallet.ts:154`).
- F18 Signed in is `bootAtom.phase === 'ready'` (`src/state.ts:67`); the replay lane is signed out with no node.
  `e2e/helpers/l1-wallet.ts` injects an EIP-1193 wallet answered from Node, announced by EIP-6963, with the
  permission methods; anything else it proxies to its RPC through a lazily built client, so an unreachable RPC URL
  makes it usable in the replay lane. e2e specs already open CDP sessions (`e2e/helpers.ts:66`).
- F19 The cockpit sizes its rows by the cards above it (`routes/Mine.tsx:51-56`, `:86-89`); a card counted but not
  drawn leaves an empty row and its gap at `xl`.

**Verify first for the new proposals, settled**:
- V1 Aztec wallet. The provider connects its own Aztec wallet; the miner pays from its embedded account. The mock
  funds the miner's own account and never receives it. The real provider must offer an embedded mode: a quote and a
  deposit with no Aztec wallet, the claim as a call the miner's own wallet sends, and its private payment method
  usable by an account it never connected.
- V2 Holdings. The mock reads balances for the provider's list through a page-side reader (§4). The real path reads
  them through the page's RPC (`getBalance`, `balanceOf`, batched through multicall3 once the chain definition names
  it, `QUIET`); a second chain needs its RPC admitted by the guard.
- V3 Private gas. Aztec 6.0.0 has no private Fee Juice balance (F12), so the mock models one, and the real path waits
  on a contract, not a release: the provider's private fee-payment contract, whose payment method the miner's wallet
  would use; its transactions then name that contract as fee payer, never the account. No Aztec release known to
  the planner adds a private FeeJuice balance (confidence: unknown beyond 6.0.0).
- V4 Recovery shape: the bridge's, mirrored (D7). Secrets re-derive from the account's master; the file holds no
  secret and names no account. The real provider must take a caller-supplied secret hash for the deposit and look a
  deposit up by it, returning the claim's inputs (the amount delivered, the message's leaf index) and its status:
  that lookup is what finishes a claim after a swap whose output was unknown at save time. If it cannot take the
  hash, the file seals the provider's secret under a key derived from the same master, never from an Ethereum
  signature.
- V5 Claim minimum. The quote carries it (mock 30 Fee Juice, as on the real provider's testnet) and states it, and
  the reducer refuses to confirm a quote whose least delivery is below it.

**Asks** (no owner to ask; each runs on its working assumption):
- A1 (revised) The mock's chains mirror the real provider's testnet: Sepolia (the fee asset 1:1 and a generated
  list of about sixty tokens) and Base Sepolia (USDC only). The stand-in wallet holds a few of them.
- A3 (revised) A signed-out flagged page stands in a signed-in account only under `fees-session=stand-in`, so
  P3-04's "only signed in" is exercised; the decision page says the captures use the stand-in.
- A4 "What a claim costs" (P3-04) is one win claim's fee: the mock's 1.8 Fee Juice; for real, `claimGasLimits`
  times the node's current minimum fees.
- A5 Under the flag the network has no sponsor (the flow's premise); the real signal is the flip lane's.

## 4. Architecture & Implementation

**What stays from a1**: the gate (`src/fees-gate.ts`), `Slot.tsx`, the reducer (`machine.ts`), the tab-wide
`FundingRun`, the mock's delays and its `fees-fail` and `fees-hold` switches, the phase marks in `views.tsx`,
`copy.ts`, `QuoteView`, B's entry and trade cards, the bundle test. a2 deletes options A and C, their slots in
`BalanceCard` and `Settings`, their cases and `Held`.

**Interface deltas (`provider.ts`, still provisional):**

```ts
export interface Token { readonly chainId: number; readonly address: string; readonly symbol: string;
  readonly name: string; readonly decimals: number }               // no balance: balances are the wallet's
export interface Quote { /* a1's fields */ readonly claimMin: bigint } // least Fee Juice a claim takes, 18 decimals
export interface FundingHint { readonly token: Token; readonly amountIn: bigint } // display only
export interface FeeFundingProvider {
  chains(signal: AbortSignal): Promise<readonly Chain[]>;
  /** Every token it turns into Fee Juice, on every chain: no size or set may be assumed. */
  tokens(signal: AbortSignal): Promise<readonly Token[]>;
  /** `payer` is the Ethereum wallet; the Aztec account is never sent. */
  quote(from: Token, amountIn: bigint, payer: string, signal: AbortSignal): Promise<Quote>;
  /** `commit`: the secret hash the deposit commits to, derived from the funding's index. */
  run(phase: Phase, quote: Quote, commit: string, on: (e: PhaseEvent) => void, signal: AbortSignal): Promise<void>;
  /** The funding a commitment names, as the chain has it; null when no deposit carries it. `hint` is the file's
   *  display hint: a real provider ignores it, the mock (no chain) rebuilds the funding from it. */
  resume(saved: { commit: string; hint: FundingHint }, signal: AbortSignal): Promise<{ quote: Quote; landed: readonly Phase[] } | null>;
}
/** What the page reads for itself, never through the provider. */
export interface FundingReads {
  balances(owner: string, tokens: readonly Token[], signal: AbortSignal): Promise<readonly bigint[]>;
  standing(signal: AbortSignal): Promise<{ sponsored: boolean; privateFeeJuice: bigint; claimCost: bigint }>;
}
```

- **The mock** (`mock.ts`): A1's tokens; the stand-in wallet's balances by its address; quotes that live 60 s;
  `claimMin` 30; the claim's own fee among the costs, paid from what arrives. It has no chain to outlive a cleared
  site, so its `resume` rebuilds the funding from the hint it is handed (below) with the deposit landed and the
  message in flight; the real `resume` reads what the commitment names and ignores the hint. Its standing: no
  sponsor, a private balance of zero that a finished claim raises, a claim cost of 1.8. New switches, closed
  vocabularies: `fees-session=stand-in`, `fees-wallet=empty`, `fees-resume=missing|claimed`.
- **The entry rule** (`entry.ts`, pure): `shows = signedIn && !sponsored && privateFeeJuice < claimCost`, where
  `signedIn` is the session's, or the stand-in's under its switch. It governs the entry only: a trade's card stays
  until Dismiss. Mine counts the card through `feesCardAtom`, a jotai atom in `fees-gate.ts` the Slot sets in a
  layout effect while it draws a card; production never sets it (F19).
- **ask25 in the shared parts**: the visibility row reads "Visible on Ethereum: your wallet and the amount"; the
  payer note and every public balance go; `run.recipient` goes; the claim's line says it pays its fee from the Fee
  Juice it claims. Search matches symbol, name or address, so a pasted address finds a supported token; an
  arbitrary ERC-20 at a provider-set rate is the real lane's.
- **The wallet** (`wallet.tsx`): one wagmi config owns the flow at a time, under the flow's own `WagmiProvider` and
  `QueryClientProvider` (the Slot sits outside `BridgeProviders`, F14). With a bridge session open, the session's
  config: the bridge and the flow share one connection, so the chip's × disconnects the page's one Ethereum
  connection, as in Wallet (ask27: "on the miner's existing injected-wallet connection"). With none (signed out
  under the flag, or a network with no bridge record), a config the flow builds once per tab from `bridgeChain` (the
  page's RPC, the provider's first chain), `injected()` with discovery, and its own storage key
  (`yacana.fees.wagmi`), so its persisted store and disconnect marker never mix with the bridge's; once a sign-in
  opens a bridge session the flow moves to the session's and its own stays idle. The flow uses `useAccount`,
  `useConnectors`, `ConnectWallet` and `WalletChip`: no read hook, transport, signature or write. "One installed
  wallet" counts the announced connectors, every one but the generic `injected` (F14). The guarantee is about the
  page's own traffic: what an extension does on its side is out of the page's sight.
- **The funding's identity and its file** (`recovery.ts`, pure but for the download): a random 48-bit `index` (no
  journal under the flag; never a scan bound) and its commitment `commit`, the secret hash of HKDF(master,
  `yacana.fees.v1:<chainId>:<rollupVersion>:<index>`), derived as the bridge derives its crossings'
  (`secrets.ts:50-66`). The deposit commits to `commit` and `resume(commit)` finds it, so the file needs no secret,
  amount or leaf index. Under the flag the master is a fixed, public stand-in: the flow never reads the session's.
  The file, `yacana-fees-<chainId>-<index>.json`, is `{ v: 1, kind: 'yacana-fee-funding', chainId, rollupVersion,
  index, createdAt, hint: { token, amountIn } }`: no account, no secret; `hint` is display only, for a mock with no
  chain. `parseRecord` refuses above 64 KiB, non-JSON, another `v` or `kind`, another chain or rollup version, and
  any field off its shape; another account's file derives a commitment no deposit carries. The download is
  `saveJson(name, value)`, moved from `features/recovery.ts` into `src/lib/download.ts` (two callers, same behaviour).
- **Saved, defined**: `saved` means the visitor's click started the download; no browser tells a page whether the
  file was kept, so the trade card offers "Save the file again" until the claim lands. A save binds to the funding's
  token and amount: another token or amount clears it; a refreshed quote for the same pair keeps it.
- **Machine and runner deltas**: the quote and trade states gain `saved: FundingRecord | null`; new events `saved`
  and `restored`. `next()` names no step while `saved` is null; `choose` and `amount` clear `saved`; `confirm` is
  refused while `feeJuiceMin < claimMin`; `restored` (from `idle` or `pick`) enters `trade` with the landed steps
  `done`, or `done` when every step landed. The runner's `restore(file)` parses, derives `commit`, asks `resume`
  with it and the file's hint under an `AbortController` that `cancel()` aborts, and dispatches `restored` or a
  refusal line only while current.

**ask27's options.** All three are form B: the entry card over the cockpit, picking and quoting in the 440 px
dialog, the trade on the card's trail after confirm. They share the provider, the reads, the reducer, the record and
the test ids, and differ on the three axes the ask names.

| | D · wallet on the card | E · all in the dialog | F · one tap |
|---|---|---|---|
| **Connects** | On the card, before the dialog: the entry's primary is "Connect wallet" until a wallet is connected (several wallets: the dialog opens on their list); then the card shows the chip and "Fund fees". | In the dialog, first screen: `ConnectWallet`, as FromEthereum's; the chip in the dialog after. | On "Fund fees": one announced wallet is asked at once and the dialog opens on the picker; several open the dialog's wallet list. |
| **Tokens offered** | The wallet's own supported tokens, one list across chains, each with its chain and balance; the rest only as search results. | The wallet's supported tokens first, with balances, then every other supported token under "Not in this wallet". | The wallet's supported tokens under chain tabs, its current chain first; the rest only as search results. |
| **Saves the file** | A "file" station opens the trail: after confirm the card asks "Save your recovery file", and no wallet ask starts until it is saved. | Two beats on the quote: "Save recovery file", then "Fund fees" enables; the trail's "file" station starts done. | "Fund fees" saves the file and starts the trade in one click; the "file" station starts done. |
| **Restores** | "Resume from a file" on the entry card. | "Resuming a funding? Load its file" under the dialog's connect screen and its picker. | As D. |
| **Empty wallet** | The dialog says the wallet holds nothing that buys Fee Juice. | The held list is empty; the rest still shows what would buy it. | As D. |

In every option the search spans every supported token on every chain, and a token the wallet does not hold shows
as "not in this wallet" and cannot be chosen (ask25). Restored, every option resumes its card's trail at the first
step not landed; a refused file shows a `Note tone="bad"` with the reason and nothing changes. Test ids a2 adds:
`fees-connect`, `fees-picker-empty`, `fees-token-<chainId>-<symbol>`, `fees-claim-min`, `fees-save`,
`fees-step-file`, `fees-restore` (the file input), `fees-restore-error`, `fees-dismiss`.

**Recommendation: E.** It connects in the place and grammar visitors already meet in the bridge's money dialogs, so
nothing new is taught. The file is saved where the quote is read, before any money moves, as a step the visitor
sees and cannot skip, and the card stays a pure progress trail. Its list shows the wallet's own tokens first and
every other supported token below, so an empty wallet still learns what to get. D is the most explicit but adds a
stop on the card while the quote's minute runs. F is the fastest, but a save folded into the confirm is the one a
visitor will not remember having made. The planner's judgment, not a measurement.

**File map (a2).**
- New: `src/fees/{entry,recovery}.ts`, `src/fees/wallet.tsx`, `src/fees/options/{D,E,F}.tsx`,
  `src/fees/parts/Restore.tsx`, `src/fees/{entry,recovery}.test.ts`, `src/lib/download.ts` and its spec.
- Modified: `src/fees-gate.ts` (`d|e|f`, `feesCardAtom`), `Slot.tsx`, `provider.ts`, `mock.ts`, `machine.ts`,
  `run.ts`, `copy.ts`, `views.tsx`, `parts/{TokenPicker,QuoteView,Choose}.tsx`, `options/B.tsx` (its cards become
  the shared card the options compose), `machine.test.ts`, `fees.vitest.tsx`, `routes/Mine.tsx`,
  `features/recovery.ts`, `e2e/helpers/l1-wallet.ts` (an `asked()` list of every method, beside `calls`),
  `e2e/replay/fund-fees.replay.ts`, `e2e/proof-inventory.ts`.
- Deleted: `options/{A,C}.tsx`, `parts/Held.tsx`, the slots in `components/BalanceCard.tsx` and `routes/Settings.tsx`.
- a3 deletes the two options not picked and updates the `apps/web-miner` row of `CLAUDE.md`.

## 5. Security & Adversarial Considerations

- **The mock leaking to production**: as a1. Production config takes no env, the define folds the gate, and the
  bundle test reads every chunk of a production build with the flag in its env.
- **The wallet connection** is the only real I/O the flow gains: connect, the address and the chain, and nothing
  else. A wallet that refuses methods proves nothing (wagmi swallows a refused permission request), so the scenario
  uses the existing `installL1Wallet` with an unreachable RPC URL, reads its `asked()` list, and requires it to hold
  only `eth_requestAccounts`, `eth_accounts`, `eth_chainId` and the permission methods, cold and after a reload; the
  request log fails any page request off the baseline. A malicious injected wallet learns only that a site asked
  to connect.
- **The recovery file is input at a trust boundary**: a 64 KiB cap before reading, a closed shape, scope checks,
  React escaping. It carries an index (a forger's choice derives a commitment no deposit carries for this account)
  and display hints (a forged hint changes what the mock shows, never what the real path reads). Nothing in it
  authenticates, and nothing needs to.
- **Privacy (ask25)**: no quote, file, file name or screen carries the account. Ethereum sees the wallet, the
  token, the amount and the commitment, a hash of a secret only the master derives, which links to nothing; the
  visibility row names the wallet and the amount. Paid through the provider's private contract, transactions name
  that contract as fee payer (V3).
- **Loss**: after cleared site data the file is the only way back, as with the real provider; with no page record
  under the flag a reload also needs it (OA5).
- **Domain risks the real lane inherits** (the close-out issue): the commitment's secret derived before the L1
  transaction, a lost receipt that must not deposit twice, slippage (`feeJuiceMin`), approval scope (the provider's
  unlimited Permit2 approval), the private contract as custodian until the claim, a cross-chain relay with no
  automatic refund on testnet, chain switching, the random index ruling out the bridge's scan by index.
- **Least privilege, supply chain, cryptography**: no new dependency, secret, workflow or permission; the
  commitment uses miner-core's `hkdf` and stdlib's `computeSecretHash`.

## 6. Phases

Phases 1–4 (a1) ✓, merged as #93: the flag and its bundle proof; the provider, mock, machine and runner; options A,
B, C; the replay scenario (10 tests in 2.2 min, the scenario 48 s).

### Phase 5 (a2): B alone, ask25, the entry rule
1. Delete A and C with their slots, cases and `Held`; `?fees=b` until P8.
2. The interface deltas but `commit` and `resume`: the open-ended list across chains (A1), the quote without the
   account, `claimMin`, the visibility row, no payer note, the claim's fee line.
3. `entry.ts`, `FundingReads.standing`, `fees-session=stand-in`, `feesCardAtom` and Mine's count.
4. Specs: `entry.test.ts` (one table: each input false in turn hides the entry, all true shows it);
   `machine.test.ts` adds "confirm below `claimMin` is refused" with its success control; `fees.vitest.tsx` keeps
   B's end-to-end case, adds a token the mock's list never named reaching a quote, "signed out without the
   stand-in: no card", and done → Dismiss → no card.
5. The scenario follows: B only, `fees-session=stand-in`, Sepolia USDC 100 (the new chains and minimum).
- **Gate**: `bun run lint && bun run typecheck && bun run test:components && bun test apps/web-miner && bun run --cwd apps/web-miner test:replay`.
  Pass: exit 0. Then break it on purpose: let `entry.ts` ignore the balance, see the
  Dismiss case fail, revert. Layers: lint, typecheck, unit, component, e2e.

### Phase 6 (a2): the wallet and its tokens
1. `wallet.tsx` (§4), `FundingReads.balances` in the mock, `Token.balance` gone.
2. The three orderings as pure functions in `parts/TokenPicker.tsx` with their rendering (held first; by chain;
   the rest under a heading or only by search).
3. Until P8 splits it, B connects as E does (the dialog's first screen). `asked()` in `e2e/helpers/l1-wallet.ts`;
   the scenario installs `installL1Wallet` (RPC `http://127.0.0.1:1`) and connects.
4. Specs in `fees.vitest.tsx`, with the config passed as a prop under wagmi 3.7.7's `mock` connector, as
   `src/bridge-features.vitest.tsx:97-105` does: each ordering lists the held supported tokens, and search reaches a
   supported unheld one as not choosable (a held unsupported token is the never-happens control);
   `fees-wallet=empty` says so; the flow moves from its own config to a bridge session's with a wallet connected,
   then reads the session's account, its own store key untouched.
- **Gate**: P5's commands. Pass: exit 0.

### Phase 7 (a2): the recovery record and file
1. `recovery.ts`, `src/lib/download.ts` (and `features/recovery.ts` on it), `parts/Restore.tsx`, the reducer's
   `saved` and `restored`, the runner's `restore`, the mock's `commit` and `resume`. Until P8 splits it, B saves on
   confirm (F's beat), so its trade never waits on a save it cannot make.
2. Specs: `recovery.test.ts` (a record round-trips through its file to the same commitment, and another index or
   master gives another; each refusal of §4 is refused, a well-formed file the success control; two files with different tokens and
   amounts resume as their own funding against fresh mocks); the download's
   spec (the file name, the JSON, the anchor clicked, the URL revoked); `machine.test.ts` adds "no step starts
   before `saved`", "another token or amount clears `saved`, a refreshed quote keeps it", "a restore with the deposit
   landed starts at the message" and "a restore with every step landed is `done`"; the runner case asserts the
   provider's `run` history after a restore holds no swap and no deposit, and that `reset` during a pending
   `resume` leaves `idle`.
- **Gate**: P5's commands. Then break it on purpose: let `next()` ignore `saved`, see its case fail, revert.

### Phase 8 (a2): options D, E, F and the scenario
1. `options/{D,E,F}.tsx` on B's cards (§4 table); the gate takes `?fees=d|e|f`; `b` goes.
2. `fees.vitest.tsx`: one case per option, entry → connect → token → quote → save → done; E's confirm disabled
   until saved; D's no `run` until saved; F's one announced wallet asked at once; a refused file leaves the entry.
3. The scenario: "the mocked fee funding runs end to end in every ask27 option, and its recovery file finishes the
   claim after the site data is cleared". The baseline load as a1. Then, with `installL1Wallet` (RPC
   `http://127.0.0.1:1`) and `fees-session=stand-in`, for f, d and e (in that order): `?fees=<o>`, connect,
   Sepolia USDC by search, 100 (about 50 Fee Juice at the mock's rate, over the minimum of 30), the quote, the save (a `download` event),
   confirm, done, Dismiss, no card. In d: a trip to Settings and back mid-trade. In e, with `fees-fail=claim`: at
   `fees-step-message` running, CDP `Storage.clearDataForOrigin` (all types), reload, open the entry, load the
   saved file at `fees-restore`; from then on a test-side `MutationObserver` sees `fees-step-swap` and
   `fees-step-deposit` only as `done`; the claim fails, retry, done. Once: `?fees=e` without the stand-in shows no
   card. f runs first, in the test's fresh context with a wallet never asked: disconnected before the click, then
   `fees-entry` adds an `eth_requestAccounts` to `asked()` and shows the chip with no wallet row chosen (the one-tap
   path through real discovery, which wagmi's `mock` connector cannot show). Throughout: from each navigation to
   done, the same-origin requests equal the baseline load's as a multiset of method, full URL (query included) and
   body, and node calls use only methods the baseline used (a flow repeating a polled node method stays
   indistinguishable from the poll: the flow imports no node client); the stand-in account's address appears
   in no request URL or body, in neither the downloaded file nor its name, and nowhere in the page's text; and
   `asked()` stays within the expected set.
   - Failure modes it proves: the options wired into the real page reach done; the connection asks the wallet
     nothing more, and the flow adds no request and leaks no account; a file saved before the deposit survives cleared storage and
     finishes the claim without rerunning a landed step.
   - Why not cheaper: jsdom has no built gate, lazy chunk, download, file chooser, storage clearing or request log.
   - Runtime: estimate 50 s (the mock's timings give 10–18 s per option), ceiling 70 s; over it, d and f stop at
     their first running step and e alone runs to done.
4. The `REPLAYED` title follows.
- **Gate**: `bun run lint && bun run typecheck && bun test apps/web-miner/tests/e2e-inventory.bun.test.ts &&
  YACANA_MODULE_REPORT=apps/web-miner/e2e/replay/.modules bun run --cwd apps/web-miner test:replay && bun apps/web-miner/scripts/check-chunks.ts apps/web-miner/e2e/replay/.modules`
  at retry 0. Pass: 10 passed, the lane's wall-clock before (2.2 min) and after recorded. Then break it on purpose:
  a wagmi `getBalance` in D's picker fails the request log, as do a second `GET /build.json` and a `POST` to it from
  the mock; a `/build.json?a=<account>` fetch fails the sentinel; a restore that reruns the deposit fails the observer.
- **a2 arc gate** (the arc's head, after its Codex loop): `bun run lint && bun run typecheck && bun test && bun run test:components &&
  bun run --cwd apps/web-miner test:replay && bun test apps/web-miner/tests/fund-fees-absent.bun.test.ts && bun run site:build`,
  with the pinned Aztec bin first on PATH (`lessons.md`). Pass: exit 0.

### Shots (orchestrator, between a2 and a3)
As a1's: an uncommitted spec in `e2e/replay/` run with `-c playwright.replay.config.ts`, `replay.url(...)`, the
fixture's teardown, `localStorage['yacana.theme']` set before load, 1280 and 1440 wide, both themes,
`installL1Wallet` with an unreachable RPC unless the row says otherwise. Captures are signed out with the stand-in
account and wallet, and the decision page says so. Each row, for each of d, e and f, after
`?presto=off&fees-session=stand-in&fees=<o>`:

| State | Extra query | Recipe, capture when |
|---|---|---|
| entry, no wallet | none; no wallet installed | load; `fees-entry` visible (d: "Connect wallet"); e: then `fees-entry`, the connect screen |
| connected | none | d: `fees-connect`; e: `fees-entry`, `wallet-option`; f: `fees-entry`; the chip visible |
| picker, search | none | connected; `fees-picker` visible; then "usd" in `fees-search` |
| empty wallet | `&fees-wallet=empty` | connected; `fees-picker-empty` visible |
| quote, below the minimum | none | `fees-token-11155111-USDC`, 100 in `fees-amount`, `fees-quote`; then 1, `fees-claim-min` and the disabled `fees-go` |
| save | none | d: `fees-go`, then `fees-step-file` waiting; e: `fees-save` visible; f: none |
| phases, wallet ask, late, refusals | a1's `fees-hold` and `fees-fail` values | after the save, `fees-go`; as a1's matrix (`52bec6b` §6) |
| done, dismissed | none | `fees-done`; then `fees-dismiss`, no `fees-card` |
| restore: resumed, claimed, refused, missing | `&fees-resume=claimed`, `&fees-resume=missing` | `fees-restore` with a saved file (another `chainId` for refused); the resumed trail, `fees-done`, or `fees-restore-error` |

### Phase 9 (a3): the pick
1. Keep the picked option; delete the other two and their cases; `?fees` becomes a presence switch.
2. Apply the pick's text and OA4–OA7 as answered; polish its copy; update the `apps/web-miner` row of `CLAUDE.md`.
3. The scenario keeps one option with the Settings trip (P3-01), the round trip, the claim failure, the Dismiss and
   the no-stand-in check; its title and `REPLAYED` entry follow.
- **Gate**: the a2 arc gate's commands. Pass: exit 0, the scenario green at retry 0, its runtime recorded.

## 7. Audit log and decision ledger

**a1** (`52bec6b` §7): Codex r1 and Opus conditional approve; final fresh Codex pass approve at r3. Fix loop: Codex
round 1 changes requested, Opus beside it, round 2 clean. D1–D6: in place over a dev page (outline Y); `run(phase)`
over a trade stream; "late" from the provider; the chunk graph over a marker; no visual gate; no artifact refusal.

**Revision decisions**:
- D7 The recovery shape mirrors the bridge's, not the provider's. The miner already derives every bridge secret
  from its master; a file with no secret and no account can leak without linking or losing anything. The provider's
  sealed record costs an Ethereum signature per save and per restore and binds recovery to the Ethereum wallet, not
  to the account the Fee Juice is for.
- D8 Three bundled options over per-axis switches (outline Z, `plan-outline-z.md`, local). The axes are independent
  (every variant connects before the picker and confirms in the dialog), but bundles mean what the owner picks is
  exactly what was captured and tested end to end, and the page asks one question as P3 did; a mixed pick stays
  open to the owner's note.
- D9 A real connection over one modelled in the provider: ask27 names the miner's existing injected connection,
  and connecting sends no page request (F14). Reads and signatures stay mocked.
- D10 Balances as the page's own reads, not the provider's: it has no holdings query (F13); the real reads go
  through the page's RPC (V2).
- D11 A public stand-in master under the flag: the flow never reads the session's secret; the real lane derives
  through the bridge session's master.
- D12 A random index rather than a journal's reserved one: no persistence until OA5 is answered.
- D13 No regrouping: a2 stays one PR; the shots need all three options from one build, and a split adds a review
  loop without moving anything earlier.

**Dual audit** (both conditional approve; every finding accepted, the path and fix in one line each):
- Codex r1 (`gpt-6.1-sol`, high, session `01a18d72-2748-7f40-b367-3a98e13a9d5f`):
  1. High: nothing bound the deposit to the saved identity → `run` and `resume` take the commitment; V4 requires a
     lookup by it that returns the claim's inputs and status.
  2. Medium: the tag authenticated nothing (a forged amount kept a valid tag; the stand-in master is public) → the
     tag is gone; the token and amount are display hints.
  3. Medium, Codex's probe: wagmi asks `wallet_requestPermissions` and swallows a refusal, so a four-method stand-in
     proved nothing → the wallet answers the permission methods and its full method list is asserted; the claim is
     scoped to page traffic.
  4. Medium, plausible: a fallback config beside the bridge's after a sign-in would share wagmi's store → one
     config owns the flow; the flow's own has its own storage key; a spec covers the move.
  5. High: D and F searched only holdings, against ask25 → every option searches every supported token.
  6. High: `saved` was unbound and undefined → it binds to the token and amount and means the download started;
     "Save the file again" stays until the claim lands.
  7. Medium: a fully landed restore stalled; "done" did not prove no rerun; 50 USDC bought under the minimum →
     `restored` goes to `done`; the observer and the call history; 100 USDC.
- Opus (Plan agent): findings 2, 3 and 9 matched Codex 5, 1–2 and 6. New, all accepted:
  1. High: P7's `saved` guard stalled B, which had no save until P8 → B saves on confirm in P7.
  4. Medium: the generic `injected()` has no `rdns`, so one installed wallet makes two connectors and F's "one"
     never held → F counts announced connectors; D names where its list shows.
  5. Medium: the planned stand-in wallet duplicated `installL1Wallet`, which works without anvil (its client is
     lazy; recon's claim did not hold) → reused, with an `asked()` list.
  6. Low-medium: a rerun deposit would not fail the scenario → the observer.
  7. Low-medium: a3 dropped P3-01's Settings trip → kept.
  8. Low: P7 gated an unrelated test file, and nothing gated the download move → that gate line is gone and the
     download has its spec.
  10. Low: the stand-in made "signed in" constant → a closed switch and a no-card check.
  11. Low: the flow needs its own wagmi and query providers, the Vitest config as a prop, and an abortable restore →
      all three in §4 and P6–P7.
  12. Visible details the plan had decided → OA7.

**Final fresh Codex pass** (`gpt-6.1-sol`, high, new session `01a18d81-d690-7952-b6e2-6ddcf688e0af`):
- r1 conditional approve, four findings, all accepted:
  1. High, demonstrated by probe: the accepted connector fix was wrong; wagmi gives a discovered wallet the id of its
     rdns and no `rdns` property → F counts every connector but the generic `injected`, and the scenario's f proves
     the one-tap path through real discovery.
  2. Medium: `resume(commit)` gave the mock nothing to rebuild from → `resume` takes the file's hint beside the
     commitment (a real provider ignores it); two files resume as their own fundings against fresh mocks.
  3. Medium: P5's and P6's replay gates could not pass (no stand-in switch, the old Base recipe below the minimum,
     no wallet before P8) → each phase adapts the scenario for what it introduces; B connects as E in P6.
  4. Medium, demonstrated by probe: the request log matched paths only, so `/build.json?account=…` passed → full
     URLs, and a sentinel: the stand-in account's address in no request, file, file name or page text, with that
     leak as a forced break.
- r2 (resumed) conditional approve, two findings, accepted:
  1. Medium, demonstrated: after d and e the wallet stayed authorized and wagmi reconnected, so f's check could pass
     with the one-tap path broken → f runs first, from a never-asked wallet, and must add an `eth_requestAccounts`.
  2. Medium, demonstrated: URL membership let a same-URL `POST` or a repeat through → same-origin requests match the
     baseline as a multiset of method, URL and body, node calls only by the baseline's methods, both as forced
     breaks; the residual (a flow repeating a polled node method) is named, and Excellent #5 says what is proven.
- r3 (resumed) **approve**: "No new material findings. Confidence: high at the plan level."

## 8. Post-implementation

- Comments to the bar as you code; attempts in `lessons/phase-N.md`; `agent-worktree status fees-1 "<gate>"` at each
  gate; stop after 3 failures on one step.
- **Codex fix loop, per arc**, after the arc's phases are green:
  - `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` on the arc's diff
    against `origin/main`.
  - Send this plan, the arc map ("a1 ✓ → a2 → shots → a3; a3 deletes the options not picked"), the adversarial ask
    and these two rules verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative
    abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
    problem. If code works and is clear, leave it alone."* *"Audit the comments for value per character. Flag any
    comment that narrates what the code visibly does, restates its line, references implementation plans / phases
    / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
    constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or
    LLM, pays to re-read: they must be few, dense, and exact."*
  - Every prompt carries "Never open, read, list, source or print `.env` or `.env.local`." and "Never open, list or
    search `~/.agents/orchy/` or `~/.config/`."
  - Resume the same session after each round's fixes; stop when a round finds nothing material; hard stop at 3. A
    fix that adds state, a lifecycle, a protocol, a recovery policy or a contract is a plan change: stop. Record each
    round in §7 and rerun the arc gate on the final head.
- **Close-out** (a3's final commits): `git merge origin/main` and read what changed in `index.md` and `lessons.md`;
  `## Outcome` after the front matter (date, status, shipped, `Known limits:`, `Open items:`, seeds retired); promote
  F11 to `lessons.md` with a pruning pass; file the real-provider requirements as one `enhancement` issue with a
  `Record` link (a1's I3 gaps, V1–V5, the sponsor signal and a claim's cost, the page record of OA5, the approval
  scope, chain switching, the flag flip); delete `STATUS.md`; then, in its own commit, `git mv
  implementations-plan/fees-1 implementations-plan/archive/fees-1` and one line in `archive/index.md`, no `index.md` row.
- **Where open work lives**: a gap that outlives the plan is an issue with a `Record` link; a product call an
  `owner-decision` issue; a suspected weakness a private draft advisory; a path needing unsupported conditions a
  closed `known-limit` issue; rejected or done an Outcome line.
- **Teardown** follows the orchestrator's last merge: `agent-worktree done fees-1 --merged`, never forced.

## 9. Delivery

| Arc | Phases | Branch | PR title | Body |
|---|---|---|---|---|
| a1 ✓ | 1–4 | `worktree-fees-1` | #93, merged | — |
| a2 | 5–8 | `worktree-fees-1` (this revision, `origin/main` merged) | `feat(web-miner): fund fees on B, privately, with three wallet-and-file options` | no issue, no ask; P3-01, P3-03 and P3-04 quoted; ask27's options D, E, F with one line each; replay wall-clock before and after |
| a3 | 9, close-out | `worktree-fees-1`, `origin/main` merged in again | `feat(web-miner): the picked fund-fees flow, still mocked and flagged` | `Delivers ask18`, `Delivers ask25`, `Delivers ask27`; every owner pick quoted by id and text |

Each PR goes against `main` and opens only after its gate and its Codex loop pass. The orchestrator merges and
spawns the shots lead between a2 and a3; a3 waits for the owner's pick. Serial: the phases share the reducer.

## Seeds (not run: the orchestrator owns ELI5 and seeds)

- `/goal` Phases 5–9 ✓ with their gates quoted; each arc's Codex loop converged (quoted); a2 and a3 PRs open
  against `main`; a3 says `Delivers ask18`, `Delivers ask25`, `Delivers ask27`, quotes every pick and carries the
  archive move.
- `/loop 15m` Drive `implementations-plan/fees-1`: reality-check plan.md and the PRs, take the next step of §6 or §8,
  decide with Codex at high on `gpt-6.1-sol`; never merge; never start a3 before the owner's ask27 pick.
