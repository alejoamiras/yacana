# Phase 1: toolchain pins and Noir homes

- The 6.0.0 installer at `install.aztec-labs.com/6.0.0/install` still hashes to `f7a00e03…03b1` (refetched
  2026-10-25). The installed toolchain's binaries were hashed in place; CI's fresh install re-proves them.
- `forge-std`'s tree digest is unchanged from 5.2.0 (`33eb015a…`); only its path moved under
  `@aztec-foundation/l1-artifacts`.
- The `nargo` pins keep 5.2.0's shape: the git dependencies our own `Nargo.toml` files name (aztec-nr's new home,
  aztec-packages for `bb_proof_verification`, aztec-standards, keccak256, poseidon v0.3.0). Recon's change map
  also listed `poseidon v0.4.0` and `sha256 v0.3.0`: the first is fetched by nothing here, the second is a
  transitive of aztec-nr that 5.2.0's lock did not pin either. aztec-packages `v6.0.0` is the `v6.0.0-rc.7` commit.
- Four `Nargo.toml` files name git dependencies; three changed (`crates/lib` names poseidon only).
- `prove` before `codegen` worked as planned: `codegen` then rewrote only `proof-layout.json`'s version; the
  VK, VK hash, `vk.nr` ×2, `vk.ts` and `proof_points.nr` are byte-identical, and a second `codegen` is clean.
- Gate: `YACANA_REQUIRE_TOOLCHAIN=1 bun test tools/localnet/src/toolchain.test.ts protocol/work-circuit` 23 pass;
  `contracts:compile` 38 s; `lint:shell` and `lint` exit 0.
