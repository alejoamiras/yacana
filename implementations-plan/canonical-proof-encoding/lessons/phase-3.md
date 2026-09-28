# Phase 3 — the codex fix loop, delivery and the testnet relaunch

## Codex fix loop (§7)

**Round 1** (GPT-6 Astra, high; session `01a0d06e-05b2-7121-91a5-53d67638d342`), on the net diff from `9b190fa`
with the plan, the lessons and the two rules. Started while Phase 2's recordings ran; the code was final.
- Code and comments: "no new material findings (high confidence)". Same-proof binding, all 72 coordinate checks,
  tests 1–11, generator/fixture agreement and the residual-estimate wording match the plan.
- Medium: the validation evidence was incomplete (no after-fix canary timings, no Phase 2 gate yet). Accepted: it is
  Phase 2's remaining work, not a code change.
- Verdict: `conditional approve (with conditions: complete and document the required Phase 2 validation before
  delivery)`.

**Round 2** (resumed, same session), on the completed Phase 2 evidence (no code change since round 1; only the
regenerated artifact, the replay recording and the lessons): "The Phase 2 condition is met (high confidence).
Proving measurements and calculations check out; the artifact matches the compiled output, and the replay matches
its artifact hash and class IDs. **no new material findings** — approve". The loop converged in two rounds.

## Delivery (§8)

- Before the push: `bun test` 590 pass / 0 fail and `bun run lint` exit 0 with the toolchain on `PATH` (a bare
  `bun test` without the prefix fails `vk-pinning.test.ts` on `aztec-nargo` not found: Fact 10, not a regression);
  `bun run lint:actions` exit 0.
- Branch pushed; PR #66 opened after the loop converged.

## A1 — the testnet relaunch: blocked on keys

- The owner authorized sourcing the `.env` files under `~/projects/nulo` (2026-09-23). On this machine
  (`mainframe`) there are none: the clone and its three worktrees (`azguard-attribution`, `tools-extraction`,
  `vitest-5-bump`) hold only `.env.example` templates, and `~/Projects/nulo` does not exist. The 2026-09-13
  relaunch read `~/Projects/nulo/packages/bridge-core/.env` on another machine. A wider search for key files was
  refused by auto mode's classifier as credential exploration; nothing was worked around.
- Ready, not run: a scratchpad wrapper, `relaunch.sh <env-file> check|l1|miner|register`, sourcing the file into
  its own process only (nulo's names: `PRIVATE_KEY`, the Sepolia operators EOA; `BRIDGE_DEPLOYER_SECRET_TESTNET`).
  - `check` prints only the derived signer address, to match the old record's operators
    (`0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`).
  - `l1` runs `l1-deploy.ts` against the public Sepolia node (the record keeps only that origin, so no keyed URL can
    enter it), with the registry and operators from the old record.
  - `miner` runs `bun run deploy` with the new portal.
  - `register` runs register, `set-forwarder` for the relayer `0x6792D5eb75e1F025438349d454AC91378d9F8bac`, and
    `status`.
- Around it, without keys: the `git mv` of `testnet.json`, `testnet.example-claim.json` and
  `witnesses/testnet.jsonl` to `testnet-2026-09-13.*` before `l1`; the real claim from a throwaway account with the
  headless soak miner (`AZTEC_NODE_URL=… bun run soak -- --hours 0.25`) after `register`;
  `record-example-claim.ts <txHash>`; the class-id check of the committed artifact against the new record's
  `minerClassId`; the `docs/deployments.md` section.
- The class-id check, ready: `getContractClassFromArtifact` over the committed artifact. The pre-fix artifact
  (`9b190fa`) gives `0x09500c6fc6e6e2731eff89f8c8a9de63fa9915f3aa3b9752d51d7b4b9a1ad63a`, the live record's
  `minerClassId` (the method checks out); the fixed artifact gives
  `0x0ee9c81b4018f249a69235d41eaddda33316e5142644398df3d6f56080c5b07f`, which the new record must carry. It does not
  match the live record, which is the availability hazard §3 describes.

## A1 — the keyed-run route (2026-09-24 → 2026-09-28)

- The owner moved the keys to 1Password with my-stack's keyed runs (`env-exec` on the host, `op-remote` on the Mac;
  aa-skills `5b109e1`): item `Yacana-Testnet` in vault `Keyed-Runs`, a fresh operators key and deployer secret,
  `deployments/testnet.env.example` holding only `op://` references and public values (`92075d8`).
- Dry run `yacana-operators-address-324bb9b8` at `92075d8` (a `bun -e` reading the two env vars, printing the derived
  address, its balance and the secret's length), approved on the Mac: `finished 0`. New operators address
  `0xc9b7162F57B74257261cB61a0FAc870Eda87Cbb7`, 0 ETH on Sepolia; deployer secret 66 hex chars (`0x` + 32 bytes,
  which `deploy.ts` accepts and reduces).
- Funding: the owner sent 2 Sepolia ETH from the old operators EOA `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5` to
  `0xc9b7…Cbb7` (balance read on the public node).
- The relaunch, request `yacana-testnet-relaunch-5b8fb784` at `1e41cd5` (one `bash -c` chain, shown verbatim at the
  owner's y/N), approved on the Mac 2026-09-28: `finished 0`. Before filing it, the ignored compiled miner the deploy
  reads was checked against the committed artifact (both `0x0ee9c81b…b07f`), since the pin covers only committed
  sources.
  - Sepolia: `YacanaPortal` `0x13c06CF71C75fDaE21a46d66478e738209A0370c`, deployed in
    `0x42d38318a3135077227c6184a4387886ab83659506dc8778e20192dd2074bc61` (it creates YACA
    `0x4DA537e78409830dCa92850fE635eFD15A60109c`); deploy block 11801404; operators
    `0xc9b7162F57B74257261cB61a0FAc870Eda87Cbb7`.
  - Aztec: miner `0x0364f04e318480bb6d6354772b12ee8e59fce2123dc43e16bc5650fd5505014c`, token
    `0x1fb296ab77cc42f7807e95fbdc2260d59cc9f5d48bff1ef65299b9a279466a15`, deployer
    `0x01ac35f9b30617d5e45cbc7e36211b299d0ac0a6d0b24ee4469d91466f10bb7e`; transactions `0x08eb0ad9…f840`,
    `0x01e37b45…c049`, `0x0b807dbe…9db9`, `0x098ba631…7b5e` (the two deploys, `bind_token`, `launch`); launched at
    once (`launchAt` 1790609292).
  - Portal: version 1821665230 registered at index 5 in
    `0xb97bd785e6e2afce454d04cba64c15530875e27d323f108e3b6216a2e12f681f`; the relayer listed in
    `0x2af3cf09a9bf110c2b23c59dcc1b2399cfcccea0435ad06c64669cb2514154c4`; `status`: registered, exited 0, inbound 0,
    headroom 384 tYACA.
- Class-id check: the committed artifact's class id equals the new record's `minerClassId` (`0x0ee9c81b…b07f`).
- Real claims under real proving on the new miner, by throwaway accounts through the headless soak miner (no keys):
  `0x11d21c2a58988fce73a2c9192561c68ca483c71e827e73ab992116c2b72bae77` (block 99287, epoch 0, after 40 W proofs),
  then `0x1adba110…0e1e` and `0x0954a6a9d00a81e3b36f7f8682f80bb2a29b064f40876fe1375c551b892c4838` (blocks
  99289–99290). An account's first claim carries the delivery handshake's second note hash, which
  `record-example-claim.ts` refuses ("2 note hashes: not one plain claim"); the example claim is the third, its
  account's second, recorded with `--keep-effect`. The unit test had the epoch's count (2) as a literal; it now reads
  it from the record. `YACANA_TESTNET_NODE_URL=… bun test tools/deploy/src/example-claim.test.ts`: 3 pass against
  the node.
- `bun run site:build` (production) passes its guards on the new record; `build.json` names the new miner and no
  `/witnesses/` file is served (the old archive moved out of the folder).
