# deploy-2 phase 0: planning

## Evidence

- Bun 1.4.2, umask 002, scratch dir: `Bun.write(p, s)` → 0664; `Bun.write(Bun.file(p), s, { mode: 0o600 })` → 0664;
  `writeFileSync(p, s, { mode: 0o600, flag: 'wx' })` → 0600; a second `wx` write → `EEXIST`.
- A throwaway Foundry test (`Harness`; three blocks of `vm.roll` + `vm.warp(+12)`, `pause(V1, 1)` as operators, a
  `forward` expected to revert `VersionPaused`, `unpause(V1)`) passed with `pausedSeconds` 0, `deadline(V1)`
  unchanged, and a final `forward` accepted. Run through `bun run portal:test --match-contract`, then deleted; the
  test text goes into the issue body as the reproducer.
- `roll()` (`main.nr:249`) checks only that the epoch is launched and `T_MAX` old; `retired` gates `record_claim`
  and the claim path, not `roll`.
- Neither the V5 nor the V6 record carries the source's last epoch, seed or target.

## Consults

- Codex gpt-6.1-sol high, plan r1: **reject**. Blocking: the retired-node tuple-only path (one source) and the
  `commit` resend (a retry policy). Both accepted; five more findings folded (see plan § Audit).
- Codex gpt-6.1-sol high, final fresh pass: **conditional approve** (the second issue beyond the brief; a missing
  log line does not prove a commit failed; Fact 6 overstated; keep the reproducer). All folded. Resumed:
  **conditional approve** (decide the second issue before filing) → a1 files nothing for it; the report asks.
  Resumed again: **approve**.
