# Recon: v6-1 (Aztec 5.2.0 → 6.0.0, fresh V6 testnet deployment)

Base: `origin/main` @ `513bd01`. Three read-only Sonnet explorers (the migration-note hit map, the toolchain
pins and regeneration map, the proof subsystem against the 6.0.0 sources), the driver's own reads, and one
measurement spike: the work circuit and the contracts compiled, keyed and proved under 6.0.0 from copies in the
lane's scratch folder (nothing in the tree changed). Paths `BB/…` are barretenberg `cpp/src/barretenberg/`.
Open issues: none (`gh issue list --state open` empty on 2026-10-25); closed `known-limit` issues: none.

## Reuse map

| Capability needed | Found | Verdict |
|---|---|---|
| Toolchain pin and verification | `.aztecrc` (read by 7 files), `toolchain.lock.json` (installer sha, binary/wasm/tree hashes, nargo commits), `tools/localnet/src/toolchain.test.ts` (verifies them, `YACANA_REQUIRE_TOOLCHAIN=1` in CI), `.github/actions/setup-aztec` (cache key = version + lock hash) | adapt: new values and the new package paths; no new mechanism |
| Installing the pinned toolchain | `setup-aztec` runs the digested installer; the installer's own downloads are unpinned (`action.yml:18-20`, `docs/roadmap.md:57-60`) | reuse; the installer's npm lock stays undigested, as in 5.2.0 (plan D4: G1 allows no new gate) |
| Headless Presto pin | `tools/localnet/bin/install-presto-server.sh` (version + per-platform digests), `tools/localnet/src/presto.ts` (`BB_BINARY_PATH`, `AZTEC_BB_VERSION` from `.aztecrc`) | adapt: 1.1.1 → 1.2.1, digests from the release's `digest` fields |
| npm scope rename | ~370 `@aztec/` TS imports in 12 workspaces (the portal's Solidity `@aztec/` remapping is local and stays) (counts per workspace in lessons/phase-0.md), 14 package names, `vite-base.ts` package lists, two deep `node_modules/@aztec/…` test imports, `scripts/boundaries.test.ts:42` | adapt: one mechanical rename by a scope map; no codemod is committed |
| viem | five workspaces alias `viem` to `npm:@aztec/viem@2.38.2`; `@aztec-labs/aztec.js@6.0.0` pins `viem 2.57.1` exactly | adapt: upstream `viem 2.57.1` exact in all five |
| Presto SDK | `@alejoamiras/presto 5.2.0-revision.2`, `presto-core 1.0.1`, `presto-noir 1.0.1` (peer `@aztec/bb.js 5.2.0`) | adapt: `presto 6.0.0`, `presto-core 1.2.1`, `presto-noir 2.0.0` (tested bb `6.0.0` only); API unchanged, `loopbackPermission` added |
| Work circuit, VK, layout, reducedness | `protocol/work-circuit` scripts (`prove`, `export-vk`, `layout-manifest`, `check:*`), `yacana_miner/src/{vk,proof_points,ticket}.nr` | reuse as-is: the spike shows the VK, layout and limb encoding unchanged; only the fixture proof and what derives from it regenerate |
| Regenerated artifacts | `artifacts:commit`, `codegen`, `export-layouts.ts`, `pin-vectors.ts`, replay `setup.ts record`, `visual-setup.ts record`, `gen-slots.ts` (gitignored) | reuse every generator; no new script |
| Vendored L1 sources | `protocol/portal/src/aztec/*` and `test/aztec/*` from v5.2.0 (`VENDORED.md`: "Refresh on an Aztec bump") | adapt: refresh `IInbox`, `Hash`, `Constants`, test `Inbox`, `FrontierLib` |
| Deployment and keyed runs | `tools/deploy` (`l1-deploy.ts`, `deploy.ts`, `bridge.ts`, `record-example-claim.ts`, `soak.ts`, `l1-verify.ts`), `deployments/testnet.env.example` (op:// template), the 2026-09-28 relaunch (`archive/canonical-proof-encoding/lessons/phase-3.md`) | reuse the relaunch sequence step for step |
| Guard that the shipped artifact matches the record | none: `apps/site/src/assemble.ts`, `apps/site/src/artifact.ts`, `packages/web-kit/src/config.ts` searched for `minerClassId`/`classId` comparisons; the relaunches checked it by hand | not built: the one-PR delivery makes the pair land together (plan §2, D1) |

## Migration notes mapped to the tree

| Upstream note | Hit? | Evidence |
|---|---|---|
| aztec-nr moved to `aztec-labs-eng/aztec-nr` | yes | `yacana_miner/Nargo.toml:7`, `yacana_bridge_hashes/Nargo.toml:7` |
| ECDSA note / protocol interfaces from aztec-nr | no | no such Nargo dependency |
| `FactScope`, `OriginBlock` → `BlockReference` | no | regex `aztec::facts\|OriginBlock\|record_retractable_fact\|FactScope` over `*.nr`: none |
| `Writer::advance_offset` removed | no | none |
| `DelayedPublicMutable` ≥ 1 h | no | state is `Map`, `PublicImmutable`, `PublicMutable` only (`main.nr:22,72-91`) |
| `DOM_SEP__*` moved | no | the `DOM_*` in `crates/lib/src/domains.nr` are the project's own |
| Batch nullifier oracle, `tx_request_salt` → `protocol_nullifier`, tx-effects tree, PXE/TXE oracle bumps | indirect | recompiling against v6.0.0 is the whole change; the spike compiled every contract with no source edit |
| Contract address separator V3 | yes | every address changes; `apps/web-miner/src/keys/classes.ts` derives account addresses (below) |
| `returnTypes`/`decodeFromAbi`, protocol contracts out of `noir-contracts.js`, `withWallet`, `GasPrice`, `getBlockHashMembershipWitness`, `L1ToL2TokenPortalManager`, `outputs.globals`, `DomainSeparator` | no | regex over every tracked TS file: none (`noir-contracts.js` is used only for `SponsoredFPC`, which stays) |
| `ACVM_*` → `NOIR_EXECUTE_*` | no | the isolated network passes neither (`isolated-node.ts:72-99`); `pinned-node.mjs` sets `realProofs: false` |
| Removed CLI commands | no | none of the nine names appear |
| `@aztec-labs` / `@aztec-foundation` scopes, viem fork dropped | yes | above |
| MultiCallEntrypoint / HandshakeRegistry re-pinned | no | no hard-coded standard-contract address; the SponsoredFPC is derived from `SPONSORED_FPC_SALT` |

## Facts the plan rests on (all checked 2026-10-25)

- **6.0.0 ships** Noir `1.0.0-rc.3` (`aztec-nargo --version`) and bb `6.0.0` (`aztec-bb --version`); 5.2.0's bb
  prints `5.2.0-nightly.20260807`. The toolchain at `~/.aztec/versions/6.0.0` was installed on 2026-10-22 by
  another project on this host; its hashes are not yet independent evidence.
- **The spike, W under 6.0.0** (copies of the crates, `verify_w` on `bb_proof_verification` v6.0.0):
  - compiles with no source edit; 4,105 ACIR opcodes and 151,728 rows, as under 5.2.0;
  - `write_vk` gives a VK and VK hash **byte-identical** to `fixtures/yacana_work/{vk,vk_hash}` (115 fields, `log n` 18);
  - the proof is 13,120 bytes (410 fields), deterministic over two native runs, and verifies;
  - the bb.js 6.0.0 WASM proof equals the native one byte for byte and verifies;
  - **the 5.2.0 fixture proof fails `bb verify` under 6.0.0 and the 6.0.0 proof fails under 5.2.0**: 352 of 410
    fields differ (fields 0–35 equal). Cause: full-width Fiat–Shamir challenges and the extra `rom_logup_gamma`
    challenge (`BB/transcript/transcript.hpp:322-330`, `ultra_honk/oink_prover.cpp:132-146`).
- `bb_proof_verification` is byte-identical between the v5.2.0 and v6.0.0 tags (`RECURSIVE_PROOF_LENGTH` 410,
  `ULTRA_VK_LENGTH_IN_FIELDS` 115). The layout constants are equal (`CONST_PROOF_SIZE_LOG_N` 25, 41 entities,
  `BATCHED_RELATION_PARTIAL_LENGTH` 8), and so is `field_conversion.hpp`'s 136/118-bit limb split with its
  `value < fq::modulus` assert at `:82`. So `proof_points.nr` and the reducedness check stand unchanged.
- **The spike, the contracts under 6.0.0** (`aztec compile --workspace` with only the dependency homes changed):
  compiles; one new warning ("Tests should be in a dedicated test crate"). The miner's class id is
  `0x05f5edc215509252395ebf2d1cdded27f0815fc7c7d1486783ddadf072b2269d` (provisional, from the scratch build),
  not V5's `0x0ee9c81b…b07f`.
- The `aztec start` flags `isolated-node.ts` passes all exist in 6.0.0's help.
- **V6 testnet**: `https://aztec-testnet.drpc.org` (the only RPC on docs.aztec.network/networks) reports
  `nodeVersion 6.0.0`, `rollupVersion 679261766`, rollup `0x1f435a7f…efba`, FeeJuicePortal `0xe59acba4…f505`,
  Inbox `0x7cdc32dd…ef8a`, Outbox `0xa5a0f7a7…e15b`, Registry `0xa0bfb1b4…71c6ba` (unchanged), `realProofs: true`.
  Its CORS reflects any origin (checked for the apex, a workers.dev preview and 127.0.0.1). The Sepolia Registry
  holds 9 versions; 679261766 is index 8 and canonical. No `*.rpc.aztec-labs.com` name for V6 resolves.
- **Fees on V6**: the canonical SponsoredFPC derived by 6.0.0 (`0x2d8fff82…69d3`, equal to the docs) is deployed
  and holds 447.19 fee juice. The deploy pays through it (`tools/deploy/src/deploy.ts:133-138`), so the keyed run
  has no fee-juice step.
- **Sepolia**: the operators EOA `0xc9b7…Cbb7` holds 1.995 ETH; the relayer `0x6792…8bac` 0.2 ETH.
- **The 6.0.0 installer** (`https://install.aztec-labs.com/6.0.0/install`, sha256 `f7a00e03…03b1`) downloads
  `packages.tar.gz` (a `package.json` + `package-lock.json`) without a digest and runs `npm ci` with scripts on.
- **Age gate**: the 6.0.0 dependency closure (walked from npm metadata: exact pins resolve to themselves, ranges to
  the newest version older than 7 days) holds 45 packages younger than seven days on 2026-10-25: 43 under
  `@aztec-labs/` and `@aztec-foundation/` (platform packages and `aztec-standards` included), plus
  `@alejoamiras/presto@6.0.0` and `presto-noir@2.0.0`. `presto-noir` is already excluded by name, so the
  exemption would list 44 names. The youngest was published 2026-10-22T17:05:41Z, so from
  **2026-10-29T17:06Z** none needs the exemption. The full list: lessons/phase-0.md.
- **Presto**: `presto-noir 2.0.0` accepts `bbVersion` `6.0.0` only (`TESTED_BB_VERSIONS`). The app needs ≥ 1.1.3 to
  fetch a v6 `bb`. The headless server bundles none; with `BB_BINARY_PATH` alone "an uncached version is still
  downloaded first" (Presto README), but `AZTEC_BB_VERSION` names the bundled release and "a request for it skips
  the download" (the app README's environment table), so the run sets both (plan F8). `presto-core` 1.0.1 → 1.2.1 adds `loopbackPermission` and moves the denied
  check into it; the status union is unchanged.
- **The 6.0.0 Inbox** keeps `sendL2Message(L2Actor, bytes32, bytes32) returns (bytes32, uint256)`. The index is the
  compact cumulative count, equal to the streaming L1→L2 tree's leaf index. Each message now writes a rolling-hash
  bucket per L1 block (`core/messagebridge/Inbox.sol:87-123`). `IOutbox`, `DataStructures`, `IRegistry`,
  `TimeMath`, `Outbox`, `MerkleLib` and `L2ProofVerified` are unchanged. `forwardOne` consumes the Outbox and sends
  to the Inbox under the immutable `LEAF_GAS` (400,000, `YacanaPortal.sol:315`, `policy.ts:31`).
- **Account classes**: `classes.ts` migrates a vault record made under the previous account class by its
  fingerprint, or by its address under `PREVIOUS_ACCOUNT_CLASS_ID` when it has no fingerprint (`store.ts:189-200`).
  Fingerprints shipped 2026-09-14 (`5aa9467`), and every successful open writes one. Under 6.0.0 the address
  separator changed, so the legacy path cannot reproduce a V5 address.
- **Hard-coded 5.2.0** outside the pins: `apps/web-miner/src/presto-prover.ts:20` (`BB_VERSION`),
  `apps/web-miner/src/presto.ts:37` (`PRESTO_AZTEC_VERSION`, shown in the download notice at `:389`), tests
  that assert `'5.2.0'`, `proof-layout.json`'s `aztecVersion` and its `PINNED_SHA256`, the replay recording's and
  the visual fixtures' `nodeVersion`.
- **No production guard compares the committed miner artifact with the record** (search above). CI's
  `contracts.yml:67` runs the production `site:build`; Workers Builds deploys `main` on every push.

## Collisions and dedup risks

- Lane `ci-1` touches every PR workflow, `.github/actions/`, `scripts/layout.test.ts` and one `CLAUDE.md` line; it
  lands first. This lane edits `CLAUDE.md`'s toolchain lines and `setup-aztec` only through `toolchain.lock.json`.
  Merge `origin/main` before the PR and keep ci-1's status jobs whole.
- `implementations-plan/follow-ups.md` exists although the repository has issues enabled: a migration blueprint
  owns, out of this lane's scope.
- `packages/bridge/fixtures/l2-proof-verified.json` (a V5 rollup log) and the vectors' `rollupVersion 1821665230`
  are test data for unchanged formats: kept.
