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
/// Smallest game fee a permissionless `harvest` may unstake (0.001 test NEAR);
/// exits and partial exits settle any amount.
const MIN_HARVEST: u128 = 10u128.pow(21);
/// Epochs after a harvest cashes before the next permissionless harvest may
/// start, so a vault is not kept out of `idle` by back-to-back harvests.
const HARVEST_COOLDOWN_EPOCHS: u64 = 4;
/// Epochs an operation must have been pending before `recover_stuck` may
/// settle it from on-chain state. Receipts settle within blocks; one full
/// epoch (about 12 hours) leaves no callback still in flight.
const RECOVERY_EPOCHS: u64 = 2;
const EXT_KEY: &[u8] = b"vault-ext-v2";
/// v2 additions live under their own storage key, so a deployed v1 vault is
/// upgraded by a plain code deploy: its `Vault` state layout is untouched.
#[derive(BorshDeserialize, BorshSerialize, Default, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
struct Ext {
    /// Principal the owner asked to take out in the partial exit in flight.
    partial: u128,
    /// A contribution change waiting for the gain at the old rate to settle.
    pending_contribution: Option<u16>,
    /// Epoch the current operation or payout started (0: none since upgrade).
    busy_since: u64,
    /// Account balance an in-flight transfer leaves behind when it succeeds;
    /// `recover_stuck` compares against it when the callback never ran.
    floor: u128,
    /// Deposit in flight to the pool while `stage == "depositing"`.
    pending: u128,
    /// Epoch the last harvest cashed; starts the harvest cooldown.
    last_harvest_epoch: u64,
}
/// Layout written by the v2 code (partial exit and contribution change only).
#[derive(BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct ExtV2 {
    partial: u128,
    pending_contribution: Option<u16>,
}
fn ext() -> Ext {
    env::storage_read(EXT_KEY)
        .map(|b| {
            Ext::try_from_slice(&b)
                .or_else(|_| {
                    ExtV2::try_from_slice(&b).map(|v| Ext {
                        partial: v.partial,
                        pending_contribution: v.pending_contribution,
                        ..Default::default()
                    })
                })
                .expect("Vault extension")
        })
        .unwrap_or_default()
}
fn save_ext(e: &Ext) {
    if *e == Ext::default() {
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
        // The balance already holds the attached deposit; a refused pool call
        // refunds it, so the floor tells a stuck deposit apart from a staked one.
        self.begin(Some((env::account_balance().as_yoctonear() - amount, amount)));
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
        self.clear_pending();
        ok
    }
    pub fn refresh(&mut self) -> Promise {
        self.idle();
        self.read("refresh")
    }
    /// No caller can choose a destination or spend the beneficiary's principal.
    /// Returns `false` without reading the pool while the harvest cooldown runs;
    /// a fee below `MIN_HARVEST` is left to grow (see `on_read`).
    pub fn harvest(&mut self) -> PromiseOrValue<bool> {
        self.idle();
        assert!(
            !self.exit_requested && self.principal > 0,
            "No active stake"
        );
        let e = ext();
        if e.last_harvest_epoch > 0
            && env::epoch_height() < e.last_harvest_epoch + HARVEST_COOLDOWN_EPOCHS
        {
            env::log_str("harvest cooldown");
            return PromiseOrValue::Value(false);
        }
        self.read("harvest").into()
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
        // Measured against the observed stake as well: after a loss the stake
        // is below principal, and taking all of it would leave a principal
        // with nothing behind it.
        assert!(
            amount.0 >= MIN_POSITION
                && amount.0 + MIN_POSITION <= self.principal.min(self.staked),
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
                if is_exit && self.staked == 0 && self.unstaked == 0 {
                    // The pool holds nothing for this account (a loss took the
                    // rest): there is no cash to wait for, so the position closes.
                    self.operation = "exit".into();
                    self.close_empty(&mut e);
                    return PromiseOrValue::Value(true);
                }
                // A permissionless harvest waits for a fee worth unstaking; an
                // exit, a partial exit or a contribution change settle any amount.
                let too_small = purpose == "harvest" && candidate < MIN_HARVEST;
                if !is_exit
                    && purpose != "partial"
                    && (candidate == 0 || self.staked == 0 || too_small)
                {
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
                if self.unstaked == 0 {
                    if self.amount > 0 {
                        // `withdraw_all` already ran (its callback was lost and
                        // recovered): the cash check decides from the balance.
                        self.stage = "awaiting_cash".into();
                        return PromiseOrValue::Value(false);
                    }
                    if self.staked == 0 {
                        // Nothing staked and nothing unstaked: the position is
                        // empty, waiting for cash would loop forever.
                        let mut e = ext();
                        self.close_empty(&mut e);
                        return PromiseOrValue::Value(true);
                    }
                    // The unstake never happened (a recovered operation): the
                    // stake is intact, so the operation ends and may be retried.
                    let mut e = ext();
                    e.partial = 0;
                    save_ext(&e);
                    self.operation.clear();
                    self.stage = "idle".into();
                    return PromiseOrValue::Value(false);
                }
                if !a.can_withdraw {
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
                if self.unstaked != 0 {
                    // The pool still holds the unstaked balance: `withdraw_all`
                    // did not run (its callback was lost and recovered), so the
                    // withdrawal is issued again from `unlocking`.
                    self.stage = "unlocking".into();
                    return PromiseOrValue::Value(false);
                }
                if env::account_balance().as_yoctonear() < self.cash_floor + self.amount {
                    self.stage = "awaiting_cash".into();
                    return PromiseOrValue::Value(false);
                }
                if self.operation == "exit" && self.staked != 0 {
                    self.stage = "awaiting_cash".into();
                    return PromiseOrValue::Value(false);
                }
                let total = self.staked + self.amount;
                let gain = total.saturating_sub(self.basis);
                let game = mul_bps(gain, self.contribution).min(self.amount);
                self.game_credit += game;
                self.owner_credit += self.amount - game;
                // Loss recovery is never a new fee. Only final cash crystallizes a fee;
                // unrealized estimates carry no game ownership and can reverse completely.
                // The basis advances only by the gain whose fee this cash actually
                // settled: gain that grew during the unlock stays chargeable.
                let settled = if self.contribution == 0 {
                    0
                } else {
                    gain.min(div_bps_up(game, self.contribution))
                };
                self.basis = (self.basis + settled).saturating_sub(self.amount);
                let mut e = ext();
                if self.operation == "harvest" {
                    e.last_harvest_epoch = env::epoch_height();
                }
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
        self.begin(Some((env::account_balance().as_yoctonear() - amount, amount)));
        Promise::new(self.beneficiary.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(TGAS))
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
        self.clear_pending();
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
        self.begin(Some((env::account_balance().as_yoctonear() - amount, amount)));
        Promise::new(self.rewards.clone()).function_call("fund_rewards",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"source":"realized_yield","receipt_id":format!("vault-{}",self.game_sequence)})).unwrap(),NearToken::from_yoctonear(amount),Gas::from_tgas(TGAS)).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(TGAS)).on_game_paid(U128(amount)))
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
        self.clear_pending();
        ok
    }
    /// Settles an operation whose callback never ran (out of gas, aborted), so a
    /// keyless vault cannot stay blocked forever. Anyone, once the operation has
    /// been pending for `RECOVERY_EPOCHS`. Nothing is paid here: a lost transfer
    /// or deposit is judged from the account balance against the floor recorded
    /// when it was issued, and a lost pool step moves to the stage whose next
    /// pool read re-derives the truth (`on_read` "withdraw" and "cash"). The late
    /// callback, if it ever runs, fails its nonce or stage check and changes nothing.
    pub fn recover_stuck(&mut self) -> String {
        let mut e = ext();
        let epoch = env::epoch_height();
        // Operations started by the v2 code carry no `busy_since`; the last pool
        // observation is older than any of them.
        let since = if e.busy_since > 0 { e.busy_since } else { self.observed_epoch };
        assert!(epoch >= since + RECOVERY_EPOCHS, "Operation still fresh");
        let balance = env::account_balance().as_yoctonear();
        // A refused transfer or deposit came back in full (balance at the floor
        // plus the amount); a successful one left the balance at the floor.
        // Nothing else moves the balance while the vault is blocked, so the
        // midpoint decides.
        let refunded = |amount: u128| balance > e.floor + amount / 2;
        if self.owner_pending > 0 {
            let amount = self.owner_pending;
            self.owner_pending = 0;
            if refunded(amount) {
                self.owner_credit += amount;
            } else {
                self.owner_paid += amount;
            }
            env::log_str("recovered owner payout");
        } else if self.game_pending > 0 {
            let amount = self.game_pending;
            self.game_pending = 0;
            if refunded(amount) {
                self.game_credit += amount;
            } else {
                self.game_paid += amount;
            }
            env::log_str("recovered game payout");
        } else {
            match self.stage.as_str() {
                "depositing" => {
                    let amount = e.pending;
                    if refunded(amount) {
                        self.owner_credit += amount;
                    } else {
                        self.basis += amount;
                        self.principal += amount;
                        self.staked += amount;
                        self.deposited += amount;
                        // Maturity counts from now: later than the truth, never earlier.
                        self.tranches.push(Tranche { amount, epoch });
                    }
                    self.stage = "idle".into();
                }
                // A read changes nothing; return to the stage it was issued from.
                "reading" => {
                    self.stage = if self.operation.is_empty() { "idle" } else { "unlocking" }.into();
                }
                // Whether the unstake ran shows in the next pool read.
                "unstaking" => {
                    self.stage = "unlocking".into();
                    self.unlock_epoch = epoch + 4;
                }
                // Whether `withdraw_all` ran shows in the next pool read.
                "withdrawing_pool" => self.stage = "awaiting_cash".into(),
                "unlocking" | "awaiting_cash" => env::panic_str("Not stuck; use advance"),
                _ => env::panic_str("Nothing to recover"),
            }
            // The lost callback, if it still arrives, fails its nonce check.
            self.nonce += 1;
        }
        e.busy_since = 0;
        e.floor = 0;
        e.pending = 0;
        save_ext(&e);
        self.stage.clone()
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
        let busy = self.stage != "idle" || self.owner_pending > 0 || self.game_pending > 0;
        let since = if e.busy_since > 0 { e.busy_since } else { self.observed_epoch };
        let recoverable_at = if busy && !matches!(self.stage.as_str(), "unlocking" | "awaiting_cash") {
            Some((since + RECOVERY_EPOCHS).to_string())
        } else {
            None
        };
        let next_harvest = if e.last_harvest_epoch > 0 { e.last_harvest_epoch + HARVEST_COOLDOWN_EPOCHS } else { 0 };
        near_sdk::serde_json::json!({"version":2,"network":"testnet","beneficiary":self.beneficiary,"pool":self.pool,"rewards":self.rewards,"contribution_bps":self.contribution,"stage":self.stage,"nonce":self.nonce.to_string(),"operation":self.operation,"exit_requested":self.exit_requested,"unlock_epoch":self.unlock_epoch.to_string(),"epoch":env::epoch_height().to_string(),"observed_epoch":self.observed_epoch.to_string(),"principal":self.principal.to_string(),"high_water_basis":self.basis.to_string(),"staked":self.staked.to_string(),"unstaked":self.unstaked.to_string(),"pending_pool_cash":self.amount.to_string(),"owner_credit":self.owner_credit.to_string(),"owner_pending":self.owner_pending.to_string(),"game_credit":self.game_credit.to_string(),"game_pending":self.game_pending.to_string(),"deposited":self.deposited.to_string(),"owner_paid":self.owner_paid.to_string(),"game_paid":self.game_paid.to_string(),"weighted_stake":weighted.to_string(),"partial_exit":e.partial.to_string(),"pending_contribution_bps":e.pending_contribution,"busy_since":e.busy_since.to_string(),"recoverable_at_epoch":recoverable_at,"min_harvest":MIN_HARVEST.to_string(),"next_harvest_epoch":next_harvest.to_string(),"tier":if weighted>=100*10u128.pow(24){3}else if weighted>=50*10u128.pow(24){2}else{1},"contribution_policy":"owner-adjustable-after-settlement-v2","exit_policy":"full-or-partial-v2","tier_policy":"conservative-mature-principal-v1","recovery_policy":"balance-and-pool-reconciled-after-2-epochs-v3"})
    }
    /// Records the start of an operation or payout so `recover_stuck` can time
    /// it; `floor_and_pending` carries the balance a successful transfer leaves
    /// and the amount in flight.
    fn begin(&mut self, floor_and_pending: Option<(u128, u128)>) {
        let mut e = ext();
        e.busy_since = env::epoch_height();
        if let Some((floor, pending)) = floor_and_pending {
            e.floor = floor;
            e.pending = pending;
        }
        save_ext(&e);
    }
    fn clear_pending(&mut self) {
        let mut e = ext();
        if e.floor != 0 || e.pending != 0 {
            e.floor = 0;
            e.pending = 0;
            save_ext(&e);
        }
    }
    /// The pool holds nothing for this account: the position ends with no cash.
    fn close_empty(&mut self, e: &mut Ext) {
        env::log_str("position closed: the pool holds nothing for this vault");
        self.basis = 0;
        self.principal = 0;
        self.tranches.clear();
        self.exit_requested = false;
        e.partial = 0;
        if let Some(bps) = e.pending_contribution.take() {
            self.contribution = bps;
        }
        save_ext(e);
        self.amount = 0;
        self.operation.clear();
        self.stage = "idle".into();
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
        self.begin(None);
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
/// Gain whose fee at `bps` is at least `fee` (inverse of `mul_bps`, rounded up).
fn div_bps_up(fee: u128, bps: u16) -> u128 {
    let bps = bps as u128;
    let r = primitive_types::U256::from(fee) * primitive_types::U256::from(10000u32);
    let r = (r + primitive_types::U256::from(bps - 1)) / primitive_types::U256::from(bps);
    assert!(r <= primitive_types::U256::from(u128::MAX), "Ratio overflow");
    r.as_u128()
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

    // ----- v3: basis settlement (M1), harvest minimum and cooldown (M2),
    // empty-position close (M3), stuck-operation recovery (H5) -----

    /// Frozen copy of the extension record the v2 code wrote.
    #[derive(BorshSerialize)]
    #[borsh(crate = "near_sdk::borsh")]
    struct ExtV2Record {
        partial: u128,
        pending_contribution: Option<u16>,
    }
    #[test]
    fn v2_extension_record_reads_with_the_new_fields() {
        setup(5000);
        let bytes = near_sdk::borsh::to_vec(&ExtV2Record { partial: 3, pending_contribution: Some(2000) }).unwrap();
        env::storage_write(EXT_KEY, &bytes);
        let e = ext();
        assert_eq!((e.partial, e.pending_contribution, e.busy_since, e.floor, e.pending), (3, Some(2000), 0, 0, 0));
        save_ext(&e);
        assert_eq!(ext().partial, 3);
    }
    #[test]
    fn harvest_cash_advances_basis_only_by_the_settled_gain() {
        let mut v = setup(5000);
        v.basis = 100 * N;
        v.principal = 100 * N;
        v.stage = "reading".into();
        v.operation = "harvest".into();
        v.amount = N;
        v.cash_floor = BAL;
        // The stake grew to 104 during the unlock: gain 5, fee 2.5, but only 1 was unstaked.
        ctx("vault.testnet", 15, 0, BAL + N, pool(104 * N, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!((v.game_credit, v.owner_credit), (N, 0));
        // The cash settled the fee on 2 of gain, so the basis moves by 2 - 1 (the old
        // high-water rule jumped to 104 and forgave the fee on the other 3).
        assert_eq!(v.basis, 101 * N);
        assert_eq!(ext().last_harvest_epoch, 15);
        // The remaining 3 of gain is still chargeable at the next harvest.
        v.stage = "reading".into();
        ctx("vault.testnet", 20, 0, BAL, pool(104 * N, 0, true));
        let _ = v.on_read(U64(0), "harvest".into());
        assert_eq!((v.stage.as_str(), v.operation.as_str()), ("unstaking", "harvest"));
    }
    #[test]
    fn harvest_waits_for_a_fee_worth_unstaking() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("anyone.testnet", 11, 0, BAL, None);
        assert!(matches!(v.harvest(), PromiseOrValue::Promise(_)));
        // Gain 0.001: the fee of 0.0005 is below the 0.001 minimum.
        let r = read_back(&mut v, "harvest", 11, BAL, 10 * N + N / 1000, 0);
        assert!(matches!(r, PromiseOrValue::Value(false)));
        assert_eq!(v.stage, "idle");
        ctx("anyone.testnet", 11, 0, BAL, None);
        let _ = v.harvest();
        let _ = read_back(&mut v, "harvest", 11, BAL, 10 * N + N / 100, 0);
        assert_eq!(v.stage, "unstaking");
    }
    #[test]
    fn harvest_cooldown_runs_from_the_last_cash() {
        let mut v = setup(5000);
        v.basis = 100 * N;
        v.principal = 100 * N;
        v.stage = "reading".into();
        v.operation = "harvest".into();
        v.amount = N;
        v.cash_floor = BAL;
        ctx("vault.testnet", 15, 0, BAL + N, pool(101 * N, 0, true));
        let _ = v.on_read(U64(0), "cash".into());
        assert_eq!(v.stage, "idle");
        ctx("anyone.testnet", 16, 0, BAL, None);
        assert!(matches!(v.harvest(), PromiseOrValue::Value(false)));
        assert_eq!(v.stage, "idle");
        assert_eq!(v.get_state()["next_harvest_epoch"], "19");
        ctx("anyone.testnet", 19, 0, BAL, None);
        assert!(matches!(v.harvest(), PromiseOrValue::Promise(_)));
        assert_eq!(v.stage, "reading");
    }
    #[test]
    fn exit_with_an_emptied_pool_position_closes_instead_of_looping() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_exit();
        // The pool holds nothing for this account any more.
        let r = read_back(&mut v, "exit", 11, BAL, 0, 0);
        assert!(matches!(r, PromiseOrValue::Value(true)));
        assert_eq!((v.stage.as_str(), v.principal, v.exit_requested), ("idle", 0, false));
        assert!(v.tranches.is_empty());
    }
    #[test]
    fn unlocking_exit_with_nothing_left_in_the_pool_closes() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        v.stage = "unlocking".into();
        v.operation = "exit".into();
        v.exit_requested = true;
        v.unlock_epoch = 14;
        ctx("anyone.testnet", 15, 0, BAL, None);
        let _ = v.advance();
        let r = read_back(&mut v, "withdraw", 15, BAL, 0, 0);
        assert!(matches!(r, PromiseOrValue::Value(true)));
        assert_eq!((v.stage.as_str(), v.principal, v.operation.as_str()), ("idle", 0, ""));
    }
    #[test]
    #[should_panic(expected = "Partial exit must leave at least")]
    fn partial_exit_is_measured_against_the_observed_stake() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        // A loss left 5 staked behind a principal of 10.
        v.staked = 5 * N;
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_partial_exit(U128(6 * N));
    }
    #[test]
    #[should_panic(expected = "Operation still fresh")]
    fn recovery_waits_for_the_timeout() {
        let mut v = setup(5000);
        v.owner_credit = 5 * N;
        ctx("owner.testnet", 10, 1, BAL, None);
        let _ = v.withdraw_owner();
        ctx("anyone.testnet", 11, 0, BAL - 5 * N, None);
        v.recover_stuck();
    }
    #[test]
    fn stuck_owner_payout_is_settled_from_the_balance() {
        let mut v = setup(5000);
        v.owner_credit = 5 * N;
        // The balance seen by the method includes the 1 yoctoNEAR attached.
        ctx("owner.testnet", 10, 1, BAL, None);
        let _ = v.withdraw_owner();
        assert_eq!((v.owner_pending, ext().floor, ext().busy_since), (5 * N, BAL + 1 - 5 * N, 10));
        assert_eq!(v.get_state()["recoverable_at_epoch"], "12");
        // The transfer went through (the balance dropped) and the callback never ran.
        ctx("anyone.testnet", 12, 0, BAL + 1 - 5 * N, None);
        assert_eq!(v.recover_stuck(), "idle");
        assert_eq!((v.owner_pending, v.owner_paid, v.owner_credit), (0, 5 * N, 0));
        assert_eq!(v.get_state()["recoverable_at_epoch"], near_sdk::serde_json::Value::Null);
        // Credit can be used again; a refused transfer this time keeps the balance.
        v.owner_credit = 2 * N;
        ctx("owner.testnet", 12, 1, BAL, None);
        let _ = v.withdraw_owner();
        ctx("anyone.testnet", 14, 0, BAL + 1, None);
        assert_eq!(v.recover_stuck(), "idle");
        assert_eq!((v.owner_pending, v.owner_paid, v.owner_credit), (0, 5 * N, 2 * N));
    }
    #[test]
    #[should_panic(expected = "Owner callback mismatch")]
    fn late_owner_callback_after_recovery_cannot_pay_twice() {
        let mut v = setup(5000);
        v.owner_credit = 5 * N;
        ctx("owner.testnet", 10, 1, BAL, None);
        let _ = v.withdraw_owner();
        ctx("anyone.testnet", 12, 0, BAL + 1 - 5 * N, None);
        v.recover_stuck();
        ctx("vault.testnet", 12, 0, BAL + 1 - 5 * N, success());
        v.on_owner_paid(U128(5 * N));
    }
    #[test]
    fn stuck_game_flush_is_settled_from_the_balance() {
        let mut v = setup(5000);
        v.game_credit = 3 * N;
        ctx("anyone.testnet", 10, 0, BAL, None);
        let _ = v.flush_game();
        // fund_rewards refused: the deposit came back to the vault.
        ctx("anyone.testnet", 12, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "idle");
        assert_eq!((v.game_pending, v.game_credit, v.game_paid), (0, 3 * N, 0));
    }
    #[test]
    fn stuck_deposit_is_recovered_as_stake_or_credit() {
        let mut v = setup(5000);
        // The balance seen by the method already holds the attached deposit.
        ctx("owner.testnet", 10, N, BAL - N, None);
        let _ = v.deposit_and_stake();
        assert_eq!((v.stage.as_str(), ext().pending, ext().floor), ("depositing", N, BAL - N));
        // The pool kept the deposit: the balance stays at the floor.
        ctx("anyone.testnet", 12, 0, BAL - N, None);
        assert_eq!(v.recover_stuck(), "idle");
        assert_eq!((v.principal, v.staked, v.basis, v.deposited, v.owner_credit), (N, N, N, N, 0));
        assert_eq!((v.tranches.len(), v.tranches[0].epoch), (1, 12));
        // A refused pool call refunded the deposit: it becomes retryable credit.
        ctx("owner.testnet", 12, 2 * N, BAL - 2 * N, None);
        let _ = v.deposit_and_stake();
        ctx("anyone.testnet", 14, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "idle");
        assert_eq!((v.principal, v.owner_credit, ext().pending), (N, 2 * N, 0));
    }
    #[test]
    fn stuck_unstake_is_resolved_by_the_next_pool_read() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("owner.testnet", 11, 1, BAL, None);
        let _ = v.request_exit();
        let _ = read_back(&mut v, "exit", 11, BAL, 10 * N, 0);
        assert_eq!(v.stage, "unstaking");
        let stale = v.nonce;
        ctx("anyone.testnet", 13, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "unlocking");
        assert_eq!(v.unlock_epoch, 17);
        assert!(v.nonce > stale);
        // The unstake never ran: the stake is intact, so the exit is simply retried.
        ctx("anyone.testnet", 17, 0, BAL, None);
        let _ = v.advance();
        let r = read_back(&mut v, "withdraw", 17, BAL, 10 * N, 0);
        assert!(matches!(r, PromiseOrValue::Value(false)));
        assert_eq!((v.stage.as_str(), v.operation.as_str(), v.exit_requested), ("idle", "", true));
        ctx("anyone.testnet", 17, 0, BAL, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "exit", 17, BAL, 10 * N, 0);
        assert_eq!(v.stage, "unstaking");
    }
    #[test]
    fn stuck_pool_withdraw_is_reissued_from_the_cash_read() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        v.stage = "withdrawing_pool".into();
        v.operation = "exit".into();
        v.exit_requested = true;
        v.amount = 10 * N;
        v.cash_floor = BAL;
        v.unstaked = 10 * N;
        v.staked = 0;
        let mut e = ext();
        e.busy_since = 10;
        save_ext(&e);
        ctx("anyone.testnet", 12, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "awaiting_cash");
        // `withdraw_all` never ran: the pool still holds the unstaked balance.
        ctx("anyone.testnet", 12, 0, BAL, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "cash", 12, BAL, 0, 10 * N);
        assert_eq!(v.stage, "unlocking");
        ctx("anyone.testnet", 12, 0, BAL, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "withdraw", 12, BAL, 0, 10 * N);
        assert_eq!((v.stage.as_str(), v.amount), ("withdrawing_pool", 10 * N));
        // Then it did run and the cash arrived: the exit settles once.
        ctx("vault.testnet", 12, 0, BAL, success());
        assert!(v.on_pool_withdraw(U64(v.nonce)));
        ctx("anyone.testnet", 12, 0, BAL + 10 * N, None);
        let _ = v.advance();
        let _ = read_back(&mut v, "cash", 12, BAL + 10 * N, 0, 0);
        assert_eq!((v.stage.as_str(), v.principal, v.owner_credit), ("idle", 0, 10 * N));
    }
    #[test]
    fn stuck_read_returns_to_its_origin_stage() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        ctx("anyone.testnet", 11, 0, BAL, None);
        let _ = v.harvest();
        assert_eq!(v.stage, "reading");
        ctx("anyone.testnet", 13, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "idle");
        v.stage = "unlocking".into();
        v.operation = "harvest".into();
        v.unlock_epoch = 13;
        ctx("anyone.testnet", 13, 0, BAL, None);
        let _ = v.advance();
        assert_eq!(v.stage, "reading");
        ctx("anyone.testnet", 15, 0, BAL, None);
        assert_eq!(v.recover_stuck(), "unlocking");
    }
    #[test]
    #[should_panic(expected = "Not stuck")]
    fn a_waiting_unlock_is_not_recoverable() {
        let mut v = setup(5000);
        deposited(&mut v, 10 * N, 10);
        v.stage = "unlocking".into();
        v.operation = "harvest".into();
        ctx("anyone.testnet", 20, 0, BAL, None);
        v.recover_stuck();
    }
}
