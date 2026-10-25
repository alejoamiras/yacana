# K: the keyed run, and the fix it found

- **K1 (L1, at d267f17): forge's simulated gas underprices a creation on Sepolia.**
  - forge gives a broadcast the gas its own simulation measured, × 1.3. The pinned forge 1.8.5 (newest EVM target
    osaka) simulated the portal's creation under prague (about 3,980,712 gas). Its broadcast
    `0x533825f2…def305` (block 11993956) had a limit of 5,174,925 and ran out of gas using all of it.
  - Sepolia's fork, active since 2026-10-06, prices a code deposit at about 1,542 gas per byte (Prague: 200). The
    creation deploys 15,317 + 2,202 bytes (the portal and YACA), and the node estimates 28,088,860 gas for it.
  - The orchestrator sent forge's own initcode with the node's estimate × 1.3 (36,515,518). Block 11993997, tx
    `0x2ac8c122…b4fb2c`, status 1, 27,866,530 gas used. Read back here through the public RPC: the code at both
    addresses, `YACA.PORTAL()` = the portal, `operators()` = `0xc9b7…Cbb7`.
  - `l1-deploy.ts` stays as it is in this PR, because the deployed sources are not touched. Follow-up: #80.
  - Lesson: an L1 deploy script that trusts its tool's simulation breaks when the chain reprices opcodes ahead of
    the tool's EVM target. Take the node's estimate, or let the caller raise the margin.
- **K2 (L2): dRPC's free plan refuses a JSON-RPC batch above 3 requests; the 6.0.0 client batches up to 100.**
  - foundation's `createSafeJsonRpcClient` sends every request issued in one event-loop turn as one array
    (`batchWindowMS` 0, `maxBatchSize` 100). dRPC answers a batch of 4 or more with HTTP 500 "Batch of more than 3
    requests are not allowed on free plan", and the SDK's fetch retries it three times before failing.
  - `bun run deploy` got further than it looked: it deployed and mined the token, then failed while proving the
    miner's deployment.
    - The token: tx `0x07a9b344…db11e9`, at `0x276e…c4d3`, class `0x2ff0…ea9f` (read back from the node).
    - The failure came from the PXE's `prefetchUpdatedClassIdHints`, whose 4 concurrent reads made one batch.
    - The token is inert, because its minter `0x28b6…9860` was never deployed.
    - Lesson: a deploy of two contracts that fails between them leaves the first on chain. A record of the run lists
      every transaction it sent, not only the last step.
  - No gate could see it: the isolated network batches without limit, and nothing ran a PXE against dRPC.
  - Fix: `NODE_MAX_BATCH` (3, `packages/miner-core/src/node-client.ts`) is passed as `maxBatchSize` at every node
    client outside `tools/localnet`. In the browser that means web-kit's `nodeClient` and `quietNodeClient`; the
    miner's wallet and the stats and landing readers all get their node from them. In the tools it means each
    `createAztecNodeClient` and `EmbeddedWallet.create(url, { nodeClientOptions })`.
  - The unit test in `packages/web-kit/src/browser/node.test.ts` issues 10 requests in one turn. The SDK's own
    client sends them as one call (the control), and each capped client never sends more than 3 per call. With the
    cap removed from either client, the test fails.
  - Live, read-only against `https://aztec-testnet.drpc.org` (node 6.0.0, rollup version 679261766), 2026-10-25,
    two runs:
    - 10 concurrent reads, uncapped: refused, a batch of 10, after the SDK's three retries.
    - The same reads capped: answered in 4 calls, at most 3 each.
    - An ephemeral embedded wallet, capped (no key, no transaction): created in 439–479 ms, first PXE sync
      155–220 ms, a fresh account registered and synced in 275–315 ms. That is 9 HTTP calls for 10 requests, at
      most 2 per call.
    - The same wallet uncapped also synced (at most 2 per call). An empty wallet's sync never batches past the
      limit; concurrent reads and a deploy's proving do.
  - A batch now leaves as several calls, and three places counted calls as batches:
    - the node-health store let a failed burst's later calls stretch its silent window from 20 s to 60 s, and a
      failure sent before its cooldown opened now lengthens nothing;
    - two stats-host tests and the node-switch e2e asserted exact call counts, and now count what was out when a
      claim, a hide or a switch began;
    - another suite's leftover global fetch stub broke the first version of the batch-size test in a full run.
  - Lesson: a public RPC's plan limits are part of the node's contract. Read the provider's limits before
    pointing an SDK with default batching at it, and run one live PXE pass against the real default node before K.
