use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::{test_utils::VMContextBuilder, testing_env};

const CONTRACT: &str = "badges.questlayer.testnet";

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, deposit: u128, time_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(CONTRACT))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .account_balance(NearToken::from_near(50))
        .block_timestamp(time_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}
fn key() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}
fn fresh() -> Badges {
    ctx("owner.testnet", 0, 1_000);
    Badges::new(a("owner.testnet"), Some(Base64VecU8(key().verifying_key().to_bytes().to_vec())))
}
fn input(supply: u32) -> BadgeInput {
    BadgeInput {
        title: "Plzeň tower climb".into(),
        description: "Reached the top of St Bartholomew's tower.".into(),
        icon: "🗼".into(),
        color: "#c08a2b".into(),
        kind: BadgeKind::Place { lat_e6: 49_747_600, lng_e6: 13_377_500, radius_m: 80 },
        max_supply: supply,
        starts_at_ms: None,
        ends_at_ms: None,
    }
}
fn sign(g: &Badges, badge: &str, who: &str, exp: u64) -> Base64VecU8 {
    let msg = g.claim_message(badge.into(), a(who), U64(exp));
    Base64VecU8(key().sign(msg.as_bytes()).to_bytes().to_vec())
}
fn created(g: &mut Badges, supply: u32) {
    let cost = g.create_cost(supply).0;
    ctx("maker.testnet", cost, 2_000);
    g.create_badge("tower-climb".into(), input(supply), None);
}

#[test]
fn creator_funds_a_badge_and_a_signed_claim_mints_once() {
    let mut g = fresh();
    created(&mut g, 3);
    let b = g.get_badge("tower-climb".into()).unwrap();
    assert_eq!(b.creator_id, a("maker.testnet"));
    assert_eq!(b.budget.0, 3 * PER_CLAIM_YOCTO);
    assert!(!b.sponsored);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("server-worker.testnet", 0, 3_000);
    let token = g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig);
    assert_eq!(token, "tower-climb:1");
    assert_eq!(g.has_badge("tower-climb".into(), a("ana.testnet")), Some(1));
    let held = g.badges_of(a("ana.testnet"), None, None);
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].via, Via::Signed);
    assert_eq!(g.get_badge("tower-climb".into()).unwrap().budget.0, 2 * PER_CLAIM_YOCTO);
    let t = g.nft_token("tower-climb:1".into()).unwrap();
    assert_eq!(t.owner_id, a("ana.testnet"));
    assert!(t.metadata.extra.contains("\"soulbound\":true"));
    assert_eq!(g.nft_tokens_for_owner(a("ana.testnet"), None, None).len(), 1);
    assert_eq!(g.holders("tower-climb".into(), None, None), vec![(1, a("ana.testnet"))]);
}

#[test]
#[should_panic(expected = "Already holds this badge")]
fn the_same_account_cannot_claim_twice() {
    let mut g = fresh();
    created(&mut g, 3);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("ana.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig.clone());
    g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig);
}

#[test]
#[should_panic(expected = "Invalid badge claim")]
fn a_claim_cannot_be_redirected_to_another_account() {
    let mut g = fresh();
    created(&mut g, 3);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("eve.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("eve.testnet"), U64(10_000), sig);
}

#[test]
#[should_panic(expected = "Badge claim expired")]
fn expired_claims_are_refused() {
    let mut g = fresh();
    created(&mut g, 3);
    let sig = sign(&g, "tower-climb", "ana.testnet", 2_500);
    ctx("ana.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("ana.testnet"), U64(2_500), sig);
}

#[test]
#[should_panic(expected = "All badges are given out")]
fn supply_is_a_hard_cap() {
    let mut g = fresh();
    created(&mut g, 1);
    for who in ["ana.testnet", "bob.testnet"] {
        let sig = sign(&g, "tower-climb", who, 10_000);
        ctx(who, 0, 3_000);
        g.claim("tower-climb".into(), a(who), U64(10_000), sig);
    }
}

#[test]
#[should_panic(expected = "Attach")]
fn an_unfunded_badge_is_refused() {
    let mut g = fresh();
    ctx("maker.testnet", BADGE_BASE_YOCTO, 2_000);
    g.create_badge("tower-climb".into(), input(5), None);
}

#[test]
#[should_panic(expected = "Only the game can create a badge for someone else")]
fn players_cannot_create_badges_in_someone_elses_name() {
    let mut g = fresh();
    ctx("maker.testnet", g.create_cost(1).0, 2_000);
    g.create_badge("tower-climb".into(), input(1), Some(a("ana.testnet")));
}

#[test]
fn the_game_key_sponsors_a_badge_for_a_player() {
    let mut g = fresh();
    ctx(CONTRACT, 0, 2_000);
    let b = g.create_badge("tower-climb".into(), input(20), Some(a("ana.testnet")));
    assert!(b.sponsored);
    assert_eq!(b.creator_id, a("ana.testnet"));
    assert_eq!(b.budget.0, 0);
    assert_eq!(g.badges_by_creator(a("ana.testnet")), vec!["tower-climb".to_string()]);
    // The sponsored creator can still hand it out and close it.
    ctx("ana.testnet", 0, 3_000);
    let ids = g.award("tower-climb".into(), vec![a("bob.testnet"), a("cid.testnet"), a("bob.testnet")]);
    assert_eq!(ids, vec!["tower-climb:1".to_string(), "tower-climb:2".to_string()]);
    assert_eq!(g.badges_of(a("bob.testnet"), None, None)[0].via, Via::Creator);
    ctx("ana.testnet", 1, 3_000);
    assert_eq!(g.close_badge("tower-climb".into()).0, 0);
}

#[test]
#[should_panic(expected = "Creator only")]
fn only_the_creator_awards() {
    let mut g = fresh();
    created(&mut g, 3);
    ctx("eve.testnet", 0, 3_000);
    g.award("tower-climb".into(), vec![a("eve.testnet")]);
}

#[test]
fn closing_refunds_the_unused_budget_and_keeps_holdings() {
    let mut g = fresh();
    created(&mut g, 4);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("ana.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig);
    ctx("maker.testnet", 1, 4_000);
    assert_eq!(g.close_badge("tower-climb".into()).0, 3 * PER_CLAIM_YOCTO);
    let b = g.get_badge("tower-climb".into()).unwrap();
    assert!(b.closed && !b.active);
    assert_eq!(g.has_badge("tower-climb".into(), a("ana.testnet")), Some(1));
}

#[test]
#[should_panic(expected = "Badge is not accepting holders")]
fn the_owner_can_pause_a_badge_for_moderation() {
    let mut g = fresh();
    created(&mut g, 3);
    ctx("owner.testnet", 1, 3_000);
    g.set_badge_active("tower-climb".into(), false);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("ana.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig);
}

#[test]
#[should_panic(expected = "Badge has ended")]
fn the_claim_window_is_enforced() {
    let mut g = fresh();
    let mut i = input(3);
    i.starts_at_ms = Some(U64(1_000));
    i.ends_at_ms = Some(U64(2_500));
    ctx("maker.testnet", g.create_cost(3).0, 2_000);
    g.create_badge("tower-climb".into(), i, None);
    let sig = sign(&g, "tower-climb", "ana.testnet", 10_000);
    ctx("ana.testnet", 0, 3_000);
    g.claim("tower-climb".into(), a("ana.testnet"), U64(10_000), sig);
}

#[test]
#[should_panic(expected = "A badge id is")]
fn badge_ids_are_validated() {
    let mut g = fresh();
    ctx("maker.testnet", g.create_cost(1).0, 2_000);
    g.create_badge("Bad Id".into(), input(1), None);
}

#[test]
#[should_panic(expected = "Badge id already taken")]
fn badge_ids_are_never_reused() {
    let mut g = fresh();
    created(&mut g, 1);
    created(&mut g, 1);
}

#[test]
fn claim_message_is_bound_to_contract_and_network() {
    let g = fresh();
    let m = g.claim_message("tower-climb".into(), a("ana.testnet"), U64(99));
    assert_eq!(
        m,
        "QuestLayer badge claim v1\nContract: badges.questlayer.testnet\nNetwork: testnet\nBadge: tower-climb\nAccount: ana.testnet\nExpires: 99"
    );
    assert_eq!(g.get_config()["transferable"], false);
}
