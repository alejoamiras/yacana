---
plan: v6-1
tier: mid
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
hardening: not scheduled
budget: "recon 3 agents (Sonnet) + one scratch spike; codex gpt-6.1-sol at high; Opus 5.5 Plan audit; code-review off"
status: drafted 2026-10-25; panel in §8 (codex r2 and opus conditional approve); awaiting the orchestrator
created: 2026-10-25
---

# v6-1: the repository on Aztec 6.0.0, and a fresh V6 testnet deployment

Move every pin, dependency and generated file from Aztec 5.2.0 to 6.0.0. Prove the work circuit again under the
6.0.0 prover. Keep every gate green. Then deploy a fresh Yacana on the V6 testnet (rollup 679261766) with a new
portal and YACA on Sepolia, and point the site at it. V5 balances and epochs are not carried;
`v5.yacana.network` stays as it is. Recon: `recon.md`. Run log: `lessons/phase-0.md`.

## Assumptions

**Facts** (verified 2026-10-25; evidence in `recon.md`)
- F1. W compiles under Noir 1.0.0-rc.3 with no source edit. Its VK and VK hash are byte-identical to the
  committed ones (115 fields, `log n` 18), and so are its 151,728 rows.
- F2. The proof is still 410 fields, and the layout constants and 136/118-bit limb encoding are unchanged.
  `bb_proof_verification` is byte-identical between the tags. `proof_points.nr`, `ticket.nr` and the miner's
  `vk.nr` therefore stay as they are.
- F3. Proofs do not cross versions: the 5.2.0 fixture proof fails `bb verify` 6.0.0 and the reverse (352 of 410
  fields differ: full-width challenges and `rom_logup_gamma`). 6.0.0 native proving is deterministic, and bb.js
  6.0.0 WASM equals native byte for byte.
- F4. The contracts compile under `aztec compile` 6.0.0 with only the dependency homes changed. The miner's class
  id moves (`0x05f5edc2…269d` in the scratch build).
- F5. None of the Noir or TS breaking changes in the migration notes hits the tree, apart from the homes, the npm
  scopes, the viem fork and the address separator (`recon.md` table). The separator moves every derived address:
  the vault's previous recipe (D3), `derive.test.ts`'s pinned addresses, and the SponsoredFPC address
  `example-claim.test.ts` derives, so the committed V5 example claim fails from P2 until P6 replaces it.
- F6. V6 node `https://aztec-testnet.drpc.org`: nodeVersion 6.0.0, rollup version 679261766 (Registry index 8,
  canonical), CORS open. Its SponsoredFPC holds 447 fee juice, so the keyed run needs no fee-juice step.
- F7. The 6.0.0 closure has 45 packages younger than seven days on 2026-10-25, all of age by
  2026-10-29T17:06Z (lessons/phase-0.md lists them).
- F8. `presto-noir 2.0.0` proves only with bb `6.0.0`. Presto needs ≥ 1.1.3 for bb.js 6 (the pin is 1.1.1). The
  headless server's `AZTEC_BB_VERSION=6.0.0` names its bundled release, and "a request for it skips the download"
  (Presto app README, environment table); P4 checks it.
- F9. The 6.0.0 Inbox keeps `sendL2Message`'s signature and opens a rolling-hash bucket per L1 block timestamp
  (`Inbox.sol:257-289`). `forwardOne` runs under the immutable `LEAF_GAS` 400,000: V6's Outbox consume, and for a
  send-ahead the *target's* Inbox write. The fresh portal registers only V6, so that target is a later version.
- F10. No production guard compares the committed miner artifact with the record. Workers Builds deploys `main`
  on every push, and CI builds the production site (`contracts.yml:67`). The `Workers Builds: yacana` check runs
  on every PR too, and a failing one blocks the merge (#77).

**Inferences** (unverified; each names the step that checks it)
- I1. With the exemption removed, `bun install --frozen-lockfile` does not re-apply the age gate to locked
  versions, under Bun 1.4.0 as CI and Workers Builds run it (P2 step 2 checks it; the fallback is to wait until
  2026-10-29T17:06Z, nothing looser).
- I2. 6.0.0's aztec.js error texts still match `packages/miner-core/src/claim-failure.ts`'s patterns. The claim
  outcome tests and the bridge/cockpit shards check this (P2, P4).
- I3. A send-ahead leaf fits 400,000 gas with a 6.0.0 Inbox as its target. P3 measures it. The target is a
  future version, so the 6.0.0 Inbox is a proxy: a costlier future Inbox starves the batched leaf, and the
  uncapped `forward` still carries it (known limit).
- I4. The anvil base-fee decay that another project saw on the 6.0.0 local network does not stall the isolated
  network or the rig. P4 runs them; the flag goes in only if the stall reproduces.
- I5. A wallet's gas estimate for `deposit` (and viem's for the operator's `retire`) covers the inclusion-time
  write. An estimate runs at the latest block's timestamp, so if that block already holds a V6 message it
  prices an append, while the transaction itself opens a new bucket. P3 measures the gap.

**Asks** (the orchestrator decides at approval; working assumption in bold)
- A1. **One PR**: the code, then the keyed run from the reviewed head, then the records as its last commits.
  This regroups the brief's a1/keyed/a2 for the reason in §6 (D1).
- A2. **The default node is `https://aztec-testnet.drpc.org`**, the only V6 RPC Aztec documents. Aztec Labs runs
  none (`v6.testnet.rpc.aztec-labs.com` does not resolve). It is a third party that sees what the V5 host saw:
  the PXE's tag-sync queries and every private transaction, by visitor IP. OWNER-ASKS OA1. A later host is one
  `site.env` line. **Settled** by owner decision P1-01 (below, UI impact).
- A3. **Headless Presto goes to 1.2.1** (≥ 1.1.3 for bb.js 6; recon records its four digests).
- A4. **K runs no earlier than 2026-10-29T17:06Z**, so no key sits in a process that loads a package still inside
  its seven-day window. P1–P5 take longer than that anyway. **Lifted** by owner decision ask8: "The seven-day
  package-age wait before the keyed testnet run does not apply to packages published under @alejoamiras,
  @aztec-labs or @aztec-foundation. Every package in the 6.0.0 closure younger than seven days is one of those, so
  the keyed steps (plan section 7) start now instead of at 2026-10-29T17:06Z. The repository's own gate in
  bunfig.toml is unchanged."

## 1. Scope

**Ask map.** ask3 is delivered by the one PR (A1). The code is phases P1–P5. The keyed deployment is §7. The
records and the site's move are P6. Issues: none.

**In**: the pins (`.aztecrc`, `toolchain.lock.json`, the headless Presto); the Nargo homes; the npm scopes,
upstream viem and the Presto SDKs; the TS and test fallout; the vendored L1 sources; the regenerated fixture proof,
vectors, artifacts, layouts, replay recording and visual fixtures; every gate on 6.0.0; the keyed-step list; the
records, `site.env` and `docs/deployments.md`.

**Out**: `docs/upgrades.md`'s V5→V6 path (no continuation, retire or forward); `v5.yacana.network` and the
`yacana-v5` Worker; mainnet; repository settings; any keyed command or deploy by the lead; moving contract tests
into a test crate (6.0.0 only warns); `follow-ups.md`'s migration to issues; the unpinned installer internals
(noirup, foundryup), which stay the roadmap item they already are.

**UI impact** (the whole visible budget, quoted):
- ask3: "Upgrade the repository from Aztec 5.2.0 to 6.0.0 and move the testnet deployment to the 6.0.0 rollup.
  … the site moved to V6. V5 balances and epochs are not carried, and v5.yacana.network is left as it is."
- P1-01 (owner, on OA1): "the owner chose to ship with dRPC's public node (https://aztec-testnet.drpc.org) as the
  default V6 node", signed on the decision page with no note.
- G1 (owner, with ask3): "listing each exact package name the 6.0.0 install needs in `minimumReleaseAgeExcludes`
  …, installing, and removing the exemption again in the same PR once `bun.lock` holds them … No other change to
  the supply-chain gates."
- "Nothing else a person sees changes: the apps move to the new deployment and the V6 node, and any copy, layout or
  behaviour change beyond that is an `OWNER-ASKS.md` entry."
- What moves under ask3, and nothing more: the default node, every address, class id and rollup version the pages
  show, the epoch history and example claim (a new deployment), and the version strings that name the toolchain
  (Settings' bb.js row, Presto's "fetching its prover for Aztec 6.0.0"). The one behaviour change the bump would
  cause (a returning account refused, D3) is prevented in code. `OWNER-ASKS.md` holds the default node's
  operator (OA1) and one noted consequence of ask3 (V5 tabs' frozen copy).

## 2. Outcome & Quality Bar

**For whom**: a miner on yacana.network after the merge, and the next maintainer who bumps Aztec again.
**Excellent looks like**:
- The first page load after the deploy mines and claims on V6 with no error. A returning V5 account opens as its
  (empty) V6 account. The canary shard's real-proving claim and the keyed run's claim both mint.
- Every pinned or generated value moved for a traced reason: a diff with no unexplained churn. The four proof checks
  pass, and the fixture proof is regenerated by the same scripts that made it.
- The next bump is cheaper: a version literal that rots fails a test instead of shipping silently.
**Good enough**: no new abstraction, no new e2e scenario, no new guard; the regeneration scripts as they are.

## 3. Architecture & Implementation

**Shape.** A version migration through the existing machinery. No new module. Every generated file is regenerated
by its own generator. Three choices carry the design:
1. **The VK is the puzzle, and it did not move** (F1). So the miner's `vk.nr`, `verify_w`'s `vk.nr`, `W_VK` and
   `proof_points.nr` stay byte-identical. The codegen diff in CI proves it. Only the fixture proof and what derives
   from it change: `vectors.json` → `vectors.nr`, `proof-layout.json`'s `aztecVersion` and its `PINNED_SHA256`.
2. **Scope rename by a fixed map.** `@aztec/{bb.js, noir-noir_js, noir-acvm_js, noir-noirc_abi, l1-artifacts}` →
   `@aztec-foundation/…`; every other `@aztec/…` → `@aztec-labs/…`. `@aztec-foundation/aztec-standards` keeps its
   name. The portal's Solidity `@aztec/` remapping is local and stays. One mechanical pass rewrites imports,
   package.json names, the `vite-base.ts` lists, path strings and regexes. Typecheck is the completeness check: an
   unrenamed import names a package that is no longer installed. No codemod is committed.
3. **Version literals follow the install.** `BB_VERSION` (`presto-prover.ts:20`) and `PRESTO_AZTEC_VERSION`
   (`presto.ts:37`) become `'6.0.0'`. One bun test asserts both equal the installed `@aztec-foundation/bb.js`
   version, so the next bump fails a test instead of asking Presto for the wrong prover.

**File-level change map** (by phase; "regen" = written by its generator, never by hand)

| Phase | Files | Change |
|---|---|---|
| P1 | `.aztecrc` | `6.0.0` |
| P1 | `toolchain.lock.json` | installer URL + sha `f7a00e03…03b1`; `binaries` at `node_modules/@aztec-foundation/bb.js/build/amd64-linux/bb` + `internal-bin/{nargo,forge,anvil,cast}`; `bbjs` wasm; `trees` at `node_modules/@aztec-foundation/l1-artifacts/l1-contracts/lib/forge-std/src`; `nargo` commits for `aztec-labs-eng/aztec-nr/v6.0.0`, `AztecProtocol/aztec-packages/v6.0.0`, `AztecProtocol/aztec-standards/v6.0.0`, `noir-lang/{poseidon/v0.3.0,poseidon/v0.4.0,sha256/v0.3.0,keccak256/v0.1.3}` |
| P1 | `tools/localnet/src/toolchain.test.ts:28` | the bb.js wasm path under `@aztec-foundation/bb.js` |
| P1 | `protocol/portal/scripts/forge.ts:12`, `tools/deploy/scripts/l1-deploy.ts:23` | forge-std under `@aztec-foundation/l1-artifacts` |
| P1 | `tools/localnet/src/{presto.ts,pinned-node.mjs}` | native bb under `@aztec-foundation/bb.js`; `@aztec-labs/aztec/package.json` and the `load(…)` names |
| P1 | `tools/localnet/bin/install-presto-server.sh` | `1.2.1`, the four digests from the release (`recon.md`) |
| P1 | `protocol/*/Nargo.toml` (3 files) | `aztec` from `aztec-labs-eng/aztec-nr` `v6.0.0` dir `aztec`; `bb_proof_verification` `v6.0.0`; `token_contract` `v6.0.0` |
| P1 | `protocol/work-circuit/fixtures/yacana_work/proof` (`vk`, `vk_hash`, `public_inputs` unchanged) | regen: `prove`, then `export-vk` (bb CLI only) |
| P1 | `protocol/work-circuit/src/generated/proof-layout.json`, `src/proof-layout.test.ts` | regen (`aztecVersion` 6.0.0); `PINNED_SHA256` and the test's version and name |
| P1 | `deployments/testnet.env.example` | `AZTEC_NODE_URL` → the V6 node (the keyed run's template) |
| P2 | 12 `package.json`, `bun.lock`, `bunfig.toml` (transient) | scopes at `6.0.0` exact (`@aztec-foundation/aztec-standards` too: the Token artifact), `viem` `2.57.1` exact in the five former aliases, `@alejoamiras/presto 6.0.0`, `presto-core 1.2.1`, `presto-noir 2.0.0`; the G1 exemption added, then removed |
| P2 | ~370 imports in 12 workspaces; `packages/web-kit/src/vite-base.ts`; `scripts/boundaries.test.ts:42`; `apps/web-miner/tests/memory-store.bun.test.ts:6-7`; `packages/web-kit/src/browser/node-guard.test.ts:271`; `packages/web-kit/src/vite-base.test.ts:11`; `apps/web-miner/e2e/replay/setup.ts:50` | the scope map |
| P2 | `apps/web-miner/src/{presto-prover.ts,presto.ts}` + one test | the version literals and the test (D2) |
| P2 | `apps/web-miner/src/keys/classes.ts`, `tests/classes.bun.test.ts` | the previous recipe carries its address separator (D3), and the doc comment says so; the test pins the V5 vector and the 6.0.0 class |
| P2 | `packages/miner-core/src/keys/derive.test.ts:24-39` | the address literals only; masters and fields stay byte-equal (only the recipe moved) |
| P2 | tests asserting `'5.2.0'` (`presto*.bun.test.ts`, `presto-live`, `settings.vitest.tsx`, `config.test.ts`) | `'6.0.0'` |
| P2 | `protocol/work-circuit/fixtures/vectors.json` → `yacana_miner/src/test/vectors.nr` | regen: `pin-vectors.ts`, then `params-codegen.ts` |
| P2 | `protocol/contracts/artifacts/*.json`, `protocol/work-circuit/artifacts/yacana_work.json`, `packages/miner-core/fixtures/storage-layout.json` | regen: `artifacts:commit`, `export-layouts.ts` |
| P2 | `packages/miner-core/src/claim-failure.ts` (+ test) | only if I2 fails: new patterns, the same outcomes |
| P2 | `tools/deploy/scripts/soak.ts` | the claim row also logs `txHash` and the account (K4 reads them) |
| P3 | `protocol/portal/src/aztec/{IInbox,Hash,Constants,Errors}.sol`, `test/aztec/Inbox.sol`, `VENDORED.md` | refresh from `l1-contracts/src` v6.0.0: the bucketed Inbox, `DOM_SEP__INBOX_ROLLING_HASH` and `MAX_L1_TO_L2_MSGS_PER_BLOCK`, the three new `Inbox__*` errors |
| P3 | `protocol/portal/test/aztec/FrontierLib.sol` | deleted: 6.0.0 has no `FrontierLib` |
| P3 | `protocol/portal/test/Harness.sol` | the Inbox constructor takes four arguments and a ring ≥ 512 (`Inbox.sol:27,60`) |
| P3 | `packages/bridge/src/policy.ts`, `Harness.sol` `leafGas` | only if I3 fails (D5) |
| P3 | `apps/web-miner/src/bridge/eth.ts` (`depositCall`), `bridge/eth-balance.ts:54`, `tools/deploy/src/bridge/retire.ts` | only if I5 fails: `gas` = the estimate plus the measured new-bucket cost, one helper shared by the submission and the "no ETH for the gas" check |
| P4 | `apps/web-miner/e2e/replay/recording.json`, `apps/web-stats/e2e/{visual-rpc,visual-deployment}.json` | regen: re-record on 6.0.0 |
| P4 | `apps/web-stats/e2e/__screenshots__/*.png` | regen with the pinned image (`--update-snapshots`); only data pixels move |
| P4 | `tools/localnet/src/isolated-node.ts` | only if I4 fails: `--block-base-fee-per-gas` on anvil |
| P5 | `CLAUDE.md`, `README.md:43`, `docs/threat-model.md:51,54`, `docs/deployments.md` (toolchain lines) | 6.0.0, Noir rc.3, bb `6.0.0`, Presto 1.2.1 |
| P6 | `deployments/testnet.json` → `testnet-2026-09-28.json` (+ example claim); new `testnet.json`, `testnet.example-claim.json`, `tools/deploy/fixtures/example-claim-effect.json`; `deployments/site.env`; `docs/deployments.md` | `git mv`; the keyed outputs (never `testnet.bridge.json`, K1's side file); `VITE_AZTEC_NODE_URL`; a new section, the old one archived |

**Data flow unchanged**: nonce → `Noir.execute` → bb UltraHonk `noir-recursive-no-zk` → 410 fields →
`Poseidon2(DOM_TICKET, …)` → claim → in-circuit verify with the same VK → `assert_reduced_points` → mint. Only
the transcript inside "bb prove" changed, on both sides at once.

**Decisions** (the panel's calls on them in §8):
- D1. One PR, keyed run from its reviewed head (A1); see §6 and §8. The deployed code is pinned by P6's gate (the
  record's class ids equal the committed artifacts', and nothing deployed moves after K), not by a production
  guard: a guard would fail CI's production build and the Workers Builds check every lane waits on until the
  records land.
- D2. Test the version literals against the install rather than read `VITE_BB_VERSION` at runtime: no runtime change.
- D3. The vault's previous recipe is a class id **and** an address separator. Records get a fingerprint only when
  reopened (`keys/store.ts:191,220`), never at creation (`session.ts:509-520,605-618`). So every account not
  reopened since its creation session migrates through the previous recipe, and 6.0.0's V3 separator would turn
  that migration into a refusal. `PREVIOUS_ACCOUNT_CLASS_ID` keeps 5.2.0's class `0x1c59…d5b2`; beside it,
  `PREVIOUS_ADDRESS_SEPARATOR = 4099338721` (V2). `addressUnderClass` takes the separator and composes the SDK's
  own `computePartialAddress`, `computePreaddress`-equivalent `poseidon2HashWithSeparator` and
  `derivePublicKeyFromSecretKey` + `Grumpkin.add` (about five lines). 5.2.0 and 6.0.0 `keys/derivation.js` differ
  only in that constant. The test pins the V5 vector: master `0..31`, index 0 → `0x2e2c2bd3…bff14b` under 5.2.0
  (lessons/phase-0.md). It pins the 6.0.0 class as a literal and asserts the two classes differ. The current test,
  previous == current, cannot hold after any bump. No visible change: the record opens as before.
- D4. No new supply-chain gate (G1: "No other change"). The installer fetches its npm lock with no digest and
  runs `npm ci`; 5.2.0's did the same. It stays the roadmap item it is (`docs/roadmap.md:57-60`).
- D5. `LEAF_GAS` changes only on a measured shortfall, never on speculation. Measure `forwardOne` inside
  `forwardMany` in cold state: a kind-1 leaf (V6's Outbox consume and the mint), and a signature-authorized kind-2
  leaf whose target's 6.0.0 Inbox opens a new bucket on the ring's first lap, each with the deepest Outbox witness
  the testnet's epochs produce. Each must forward with no `LeafFailed`. On a shortfall, the measured worst case
  plus the 63/64 margin becomes the policy. The value is an immutable of the fresh portal, so P3 settles it before
  §7. A starved leaf is a liveness loss, not a fund loss: the uncapped `forward` remains (`YacanaPortal.sol:305`).

**Alternatives not taken**: a staged move (npm first, Noir later): impossible, because artifacts, SDK and proofs
are bound together (F3, F4). Runtime-derived version strings: a runtime change for no user gain (D2). Upstream's
`AZTEC_UP_SKIP_PACKAGE_LOCK` npm path: it drops the release lock. Refusing fingerprint-less records (the code
unchanged): a visible regression for every account not reopened since its creation (D3). Hashing the installer's
npm lock: a new supply-chain gate G1 does not allow (D4).

## 4. Security & Adversarial Considerations

- **Threat model.** The attacker is a supply-chain publisher (npm, the Aztec installer host, GitHub releases), a
  hostile page or node at the browser's trust boundary, or a miner who forges tickets.
- **Supply chain.** G1's exemption lists exact names, never scopes (bun ignores globs). It lives only between the
  install and the frozen re-install, and the frozen install must pass without it. Every new pin is a digest:
  installer sha, binaries, wasm, forge-std tree, nargo commits, and Presto 1.2.1's assets from GitHub's published
  `digest` fields. The installer's npm lock stays undigested, as in 5.2.0 (D4). No key ran before every package
  was of age (A4) until ask8 exempted the three publishers the young closure comes from. The local toolchain was installed by another project, so CI's fresh install
  re-proves the hashes (`toolchain.test.ts`, `YACANA_REQUIRE_TOOLCHAIN=1`). A mismatch stops the phase.
  Actions stay SHA-pinned; tokens stay `contents: read`.
- **Cryptography.** No new primitive. The reducedness check stays, and its inputs are unchanged (F2).
  barretenberg#1607 is still open in 6.0.0's sources.
- **Proof binding.** The VK is unchanged and the new fixture proof is real. `check:mutation` proves a ZK proof and
  a tampered proof are refused, and the canary shard proves a tampered claim is refused at proving. TXE and PXE
  simulation accept any bytes in the recursion black box, so only real proving counts.
- **Trust boundaries.** The node stays a checked user setting (chain id, rollup version, `rollupAddress`, classes).
  CSP stays `connect-src https:`. The default node moves from Aztec Labs to dRPC, which sees tag syncs and
  private transactions by IP (A2, OA1). A load-balanced RPC may answer from different heights; K4's soak and P6's
  live test exercise it.
- **Contracts (Noir / Solidity).**
  - Replay across rollups: the deploy domain carries the rollup version, so V5 tickets cannot claim on V6.
  - Bridge: the new portal registers only 679261766. `LEAF_GAS` is measured against the bucketed Inbox as a
    proxy for a later target (D5, I3). A starved leaf emits `LeafFailed` and the uncapped `forward` still
    carries it.
- **Keys.** The lead holds none. §7's keyed steps run through the owner's keyed-run path, and their outputs carry
  only public values.

## 5. Phases (a phase is ✓ only when its gate passes; toolchain on PATH: `~/.aztec/versions/6.0.0/bin` and its `node_modules/.bin`)

### P1: toolchain pins and Noir homes ✓
1. Set `.aztecrc` to 6.0.0. Install 6.0.0 only through the digested installer. If `~/.aztec/versions/6.0.0`
   exists, do not reinstall over it: other projects use it. Hash it, and let CI's fresh install confirm.
2. Write `toolchain.lock.json` (change map), the toolchain paths (`toolchain.test.ts`, localnet, the two
   forge-std paths), and Presto 1.2.1.
3. Move the three `Nargo.toml` homes. **Warning: `codegen` runs `export-vk`, which verifies the committed fixture
   proof, and a 5.2.0 proof fails under 6.0.0 (F3).** So prove first:
   `bun run --cwd protocol/work-circuit compile && bun run --cwd protocol/work-circuit prove`, then
   `bun run codegen`. These steps use the bb CLI and pure TS only, so the 5.2.0 npm packages still work here.
4. Update the layout test's pin and version. Point `deployments/testnet.env.example`'s `AZTEC_NODE_URL` at the V6
   node.
**Validation gate**:
- `YACANA_REQUIRE_TOOLCHAIN=1 bun test tools/localnet/src/toolchain.test.ts protocol/work-circuit` exits 0. This
  is `work-circuit.yml`'s own step: the VK pin, the VK bytes, the layout and `bb verify` on the new fixture.
- `bun run codegen && git diff --stat` shows `fixtures/yacana_work/proof`, `proof-layout.json` and the files this
  phase edits. `vk.nr` ×2, `vk.ts` and `proof_points.nr` are unchanged.
- `bun run contracts:compile` and `bun run lint:shell` exit 0.
- Layers: typecheck/lint, unit, integration (bb).

### P2: npm 6.0.0, the TS fallout, the regenerated proof artifacts ✓
1. Apply the scope map, viem 2.57.1 and the Presto SDK pins to every `package.json`.
2. **Before `bun install`, if it is earlier than 2026-10-29T17:06Z**: compute the young set (lessons/phase-0.md has
   the method). Add exactly those names to `minimumReleaseAgeExcludes`, then run `bun install`. Check that
   `bun.lock` holds each exempted name at one version only (`6.0.0`; `presto-noir` `2.0.0`). Remove them, run
   `bunx bun@1.4.0 install --frozen-lockfile` (CI's Bun), and commit `bun.lock` without the exemption. If the
   frozen install fails (I1), stop and wait for the date. Later than that date, install with no exemption.
3. Rewrite the imports and the strings (change map). Make the version literals and tests 6.0.0, with D2's test.
   Rewrite D3's test.
4. Regenerate what needs the 6.0.0 SDK: `bun packages/miner-core/scripts/pin-vectors.ts` → `bun run codegen` →
   `bun run contracts:compile` → `bun run artifacts:commit` → `bun packages/miner-core/scripts/export-layouts.ts`.
5. Record the new miner class id and the gate counts of `claim` in lessons (cf. the 5.2.0 baseline 34,155, `log n` 16).
**Validation gate**:
- `bun run lint`, `bun run typecheck` and `bun run test:components` exit 0.
- `bun test` exits 1 with exactly the two **expected failures** (F5), every other case passing. Both are in
  `tools/deploy/src/example-claim.test.ts`: the committed-effect test throws "no fee-juice write on the sponsor"
  (`:33`), and the refusal test's sponsor-leaf assertion fails (`:66`). Every gate before P6 that runs them
  allows these two and no other; P6 allows none.
- `git grep -n '@aztec/' -- ':!protocol/portal' ':!implementations-plan'` returns comments and docs only.
- `bun run contracts:test` exits 0, run while port 8081 is free (probe it; never kill it).
- `bun run --cwd protocol/work-circuit check:proofs`: prove, determinism, mutation and WASM all pass.
- Re-run the generators; `git diff --exit-code` is clean.
- Layers: typecheck/lint, unit, integration (TXE, bb).

### P3: the L1 side ✓
1. Refresh the vendored sources per `VENDORED.md`: copy, rewrite the imports, add the constants and the three
   `Inbox__*` errors the 6.0.0 Inbox needs. Delete `test/aztec/FrontierLib.sol`. Give `Harness.sol`'s Inbox its
   four-argument constructor and a ring of at least 512.
2. Measure D5's worst case and add it to the Foundry suite as a test: the leaf forwards under `LEAF_GAS` with no
   `LeafFailed`, the Outbox consumed and the Inbox total moved. Apply D5's change only on a shortfall.
3. Measure I5 on anvil (`l1-deploy.ts --anvil`): `eth_estimateGas` for `deposit` and `retire` at a block that
   already holds a V6 message, against the gas the next block's execution uses. Log both. Take I5's row only if
   the estimate falls short.
**Validation gate**: `bun run portal:build`, `bun run portal:test` exit 0. `bun protocol/portal/scripts/abi.ts &&
git diff --exit-code protocol/portal/abi` is clean (or the diff is explained). `bun tools/deploy/scripts/l1-deploy.ts
--anvil` exits 0. Layers: unit, integration (forge).

### P4: the isolated network, the recordings, the browser suites, the rig ✓
1. `bun tools/localnet/src/isolated-node.ts --smoke`; then `bun run e2e:agent -- bun test tools/deploy` (the live
   suite; P2's two expected failures only).
2. Re-record: `bun run e2e:agent -- bun apps/web-miner/e2e/replay/setup.ts record`, and
   `bun run e2e:agent -- bun apps/web-stats/e2e/visual-setup.ts record`.
3. Run each web-miner shard at retry 0 (`bridge`, `chain`, `cockpit` with `E2E_PROVERLESS=1`; `canary` real),
   with the headless Presto 1.2.1 installed. Then the web-stats, web-landing and `site:e2e` suites, then
   `bun run rig -- all`, in tmux.
**Validation gate**:
- `test:replay` passes, and so does `check-chunks.ts`.
- `bun run --cwd apps/web-stats test:visual` passes after the screenshots are regenerated with the pinned image.
  Review every changed pixel: data that moved (addresses, ids, numbers) is fine; anything else is a stop and an
  owner ask.
- Every shard passes at retry 0. One rerun is allowed for a flake named in lessons. `presto.e2e.ts` ran
  natively (its breakdown shows a native proof), and the run's `PRESTO_HOME` holds no downloaded `bb` (F8).
- The rig passes every case, `migration` and `browser` included.
- Record each suite's wall-clock against its 5.2.0 run.
- Layers: e2e, e2e on an isolated network.

### P5: docs, then CI ☐
1. Update the toolchain mentions (change map).
2. Run the Codex fix loop (§9) to convergence. Merge `origin/main` (ci-1's status jobs kept whole). Push the
   branch and open the PR as **draft**.
3. Dispatch `e2e.yml` on the branch. Its rig job installs Chromium and runs every case, `browser` and `origin`
   included (`e2e.yml:150-165`, 120 min), so it covers `harness.yml`'s headless list too; no second dispatch.
**Validation gate**: every PR check is green, except that the jobs running `tools/deploy`'s tests fail on exactly
P2's two expected failures, read in their logs. Every `e2e.yml` job is green; the canary shard is the real
proving. If the rig job fails only in `browser` or `origin`, read why: a limit `harness.yml:69-71` names (a
runner's stage time, the run's TLS names) is logged, with P4's local passes as those cases' evidence; any other
cause is a stop. `bun run lint:actions` exits 0. Layers: CI.

### K: the keyed deployment (the orchestrator; §7) ☐

### P6: the records and the site move (after K) ☐
1. `git mv` the V5 record and its example claim to `testnet-2026-09-28.*`. Commit K's `testnet.json` and
   `testnet.example-claim.json`. Set `VITE_AZTEC_NODE_URL` in `site.env`.
2. Write the `docs/deployments.md` section. Move the 2026-09-28 section under "Archived".
3. Run `class-id` (§7) on the committed miner artifact and on
   `node_modules/@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json`; compare with the
   record's `minerClassId` and `tokenClassId`.
4. Merge `origin/main`. Resume Codex on this delta (§9). Mark the PR ready.
**After K the PR takes only P6's files** (the change map's P6 row, the plan folder). Any other change that
touches what K deployed, a merge of `origin/main` included, reopens K. The PR body names K1's SHA (d267f17) and
K2's.
**Validation gate**:
- Both class ids are equal.
- `git diff --exit-code d267f17 HEAD -- protocol/portal/ yacana.params.json packages/bridge/src/policy.ts` is
  clean (what K1 deployed: the portal's immutables come from the params through `policyFor`), and `git diff --exit-code <K2 SHA> HEAD -- protocol/ yacana.params.json packages/bridge/src/policy.ts
  bun.lock` is clean (registration is write-once, `YacanaPortal.sol:222`: a miner fix after K needs a new portal).
- `bun test` exits 0: the new effect fixture clears P2's two expected failures.
- `YACANA_TESTNET_NODE_URL=https://aztec-testnet.drpc.org bun test tools/deploy/src/example-claim.test.ts`
  passes.
- `bun run site:build` passes its production guards, and `build.json` names the V6 miner.
- `bun run lint` and every PR check are green.
- Layers: unit, e2e-live-network (read-only).

## 6. Delivery

**One arc, one PR** (`feat: aztec 6.0.0 and the v6 testnet deployment`), code_review `off`; `Delivers ask3`; no
`Closes`. Opened as draft after P5's loop; ready after P6. The close-out (§9) ends it. **Precondition for the
merge**: Workers Builds succeeds on a PR head and on `main` (issue #77, lane site-1), since the merge is what
deploys the site.
**Why not the brief's a1 → keyed → a2** (D1): a code-only merge makes Workers Builds deploy a 6.0.0 app against
the V5 node and record (F10). The 6.0.0 PXE cannot sync from a 5.0.0 node, and the committed miner no longer
matches the record's class. The live apex would stay broken for the whole keyed window. The 2026-09-28 relaunch
took this route for this reason. A guard that fails the build instead (Outline B) would fail the `Workers Builds`
check on `main` and on every branch cut from it until the records land, and that check blocks every lane's merge
(#77). Parallelism: none worth lanes. P3 is independent of P2's TS work but short; P4 depends on P1–P3.

## 7. Keyed steps (for the orchestrator; the lead runs none)

All steps run from a clean checkout of a reviewed PR head after P5 is green (A4's date lifted by ask8). The template is
`deployments/testnet.env.example` (op:// references for `YACANA_L1_PRIVATE_KEY` and `YACANA_DEPLOYER_SECRET`;
public `YACANA_L1_RPC_URL`, `AZTEC_NODE_URL`, `YACANA_REGISTRY`). Steps K1–K3 were planned as one keyed run; it ran in two parts (below). Outputs (records,
transaction hashes, logs with no secret) go to `~/.cache/orchy/alejoamiras-yacana/scratch/v6-1/keyed-out/`.

| Step | Command | Key | Expect | Verify on chain |
|---|---|---|---|---|
| K0 | `bun install --frozen-lockfile && bun run codegen && bun run contracts:compile`; `class-id` (below) on `protocol/contracts/target/yacana_miner-YacanaMiner.json` equals it on the committed artifact; `git mv deployments/testnet.json deployments/testnet-2026-09-28.json` and the example claim (local only). Read-only preflight, stop on any mismatch: Sepolia chain id 11155111; the node reports rollup version 679261766 and the rollup address the Registry maps it to; that version is canonical; the SponsoredFPC holds fee juice | none | equal class ids; every preflight check holds | public reads only |
| K1 | `YACANA_OPERATORS=<address of YACANA_L1_PRIVATE_KEY, derived in the run> bun tools/deploy/scripts/l1-deploy.ts deployments/testnet.json` | L1 key | `deployments/testnet.bridge.json` (a side file K2 folds in; never committed): portal, YACA, deployBlock | with `--rpc-url "$YACANA_L1_RPC_URL"` on each: `aztec-cast code <portal>` non-empty; `aztec-cast call <YACA> 'PORTAL()(address)'` = the portal; `aztec-cast call <portal> 'operators()(address)'` = `0xc9b7…Cbb7` unless rotated |
| K2 | `YACANA_PORTAL=<K1 portal> bun run deploy` (no `YACANA_LAUNCH_AT`: launched at once) | deployer secret | `deployments/testnet.json` with rollupVersion 679261766, launchedAt, the bridge block folded in | the node's `getContract(miner)` class equals the record's; `launch` tx mined |
| K3 | `YACANA_RECORD=deployments/testnet.json bun run bridge -- register`; `… set-forwarder 0x6792D5eb75e1F025438349d454AC91378d9F8bac on`; `… status` | L1 key | registered at Registry index 8; forwarder listed | `status` exit 0, headroom > 0 |
| K4 | `AZTEC_NODE_URL=https://aztec-testnet.drpc.org bun run soak -- --hours 0.5 --report <keyed-out>/soak.jsonl`; pick an account with two `claim` rows; `bun tools/deploy/scripts/record-example-claim.ts <its second claim's txHash> --keep-effect tools/deploy/fixtures/example-claim-effect.json` | none | ≥ 2 mints by one account; `testnet.example-claim.json` and the effect fixture | the tx on `VITE_EXPLORER_URL` (if it does not index V6, an owner ask before P6) |
| K5 | `bun tools/deploy/scripts/l1-verify.ts deployments/testnet.json` (template `deployments/etherscan.env.example`) | Etherscan key | both contracts verified | Etherscan "Contract Source Code Verified" |

**Run so far.**
- **K1 ran at d267f17.** Portal `0x12D46b6878a4Dc0506CD15f94CA9E56Ae06BC4D2` and YACA
  `0xC7cc767BaaE1E979bED8a3C118587bfAea67ac2A` were created on Sepolia in block 11993997 by tx `0x2ac8c122…b4fb2c`.
  - Read back: status 1, 15,317 and 2,202 bytes of code, `YACA.PORTAL()` = the portal, `operators()` = `0xc9b7…Cbb7`.
  - forge's broadcast `0x533825f2…def305` (block 11993956) ran out of gas at its simulated limit, so the creation
    was sent as forge's own initcode with the node's estimate × 1.3 (lessons/keyed.md; #80).
- **K2 failed part-way.** It deployed and mined a token, then failed while proving the miner's deployment.
  - The token: tx `0x07a9b344…db11e9`, at `0x276eda514bd9cf70d9b3d09df8492a27fb1ba1baa69c9b05ed09c082dc69c4d3`.
  - The failure came from the PXE's class-id hint prefetch: 4 concurrent reads, one refused batch. dRPC's free plan
    refuses a batch above 3 requests, and the 6.0.0 client batches up to 100.
  - That token is an inert orphan. Its minter is the predicted miner `0x28b6eae0…ad49860`, which was never deployed,
    and that address came from a random salt that is now lost. The rerun deploys a new pair. P6 names the orphan in
    `docs/deployments.md` so nobody mistakes it for the token.
- **K2 onward runs from the head of the arc that caps every node client at `NODE_MAX_BATCH`.** That arc changes no
  file under `protocol/`, `yacana.params.json`, `packages/bridge/src/policy.ts` or `bun.lock`. P6's pin gates name
  both SHAs: K1's d267f17 and K2's.

The account's first claim carries the delivery handshake's note hash, so the example claim must be its second
(lessons.md). After the merge, `https://yacana.network/build.json` must name the V6 miner.

`class-id`, from the repo root (prints the class id of the artifact at `$F`):
```
F=<artifact.json> bun -e 'const { loadContractArtifact } = await import("@aztec-labs/aztec.js/abi");
const { getContractClassFromArtifact } = await import("@aztec-labs/aztec.js/contracts");
console.log((await getContractClassFromArtifact(loadContractArtifact(await Bun.file(process.env.F).json()))).id.toString())'
```

## 8. Audit record

**Outlines.** A (this plan): one PR; K from its reviewed head; the records as its last commits. B (the brief's
grouping): a1 merges the code with a production `site:build` guard (artifact class ids = the record's), so Workers
Builds fails until a2 lands the records; K from `main`.

**Codex round 1** (gpt-6.1-sol, high): *reject* (P1 cannot pass; the vault ask, then OA1, understates the population; delivery
contradicts the brief's grouping). Chose B. Findings, each verified against the tree:
1. The vault ask's population is every account not reopened since creation, not pre-2026-09-14 records. **Accepted**, and
   fixed beyond the ask: D3 keeps the previous recipe's V2 separator, so there is no refusal and no owner ask.
2. P1's gate is impossible: `codegen` verifies the 5.2.0 fixture under 6.0.0. **Accepted**: prove first.
3. The L1 map misses the Harness constructor, the errors and FrontierLib. **Accepted**.
4. K4 cannot find its txHash: soak logs none. **Accepted**: soak logs it.
5. `harness.yml` with `all` skips the Chromium install. **Accepted**, then superseded by the final pass's 1.
6. `LEAF_GAS`'s worst case is underspecified. **Accepted** as D5's measurement.
7. F6 is history, not preflight. **Accepted**: K0's read-only checks.
8. D4 detects after `npm ci` runs. **Accepted**, then superseded: D4 dropped (Opus ask 1).
9. A1 substitutes a delivery the brief did not authorize. **Rejected**: under B the guard fails the Workers Builds
   check on `main` and every branch cut from it for the whole keyed window, and that check blocks every lane's merge
   (#77); B's CI half needs a two-state `contracts.yml` change in ci-1's files; a stalled K leaves `main`
   undeployable. The provenance risk is met by P6's gates (class ids, the diff from K's SHA). The orchestrator
   decides A1.

**Opus 5.5 Plan audit**: *conditional approve*; chose A ("under B `main` is inconsistent for the whole keyed
window": the V5 example claim fails `bun test tools/deploy` for every lane). Findings, each verified:
1. P1's gate. **Accepted** (as Codex 2).
2. `example-claim.test.ts` fails from P2 to P6: the SponsoredFPC address moves with the separator. **Accepted**: one
   named failure in P2's and P5's gates; K4 keeps the effect; P6 clears it.
3. `derive.test.ts`'s pinned addresses. **Accepted**.
4. String paths typecheck cannot see (`toolchain.test.ts:28`, `forge.ts:12`, `l1-deploy.ts:23`,
   `vite-base.test.ts:11`). **Accepted**, plus P2's `git grep` gate.
5. After K, a change under `protocol/` desyncs `main` from the deployment. **Accepted**: P6's diff gate.
6. FrontierLib, the errors, the ring. **Accepted** (as Codex 3).
7. Visual screenshots must be regenerated. **Accepted**.
- Facts: F5 incomplete (accepted); F8 contradicts the README (**rejected**: the app README's environment table says
  `AZTEC_BB_VERSION` skips the download; its check went into P4); F9's target is a later version (accepted: D5, I3).
- Inferences: I1 under Bun 1.4.0 and the lock's versions (accepted); dRPC sees more than public reads (accepted:
  A2, OA1); the explorer's V6 index (accepted: K4's check).
- Asks: D4 is a supply-chain change G1 forbids (accepted: dropped); K no earlier than 2026-10-29T17:06Z (accepted:
  A4); V5 tabs' frozen copy (accepted as a noted consequence in OWNER-ASKS); K0's exact command, the bridge side
  file, the `classes.ts` comment (accepted).
- Own addition, from the brief's note on Inbox writers: I5 and P3 step 3.

**Codex round 2** (resumed): *conditional approve* (with conditions: correct the expected-failure gates; share the
padded gas with the payer check if I5 needs padding; the orchestrator approves A1). It now chooses A: "a required
Workers Builds check across branches makes B's deliberately failing interval repository-wide disruption". It
agreed with D3's frozen recipe after tracing `computeAddress` (Fr → Fq, `+ ivpkM`, the x coordinate) and
`store.ts:200` → `session.ts:540` → `boot.ts:386`. New findings, each verified:
12. Two expected failures, not one (`:33` and `:66`), and P4's live suite runs them too. **Accepted**.
13. A padded deposit with an unpadded "no ETH" check (`eth-balance.ts:54`). **Accepted**, conditional on I5.
14. "Known limits: none new" contradicts I3. **Accepted**: the close-out files it.
On I5 it agreed to measure, not to assume a shortfall: compare the RPC estimate with the next block's execution.
**Accepted** (P3 step 3).

**Final fresh Codex pass** (new session, gpt-6.1-sol, high): *conditional approve (with conditions: reconcile
P5's CI scope and make K1's verification command use the declared RPC)*. Findings, each verified:
1. `e2e.yml`'s rig job runs every case, `browser` and `origin` included, which P5 called local. **Accepted** in
   part: P5 now dispatches `e2e.yml` alone and reads a `browser`/`origin` failure against `harness.yml`'s named
   limits. Its fix (editing `e2e.yml` to the headless list) **rejected**: a CI change ask3 does not need.
2. K1's `cast code` names no RPC. **Accepted**: `aztec-cast … --rpc-url "$YACANA_L1_RPC_URL"`, with the exact
   `PORTAL()` and `operators()` reads.
3. `recon.md` still states D4's dropped hashing and contradicts F8. **Accepted**: recon aligned.
Looks fine (its list): prove before codegen; the change map; K0 before any spend; the K order; P6's class ids and
cleared failures; a gate for every part of ask3's Check; §4's replay and reducedness claims.

**Arc a2 (the batch cap) review, round 1** (on `d267f17..e9bb873`).

*Codex (gpt-6.1-sol, high): material findings.*
1. Medium, demonstrated. The batch-size test failed in a full run, because another suite leaves its fetch stub in
   place. **Fixed**: the test stubs fetch itself and restores it.
2. Nit: the constant's comment was compressed. **Fixed**.

*Opus 5.5 beside it: material findings.* Each was verified.
1. High: two stats-host tests asserted exact call counts that the cap changes. **Fixed**: they count the calls out
   when a claim or a hide begins and assert that none follows. Mutation-checked: a host that ignores claims, and
   turns that never wait, both fail them.
2. Medium, demonstrated. The records said K2 sent nothing, but it mined a token (§7). **Fixed** in §7 and in
   lessons, from the log and the node.
3. Medium: the test-order fault, as Codex 1.
4. Low, by trace. One failed burst, now several calls, stretched the silent cooldown to 60 s. **Fixed**: a failure
   sent before its cooldown opened lengthens nothing, and its test fails without the rule. The opaque-burst
   heuristic still counts in-flight calls, as designed, and it did so before for concurrent turns.
5. Low: `switch.e2e.ts`'s bound counted HTTP calls from before the switch. **Fixed**: the count is taken once the
   switch lands, and nothing may follow.
6. Low: P6's K1 pin lacked `yacana.params.json`. **Fixed**.
7. Nits:
   - the "one keyed run" line (fixed);
   - K1's gas figures, which now come from chain and the log (fixed);
   - STATUS's exceptions (fixed);
   - the singular "K's SHA" in round 1's audit text, left as the record of what was argued then.

**Round 2** (Codex, on `e9bb873..6125d0e`): one low, demonstrated. A 503 opens silence and three opaque failures
make it a 15 s throttle; a real 429 with `Retry-After: 90`, sent before the cooldown opened, was dropped, so the page
retried after 15 s. **Fixed** in 482c1b5: a predating 429 may still carry the node's own later deadline, never a
shorter one, and a predating opaque or 5xx failure still lengthens nothing. The test's trace fails with either half
of the rule removed.

**Implementation deviations** (the tree wins; each in `lessons/`):
- P1: the `nargo` pins keep 5.2.0's shape (the deps our `Nargo.toml` files name); `poseidon v0.4.0` is fetched by
  nothing here and `sha256 v0.3.0` is a transitive 5.2.0's lock did not pin either.
- P2: `replay-binding.bun.test.ts`'s two tests refuse the 5.2.0 recording until P4 re-records it; they join the two
  example-claim failures in P2's and P3's gates, and P4 clears them.
- P3: I5's row is taken although anvil's estimate covered the write: anvil estimates in the next block's
  environment, geth at the latest header's own timestamp, and an append-priced estimate sent into a new bucket
  reverts out of gas (reproduced on anvil). The margin is `INBOX_BUCKET_GAS` in `packages/bridge/src/inbox.ts`, and
  the holder's send-ahead forward (`forwardOnEthereum`, the same Inbox write) takes it too.
- P4: four fixes the gates found, each in `lessons/phase-4.md`: the network's `FORGE_BIN` (6.0.0 looks under
  `~/.aztec/current` first), the live burst taking turns at proving (bb.js 6.0.0 interleaves concurrent Chonk
  proofs in one process), `no-prover.ts` exporting `CircuitKind` (the read-only apps and `site:build` did not
  build), and the pruned-anchor fault reading 6.0.0's `{ number, hash }` block parameter.
- K: forge's simulated gas underprices a contract creation under Sepolia's code-deposit pricing, so K1's creation
  was sent with the node's estimate. `l1-deploy.ts` is unchanged here (the deployed sources stay put); #80 holds
  the fix. dRPC's free plan refuses a batch above 3 requests, and the 6.0.0 client batches every request of one
  event-loop turn, up to 100. Every node client outside `tools/localnet` now passes `maxBatchSize: NODE_MAX_BATCH`
  (`packages/miner-core/src/node-client.ts`). The exceptions are `tools/localnet`'s three clients and the
  debug/admin clients: they reach only the run's own node, and capping them would add a localnet → miner-core edge
  for no behaviour.
  - A batch now leaves as several calls, so three things were restated:
    - the node-health store no longer lets a failure sent before its cooldown opened lengthen it;
    - two stats-host tests and `switch.e2e.ts` counted HTTP calls as one per batch, and now count the calls out when a
      claim, a hide or a switch begins, and assert that none follows;
    - the batch-size test stubs fetch itself.
- P5: CI found one cause no local gate could: the runner's system Node is 22, and 6.0.0's `aztec start` needs 24
  (`DisposableStack`). `setup-aztec` sets up Node 24 before the install; a CI change ask3 does need.
  Its second run found a rig race 6.0.0 created: a warp right after an Inbox write proposes without the message and
  mines nothing. The rig and the bridge shard's control now warp once the node holds the Inbox's last message.
  The stats spec's mocked node waits out its in-flight answers.

**Implementation review, round 1** (on `5b85e40..158fab3`). Codex (gpt-6.1-sol, high): *nothing material*, no
findings. Opus 5.5 beside it: *nothing material*, three findings, each verified and fixed:
1. Low: `inboxWriteGas` estimated a deposit or forward from raw calldata, so a refused write (a paused version, a
   closed deposit) reached the dialog as viem's `EstimateGasExecutionError` without the portal's error name, and the
   row's own words were lost. **Fixed**: the estimate goes through the ABI (`estimateContractGas`), as the wallet's
   own did; a test refuses with `VersionPaused` and reads the name back.
2. Low: the 45,000 margin was written in both `Gas.t.sol` and `inbox.ts` with nothing tying them. **Fixed**:
   `vectors.test.ts` reads the suite's constant and fails on a drift (checked by mutating it).
3. Nit: `classes.ts` still spoke of two classes after D3 made them two recipes (class and separator). **Fixed**.

**Implementation review, round 2** (Codex, resumed, on the fix commit): *nothing material*. It compared the old and
new estimate against a mocked RPC (same inputs, same gas) and saw only the new path keep `VersionPaused`. Converged.

**Implementation review, round 3** (Codex, resumed, on the CI fixes after the PR opened; the last round): *material
findings*, one. Medium: `untilInboxSynced`'s deadline did not bound its RPCs, so a stalled node held the warp past it
(demonstrated in memory). **Fixed**: the deadline races the whole wait; a test against a server that never answers
ends at it (and hangs on the previous code). The node pin and the stats teardown drew no findings.

## 9. Post-implementation (no repository standard exists; written out)

While implementing: comments state invariants only, never a plan or phase. Log every attempt in
`lessons/phase-N.md`, and run `agent-worktree status v6-1 "phase N green: <next>"` at each gate. Three failures on
one step: stop and reassess (five under `/loop`).

1. **Codex audit** (no `/code-review`: `code_review: off`). Run
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` on the net diff from
   the plan commit. Send plan.md, the §8 ledger, the adversarial ask, and these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
     configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code
     works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does,
     restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence
     works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have.
     Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense,
     and exact."*

   Every prompt carries: "Never open, read, list, source or print `.env` or `.env.local`; never open, list or
   search `~/.agents/orchy/` or `~/.config/`."
2. **Fix loop.** Verify each claim against the tree. Fix, commit, log, then resume (`resume-codex.sh`) with the
   fix diff. Repeat until a round brings nothing material. Hard stop at three rounds. A fix that adds state, a
   lifecycle, a protocol, a recovery policy or a public contract is a plan change: stop. P6's delta gets one
   resumed round.
3. **Delivery** per §6. The PR body states what changed and why, every gate with its outcome, the suites'
   wall-clock before and after, `Delivers ask3`, and ends with the Claude Code line. The title has at most 93
   characters.
4. **Close-out** as the PR's final commits:
   - Write `## Outcome` after the front matter: date, status, PR, `Known limits:` (I3's future-Inbox proxy, filed
     as a closed `known-limit` issue, reopened when a version registers whose Inbox is not 6.0.0's), `Open
     items:`, and the retired seeds. D4's residual stays `docs/roadmap.md`'s.
   - Promote the gotchas to `implementations-plan/lessons.md` within its 8 KiB, retiring what they supersede.
   - File open items as issues; a known limit is a closed `known-limit` issue.
   - Delete `STATUS.md`, merge `origin/main` and read what changed. Then
     `git mv implementations-plan/v6-1 implementations-plan/archive/v6-1` in its own commit, with one line in
     `archive/index.md` (no `index.md` row).
   - Homes: a bug or gap → an issue with a domain label and a `Record` link; a product call → `owner-decision`; an
     exploitable weakness → a private draft advisory; a dead end → lessons.md.
5. **Teardown after the merge** (the orchestrator merges; `main` is the trunk): when
   `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/v6-1/plan.md` succeeds,
   run `agent-worktree done v6-1 --merged` and relay its output. Never force past a refusal.

## Seeds (drafts; run by no one until the orchestrator approves)

```
/goal Phases P1–P6 of implementations-plan/v6-1/plan.md are marked ✓, each backed by its validation gate reported passing in the transcript; LESSONS_FILE=implementations-plan/v6-1/lessons/phase-N.md printed per phase; /code-review NOT run; the codex fix loop converged (a resumed pass reporting no new material findings, quoted), plus one resumed round on P6's delta; the PR exists (gh pr view), opened as draft after P5 and ready after P6, with the close-out's archive move (git show --stat); bun test and bun run lint exit 0.
```
```
/loop 15m Drive implementations-plan/v6-1 forward. Each firing: read plan.md and lessons/ (not the chat). If the plan is archived on main, run the teardown (§9 step 5) and stop. Take the next unchecked phase, run the fast layers after each edit, commit signed. Long runs (check:proofs, shards, rig, re-records) go in tmux, polled in bounded loops. Never run a keyed step, never deploy, never merge. Decide with codex (gpt-6.1-sol, high), log every consult. A phase is ✓ only when its gate passes as written.
```
