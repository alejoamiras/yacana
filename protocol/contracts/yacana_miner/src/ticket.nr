use bb_proof_verification::RECURSIVE_PROOF_LENGTH;
use yacana_work_lib::DOM_TICKET;
use poseidon::poseidon2::Poseidon2;
use crate::proof_points::W_PROOF_POINTS;

// q = 2^136·Q_HI + Q_LO, BN254's base-field modulus; a proof coordinate is (lo, hi) limbs of 136 and 118 bits.
global Q_LO: Field = 0x5d97816a916871ca8d3c208c16d87cfd47;
global Q_HI: Field = 0x30644e72e131a029b85045b6818158;

// The ticket: Poseidon2 over the domain tag and all 410 proof fields (254-bit).
pub fn ticket_digest(proof: [Field; RECURSIVE_PROOF_LENGTH]) -> Field {
    let mut input = [0; RECURSIVE_PROOF_LENGTH + 1];
    input[0] = DOM_TICKET;
    for i in 0..RECURSIVE_PROOF_LENGTH {
        input[i + 1] = proof[i];
    }
    Poseidon2::hash(input, RECURSIVE_PROOF_LENGTH + 1)
}

// Low 128 bits of a field element, compared against the u128 target.
pub fn low128(x: Field) -> u128 {
    let bytes: [u8; 32] = x.to_le_bytes();
    let mut lo: u128 = 0;
    for i in 0..16 {
        lo = lo * 256 + (bytes[15 - i] as u128);
    }
    lo
}

// The recursive verifier also accepts a coordinate c < 2^254 − q spelled c + q (barretenberg#1607), and
// every spelling hashes to its own ticket: a point is accepted only in its reduced spelling.
pub fn assert_reduced_points(proof: [Field; RECURSIVE_PROOF_LENGTH]) {
    for p in W_PROOF_POINTS {
        assert_reduced(proof[p], proof[p + 1]);
        assert_reduced(proof[p + 2], proof[p + 3]);
    }
}

// lo + 2^136·hi < q, compared limb-wise because the sum can exceed r and wrap. Below Q_HI any lo fits;
// at Q_HI (top = 1) lo must stay below Q_LO; above it the third check wraps.
pub(crate) fn assert_reduced(lo: Field, hi: Field) {
    lo.assert_max_bit_size::<136>();
    hi.assert_max_bit_size::<118>();
    let top = (hi == Q_HI) as Field;
    (Q_HI - 1 - hi + top).assert_max_bit_size::<118>();
    ((Q_LO - 1 - lo) * top).assert_max_bit_size::<136>();
}
