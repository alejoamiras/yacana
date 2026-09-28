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
- Next: the owner funds it from the old operators EOA `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`; then one request
  runs the whole relaunch chain.
