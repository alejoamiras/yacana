# Roadmap

Source of truth for phases and gates: `implementations-plan/elixir-core/plan.md` §6. This file tracks status and the
backlog that the plan defers.

## Phases (arc A1 = 0–1, A2 = 2–3, A3 = 4–5)

| Phase | What | Status |
|---|---|---|
| 0 | Scaffold + CI (Bun workspace, Biome budgets, hooks, run isolation, per-package PR gates) | done |
| 1 | Feasibility spike: work circuit, proof-layout manifest, real claim tx, ticket-cost measurements → GO / NO-GO | GO (owner, 2026-09-03); `implementations-plan/elixir-core/spike-results.md` |
| 2 | Contracts (`yacana_miner`, token binding, retarget, TXE tests, retarget simulator) | done |
| 3 | miner-core (proof → digest, retarget mirror, epoch reader, claim builder, live integration, concurrent burst) | done |
| 4 | Web miner (React + Vite + shadcn, Worker-hosted bb.js, embedded wallet, sponsored FPC, pinned CRS, Playwright E2E) | done |
| 5 | Testnet soak on the `testnet` profile (2 h, 21 epochs closed, `docs/soak-report.md`), docs, mainnet-readiness notes | done |

## The bridge and the migration (`implementations-plan/yacana-bridge/plan.md` §6; arcs 1–4)

| Phase | What | Status |
|---|---|---|
| P1 | The protocol: message contents, secrets and redeem keys from the master, the three-way vectors (Noir, Solidity, TS), the toolchain module (`aztec-forge`, `anvil`, `cast` pinned) | done |
| P2 | The miner's bridge functions (`exit_to_l1`, `send_ahead`, `claim_from_l1`, the retire message), the counters and exit logs, the continuation constructor | done |
| P3 | `YACA`, `YacanaPortal` (the cap, the pause, the deadline, forwarding, redeem, deposit), the L1 deploy script, the record's `bridge` block | done |
| P4 | The upgrade rig: the local network flips itself (H0), `harness.yml` | done |
| P5 | The migration cases H1–H11 on the rig and the operator script (`bun run bridge -- …`) | done |
| P6 | The site layer (the record's blocks into the apps, the Ethereum RPC as a second guarded slot) and the miner's bridge modules (journal, queue, facts, landing, recovery) | done |
| P7 | The guided path: the migration card, Send ahead, the arrival card's one-tap Claim, exits and deposits, the recovery file | done |
| P8 | The versioned origin: the `old` role, the `yacana-v5` Worker, one passkey across both origins | done |
| P9 | `/stats/bridge`, the announcement lines, Verify's Ethereum tile, the standalone `/faq` | done |
| P10 | `docs/bridge.md`, the runbook `docs/upgrades.md`, the threat-model rows, CI filters, the witness archive served with the site | done |
| P11 | The testnet rehearsal: Sepolia (EOAs), the testnet profile redeployed with the bridge, the preview site, one crossing of each kind; preview deployments only | pending |

Deferred by that plan's decisions (`plan.md` §5, §8):

- The hourly automatic send-ahead of new wins (A8, D12): sends are manual and landing is a one-tap Claim.
- The Safe as the operators (A4, D50): Sepolia runs with EOAs; the Safe, its signers and threshold arrive with the
  mainnet plan, which also decides the policy figures for mainnet.
- An indexer or a relayer: the page reads the portal's events and the miner's logs itself and matches locally;
  Yacana forwards by hand from the operator script.
- Discovery of an earlier version's unforwarded sends from the served witness archive on a device that never
  held them: today the archive completes a crossing the journal already holds, and a fresh device restores what
  left from the recovery file (`docs/bridge.md`, "What a holder keeps").
- The old origin's take-down after a version's deadline and the apex switch are post-merge production steps, run
  by the owner (`docs/upgrades.md`).

## Deferred (later plans)

- Native / CLI mining via aztec-accelerator on top of miner-core.
- External wallet connection (`@aztec-labs/wallet-sdk`); the embedded wallet ships first.
- Mainnet fee path (fees are sponsored in this plan) and launch operations. Any sponsor that pays for arbitrary
  calls is drainable by public reverts (premature `roll()`, claims sequenced after a close): self-paid fees, or a
  sponsor with per-account quotas and a function allowlist (`docs/threat-model.md`).
- Live forced-expiry test: a claim held past `CLAIM_TTL_SECONDS` must be dropped, its PXE delivery index freed
  on the next sender sync, and a second claim from the same account accepted (the expiration itself is asserted
  in the live suite today).
- `/harden security` before any mainnet deployment (no external audit, plan Ask 8).
- Fully pinned toolchain install in CI: `toolchain.lock.json` pins the version installer script and verifies
  nargo, bb and the WASM after install, but the installer's own downloads (`noirup` from a moving branch,
  foundry, `npm ci` against a lock it fetches without a digest) still run unpinned on the runner. Owning the
  install (lockfile + pinned nargo release) closes that.
- An executed same-witness re-derivation measurement (patched bb prover build) — deferred by the owner after Phase 1; Phase 1 reports a timer-derived
  estimate (`spike-results.md` §4b).
- Web miner storage: the embedded wallet uses the deprecated IndexedDB stores (`@aztec-labs/kv-store/deprecated/indexeddb`);
  moving to the SQLite-OPFS default needs its worker and WASM assets emitted unhashed by the build.
- **Claiming after a public revert** (Phase 5 finding): a stale claim that reverts in public leaves the miner's
  PXE with a pending note-delivery index for a nullifier that never landed; the next claim's constrained delivery
  asserts it and is refused until the reverted tx is FINALIZED on L1 (tens of minutes on the testnet). The web
  miner recovers by rebuilding the key's chain view (`resetAccountView`: drop the PXE namespace, reopen, re-register,
  re-sync; the reverted tx is absent from the chain's logs, so the fresh view never learns of the index), with an
  honest pause until finality as the fallback; the soak driver rotates to a fresh account. Residual: one device per
  key at a time (two PXEs on one account desync their delivery indexes). Upstream: [aztec-packages#25418](https://github.com/AztecProtocol/aztec-packages/issues/25418). A
  contract redesign without constrained delivery remains the other option: the standard token's
  `initialize_transfer_commitment(to, miner)` followed by a public `mint_to_commitment(commitment, reward)`; it needs
  a redeploy and a privacy-footprint review (the public-effects test would change).
- Passkey backup before mainnet: a passkey key has no backup by design today (the page says so); a synced
  passkey follows its platform account, a lost authenticator loses the key. Before mainnet: an export path or a
  words-backed second factor.
- Key rotation and account discovery: `deriveAccountFields` keeps its index parameter; the miner uses index 0 only.
- External wallet connection for launch mode (`@aztec-labs/wallet-sdk`): the landing links the CLI commit path.
- Testnet soak operations: the soak driver (`tools/deploy/scripts/soak.ts`) mines from one machine with a
  hashrate schedule; a second machine or a second deployment profile would exercise multi-miner races beyond the
  8-wallet local burst.

## Decisions

Recorded in `implementations-plan/elixir-core/plan.md` §8 (decision ledger) and §5 (Asks 1–12, all decided).
