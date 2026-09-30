# Archived plans

Closed plans, moved here after their delivery PR merged. Evidence of what was decided and why, never a task list.

- [canonical-proof-encoding](canonical-proof-encoding/plan.md) — **completed 2026-09-30** (PR #66 squash-merged as `496c7d8`; testnet relaunched 2026-09-28; P1–P2 ✓, codex loop converged in two rounds) (light: codex, Opus 5.5, Fable 5.1 xhigh ×3, codex final) — F-001 of `/harden security` 2026-09-23: every G1 coordinate of W's proof must be reduced (< q, 136/118-bit limbs) before the ticket, since the in-circuit Mega verifier accepts c and c + q (barretenberg#1607); claim 2^15 → 2^16; merge ships with a testnet relaunch in the same PR. Recon: `canonical-proof-encoding/recon.md`.
