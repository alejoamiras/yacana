# Phase 0: planning

## Spike: how forge 1.8.5 prices a broadcast

- Setup: anvil on a registry port; an in-process proxy that multiplies every `eth_estimateGas` answer and records
  each `eth_sendRawTransaction`; `forge script script/Deploy.s.sol:Deploy --broadcast --json` with the deploy's
  environment. The script lived in the lane's scratch folder, outside the repository.
- First attempt hung for 45 s per run: `Bun.spawnSync` blocked the event loop, so the in-process proxy never
  answered forge ("failed to retrieve chain ID from fork endpoint"). An in-process server needs `Bun.spawn`.
- No flag: forge never asked for an estimate and sent 3,980,712 × 1.3 = 5,174,925, the limit of the failed
  Sepolia creation `0x533825f2…`.
- `--skip-simulation`: one `eth_estimateGas`, then the answer × 1.3 (27,864,984 → 36,224,479 at ×7; 31,845,696 →
  41,399,404 at ×8); `returns` still printed. At anvil's default 30 M block gas limit the send fails with
  "intrinsic gas too high -- tx.gas_limit > env.block.gas_limit" (forge retried 4 times); `--gas-limit 60000000`
  or `--disable-block-gas-limit` admits it.
- `--gas-estimate-multiplier 800`: the simulation × 8 (31,845,696), no estimate asked.
- Cold portal compile 7.4 s, warm 0.6 s; a forge run 0.8–1.1 s.
- Operators = 0 under `--skip-simulation`: forge failed in its local run (`script failed: ZeroOperators()`), asked
  for no estimate and sent nothing.
- `anvil --hardfork amsterdam` exists in 1.8.5 but prices the creation as prague (3,980,712 used; forge's
  simulation and anvil's estimate agree). No local EVM reproduces Sepolia's code-deposit price; the test models
  the node's quote instead.
- A probe of `anvil --hardfork <name> --port 1` does not exit: anvil accepts the fork and starts. It held the
  shell until its task was stopped. Probe a flag with `--help`, or on a claimed port with a bounded run.

## Reads

- Public Sepolia RPC: both creation transactions and receipts (numbers in plan.md Fact 4); latest block gas limit
  199,804,307.
- Etherscan, 2026-10-26 02:42 UTC: both contract pages unverified (web fetch; `curl` gets a Cloudflare challenge,
  the keyless API refuses).

## Consults

- r1, Codex gpt-6.1-sol high (session `01a17624…`): **reject**. Blocking: the planned in-process proxy deadlocks
  behind `forgeScript`'s `Bun.spawnSync` (demonstrated by this phase's first spike attempt). Also: the test proves
  forge follows the quote, not Sepolia's EVM; the RPC's quote is a new reliance; no global
  `--disable-block-gas-limit`; the proxy's port; the rig's callers. Folded into plan.md (Audit, r1): accepted 1,
  2, 3, 4 and 6 (by Fact 11's trace); rejected 5 (`port: 0` is the repo's pattern for in-process test servers)
  and 6's rig run (15 min of mining for a path `--anvil` already runs).
- final, Codex gpt-6.1-sol high, fresh session (`01a1762d…`): **conditional approve**. Conditions: (1) the brief's
  Sepolia criterion rested on history, not a dry run; (2) `startAnvil` leaks its anvil and port when readiness
  fails. Folded: a read-only dry run on Sepolia itself with the pinned `aztec-cast estimate --create` (28,088,860
  at block 11,995,218; the local initcode byte-identical to the on-chain one), now in the P1 gate; Fact 7 narrowed;
  cleanup before the rethrow, and the test's anvil and proxy in `beforeAll`/`afterAll`.
