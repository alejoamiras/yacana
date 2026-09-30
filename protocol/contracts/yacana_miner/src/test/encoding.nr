// q's limbs written from its published hex, independently of ticket.nr's constants, so a wrong
// constant there fails here from one side or the other.
use crate::test::vectors::FIXTURE_PROOF;
use crate::ticket::{assert_reduced, assert_reduced_points};

pub(crate) global LO: Field = 0x5d97816a916871ca8d3c208c16d87cfd47;
pub(crate) global HI: Field = 0x30644e72e131a029b85045b6818158;
global TWO_136: Field = 0x10000000000000000000000000000000000;

#[test]
fn the_fixture_proof_is_reduced() {
    assert_reduced_points(FIXTURE_PROOF);
}

#[test]
fn the_reduced_edges_pass() {
    assert_reduced(LO - 1, HI);
    assert_reduced(TWO_136 - 1, HI - 1);
    assert_reduced(LO, HI - 1);
}

#[test(should_fail)]
fn the_last_point_x_written_as_q_is_refused() {
    let mut proof = FIXTURE_PROOF;
    proof[406] = LO;
    proof[407] = HI;
    assert_reduced_points(proof);
}

#[test(should_fail)]
fn the_last_point_y_written_as_q_is_refused() {
    let mut proof = FIXTURE_PROOF;
    proof[408] = LO;
    proof[409] = HI;
    assert_reduced_points(proof);
}

#[test(should_fail)]
fn a_high_limb_above_q_is_refused() {
    assert_reduced(0, HI + 1);
}

#[test(should_fail)]
fn a_carried_low_limb_is_refused() {
    assert_reduced(TWO_136, 0);
}

#[test(should_fail)]
fn a_wrapped_high_limb_is_refused() {
    // −1 passes the third check alone (it evaluates to HI); only the 118-bit bound refuses it.
    assert_reduced(0, 0 - 1);
}
