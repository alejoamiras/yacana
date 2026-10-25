# Phase 3: the L1 side

- **The vendored refresh.** `IInbox.sol`, `Hash.sol` and the test `Inbox.sol` came from 6.0.0; `Constants.sol` gained
  `MAX_L1_TO_L2_MSGS_PER_BLOCK` and `DOM_SEP__INBOX_ROLLING_HASH`; `Errors.sol` lost `Inbox__MustBuildBeforeConsume`
  and gained `Inbox__BucketOutOfWindow`, `Inbox__WouldOverwriteUnconsumedBucket` and `Inbox__NoBucketAtOrBeforeTotal`.
  `FrontierLib.sol` is gone (the bucketed Inbox keeps no frontier tree). Against the 6.0.0 sources in
  `@aztec-foundation/l1-artifacts`, with imports stripped, every vendored file is identical except the documented
  rewrites: the Outbox's rollup typed as `address` (three lines), the Inbox's `FeeJuicePortalStub`.
- **The index changed meaning.** 6.0.0 returns a compact cumulative index (the message's place in the insertion
  order), not a tree leaf index: the first message is 0, and `testDepositBurnsIntoTheLiveVersion`'s 32 became 0.
  The Inbox's constructor takes the ring size and refuses one under 512 (`MIN_BUCKET_RING_SIZE`).
- **D5 / I3: no shortfall.** `test/Gas.t.sol` runs `forwardMany` with one leaf from a non-forwarder, every slot new,
  a 64-deep witness (the deepest the page's parser accepts, `MAX_PATH_LENGTH`) at the highest index. Leaf frames:
  exit to Ethereum 209,361 gas, signed send-ahead opening its target Inbox's first bucket 288,947, against `LEAF_GAS` 400,000. With `leafGas` 280,000 the send-ahead test fails on
  `LeafFailed` and the exit passes: the test bites. `LEAF_GAS` stays 400,000.
- **Forge 1.8.5 starts every top-level call from a test cold.** A probe (write a slot, then read it in the next call
  of the same test) read it at 2,112 gas with and without `isolate`; the leaf numbers were identical both ways. The
  tests keep `isolate = true` so the intent survives a forge that changes this.
- **I5: the estimate does fall short, but not on anvil.** Opening a bucket costs a deposit 138,612 gas, appending to
  the block's bucket 96,881 (41,731 apart; forge and anvil agree to the gas). Anvil estimates in the next block's
  environment, so its estimate (default, `latest`, `pending`) always priced the opening and matched inclusion.
  Geth's `eth_estimateGas` defaults to `latest` and builds the block context from that header unchanged
  (`internal/ethapi/api.go`), so on a block already holding a message it prices the append. Reproduced end to end
  on anvil: estimated on a pending block that already opened its bucket (96,881), sent into the next block, the
  deposit reverts out of gas at 96,544; with 45,000 more it succeeds at 138,612. Retire behaves the same (139,280
  opened). So I5's row was taken: `INBOX_BUCKET_GAS` = 45,000 (`packages/bridge/src/inbox.ts`: the gap times 64/63,
  since the portal's frame passes the Inbox 63/64 of its gas, rounded up), added by one page helper
  (`inboxWriteGas`) that the deposit, the holder's send-ahead forward and the payer check share, and by the
  operator's `retire`. A kind-1 forward still leaves its gas to the wallet. `Gas.t.sol` pins the gap under the
  margin, so a costlier Inbox fails the suite at the next bump.
- **Lapped ring.** After the ring's first lap an opening overwrites written slots and the gap shrinks to a few
  thousand gas; the first lap is the dearest case, and the one a fresh rollup is in.
- **Forge's linter** (new in this forge) prints warnings during `build` on unchanged code (`unsafe-typecast`,
  `missing-zero-check`, a view-mutability note in `Bound.t.sol`); not acted on. It flagged `block.timestamp` read
  across `vm.warp` in the new test, which now reads `vm.getBlockTimestamp()`.
- Gate: `portal:build` 0, `portal:test` 77/77 (74 + the three in `Gas.t.sol`), `abi.ts` regenerates no diff,
  `l1-deploy.ts --anvil` 0, typecheck and lint 0, `payer-funds` and `retire` suites pass.
