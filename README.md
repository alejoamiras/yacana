# yacana

A privately mineable token on Aztec whose mining work is Barretenberg proving. A miner proves a fixed
Noir circuit per nonce; the ticket is Poseidon2 over the whole UltraHonk proof; a ticket below the
target wins; the winner claims through a private transaction that verifies the proof in-circuit and
mints privately. Epochs close after `N` accepted claims and the target rescales by actual / expected
time, clamped to [¼, 4] — Bitcoin-style difficulty without a native hash to grind.

| | |
|---|---|
| Mechanism, security, phases | `implementations-plan/elixir-core/plan.md` |
| Threat model with the measured figures | `docs/threat-model.md` |
| Deployments (public testnet) | `docs/deployments.md` |
| The bridge to Ethereum and between Aztec versions | `docs/bridge.md` |
| The runbook for the day Aztec moves on | `docs/upgrades.md` |
| Web miner | `apps/web-miner/README.md` |
| Roadmap and deferred work | `docs/roadmap.md` |
| Working conventions | `CLAUDE.md` |

## Layout

Four workspace folders, each a layer; production code imports its own layer or below (`tools/` may import
anything), and a workspace is reached by its `@yacana/<name>` and an exported subpath, never by a path, but for
the few config-time edges `scripts/boundaries.test.ts` lists.

- `apps/` — what ships: `web-miner` (React page with an embedded wallet), `web-stats` and `web-landing` (the
  observatory and the landing), `site` (the three as one origin).
- `packages/` — shared TypeScript: `miner-core` (platform-agnostic: proof → ticket, retarget mirror, epoch reader,
  claim builder, mining loop), `bridge` (the crossing protocol shared by the contracts' vectors, the operator script
  and the page: contents, secrets, witnesses, the journal, the recovery file, the portal reader), `ui` (the design
  system), `web-kit` (what the apps share below the components: config, headers, the Vite base, the browser
  connection).
- `protocol/` — `work-circuit` (the Noir work circuit `W` and its VK), `contracts` (`YacanaMiner` and the
  aztec-standards token), `portal` (`YACA` and `YacanaPortal` on Ethereum, Foundry).
- `tools/` — `deploy` (deploy, bridge, soak and epoch-stats scripts), `harness` (the upgrade rig's cases: a rollup
  upgrade of the local network with the bridge across it), `localnet` (run isolation for parallel local networks,
  the upgrade rig).

## Quick start

```
bun install
bun run codegen && bun run contracts:compile   # aztec 6.0.0 toolchain, see CLAUDE.md
bun run lint && bun test                        # unit suites
bun run e2e:agent -- bun test packages/miner-core                     # live suite on an isolated network
bun run e2e:agent -- bun run --cwd apps/web-miner test:e2e        # web miner in headless Chromium
bun run --cwd apps/web-miner dev                                  # the miner against the public testnet
bun run portal:build && bun run rig -- flip                           # the local network upgrades itself (the bridge's rig)
```
