---
plan: canonical-proof-encoding
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
hardening: none (this plan is the fix for F-001 of `/harden security` 2026-09-23-contracts; no new trust boundary)
budget: "recon 1 agent (Sonnet); codex at high (GPT-6 Astra); an Opus 5.5 same-family audit, then a Fable 5.1 xhigh audit loop, both at the owner's request (light normally has neither); code-review off (default)"
status: drafted 2026-09-23; codex → conditional approve, Opus 5.5 → conditional approve, Fable 5.1 xhigh ×3 → conditional approve each, codex final pass → conditional approve; every condition folded (§6); owner 2026-09-23: the testnet is the team's own, A1/A4 rewritten (the session relaunches testnet in the PR with nulo's keys, no disclosure hold); awaiting the owner
created: 2026-09-23
---

## Outcome

Delivered 2026-09-28 as PR #66, unmerged (the merge is the owner's). Both phases ✓ on their gates: `claim` refuses
a proof unless every coordinate of its 36 points is reduced, at offsets generated from the layout manifest; 31,985 →
34,155 gates, `log n` 15 → 16; claim-transaction proving +8.9 % on the two planned samples (+6.9 % over three). The
codex loop converged in two rounds ("no new material findings — approve"). A1 ran as a keyed run (1Password on the
owner's Mac, `op-remote`, my-stack's keyed runs, built for this): a new portal and YACA on Sepolia, the fixed miner
(class `0x0ee9c81b…b07f`, equal to the committed artifact's) registered at index 5, three real claims under real
proving, the example claim recorded; `main`'s one-surface arcs merged in and the merged tree validated. Addresses and
hashes: `lessons/phase-3.md`, `docs/deployments.md`. Its `/goal` and `/loop` seeds are retired.

# canonical-proof-encoding: one encoding per proof point before the ticket

The miner's `claim` verifies W's proof in-circuit and then hashes the proof's 410 raw fields into the ticket. The
in-circuit verifier (Chonk app circuits are Mega; its Goblin field decoder keeps limbs as given) accepts a base-field
coordinate `c < 2^254 − q` written either as `c` or as `c + q` (barretenberg#1607, public, open, label "audit";
upstream's own table marks it "Goblin … ACCEPT ⚠️", `BB/stdlib/primitives/field/CODEC_README.md:164`). One accepted
proof therefore has several encodings, each with its own ticket and nullifier. By estimate (not executed end to
end), re-encoding the last point (KZG W) is free and gives about 1.75 tickets per proof on average. The three lookup
commitments of every W proof are the point at infinity, so every proof also has 64 deterministic oink encodings.

The fix: `claim` accepts a proof only if every coordinate of every G1 point in it is **reduced**, meaning limbs of
136 and 118 bits and a value below q. That is exactly the encoding bb's native serialiser emits, so honest proofs
pass unchanged and every alias is refused. It costs ≈ 2k gates and moves `claim` from 2^15 to 2^16 rows, where the
miner's other three private functions already are.

Recon: `recon.md`. Source finding: F-001 of the `/harden security` run 2026-09-23-contracts (verified by Opus 5.5 and a
GPT-6 Astra xhigh session). Paths `BB/…` are under barretenberg v5.2.0 `cpp/src/barretenberg/`.

## 1. Scope

**In**
- The check in `yacana_miner` (`src/ticket.nr`), called from `claim` before `ticket_digest`.
- The point offsets, generated from the proof layout by the existing manifest script.
- A two-direction check that the manifest's points are the fixture proof's real points.
- The Noir tests, the evidence classifier's alias diagnostic, the committed miner artifact, the replay recording,
  `docs/threat-model.md`, and `CLAUDE.md`'s work-circuit row.
- Measurements: `claim`'s gates and VK `log n`, and the successful claim's transaction-proving time, before and
  after.
- The testnet relaunch that carries the fix (A1), run by the implementing session on the owner's word
  (2026-09-23).

**Out**
- Merging. The live miner has no upgrade path (`main.nr:3`); the relaunch replaces it, and the merge stays the
  owner's call. The current deployment is the team's own and does not gate the merge (owner, 2026-09-23).
- F-002, F-003, F-004 (the owner declined the Lows).
- The unconstrained-witness class (§3), a bb property whose best-known strategy is estimated at about 54.5 % of a prove, and any upstream patch.
- A TS mirror of the check. Honest provers emit reduced coordinates. Native bb refuses aliases
  (`BB/ecc/fields/field_conversion.hpp:71-82`), and a Presto answer is verified in WASM before it reaches a claim
  (`apps/web-miner/src/presto-prover.ts:162-177`).
- Pre-existing tooling gaps the audits found (in follow-ups): `aztec test`'s fixed TXE port, and CI checking
  toolchain hashes after running the toolchain.

## 2. Architecture & Implementation (compact)

**Where**
- `protocol/work-circuit/scripts/layout-manifest.ts` already builds the 410-slot list. After writing
  `proof-layout.json`, it also writes `protocol/contracts/yacana_miner/src/proof_points.nr`: the start offset of each
  of the 36 points, one per line with its label. It uses the same `// Generated by … — do not edit.` header and the
  same cross-package write as `export-vk.ts:45-47`.
  - Root `codegen` runs `params-codegen` first and this script last, so nothing reads a stale manifest.
  - On pull requests, `contracts.yml:55` and `work-circuit.yml:47` diff the codegen output. The e2e and harness
    copies of that step are dispatch-only.
- `ticket.nr` gains `assert_reduced_points(proof)` and its per-coordinate helper, next to the hash they protect.
  `ticket_digest` stays a pure hash that mirrors miner-core's `computeDigest`; the TXE grinder and the vectors
  depend on that.
- `main.nr` `claim`: `assert_reduced_points(proof);` right after `verify_honk_proof_non_zk`, before `ticket_digest`.
  Plus `mod proof_points;`.

**Key interfaces**
```noir
// proof_points.nr (generated)
pub global W_PROOF_POINTS: [u32; 36] = [0 /* pairing_inputs.P0 */, 4, 8 /* W_L */, …, 402 /* Shplonk:Q */, 406 /* KZG:W */];

// ticket.nr — q = 2^136·Q_HI + Q_LO, the BN254 base-field modulus
global Q_LO: Field = 0x5d97816a916871ca8d3c208c16d87cfd47;
global Q_HI: Field = 0x30644e72e131a029b85045b6818158;
pub fn assert_reduced_points(proof: [Field; RECURSIVE_PROOF_LENGTH]); // x = (p, p+1), y = (p+2, p+3) for each p
pub(crate) fn assert_reduced(lo: Field, hi: Field) {
    lo.assert_max_bit_size::<136>();
    hi.assert_max_bit_size::<118>();
    let top = (hi == Q_HI) as Field;
    (Q_HI - 1 - hi + top).assert_max_bit_size::<118>();
    ((Q_LO - 1 - lo) * top).assert_max_bit_size::<136>();
}
```

**Why this accepts exactly the reduced encodings.**
1. The first two checks give `0 ≤ lo < 2^136` and `0 ≤ hi < 2^118`. So `Q_HI − 1 − hi + top` lies in
   `(−2^118, 2^118)` as an integer, and a negative value wraps to `r − k > 2^253`, which fails the third check.
2. If `hi < Q_HI`: `top = 0`, the third check passes and the fourth is `0`. The value is at most
   `2^136·Q_HI − 1 < q`.
3. If `hi = Q_HI`: `top = 1`, the third check is `0`, and the fourth passes iff `lo ≤ Q_LO − 1` (a larger `lo` wraps).
   The value is at most `q − 1`.
4. If `Q_HI < hi < 2^118`: `top = 0`, and the third check wraps and fails.

So the accepted set is exactly `{(lo, hi) : lo + 2^136·hi < q}` in base-2^136 digits: one encoding per value, and
every honest value is accepted. The serialiser splits `uint256(val)` into 136 + 118 bits
(`BB/ecc/fields/field_conversion.hpp:89-105`), and infinity is `(0, 0)`.

What each check stops:
- Without check 1, `(lo + 2^136, hi − 1)` aliases a value.
- Without check 2, `hi = r − 1` passes check 3 (it evaluates to `Q_HI`).

The coordinate is never recomposed as one `Field`, because q > r would wrap it.

**Critical flow**: verify (bb black box) → `assert_reduced_points` (72 coordinates × 4 range opcodes + one equality)
→ `ticket_digest` → target → nullifier → `record_claim` → mint. The range opcodes constrain the same witnesses the
recursion reads (`BB/dsl/acir_format/honk_recursion_constraint.cpp:60-61,124`). If the recursion's predicate were a
witness, the verifier would read `conditional_assign` copies (`:95-118`); with the predicate at 1 they equal the
originals, so the checks bind either way.

**File-level change map**
| File | Change |
|---|---|
| `protocol/work-circuit/scripts/layout-manifest.ts` | also write `proof_points.nr` |
| `protocol/work-circuit/src/proof-layout.test.ts` | the two-direction fixture check (below) |
| `protocol/work-circuit/scripts/bb-verify.ts` (+ its test) | classify bb's alias diagnostic (`Non-canonical field element: value >= fq::modulus`, `BB/ecc/fields/field_conversion.hpp:82`) under `MALFORMED` (a decode failure), not as an operational error |
| `protocol/contracts/yacana_miner/src/proof_points.nr` | new, generated |
| `protocol/contracts/yacana_miner/src/ticket.nr` | `Q_LO`, `Q_HI`, `assert_reduced`, `assert_reduced_points` |
| `protocol/contracts/yacana_miner/src/main.nr` | `mod proof_points;`, the import, one call in `claim` |
| `scripts/params-codegen.ts` → `yacana_miner/src/test/vectors.nr` | `FIXTURE_PROOF` becomes `pub(crate)` (regenerated) |
| `protocol/contracts/yacana_miner/src/test/encoding.nr` | new: seven pure tests |
| `protocol/contracts/yacana_miner/src/test/mod.nr` | `mod encoding;`, two TXE tests |
| `protocol/contracts/artifacts/yacana_miner-YacanaMiner.json` | regenerated (`artifacts:commit`) |
| `apps/web-miner/e2e/replay/` recording | re-recorded, because the miner artifact moved |
| `docs/threat-model.md`, `CLAUDE.md` | §5 Phase 2, step 3 |

**Tests (each pins one thing)**

Pure tests in `test/encoding.nr`. The limb literals are written from q's published hex, independent of the
constants.
1. `the_fixture_proof_is_reduced`: `assert_reduced_points(FIXTURE_PROOF)` passes. A real bb proof, no false
   refusal.
2. `the_reduced_edges_pass`: `(Q_LO − 1, Q_HI)` (that is `q − 1`), `(2^136 − 1, Q_HI − 1)` and `(Q_LO, Q_HI − 1)`
   all pass. Pins both constants from below, the `* top` gating, and that `top` is not stuck.
3. `the_last_point_x_written_as_q_is_refused` (`should_fail`): `FIXTURE_PROOF` with slots 406–407 set to
   `(Q_LO, Q_HI)`. Pins the constants from above and the loop's end; fails only check 4.
4. `the_last_point_y_written_as_q_is_refused` (`should_fail`): the same at 408–409. Catches an x-only check.
5. `a_high_limb_above_q_is_refused` (`should_fail`): `(0, Q_HI + 1)`. Fails only check 3.
6. `a_carried_low_limb_is_refused` (`should_fail`): `(2^136, 0)`. Fails only check 1.
7. `a_wrapped_high_limb_is_refused` (`should_fail`): `(0, −1)`. Fails only check 2; check 3 would evaluate to
   `Q_HI`.

TXE tests in `test/mod.nr`. TXE has no expect-failure call (`aztec-nr` `test_environment.nr:1137-1160`), so the
precondition gets its own positive test:
8. `the_tampered_fixture_wins`: the base proof has LOOKUP_INVERSES.x = `(Q_LO, Q_HI)` at slots 32–33 and a pre-ground
   `proof[0]` constant. The test asserts `low128(ticket_digest(·)) < INITIAL_TARGET`, so a wrong constant fails
   loudly here.
9. `a_claim_with_a_point_written_as_q_is_refused` (`should_fail`; `should_fail_with` the range diagnostic if TXE's
   message is distinctive): the same base proof through `claim`. It differs from the passing
   `txe_accepts_a_fabricated_proof` only in the two tampered fields, so with test 8 green nothing but the new check
   can refuse it. A mutation run (the call removed from `claim`) must make it fail; that run is logged, not
   committed.

TS tests:
10. `protocol/work-circuit/src/proof-layout.test.ts`:
    - (a) A list written independently in the test from the phase constants (0, 4; 8–36 step 4; 281–373 step 4;
      402; 406) equals both the manifest's point starts and the numbers parsed from the committed `proof_points.nr`.
      The template also hard-codes `[u32; 36]`, so a short list fails to compile. Together these catch a writer
      bug the codegen diff cannot, such as a duplicate or a dropped entry.
    - (b) At each start, the fixture holds `(0, 0, 0, 0)` or a reduced point on `y² = x³ + 3 mod q`, in `x_lo, x_hi,
      y_lo, y_hi` order.
    - (c) No other window of four fields that contains a non-zero field parses as a reduced on-curve point. The
      fixture's zero slots 0–7 and 20–27 form overlapping all-zero windows, so zero windows are left to (a).
11. `protocol/work-circuit/scripts/bb-verify.test.ts`: under native `bb verify`, the fixture with slots 32–33 set to
    `(Q_LO, Q_HI)` is `{ verified: false, wellFormed: false }`. An alias fails to decode, and decode failures belong
    in `MALFORMED` (`bb-verify.ts:12-13, 25-31`). The test reads bb's real stderr, which fixes the exact form of the
    alias diagnostic (`BB_ASSERT` prints `Reason : …`, cf. `:30`) before the regex joins `MALFORMED`.

Real proving: the canary shard. Its honest claim must still mint. The refusal itself happens in ACVM execution,
which TXE and PXE share, before any proving; so real proving adds no coverage of the refusal.

**Alternatives not taken**
- *The three-check form* (no `top` branch): cheaper by one range check and an equality per coordinate. It also
  refuses the reduced values in `[2^136·Q_HI, q)` (probability `Q_LO/q ≈ 2^-119` per coordinate), which would need
  a distribution argument and an owner sign-off. At 2^16 the difference costs nothing, so the exact form wins.
- *Only the 34 non-io points*: W pins P0 and P1 to zero (`BB/stdlib/primitives/pairing_points.hpp:269-279`), and
  they enter the public-input delta, so they aren't malleable today. Checking them too costs ≈ 80 gates. That makes
  the invariant total ("every point the ticket hashes") with no exclusion to justify (Ask A3).
- *Pin the lookup commitments to infinity* (8 equalities): this would close W's free read counts and tags (§3). But
  the gate-less-row cells offer the same estimated ≈ 54.5 % strategy, so there's no economic gain, and it bakes "W has no
  lookups" into the contract.
- *Staying under 2^15* (the measured three-check cost for 34 points already crosses it): only a hint-based,
  relaxed top-sublimb bound comes close, and it refuses about 1 honest win in 200 or leaves an alias sliver (Ask A2).
- *Hash only encoding-invariant data*: every later Fiat–Shamir challenge depends on the raw limbs, so no
  transcript-derived ticket is invariant.
- *A `ticket_of(proof)` wrapper* (check, then hash), to guard future call sites: there is one call site. Rejected
  as speculative.
- *Hand-written offsets plus a cross-check*: codegen is the repo's convention (`vk.nr`, `params.nr`), and CI
  diffs it.

## 3. Security & Adversarial Considerations

**Threat model.** A rational miner submits a claim with a hand-crafted `proof: [Field; 410]` and any modified
prover. Their goal is several tickets per unit of proving, which takes other miners' share of the capped issuance.
They cannot forge a proof: soundness is bb's, and #1607 does not break it. They choose the raw encoding of an
accepted proof and any freedom the relation leaves in the witness.

**What the fix guarantees, and what it does not.**
- **Guarantees:** it eliminates coordinate aliases. Every one of the 144 limb fields becomes the unique reduced
  encoding of its point.
- **Already unique, independent of the fix:**
  - The 266 scalar fields are native `field_t`, hashed raw (`BB/transcript/transcript.hpp:378-392`).
  - All 25 sumcheck rounds, virtual ones included, are verified, with no padding indicator (`BB/sumcheck/
    sumcheck.hpp:874-877`, `BB/sumcheck/sumcheck_round.hpp:843-862`).
  - All 24 Gemini folds enter the opening with nonzero scalars (`BB/commitment_schemes/shplonk/shplemini.hpp:
    424-448`).
  - Infinity is `(0, 0)` only (`BB/relations/ecc_vm/ecc_transcript_relation_impl.hpp:562-563`).
  - KZG W is bound by the pairing (`BB/commitment_schemes/kzg/kzg.hpp:135-171`).
- **Not closed: the unconstrained-witness class.**
  - Which cells: witness cells no relation constrains. That means gate-less rows with identity permutation, plus,
    since W has no lookups, the lookup read counts and read tags (`BB/relations/logderiv_lookup_relation.hpp:78-85,
    343-359`).
  - Why they matter: changing one changes a commitment made before β/γ (`BB/ultra_honk/oink_verifier.cpp:126-139`).
    The attacker must then redo z_perm, sumcheck and the PCS: ≈ 54.5 % of a prove, estimated from the recorded
    phase timers and never executed (`implementations-plan/elixir-core/spike-results.md:57-68`). The incremental
    commitment update itself is cheap. W has ≈ 110k gate-less rows (151,728 gates in 2^18, `spike-results.md:21`),
    so the class is never exhausted.
  - What it means: the *estimated* yield of this strategy is ≈ 1 / 0.545 ≈ **1.83 tickets per prove-equivalent**
    for an attacker with an incremental prover, against 1 for an honest miner. It is not a bound. The spike calls
    the estimate "attacker-favourable … not a cryptographic lower bound" (`spike-results.md:68`). Any minimum cost
    rests on the owner-accepted assumption that no malleation is cheaper than the re-proof
    (`docs/threat-model.md:64`). The threat model will say exactly that.
  - The fix removes every alias whose estimated cost is below this strategy's: KZG W for free, Q at ≈ 10–12 %,
    Gemini folds at ≈ 20–24 % (all estimates).

**Completeness (liveness).** Every reduced encoding is accepted, so no honest proof is refused. Any prover
(third-party, GPU, Presto) must emit reduced coordinates, as bb's serialiser does, or its claims fail at
simulation, before any fee. The threat model will say so.

**What we still trust:**
- bb's recursive verifier, for proof validity.
- The layout manifest matching bb 5.2.0's serialisation of the recursive path. It is pinned by SHA, pinned against an
  independently written list of starts, and checked against the fixture's real points (test 10).
- Noir's `Field ==` compiling to a constrained boolean (the is-zero gadget). Soundness needs `top ∈ {0, 1}`, and a
  non-boolean `top` would break the check.
- `Q_LO` and `Q_HI`, pinned from both sides by tests 2 and 3.

**Upstream.** Track barretenberg#1607. Keep the check after an upstream fix: the ticket hashes raw fields, and the
app's uniqueness must not depend on the verifier's codec.

**Availability hazard (operational).** The site serves the committed artifact, and the PXE keys artifacts by class
id and discovers a mismatch only at simulation (`pxe.js:555-573`, `base_wallet.js:255-262`). Merging the fix
without a new record would therefore break every private call the page makes to the current miner. A1 lands the
relaunch record in the same PR, so the merge deploys a matching pair.

**Disclosure.** `alejoamiras/yacana` is public and so is #1607. The only deployment is the team's own testnet
(owner, 2026-09-23), so the branch and the PR go public on the normal schedule (A4).

**Keys.** The relaunch uses the operator, deployer and relayer keys already used for testnet, read from nulo's
`.env` only inside scratchpad wrappers (A1). Nothing secret enters the repo, a log or the record.

**Least privilege, supply chain, cryptography.** No new dependency, key, token or workflow permission. No new
cryptography: Poseidon2 and the bb verifier are unchanged, and the check is native range constraints plus one
equality.

**Domain risks** (reorg, replay, front-running, censorship, reentrancy): unchanged. The nullifier becomes unique
per accepted proof up to the unconstrained-witness class.

## 4. Assumptions

**Facts** (verified)
1. `claim` verifies at `protocol/contracts/yacana_miner/src/main.nr:218`, computes `ticket_digest(proof)` at `:219`
   and pushes the nullifier at `:221`. `ticket.nr:6-13` hashes the 410 raw fields.
2. The Mega/Goblin decoder stores limbs with no `< q` check (`BB/stdlib/primitives/field/field_conversion.hpp:
   105-110, 151-153`), and infinity is `(0, 0)` (`:114`). This is barretenberg#1607, public and open. The native
   codec refuses aliases (`BB/ecc/fields/field_conversion.hpp:71-82`).
3. The manifest lists 36 points at offsets 0, 4, 8–36 step 4, 281–373 step 4, 402 and 406, in `x_lo, x_hi, y_lo,
   y_hi` order (`protocol/work-circuit/src/generated/proof-layout.json`; `layout-manifest.ts:43-64`). That is 144
   limb fields and 266 scalars. On the fixture: 31 on-curve points and 5 `(0, 0)` (Opus, computed); with the limbs
   swapped, none are on the curve. The fixture's zero slots 0–7 and 20–27 also form all-zero windows off the starts
   (Fable), so a "no other window" check must skip zero windows.
4. Every fixture coordinate is reduced (largest `hi` `0x30184f32…`). TXE's fabricated proofs are zero apart from a
   small `proof[0]` (`test/mod.nr:66-79`), so they stay reduced.
5. Measured on the committed artifact:
   - `claim`: 31,985 gates, VK `log n = 15`.
   - `claim_from_l1` 34,823, `exit_to_l1` 19,500, `send_ahead` 19,499, all at `log n = 16`.
   - The three-check spike over 34 points: `claim` at 33,399 gates, `log n = 16`.
6. A circuit is padded to the next power of two of `max(tables_end, trace_end)`
   (`BB/ultra_honk/prover_instance.cpp:129-144`), per circuit.
7. `registerContract` does not validate the artifact against the instance's class; the PXE keys artifacts by class
   id (`@aztec/pxe` `pxe.js:555-573`, `@aztec/wallet-sdk` `base_wallet.js:255-262`). The web miner registers the
   live instance with the bundled artifact (`apps/web-miner/src/chain.ts:58`).
8. `aztec test` compiles, starts TXE on the fixed port 8081, and runs `nargo test` against it
   (`~/.aztec/versions/5.2.0/node_modules/@aztec/aztec/scripts/aztec.sh:22-36`). Its default member is `yacana_miner`
   (`protocol/contracts/Nargo.toml:3`), whose pure vector tests already run this way.
9. The e2e workflow is dispatch-only (`.github/workflows/e2e.yml:9-10`), so PR checks do not run the canary;
   the local run is mandatory.
10. `aztec` is not on `bun run`'s `PATH` here. The gates prefix the pinned bin directories.
11. The repository is public. The live deployment is on Aztec testnet over Sepolia (`deployments/testnet.json:3`).

**Inferences** (unverified; attack these)
- I1. The exact form adds ≈ 2.2k gates for 36 points (the spike's ≈ 20.8 gates per coordinate × 72, plus a 136-bit
  check and an equality each). `log n` stays 16. Measured in Phase 1.
- I2. The claim transaction's proving time rises by a few percent: the app circuit doubles, but the kernel
  circuits (sizes unmeasured here; bb's mock kernels run at 2^17–2^18) dominate. Measured in Phase 2 on the
  successful claim's proof event. If it rises more than 15 %, surface it to the owner.
- I3. TXE's range-check failure message is distinctive enough for `should_fail_with`. If not, test 9 keeps
  `should_fail`, attributed by test 8 and the mutation run.
- I4. Noir compiles `(hi == Q_HI) as Field` to a constrained boolean (the is-zero gadget: `d·inv = 1 − b`,
  `d·b = 0`). The Noir compiler is outside the audited tree. Test 2's `top`-dependent edges exercise it.
- I5. The ACVM enforces `RANGE` opcodes at simulation. `retarget.nr`'s range-pinned hints already rely on this
  under `nargo test`.
- I7. Noir accepts `pub(crate)` on a generated global. There is no precedent in the tree; it surfaces at the first
  compile, and the fallback is `pub`. Constant-input `should_fail` tests on range checks run as failures, not
  compile errors (precedent: `retarget.nr:130-138`).
- I6. bb's `uint256(fq)` is fully reduced. Independently, any proof native `bb verify` accepts has passed
  `BB_ASSERT_LT(value, fq::modulus)` (`BB/ecc/fields/field_conversion.hpp:82`), which stays live in release and WASM
  builds (`BB/common/assert.hpp:42-56, 175-183`).

**Asks** (the owner decides at the approval gate; recommended defaults in bold)
- A1. **Relaunch testnet inside this PR, run by the implementing session, so the merge deploys the fix with its
  own record.** The current deployment is the team's own and does not gate the merge (owner, 2026-09-23). The fixed
  miner still needs a new deployment:
  - the live miner has no upgrade path (`main.nr:3`);
  - the current portal's slot for this rollup version already belongs to it (`registerVersion` is write-once,
    `protocol/portal/src/YacanaPortal.sol:216-223`), so the relaunch includes a new portal and YACA;
  - `bun run deploy` reads the checkout's compiled artifact (`tools/deploy/src/deploy.ts:148-149`), so it runs from
    this branch's head after §7's loop has converged, and no artifact change follows it.

  It repeats the 2026-09-13 relaunch (`implementations-plan/yacana-bridge/lessons/phase-11.md`), without its
  crossings:
  1. `git mv` the live-named files under the old deployment's date: `deployments/testnet.json` and
     `deployments/testnet.example-claim.json` → `testnet-2026-09-13.*`, and the witness archive out of
     `deployments/witnesses/` (to `deployments/testnet-2026-09-13.witnesses.jsonl`): the site serves every archive
     there by rollup version (`apps/site/src/assemble.ts:44-63`), and the new miner shares the old one's.
  2. `l1-deploy.ts deployments/testnet.json` (no record at that path → the `testnet.bridge.json` side file), with
     `YACANA_REGISTRY` and `YACANA_OPERATORS` from the old record's `bridge` block.
  3. `YACANA_PORTAL=<new portal> bun run deploy`: a fresh launch, not a continuation; it folds the side file in.
  4. `bun run bridge -- register`, `set-forwarder <the relayer in docs/deployments.md> on`, `status`.
  5. A real claim from a throwaway account whose identity stays in the gitignored `.localnet/`, then
     `record-example-claim.ts <txHash>`. This is the fix's first end-to-end run under real proving on the live
     network.
  6. Commit the moved files, the new record, the example claim and a `docs/deployments.md` section. Check that the
     committed artifact's class id equals the record's `minerClassId`. Push; the preview build serves `build.json`
     with the new miner.

  **Keys** (owner, 2026-09-24; the nulo `.env` files are not on this machine): a keyed run, per my-stack's keyed-runs
  section. The values live in 1Password (vault `Keyed-Runs`, item `Yacana-Testnet`; a fresh operators key funded from
  the old operators EOA, a fresh deployer secret) and reach the run only through the owner's `op-remote` on the Mac,
  which shows the command before Touch ID. The committed `deployments/testnet.env.example` holds `op://` references
  and the public values; the operators address is derived inside the run. Steps 1–4 are one request (`env-exec
  request`, a clean and pushed HEAD), watched with `env-exec wait`. The record's `l1RpcUrl` is the public Sepolia
  node, the only origin `l1-deploy.ts` records.

  Alternative: merge first and relaunch after; the page's miner calls fail in between.
- A2. **Accept `claim` at 2^16** (≈ +2.2k gates; a few percent of claim proving, measured) rather than a relaxed,
  hint-based check that fits in 2^15.
- A3. **Check all 36 points**, including W's pinned pairing inputs, rather than the 34 non-io points.
- A4. **Disclosure: no hold.** Push and open the PR once §7's loop converges (owner, 2026-09-23: the testnet is the
  team's own). Revisit when outside users arrive.

## 5. Phases

### Phase 1 — The check, its generated offsets and its tests ✓

Steps:
1. Baseline: two canary runs on the untouched tree (`E2E_SHARD=canary …`, in tmux). From each run's Playwright JSON
   report (the `proofs.json` attachments `report.ts` reads), record the successful claim's transaction-proof
   `durationMs`, the last proof event of `canary.e2e.ts`, in `lessons/phase-1.md`.
2. `layout-manifest.ts` writes `proof_points.nr`. Run `bun run codegen` and commit. Add test 10.
3. Test 11 first, against real `bb verify` stderr. Then the `bb-verify.ts` alias classification it pins.
4. `ticket.nr` helper and `main.nr` wiring.
5. `params-codegen.ts`: `pub(crate) global FIXTURE_PROOF`, regenerated.
6. `test/encoding.nr` (tests 1–7) and `test/mod.nr` (tests 8–9, with the pre-ground constant found once by an
   unconstrained search). Then the mutation run: remove the call from `claim`, and test 9 must fail. Log it and
   revert.
7. Measure `bb gates --scheme chonk` on `claim` (extraction as in `recon.md`) and the VK's `log n`:
   ```
   bun -e 'const a=await Bun.file("protocol/contracts/target/yacana_miner-YacanaMiner.json").json();const f=a.functions.find(f=>f.name.replace("__aztec_nr_internals__","")==="claim");console.log(BigInt("0x"+Buffer.from(f.verification_key,"base64").subarray(0,32).toString("hex")))'
   ```
   Record both in `lessons/phase-1.md`.

**Validation gate**
Run it as one `bash` script (`bash <<'GATE' … GATE`): each line exits on failure, because `set -e` does not cover
`&&` lists.
```
export PATH=$HOME/.aztec/versions/5.2.0/bin:$HOME/.aztec/versions/5.2.0/node_modules/.bin:$PATH
set -o pipefail
ss -ltnH 'sport = :8081' > .localnet/port-8081.txt || { echo "port probe failed"; exit 1; }
if [ -s .localnet/port-8081.txt ]; then echo "8081 belongs to another run: wait, never kill it"; exit 1; fi
bun run codegen && git diff --exit-code && test -z "$(git status --porcelain)" || exit 1
bun run contracts:compile && bun run contracts:test 2>&1 | tee .localnet/contracts-test.log || exit 1
for t in the_fixture_proof_is_reduced the_reduced_edges_pass the_last_point_x_written_as_q_is_refused \
  the_last_point_y_written_as_q_is_refused a_high_limb_above_q_is_refused a_carried_low_limb_is_refused \
  a_wrapped_high_limb_is_refused the_tampered_fixture_wins a_claim_with_a_point_written_as_q_is_refused; do
  grep -q "$t" .localnet/contracts-test.log || { echo "test $t did not run"; exit 1; }; done
bun packages/miner-core/scripts/export-layouts.ts && git diff --exit-code || exit 1
YACANA_REQUIRE_TOOLCHAIN=1 bun test protocol/work-circuit tools/localnet/src/toolchain.test.ts || exit 1
bun run lint || exit 1
echo "PHASE 1 GATE PASSED"
```
Pass criteria:
- The script prints `PHASE 1 GATE PASSED` and exits 0.
- `aztec test` lists tests 1–9 green (3–7 and 9 as expected failures), and the existing TXE and vector tests are
  unchanged and green.
- Tests 10 and 11 are green; with `YACANA_REQUIRE_TOOLCHAIN=1` neither can skip.
- The mutation run is logged.
- `claim` reads `log n = 16`, and its gate count is in lessons.

Layers: lint · Noir unit (pure) · Noir integration (TXE) · TS unit · codegen and layout freshness.

### Phase 2 — Artifacts, docs, real proving ✓

Steps:
1. `bun run artifacts:commit`, then commit.
2. Re-record the replay lane (`bun run e2e:agent -- bun apps/web-miner/e2e/replay/setup.ts record`), then commit.
3. Docs.
   - `docs/threat-model.md`:
     - the guarantee sentence (`:15`): "one accepting transcript per ticket, each point in its one reduced encoding;
       tickets from one witness still differ in its unconstrained cells (below)". No percentage goes into the
       guarantee;
     - a new row "Re-encoded proof points" (the defence, tests 1–11);
     - the disabled-row row restated as the unconstrained-witness class (gate-less rows; W's lookup read counts and
       tags; the estimated cost of re-deriving from β/γ is ≈ 54.5 %, an estimated yield of ≈ 1.83 tickets per
       prove-equivalent for that strategy, not a bound);
     - line 64's accepted assumption: "the estimated re-proof", not "the measured re-proof";
     - line 41: "an element ≥ r";
     - line 51's test count;
     - the sentence that any prover must emit reduced coordinates.
   - `CLAUDE.md`: the `protocol/contracts` row names the generated `yacana_miner/src/proof_points.nr`; the
     `protocol/work-circuit` row says `layout-manifest.ts` writes it.
4. Real proving: two canary runs on the new tree. Record the successful claim's proof `durationMs` against the
   baseline in `lessons/phase-2.md` (I2: surface if above +15 %).

**Validation gate**
Run as one `bash` script, like Phase 1's.
```
export PATH=$HOME/.aztec/versions/5.2.0/bin:$HOME/.aztec/versions/5.2.0/node_modules/.bin:$PATH
bun run codegen && git diff --exit-code || exit 1
bun run contracts:compile && bun run artifacts:commit && git diff --exit-code && test -z "$(git status --porcelain)" || exit 1
bun run --cwd apps/web-miner test:replay || exit 1
E2E_SHARD=canary bun run e2e:agent -- bun run --cwd apps/web-miner test:e2e || exit 1
bun run typecheck && bun run lint && bun test || exit 1
bun run lint:actions || exit 1
echo "PHASE 2 GATE PASSED"
```
Pass criteria:
- The script prints `PHASE 2 GATE PASSED` and exits 0.
- The canary's tampered claim is refused at proving, and its honest claim mints under the new miner.
- The proving delta is recorded.

Layers: lint · typecheck · unit · replay (recorded e2e) · e2e with real proving on the isolated network.

## 6. Audit log

### Codex (GPT-6 Astra, high) — `conditional approve`

**Adopted**
- The guarantee overclaimed. §3 now says "eliminates coordinate aliases" and names the residual class.
- The completeness probability rested on an unstated distribution, and the trade-off was never put to the owner.
  Resolved by switching to the exact form, which refuses no reduced encoding.
- Fact corrections: 266 scalars, not 338; the native-codec citation; kernel sizes come from bb's mock circuits;
  padding uses `max(tables_end, trace_end)`.
- The measurement: the successful claim's own proof event, two samples each side, instead of the spec's
  `provingMs` sum.
- A1's lift conditions: a deployment record, a matching class id, and a fresh-wallet private-call smoke test.
- Tests could miss the last point, y, or the projection. Added tests 3, 4 and 10 (test numbers as of the current plan).
- The TXE `should_fail` was not isolated. Now a pre-ground constant, the diagnostic pinned where possible, and a
  mutation run.
- `aztec test`'s fixed 8081 (verified, `aztec.sh:27-36`): the gate refuses to run while another run holds the port.
  An isolated runner is a follow-up.
- e2e is dispatch-only (verified): Fact 9, and the local canary stays in the gate.

**Rejected**
- A real-proving alias-rejection test. The refusal happens in ACVM execution, shared by TXE and PXE simulation,
  before proving, so real proving adds no coverage. An end-to-end demonstration of the *pre-fix* exploit is offered
  as a follow-up.
- Toolchain hashes checked after use in CI: pre-existing and unrelated to F-001. Moved to follow-ups.

### Opus 5.5 (same-family leg, at the owner's request) — `conditional approve`

**Adopted**
- The residual enumeration was incomplete. W's lookup read counts and tags are unconstrained, re-derivable from β/γ
  at ≈ 54.5 %. §3 and the threat-model rows now describe the class; the disabled-row row's wording is corrected.
- Offsets are security-critical, but the fixture cross-check only worked one way. Added test 10, in both directions.
- The last point's alias test (test 3).
- Rate corrections, now moot under the exact form.
- The 266 count, the citations, and "six CI jobs" → two PR gates.
- A1's missing alternative (per-deployment artifact pinning with a boot class check) and the disclosure decision
  (A4).
- The untracked-file blind spot of `git diff --exit-code`: the gates add `test -z "$(git status --porcelain)"`.
- `bb-verify.ts` misclassified bb's alias diagnostic as an operational error. Now a refusal.
- Third-party provers must emit reduced coordinates: added to the threat model.
- The stale test count in `threat-model.md:51`.
- I4's impact is broader (every simulated miner call, not only claims): §3 updated.

**Rejected**
- Pinning the lookup commitments to infinity. Gate-less rows offer the same estimated strategy; §2 alternatives.
- A `ticket_of` wrapper: one call site, speculative.
- Aztec's warning about tests in contract crates: pre-existing, noted.

### Fable 5.1 (xhigh, owner-requested loop)

**Round 1** (session `9a393f0d`) — `conditional approve`. Fable independently re-derived the exact form's accepted
set, `top`'s soundness requirement, the same-witness binding on the Goblin path, the residual enumeration and the
completeness argument; the proofs are recorded in its transcript.

Adopted:
- **High:** test 10's negative direction was false on the fixture (overlapping zero windows), and Codex's "exact
  projection" had been logged as adopted but never specified. Fixed:
  - test 10 now pins the starts against an independently written list;
  - it checks each start on the fixture;
  - its negative direction covers only non-zero windows;
  - Fact 3 is corrected.
- Test 9's `should_fail` had no attribution. The precondition is now the positive test 8 (TXE has no
  expect-failure call; verified in `test_environment.nr`).
- Gates now set `YACANA_REQUIRE_TOOLCHAIN=1`, so `bb-verify.test.ts` cannot skip. Test 11 reads bb's real stderr
  before the alias regex is written.
- A1: a fixed miner is a portal version, so its steps join the lift conditions and the owner scopes them.
- The residual cost is an estimate, not a measurement. The ≈ 1.83× multiplier is now stated in §3 and in the
  threat-model step; line 64's "measured" is corrected.
- Positive edges `(2^136 − 1, Q_HI − 1)` and `(Q_LO, Q_HI − 1)` are folded into test 2.
- The alias yields in the intro are labelled estimates.
- The `CLAUDE.md` row: the contracts row names the generated file.
- Unlisted inferences are listed: I4 (Noir `==` is boolean), I5 (ACVM enforces `RANGE`), I6 (`uint256(fq)` is
  reduced), and the predicate caveat.

Rejected:
- Recording `bb gates` block output. The VK's `log n` is the padded size the prover pays
  (`prover_instance.cpp:129-144`), and the gate count is recorded alongside it.

**Round 2** (resumed) — `conditional approve`. Fable confirmed every round-1 fold. Test 10(c) is now true on the
fixture, and parts (a)–(c) together catch a dropped infinity point, a dropped non-zero point, a mislabelled slot and
swapped limbs. Fable also confirmed the finding-9 rejection: `prover_instance.cpp` has no structured-trace branch.

Adopted, all verified:
- **Medium:** under the deployed portal, the fix can only ship as the next Aztec rollup version's miner
  (`YacanaPortal.sol:216-223` is write-once per Registry version; `retire` needs the flip). A same-rollup
  replacement would need a new token and could never be bridged. A1 is rewritten around that date and its
  alternatives.
- **Medium:** test 10(a) pinned the JSON but not the `.nr` the contract compiles. 10(a) now parses
  `proof_points.nr` too, and the template hard-codes `[u32; 36]`.
- Low: test 11 expects `wellFormed: false`, with the regex under `MALFORMED`.
- Low: `threat-model.md:15`'s guarantee sentence is qualified by the residual.
- Low: the gate greps the nine new test names, so an unwired module cannot pass vacuously.
- Low: I7 (`pub(crate)` on a global, and constant-input `should_fail`, verified against the
  `retarget.nr:130-138` precedent).
- Added the bundle-backup rule, since the branch stays local.

**Round 3** (resumed) — `conditional approve`. The security content is unchanged since round 1 and still holds. Every
round-2 fold landed. The Phase 1 gate's pipefail and `tee` were valid; the name grep can only fail falsely, never
pass vacuously.

Adopted, all verified:
- **Medium:** A1 did not say which checkout V6 is deployed from. `deploy.ts:148-149` compiles from the checkout,
  registration is write-once, and every push to `main` deploys the site (`docs/deployments.md:106-107`). Deploying
  V6 from an unfixed `main` would waste the only window until V7. A1 now carries the sequencing; §8 adds a project
  memory so the V6 runbook session knows the branch exists.
- **Medium:** a failed line mid-gate did not fail the gate (no `set -e`, and errexit exempts `&&` lists). Every line
  now ends in `|| exit 1`, and each gate prints an explicit PASSED line.
- Low: A1's duplicated alternatives were merged; the relaunch is marked as replacing the live miner.
- Low: A4's trigger is Aztec's announcement, and a push alone discloses (preview builds).

The loop reached its three-round cap with the last round's findings operational (sequencing and shell), not
security. The Codex session reviewed the final plan (below) instead of a fourth Fable round.

### Codex final pass (resumed session `01a0cf5c`) — `conditional approve`

Every earlier condition was met. Its three new conditions, all adopted:
- **Medium:** step 8 of the runbook builds V5's old origin from "the commit before step 6's move", which could
  carry the fixed artifact if the fix landed first. A1 now fixes the commit order (the move, then the fix, then
  V6's record) and adds a class-id check of the old-origin checkout against `testnet-v5.json`'s `minerClassId`
  before its deploy.
- **Medium:** the port probe failed open when `ss` itself failed, and it cannot own 8081. A probe failure now aborts
  the gate.

  The ownership race is recorded, not fixed here, and the isolated TXE runner stays a follow-up. The race can only
  make our run fail spuriously: another run's TXE serving our tests still executes our compiled artifacts, and our
  wrapper's trap kills only its own server. It can neither pass falsely nor kill another run's process.
- **Medium:** the economic text read as a bound. §3, the docs step and §1 now call ≈ 54.5 % / ≈ 1.83× an
  *estimated cost and yield of this strategy*, not a floor or a maximum. Any minimum cost is explicitly conditional
  on the accepted no-cheaper-malleation assumption, and the guarantee sentence carries no percentage.

### Owner decision (2026-09-23)

The current testnet deployment is the team's own and does not gate this plan. A1 changed from "hold until the next
rollup version's miner" to "relaunch testnet inside the PR", and A4 from "no push until the next rollup version" to
"no hold". The implementing session runs the relaunch, with keys and RPCs from `~/projects/nulo`'s `.env` files. The
check, the tests and the gates are unchanged, so no audit re-ran.

## 7. Post-implementation (self-contained; the implementing session executes this from here)

`code_review` is `off`: do not run `/code-review`.

1. **Codex audit** (`/codex high`, GPT-6 Astra, read-only). Send:
   - the net diff from the plan baseline (`9b190fa`);
   - this plan.md, including §6;
   - the adversarial ask: "What could go wrong? What would an attacker target? Can any proof field still be
     re-encoded, or can the check refuse an honest proof? What are we trusting that we shouldn't?";
   - the two rules below, verbatim.

   *No over-engineering*: "Report bugs and small, targeted improvements only. Do not propose speculative
   abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
   problem. If code works and is clear, leave it alone."

   *Comment quality*: "Audit the comments for value per character. Flag any comment that narrates what the code
   visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph
   where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it
   doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be
   few, dense, and exact."
2. **Iterative fix loop.**
   - Triage the findings, verifying every factual claim against the repo and bb's source first.
   - Apply the accepted fixes, commit (signed), log the round (consult + verdict) in `lessons/phase-3.md`, and
     re-run the fast layers.
   - Resume the same codex session with the fix diff, under the same two rules.
   - Repeat until a round yields no new material findings; rejected nitpicks don't count. Still material after 3
     rounds? Stop and surface it to the owner.
3. **Delivery** (below).

## 8. Delivery

Single arc: one branch (`worktree-canonical-proof-encoding`) and one PR, via plain `gh pr create`. `/code-review`
stays off.

- Push and `gh pr create` once §7's loop converges, then `gh pr checks --watch`. The PR body says the merge waits
  for A1's relaunch record.
- A1's relaunch, after the PR is open and green: run it, log every transaction hash and address (public) in
  `lessons/phase-3.md`, commit, push, and watch the checks again. The merge stays the owner's call.
- Closing, in the PR:
  - the `## Outcome` block;
  - lessons promoted to `implementations-plan/lessons.md`: bb's Goblin codec accepts `c + q`; `aztec` is missing
    from `bun run`'s `PATH`; `log n` read from a Chonk VK's first field; `aztec test`'s fixed TXE port;
  - follow-ups in `implementations-plan/follow-ups.md`: track #1607; an isolated TXE runner for `contracts:test`; toolchain hashes checked before use in
    CI; optionally, an end-to-end demonstration of the pre-fix alias against a real-proving claim; optionally, a
    per-deployment artifact pinning plan.
- Archive after merge.

## Seeds (draft, finalised after approval)

Run inside the worktree (`agent-worktree resume canonical-proof-encoding`).

`/goal` (recommended; completion is visible in the transcript):
```
/goal Both phases of implementations-plan/canonical-proof-encoding/plan.md are marked ✓ in the file, each backed by its validation gate (as written in plan.md) reported passing in the transcript; LESSONS_FILE=implementations-plan/canonical-proof-encoding/lessons/phase-1.md and phase-2.md printed; the claim's gate count, VK log n and the canary's successful-claim proving times (two before, two after) recorded in lessons; `/code-review` NOT run (code_review is off); the codex fix loop converged, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the branch pushed and the PR opened only after the loop converged, `gh pr checks` green, A1's testnet relaunch run from the branch head (I authorize sourcing the `.env` files under ~/projects/nulo for it, inside scratchpad wrappers only, never printed or committed), its addresses and transaction hashes logged in lessons/phase-3.md, the new record and example claim committed, the committed artifact's class id equal to the record's minerClassId, a real claim on the new deployment succeeded; the PR's checks green after the record push; nothing merged; `bun test` and `bun run lint` report exit 0 in the transcript.
```

`/loop` (fallback):
```
/loop 15m Drive implementations-plan/canonical-proof-encoding forward. Never idle waiting for my input. Each firing: 1) Reality check: read plan.md and lessons/ (authoritative, not the chat); if plan.md is gone or carries an `## Outcome` block, STOP. Rebuild the task list from plan.md if empty; `git status`, `git log --oneline -5`. 2) Long runs (canary ×2, replay record) go in tmux; while they run, review the diff. 3) No task in hand? Take the next pending step; after each edit run the fast layers (PATH prefix from plan.md; `bun run contracts:test` only while 8081 is free; `bun run lint`); commit (signed). Push only at §8, after the codex loop converges. 4) Stuck or facing a decision? `/codex high` with full context until you reach a defensible call; log it in lessons. Hard limits: never merge or publish; never push before §8; the only deploy is A1's testnet relaunch, after §7 converges, with keys from ~/projects/nulo's .env files (I authorize that), sourced only inside scratchpad wrappers, never printed or committed; never expand scope past plan.md. 5) Same step failed 5 times? Reassess with codex. 6) Phase green = its validation gate as written passes: paste it, mark ✓ in plan.md, print LESSONS_FILE=…/lessons/phase-N.md, `agent-worktree status canonical-proof-encoding "phase N green"`. 7) Both ✓? Run plan.md §7 (codex audit + fix loop until clean, 3-round cap), then §8 (push, open the PR, watch the checks; A1's relaunch; push the record and watch again), then a wrap-up: what shipped, the measured gate and proving deltas, every codex debate with its ELI5 context, open items. Surface and stop.
```

ELI5 artifact: https://claude.ai/artifact/3PCPZ6QXNBEcbPaPEdUXks (source: `implementations-plan/canonical-proof-encoding/eli5.html`, local only; republish from that path to keep the URL)
