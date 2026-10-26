# deploy-1 recon

Base: `origin/main` at `ddb4c09`. One Sonnet reuse sweep, plus reads, a gas spike and read-only chain and
Etherscan checks by the planner (2026-10-26). The spike script stayed in the lane's scratch folder, outside the
repository.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| The creation's gas | `tools/deploy/scripts/l1-deploy.ts:76-88` runs `forge script … --broadcast --json` with no gas flag | adapt: add `--skip-simulation` |
| Anvil for the test | `startAnvil` at `l1-deploy.ts:29-55` (registry port, own process group); the only other spawn is inline in `tools/localnet/src/isolated-node.ts:154` | adapt: export it |
| Anvil's key | `ANVIL_KEY` at `l1-deploy.ts:27`, not exported | adapt: export it |
| A node that prices like Sepolia | nothing JSON-RPC-aware to reuse. `apps/web-miner/e2e/node-proxy.ts:40-77` is a Playwright CLI helper that starts servers on import. The other `Bun.serve` stubs (`tools/localnet/src/inbox-sync.test.ts:4`, `apps/web-miner/tests/*.bun.test.ts`) only answer. Searched `Bun.serve`, `createServer`, `fake node`, `stub`, `recorder`, `rewrit` | build new: about 12 lines inline in the test, `port: 0` as the in-process servers do |
| Toolchain gate in a bun test | `protocol/work-circuit/scripts/bb-verify.test.ts:9-17`: `absent` first, then a dynamic import of the module that resolves the toolchain on import; `tools/localnet/src/toolchain.test.ts:17` | reuse the pattern as is |
| Per-test timeout | the trailing argument, `}, 60_000);` (`bb-verify.test.ts:39`) | reuse |
| Gas margins on L1 | `INBOX_BUCKET_GAS` (`packages/bridge/src/inbox.ts:17`, used at `tools/deploy/src/bridge/retire.ts:52`); no `--gas-estimate-multiplier` or `--skip-simulation` anywhere. Searched `estimateGas`, `gasMultiplier`, `gas-estimate`, `skip-simulation` | none applies to a forge broadcast |
| Read-only Etherscan check | `curl` gets a Cloudflare challenge page; the keyless v2 API answers `Missing/Invalid API Key`; a web fetch of the contract page reads it | a web fetch of both `#code` pages |

## Callers and lanes

- `deployL1` is called by `tools/deploy/src/bridge/run.ts:24`, by `tools/harness/src/yacana.ts:32` (the rig's L1)
  and by the CLI (`--anvil` in `portal.yml:49`, and Sepolia). They read only the returned record. Nothing parses
  forge's simulation or counts RPC calls. Every RPC they use is an anvil that answers `eth_estimateGas`.
- `startAnvil`, `deployFakeRegistry` and `ANVIL_KEY` are used only by the script's own main block.
- `l1-deploy.ts:21-24` calls `toolchainBin('aztec-forge')` at import. `deploy.yml:44` and `miner-core.yml:28` run
  `bun test tools/deploy` without the toolchain, so a test that imports the script statically breaks both lanes.
  The yacana-bridge phase 12 lesson records the same trap in `visual-setup.ts`.
- `scripts/layout.test.ts` `filterGaps` and `closure`: a portal.yml step `bun test tools/deploy/scripts/l1-deploy.test.ts`
  needs a filter glob that matches the file. It also needs `tools/deploy/**`, `packages/bridge/**` and
  `packages/miner-core/**`, which are the closure of `@yacana/deploy`'s `dependencies`. `protocol/portal/**` is
  already in the filter. `_changes.yml` filters with `some-with-excludes`, and only documentation may be excluded.
- The portal job takes 33–42 s with the toolchain cached (runs 40259068638 and 40257728212). The deploy job takes
  11–14 s.
- The harness lane runs on `tools/deploy/**`, but a pull request runs only the `flip` case.
- No boundaries rule blocks a `tools/deploy/scripts` test from importing `@yacana/localnet/*`, which is already a
  devDependency. `tools/deploy/tsconfig.json` includes `scripts/`.

## Docs

- How to run the deploy: `docs/deployments.md:162` and `docs/upgrades.md:20`. Neither says how the gas is chosen.
- "Etherscan verification pending" appears only at `docs/deployments.md:178-179`. The rows for verified contracts
  (`:249-250`, `:287-288`) say "verified" and link the address with `#code`.

## Tracker

- Open issues: #80 and #81 only. The closed known limit #82 (`LEAF_GAS` for a later version's inbox) is not this
  lane's.
- Not this lane's: `git ls-files -ci --exclude-standard -- implementations-plan` lists transcripts that older,
  still-active plans committed before the ignore rules existed. They belong to those plans, so this lane leaves
  them.
