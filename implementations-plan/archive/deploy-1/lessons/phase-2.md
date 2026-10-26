# Phase 2 (a2): the two rows verified

- Base: `deploy-1-a2` from `origin/main` at ba5aae8 (a1 merged as #84 at d58a2d2; #86 and #88 landed after it).
- K5 (the orchestrator's keyed step, run from ba5aae8): `bun tools/deploy/scripts/l1-verify.ts deployments/testnet.json`, both contracts "Pass - Verified" on chain 11155111. The lane did not run it.
- Read-only check, 2026-10-26 22:45 UTC. A direct `curl` of the pages got Cloudflare's 403, and the Etherscan API without a key answered "Missing/Invalid API Key". A web fetch of both `#code` pages read:
  - `0x12D46b6878a4Dc0506CD15f94CA9E56Ae06BC4D2`: "Source Code Verified (Exact Match)", Contract Name `YacanaPortal`, `v0.8.30+commit.73712a01`, optimization "Yes with 200 runs", EVM `prague`.
  - `0xC7cc767BaaE1E979bED8a3C118587bfAea67ac2A`: "Source Code Verified (Exact Match)", Contract Name `YACA`, the same compiler, runs and EVM.
  - These match `protocol/portal/foundry.toml` (0.8.30, prague, 200 runs). Neither page shows a verification date; the unverified read at 02:42 UTC (phase-0) and this one put it on 2026-10-26 UTC.
- The rows sit at `docs/deployments.md:179-180` on trunk; the plan said `:178-179` because the file moved by one line.
- a2 fix loop: Codex r1 clean (`01a17a66…`); Opus 5.5 beside it, 2 low on this record, folded. Converged in 1 round.
