// TXE tests are plumbing-only: the simulator accepts any bytes as a proof (the first test pins
// that fact), so everything about proof validity is proved elsewhere. Each claim uses a distinct
// "proof" ground until its ticket wins, which also gives every claim its own nullifier.
mod encoding;
mod vectors;

use crate::YacanaMiner;
use crate::params::{CLAIM_TTL_SECONDS, EXPECTED_EPOCH_SECONDS, N, REWARD, T_MAX};
use crate::launch::commitment_of;
use crate::retarget::next_target;
use crate::ticket::{low128, ticket_digest};
use encoding::{HI, LO};
use aztec::{
    protocol::{address::{AztecAddress, EthAddress}, traits::ToField},
    test::helpers::{authwit as authwit_cheatcodes, test_environment::TestEnvironment},
};
use bb_proof_verification::RECURSIVE_PROOF_LENGTH;
use yacana_bridge_hashes::{claim_content, retire_content};
use yacana_work_lib::DOM_SEED;
use poseidon::poseidon2::Poseidon2;
use token_contract::Token;
use crate::bridge::continuation_seed;

global INITIAL_TARGET: u128 = 1 << 122;
global PORTAL: EthAddress = EthAddress::from_field(0xbeef);
global OTHER_L1: EthAddress = EthAddress::from_field(0xdead);

pub struct Setup {
    pub env: TestEnvironment,
    pub deployer: AztecAddress,
    pub miner: AztecAddress,
    pub token: AztecAddress,
}

// Token-less miner first (its address is then known), token with minter = miner, one bind, then
// the deployer launches: epoch 0 opens at once (no notice period in the test profile).
unconstrained fn setup() -> Setup {
    let s = setup_unlaunched(0);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).launch());
    s.env.mine_block();
    s
}

// Deployed and bound, not launched; launch_at = 0 means "as soon as someone calls launch()".
unconstrained fn setup_unlaunched(launch_at: u64) -> Setup {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1234, launch_at, 0, PORTAL),
    );
    let token = env.deploy("@token_contract/Token").with_public_initializer(
        deployer,
        Token::interface().constructor_with_minter(
            "Yacana0000000000000000000000000",
            "YACA000000000000000000000000000",
            18,
            miner,
            AztecAddress::zero(),
        ),
    );
    env.call_public(deployer, YacanaMiner::at(miner).bind_token(token));
    env.mine_block();
    Setup { env, deployer, miner, token }
}

// The k-th winning fixture: proof[0] = k' for the first k' ≥ k whose ticket is below the target.
unconstrained fn winning_proof(k: Field) -> ([Field; RECURSIVE_PROOF_LENGTH], Field) {
    let mut proof = [0; RECURSIVE_PROOF_LENGTH];
    let mut digest = 0;
    let mut found = false;
    for i in 0..4096 {
        if !found {
            proof[0] = k + i as Field;
            digest = ticket_digest(proof);
            found = low128(digest) < INITIAL_TARGET;
        }
    }
    assert(found, "no winning fixture found");
    (proof, digest)
}

unconstrained fn losing_proof(k: Field) -> ([Field; RECURSIVE_PROOF_LENGTH], Field) {
    let mut proof = [0; RECURSIVE_PROOF_LENGTH];
    let mut digest = 0;
    let mut found = false;
    for i in 0..4096 {
        if !found {
            proof[0] = k + i as Field;
            digest = ticket_digest(proof);
            found = low128(digest) >= INITIAL_TARGET;
        }
    }
    assert(found, "no losing fixture found");
    (proof, digest)
}

unconstrained fn claim(s: Setup, e: u64, k: Field) -> Field {
    let (proof, digest) = winning_proof(k);
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim(e, k, 0, 7, proof, s.deployer));
    s.env.mine_block();
    digest
}

unconstrained fn open_epoch(s: Setup) -> u64 {
    s.env.view_public(YacanaMiner::at(s.miner).open_epoch())
}

unconstrained fn target_of(s: Setup, e: u64) -> u128 {
    s.env.view_public(YacanaMiner::at(s.miner).epoch_params(e)).target
}

unconstrained fn expected_seed(s: Setup, closing_digest: Field) -> Field {
    let epoch0 = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(0));
    let epoch1 = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(1));
    Poseidon2::hash([DOM_SEED, epoch0.seed, 1, closing_digest, epoch1.opened_at as Field], 5)
}

#[test]
unconstrained fn txe_accepts_a_fabricated_proof() {
    // Documents why proof validity must be tested with real proving: this passes.
    let s = setup();
    let _ = claim(s, 0, 1000);
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).claims_in(0)), 1);
}

// LOOKUP_INVERSES.x (slots 32–33, the point at infinity's 0) spelled as q, with proof[0] ground once so
// the ticket wins: TXE verifies no proof, so only the reducedness check can refuse its claim.
unconstrained fn tampered_proof() -> [Field; RECURSIVE_PROOF_LENGTH] {
    let mut proof = [0; RECURSIVE_PROOF_LENGTH];
    proof[0] = 5013;
    proof[32] = LO;
    proof[33] = HI;
    proof
}

#[test]
unconstrained fn the_tampered_fixture_wins() {
    assert(low128(ticket_digest(tampered_proof())) < INITIAL_TARGET);
}

#[test(should_fail)]
unconstrained fn a_claim_with_a_point_written_as_q_is_refused() {
    let s = setup();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim(0, 5013, 0, 7, tampered_proof(), s.deployer));
}

#[test]
unconstrained fn claim_mints_reward_privately() {
    let s = setup();
    let _ = claim(s, 0, 1000);
    let balance: u128 = s.env.execute_utility(Token::at(s.token).balance_of_private(s.deployer));
    assert_eq(balance, REWARD);
}

#[test(should_fail_with = "not deployer")]
unconstrained fn bind_token_rejects_non_deployer() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let stranger = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, PORTAL),
    );
    env.call_public(stranger, YacanaMiner::at(miner).bind_token(stranger));
}

#[test(should_fail)]
unconstrained fn bind_token_is_one_shot() {
    let s = setup();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).bind_token(s.token));
}

#[test(should_fail)]
unconstrained fn claim_before_binding_fails() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, PORTAL),
    );
    env.mine_block();
    let (proof, _) = winning_proof(1);
    env.call_private(deployer, YacanaMiner::at(miner).claim(0, 1, 0, 7, proof, deployer));
}

// The token refuses the miner as minter: the whole claim fails (mint is a private call inside the
// claim), so the count, the nullifier and the balance are untouched by construction.

#[test(should_fail)]
unconstrained fn record_claim_is_only_self() {
    let s = setup();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).record_claim(0, 1));
}

#[test(should_fail)]
unconstrained fn same_ticket_cannot_be_claimed_twice() {
    let s = setup();
    let _ = claim(s, 0, 1000);
    let _ = claim(s, 0, 1000);
}

#[test(should_fail_with = "ticket above target")]
unconstrained fn losing_ticket_is_rejected() {
    let s = setup();
    let (proof, _) = losing_proof(1);
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim(0, 1, 0, 7, proof, s.deployer));
}

#[test]
unconstrained fn nth_claim_closes_the_epoch_and_retargets_exactly() {
    let s = setup();
    // N claims, EXPECTED/2N seconds apart: a fast epoch, so the next target shrinks.
    let mut closing = 0;
    for i in 0..N {
        s.env.advance_next_block_timestamp_by(EXPECTED_EPOCH_SECONDS / (2 * N as u64));
        closing = claim(s, 0, (1000 * (i + 1)) as Field);
    }
    assert_eq(open_epoch(s), 1);
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).claims_in(0)), N);
    let epoch0 = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(0));
    let epoch1 = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(1));
    let actual = epoch1.opened_at - epoch0.opened_at;
    assert(actual < EXPECTED_EPOCH_SECONDS);
    assert_eq(epoch1.target, next_target(INITIAL_TARGET, actual));
    assert(epoch1.target < INITIAL_TARGET);
    assert_eq(epoch1.seed, expected_seed(s, closing));
}

#[test]
unconstrained fn late_count_close_is_capped_at_t_max() {
    let s = setup();
    for i in 0..N - 1 {
        let _ = claim(s, 0, (1000 * (i + 1)) as Field);
    }
    s.env.advance_next_block_timestamp_by(10 * T_MAX);
    let _ = claim(s, 0, (1000 * N) as Field);
    assert_eq(open_epoch(s), 1);
    assert_eq(target_of(s, 1), INITIAL_TARGET * 4);
}

#[test(should_fail_with = "epoch has not reached T_MAX")]
unconstrained fn roll_before_t_max_fails() {
    let s = setup();
    s.env.advance_next_block_timestamp_by(T_MAX - 1);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
}

#[test]
unconstrained fn roll_after_t_max_eases_by_four_and_mixes_last_digest() {
    let s = setup();
    let last = claim(s, 0, 1000);
    s.env.advance_next_block_timestamp_by(T_MAX);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
    assert_eq(open_epoch(s), 1);
    assert_eq(target_of(s, 1), INITIAL_TARGET * 4);
    let epoch1 = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(1));
    assert_eq(epoch1.seed, expected_seed(s, last));
}

// The TXE applies public writes at once, so a claim after roll() in the same block already fails
// its historical read. The real race — private anchored before the roll, public after it — ends
// in record_claim's "stale claim" and is only reproducible on a network (miner-core's burst test).
#[test(should_fail_with = "epoch is not open")]
unconstrained fn claim_after_roll_in_the_same_block_is_refused_at_simulation() {
    let s = setup();
    s.env.advance_next_block_timestamp_by(T_MAX);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
    let (proof, _) = winning_proof(1000);
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim(0, 1000, 0, 7, proof, s.deployer));
}

#[test(should_fail)]
unconstrained fn claim_against_a_closed_epoch_fails() {
    let s = setup();
    s.env.advance_next_block_timestamp_by(T_MAX);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
    s.env.mine_block();
    let _ = claim(s, 0, 1000);
}

#[test]
unconstrained fn constants_match_the_profile() {
    let s = setup();
    let c = s.env.view_public(YacanaMiner::at(s.miner).constants());
    assert_eq(
        c,
        [N as Field, EXPECTED_EPOCH_SECONDS as Field, T_MAX as Field, REWARD as Field, CLAIM_TTL_SECONDS as Field],
    );
}

// --- Hardening: launch, token binding invariants, retarget envelope under roll/close ---

#[test(should_fail)]
unconstrained fn claim_before_launch_is_refused() {
    let s = setup_unlaunched(0);
    let _ = claim(s, 0, 1000);
}

#[test(should_fail_with = "not launched")]
unconstrained fn roll_before_launch_is_refused() {
    let s = setup_unlaunched(0);
    s.env.advance_next_block_timestamp_by(T_MAX);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
}

#[test(should_fail_with = "reveal window not over")]
unconstrained fn launch_before_its_time_is_refused() {
    let mut env = TestEnvironment::new();
    let launch_at = env.last_block_timestamp() + 1000;
    let s = setup_unlaunched(launch_at);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).launch());
}

#[test(should_fail_with = "token not bound")]
unconstrained fn launch_requires_a_bound_token() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, PORTAL),
    );
    env.call_public(deployer, YacanaMiner::at(miner).launch());
}

#[test(should_fail)]
unconstrained fn launch_is_one_shot() {
    let s = setup();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).launch());
}

#[test]
unconstrained fn epoch_zero_opens_when_launched_at_or_after_launch_at() {
    let mut env = TestEnvironment::new();
    let launch_at = env.last_block_timestamp() + 1000;
    let mut s = setup_unlaunched(launch_at);
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).genesis()).launch_at, launch_at);
    s.env.mine_block_at(launch_at);
    let stranger = s.env.create_light_account();
    s.env.call_public(stranger, YacanaMiner::at(s.miner).launch());
    s.env.mine_block();
    let params = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(0));
    assert(params.opened_at >= launch_at);
    assert_eq(params.target, INITIAL_TARGET);
    let _ = claim(s, 0, 1000);
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).claims_in(0)), 1);
}

#[test]
unconstrained fn a_past_launch_at_means_launchable_now() {
    let s = setup_unlaunched(1);
    assert(s.env.view_public(YacanaMiner::at(s.miner).genesis()).launch_at > 1);
}

// Launch lottery: commitments land before launch_at, never twice, never after; with no reveal
// window (this profile) nothing can be revealed and epoch 0 opens at launch_at (the seed rule
// itself is unit-tested in launch.nr).
#[test]
unconstrained fn a_commitment_is_accepted_once_before_launch_at() {
    let mut env = TestEnvironment::new();
    let launch_at = env.last_block_timestamp() + 1000;
    let mut s = setup_unlaunched(launch_at);
    let player = s.env.create_light_account();
    let c = commitment_of(s.miner.to_field(), player.to_field(), 42);
    s.env.call_public(player, YacanaMiner::at(s.miner).commit_launch(c));
    let (mix, reveals) = s.env.view_public(YacanaMiner::at(s.miner).launch_lottery());
    assert_eq(mix, 0);
    assert_eq(reveals, 0);
}

#[test(should_fail_with = "already committed")]
unconstrained fn a_second_commitment_from_the_same_address_is_refused() {
    let mut env = TestEnvironment::new();
    let launch_at = env.last_block_timestamp() + 1000;
    let s = setup_unlaunched(launch_at);
    let c = commitment_of(s.miner.to_field(), s.deployer.to_field(), 42);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).commit_launch(c));
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).commit_launch(c + 1));
}

#[test(should_fail_with = "commit phase is over")]
unconstrained fn a_commitment_after_launch_at_is_refused() {
    let s = setup_unlaunched(0);
    let c = commitment_of(s.miner.to_field(), s.deployer.to_field(), 42);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).commit_launch(c));
}

#[test(should_fail_with = "not in the reveal window")]
unconstrained fn a_reveal_needs_a_window() {
    let mut env = TestEnvironment::new();
    let launch_at = env.last_block_timestamp() + 1000;
    let s = setup_unlaunched(launch_at);
    let c = commitment_of(s.miner.to_field(), s.deployer.to_field(), 42);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).commit_launch(c));
    s.env.mine_block_at(launch_at);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).reveal_launch(42));
}

#[test(should_fail_with = "token minter is not this miner")]
unconstrained fn bind_token_rejects_a_token_minted_by_someone_else() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, PORTAL),
    );
    let token = env.deploy("@token_contract/Token").with_public_initializer(
        deployer,
        Token::interface().constructor_with_minter(
            "Yacana0000000000000000000000000",
            "YACA000000000000000000000000000",
            18,
            deployer,
            AztecAddress::zero(),
        ),
    );
    env.call_public(deployer, YacanaMiner::at(miner).bind_token(token));
}

#[test(should_fail_with = "token is zero")]
unconstrained fn bind_token_rejects_zero() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, PORTAL),
    );
    env.call_public(deployer, YacanaMiner::at(miner).bind_token(AztecAddress::zero()));
}

#[test]
unconstrained fn constants_expose_the_claim_ttl() {
    let s = setup();
    let c = s.env.view_public(YacanaMiner::at(s.miner).constants());
    assert_eq(c[4], CLAIM_TTL_SECONDS as Field);
}

#[test]
unconstrained fn bound_token_reports_the_binding() {
    let s = setup();
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).bound_token()), s.token);
}

// An attacker alternating rolls (×4) with instant fills (÷4) cannot walk the target anywhere:
// each pair returns exactly to where it started, and a roll never opens more than ×4.
#[test]
unconstrained fn rolls_and_instant_fills_cancel_exactly() {
    let s = setup();
    let t0 = target_of(s, 0);
    s.env.advance_next_block_timestamp_by(T_MAX);
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).roll());
    s.env.mine_block();
    assert_eq(target_of(s, 1), t0 * 4);
    for i in 0..N {
        // Fixture search windows are 4096 wide; spacing k by that keeps every ticket distinct.
        let _ = claim(s, 1, 5000 + (i as Field) * 4096);
    }
    assert_eq(open_epoch(s), 2);
    assert_eq(target_of(s, 2), t0);
}

// ---- the bridge ----------------------------------------------------------------------------

// A holder with one reward minted; the miner burns on their behalf through an authwit, which only
// a contract account can answer (a light account has no code to verify it).
unconstrained fn setup_with_balance() -> Setup {
    let mut env = TestEnvironment::new();
    let deployer = env.create_contract_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1234, 0, 0, PORTAL),
    );
    let token = env.deploy("@token_contract/Token").with_public_initializer(
        deployer,
        Token::interface().constructor_with_minter(
            "Yacana0000000000000000000000000",
            "YACA000000000000000000000000000",
            18,
            miner,
            AztecAddress::zero(),
        ),
    );
    env.call_public(deployer, YacanaMiner::at(miner).bind_token(token));
    env.mine_block();
    env.call_public(deployer, YacanaMiner::at(miner).launch());
    env.mine_block();
    let s = Setup { env, deployer, miner, token };
    let _ = claim(s, 0, 1000);
    s
}

unconstrained fn allow_burn(s: Setup, amount: u128, nonce: Field) {
    let burn = Token::at(s.token).burn_private(s.deployer, amount, nonce);
    authwit_cheatcodes::add_private_authwit_from_call(s.env, s.deployer, s.miner, burn);
}

unconstrained fn private_balance(s: Setup) -> u128 {
    s.env.execute_utility(Token::at(s.token).balance_of_private(s.deployer))
}

unconstrained fn bridge_state(s: Setup) -> (EthAddress, u64, bool, u64, u128, u128) {
    s.env.view_public(YacanaMiner::at(s.miner).bridge_state())
}

// The version the TXE runs under, as the miner's retire() will read it.
unconstrained fn rollup_version(s: Setup) -> Field {
    s.env.utility_context(|context| context.version())
}

#[test]
unconstrained fn send_ahead_burns_and_records_the_exit() {
    let s = setup_with_balance();
    allow_burn(s, REWARD, 1);
    s.env.call_private(
        s.deployer,
        YacanaMiner::at(s.miner).send_ahead(REWARD, 0x5ec2e7, EthAddress::from_field(0xff), 1),
    );
    s.env.mine_block();
    assert_eq(private_balance(s), 0);
    let (portal, first, retired, count, exited, inbound) = bridge_state(s);
    assert_eq(portal, PORTAL);
    assert_eq(first, 0);
    assert_eq(retired, false);
    assert_eq(count, 1);
    assert_eq(exited, REWARD);
    assert_eq(inbound, 0);
}

#[test]
unconstrained fn exit_to_l1_burns_and_records_the_exit() {
    let s = setup_with_balance();
    let half = REWARD / 2;
    allow_burn(s, half, 2);
    s.env.call_private(
        s.deployer,
        YacanaMiner::at(s.miner).exit_to_l1(half, EthAddress::from_field(0xc0de), 0x7a9, 2),
    );
    s.env.mine_block();
    assert_eq(private_balance(s), REWARD - half);
    let (_, _, _, count, exited, _) = bridge_state(s);
    assert_eq(count, 1);
    assert_eq(exited, half);
}

#[test(should_fail)]
unconstrained fn send_ahead_without_an_authwit_fails() {
    let s = setup_with_balance();
    s.env.call_private(
        s.deployer,
        YacanaMiner::at(s.miner).send_ahead(REWARD, 0x5ec2e7, EthAddress::from_field(0xff), 1),
    );
}

#[test(should_fail_with = "amount is zero")]
unconstrained fn send_ahead_rejects_zero() {
    let s = setup_with_balance();
    s.env.call_private(
        s.deployer,
        YacanaMiner::at(s.miner).send_ahead(0, 0x5ec2e7, EthAddress::from_field(0xff), 1),
    );
}

#[test]
unconstrained fn claim_from_l1_consumes_the_portal_message_and_mints() {
    let s = setup();
    let amount: u128 = 12;
    let secret = 7;
    let leaf = s.env.send_l1_to_l2_message(claim_content(amount), secret, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(amount, secret, s.deployer, leaf));
    s.env.mine_block();
    assert_eq(private_balance(s), amount);
    let (_, _, _, _, _, inbound) = bridge_state(s);
    assert_eq(inbound, amount);
}

#[test(should_fail)]
unconstrained fn claim_from_l1_twice_fails() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(claim_content(12), 7, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(12, 7, s.deployer, leaf));
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(12, 7, s.deployer, leaf));
}

#[test(should_fail)]
unconstrained fn claim_from_l1_from_another_sender_fails() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(claim_content(12), 7, OTHER_L1, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(12, 7, s.deployer, leaf));
}

unconstrained fn retire(s: Setup) {
    let leaf = s.env.send_l1_to_l2_message(retire_content(rollup_version(s)), 0, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).retire(leaf));
    s.env.mine_block();
}

#[test]
unconstrained fn retire_stops_claims_but_not_arrivals() {
    let s = setup_with_balance();
    retire(s);
    let (_, _, retired, _, _, _) = bridge_state(s);
    assert_eq(retired, true);
    // Arrivals still land after retirement.
    let leaf = s.env.send_l1_to_l2_message(claim_content(5), 9, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(5, 9, s.deployer, leaf));
    s.env.mine_block();
    assert_eq(private_balance(s), REWARD + 5);
}

#[test(should_fail_with = "mining has ended on this version")]
unconstrained fn claim_after_retirement_is_refused() {
    let s = setup();
    retire(s);
    let _ = claim(s, 0, 2000);
}

#[test(should_fail)]
unconstrained fn retire_from_another_sender_fails() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(retire_content(rollup_version(s)), 0, OTHER_L1, s.miner);
    s.env.mine_block();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).retire(leaf));
}

#[test(should_fail)]
unconstrained fn retire_twice_fails() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(retire_content(rollup_version(s)), 0, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).retire(leaf));
    s.env.mine_block();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).retire(leaf));
}

#[test(should_fail)]
unconstrained fn record_exit_is_only_self() {
    let s = setup();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).record_exit(1, 1, 1, 1));
}

// A continuation: starts at the source's last epoch + 1 with a seed derived from the source's
// last seed and the opening time, no lottery, and mines from there.
#[test]
unconstrained fn a_continuation_starts_at_its_first_epoch_with_the_chained_seed() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let source_last_seed = 0xabc;
    let first: u64 = 42;
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, source_last_seed, 0, first, PORTAL),
    );
    let token = env.deploy("@token_contract/Token").with_public_initializer(
        deployer,
        Token::interface().constructor_with_minter(
            "Yacana0000000000000000000000000",
            "YACA000000000000000000000000000",
            18,
            miner,
            AztecAddress::zero(),
        ),
    );
    env.call_public(deployer, YacanaMiner::at(miner).bind_token(token));
    env.mine_block();
    env.call_public(deployer, YacanaMiner::at(miner).launch());
    env.mine_block();
    let s = Setup { env, deployer, miner, token };
    assert_eq(open_epoch(s), first);
    let params = s.env.view_public(YacanaMiner::at(s.miner).epoch_params(first));
    assert_eq(params.seed, continuation_seed(source_last_seed, first, params.opened_at));
    let (_, first_epoch, _, _, _, _) = bridge_state(s);
    assert_eq(first_epoch, first);
    let _ = claim(s, first, 1000);
    assert_eq(s.env.view_public(YacanaMiner::at(s.miner).claims_in(first)), 1);
}

#[test(should_fail_with = "a continuation has no lottery")]
unconstrained fn a_continuation_refuses_lottery_commits() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let miner = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 42, PORTAL),
    );
    env.call_public(deployer, YacanaMiner::at(miner).commit_launch(1));
}

#[test(should_fail_with = "portal is zero")]
unconstrained fn constructor_rejects_a_zero_portal() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let _ = env.deploy("YacanaMiner").with_public_initializer(
        deployer,
        YacanaMiner::interface().constructor(INITIAL_TARGET, 1, 0, 0, EthAddress::zero()),
    );
}

// The public re-check stands on its own: a claim whose private side ran before the retirement
// (an older anchor) still fails at record_claim.
#[test(should_fail_with = "mining has ended on this version")]
unconstrained fn record_claim_after_retirement_is_refused_as_self() {
    let s = setup();
    retire(s);
    s.env.call_public(s.miner, YacanaMiner::at(s.miner).record_claim(0, 1));
}

#[test(should_fail)]
unconstrained fn record_inbound_is_only_self() {
    let s = setup();
    s.env.call_public(s.deployer, YacanaMiner::at(s.miner).record_inbound(1));
}

#[test(should_fail)]
unconstrained fn claim_from_l1_rejects_a_wrong_secret() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(claim_content(12), 7, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(12, 8, s.deployer, leaf));
}

#[test(should_fail)]
unconstrained fn claim_from_l1_rejects_a_wrong_amount() {
    let s = setup();
    let leaf = s.env.send_l1_to_l2_message(claim_content(12), 7, PORTAL, s.miner);
    s.env.mine_block();
    s.env.call_private(s.deployer, YacanaMiner::at(s.miner).claim_from_l1(13, 7, s.deployer, leaf));
}
