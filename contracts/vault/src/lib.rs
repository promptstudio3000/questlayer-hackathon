use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env, ext_contract,
    json_types::{U128, U64},
    near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
const TGAS: u64 = 30;
const MAX_DEPOSIT: u128 = 1000 * 10u128.pow(24);
/// Smallest principal a partial exit may request or leave behind.
const MIN_POSITION: u128 = 10u128.pow(21);
const EXT_KEY: &[u8] = b"vault-ext-v2";
/// v2 additions live under their own storage key, so a deployed v1 vault is
/// upgraded by a plain code deploy: its `Vault` state layout is untouched.
#[derive(BorshDeserialize, BorshSerialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct Ext {
    /// Principal the owner asked to take out in the partial exit in flight.
    partial: u128,
    /// A contribution change waiting for the gain at the old rate to settle.
    pending_contribution: Option<u16>,
}
fn ext() -> Ext {
    env::storage_read(EXT_KEY)
        .map(|b| Ext::try_from_slice(&b).expect("Vault extension"))
        .unwrap_or_default()
}
fn save_ext(e: &Ext) {
    if e.partial == 0 && e.pending_contribution.is_none() {
        env::storage_remove(EXT_KEY);
    } else {
        env::storage_write(EXT_KEY, &near_sdk::borsh::to_vec(e).unwrap());
    }
}
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PoolAccount {
    account_id: AccountId,
    staked_balance: U128,
    unstaked_balance: U128,
    can_withdraw: bool,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Tranche {
    amount: u128,
    epoch: u64,
}
#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    beneficiary: AccountId,
    pool: AccountId,
    rewards: AccountId,
    contribution: u16,
    stage: String,
    nonce: u64,
    operation: String,
    amount: u128,
    cash_floor: u128,
    basis: u128,
    principal: u128,
    staked: u128,
    unstaked: u128,
    observed_epoch: u64,
    exit_requested: bool,
    unlock_epoch: u64,
    tranches: Vec<Tranche>,
    owner_credit: u128,
    owner_pending: u128,
    game_credit: u128,
    game_pending: u128,
    deposited: u128,
    owner_paid: u128,
    game_paid: u128,
    game_sequence: u64,
}
#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_deposit(&mut self, nonce: U64, amount: U128) -> bool;
    fn on_read(&mut self, nonce: U64, purpose: String) -> PromiseOrValue<bool>;
    fn on_unstake(&mut self, nonce: U64) -> bool;
    fn on_pool_withdraw(&mut self, nonce: U64) -> bool;
    fn on_owner_paid(&mut self, amount: U128) -> bool;
    fn on_game_paid(&mut self, amount: U128) -> bool;
}
#[near_bindgen]
impl Vault {
    #[init]
    pub fn new(
        beneficiary_id: AccountId,
        pool_id: AccountId,
        rewards_id: AccountId,
        contribution_bps: u16,
    ) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet")
                && rewards_id.as_str().ends_with(".testnet"),
            "Testnet only"
        );
        assert!(contribution_bps <= 10000, "Invalid contribution");
        // Deliberately fixed for this experimental release: no caller-supplied strategy.
        assert!(
            [
                "aurora.pool.f863973.m0",
                "stakely_v2.pool.f863973.m0",
                "ts.pool.f863973.m0"
            ]
            .contains(&pool_id.as_str()),
            "Pool not allowlisted"
        );
        Self {
            beneficiary: beneficiary_id,
            pool: pool_id,
            rewards: rewards_id,
            contribution: contribution_bps,
            stage: "idle".into(),
            nonce: 0,
            operation: String::new(),
            amount: 0,
            cash_floor: 0,
            basis: 0,
            principal: 0,
            staked: 0,
            unstaked: 0,
            observed_epoch: 0,
            exit_requested: false,
            unlock_epoch: 0,
            tranches: vec![],
            owner_credit: 0,
            owner_pending: 0,
            game_credit: 0,
            game_pending: 0,
            deposited: 0,
            owner_paid: 0,
            game_paid: 0,
            game_sequence: 0,
        }
    }
    #[payable]
    pub fn deposit_and_stake(&mut self) -> Promise {
        self.owner();
        self.idle();
        assert!(!self.exit_requested, "Exit queued");
        assert!(
            self.tranches.len() < 64,
            "Tranche limit; exit before adding more"
        );
        let amount = env::attached_deposit().as_yoctonear();
        assert!(
            amount >= 10u128.pow(21) && amount <= MAX_DEPOSIT,
            "Deposit range: 0.001–1000 test NEAR"
        );
        self.stage = "depositing".into();
        self.nonce += 1;
        self.pool_call(
            "deposit_and_stake",
            near_sdk::serde_json::json!({}),
            amount,
            TGAS,
        )
        .then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(TGAS))
                .on_deposit(U64(self.nonce), U128(amount)),
        )
    }
    #[private]
    pub fn on_deposit(&mut self, nonce: U64, amount: U128) -> bool {
        self.callback(nonce.0, "depositing");
        let ok = env::promise_result_checked(0, 1024).is_ok();
        if ok {
            self.basis += amount.0;
            self.principal += amount.0;
            self.staked += amount.0;
            self.deposited += amount.0;
            self.observed_epoch = env::epoch_height();
            if let Some(t) = self
                .tranches
                .last_mut()
                .filter(|t| t.epoch == env::epoch_height())
            {
                t.amount += amount.0;
            } else {
                self.tranches.push(Tranche {
                    amount: amount.0,
                    epoch: env::epoch_height(),
                });
            }
        } else {
            self.owner_credit += amount.0;
        }
        self.stage = "idle".into();
        ok
    }
    pub fn refresh(&mut self) -> Promise {
        self.idle();
        self.read("refresh")
    }
    /// No caller can choose a destination or spend the beneficiary's principal.
    pub fn harvest(&mut self) -> Promise {
        self.idle();
        assert!(
            !self.exit_requested && self.principal > 0,
            "No active stake"
        );
        self.read("harvest")
    }
    #[payable]
    pub fn request_exit(&mut self) -> PromiseOrValue<bool> {
        near_sdk::assert_one_yocto();
        self.owner();
        assert!(self.principal > 0, "No active stake");
        self.exit_requested = true;
        if self.stage == "idle" && self.owner_pending == 0 && self.game_pending == 0 {
            self.read("exit").into()
        } else {
            PromiseOrValue::Value(true)
        }
    }
    /// Takes `amount` of principal out and keeps the rest staked. The game's
    /// share of the gain so far settles at the current rate (high-water, as in
    /// a harvest), so the owner receives about `amount` and the remaining
    /// position starts from a clean basis. Use `request_exit` for everything.
    #[payable]
    pub fn request_partial_exit(&mut self, amount: U128) -> Promise {
        near_sdk::assert_one_yocto();
        self.owner();
        self.idle();
        assert!(!self.exit_requested, "Exit queued");
        let mut e = ext();
        assert!(e.partial == 0, "Partial exit pending");
        assert!(
            amount.0 >= MIN_POSITION && amount.0 + MIN_POSITION <= self.principal,
            "Partial exit must leave at least 0.001 test NEAR staked; use request_exit"
        );
        e.partial = amount.0;
        save_ext(&e);
        self.read("partial")
    }
    /// Changes the share of future yield the vault gives to the game. Gain
    /// already earned is never re-priced: if it would carry a fee at the old
    /// rate, a harvest settles it first and the new rate applies after its
    /// cash arrives; otherwise the new rate applies at once from today's value.
    #[payable]
    pub fn set_contribution(&mut self, contribution_bps: u16) -> Promise {
        near_sdk::assert_one_yocto();
        self.owner();
        self.idle();
        assert!(contribution_bps <= 10000, "Invalid contribution");
        assert!(!self.exit_requested, "Exit queued");
        let mut e = ext();
        assert!(e.partial == 0, "Partial exit pending");
        assert!(
            contribution_bps != self.contribution || e.pending_contribution.is_some(),
            "Contribution unchanged"
        );
        e.pending_contribution = Some(contribution_bps);
        save_ext(&e);
        self.read("contribution")
    }
    /// Anyone may progress a sealed exit; another unstake cannot reset its unlock.
    pub fn advance(&mut self) -> Promise {
        match self.stage.as_str() {
            "idle" => {
                self.idle();
                assert!(self.exit_requested, "No exit queued");
                self.read("exit")
            }
            "unlocking" => {
                assert!(
                    env::epoch_height() >= self.unlock_epoch,
                    "Epochs still unlocking"
                );
                self.read("withdraw")
            }
            "awaiting_cash" => self.read("cash"),
            _ => env::panic_str("Operation pending"),
        }
    }
    #[private]
    pub fn on_read(&mut self, nonce: U64, purpose: String) -> PromiseOrValue<bool> {
        self.callback(nonce.0, "reading");
        let fallback = match purpose.as_str() {
            "withdraw" => "unlocking",
            "cash" => "awaiting_cash",
            _ => "idle",
        };
        let result = env::promise_result_checked(0, 4096)
            .ok()
            .and_then(|r| near_sdk::serde_json::from_slice::<PoolAccount>(&r).ok());
        let Some(a) = result.filter(|a| a.account_id == env::current_account_id()) else {
            self.stage = fallback.into();
            return PromiseOrValue::Value(false);
        };
        self.staked = a.staked_balance.0;
        self.unstaked = a.unstaked_balance.0;
        self.observed_epoch = env::epoch_height();
        match purpose.as_str() {
            "refresh" => {
                self.stage = "idle".into();
                PromiseOrValue::Value(true)
            }
            "harvest" | "exit" | "partial" | "contribution" => {
                let is_exit = purpose == "exit" || self.exit_requested;
                let total = self.staked + self.unstaked;
                let gain = total.saturating_sub(self.basis);
                let candidate = mul_bps(gain, self.contribution);
                let mut e = ext();
                if !is_exit && purpose != "partial" && (candidate == 0 || self.staked == 0) {
                    // Nothing to settle at the old rate: a waiting contribution
                    // change applies now, from today's value. A fee that cannot
                    // be unstaked yet keeps the change waiting.
                    if let Some(bps) = e.pending_contribution.take().filter(|_| candidate == 0) {
                        self.apply_contribution(bps, total);
                        save_ext(&e);
                        self.stage = "idle".into();
                        return PromiseOrValue::Value(true);
                    }
                    self.stage = "idle".into();
                    return PromiseOrValue::Value(false);
                }
                if purpose == "partial" && (is_exit || self.staked == 0) {
                    e.partial = 0;
                    save_ext(&e);
                    self.stage = "idle".into();
                    return PromiseOrValue::Value(false);
                }
                self.operation = if is_exit {
                    "exit"
                } else if purpose == "partial" {
                    "partial"
                } else {
                    "harvest"
                }
                .into();
                if self.staked == 0 {
                    self.stage = "unlocking".into();
                    self.unlock_epoch = env::epoch_height();
                    return PromiseOrValue::Value(true);
                }
                self.stage = "unstaking".into();
                let (method, args) = if is_exit {
                    ("unstake_all", near_sdk::serde_json::json!({}))
                } else if purpose == "partial" {
                    let out = (e.partial + candidate).min(self.staked);
                    ("unstake", near_sdk::serde_json::json!({"amount":out.to_string()}))
                } else {
                    (
                        "unstake",
                        near_sdk::serde_json::json!({"amount":candidate.min(self.staked).to_string()}),
                    )
                };
                self.pool_call(method, args, 0, TGAS)
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(Gas::from_tgas(TGAS))
                            .on_unstake(U64(self.nonce)),
                    )
                    .into()
            }
            "withdraw" => {
                if !a.can_withdraw || self.unstaked == 0 {
                    self.stage = "unlocking".into();
                    return PromiseOrValue::Value(false);
                }
                self.amount = self.unstaked;
                self.cash_floor = env::account_balance().as_yoctonear();
                self.stage = "withdrawing_pool".into();
                self.pool_call("withdraw_all", near_sdk::serde_json::json!({}), 0, TGAS)
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(Gas::from_tgas(TGAS))
                            .on_pool_withdraw(U64(self.nonce)),
                    )
                    .into()
            }
            "cash" => {
                // The reference pool schedules a detached transfer. Its method callback alone
                // does not establish received cash. Require a later pool view and cash floor.
                if self.unstaked != 0
                    || env::account_balance().as_yoctonear() < self.cash_floor + self.amount
                {
                    self.stage = "awaiting_cash".into();
                    return PromiseOrValue::Value(false);
                }
                if self.operation == "exit" && self.staked != 0 {
                    self.stage = "awaiting_cash".into();
                    return PromiseOrValue::Value(false);
                }
                let total = self.staked + self.amount;
                let game =
                    mul_bps(total.saturating_sub(self.basis), self.contribution).min(self.amount);
                self.game_credit += game;
                self.owner_credit += self.amount - game;
                // Loss recovery is never a new fee. Only final cash crystallizes a fee;
                // unrealized estimates carry no game ownership and can reverse completely.
                self.basis = self.basis.max(total) - self.amount;
                let mut e = ext();
                if self.operation == "exit" {
                    self.basis = 0;
                    self.principal = 0;
                    self.tranches.clear();
                    self.exit_requested = false;
                    e.partial = 0;
                } else if self.operation == "partial" {
                    let out = e.partial.min(self.principal);
                    self.principal -= out;
                    take_oldest(&mut self.tranches, out);
                    e.partial = 0;
                }
                // Gain up to this cash is settled at the old rate.
                if let Some(bps) = e.pending_contribution.take() {
                    self.contribution = bps;
                }
                save_ext(&e);
                self.amount = 0;
                self.stage = "idle".into();
                self.operation.clear();
                PromiseOrValue::Value(true)
            }
            _ => env::panic_str("Invalid read purpose"),
        }
    }
    #[private]
    pub fn on_unstake(&mut self, nonce: U64) -> bool {
        self.callback(nonce.0, "unstaking");
        let ok = env::promise_result_checked(0, 1024).is_ok();
        if ok {
            self.stage = "unlocking".into();
            self.unlock_epoch = env::epoch_height() + 4;
        } else {
            self.stage = "idle".into();
            if self.operation == "partial" {
                let mut e = ext();
                e.partial = 0;
                save_ext(&e);
            }
            self.operation.clear();
        }
        ok
    }
    #[private]
    pub fn on_pool_withdraw(&mut self, nonce: U64) -> bool {
        self.callback(nonce.0, "withdrawing_pool");
        let ok = env::promise_result_checked(0, 1024).is_ok();
        self.stage = if ok { "awaiting_cash" } else { "unlocking" }.into();
        ok
    }
    #[payable]
    pub fn withdraw_owner(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        self.owner();
        self.idle();
        assert!(
            self.owner_credit > 0 && self.owner_pending == 0,
            "No liquid owner balance or payout pending"
        );
        let amount = self.owner_credit;
        self.owner_credit = 0;
        self.owner_pending = amount;
        Promise::new(self.beneficiary.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_owner_paid(U128(amount)),
            )
    }
    #[private]
    pub fn on_owner_paid(&mut self, amount: U128) -> bool {
        assert_eq!(self.owner_pending, amount.0, "Owner callback mismatch");
        self.owner_pending = 0;
        let ok = env::promise_result_checked(0, 0).is_ok();
        if ok {
            self.owner_paid += amount.0;
        } else {
            self.owner_credit += amount.0;
        }
        ok
    }
    pub fn flush_game(&mut self) -> Promise {
        self.idle();
        assert!(
            self.game_credit > 0 && self.game_pending == 0,
            "No liquid game yield or payout pending"
        );
        self.game_sequence += 1;
        let amount = self.game_credit;
        self.game_credit = 0;
        self.game_pending = amount;
        Promise::new(self.rewards.clone()).function_call("fund_rewards",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"source":"realized_yield","receipt_id":format!("vault-{}",self.game_sequence)})).unwrap(),NearToken::from_yoctonear(amount),Gas::from_tgas(TGAS)).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_game_paid(U128(amount)))
    }
    #[private]
    pub fn on_game_paid(&mut self, amount: U128) -> bool {
        assert_eq!(self.game_pending, amount.0, "Game callback mismatch");
        self.game_pending = 0;
        let ok = env::promise_result_checked(0, 1024).is_ok();
        if ok {
            self.game_paid += amount.0;
        } else {
            self.game_credit += amount.0;
        }
        ok
    }
    pub fn get_state(&self) -> near_sdk::serde_json::Value {
        // Conservative initial access: mature principal at the observed loss-adjusted
        // stake value. Retained profit is not yet included in tier eligibility.
        let mature: u128 = self
            .tranches
            .iter()
            .filter(|t| env::epoch_height() >= t.epoch + 2)
            .map(|t| t.amount)
            .sum();
        let active = self.staked.min(self.principal);
        let weighted = if self.exit_requested
            || self.principal == 0
            || self.observed_epoch + 1 < env::epoch_height()
        {
            0
        } else {
            mul_bps(mul_ratio(mature, active, self.principal), self.contribution)
        };
        let e = ext();
        near_sdk::serde_json::json!({"version":2,"network":"testnet","beneficiary":self.beneficiary,"pool":self.pool,"rewards":self.rewards,"contribution_bps":self.contribution,"stage":self.stage,"nonce":self.nonce.to_string(),"operation":self.operation,"exit_requested":self.exit_requested,"unlock_epoch":self.unlock_epoch.to_string(),"epoch":env::epoch_height().to_string(),"observed_epoch":self.observed_epoch.to_string(),"principal":self.principal.to_string(),"high_water_basis":self.basis.to_string(),"staked":self.staked.to_string(),"unstaked":self.unstaked.to_string(),"pending_pool_cash":self.amount.to_string(),"owner_credit":self.owner_credit.to_string(),"owner_pending":self.owner_pending.to_string(),"game_credit":self.game_credit.to_string(),"game_pending":self.game_pending.to_string(),"deposited":self.deposited.to_string(),"owner_paid":self.owner_paid.to_string(),"game_paid":self.game_paid.to_string(),"weighted_stake":weighted.to_string(),"partial_exit":e.partial.to_string(),"pending_contribution_bps":e.pending_contribution,"tier":if weighted>=100*10u128.pow(24){3}else if weighted>=50*10u128.pow(24){2}else{1},"contribution_policy":"owner-adjustable-after-settlement-v2","exit_policy":"full-or-partial-v2","tier_policy":"conservative-mature-principal-v1"})
    }
    fn apply_contribution(&mut self, bps: u16, total: u128) {
        // Any gain observed so far carried no fee at the old rate; it becomes
        // basis, so the new rate prices only yield earned from now on.
        self.basis = self.basis.max(total);
        self.contribution = bps;
    }
    fn owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.beneficiary,
            "Beneficiary only"
        );
    }
    fn idle(&self) {
        assert!(
            self.stage == "idle" && self.owner_pending == 0 && self.game_pending == 0,
            "Operation pending"
        );
    }
    fn callback(&self, nonce: u64, stage: &str) {
        assert_eq!(self.nonce, nonce, "Stale callback");
        assert_eq!(self.stage, stage, "Unexpected callback");
    }
    fn read(&mut self, purpose: &str) -> Promise {
        self.stage = "reading".into();
        self.nonce += 1;
        self.pool_call(
            "get_account",
            near_sdk::serde_json::json!({"account_id":env::current_account_id()}),
            0,
            15,
        )
        .then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(100))
                .on_read(U64(self.nonce), purpose.into()),
        )
    }
    fn pool_call(
        &self,
        method: &str,
        args: near_sdk::serde_json::Value,
        amount: u128,
        gas: u64,
    ) -> Promise {
        Promise::new(self.pool.clone()).function_call(
            method,
            near_sdk::serde_json::to_vec(&args).unwrap(),
            NearToken::from_yoctonear(amount),
            Gas::from_tgas(gas),
        )
    }
}
/// Removes principal from the oldest (most mature) tranches first, so a partial
/// exit never leaves the position looking more mature than it is.
fn take_oldest(tranches: &mut Vec<Tranche>, mut amount: u128) {
    for t in tranches.iter_mut() {
        let cut = t.amount.min(amount);
        t.amount -= cut;
        amount -= cut;
        if amount == 0 {
            break;
        }
    }
    tranches.retain(|t| t.amount > 0);
}
fn mul_bps(value: u128, bps: u16) -> u128 {
    value / 10000 * (bps as u128) + (value % 10000) * (bps as u128) / 10000
}
fn mul_ratio(value: u128, numerator: u128, denominator: u128) -> u128 {
    let result = primitive_types::U256::from(value) * primitive_types::U256::from(numerator)
        / primitive_types::U256::from(denominator);
    assert!(
        result <= primitive_types::U256::from(u128::MAX),
        "Ratio overflow"
    );
    result.as_u128()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, epoch: u64, deposit: u128, balance: u128, result: Option<PromiseResult>) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("vault.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .epoch_height(epoch)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_yoctonear(balance));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            result.into_iter().collect()
        );
    }
    fn setup(bps: u16) -> Vault {
        ctx("owner.testnet", 10, 0, 10u128.pow(27), None);
        Vault::new(
            a("owner.testnet"),
            a("aurora.pool.f863973.m0"),
            a("rewards.testnet"),
            bps,
        )
    }
    fn success() -> Option<PromiseResult> {
        Some(PromiseResult::Successful(b"null".to_vec()))
    }
    fn pool(staked: u128, unstaked: u128, can: bool) -> Option<PromiseResult> {
        Some(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&PoolAccount {
                account_id: a("vault.testnet"),
                staked_balance: U128(staked),
                unstaked_balance: U128(unstaked),
                can_withdraw: can,
            })
            .unwrap(),
        ))
    }
    fn deposited(v: &mut Vault, amount: u128, epoch: u64) {
        ctx("owner.testnet", epoch, amount, 10u128.pow(27), None);
        let _ = v.deposit_and_stake();
        ctx("vault.testnet", epoch, 0, 10u128.pow(27), success());
        assert!(v.on_deposit(U64(v.nonce), U128(amount)));
    }
    #[test]
    fn matured_topup_preserves_existing_access_and_exit_revokes_it() {
        let mut v = setup(10000);
        let near = 10u128.pow(24);
        deposited(&mut v, 50 * near, 10);
        deposited(&mut v, 50 * near, 12);
        assert_eq!(v.get_state()["tier"], 2);
        ctx("owner.testnet", 12, 1, 10u128.pow(27), None);
        let _ = v.request_exit();
        assert_eq!(v.get_state()["weighted_stake"], "0");
    }
    #[test]
    fn failed_deposit_becomes_retryable_owner_credit() {
        let mut v = setup(5000);
        let n = 10u128.pow(24);
        ctx("owner.testnet", 10, n, 10u128.pow(27), None);
        let _ = v.deposit_and_stake();
        ctx(
            "vault.testnet",
            10,
            0,
            10u128.pow(27),
            Some(PromiseResult::Failed),
        );
        assert!(!v.on_deposit(U64(v.nonce), U128(n)));
        assert_eq!(v.owner_credit, n);
        assert_eq!(v.basis, 0);
        assert_eq!(v.stage, "idle");
    }
    #[test]
    fn second_exit_queues_without_resetting_unlock() {
        let mut v = setup(5000);
        deposited(&mut v, 10u128.pow(24), 10);
        v.stage = "unlocking".into();
        v.operation = "harvest".into();
        v.unlock_epoch = 14;
        ctx("owner.testnet", 11, 1, 10u128.pow(27), None);
        let _ = v.request_exit();
        assert_eq!(v.unlock_epoch, 14);
        assert_eq!(v.operation, "harvest");
        assert!(v.exit_requested);
    }
    #[test]
    fn harvest_loss_reverses_unvested_fee_and_preserves_recovery_basis() {
        let mut v = setup(5000);
        v.basis = 100;
        v.principal = 100;
        v.stage = "reading".into();
        v.operation = "harvest".into();
        v.amount = 5;
        v.cash_floor = 1000;
        ctx("vault.testnet", 15, 0, 1005, pool(94, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!(v.game_credit, 0);
        assert_eq!(v.owner_credit, 5);
        assert_eq!(v.basis, 95);
        assert_eq!(v.stage, "idle");
    }
    #[test]
    fn only_received_profit_vests_and_retained_profit_not_charged_again() {
        let mut v = setup(5000);
        v.basis = 100;
        v.principal = 100;
        v.stage = "reading".into();
        v.operation = "harvest".into();
        v.amount = 5;
        v.cash_floor = 1000;
        ctx("vault.testnet", 15, 0, 1005, pool(105, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!(v.game_credit, 5);
        assert_eq!(v.owner_credit, 0);
        assert_eq!(v.basis, 105);
        v.stage = "reading".into();
        ctx("vault.testnet", 15, 0, 1005, pool(105, 0, true));
        let result = v.on_read(U64(0), "harvest".into());
        assert!(matches!(result, PromiseOrValue::Value(false)));
        assert_eq!(v.game_credit, 5);
    }
    #[test]
    fn successful_pool_callback_without_actual_cash_cannot_fund_game() {
        let mut v = setup(10000);
        v.basis = 100;
        v.principal = 100;
        v.stage = "reading".into();
        v.operation = "harvest".into();
        v.amount = 5;
        v.cash_floor = 1000;
        ctx("vault.testnet", 15, 0, 1004, pool(100, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!(v.stage, "awaiting_cash");
        assert_eq!(v.game_credit, 0);
        assert_eq!(v.owner_credit, 0);
    }
    #[test]
    fn full_exit_allocates_only_gain_then_empties_position() {
        let mut v = setup(5000);
        v.basis = 100;
        v.principal = 100;
        v.stage = "reading".into();
        v.operation = "exit".into();
        v.exit_requested = true;
        v.amount = 110;
        v.cash_floor = 1000;
        ctx("vault.testnet", 15, 0, 1110, pool(0, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!(v.game_credit, 5);
        assert_eq!(v.owner_credit, 105);
        assert_eq!(v.principal, 0);
        assert!(!v.exit_requested);
    }
    #[test]
    fn failed_game_transfer_does_not_lose_cash() {
        let mut v = setup(10000);
        v.game_credit = 10;
        let _ = v.flush_game();
        ctx("vault.testnet", 15, 0, 1000, Some(PromiseResult::Failed));
        assert!(!v.on_game_paid(U128(10)));
        assert_eq!(v.game_credit, 10);
        assert_eq!(v.game_pending, 0);
    }
    #[test]
    fn failed_pool_read_restores_exact_stage() {
        let mut v = setup(10000);
        v.stage = "reading".into();
        ctx("vault.testnet", 15, 0, 1000, Some(PromiseResult::Failed));
        let _ = v.on_read(U64(0), "withdraw".into());
        assert_eq!(v.stage, "unlocking");
    }
    #[test]
    #[should_panic(expected = "Stale callback")]
    fn stale_operation_cannot_rewrite_state() {
        let mut v = setup(10000);
        v.stage = "depositing".into();
        v.nonce = 3;
        ctx("vault.testnet", 15, 0, 1000, success());
        v.on_deposit(U64(2), U128(10));
    }
    #[test]
    fn large_native_ratios_do_not_overflow() {
        let n = MAX_DEPOSIT * 64;
        assert_eq!(mul_ratio(n, n, n), n);
        assert_eq!(mul_ratio(n, n / 2, n), n / 2);
        assert_eq!(mul_bps(u128::MAX, 10000), u128::MAX);
    }

    const N: u128 = 10u128.pow(24);
    const BAL: u128 = 10u128.pow(27);
    fn read_back(v: &mut Vault, purpose: &str, epoch: u64, balance: u128, staked: u128, unstaked: u128) -> PromiseOrValue<bool> {
        ctx("vault.testnet", epoch, 0, balance, pool(staked, unstaked, true));
        v.on_read(U64(v.nonce), purpose.into())
    }
    #[test]
    fn partial_exit_pays_principal_settles_fee_and_keeps_the_rest_staked() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_partial_exit(U128(4 * N));
        assert_eq!(v.stage, "reading");
        // 0.2 gain: the game's 0.1 settles with the 4 NEAR taken out.
        let _ = read_back(&mut v, "partial", 11, BAL, 10 * N + N / 5, 0);
        assert_eq!((v.stage.as_str(), v.operation.as_str()), ("unstaking", "partial"));
        ctx("vault.testnet", 11, 0, BAL, success());
        assert!(v.on_unstake(U64(v.nonce)));
        ctx("anyone.testnet", 15, 0, BAL, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "withdraw", 15, BAL, 6 * N + N / 10, 4 * N + N / 10);
        ctx("vault.testnet", 15, 0, BAL, success());
        assert!(v.on_pool_withdraw(U64(v.nonce)));
        ctx("anyone.testnet", 15, 0, BAL + 4 * N + N / 10, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "cash", 15, BAL + 4 * N + N / 10, 6 * N + N / 10, 0);
        assert_eq!(v.stage, "idle");
        assert_eq!(v.game_credit, N / 10);
        assert_eq!(v.owner_credit, 4 * N);
        assert_eq!(v.principal, 6 * N);
        assert_eq!(v.basis, 6 * N + N / 10);
        assert_eq!(v.tranches.iter().map(|t| t.amount).sum::<u128>(), 6 * N);
        assert_eq!(ext().partial, 0);
        assert_eq!(v.get_state()["partial_exit"], "0");
        assert!(!v.exit_requested);
    }
    #[test]
    #[should_panic(expected = "Partial exit must leave at least")]
    fn partial_exit_cannot_take_everything() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_partial_exit(U128(10 * N));
    }
    #[test]
    #[should_panic(expected = "Beneficiary only")]
    fn only_the_beneficiary_exits_partially() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("stranger.testnet", 11, 1, BAL, None);
        let _ = v.request_partial_exit(U128(N));
    }
    #[test]
    fn partial_exit_takes_oldest_tranches_first() {
        let mut t = vec![Tranche { amount: 3, epoch: 1 }, Tranche { amount: 5, epoch: 4 }];
        take_oldest(&mut t, 4);
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].amount, t[0].epoch), (4, 4));
    }
    #[test]
    fn failed_partial_unstake_releases_the_request() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_partial_exit(U128(N));
        let _ = read_back(&mut v, "partial", 11, BAL, 10 * N, 0);
        ctx("vault.testnet", 11, 0, BAL, Some(PromiseResult::Failed));
        assert!(!v.on_unstake(U64(v.nonce)));
        assert_eq!(v.stage, "idle");
        assert_eq!(ext().partial, 0);
        assert_eq!(v.principal, 10 * N);
    }
    #[test]
    fn contribution_change_without_earned_gain_applies_at_once() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.set_contribution(2000);
        let _ = read_back(&mut v, "contribution", 11, BAL, 10 * N, 0);
        assert_eq!(v.contribution, 2000);
        assert_eq!(v.stage, "idle");
        assert_eq!(v.get_state()["pending_contribution_bps"], near_sdk::serde_json::Value::Null);
    }
    #[test]
    fn earned_gain_settles_at_the_old_rate_before_a_lower_one_applies() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.set_contribution(0);
        let _ = read_back(&mut v, "contribution", 11, BAL, 10 * N + N / 5, 0);
        // A harvest of the 0.1 fee runs first; the old rate still holds.
        assert_eq!((v.stage.as_str(), v.operation.as_str()), ("unstaking", "harvest"));
        assert_eq!(v.contribution, 5000);
        assert_eq!(v.get_state()["pending_contribution_bps"], 0);
        ctx("vault.testnet", 11, 0, BAL, success());
        assert!(v.on_unstake(U64(v.nonce)));
        ctx("anyone.testnet", 15, 0, BAL, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "withdraw", 15, BAL, 10 * N + N / 10, N / 10);
        ctx("vault.testnet", 15, 0, BAL, success());
        assert!(v.on_pool_withdraw(U64(v.nonce)));
        ctx("anyone.testnet", 15, 0, BAL + N / 10, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "cash", 15, BAL + N / 10, 10 * N + N / 10, 0);
        assert_eq!(v.game_credit, N / 10);
        assert_eq!(v.contribution, 0);
        assert_eq!(ext().pending_contribution, None);
    }
    #[test]
    fn raising_from_zero_does_not_charge_gain_earned_at_zero() {
        let mut v = setup(0);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.set_contribution(10000);
        let _ = read_back(&mut v, "contribution", 11, BAL, 11 * N, 0);
        assert_eq!(v.contribution, 10000);
        assert_eq!(v.basis, 11 * N);
        assert_eq!(v.stage, "idle");
    }
    #[test]
    #[should_panic(expected = "Exit queued")]
    fn contribution_cannot_change_while_exiting() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        v.exit_requested = true;
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.set_contribution(100);
    }
    /// Frozen copy of the deployed v1 layout: the upgrade is a plain code
    /// deploy, so live v1 state must read back byte for byte.
    #[derive(BorshSerialize)]
    #[borsh(crate = "near_sdk::borsh")]
    struct VaultV1 {
        beneficiary: AccountId,
        pool: AccountId,
        rewards: AccountId,
        contribution: u16,
        stage: String,
        nonce: u64,
        operation: String,
        amount: u128,
        cash_floor: u128,
        basis: u128,
        principal: u128,
        staked: u128,
        unstaked: u128,
        observed_epoch: u64,
        exit_requested: bool,
        unlock_epoch: u64,
        tranches: Vec<Tranche>,
        owner_credit: u128,
        owner_pending: u128,
        game_credit: u128,
        game_pending: u128,
        deposited: u128,
        owner_paid: u128,
        game_paid: u128,
        game_sequence: u64,
    }
    #[test]
    fn v1_state_mid_cycle_reads_without_migration() {
        setup(5000);
        let v1 = VaultV1 {
            beneficiary: a("owner.testnet"),
            pool: a("aurora.pool.f863973.m0"),
            rewards: a("rewards.testnet"),
            contribution: 5000,
            stage: "unlocking".into(),
            nonce: 4,
            operation: "harvest".into(),
            amount: 0,
            cash_floor: 0,
            basis: 7,
            principal: 7,
            staked: 6,
            unstaked: 1,
            observed_epoch: 5402,
            exit_requested: false,
            unlock_epoch: 5406,
            tranches: vec![Tranche { amount: 7, epoch: 5400 }],
            owner_credit: 0,
            owner_pending: 0,
            game_credit: 0,
            game_pending: 0,
            deposited: 7,
            owner_paid: 0,
            game_paid: 0,
            game_sequence: 0,
        };
        let bytes = near_sdk::borsh::to_vec(&v1).unwrap();
        let v = Vault::try_from_slice(&bytes).expect("v1 layout");
        assert_eq!(near_sdk::borsh::to_vec(&v).unwrap(), bytes);
        assert_eq!(v.get_state()["stage"], "unlocking");
        assert_eq!(v.get_state()["pending_contribution_bps"], near_sdk::serde_json::Value::Null);
    }
}
