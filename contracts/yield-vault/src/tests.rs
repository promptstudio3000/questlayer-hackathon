use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

const USDC: &str = "usdc.fakes.testnet";
const STNEAR: &str = "meta-v2.pool.testnet";
const USD: u128 = 1_000_000;
const DAY: u64 = 24 * HOUR_MS;

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx_full(who: &str, ms: u64, block: u64, deposit: u128, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("yield.testnet"))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .block_timestamp(ms * 1_000_000)
        .block_height(block)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        results
    );
}
fn ctx(who: &str, ms: u64) {
    ctx_full(who, ms, 100, 0, vec![]);
}
fn cb(ms: u64, results: Vec<PromiseResult>) {
    ctx_full("yield.testnet", ms, 100, 0, results);
}
fn ok<T: near_sdk::serde::Serialize>(v: T) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&v).unwrap())
}
fn fail() -> PromiseResult {
    PromiseResult::Failed
}
fn setup() -> YieldVault {
    ctx("owner.testnet", 0);
    let mut v = YieldVault::new(a("owner.testnet"), a("treasury.testnet"));
    v.add_token(a(USDC), true);
    v.add_token(a(STNEAR), false);
    v
}
fn token<'a>(v: &'a YieldVault, id: &str) -> &'a Token {
    v.find(&a(id)).unwrap()
}
fn deposit_usdc(v: &mut YieldVault, who: &str, amount: u128, ms: u64) {
    ctx(USDC, ms);
    let r = v.ft_on_transfer(a(who), U128(amount), "deposit".into());
    assert!(matches!(r, PromiseOrValue::Value(U128(0))));
}
fn deposit_st(v: &mut YieldVault, who: &str, amount: u128, price: u128, ms: u64) -> U128 {
    ctx(STNEAR, ms);
    let _ = v.ft_on_transfer(a(who), U128(amount), "deposit".into());
    cb(ms, vec![ok(U128(price))]);
    v.on_lst_deposit(a(STNEAR), a(who), U128(amount))
}
fn withdraw(v: &mut YieldVault, who: &str, token: &str, amount: u128, ms: u64) -> PromiseOrValue<bool> {
    ctx_full(who, ms, 100, 1, vec![]);
    v.withdraw(a(token), U128(amount))
}
fn asset(supplied: u128, borrowed: u128, reserved: u128, can_deposit: bool) -> Value {
    json!({
        "supplied": { "shares": "0", "balance": U128(supplied) },
        "borrowed": { "shares": "0", "balance": U128(borrowed) },
        "reserved": U128(reserved),
        "prot_fee": "0",
        "config": { "extra_decimals": 12, "can_deposit": can_deposit, "can_withdraw": true }
    })
}
fn rhea_account(usdc_inner: u128) -> Value {
    json!({ "account_id": "yield.testnet",
        "supplied": [ { "token_id": USDC, "balance": U128(usdc_inner), "shares": "0", "apr": "0" } ] })
}
const E12: u128 = 1_000_000_000_000;

#[test]
fn deposit_counts_at_once_and_unlocks_after_24h() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 100 * USD, 1_000);
    ctx("anyone.testnet", 1_000);
    let p = &v.get_position(a("alice.testnet"))[0];
    assert_eq!(p["principal"], "100000000");
    assert_eq!(p["withdrawable"], "0");
    assert_eq!(p["tranches"][0]["locked_until_ms"], (1_000 + DAY).to_string());
    ctx("anyone.testnet", 1_000 + DAY);
    assert_eq!(v.get_position(a("alice.testnet"))[0]["withdrawable"], "100000000");
}

#[test]
#[should_panic(expected = "Amount is locked")]
fn locked_tranche_cannot_be_withdrawn() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 100 * USD, 0);
    let _ = withdraw(&mut v, "alice.testnet", USDC, USD, DAY - 1);
}

#[test]
fn lock_change_is_not_retroactive_and_tranches_unlock_separately() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 10 * USD, 0);
    ctx("owner.testnet", 1);
    v.set_lock_hours(48);
    deposit_usdc(&mut v, "alice.testnet", 20 * USD, 10);
    ctx("anyone.testnet", DAY);
    let p = &v.get_position(a("alice.testnet"))[0];
    assert_eq!(p["withdrawable"], "10000000");
    assert_eq!(p["principal"], "30000000");
    assert_eq!(p["tranches"].as_array().unwrap().len(), 1);
}

#[test]
#[should_panic(expected = "Unknown message")]
fn other_messages_are_refunded() {
    let mut v = setup();
    ctx(USDC, 0);
    let _ = v.ft_on_transfer(a("alice.testnet"), U128(USD), "".into());
}

#[test]
#[should_panic(expected = "Token not allowlisted")]
fn unknown_token_is_refused() {
    let mut v = setup();
    ctx("evil.testnet", 0);
    let _ = v.ft_on_transfer(a("alice.testnet"), U128(USD), "deposit".into());
}

#[test]
#[should_panic(expected = "Token not allowlisted")]
fn owner_cannot_add_arbitrary_token() {
    let mut v = setup();
    ctx("owner.testnet", 0);
    v.add_token(a("evil.testnet"), false);
}

#[test]
#[should_panic(expected = "Account cap reached")]
fn account_cap_is_enforced() {
    let mut v = setup();
    ctx("owner.testnet", 0);
    v.set_token_limits(a(USDC), U128(1_000 * USD), U128(50 * USD), U128(USD), 2_000, 9_500, 10, true);
    deposit_usdc(&mut v, "alice.testnet", 40 * USD, 0);
    deposit_usdc(&mut v, "alice.testnet", 20 * USD, 0);
}

#[test]
fn stable_withdraw_returns_exact_principal_and_failed_transfer_restores() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 100 * USD, 0);
    let _ = withdraw(&mut v, "alice.testnet", USDC, 60 * USD, DAY);
    assert_eq!(token(&v, USDC).idle, 40 * USD);
    assert_eq!(token(&v, USDC).outgoing, 60 * USD);
    cb(DAY, vec![fail()]);
    assert!(!v.on_paid(a(USDC), a("alice.testnet"), U128(60 * USD), U128(60 * USD)));
    let t = token(&v, USDC);
    assert_eq!((t.idle, t.outgoing, t.principal), (100 * USD, 0, 100 * USD));
    ctx("x.testnet", DAY);
    assert_eq!(v.get_position(a("alice.testnet"))[0]["withdrawable"], "100000000");
    let _ = withdraw(&mut v, "alice.testnet", USDC, 100 * USD, DAY);
    cb(DAY, vec![ok(())]);
    assert!(v.on_paid(a(USDC), a("alice.testnet"), U128(100 * USD), U128(100 * USD)));
    ctx("x.testnet", DAY);
    assert!(v.get_position(a("alice.testnet")).is_empty());
    assert_eq!(token(&v, USDC).principal, 0);
}

#[test]
fn rebalance_supplies_above_buffer_only_when_pool_not_full() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 1_000 * USD, 0);
    // 96 % utilized: nothing is supplied.
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(1, vec![ok(asset(100 * E12 * USD, 96 * E12 * USD, 0, true)), ok(Value::Null)]);
    assert!(matches!(v.on_rebalance(a(USDC), U64(n)), PromiseOrValue::Value(false)));
    assert_eq!(token(&v, USDC).idle, 1_000 * USD);
    // 50 % utilized: supply everything above the 20 % buffer.
    ctx("keeper.testnet", 2);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(2, vec![ok(asset(100 * E12 * USD, 50 * E12 * USD, 0, true)), ok(Value::Null)]);
    assert!(matches!(v.on_rebalance(a(USDC), U64(n)), PromiseOrValue::Promise(_)));
    assert_eq!(token(&v, USDC).idle, 200 * USD);
    assert_eq!(token(&v, USDC).outgoing, 800 * USD);
    // Rhea kept 800.
    cb(3, vec![ok(U128(800 * USD))]);
    assert!(v.on_supplied(a(USDC), U64(n), U128(800 * USD)));
    let t = token(&v, USDC);
    assert_eq!((t.idle, t.outgoing, t.op), (200 * USD, 0, 0));
}

#[test]
fn refused_supply_returns_to_idle() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 1_000 * USD, 0);
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(1, vec![ok(asset(100 * E12 * USD, 0, 0, true)), ok(Value::Null)]);
    let _ = v.on_rebalance(a(USDC), U64(n));
    cb(1, vec![fail()]);
    assert!(!v.on_supplied(a(USDC), U64(n), U128(800 * USD)));
    assert_eq!(token(&v, USDC).idle, 1_000 * USD);
}

#[test]
#[should_panic(expected = "Stale callback")]
fn stale_callback_is_rejected() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 1_000 * USD, 0);
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(1, vec![ok(asset(100 * E12 * USD, 0, 0, true)), ok(Value::Null)]);
    let _ = v.on_rebalance(a(USDC), U64(n + 1));
}

#[test]
#[should_panic(expected = "Another keeper operation")]
fn one_keeper_operation_per_token() {
    let mut v = setup();
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    let _ = v.harvest(a(USDC));
}

/// Supplies 800 of 1000 USDC to Rhea and returns the vault.
fn supplied_vault() -> YieldVault {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 1_000 * USD, 0);
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(1, vec![ok(asset(100 * E12 * USD, 0, 0, true)), ok(Value::Null)]);
    let _ = v.on_rebalance(a(USDC), U64(n));
    cb(1, vec![ok(U128(800 * USD))]);
    v.on_supplied(a(USDC), U64(n), U128(800 * USD));
    v
}

#[test]
fn harvest_takes_only_interest_above_principal_and_safety() {
    let mut v = supplied_vault();
    // Rhea shows 810 USDC: 10 USDC interest. Safety 0.1 % of 1000 = 1 USDC.
    ctx("keeper.testnet", 5);
    let _ = v.harvest(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(5, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(810 * USD * E12))]);
    assert!(matches!(v.on_harvest(a(USDC), U64(n)), PromiseOrValue::Promise(_)));
    let t = token(&v, USDC);
    let paid = 9 * USD - 1;
    assert_eq!((t.idle, t.outgoing, t.harvested), (200 * USD - paid, paid, paid));
    cb(5, vec![ok(())]);
    assert!(v.on_harvest_paid(a(USDC), U64(n), U128(paid)));
    // Principal is still fully backed: idle + Rhea - harvested interest.
    let t = token(&v, USDC);
    assert!(t.idle + 810 * USD - 0 >= t.principal + bps(t.principal, t.safety_bps));
}

#[test]
fn harvest_with_no_interest_pays_nothing() {
    let mut v = supplied_vault();
    ctx("keeper.testnet", 5);
    let _ = v.harvest(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(5, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(800 * USD * E12))]);
    assert!(matches!(v.on_harvest(a(USDC), U64(n)), PromiseOrValue::Value(false)));
    assert_eq!(token(&v, USDC).op, 0);
    assert_eq!(token(&v, USDC).idle, 200 * USD);
}

#[test]
fn failed_rhea_read_harvests_nothing() {
    let mut v = supplied_vault();
    ctx("keeper.testnet", 5);
    let _ = v.harvest(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(5, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), fail()]);
    assert!(matches!(v.on_harvest(a(USDC), U64(n)), PromiseOrValue::Value(false)));
}

#[test]
fn queue_when_buffer_short_then_rhea_refill_and_advance() {
    let mut v = supplied_vault();
    // 500 > 200 on hand: queued.
    assert!(matches!(withdraw(&mut v, "alice.testnet", USDC, 500 * USD, DAY), PromiseOrValue::Value(false)));
    let t = token(&v, USDC);
    assert_eq!((t.queued, t.principal, t.q_tail - t.q_head), (500 * USD, 500 * USD, 1));
    ctx("x.testnet", DAY);
    assert_eq!(v.get_position(a("alice.testnet"))[0]["queued"], "500000000");
    assert_eq!(v.advance(a(USDC)), 0);
    // Rebalance withdraws: target = 500 queued + 20 % of 1000 = 700, idle 200 -> 500.
    ctx("keeper.testnet", DAY);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(DAY, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(800 * USD * E12))]);
    assert!(matches!(v.on_rebalance(a(USDC), U64(n)), PromiseOrValue::Promise(_)));
    cb(DAY, vec![ok(())]);
    assert!(v.on_rhea_withdraw(a(USDC), U64(n), U128(500 * USD), U128((800 - 250) * USD * E12)));
    assert_eq!(token(&v, USDC).inbound, 500 * USD);
    assert_eq!(token(&v, USDC).idle, 200 * USD);
    let late = 100 + INBOUND_SETTLE_BLOCKS + 1;
    ctx_full("keeper.testnet", DAY, late, 0, vec![]);
    let _ = v.confirm_inbound(a(USDC));
    let n = token(&v, USDC).op_nonce;
    // Rhea shows our supply down to 300 (+ a little interest): the tokens left Rhea.
    ctx_full("yield.testnet", DAY, late, 0, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(300 * USD * E12 + 5))]);
    assert!(v.on_confirm(a(USDC), U64(n)));
    assert_eq!(token(&v, USDC).idle, 700 * USD);
    assert_eq!(token(&v, USDC).inbound, 0);
    ctx("keeper.testnet", DAY);
    assert_eq!(v.advance(a(USDC)), 1);
    let t = token(&v, USDC);
    assert_eq!((t.idle, t.outgoing, t.queued), (200 * USD, 500 * USD, 0));
    ctx("x.testnet", DAY);
    assert_eq!(v.get_position(a("alice.testnet"))[0]["queued"], "0");
}

#[test]
fn bounced_rhea_withdrawal_is_forgotten_after_settle_window() {
    let mut v = supplied_vault();
    let _ = withdraw(&mut v, "alice.testnet", USDC, 500 * USD, DAY);
    ctx("keeper.testnet", DAY);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(DAY, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(800 * USD * E12))]);
    let _ = v.on_rebalance(a(USDC), U64(n));
    cb(DAY, vec![ok(())]);
    v.on_rhea_withdraw(a(USDC), U64(n), U128(500 * USD), U128((800 - 250) * USD * E12));
    let late = 100 + INBOUND_SETTLE_BLOCKS + 1;
    ctx_full("keeper.testnet", DAY, late, 0, vec![]);
    let _ = v.confirm_inbound(a(USDC));
    let n = token(&v, USDC).op_nonce;
    // Rhea restored our supply (transfer bounced): nothing is credited, even
    // though a donation makes our token balance look big enough.
    ctx_full("yield.testnet", DAY, late, 0, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(800 * USD * E12 + 9))]);
    assert!(!v.on_confirm(a(USDC), U64(n)));
    let t = token(&v, USDC);
    assert_eq!((t.inbound, t.idle), (0, 200 * USD));
}

#[test]
fn stale_payment_callback_still_settles_money() {
    let mut v = supplied_vault();
    ctx("keeper.testnet", 10);
    let _ = v.harvest(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(10, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(900 * USD * E12))]);
    let _ = v.on_harvest(a(USDC), U64(n));
    let paid = token(&v, USDC).outgoing;
    ctx("keeper.testnet", 10 + OP_TIMEOUT_MS);
    v.reset_op(a(USDC));
    let _ = v.rebalance(a(USDC));
    cb(10 + OP_TIMEOUT_MS, vec![fail()]);
    assert!(!v.on_harvest_paid(a(USDC), U64(n), U128(paid)));
    let t = token(&v, USDC);
    assert_eq!((t.idle, t.outgoing, t.harvested, t.op), (200 * USD, 0, 0, OP_REBALANCE));
}

#[test]
#[should_panic(expected = "Below minimum withdrawal")]
fn dust_withdrawals_are_refused() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 10 * USD, 0);
    let _ = withdraw(&mut v, "alice.testnet", USDC, 1, DAY);
}

#[test]
#[should_panic(expected = "already queued")]
fn one_queued_withdrawal_per_account() {
    let mut v = supplied_vault();
    let _ = withdraw(&mut v, "alice.testnet", USDC, 300 * USD, DAY);
    let _ = withdraw(&mut v, "alice.testnet", USDC, 300 * USD, DAY);
}

#[test]
fn lst_deposit_valued_at_protocol_price_and_withdraw_returns_value() {
    let mut v = setup();
    let near = NEAR;
    // 5 stNEAR at 1.2 NEAR = 6 NEAR of principal.
    assert_eq!(deposit_st(&mut v, "bob.testnet", 5 * near, 12 * near / 10, 0), U128(0));
    ctx("x.testnet", 0);
    assert_eq!(v.get_position(a("bob.testnet"))[0]["principal"], (6 * near).to_string());
    assert_eq!(token(&v, STNEAR).idle, 5 * near);
    // Price grows to 1.5: 6 NEAR is now 4 stNEAR; 1 stNEAR is surplus.
    let _ = withdraw(&mut v, "bob.testnet", STNEAR, 6 * near, DAY);
    assert_eq!(token(&v, STNEAR).pending, 6 * near);
    cb(DAY, vec![ok(U128(15 * near / 10))]);
    let _ = v.on_lst_withdraw(a(STNEAR), a("bob.testnet"), U128(6 * near));
    let t = token(&v, STNEAR);
    assert_eq!((t.idle, t.outgoing, t.pending), (near, 4 * near, 0));
}

#[test]
fn lst_harvest_skims_growth_only() {
    let mut v = setup();
    let near = NEAR;
    deposit_st(&mut v, "bob.testnet", 10 * near, near, 0);
    ctx("keeper.testnet", 1);
    let _ = v.harvest(a(STNEAR));
    let n = token(&v, STNEAR).op_nonce;
    // Price 1.25: owed 8 stNEAR + 0.1 % safety; surplus about 1.992.
    cb(1, vec![ok(U128(125 * near / 100))]);
    assert!(matches!(v.on_harvest(a(STNEAR), U64(n)), PromiseOrValue::Promise(_)));
    let t = token(&v, STNEAR);
    let owed = 8 * near;
    assert_eq!(t.idle, owed + owed / 1_000 + 1);
    // The player still gets full value: 10 NEAR = 8 stNEAR at 1.25.
    cb(1, vec![ok(())]);
    v.on_harvest_paid(a(STNEAR), U64(n), U128(t.harvested));
    let _ = withdraw(&mut v, "bob.testnet", STNEAR, 10 * near, DAY);
    cb(DAY, vec![ok(U128(125 * near / 100))]);
    let _ = v.on_lst_withdraw(a(STNEAR), a("bob.testnet"), U128(10 * near));
    assert_eq!(token(&v, STNEAR).outgoing, 8 * near);
}

#[test]
fn lst_loss_is_shared_pro_rata() {
    let mut v = setup();
    let near = NEAR;
    deposit_st(&mut v, "bob.testnet", 10 * near, near, 0);
    deposit_st(&mut v, "carol.testnet", 10 * near, near, 0);
    // Price falls to 0.9 (slashing): 20 stNEAR back 18 NEAR of 20 owed.
    let _ = withdraw(&mut v, "bob.testnet", STNEAR, 10 * near, DAY);
    cb(DAY, vec![ok(U128(9 * near / 10))]);
    let _ = v.on_lst_withdraw(a(STNEAR), a("bob.testnet"), U128(10 * near));
    // Pro-rata: half of 20 tokens, not 11.1 tokens.
    assert_eq!(token(&v, STNEAR).outgoing, 10 * near);
}

#[test]
fn lst_price_failure_refunds_deposit_and_restores_withdrawal() {
    let mut v = setup();
    ctx(STNEAR, 0);
    let _ = v.ft_on_transfer(a("bob.testnet"), U128(NEAR), "deposit".into());
    cb(0, vec![fail()]);
    assert_eq!(v.on_lst_deposit(a(STNEAR), a("bob.testnet"), U128(NEAR)), U128(NEAR));
    assert_eq!(token(&v, STNEAR).idle, 0);
    deposit_st(&mut v, "bob.testnet", NEAR, NEAR, 0);
    let _ = withdraw(&mut v, "bob.testnet", STNEAR, NEAR, DAY);
    cb(DAY, vec![fail()]);
    let _ = v.on_lst_withdraw(a(STNEAR), a("bob.testnet"), U128(NEAR));
    let t = token(&v, STNEAR);
    assert_eq!((t.principal, t.pending, t.idle), (NEAR, 0, NEAR));
    ctx("x.testnet", DAY);
    assert_eq!(v.get_position(a("bob.testnet"))[0]["withdrawable"], NEAR.to_string());
}

#[test]
fn lst_cap_over_limit_refunds_in_callback() {
    let mut v = setup();
    ctx("owner.testnet", 0);
    v.set_token_limits(a(STNEAR), U128(5 * NEAR), U128(5 * NEAR), U128(NEAR / 10), 2_000, 9_500, 10, false);
    assert_eq!(deposit_st(&mut v, "bob.testnet", 4 * NEAR, 2 * NEAR, 0), U128(4 * NEAR));
    assert_eq!(token(&v, STNEAR).principal, 0);
}

#[test]
fn withdrawals_work_while_deposits_paused() {
    let mut v = setup();
    deposit_usdc(&mut v, "alice.testnet", 10 * USD, 0);
    ctx("owner.testnet", 1);
    v.set_deposits_paused(true);
    assert!(matches!(withdraw(&mut v, "alice.testnet", USDC, 10 * USD, DAY), PromiseOrValue::Promise(_)));
}

#[test]
fn disabling_rhea_drains_it_back() {
    let mut v = supplied_vault();
    ctx("owner.testnet", 2);
    v.set_token_limits(a(USDC), U128(10_000 * USD), U128(1_000 * USD), U128(USD), 2_000, 9_500, 10, false);
    ctx("keeper.testnet", 3);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(3, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(805 * USD * E12))]);
    assert!(matches!(v.on_rebalance(a(USDC), U64(n)), PromiseOrValue::Promise(_)));
    cb(3, vec![ok(())]);
    v.on_rhea_withdraw(a(USDC), U64(n), U128(805 * USD), U128(805 * USD * E12 / 2));
    assert_eq!(token(&v, USDC).inbound, 805 * USD);
}

#[test]
fn rebalance_withdraw_limited_by_rhea_liquidity() {
    let mut v = supplied_vault();
    let _ = withdraw(&mut v, "alice.testnet", USDC, 500 * USD, DAY);
    ctx("keeper.testnet", DAY);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    // Rhea has only 100 USDC free (pool nearly fully borrowed).
    cb(DAY, vec![ok(asset(1_000 * E12 * USD, 900 * E12 * USD, 0, true)), ok(rhea_account(800 * USD * E12))]);
    let _ = v.on_rebalance(a(USDC), U64(n));
    cb(DAY, vec![ok(())]);
    v.on_rhea_withdraw(a(USDC), U64(n), U128(100 * USD), U128(750 * USD * E12));
    assert_eq!(token(&v, USDC).inbound, 100 * USD);
}

#[test]
#[should_panic(expected = "Operation still fresh")]
fn reset_op_needs_timeout() {
    let mut v = setup();
    ctx("keeper.testnet", 1);
    let _ = v.rebalance(a(USDC));
    ctx("keeper.testnet", 1 + OP_TIMEOUT_MS - 1);
    v.reset_op(a(USDC));
}

#[test]
#[should_panic(expected = "Owner only")]
fn only_owner_configures() {
    let mut v = setup();
    ctx("alice.testnet", 0);
    v.set_lock_hours(24);
}

#[test]
#[should_panic(expected = "Lock 24–48 h")]
fn lock_bounds() {
    let mut v = setup();
    ctx("owner.testnet", 0);
    v.set_lock_hours(72);
}

#[test]
#[should_panic(expected = "Testnet only")]
fn testnet_only() {
    ctx("owner.testnet", 0);
    let _ = YieldVault::new(a("owner.testnet"), a("treasury.near"));
}

#[test]
#[should_panic(expected = "still settling")]
fn confirm_waits_for_rhea_to_settle() {
    let mut v = supplied_vault();
    let _ = withdraw(&mut v, "alice.testnet", USDC, 500 * USD, DAY);
    ctx("keeper.testnet", DAY);
    let _ = v.rebalance(a(USDC));
    let n = token(&v, USDC).op_nonce;
    cb(DAY, vec![ok(asset(1_000 * E12 * USD, 0, 0, true)), ok(rhea_account(800 * USD * E12))]);
    let _ = v.on_rebalance(a(USDC), U64(n));
    cb(DAY, vec![ok(())]);
    v.on_rhea_withdraw(a(USDC), U64(n), U128(500 * USD), U128(550 * USD * E12));
    ctx_full("keeper.testnet", DAY, 105, 0, vec![]);
    let _ = v.confirm_inbound(a(USDC));
}
