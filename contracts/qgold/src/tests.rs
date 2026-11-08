use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

const MILLI: u128 = NEAR / 1_000;

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// A tiny chain: keeps the contract balance and the clock across calls.
struct Chain {
    bal: u128,
    now_ms: u64,
}

impl Chain {
    fn new() -> Self {
        Self { bal: 5 * NEAR, now_ms: 1_800_000_000_000 }
    }
    fn ctx(&self, who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("qgold.questlayer.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_yoctonear(self.bal))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now_ms * 1_000_000)
            .prepaid_gas(Gas::from_tgas(300));
        testing_env!(b.build());
    }
    /// Runs `f` as `who` with `deposit` and keeps the balance after it.
    fn call<R>(&mut self, who: &str, deposit: u128, f: impl FnOnce() -> R) -> R {
        self.ctx(who, deposit);
        let r = f();
        self.bal = env::account_balance().as_yoctonear();
        r
    }
    fn hours(&mut self, h: u64) {
        self.now_ms += h * HOUR_MS;
    }
}

fn meta() -> FungibleTokenMetadata {
    FungibleTokenMetadata { spec: "ft-1.0.0".into(), name: "QuestLayer Gold".into(), symbol: "QGOLD".into(), icon: None, reference: None, reference_hash: None, decimals: 6 }
}

fn fresh(c: &mut Chain) -> QGold {
    c.call("council.testnet", 0, || {
        QGold::new(vec![a("council.testnet")], 1, a("guardian.testnet"), a("treasury.testnet"), vec![a("rewards.testnet")], U128(MILLI), meta())
    })
}

fn state(c: &Chain, q: &QGold) -> Value {
    c.ctx("viewer.testnet", 0);
    q.get_state()
}
fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

#[test]
fn rewards_mint_at_r_without_fee() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    // A coin worth 0.01 NEAR at R = 0.001 NEAR/QGOLD mints 10 QGOLD.
    let n = c.call("rewards.testnet", 10 * MILLI, || q.mint_for(a("alice.testnet"), Some("coin plzen".into())));
    assert_eq!(n.0, 10 * ONE);
    assert_eq!(q.ft_balance_of(a("alice.testnet")).0, 10 * ONE);
    let st = state(&c, &q);
    assert_eq!(num(&st, "backing"), 10 * MILLI);
    assert_eq!(num(&st, "rate"), MILLI);
    assert_eq!(num(&st, "fees_total"), 0);
}

#[test]
fn world_earning_carries_every_unconverted_yocto_for_its_account() {
    let mut c=Chain::new();let mut q=fresh(&mut c);let unit=MILLI/ONE;
    let first=c.call("rewards.testnet",unit+7,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-1".into())));
    assert_eq!(num(&first,"qgoldU"),1);assert_eq!(num(&first,"consumedYocto"),unit);assert_eq!(num(&first,"carryYocto"),7);
    assert_eq!(q.get_game_conversion(a("rewards.testnet"),"alice-1".into()).unwrap(),first);
    assert_eq!(q.backing,unit);assert_eq!(q.get_mint_carry(a("rewards.testnet"),a("alice.testnet")).0,7);
    assert_eq!(stored_amount(MINT_CARRY_TOTAL),7);
    let second=c.call("rewards.testnet",unit-7,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-2".into())));
    assert_eq!(num(&second,"qgoldU"),1);assert_eq!(num(&second,"carryYocto"),0);assert_eq!(q.backing,2*unit);assert_eq!(stored_amount(MINT_CARRY_TOTAL),0);
}

#[test]
fn world_dust_is_not_backing_and_other_accounts_cannot_consume_it() {
    let mut c=Chain::new();let mut q=fresh(&mut c);let unit=MILLI/ONE;
    let first=c.call("rewards.testnet",unit-1,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-3".into())));
    assert_eq!(num(&first,"qgoldU"),0);assert_eq!(q.backing,0);assert_eq!(q.supply,0);
    let bob=c.call("rewards.testnet",1,||q.mint_with_carry_for(a("bob.testnet"),Some("bob-1".into())));
    assert_eq!(num(&bob,"qgoldU"),0);assert_eq!(num(&bob,"carryYocto"),1);assert_eq!(stored_amount(MINT_CARRY_TOTAL),unit);
    assert_eq!(q.get_mint_carry(a("rewards.testnet"),a("alice.testnet")).0,unit-1);
    let before=stored_amount(MINT_CARRY_TOTAL);c.call("viewer.testnet",0,||q.reconcile());assert_eq!(stored_amount(MINT_CARRY_TOTAL),before);assert_eq!(q.backing,0);
}

#[test]
fn world_carry_converts_at_the_new_ratio_without_repricing_old_near() {
    let mut c=Chain::new();let mut q=fresh(&mut c);let unit=MILLI/ONE;
    c.call("rewards.testnet",2*unit+9,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-4".into())));
    c.call("alice.testnet",1,||q.ft_burn(U128(1),None));
    let ratio=q.rate();assert_eq!(ratio,2*MILLI);
    let next=c.call("rewards.testnet",2*unit-9,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-5".into())));
    assert_eq!(num(&next,"qgoldU"),1);assert_eq!(num(&next,"consumedYocto"),2*unit);assert_eq!(num(&next,"carryYocto"),0);assert!(q.rate()>=ratio);
}

#[test]
#[should_panic(expected="Approved minter only")]
fn unapproved_minter_cannot_redirect_world_carry() {
    let mut c=Chain::new();let mut q=fresh(&mut c);c.call("mallory.testnet",1,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-6".into())));
}

#[test]
#[should_panic(expected = "Approved minter only")]
fn nobody_else_mints_for_free() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("alice.testnet", NEAR, || q.mint_for(a("alice.testnet"), None));
}

#[test]
fn deposit_pays_one_percent_and_never_lowers_r() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let d = NEAR + STORAGE_FEE;
    let got = c.call("bob.testnet", d, || q.deposit(None, None));
    // 1 NEAR - 1 % = 0.99 NEAR at 0.001 = 990 QGOLD.
    assert_eq!(got.0, 990 * ONE);
    let st = state(&c, &q);
    assert_eq!(num(&st, "rate"), MILLI);
    assert_eq!(num(&st, "insurance"), NEAR / 1_000); // 10 % of the 0.01 fee
    assert_eq!(num(&st, "treasury_due"), 9 * NEAR / 1_000);
}

#[test]
#[should_panic(expected = "Price moved")]
fn deposit_respects_min_out() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("bob.testnet", NEAR + STORAGE_FEE, || q.deposit(Some(U128(991 * ONE)), None));
}

#[test]
fn burn_raises_r_and_redeem_pays_share_minus_fee() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None)); // 100 QGOLD
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("bob.testnet"), None)); // 100 QGOLD
    c.call("bob.testnet", 1, || q.ft_burn(U128(100 * ONE), Some("npc gear".into())));
    // 0.2 NEAR now backs 100 QGOLD: R doubled.
    assert_eq!(num(&state(&c, &q), "rate"), 2 * MILLI);
    let before = c.bal;
    let r = c.call("alice.testnet", 1, || q.redeem(U128(10 * ONE), None, None));
    assert_eq!(r.status, "paid");
    assert_eq!(r.gross.0, 20 * MILLI);
    assert_eq!(r.amount.0, 20 * MILLI * 99 / 100);
    // The transfer left the contract (minus the 1 yocto that came in).
    assert_eq!(before + 1 - c.bal, r.amount.0);
    assert_eq!(num(&state(&c, &q), "rate"), 2 * MILLI);
    assert_eq!(q.ft_balance_of(a("alice.testnet")).0, 90 * ONE);
}

#[test]
#[should_panic(expected = "Not enough QGOLD")]
fn nobody_redeems_more_than_they_hold() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("mallory.testnet"), None));
    c.call("mallory.testnet", 1, || q.redeem(U128(101 * ONE), None, None));
}

#[test]
#[should_panic(expected = "Account is not registered")]
fn strangers_cannot_redeem() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("mallory.testnet", 1, || q.redeem(U128(1 * ONE), None, None));
}

#[test]
fn big_exit_waits_in_the_queue_and_pays_only_its_owner() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    // 100 NEAR backing; whale holds 50 %.
    c.call("whale.testnet", 50 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    c.call("fish.testnet", 50 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    let backing = num(&state(&c, &q), "backing");
    let whale = q.ft_balance_of(a("whale.testnet")).0;
    // Account cap is 1 % of backing (~0.99 NEAR) but at least 1 NEAR; 5 % globally.
    let small = c.call("fish.testnet", 1, || q.redeem(U128(500 * ONE), None, None)); // 0.5 NEAR
    assert_eq!(small.status, "paid");
    let r = c.call("whale.testnet", 1, || q.redeem(U128(whale), None, None));
    assert_eq!(r.status, "queued");
    let id = r.exit_id.unwrap();
    assert!(r.gross.0 > backing / 3);
    assert_eq!(q.ft_balance_of(a("whale.testnet")).0, 0, "burned first");
    c.hours(23);
    c.ctx("anyone.testnet", 0);
    let e = q.get_exit(id).unwrap();
    assert_eq!(e.account_id, a("whale.testnet"));
    c.hours(1);
    let before = c.bal;
    let paid = c.call("anyone.testnet", 0, || q.claim_exit(id));
    assert_eq!(paid.0, r.amount.0);
    assert_eq!(before - c.bal, paid.0);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|l| l.contains("exit_claimed") && l.contains("whale.testnet")));
    assert!(q.get_exit(id).is_none());
    assert_eq!(num(&state(&c, &q)["exit"], "queue_pending"), 0);
}

#[test]
#[should_panic(expected = "still in its safe window")]
fn queued_exit_cannot_be_claimed_early() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("whale.testnet", 100 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    let r = c.call("whale.testnet", 1, || q.redeem(U128(50_000 * ONE), Some("near_queue".into()), None));
    c.hours(23);
    c.call("whale.testnet", 0, || q.claim_exit(r.exit_id.unwrap()));
}

#[test]
fn global_cap_sends_the_rest_to_the_queue() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    for i in 0..10 {
        let who = format!("p{i}.testnet");
        c.call(&who, 10 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    }
    // 99 NEAR backing: global instant cap 4.95 NEAR, per account 1 NEAR floor.
    let mut paid = 0;
    let mut queued = 0;
    for i in 0..10 {
        let who = format!("p{i}.testnet");
        let r = c.call(&who, 1, || q.redeem(U128(900 * ONE), None, None)); // 0.9 NEAR each
        if r.status == "paid" { paid += 1 } else { queued += 1 }
    }
    assert_eq!((paid, queued), (5, 5));
    let st = state(&c, &q);
    assert!(num(&st["exit"], "instant_used_24h") <= num(&st["exit"], "instant_cap_24h"));
    // Next day the window resets.
    c.hours(24);
    let r = c.call("p9.testnet", 1, || q.redeem(U128(90 * ONE), None, None));
    assert_eq!(r.status, "paid");
}

#[test]
fn transfers_need_a_registered_receiver() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ctx("alice.testnet", 1);
        q.ft_transfer(a("bob.testnet"), U128(ONE), None);
    }));
    assert!(r.is_err());
    c.call("bob.testnet", STORAGE_FEE, || q.storage_deposit(None, None));
    c.call("alice.testnet", 1, || q.ft_transfer(a("bob.testnet"), U128(ONE), Some("gift".into())));
    assert_eq!(q.ft_balance_of(a("bob.testnet")).0, ONE);
    assert_eq!(q.ft_total_supply().0, 100 * ONE);
}

#[test]
fn guardian_pause_blocks_everything_and_expires() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("guardian.testnet", 0, || q.pause());
    assert!(state(&c, &q)["paused"].as_bool().unwrap());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ctx("alice.testnet", 1);
        q.redeem(U128(ONE), None, None);
    }));
    assert!(r.is_err());
    c.hours(72);
    let r = c.call("alice.testnet", 1, || q.redeem(U128(10 * ONE), None, None));
    assert_eq!(r.status, "paid");
}

#[test]
#[should_panic(expected = "Guardian or council only")]
fn strangers_cannot_pause() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("mallory.testnet", 0, || q.pause());
}

#[test]
#[should_panic(expected = "Council only")]
fn guardian_cannot_unpause_or_propose() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("guardian.testnet", 0, || q.propose(Action::SetTreasury { account_id: a("guardian.testnet") }));
}

#[test]
fn void_exit_returns_qgold_and_backing_during_an_incident() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("whale.testnet", 100 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    let held = q.ft_balance_of(a("whale.testnet")).0;
    let r = c.call("whale.testnet", 1, || q.redeem(U128(held / 2), Some("near_queue".into()), None));
    let rate = num(&state(&c, &q), "rate");
    c.call("guardian.testnet", 0, || q.pause());
    c.call("council.testnet", 0, || q.void_exit(r.exit_id.unwrap()));
    assert_eq!(q.ft_balance_of(a("whale.testnet")).0, held);
    let st = state(&c, &q);
    assert_eq!(num(&st, "rate"), rate);
    assert_eq!(num(&st["exit"], "queue_pending"), 0);
}

#[test]
fn council_changes_wait_48h_and_need_the_threshold() {
    let mut c = Chain::new();
    let mut q = c.call("c1.testnet", 0, || {
        QGold::new(vec![a("c1.testnet"), a("c2.testnet"), a("c3.testnet")], 2, a("guardian.testnet"), a("treasury.testnet"), vec![], U128(MILLI), meta())
    });
    let id = c.call("c1.testnet", 0, || q.propose(Action::SetMinter { account_id: a("rewards.testnet"), allowed: true }));
    c.hours(48);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ctx("anyone.testnet", 0);
        q.execute(id);
    }));
    assert!(r.is_err(), "one approval is not enough");
    c.call("c2.testnet", 0, || q.approve(id));
    c.call("anyone.testnet", 0, || q.execute(id));
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_config()["minters"][0], "rewards.testnet");
}

#[test]
#[should_panic(expected = "Timelock")]
fn timelock_is_enforced() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let id = c.call("council.testnet", 0, || q.propose(Action::SetGuardian { account_id: a("g2.testnet") }));
    c.hours(47);
    c.call("council.testnet", 0, || q.execute(id));
}

#[test]
#[should_panic(expected = "safe_window_ms is 24-48 h")]
fn params_stay_in_bounds() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let mut p = Params::defaults();
    p.safe_window_ms = U64(HOUR_MS);
    c.call("council.testnet", 0, || q.propose(Action::SetParams { params: p }));
}

#[test]
#[should_panic(expected = "Code does not match")]
fn upgrade_needs_the_approved_code() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let hash: String = env::sha256(b"good code").iter().map(|b| format!("{b:02x}")).collect();
    let id = c.call("council.testnet", 0, || q.propose(Action::Upgrade { code_sha256: hash }));
    c.hours(48);
    c.call("anyone.testnet", 0, || q.apply_upgrade(id, Base64VecU8(b"evil code".to_vec())));
}

#[test]
fn upgrade_with_the_approved_code_after_the_timelock() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let hash: String = env::sha256(b"good code").iter().map(|b| format!("{b:02x}")).collect();
    let id = c.call("council.testnet", 0, || q.propose(Action::Upgrade { code_sha256: hash }));
    c.hours(48);
    let _ = c.call("anyone.testnet", 0, || q.apply_upgrade(id, Base64VecU8(b"good code".to_vec())));
    c.ctx("v.testnet", 0);
    assert!(q.get_proposal(id).unwrap().done);
}

#[test]
fn a_drain_freezes_the_vault_until_reconcile_and_insurance_refills_r() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("alice.testnet", 10 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    c.call("council.testnet", 2 * NEAR, || q.fund_insurance());
    let rate = num(&state(&c, &q), "rate");
    // Something outside the books takes 6 NEAR (3 NEAR of operating slack + 3 more).
    c.bal -= 6 * NEAR;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ctx("alice.testnet", 1);
        q.redeem(U128(ONE), None, None);
    }));
    assert!(r.is_err(), "every change fails while the books are short");
    let out = c.call("anyone.testnet", 0, || q.reconcile());
    assert!(out["shortfall"].as_str().unwrap() != "0");
    let st = state(&c, &q);
    // Insurance (2.0099 NEAR) absorbed it first, the backing the rest.
    assert_eq!(num(&st, "insurance"), 0);
    assert!(num(&st, "rate") < rate);
    c.ctx("v.testnet", 0);
    assert!(!q.audit()["ok"].as_bool().unwrap());
    // New fees refill the insurance fund, which refills R towards its peak.
    c.call("council.testnet", 5 * NEAR, || q.fund_insurance());
    c.call("anyone.testnet", 0, || q.reconcile());
    assert_eq!(num(&state(&c, &q), "rate"), rate);
    c.ctx("v.testnet", 0);
    assert!(q.audit()["ok"].as_bool().unwrap());
}

#[test]
fn failed_payout_stays_claimable_by_the_same_account() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let r = c.call("alice.testnet", 1, || q.redeem(U128(50 * ONE), None, None));
    // The transfer failed and its NEAR came back.
    c.bal += r.amount.0;
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("qgold.questlayer.testnet"))
        .predecessor_account_id(a("qgold.questlayer.testnet"))
        .account_balance(NearToken::from_yoctonear(c.bal))
        .block_timestamp(c.now_ms * 1_000_000);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    assert!(!q.on_payout(a("alice.testnet"), r.amount, r.qgold));
    let exits = q.get_account_exits(a("alice.testnet"));
    assert_eq!(exits.len(), 1);
    assert!(exits[0].fee_free);
    let paid = c.call("bob.testnet", 0, || q.claim_exit(U64(exits[0].id)));
    assert_eq!(paid.0, r.amount.0, "no second fee");
}

#[test]
fn treasury_flush_pays_only_the_treasury() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("bob.testnet", NEAR + STORAGE_FEE, || q.deposit(None, None));
    let due = num(&state(&c, &q), "treasury_due");
    let before = c.bal;
    let sent = c.call("mallory.testnet", 0, || q.flush_treasury());
    assert_eq!(sent.0, due);
    assert_eq!(before - c.bal, due);
    assert_eq!(num(&state(&c, &q), "treasury_due"), 0);
}

#[test]
fn last_holder_out_moves_leftover_backing_to_insurance() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("alice.testnet", 1, || q.ft_burn(U128(100 * ONE), None));
    let st = state(&c, &q);
    assert_eq!(num(&st, "backing"), 0);
    assert_eq!(num(&st, "insurance"), 100 * MILLI);
    // The next minter pays the peak R, not a gift.
    let n = c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("bob.testnet"), None));
    assert_eq!(n.0, 100 * ONE);
}

#[test]
fn unregister_refunds_only_what_was_paid() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("bob.testnet", STORAGE_FEE, || q.storage_deposit(None, None));
    let before = c.bal;
    assert!(c.call("bob.testnet", 1, || q.storage_unregister(None)));
    assert_eq!(before + 1 - c.bal, STORAGE_FEE);
    // A sponsored record refunds nothing.
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("alice.testnet", 1, || q.ft_burn(U128(100 * ONE), None));
    let before = c.bal;
    assert!(c.call("alice.testnet", 1, || q.storage_unregister(None)));
    assert_eq!(before + 1, c.bal);
}

#[test]
fn lifetime_storage_grant_cannot_be_cashed_out_or_charged_twice() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let initial_reserve = q.storage_deposits;
    c.call("escrow.testnet", STORAGE_FEE, || q.storage_deposit_sponsored(a("recipient.testnet")));
    assert_eq!(q.storage_deposits, initial_reserve + STORAGE_FEE);
    for _ in 0..8 {
        let before = c.bal;
        assert!(c.call("recipient.testnet", 1, || q.storage_unregister(None)));
        assert_eq!(c.bal, before + 1, "recipient receives no native refund");
        assert_eq!(q.storage_deposits, initial_reserve + STORAGE_FEE, "grant remains reserved");
        let before = c.bal;
        c.call("escrow.testnet", STORAGE_FEE, || q.storage_deposit_sponsored(a("recipient.testnet")));
        assert_eq!(c.bal, before, "repeat sponsor payment is refunded in full");
        assert_eq!(q.storage_deposits, initial_reserve + STORAGE_FEE);
    }
    // An ordinary player's refundable deposit keeps its existing semantics.
    c.call("player.testnet", STORAGE_FEE, || q.storage_deposit(None, None));
    let before = c.bal;
    c.call("escrow.testnet", STORAGE_FEE, || q.storage_deposit_sponsored(a("player.testnet")));
    assert_eq!(c.bal, before);
    c.call("player.testnet", 1, || q.storage_unregister(None));
    assert_eq!(c.bal, before + 1 - STORAGE_FEE);
}

#[test]
#[should_panic(expected = "Attach at least the storage grant")]
fn first_storage_grant_requires_funding() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("escrow.testnet", 0, || q.storage_deposit_sponsored(a("recipient.testnet")));
}

#[test]
fn rounding_never_lowers_r() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 7 * MILLI + 3, || q.mint_for(a("alice.testnet"), None));
    c.call("bob.testnet", 3 * NEAR + 7 + STORAGE_FEE, || q.deposit(None, None));
    let mut peak = num(&state(&c, &q), "rate");
    for i in 1..30u128 {
        let who = if i % 2 == 0 { "alice.testnet" } else { "bob.testnet" };
        let bal = q.ft_balance_of(a(who)).0;
        let amt = (bal / 7).max(1_001 + i);
        let _ = c.call(who, 1, || q.redeem(U128(amt.min(bal)), None, None));
        c.call("rewards.testnet", 13 * MILLI + i, || q.mint_for(a("alice.testnet"), None));
        let r = num(&state(&c, &q), "rate");
        assert!(r >= peak, "R fell from {peak} to {r}");
        peak = r;
        c.hours(1);
    }
}
