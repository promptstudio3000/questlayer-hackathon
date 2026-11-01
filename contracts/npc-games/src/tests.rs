use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::{test_utils::VMContextBuilder, testing_env, NearToken};

const SECRET: &str = "0707070707070707070707070707070707070707070707070707070707070707";

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, deposit: u128, height: u64, time_ms: u64, seed: u8) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("npc-games.questlayer.testnet"))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .account_balance(NearToken::from_near(10))
        .block_height(height)
        .block_timestamp(time_ms * 1_000_000)
        .random_seed([seed; 32])
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}
fn key() -> SigningKey {
    SigningKey::from_bytes(&[5u8; 32])
}
fn commit_of(secret: &str) -> String {
    hex(&env::sha256_array(&unhex32(secret, "secret")))
}
fn tiers() -> Vec<Tier> {
    vec![
        Tier { prize: "trader-voucher".into(), weight: 60, daily_cap: None },
        Tier { prize: "aura-rare".into(), weight: 30, daily_cap: None },
        Tier { prize: "aura-epic".into(), weight: 9, daily_cap: Some(5) },
        Tier { prize: "aura-wisp".into(), weight: 1, daily_cap: Some(1) },
    ]
}
fn fresh() -> NpcGames {
    ctx("owner.testnet", 0, 100, 1_000, 0);
    let mut g = NpcGames::new(a("owner.testnet"), Some(Base64VecU8(key().verifying_key().to_bytes().to_vec())), 600);
    ctx("owner.testnet", 1, 100, 1_000, 0);
    g.publish_table("wisp-v1".into(), tiers(), 0);
    g
}
fn ticket(g: &NpcGames, roll: &str, who: &str, commit: &str, table: &str, exp: u64) -> Base64VecU8 {
    let msg = g.ticket_message(roll.into(), a(who), commit.into(), table.into(), U64(exp));
    Base64VecU8(key().sign(msg.as_bytes()).to_bytes().to_vec())
}
fn start(g: &mut NpcGames, roll: &str, who: &str, secret: &str, height: u64) -> Roll {
    let commit = commit_of(secret);
    let sig = ticket(g, roll, who, &commit, "wisp-v1", 10_000_000);
    ctx(who, 0, height, 2_000, 0);
    g.start_roll(roll.into(), "wisp-v1".into(), commit, U64(10_000_000), sig)
}

#[test]
fn earned_roll_resolves_after_the_delay_and_is_reproducible() {
    let mut g = fresh();
    let r = start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    assert_eq!(r.status, RollStatus::Pending);
    assert_eq!(r.start_height.0, 200);
    ctx("worker.testnet", 0, 203, 3_000, 42);
    let done = g.resolve_roll("sight-1".into(), SECRET.into());
    assert_eq!(done.status, RollStatus::Resolved);
    assert_eq!(done.account_id, a("ana.testnet"), "the prize stays with the ticket owner");
    // Anyone can recompute the draw from public data.
    let mut input = DOMAIN.to_vec();
    input.extend_from_slice(&[42u8; 32]);
    input.extend_from_slice(&unhex32(SECRET, "s"));
    input.extend_from_slice(b"sight-1\nana.testnet");
    let r = env::sha256_array(&input);
    assert_eq!(done.random.as_deref(), Some(hex(&r).as_str()));
    let table = g.get_table("wisp-v1".into()).unwrap();
    let tier = pick_tier(&table, u64::from_be_bytes(r[..8].try_into().unwrap()));
    assert_eq!(done.tier, Some(tier));
    assert_eq!(done.prize.as_deref(), Some(tiers()[tier as usize].prize.as_str()));
    assert_eq!(g.get_config()["rolls_resolved"], 1);
}

#[test]
#[should_panic(expected = "Too early")]
fn reveal_in_the_same_or_next_blocks_is_refused() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("worker.testnet", 0, 202, 3_000, 1);
    g.resolve_roll("sight-1".into(), SECRET.into());
}

#[test]
#[should_panic(expected = "Secret does not match")]
fn wrong_secret_is_refused() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("worker.testnet", 0, 210, 3_000, 1);
    g.resolve_roll("sight-1".into(), "08".repeat(32));
}

#[test]
#[should_panic(expected = "Roll already finished")]
fn a_roll_resolves_only_once() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("worker.testnet", 0, 210, 3_000, 1);
    g.resolve_roll("sight-1".into(), SECRET.into());
    ctx("worker.testnet", 0, 211, 3_000, 2);
    g.resolve_roll("sight-1".into(), SECRET.into());
}

#[test]
#[should_panic(expected = "Invalid roll ticket")]
fn a_ticket_cannot_be_used_by_another_account() {
    let mut g = fresh();
    let commit = commit_of(SECRET);
    let sig = ticket(&g, "sight-1", "ana.testnet", &commit, "wisp-v1", 10_000_000);
    ctx("eve.testnet", 0, 200, 2_000, 0);
    g.start_roll("sight-1".into(), "wisp-v1".into(), commit, U64(10_000_000), sig);
}

#[test]
#[should_panic(expected = "Invalid roll ticket")]
fn a_self_made_ticket_is_refused() {
    let mut g = fresh();
    let commit = commit_of(SECRET);
    let msg = g.ticket_message("sight-1".into(), a("eve.testnet"), commit.clone(), "wisp-v1".into(), U64(10_000_000));
    let forged = Base64VecU8(SigningKey::from_bytes(&[9u8; 32]).sign(msg.as_bytes()).to_bytes().to_vec());
    ctx("eve.testnet", 0, 200, 2_000, 0);
    g.start_roll("sight-1".into(), "wisp-v1".into(), commit, U64(10_000_000), forged);
}

#[test]
#[should_panic(expected = "Roll already used")]
fn a_ticket_is_single_use() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    start(&mut g, "sight-1", "ana.testnet", SECRET, 201);
}

#[test]
#[should_panic(expected = "Roll ticket expired")]
fn an_expired_ticket_is_refused() {
    let mut g = fresh();
    let commit = commit_of(SECRET);
    let sig = ticket(&g, "sight-1", "ana.testnet", &commit, "wisp-v1", 1_500);
    ctx("ana.testnet", 0, 200, 2_000, 0);
    g.start_roll("sight-1".into(), "wisp-v1".into(), commit, U64(1_500), sig);
}

#[test]
#[should_panic(expected = "Mini-games take no deposit")]
fn no_wager_can_be_attached() {
    let mut g = fresh();
    let commit = commit_of(SECRET);
    let sig = ticket(&g, "sight-1", "ana.testnet", &commit, "wisp-v1", 10_000_000);
    ctx("ana.testnet", 10u128.pow(24), 200, 2_000, 0);
    g.start_roll("sight-1".into(), "wisp-v1".into(), commit, U64(10_000_000), sig);
}

#[test]
#[should_panic(expected = "Table is closed")]
fn a_closed_table_takes_no_new_rolls() {
    let mut g = fresh();
    ctx("owner.testnet", 1, 150, 1_500, 0);
    g.set_table_active("wisp-v1".into(), false);
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
}

#[test]
fn a_withheld_secret_pays_the_guaranteed_minimum() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("ana.testnet", 0, 800, 9_000, 3);
    let r = g.claim_timeout("sight-1".into());
    assert_eq!(r.status, RollStatus::TimedOut);
    assert_eq!(r.prize.as_deref(), Some("trader-voucher"));
    assert_eq!(g.get_config()["rolls_timed_out"], 1);
}

#[test]
#[should_panic(expected = "Reveal window closed")]
fn no_late_reveal_after_the_timeout() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("worker.testnet", 0, 800, 9_000, 3);
    g.resolve_roll("sight-1".into(), SECRET.into());
}

#[test]
#[should_panic(expected = "still open")]
fn no_early_timeout_claim() {
    let mut g = fresh();
    start(&mut g, "sight-1", "ana.testnet", SECRET, 200);
    ctx("ana.testnet", 0, 799, 9_000, 3);
    g.claim_timeout("sight-1".into());
}

#[test]
fn a_tier_over_its_daily_cap_falls_back_to_the_minimum() {
    ctx("owner.testnet", 0, 100, 1_000, 0);
    let mut g = NpcGames::new(a("owner.testnet"), Some(Base64VecU8(key().verifying_key().to_bytes().to_vec())), 600);
    ctx("owner.testnet", 1, 100, 1_000, 0);
    g.publish_table(
        "wisp-v1".into(),
        vec![
            Tier { prize: "trader-voucher".into(), weight: 1, daily_cap: None },
            Tier { prize: "aura-wisp".into(), weight: 999_999, daily_cap: Some(1) },
        ],
        0,
    );
    let secret2 = "09".repeat(32);
    start(&mut g, "r1", "ana.testnet", SECRET, 200);
    start(&mut g, "r2", "bob.testnet", &secret2, 200);
    ctx("worker.testnet", 0, 210, 3_000, 1);
    let first = g.resolve_roll("r1".into(), SECRET.into());
    ctx("worker.testnet", 0, 211, 3_100, 2);
    let second = g.resolve_roll("r2".into(), secret2);
    assert_eq!(first.prize.as_deref(), Some("aura-wisp"));
    assert!(!first.capped);
    assert_eq!(second.prize.as_deref(), Some("trader-voucher"));
    assert!(second.capped, "the cap is recorded on the roll");
    assert_eq!(g.get_wins("wisp-v1".into(), 1, U64(0)), 1);
}

#[test]
fn draws_follow_the_published_weights() {
    let table = PrizeTable { tiers: tiers(), minimum: 0, total_weight: 100, active: true, published_at_ms: U64(0) };
    let mut counts = [0u32; 4];
    for i in 0u32..20_000 {
        let r = env::sha256_array(&i.to_be_bytes());
        counts[pick_tier(&table, u64::from_be_bytes(r[..8].try_into().unwrap())) as usize] += 1;
    }
    // 60 / 30 / 9 / 1 % within a wide margin.
    assert!((11_400..12_600).contains(&counts[0]), "{counts:?}");
    assert!((5_500..6_500).contains(&counts[1]), "{counts:?}");
    assert!((1_550..2_050).contains(&counts[2]), "{counts:?}");
    assert!((120..290).contains(&counts[3]), "{counts:?}");
}

#[test]
#[should_panic(expected = "Table ids are immutable")]
fn published_tables_cannot_be_rewritten() {
    let mut g = fresh();
    ctx("owner.testnet", 1, 100, 1_000, 0);
    g.publish_table("wisp-v1".into(), tiers(), 0);
}

#[test]
#[should_panic(expected = "minimum tier cannot be capped")]
fn the_minimum_tier_must_be_uncapped() {
    let mut g = fresh();
    ctx("owner.testnet", 1, 100, 1_000, 0);
    g.publish_table("wisp-v2".into(), tiers(), 3);
}

#[test]
#[should_panic(expected = "Owner only")]
fn only_the_owner_publishes_tables() {
    let mut g = fresh();
    ctx("eve.testnet", 1, 100, 1_000, 0);
    g.publish_table("wisp-v2".into(), tiers(), 0);
}

#[test]
#[should_panic(expected = "64 lowercase hex")]
fn commits_must_be_sha256_hex() {
    let mut g = fresh();
    let sig = ticket(&g, "sight-1", "ana.testnet", "ABC", "wisp-v1", 10_000_000);
    ctx("ana.testnet", 0, 200, 2_000, 0);
    g.start_roll("sight-1".into(), "wisp-v1".into(), "ABC".into(), U64(10_000_000), sig);
}

#[test]
fn ticket_text_names_contract_and_network() {
    let g = fresh();
    let m = g.ticket_message("r".into(), a("ana.testnet"), "c".into(), "t".into(), U64(5));
    assert!(m.starts_with("QuestLayer NPC roll ticket v1\nContract: npc-games.questlayer.testnet\nNetwork: testnet\n"));
}

#[test]
#[should_panic(expected = "daily cap must be at least 1")]
fn a_zero_cap_is_refused() {
    let mut g = fresh();
    ctx("owner.testnet", 1, 100, 1_000, 0);
    let mut t = tiers();
    t[3].daily_cap = Some(0);
    g.publish_table("wisp-v2".into(), t, 0);
}

#[test]
fn the_owner_can_hand_over() {
    let mut g = fresh();
    ctx("owner.testnet", 1, 100, 1_000, 0);
    g.set_owner(a("ops.testnet"));
    assert_eq!(g.get_config()["owner_id"], "ops.testnet");
}
