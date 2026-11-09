use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

const MILLI: u128 = NEAR / 1_000;

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// A tiny chain: keeps the contract balance, storage usage and the clock across calls.
struct Chain {
    bal: u128,
    storage: u64,
    now_ms: u64,
}

impl Chain {
    fn new() -> Self {
        Self { bal: 5 * NEAR, storage: 1024 * 300, now_ms: 1_800_000_000_000 }
    }
    fn ctx(&self, who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("qgold.questlayer.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_yoctonear(self.bal))
            .storage_usage(self.storage)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now_ms * 1_000_000)
            .prepaid_gas(Gas::from_tgas(300));
        testing_env!(b.build());
    }
    /// Runs `f` as `who` with `deposit` and keeps the balance and storage after it.
    fn call<R>(&mut self, who: &str, deposit: u128, f: impl FnOnce() -> R) -> R {
        self.ctx(who, deposit);
        let r = f();
        self.bal = env::account_balance().as_yoctonear();
        self.storage = env::storage_usage();
        r
    }
    /// NEAR above everything owed plus the storage cost, as `audit()` reports it.
    fn slack(&self, q: &QGold) -> u128 {
        self.ctx("viewer.testnet", 0);
        num(&q.audit(), "operating_slack")
    }
    /// Runs `f`, which must panic, and returns the message. The mock keeps the
    /// writes made before the panic, so the balance and storage are kept too.
    fn fails(&mut self, who: &str, deposit: u128, f: impl FnOnce()) -> String {
        self.ctx(who, deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        self.bal = env::account_balance().as_yoctonear();
        self.storage = env::storage_usage();
        match r {
            Ok(_) => panic!("expected a panic"),
            Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
        }
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
    // 2 QGOLD are minted and 1 QGOLD burned (a burn may not leave a dust supply, MIN_SUPPLY).
    let mut c=Chain::new();let mut q=fresh(&mut c);let unit=MILLI/ONE;
    c.call("rewards.testnet",2*MILLI+9,||q.mint_with_carry_for(a("alice.testnet"),Some("alice-4".into())));
    c.call("alice.testnet",1,||q.ft_burn(U128(ONE),None));
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
    // Something outside the books takes 8 NEAR: the operating slack, the whole
    // insurance fund (2.01 NEAR) and about 1 NEAR of the backing.
    c.bal -= 8 * NEAR;
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
    // The operating slack that paid for storage went with it and is not a
    // loss: it is funded back explicitly.
    let storage_short = num(&q.audit(), "shortfall");
    assert!(storage_short > 0);
    c.call("ops.testnet", storage_short, || q.fund_operating());
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
    let slack = c.slack(&q);
    c.call("escrow.testnet", SPONSORED_STORAGE_FEE, || q.storage_deposit_sponsored(a("recipient.testnet")));
    // The grant is nobody's refund: it is not an obligation, and it pays for the
    // marker and the holder record, so the operating slack does not shrink (H2).
    assert_eq!(q.storage_deposits, initial_reserve);
    assert!(c.slack(&q) >= slack, "a sponsored grant must pay for its own storage");
    for _ in 0..8 {
        let before = c.bal;
        assert!(c.call("recipient.testnet", 1, || q.storage_unregister(None)));
        assert_eq!(c.bal, before + 1, "recipient receives no native refund");
        let before = c.bal;
        c.call("escrow.testnet", SPONSORED_STORAGE_FEE, || q.storage_deposit_sponsored(a("recipient.testnet")));
        assert_eq!(c.bal, before, "repeat sponsor payment is refunded in full");
        assert_eq!(q.storage_deposits, initial_reserve);
    }
    // An ordinary player's refundable deposit keeps its existing semantics.
    c.call("player.testnet", STORAGE_FEE, || q.storage_deposit(None, None));
    let before = c.bal;
    c.call("escrow.testnet", SPONSORED_STORAGE_FEE, || q.storage_deposit_sponsored(a("player.testnet")));
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

// ------------------------------------------------------------- regression tests (security review 8 Nov 2026)

fn catches(f: impl FnOnce()) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn council3(c: &mut Chain) -> QGold {
    c.call("c1.testnet", 0, || {
        QGold::new(vec![a("c1.testnet"), a("c2.testnet"), a("c3.testnet")], 2, a("guardian.testnet"), a("treasury.testnet"), vec![a("rewards.testnet")], U128(MILLI), meta())
    })
}

/// H1: a near-100 % holder burns all but one unit. R would become backing per
/// unit (about 1e9 times the start) and every coin below ~1 NEAR would mint 0.
#[test]
fn a_dust_supply_cannot_push_r_out_of_reach_of_ordinary_coins() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("mallory.testnet", NEAR + STORAGE_FEE, || q.deposit(None, None)); // 990 QGOLD, 100 % of supply
    let held = q.ft_balance_of(a("mallory.testnet")).0;
    assert!(catches(|| {
        c.ctx("mallory.testnet", 1);
        q.ft_burn(U128(held - 1), None);
    }), "a burn may not leave one unit of supply");
    assert!(catches(|| {
        c.ctx("mallory.testnet", 1);
        q.redeem(U128(held - 1), Some("near_queue".into()), None);
    }), "a redeem may not leave one unit of supply");
    // Leaving a whole QGOLD is allowed: R is then bounded by backing / 1 QGOLD.
    c.call("mallory.testnet", 1, || q.ft_burn(U128(held - ONE), None));
    let st = state(&c, &q);
    assert_eq!(num(&st, "supply"), ONE);
    assert_eq!(num(&st, "rate"), num(&st, "backing"));
    // A 0.01 NEAR coin still mints a positive amount at that R.
    let n = c.call("rewards.testnet", 10 * MILLI, || q.mint_for(a("alice.testnet"), None));
    assert!(n.0 > 0);
}

/// H1: once nobody holds QGOLD, the peak reached by burns is not kept as the
/// price for the next minter; the backing already went to insurance.
#[test]
fn r_peak_returns_to_the_initial_rate_once_nobody_holds_qgold() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("bob.testnet"), None));
    c.call("bob.testnet", 1, || q.ft_burn(U128(100 * ONE), None));
    assert_eq!(num(&state(&c, &q), "r_peak"), 2 * MILLI);
    let r = c.call("alice.testnet", 1, || q.redeem(U128(100 * ONE), None, None));
    assert_eq!(r.status, "paid");
    let st = state(&c, &q);
    assert_eq!(num(&st, "supply"), 0);
    assert_eq!(num(&st, "backing"), 0);
    assert_eq!(num(&st, "r_peak"), MILLI, "no holder left: the peak returns to the initial rate");
    assert_eq!(num(&st, "rate"), MILLI);
    let n = c.call("rewards.testnet", 10 * MILLI, || q.mint_for(a("carol.testnet"), None));
    assert_eq!(n.0, 10 * ONE, "the next coin mints at the initial rate, not at the dust peak");
    c.ctx("v.testnet", 0);
    assert!(q.audit()["ok"].as_bool().unwrap());
}

/// H2: storage that outgrows the operating balance freezes the vault, but
/// `reconcile` must not book it as a loss against insurance or backing.
#[test]
fn storage_growth_is_never_booked_as_a_loss_and_fund_operating_unfreezes() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("alice.testnet", 10 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    c.call("council.testnet", 2 * NEAR, || q.fund_insurance());
    // The operating slack is gone and the storage cost exceeds the balance by
    // 0.05 NEAR, while every NEAR that is owed is still there.
    let slack = c.slack(&q);
    c.bal -= slack + 50 * MILLI;
    let e = c.fails("alice.testnet", 1, || {
        q.redeem(U128(ONE), None, None);
    });
    assert!(e.contains("Invariant"), "frozen while the storage is not covered: {e}");
    // (The mock keeps the writes of the failed call; read the books after it.)
    let st = state(&c, &q);
    let (insurance, backing, rate) = (num(&st, "insurance"), num(&st, "backing"), num(&st, "rate"));
    let out = c.call("anyone.testnet", 0, || q.reconcile());
    assert_eq!(out["shortfall"].as_str().unwrap(), "0", "no money is missing");
    assert!(num(&out, "storage_shortfall") > 0);
    let st = state(&c, &q);
    assert_eq!(num(&st, "insurance"), insurance, "insurance untouched");
    assert_eq!(num(&st, "backing"), backing, "backing untouched");
    assert_eq!(num(&st, "rate"), rate);
    assert_eq!(num(&st, "losses_total"), 0);
    let e = c.fails("alice.testnet", 1, || {
        q.redeem(U128(ONE), None, None);
    });
    assert!(e.contains("Invariant"), "still frozen: reconcile cannot create NEAR: {e}");
    c.call("ops.testnet", NEAR, || q.fund_operating());
    let r = c.call("alice.testnet", 1, || q.redeem(U128(ONE), None, None));
    assert_eq!(r.status, "paid");
    c.ctx("v.testnet", 0);
    assert!(q.audit()["ok"].as_bool().unwrap());
}

/// H2: a queued exit record is paid by a bond held out of the exit until the
/// claim, so 560 dust exits from sybils cannot eat the operating slack.
#[test]
fn queued_exits_pay_for_their_own_storage_until_claimed() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let whale = format!("{}.testnet", "w".repeat(56)); // 64-byte account id
    c.call(&whale, 100 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    let held = q.ft_balance_of(a(&whale)).0;
    let slack0 = c.slack(&q);
    let storage0 = c.storage;
    let r = c.call(&whale, 1, || q.redeem(U128(held / 2), Some("near_queue".into()), None));
    assert_eq!(r.status, "queued");
    let record_cost = (c.storage - storage0) as u128 * 10u128.pow(19);
    assert!(EXIT_STORAGE_BOND >= record_cost, "bond {EXIT_STORAGE_BOND} must cover the record ({record_cost})");
    let st = state(&c, &q);
    assert_eq!(num(&st["exit"], "queue_bonds"), EXIT_STORAGE_BOND);
    assert_eq!(num(&st["exit"], "queue_pending"), r.gross.0 - EXIT_STORAGE_BOND);
    assert!(c.slack(&q) >= slack0, "an open exit must not reduce the operating slack");
    c.hours(24);
    let paid = c.call("anyone.testnet", 0, || q.claim_exit(r.exit_id.unwrap()));
    assert_eq!(paid.0, r.amount.0, "the bond comes back with the claim");
    let st = state(&c, &q);
    assert_eq!(num(&st["exit"], "queue_pending"), 0);
    assert_eq!(num(&st["exit"], "queue_bonds"), 0);
    assert!(c.slack(&q) >= slack0);
    c.ctx("v.testnet", 0);
    assert!(q.audit()["ok"].as_bool().unwrap());
}

#[test]
#[should_panic(expected = "storage bond")]
fn dust_exits_cannot_be_queued() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("whale.testnet", 100 * NEAR + STORAGE_FEE, || q.deposit(None, None));
    // 2 QGOLD = 0.002 NEAR: above MIN_REDEEM, below the bond.
    c.call("whale.testnet", 1, || q.redeem(U128(2 * ONE), Some("near_queue".into()), None));
}

/// H2: a failed instant payout smaller than the bond is re-queued fee-free with
/// the whole amount bonded, and the claim still pays it in full.
#[test]
fn a_small_failed_payout_is_bonded_in_full_and_paid_in_full() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let r = c.call("alice.testnet", 1, || q.redeem(U128(2 * ONE), None, None));
    assert_eq!(r.status, "paid");
    c.bal += r.amount.0;
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("qgold.questlayer.testnet"))
        .predecessor_account_id(a("qgold.questlayer.testnet"))
        .account_balance(NearToken::from_yoctonear(c.bal))
        .storage_usage(c.storage)
        .block_timestamp(c.now_ms * 1_000_000);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    assert!(!q.on_payout(a("alice.testnet"), r.amount, r.qgold));
    c.storage = env::storage_usage();
    let st = state(&c, &q);
    assert_eq!(num(&st["exit"], "queue_pending"), 0);
    assert_eq!(num(&st["exit"], "queue_bonds"), r.amount.0);
    let exits = q.get_account_exits(a("alice.testnet"));
    let paid = c.call("bob.testnet", 0, || q.claim_exit(U64(exits[0].id)));
    assert_eq!(paid.0, r.amount.0);
}

/// H2: contract-paid storage (sponsored holder records, conversion receipts)
/// stops before the operating slack is gone instead of freezing the vault.
#[test]
fn sponsored_storage_stops_before_the_operating_slack_is_gone() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let unit = MILLI / ONE;
    let receipt = c.call("rewards.testnet", 10 * MILLI, || q.mint_with_carry_for(a("alice.testnet"), Some("world-1".into())));
    assert_eq!(receipt["ts"].as_u64().unwrap(), c.now_ms);
    // The receipt can be pruned by anyone, but only after its retention window.
    let e = c.fails("anyone.testnet", 0, || q.prune_game_conversion(a("rewards.testnet"), "world-1".into()));
    assert!(e.contains("retention"), "{e}");
    c.hours(30 * 24);
    let before = c.storage;
    c.call("anyone.testnet", 0, || q.prune_game_conversion(a("rewards.testnet"), "world-1".into()));
    assert!(c.storage < before);
    c.ctx("v.testnet", 0);
    assert!(q.get_game_conversion(a("rewards.testnet"), "world-1".into()).is_none());
    // Leave just the minimum slack plus less than one holder record costs.
    let slack = c.slack(&q);
    c.bal -= slack - MIN_OPERATING_SLACK - 500 * unit;
    // An existing holder still receives coins: no new storage is sponsored.
    let n = c.call("rewards.testnet", 10 * MILLI, || q.mint_for(a("alice.testnet"), None));
    assert_eq!(n.0, 10 * ONE);
    // Exits keep working (their records are bonded or paid by the holder).
    let r = c.call("alice.testnet", 1, || q.redeem(U128(ONE), None, None));
    assert_eq!(r.status, "paid");
    let e = c.fails("rewards.testnet", 10 * MILLI, || {
        q.mint_for(a("bob.testnet"), None);
    });
    assert!(e.contains("Operating balance is low"), "a new sponsored holder record would take the slack below the minimum: {e}");
    let e = c.fails("rewards.testnet", 10 * MILLI, || {
        q.mint_with_carry_for(a("alice.testnet"), Some("world-2".into()));
    });
    assert!(e.contains("Operating balance is low"), "a conversion receipt is contract-paid storage too: {e}");
    // The operating balance is refilled explicitly and sponsored storage resumes.
    c.call("ops.testnet", NEAR, || q.fund_operating());
    let n = c.call("rewards.testnet", 10 * MILLI, || q.mint_for(a("carol.testnet"), None));
    assert_eq!(n.0, 10 * ONE);
    let receipt = c.call("rewards.testnet", 10 * MILLI, || q.mint_with_carry_for(a("alice.testnet"), Some("world-3".into())));
    assert_eq!(num(&receipt, "qgoldU"), 10 * ONE);
}

/// H2: the per-account instant window record is freed with the holder record.
#[test]
fn unregister_frees_the_instant_window_record() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("rewards.testnet", 100 * MILLI, || q.mint_for(a("alice.testnet"), None));
    let storage0 = c.storage;
    c.call("bob.testnet", NEAR + STORAGE_FEE, || q.deposit(None, None));
    let r = c.call("bob.testnet", 1, || q.redeem(U128(10 * ONE), None, None));
    assert_eq!(r.status, "paid");
    let rest = q.ft_balance_of(a("bob.testnet")).0;
    c.call("bob.testnet", 1, || q.ft_burn(U128(rest), None));
    assert!(c.call("bob.testnet", 1, || q.storage_unregister(None)));
    assert_eq!(c.storage, storage0, "holder and window records are both gone");
}

/// H3: a single council member cannot veto the rest of the council.
#[test]
fn one_member_cannot_cancel_another_members_proposal() {
    let mut c = Chain::new();
    let mut q = council3(&mut c);
    let id = c.call("c1.testnet", 0, || q.propose(Action::SetGuardian { account_id: a("g2.testnet") }));
    c.call("c2.testnet", 0, || q.cancel(id));
    c.ctx("v.testnet", 0);
    assert!(!q.get_proposal(id).unwrap().done, "one of three is below the threshold of two");
    assert_eq!(q.get_cancel_votes(id), vec![a("c2.testnet")]);
    c.call("c2.testnet", 0, || q.cancel(id));
    c.ctx("v.testnet", 0);
    assert!(!q.get_proposal(id).unwrap().done, "voting twice counts once");
    c.call("c3.testnet", 0, || q.cancel(id));
    c.ctx("v.testnet", 0);
    assert!(q.get_proposal(id).unwrap().done);
    assert!(q.get_cancel_votes(id).is_empty());
    // The rogue cannot block the council from removing it either.
    let id = c.call("c1.testnet", 0, || q.propose(Action::SetCouncil { members: vec![a("c1.testnet"), a("c3.testnet")], threshold: 2 }));
    c.call("c2.testnet", 0, || q.cancel(id));
    c.call("c3.testnet", 0, || q.approve(id));
    c.hours(48);
    c.call("anyone.testnet", 0, || q.execute(id));
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_config()["council"].as_array().unwrap().len(), 2);
}

#[test]
fn the_proposer_can_withdraw_their_own_proposal() {
    let mut c = Chain::new();
    let mut q = council3(&mut c);
    let id = c.call("c1.testnet", 0, || q.propose(Action::SetGuardian { account_id: a("g2.testnet") }));
    c.call("c1.testnet", 0, || q.cancel(id));
    c.ctx("v.testnet", 0);
    assert!(q.get_proposal(id).unwrap().done);
}

/// H3: one key cannot keep the vault paused by renewing before every expiry.
#[test]
#[should_panic(expected = "paused recently")]
fn the_same_account_cannot_renew_a_pause() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    c.call("guardian.testnet", 0, || q.pause());
    c.hours(71);
    c.call("guardian.testnet", 0, || q.pause());
}

#[test]
fn unpause_needs_the_threshold_and_another_account_can_still_pause() {
    let mut c = Chain::new();
    let mut q = council3(&mut c);
    c.call("guardian.testnet", 0, || q.pause());
    c.call("c1.testnet", 0, || q.unpause());
    assert!(state(&c, &q)["paused"].as_bool().unwrap(), "one vote of two does not end an incident pause");
    c.call("c2.testnet", 0, || q.unpause());
    assert!(!state(&c, &q)["paused"].as_bool().unwrap());
    // A second incident within the cooldown: another member pauses.
    c.hours(1);
    assert!(catches(|| {
        c.ctx("guardian.testnet", 0);
        q.pause();
    }));
    c.call("c1.testnet", 0, || q.pause());
    assert!(state(&c, &q)["paused"].as_bool().unwrap());
    // It expires by itself, and after the cooldown the guardian can pause again.
    c.hours(72);
    assert!(!state(&c, &q)["paused"].as_bool().unwrap());
    c.hours(7 * 24);
    c.call("guardian.testnet", 0, || q.pause());
    assert!(state(&c, &q)["paused"].as_bool().unwrap());
}

// ------------------------------------------------------------- council timelock

fn timelock_of(c: &Chain, q: &QGold) -> u64 {
    c.ctx("v.testnet", 0);
    q.get_config()["timelock_ms"].as_str().unwrap().parse().unwrap()
}

/// Proposes and executes `SetTimelock` under the timelock currently in force.
fn set_timelock(c: &mut Chain, q: &mut QGold, ms: u64) {
    let wait = timelock_of(c, q);
    let id = c.call("council.testnet", 0, || q.propose(Action::SetTimelock { timelock_ms: U64(ms) }));
    c.now_ms += wait;
    c.call("anyone.testnet", 0, || q.execute(id));
}

#[test]
fn timelock_defaults_to_48h_when_unset() {
    let mut c = Chain::new();
    let q = fresh(&mut c);
    assert_eq!(timelock_of(&c, &q), 48 * HOUR_MS);
    c.ctx("v.testnet", 0);
    let cfg = q.get_config();
    assert_eq!(cfg["default_timelock_ms"], (48 * HOUR_MS).to_string());
    assert_eq!(cfg["timelock_bounds_ms"][0], MIN_TESTNET_TIMELOCK_MS.to_string());
    assert!(!env::storage_has_key(b"council-timelock-ms"));
}

#[test]
fn testnet_timelock_can_drop_to_ten_minutes_and_back() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    set_timelock(&mut c, &mut q, 10 * 60_000);
    assert_eq!(timelock_of(&c, &q), 10 * 60_000);
    // Back to the default clears the stored key.
    set_timelock(&mut c, &mut q, 48 * HOUR_MS);
    assert_eq!(timelock_of(&c, &q), 48 * HOUR_MS);
    c.ctx("v.testnet", 0);
    assert!(!env::storage_has_key(b"council-timelock-ms"));
}

#[test]
fn testnet_timelock_bounds_are_ten_minutes_to_48h() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let short = c.fails("council.testnet", 0, || {
        q.propose(Action::SetTimelock { timelock_ms: U64(10 * 60_000 - 1) });
    });
    assert!(short.contains("timelock_ms must be"), "{short}");
    let long = c.fails("council.testnet", 0, || {
        q.propose(Action::SetTimelock { timelock_ms: U64(48 * HOUR_MS + 1) });
    });
    assert!(long.contains("timelock_ms must be"), "{long}");
}

#[test]
fn non_testnet_account_keeps_at_least_24h() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let mainnet = |c: &Chain| {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("qgold.questlayer.near"))
            .predecessor_account_id(a("council.testnet"))
            .account_balance(NearToken::from_yoctonear(c.bal))
            .storage_usage(c.storage)
            .block_timestamp(c.now_ms * 1_000_000);
        testing_env!(b.build());
    };
    mainnet(&c);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        q.propose(Action::SetTimelock { timelock_ms: U64(10 * 60_000) });
    }));
    assert!(r.is_err(), "10 min is testnet only");
    mainnet(&c);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        q.propose(Action::SetTimelock { timelock_ms: U64(24 * HOUR_MS - 1) });
    }));
    assert!(r.is_err(), "below 24 h is refused off testnet");
    mainnet(&c);
    let id = q.propose(Action::SetTimelock { timelock_ms: U64(24 * HOUR_MS) });
    assert_eq!(q.get_config()["timelock_bounds_ms"][0], (24 * HOUR_MS).to_string());
    assert_eq!(q.get_proposal(id).unwrap().executable_at.0, c.now_ms + 48 * HOUR_MS);
}

#[test]
fn executable_at_uses_the_timelock_in_force_when_proposed() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    let lower = c.call("council.testnet", 0, || q.propose(Action::SetTimelock { timelock_ms: U64(30 * 60_000) }));
    c.hours(1);
    // Proposed under 48 h: lowering the timelock later does not speed it up.
    let old = c.call("council.testnet", 0, || q.propose(Action::SetGuardian { account_id: a("g2.testnet") }));
    let old_at = c.now_ms + 48 * HOUR_MS;
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_proposal(old).unwrap().executable_at.0, old_at);
    c.hours(47);
    c.call("anyone.testnet", 0, || q.execute(lower));
    assert_eq!(timelock_of(&c, &q), 30 * 60_000);
    assert!(c.now_ms < old_at);
    let early = c.fails("anyone.testnet", 0, || q.execute(old));
    assert!(early.contains("Timelock"), "{early}");
    // A new proposal waits only the new 30 min.
    let new = c.call("council.testnet", 0, || q.propose(Action::SetTreasury { account_id: a("t2.testnet") }));
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_proposal(new).unwrap().executable_at.0, c.now_ms + 30 * 60_000);
    c.now_ms += 30 * 60_000 - 1;
    let early = c.fails("anyone.testnet", 0, || q.execute(new));
    assert!(early.contains("Timelock"), "{early}");
    c.now_ms += 1;
    c.call("anyone.testnet", 0, || q.execute(new));
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_config()["treasury"], "t2.testnet");
    // The older proposal still runs at its own executable_at.
    c.now_ms = old_at;
    c.call("anyone.testnet", 0, || q.execute(old));
    c.ctx("v.testnet", 0);
    assert_eq!(q.get_config()["guardian"], "g2.testnet");
}

#[test]
fn a_short_upgrade_timelock_still_needs_the_approved_code_and_migrate_keeps_it() {
    let mut c = Chain::new();
    let mut q = fresh(&mut c);
    set_timelock(&mut c, &mut q, 10 * 60_000);
    let hash: String = env::sha256(b"good code").iter().map(|b| format!("{b:02x}")).collect();
    let id = c.call("council.testnet", 0, || q.propose(Action::Upgrade { code_sha256: hash }));
    c.now_ms += 10 * 60_000;
    let _ = c.call("anyone.testnet", 0, || q.apply_upgrade(id, Base64VecU8(b"good code".to_vec())));
    // The root state is unchanged, so migrate() reads it back and the
    // namespaced timelock survives the code swap.
    c.ctx("qgold.questlayer.testnet", 0);
    env::state_write(&q);
    let m = QGold::migrate();
    assert_eq!(timelock_of(&c, &m), 10 * 60_000);
    c.ctx("v.testnet", 0);
    assert!(m.get_proposal(id).unwrap().done);
    assert_eq!(m.get_config()["council"][0], "council.testnet");
}
