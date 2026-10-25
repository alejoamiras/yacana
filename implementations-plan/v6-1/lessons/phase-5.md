# Phase 5: docs, the review loop, CI

- Docs: `CLAUDE.md`, `README.md`, `docs/threat-model.md`, `docs/roadmap.md` and four comments name 6.0.0, Noir
  1.0.0-rc.3 and Presto 1.2.1; `git grep` for `5.2.0` leaves only the frozen previous recipe, history and the V5
  records.
- Full local gates before review: lint, `lint:shell`, `lint:actions`, typecheck (48 s), `test:components`,
  `contracts:test`, `portal:test` exit 0; `bun test` 678 pass, 44 skip, 2 fail (the two example-claim assertions).
- Review round 1: Codex found nothing; the Opus leg found three lows and nits (plan §8), all fixed. The one with
  behaviour: a raw-calldata gas estimate loses the revert's ABI, so a refusal surfaces as viem's generic
  `EstimateGasExecutionError`. Estimate through `estimateContractGas` wherever the error's name is read.
- **CI's first run: every `aztec start` died before readiness.** `ReferenceError: DisposableStack is not defined`
  in `@aztec-labs/sequencer-client`'s `SequencerPublisher`: the `aztec` launcher execs the system `node`, the
  ubuntu-24.04 runner's is v22.23.3, and `DisposableStack` arrived in Node 24 (this machine runs 24.22, so no local
  gate could see it). The package's `engines` still says `>=20.16`. `aztec compile` and the TXE do not reach the
  sequencer, so `contracts` and `work-circuit` passed on 22. `setup-aztec` now sets up Node 24 first
  (`actions/setup-node` v7.1.0 by SHA); every job that starts a network goes through it. Only the two expected
  example-claim failures remained in `miner-core` and `deploy`.
- **CI's second run: the `browser` rig case failed at its first nudge, after the page's deposit.** The warp's
  checkpoint reverted in simulation with `Rollup__UnconsumedInboxMessages(1)`. 6.0.0's rollup refuses a checkpoint
  that leaves an Inbox bucket past its cutoff unconsumed (`ProposeLib.validateInboxConsumption`), and the automine
  sequencer builds from what its archiver's message store holds (`localSyncedCount`). The nudge followed the
  deposit's receipt before the archiver's next poll, so the propose dropped, the node answered the warp with
  success, and L1 did not move. The rig's `PrunedPending` scan then asked anvil for `fromBlock > toBlock`, which
  6.0.0's L1 transport reports only as `L1 RPC request failed` (probed: the cause is "Invalid parameters").
  Locally the archiver always won the race (eight warps across two probes, the second under `pauseSync`, which does not hold the
  message sync). Fix: `untilInboxSynced` (`tools/localnet/src/inbox-sync.ts`) waits until the node's
  `getL1ToL2MessageIndex` knows the last `MessageSent` on its Inbox. Both that and the automine's count read one
  message store. The rig and the bridge shard's control both warp through it, and a warp that mines nothing now
  fails under its own name. A timestamp barrier (`getSyncedL1Timestamp`) is not enough, because anvil gives blocks
  in the same second the same timestamp (probed).
- **web-stats: `route.fetch: Test ended`.** All 7 tests passed, but the last test using the mocked node ended with a
  poll still being forwarded, and Playwright failed the run on the closing page. `afterEach` now runs
  `page.unrouteAll({ behavior: 'wait' })`, which lets in-flight answers finish rather than ignoring errors.
- A `test:components` timeout in `stats-view`'s `continuation.vitest.tsx` (5.6 s against 5 s) came at load average
  107 from other runs on this machine. Its rerun passed 83/83, and no timeout was raised.
