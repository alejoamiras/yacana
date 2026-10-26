# deploy-1 status

- 2026-10-26: adopted worktree `deploy-1` (branch `worktree-deploy-1` at ddb4c09); tier light.
- 2026-10-26: recon done (1 Sonnet sweep, gas spike on anvil, on-chain and Etherscan reads); plan drafted.
- 2026-10-26: Etherscan shows both V6 contracts unverified (02:42 UTC); a2 waits on the keyed K5.
- 2026-10-26: Codex r1 reject (spawnSync deadlocks an in-process proxy); folded: async forgeScript, startAnvil(extraArgs), precise test claim, threat model; final fresh pass next.
- 2026-10-26: final fresh Codex pass conditional approve; folded (Sepolia dry run in the P1 gate, startAnvil cleanup); resuming it to verify.
- 2026-10-26: final pass resumed → approve. Plan ready; committing.
