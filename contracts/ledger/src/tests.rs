use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env};

const CONTRACT: &str = "ledger.questlayer.testnet";

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
fn meta() -> FungibleTokenMetadata {
    FungibleTokenMetadata {
        spec: "ft-1.0.0".into(),
        name: "QuestLayer XP".into(),
        symbol: "QXP".into(),
        icon: None,
        reference: None,
        reference_hash: None,
        decimals: 0,
    }
}
fn fresh(gold: bool) -> Ledger {
    ctx("owner.testnet", 0, 1_000_000);
    Ledger::new(a("owner.testnet"), if gold { Some(a("qgold.ledger.questlayer.testnet")) } else { None }, meta(), None, None)
}
const EV: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
fn act(who: &str, seq: u64, kind: &str, xp: u64, gold: u128) -> Action {
    Action {
        account_id: a(who),
        seq: U64(seq),
        kind: kind.into(),
        xp: U64(xp),
        gold: U128(gold),
        count: None,
        cell: Some("u2fkb7x".into()),
        at_ms: U64(999_000),
        ev: EV.into(),
        ref_id: Some(format!("ca_{seq}")),
    }
}

#[test]
fn records_xp_gold_and_profile() {
    let mut l = fresh(true);
    ctx(CONTRACT, 0, 1_000_000);
    let r = l.record_batch(vec![
        act("alice.testnet", 1, "coin", 3, 5_000_000),
        act("alice.testnet", 2, "find", 8, 0),
        act("alice.testnet", 3, "monster", 120, 0),
        act("bob.testnet", 1, "quest", 40, 2_000_000),
    ]);
    assert_eq!((r.applied, r.skipped, r.xp.0, r.gold.0), (4, 0, 171, 7_000_000));
    let p = l.profile(a("alice.testnet")).unwrap();
    assert_eq!((p.xp.0, p.gold.0, p.coins.0, p.finds.0, p.monsters.0, p.actions.0), (131, 5_000_000, 1, 1, 1, 3));
    assert_eq!(p.level, 2);
    assert_eq!(p.next_level_xp.unwrap().0, 400);
    assert_eq!(l.ft_balance_of(a("alice.testnet")).0, 131);
    assert_eq!(l.ft_total_supply().0, 171);
    assert_eq!(l.get_config().holders.0, 2);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs[0].contains("\"ft_mint\""));
    assert!(logs[0].contains("ql1 coin x1 xp=3 gold=5000000 cell=u2fkb7x t=999000 ev=0123456789abcdef seq=1 ref=ca_1"));
}

#[test]
fn retried_actions_are_skipped() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    l.record_batch(vec![act("alice.testnet", 1, "coin", 3, 1), act("alice.testnet", 2, "coin", 3, 1)]);
    let r = l.record_batch(vec![act("alice.testnet", 2, "coin", 3, 1), act("alice.testnet", 3, "coin", 3, 1)]);
    assert_eq!((r.applied, r.skipped), (1, 1));
    assert_eq!(r.skipped_refs, vec!["ca_2".to_string()]);
    assert_eq!(l.profile(a("alice.testnet")).unwrap().xp.0, 9);
    assert_eq!(l.last_seq(a("alice.testnet")).0, 3);
}

#[test]
fn gold_without_token_is_held() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    l.record_batch(vec![act("alice.testnet", 1, "coin", 0, 5)]);
    assert_eq!(l.profile(a("alice.testnet")).unwrap().gold_pending.0, 5);
}

#[test]
fn daily_totals_carry_a_count() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    let mut day = act("alice.testnet", 7, "coin", 30, 10);
    day.count = Some(10);
    day.cell = None;
    l.record_batch(vec![day]);
    let p = l.profile(a("alice.testnet")).unwrap();
    assert_eq!((p.coins.0, p.actions.0), (10, 10));
    assert!(near_sdk::test_utils::get_logs()[0].contains("ql1 coin x10 xp=30 gold=10 t="));
}

#[test]
#[should_panic(expected = "Recorder only")]
fn players_cannot_record() {
    let mut l = fresh(false);
    ctx("alice.testnet", 0, 1_000_000);
    l.record_batch(vec![act("alice.testnet", 1, "coin", 3, 1)]);
}

#[test]
#[should_panic(expected = "Cell must be a geohash")]
fn rejects_non_geohash_cells() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    let mut x = act("alice.testnet", 1, "coin", 3, 1);
    x.cell = Some("49.74,13.37".into());
    l.record_batch(vec![x]);
}

#[test]
#[should_panic(expected = "An action earns XP or GOLD")]
fn rejects_empty_actions() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    l.record_batch(vec![act("alice.testnet", 1, "coin", 0, 0)]);
}

#[test]
#[should_panic(expected = "QXP is soulbound")]
fn qxp_cannot_move() {
    let mut l = fresh(false);
    ctx("alice.testnet", 1, 1_000_000);
    l.ft_transfer(a("bob.testnet"), U128(1), None);
}

#[test]
fn levels_follow_the_game_formula() {
    let l = fresh(false);
    assert_eq!(l.level_for(U64(0)), 1);
    assert_eq!(l.level_for(U64(99)), 1);
    assert_eq!(l.level_for(U64(100)), 2);
    assert_eq!(l.level_for(U64(399)), 2);
    assert_eq!(l.level_for(U64(8_100)), 10);
    assert_eq!(l.level_for(U64(1_000_000)), 10);
}

fn sha(bytes: &[u8]) -> Vec<u8> {
    env::sha256(bytes)
}

#[test]
fn day_roots_verify_leaves() {
    let mut l = fresh(false);
    let leaves: Vec<Vec<u8>> = (0..3u8).map(|i| sha(&[i])).collect();
    let ab = hash_pair(&leaves[0], &leaves[1]);
    // An odd node is carried up unchanged (server/chain-ledger/merkle.mjs).
    let root = hash_pair(&ab, &leaves[2]);
    ctx(CONTRACT, 0, 1_000_000);
    l.commit_day("2026-11-04".into(), hex(&root), U64(3), U64(10), U128(5));
    assert!(l.verify_proof("2026-11-04".into(), hex(&leaves[1]), vec![hex(&leaves[0]), hex(&leaves[2])]));
    assert!(l.verify_proof("2026-11-04".into(), hex(&leaves[2]), vec![hex(&ab)]));
    assert!(!l.verify_proof("2026-11-04".into(), hex(&leaves[2]), vec![hex(&leaves[0])]));
    assert!(!l.verify_proof("2026-11-05".into(), hex(&leaves[2]), vec![hex(&ab)]));
    assert_eq!(l.days(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "already committed")]
fn a_day_is_committed_once() {
    let mut l = fresh(false);
    ctx(CONTRACT, 0, 1_000_000);
    l.commit_day("2026-11-04".into(), EV.into(), U64(1), U64(1), U128(0));
    l.commit_day("2026-11-04".into(), EV.into(), U64(1), U64(1), U128(0));
}

#[test]
fn isqrt_is_exact() {
    for n in [0u64, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, u32::MAX as u64, u64::MAX] {
        let r = isqrt(n) as u128;
        assert!(r * r <= n as u128 && (r + 1) * (r + 1) > n as u128, "{n}");
    }
}

#[test]
fn failed_gold_mint_is_held_and_retried() {
    let mut l = fresh(true);
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(CONTRACT)).predecessor_account_id(a(CONTRACT)).account_balance(NearToken::from_near(50));
    near_sdk::test_utils::testing_env_with_promise_results(b.build(), near_sdk::PromiseResult::Failed);
    let mints = vec![GoldMint { account_id: a("alice.testnet"), amount: U128(9), memo: None }];
    assert!(!l.on_gold_minted(mints));
    ctx(CONTRACT, 0, 1_000_000);
    l.record_batch(vec![act("alice.testnet", 1, "coin", 1, 0)]);
    assert_eq!(l.profile(a("alice.testnet")).unwrap().gold_pending.0, 9);
    assert_eq!(l.retry_gold(vec![a("alice.testnet")]).0, 9);
    assert_eq!(l.profile(a("alice.testnet")).unwrap().gold_pending.0, 0);
}
