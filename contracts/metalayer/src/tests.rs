use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env};

const CONTRACT: &str = "metalayer.questlayer.testnet";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const GOLD: u128 = 1_000_000; // one MetaGold (6 decimals)

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, deposit: u128, day: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(CONTRACT))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(day * DAY_NS + 1)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}
fn fresh() -> MetaLayer {
    ctx("owner.testnet", 0, 1);
    // 1 NEAR = 1,000 MetaGold; 1 QGOLD unit = 1 MetaGold unit; 100 MetaGold a day; parcel 50 MetaGold.
    MetaLayer::new(a("owner.testnet"), a(CONTRACT), Some(a("qgold.testnet")), U128(1_000 * GOLD), U128(1), U128(100 * GOLD), U128(50 * GOLD))
}
fn award(id: &str, who: &str, gold: u128, xp: u32, badge: Option<&str>) -> Award {
    Award {
        action_id: id.into(),
        account_id: a(who),
        actor: "f0".repeat(32),
        layer_id: "space".into(),
        evidence_hash: "ab".repeat(32),
        metagold: U128(gold),
        meta_xp: xp,
        badge: badge.map(|b| b.into()),
    }
}

#[test]
fn funding_mints_into_the_treasury_only() {
    let mut m = fresh();
    ctx("fan.testnet", 2 * NEAR, 1);
    assert_eq!(m.fund().0, 2_000 * GOLD);
    let t = m.treasury();
    assert_eq!(t.metagold_available.0, 2_000 * GOLD);
    assert_eq!(t.near_received.0, 2 * NEAR);
    assert_eq!(m.ft_balance_of(a("fan.testnet")).0, 0, "funding never pays the funder");
}

#[test]
fn awards_pay_once_within_cap_and_treasury() {
    let mut m = fresh();
    ctx("fan.testnet", NEAR / 10, 1); // 100 MetaGold in the treasury
    m.fund();
    ctx("owner.testnet", 0, 1);
    m.define_badge("quiet-beacon".into(), "Quiet Beacon".into(), "Lit the beacon.".into());
    ctx(CONTRACT, 0, 1);
    let r = m.award(vec![
        award("story:alice:beacon", "alice.testnet", 30 * GOLD, 50, Some("quiet-beacon")),
        award("story:alice:beacon", "alice.testnet", 30 * GOLD, 50, Some("quiet-beacon")),
        award("coin:bob:1", "bob.testnet", 60 * GOLD, 0, None),
        award("coin:bob:2", "bob.testnet", 20 * GOLD, 0, None),
    ]);
    assert_eq!(r, vec!["paid", "duplicate", "paid", "over-daily-cap"]);
    assert_eq!(m.ft_balance_of(a("alice.testnet")).0, 30 * GOLD);
    assert_eq!(m.meta_xp_of(a("alice.testnet")).0, 50);
    assert_eq!(m.badges_of(a("alice.testnet")), vec!["quiet-beacon".to_string()]);
    assert!(m.is_paid("coin:bob:1".into()));
    // Next day the cap resets, but the treasury holds only 10 MetaGold now.
    ctx(CONTRACT, 0, 2);
    let r = m.award(vec![award("coin:bob:2", "bob.testnet", 20 * GOLD, 0, None), award("xp:bob", "bob.testnet", 0, 10, None)]);
    assert_eq!(r, vec!["treasury-empty", "paid"]);
    assert_eq!(m.meta_xp_of(a("bob.testnet")).0, 10);
}

#[test]
#[should_panic(expected = "Only the MetaLayer recorder")]
fn players_cannot_award_themselves() {
    let mut m = fresh();
    ctx("alice.testnet", 0, 1);
    m.award(vec![award("x", "alice.testnet", 0, 5, None)]);
}

#[test]
fn qgold_converts_one_way() {
    let mut m = fresh();
    ctx("qgold.testnet", 0, 1);
    let _ = m.ft_on_transfer(a("alice.testnet"), U128(5 * GOLD), String::new());
    assert_eq!(m.ft_balance_of(a("alice.testnet")).0, 5 * GOLD);
    assert_eq!(m.treasury().qgold_received.0, 5 * GOLD);
}

#[test]
#[should_panic(expected = "Only QGOLD converts")]
fn other_tokens_do_not_convert() {
    let mut m = fresh();
    ctx("fake.testnet", 0, 1);
    let _ = m.ft_on_transfer(a("alice.testnet"), U128(5), String::new());
}

#[test]
fn parcels_cost_metagold_and_transfer() {
    let mut m = fresh();
    ctx("qgold.testnet", 0, 1);
    let _ = m.ft_on_transfer(a("alice.testnet"), U128(60 * GOLD), String::new());
    ctx("alice.testnet", NEAR / 10, 1);
    let t = m.buy_parcel(128, -64);
    assert_eq!(t.token_id, "parcel:128:-64");
    assert_eq!(m.ft_balance_of(a("alice.testnet")).0, 10 * GOLD);
    assert_eq!(m.treasury().metagold_available.0, 50 * GOLD, "the price returns to the treasury");
    ctx("alice.testnet", 1, 1);
    m.nft_transfer(a("bob.testnet"), "parcel:128:-64".into(), None, None);
    assert_eq!(m.parcel(128, -64).unwrap().owner_id, a("bob.testnet"));
}

#[test]
#[should_panic(expected = "The central square stays public")]
fn the_square_is_not_for_sale() {
    let mut m = fresh();
    ctx("alice.testnet", NEAR / 10, 1);
    m.buy_parcel(0, 0);
}

#[test]
#[should_panic(expected = "multiples of 16")]
fn parcels_follow_the_grid() {
    let mut m = fresh();
    ctx("alice.testnet", NEAR / 10, 1);
    m.buy_parcel(130, 64);
}

#[test]
fn record_batch_counts_actions() {
    let mut m = fresh();
    ctx(CONTRACT, 0, 1);
    let n = m.record_batch(vec![Record { action_id: "mla_1".into(), layer_id: "space".into(), actor: "abc".into(), evidence_hash: "cd".repeat(32) }]);
    assert_eq!(n, 1);
}
