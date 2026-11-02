//! questlayer-yield-vault: a no-loss lock vault for liquid staking tokens and
//! stablecoins (testnet only, unaudited).
//!
//! Pattern (PoolTogether PrizeVault, docs/YIELD-VAULT.md): players keep a claim
//! on exact principal; only assets above total principal plus a safety buffer
//! are "yield" and may leave, and only to the immutable treasury.
//!
//! - LSTs (stNEAR, LiNEAR) are held. A position is valued in yoctoNEAR at the
//!   LST's own on-chain price when deposited; a withdrawal pays tokens worth that
//!   value at the current price. The LST's growth is the surplus.
//! - Stables (USDC, USDT) return exact principal. Above a liquidity buffer they
//!   may be supplied to Rhea Lend (never borrowed against); the interest is the
//!   surplus. A withdrawal the buffer cannot cover waits in a FIFO queue.
//!
//! A deposit counts for Staker at once; each deposit is a tranche locked for
//! `lock_ms` (24–48 h, changes are never retroactive). Withdrawals are never
//! paused. The owner has no path to player principal.
use near_sdk::{
    collections::LookupMap,
    env, ext_contract,
    json_types::{U128, U64},
    near, near_bindgen,
    serde::Deserialize,
    serde_json::{self, json, Value},
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const RHEA: &str = "contract.burrow.testnet";
const HOUR_MS: u64 = 3_600_000;
const MAX_TRANCHES: usize = 16;
const ADVANCE_BATCH: u64 = 5;
const OP_TIMEOUT_MS: u64 = 15 * 60_000;
/// Blocks after a Rhea withdrawal before `confirm_inbound` decides it: Rhea's
/// detached transfer and its `after_ft_transfer` finish within a few blocks.
const INBOUND_SETTLE_BLOCKS: u64 = 30;
/// Positions the contract pays storage for (about 2 NEAR at 200 B each).
const MAX_POSITIONS: u64 = 1_000;
const PRICE_SCALE: u128 = 1_000_000_000_000_000_000_000_000;
const NEAR: u128 = PRICE_SCALE;

const OP_HARVEST: u8 = 1;
const OP_REBALANCE: u8 = 2;
const OP_CONFIRM: u8 = 3;

fn tgas(n: u64) -> Gas {
    Gas::from_tgas(n)
}

/// The allowlist is code, not configuration: `(token, price method, cap ceiling)`.
/// Price methods return yoctoNEAR per 10^24 token units.
fn known(token: &str) -> Option<(bool, &'static str, u128)> {
    match token {
        "meta-v2.pool.testnet" => Some((true, "get_st_near_price", 1_000 * NEAR)),
        "linear-protocol.testnet" => Some((true, "ft_price", 1_000 * NEAR)),
        "usdc.fakes.testnet" | "usdt.fakes.testnet" => Some((false, "", 100_000 * 1_000_000)),
        _ => None,
    }
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    let r = primitive_types::U256::from(a) * primitive_types::U256::from(b)
        / primitive_types::U256::from(c);
    assert!(r <= primitive_types::U256::from(u128::MAX), "Overflow");
    r.as_u128()
}
fn mul_div_up(a: u128, b: u128, c: u128) -> u128 {
    let n = primitive_types::U256::from(a) * primitive_types::U256::from(b);
    let c = primitive_types::U256::from(c);
    let r = (n + c - 1) / c;
    assert!(r <= primitive_types::U256::from(u128::MAX), "Overflow");
    r.as_u128()
}
fn bps(a: u128, b: u16) -> u128 {
    mul_div(a, b as u128, 10_000)
}
fn result_bytes(i: u64) -> Option<Vec<u8>> {
    env::promise_result_checked(i, 64 * 1024).ok()
}
/// Only an explicit failure is a failure; a long result is still a success.
fn succeeded(i: u64) -> bool {
    !matches!(env::promise_result_checked(i, 0), Err(near_sdk::PromiseError::Failed))
}
fn result_u128(i: u64) -> Option<u128> {
    result_bytes(i)
        .and_then(|b| serde_json::from_slice::<U128>(&b).ok())
        .map(|v| v.0)
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Tranche {
    pub amount: U128,
    pub locked_until_ms: U64,
}

#[near(serializers = [borsh])]
#[derive(Default)]
pub struct Position {
    free: u128,
    tranches: Vec<Tranche>,
    queued: u128,
}
impl Position {
    fn fold(&mut self, now: u64) {
        let (open, locked): (Vec<_>, Vec<_>) =
            self.tranches.drain(..).partition(|t| t.locked_until_ms.0 <= now);
        self.free += open.iter().map(|t| t.amount.0).sum::<u128>();
        self.tranches = locked;
    }
    fn total(&self) -> u128 {
        self.free + self.tranches.iter().map(|t| t.amount.0).sum::<u128>()
    }
}

#[near(serializers = [borsh])]
pub struct Token {
    id: AccountId,
    lst: bool,
    price_method: String,
    rhea: bool,
    cap: u128,
    account_cap: u128,
    min_deposit: u128,
    buffer_bps: u16,
    max_util_bps: u16,
    safety_bps: u16,
    min_harvest: u128,
    /// Sum of open positions (yoctoNEAR for LSTs, token units for stables).
    principal: u128,
    /// LST value taken out of positions while the withdrawal price is read.
    pending: u128,
    /// Stable principal owed to the withdrawal queue.
    queued: u128,
    /// Tokens held by this contract that the accounting knows about.
    idle: u128,
    /// Tokens sent out whose callback has not run yet.
    outgoing: u128,
    /// Tokens Rhea is sending back after a withdrawal, not yet confirmed.
    inbound: u128,
    inbound_block: u64,
    /// Our Rhea supply (inner units) below which the inbound counts as sent;
    /// at or above it Rhea restored the supply (the transfer bounced).
    inbound_threshold: u128,
    op: u8,
    op_nonce: u64,
    op_ms: u64,
    q_head: u64,
    q_tail: u64,
    harvested: u128,
    deposits: u64,
}

#[near(serializers = [borsh, json])]
pub struct QueueEntry {
    pub account_id: AccountId,
    pub amount: U128,
}

#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde")]
struct RheaPool {
    #[serde(default)]
    balance: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaAssetConfig {
    extra_decimals: u8,
    can_deposit: bool,
    can_withdraw: bool,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaAsset {
    supplied: RheaPool,
    borrowed: RheaPool,
    reserved: U128,
    #[serde(default)]
    prot_fee: U128,
    config: RheaAssetConfig,
}
impl RheaAsset {
    fn util_bps(&self) -> u128 {
        let total = self.supplied.balance.0 + self.reserved.0;
        if total == 0 {
            return 0;
        }
        mul_div(self.borrowed.balance.0, 10_000, total)
    }
    fn available(&self) -> u128 {
        (self.supplied.balance.0 + self.reserved.0)
            .saturating_sub(self.borrowed.balance.0)
            .saturating_sub(self.prot_fee.0)
    }
    fn scale(&self) -> u128 {
        10u128.pow(self.config.extra_decimals as u32)
    }
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaSupply {
    token_id: AccountId,
    balance: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaAccount {
    supplied: Vec<RheaSupply>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct YieldVault {
    owner: AccountId,
    treasury: AccountId,
    rhea: AccountId,
    lock_ms: u64,
    deposits_paused: bool,
    tokens: Vec<Token>,
    positions: LookupMap<String, Position>,
    queue: LookupMap<String, QueueEntry>,
    position_count: u64,
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_lst_deposit(&mut self, token_id: AccountId, account_id: AccountId, amount: U128) -> U128;
    fn on_lst_withdraw(&mut self, token_id: AccountId, account_id: AccountId, value: U128) -> PromiseOrValue<bool>;
    fn on_paid(&mut self, token_id: AccountId, account_id: AccountId, tokens: U128, value: U128) -> bool;
    fn on_harvest(&mut self, token_id: AccountId, nonce: U64) -> PromiseOrValue<bool>;
    fn on_harvest_paid(&mut self, token_id: AccountId, nonce: U64, amount: U128) -> bool;
    fn on_rebalance(&mut self, token_id: AccountId, nonce: U64) -> PromiseOrValue<bool>;
    fn on_supplied(&mut self, token_id: AccountId, nonce: U64, amount: U128) -> bool;
    fn on_rhea_withdraw(&mut self, token_id: AccountId, nonce: U64, amount: U128, threshold: U128) -> bool;
    fn on_confirm(&mut self, token_id: AccountId, nonce: U64) -> bool;
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[near_bindgen]
impl YieldVault {
    #[init]
    pub fn new(owner_id: AccountId, treasury_id: AccountId) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet")
                && treasury_id.as_str().ends_with(".testnet")
                && owner_id.as_str().ends_with(".testnet"),
            "Testnet only"
        );
        assert!(treasury_id != env::current_account_id(), "Treasury must be another account");
        Self {
            owner: owner_id,
            treasury: treasury_id,
            rhea: RHEA.parse().unwrap(),
            lock_ms: 24 * HOUR_MS,
            deposits_paused: false,
            tokens: vec![],
            positions: LookupMap::new(b"p"),
            queue: LookupMap::new(b"q"),
            position_count: 0,
        }
    }

    // ----- owner: configuration only, never principal -----

    pub fn add_token(&mut self, token_id: AccountId, rhea: bool) {
        self.only_owner();
        let (lst, method, ceiling) = known(token_id.as_str()).expect("Token not allowlisted");
        assert!(self.find(&token_id).is_none(), "Token exists");
        assert!(!(lst && rhea), "LSTs are held, not lent");
        let unit = if lst { NEAR } else { 1_000_000 };
        self.tokens.push(Token {
            id: token_id,
            lst,
            price_method: method.into(),
            rhea,
            cap: ceiling / 10,
            account_cap: ceiling / 100,
            min_deposit: unit / 10,
            buffer_bps: 2_000,
            max_util_bps: 9_500,
            safety_bps: 10,
            min_harvest: unit / 1_000,
            principal: 0,
            pending: 0,
            queued: 0,
            idle: 0,
            outgoing: 0,
            inbound: 0,
            inbound_block: 0,
            inbound_threshold: 0,
            op: 0,
            op_nonce: 0,
            op_ms: 0,
            q_head: 0,
            q_tail: 0,
            harvested: 0,
            deposits: 0,
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_token_limits(
        &mut self,
        token_id: AccountId,
        cap: U128,
        account_cap: U128,
        min_deposit: U128,
        buffer_bps: u16,
        max_util_bps: u16,
        safety_bps: u16,
        rhea: bool,
    ) {
        self.only_owner();
        let ceiling = known(token_id.as_str()).unwrap().2;
        let t = self.token_mut(&token_id);
        assert!(cap.0 <= ceiling && account_cap.0 <= cap.0, "Cap above ceiling");
        assert!(min_deposit.0 > 0, "Minimum deposit");
        assert!((2_000..=10_000).contains(&buffer_bps), "Buffer 20–100 %");
        assert!(max_util_bps <= 9_500, "Utilization cap at most 95 %");
        assert!((10..=1_000).contains(&safety_bps), "Safety buffer 0.1–10 %");
        assert!(!(t.lst && rhea), "LSTs are held, not lent");
        t.cap = cap.0;
        t.account_cap = account_cap.0;
        t.min_deposit = min_deposit.0;
        t.buffer_bps = buffer_bps;
        t.max_util_bps = max_util_bps;
        t.safety_bps = safety_bps;
        t.rhea = rhea;
    }

    /// New deposits only; existing tranches keep their unlock time.
    pub fn set_lock_hours(&mut self, hours: u64) {
        self.only_owner();
        assert!((24..=48).contains(&hours), "Lock 24–48 h");
        self.lock_ms = hours * HOUR_MS;
    }

    /// Stops new deposits, Rhea supply and harvest. Withdrawals stay open.
    pub fn set_deposits_paused(&mut self, paused: bool) {
        self.only_owner();
        self.deposits_paused = paused;
    }

    /// Registers this contract on a token (needed before players can deposit).
    #[payable]
    pub fn register_on_token(&mut self, token_id: AccountId) -> Promise {
        self.only_owner();
        self.find(&token_id).expect("Unknown token");
        Promise::new(token_id).function_call(
            "storage_deposit".to_string(),
            json!({ "account_id": env::current_account_id(), "registration_only": true })
                .to_string()
                .into_bytes(),
            env::attached_deposit(),
            tgas(10),
        )
    }

    /// Registers this contract on Rhea Lend (storage_deposit, 0.1 NEAR minimum).
    #[payable]
    pub fn register_on_rhea(&mut self) -> Promise {
        self.only_owner();
        Promise::new(self.rhea.clone()).function_call(
            "storage_deposit".to_string(),
            json!({ "account_id": env::current_account_id() }).to_string().into_bytes(),
            env::attached_deposit(),
            tgas(10),
        )
    }

    // ----- players -----

    /// NEP-141 receiver. `msg` must be "deposit"; anything else is refunded.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        assert!(msg == "deposit", "Unknown message");
        assert!(!self.deposits_paused, "Deposits paused");
        let t = self.find(&token_id).expect("Token not allowlisted");
        assert!(amount.0 >= t.min_deposit, "Below minimum deposit");
        if t.lst {
            let method = t.price_method.clone();
            return PromiseOrValue::Promise(
                Promise::new(token_id.clone())
                    .function_call(method, b"{}".to_vec(), NearToken::from_yoctonear(0), tgas(10))
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(tgas(15))
                            .on_lst_deposit(token_id, sender_id, amount),
                    ),
            );
        }
        if let Err(e) = self.credit(&token_id, &sender_id, amount.0, amount.0) {
            env::panic_str(e);
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Returns the unused amount (all of it on any failure, so the token refunds).
    #[private]
    pub fn on_lst_deposit(&mut self, token_id: AccountId, account_id: AccountId, amount: U128) -> U128 {
        let Some(price) = result_u128(0).filter(|p| *p > 0) else {
            return amount;
        };
        if self.deposits_paused {
            return amount;
        }
        let value = mul_div(amount.0, price, PRICE_SCALE);
        match self.credit(&token_id, &account_id, amount.0, value) {
            Ok(()) => U128(0),
            Err(e) => {
                env::log_str(e);
                amount
            }
        }
    }

    /// Withdraws unlocked principal (value units, see get_position). 1 yoctoNEAR.
    #[payable]
    pub fn withdraw(&mut self, token_id: AccountId, amount: U128) -> PromiseOrValue<bool> {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let key = Self::pkey(&account, &token_id);
        let mut p = self.positions.get(&key).expect("No position");
        p.fold(env::block_timestamp_ms());
        assert!(amount.0 > 0 && amount.0 <= p.free, "Amount is locked or above the position");
        let min = self.find(&token_id).expect("Unknown token").min_deposit;
        assert!(amount.0 >= min || amount.0 == p.free, "Below minimum withdrawal; withdraw all instead");
        p.free -= amount.0;
        let t = self.token_mut(&token_id);
        t.principal -= amount.0;
        if t.lst {
            t.pending += amount.0;
            let method = t.price_method.clone();
            self.save_position(&key, p);
            return PromiseOrValue::Promise(
                Promise::new(token_id.clone())
                    .function_call(method, b"{}".to_vec(), NearToken::from_yoctonear(0), tgas(10))
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(tgas(40))
                            .on_lst_withdraw(token_id, account, amount),
                    ),
            );
        }
        if t.q_head == t.q_tail && t.idle >= amount.0 {
            self.save_position(&key, p);
            return PromiseOrValue::Promise(self.pay(&token_id, &account, amount.0, amount.0));
        }
        // Not enough liquidity on hand: queue, paid by a permissionless `advance`.
        assert!(p.queued == 0, "A withdrawal is already queued");
        t.queued += amount.0;
        let idx = t.q_tail;
        t.q_tail += 1;
        p.queued += amount.0;
        self.save_position(&key, p);
        self.queue.insert(
            &format!("{}#{}", token_id, idx),
            &QueueEntry { account_id: account.clone(), amount },
        );
        env::log_str(&format!("queued {} {} for {}", amount.0, token_id, account));
        PromiseOrValue::Value(false)
    }

    #[private]
    pub fn on_lst_withdraw(&mut self, token_id: AccountId, account_id: AccountId, value: U128) -> PromiseOrValue<bool> {
        let price = result_u128(0).filter(|p| *p > 0);
        let t = self.token_mut(&token_id);
        t.pending -= value.0;
        let tokens = price
            .map(|price| {
                // Tokens worth the value at today's price, but never more than a
                // pro-rata share of what is held (an LST loss is shared).
                let total = t.principal + t.pending + value.0;
                mul_div(value.0, PRICE_SCALE, price).min(mul_div(value.0, t.idle, total))
            })
            .unwrap_or(0);
        if tokens == 0 {
            t.principal += value.0;
            self.restore(&account_id, &token_id, value.0);
            return PromiseOrValue::Value(false);
        }
        PromiseOrValue::Promise(self.pay(&token_id, &account_id, tokens, value.0))
    }

    #[private]
    pub fn on_paid(&mut self, token_id: AccountId, account_id: AccountId, tokens: U128, value: U128) -> bool {
        let ok = succeeded(0);
        let t = self.token_mut(&token_id);
        t.outgoing -= tokens.0;
        if !ok {
            t.idle += tokens.0;
            t.principal += value.0;
            self.restore(&account_id, &token_id, value.0);
        }
        ok
    }

    /// Pays queued stable withdrawals from the buffer, oldest first. Anyone.
    pub fn advance(&mut self, token_id: AccountId) -> u64 {
        let mut paid = 0;
        while paid < ADVANCE_BATCH {
            let t = self.token_mut(&token_id);
            if t.q_head == t.q_tail {
                break;
            }
            let k = format!("{}#{}", token_id, t.q_head);
            let e = self.queue.get(&k).unwrap();
            let t = self.token_mut(&token_id);
            if t.idle < e.amount.0 {
                break;
            }
            t.q_head += 1;
            t.queued -= e.amount.0;
            self.queue.remove(&k);
            let key = Self::pkey(&e.account_id, &token_id);
            let mut p = self.positions.get(&key).unwrap_or_default();
            p.queued -= e.amount.0;
            self.save_position(&key, p);
            // Paid principal is out of `principal` already; a failed payout
            // returns it to the player's free balance.
            let _ = self.pay(&token_id, &e.account_id, e.amount.0, e.amount.0);
            paid += 1;
        }
        paid
    }

    // ----- keepers (permissionless) -----

    /// Sends only the surplus above principal + safety buffer to the treasury.
    pub fn harvest(&mut self, token_id: AccountId) -> PromiseOrValue<bool> {
        assert!(!self.deposits_paused, "Paused");
        let nonce = self.start_op(&token_id, OP_HARVEST);
        let t = self.find(&token_id).unwrap();
        let cb = ext_self::ext(env::current_account_id())
            .with_static_gas(tgas(40))
            .on_harvest(token_id.clone(), U64(nonce));
        if t.lst {
            let method = t.price_method.clone();
            return PromiseOrValue::Promise(
                Promise::new(token_id)
                    .function_call(method, b"{}".to_vec(), NearToken::from_yoctonear(0), tgas(10))
                    .then(cb),
            );
        }
        PromiseOrValue::Promise(self.read_rhea(&token_id).then(cb))
    }

    #[private]
    pub fn on_harvest(&mut self, token_id: AccountId, nonce: U64) -> PromiseOrValue<bool> {
        self.check_op(&token_id, OP_HARVEST, nonce.0);
        let lst = self.find(&token_id).unwrap().lst;
        let surplus = if lst {
            result_u128(0).filter(|p| *p > 0).map(|price| {
                let t = self.find(&token_id).unwrap();
                let owed = mul_div_up(t.principal + t.pending, PRICE_SCALE, price);
                let keep = owed + bps(owed, t.safety_bps) + 1;
                t.idle.saturating_sub(keep)
            })
        } else {
            self.rhea_reading(&token_id).map(|(asset, supplied)| {
                let t = self.find(&token_id).unwrap();
                let in_rhea = asset.map(|a| supplied / a.scale()).unwrap_or(0);
                let owed = t.principal + t.queued;
                let keep = owed + bps(owed, t.safety_bps) + 1;
                (t.idle + in_rhea).saturating_sub(keep).min(t.idle.saturating_sub(t.queued))
            })
        };
        let t = self.token_mut(&token_id);
        let amount = surplus.unwrap_or(0);
        if amount < t.min_harvest {
            t.op = 0;
            return PromiseOrValue::Value(false);
        }
        t.idle -= amount;
        t.outgoing += amount;
        t.harvested += amount;
        let treasury = self.treasury.clone();
        env::log_str(&format!("harvest {} {} to {}", amount, token_id, treasury));
        PromiseOrValue::Promise(
            ext_ft::ext(token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(tgas(10))
                .ft_transfer(treasury, U128(amount), Some("questlayer yield".into()))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(tgas(10))
                        .on_harvest_paid(token_id, nonce, U128(amount)),
                ),
        )
    }

    #[private]
    pub fn on_harvest_paid(&mut self, token_id: AccountId, nonce: U64, amount: U128) -> bool {
        // Money first, even for a stale nonce (after reset_op): never strand it.
        let ok = succeeded(0);
        let t = self.token_mut(&token_id);
        t.outgoing -= amount.0;
        if !ok {
            t.idle += amount.0;
            t.harvested -= amount.0;
        }
        self.finish_op(&token_id, OP_HARVEST, nonce.0);
        ok
    }

    /// Moves a stable toward its buffer target: supplies the excess to Rhea
    /// (only if Rhea accepts deposits and utilization is under the cap), or
    /// withdraws from Rhea to refill the buffer and the queue.
    pub fn rebalance(&mut self, token_id: AccountId) -> Promise {
        assert!(!self.find(&token_id).expect("Unknown token").lst, "LSTs are held, not lent");
        let nonce = self.start_op(&token_id, OP_REBALANCE);
        self.read_rhea(&token_id).then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(tgas(150))
                .on_rebalance(token_id, U64(nonce)),
        )
    }

    #[private]
    pub fn on_rebalance(&mut self, token_id: AccountId, nonce: U64) -> PromiseOrValue<bool> {
        self.check_op(&token_id, OP_REBALANCE, nonce.0);
        let reading = self.rhea_reading(&token_id);
        let paused = self.deposits_paused;
        let rhea = self.rhea.clone();
        let t = self.token_mut(&token_id);
        let Some((Some(asset), supplied)) = reading else {
            t.op = 0;
            return PromiseOrValue::Value(false);
        };
        // With the Rhea strategy off, the target is everything: drain Rhea.
        let target = if t.rhea {
            t.queued + bps(t.principal + t.queued, t.buffer_bps)
        } else {
            u128::MAX
        };
        if t.rhea
            && !paused
            && t.idle > target.saturating_add(t.min_deposit)
            && asset.config.can_deposit
            && asset.util_bps() < t.max_util_bps as u128
        {
            let amount = t.idle - target;
            t.idle -= amount;
            t.outgoing += amount;
            return PromiseOrValue::Promise(
                ext_ft::ext(token_id.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(tgas(100))
                    .ft_transfer_call(rhea, U128(amount), None, String::new())
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(tgas(10))
                            .on_supplied(token_id, nonce, U128(amount)),
                    ),
            );
        }
        let scale = asset.scale();
        let in_rhea = supplied / scale;
        let want = target.saturating_sub(t.idle);
        let amount = want.min(in_rhea).min(asset.available() / scale);
        // Small moves are skipped (unless draining the rest) so the bounce
        // threshold below is far from a few blocks of interest.
        if t.inbound == 0
            && amount > 0
            && (amount >= t.min_deposit || amount == in_rhea)
            && asset.config.can_withdraw
        {
            let actions = json!({ "actions": [ { "Withdraw": {
                "token_id": token_id, "amount": U128(amount * scale) } } ] });
            return PromiseOrValue::Promise(
                Promise::new(rhea)
                    .function_call(
                        "execute".to_string(),
                        actions.to_string().into_bytes(),
                        NearToken::from_yoctonear(1),
                        tgas(80),
                    )
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(tgas(10))
                            .on_rhea_withdraw(
                                token_id,
                                nonce,
                                U128(amount),
                                U128(supplied - amount * scale / 2),
                            ),
                    ),
            );
        }
        t.op = 0;
        PromiseOrValue::Value(false)
    }

    #[private]
    pub fn on_supplied(&mut self, token_id: AccountId, nonce: U64, amount: U128) -> bool {
        // ft_transfer_call resolves to the amount Rhea kept; the rest was refunded.
        let used = result_u128(0).unwrap_or(0).min(amount.0);
        let t = self.token_mut(&token_id);
        t.outgoing -= amount.0;
        t.idle += amount.0 - used;
        self.finish_op(&token_id, OP_REBALANCE, nonce.0);
        used > 0
    }

    #[private]
    pub fn on_rhea_withdraw(&mut self, token_id: AccountId, nonce: U64, amount: U128, threshold: U128) -> bool {
        let ok = succeeded(0);
        let t = self.token_mut(&token_id);
        if ok {
            // Rhea sends the tokens in a separate receipt; `confirm_inbound`
            // decides later, from Rhea's own record, whether they left.
            if t.inbound == 0 {
                t.inbound_threshold = threshold.0;
            } else {
                // Only after reset_op: keep the stricter (lower) threshold.
                t.inbound_threshold = t.inbound_threshold.min(threshold.0);
            }
            t.inbound += amount.0;
            t.inbound_block = env::block_height();
        }
        self.finish_op(&token_id, OP_REBALANCE, nonce.0);
        ok
    }

    /// Settles a Rhea withdrawal from Rhea's own record, never from our token
    /// balance (which donations, refunds and in-flight transfers distort): if
    /// our supply is still well below its pre-withdrawal level, Rhea's transfer
    /// went through and the tokens are ours; if it is back, the transfer bounced.
    pub fn confirm_inbound(&mut self, token_id: AccountId) -> Promise {
        let t = self.find(&token_id).expect("Unknown token");
        assert!(t.inbound > 0, "Nothing inbound");
        assert!(
            env::block_height() > t.inbound_block + INBOUND_SETTLE_BLOCKS,
            "Rhea transfer still settling"
        );
        let nonce = self.start_op(&token_id, OP_CONFIRM);
        self.read_rhea(&token_id).then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(tgas(15))
                .on_confirm(token_id, U64(nonce)),
        )
    }

    #[private]
    pub fn on_confirm(&mut self, token_id: AccountId, nonce: U64) -> bool {
        self.check_op(&token_id, OP_CONFIRM, nonce.0);
        let reading = self.rhea_reading(&token_id);
        let t = self.token_mut(&token_id);
        t.op = 0;
        let Some((_, supplied)) = reading else { return false };
        let arrived = supplied < t.inbound_threshold;
        if arrived {
            t.idle += t.inbound;
        } else {
            env::log_str(&format!("inbound {} {} bounced; still in Rhea", t.inbound, token_id));
        }
        t.inbound = 0;
        t.inbound_threshold = 0;
        arrived
    }

    /// Frees a keeper slot whose callback never ran. Anyone, after 15 min.
    pub fn reset_op(&mut self, token_id: AccountId) {
        let now = env::block_timestamp_ms();
        let t = self.token_mut(&token_id);
        assert!(t.op != 0 && now >= t.op_ms + OP_TIMEOUT_MS, "Operation still fresh");
        t.op = 0;
    }

    // ----- views -----

    pub fn get_config(&self) -> Value {
        json!({
            "owner_id": self.owner,
            "treasury_id": self.treasury,
            "rhea_id": self.rhea,
            "lock_ms": U64(self.lock_ms),
            "deposits_paused": self.deposits_paused,
            "max_tranches": MAX_TRANCHES,
            "positions": self.position_count,
            "max_positions": MAX_POSITIONS,
        })
    }

    pub fn get_tokens(&self) -> Vec<Value> {
        self.tokens
            .iter()
            .map(|t| {
                json!({
                    "token_id": t.id,
                    "kind": if t.lst { "lst" } else { "stable" },
                    "value_unit": if t.lst { "yoctoNEAR" } else { "token" },
                    "price_source": if t.lst {
                        json!({ "contract": t.id, "method": t.price_method, "scale": U128(PRICE_SCALE) })
                    } else { Value::Null },
                    "strategy": if t.rhea { "rhea" } else { "hold" },
                    "cap": U128(t.cap),
                    "account_cap": U128(t.account_cap),
                    "min_deposit": U128(t.min_deposit),
                    "buffer_bps": t.buffer_bps,
                    "max_util_bps": t.max_util_bps,
                    "safety_bps": t.safety_bps,
                    "principal": U128(t.principal),
                    "pending": U128(t.pending),
                    "queued": U128(t.queued),
                    "idle": U128(t.idle),
                    "outgoing": U128(t.outgoing),
                    "inbound": U128(t.inbound),
                    "harvested": U128(t.harvested),
                    "deposits": t.deposits,
                    "queue_length": t.q_tail - t.q_head,
                    "op": t.op,
                })
            })
            .collect()
    }

    /// Per token: principal counts for Staker at once; tranches carry their unlock time.
    pub fn get_position(&self, account_id: AccountId) -> Vec<Value> {
        let now = env::block_timestamp_ms();
        self.tokens
            .iter()
            .filter_map(|t| {
                let mut p = self.positions.get(&Self::pkey(&account_id, &t.id))?;
                p.fold(now);
                Some(json!({
                    "token_id": t.id,
                    "kind": if t.lst { "lst" } else { "stable" },
                    "value_unit": if t.lst { "yoctoNEAR" } else { "token" },
                    "principal": U128(p.total()),
                    "withdrawable": U128(p.free),
                    "tranches": p.tranches,
                    "queued": U128(p.queued),
                }))
            })
            .collect()
    }

    pub fn get_queue(&self, token_id: AccountId, limit: u64) -> Vec<QueueEntry> {
        let t = self.find(&token_id).expect("Unknown token");
        (t.q_head..t.q_tail.min(t.q_head + limit.min(50)))
            .filter_map(|i| self.queue.get(&format!("{}#{}", token_id, i)))
            .collect()
    }

    // ----- internals -----

    fn only_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }
    fn pkey(account: &AccountId, token: &AccountId) -> String {
        format!("{}#{}", account, token)
    }
    fn find(&self, id: &AccountId) -> Option<&Token> {
        self.tokens.iter().find(|t| &t.id == id)
    }
    fn token_mut(&mut self, id: &AccountId) -> &mut Token {
        self.tokens.iter_mut().find(|t| &t.id == id).expect("Unknown token")
    }
    fn save_position(&mut self, key: &String, p: Position) {
        if p.total() == 0 && p.queued == 0 {
            if self.positions.remove(key).is_some() {
                self.position_count -= 1;
            }
        } else if self.positions.insert(key, &p).is_none() {
            self.position_count += 1;
        }
    }
    fn restore(&mut self, account: &AccountId, token: &AccountId, value: u128) {
        let key = Self::pkey(account, token);
        let mut p = self.positions.get(&key).unwrap_or_default();
        p.free += value;
        self.save_position(&key, p);
    }
    fn credit(&mut self, token_id: &AccountId, account: &AccountId, tokens: u128, value: u128) -> Result<(), &'static str> {
        let now = env::block_timestamp_ms();
        let until = now + self.lock_ms;
        let key = Self::pkey(account, token_id);
        let mut p = self.positions.get(&key).unwrap_or_default();
        p.fold(now);
        let t = self.token_mut(token_id);
        if value == 0 {
            return Err("Deposit too small");
        }
        if t.principal + t.pending + t.queued + value > t.cap {
            return Err("Token cap reached");
        }
        if p.total() + p.queued + value > t.account_cap {
            return Err("Account cap reached");
        }
        if p.total() == 0 && p.queued == 0 && self.position_count >= MAX_POSITIONS {
            return Err("Vault is full (testnet position limit)");
        }
        let t = self.token_mut(token_id);
        if p.tranches.len() >= MAX_TRANCHES {
            return Err("Too many locked deposits; wait for one to unlock");
        }
        t.principal += value;
        t.idle += tokens;
        t.deposits += 1;
        p.tranches.push(Tranche { amount: U128(value), locked_until_ms: U64(until) });
        self.save_position(&key, p);
        env::log_str(&format!("deposit {} {} by {} value {}", tokens, token_id, account, value));
        Ok(())
    }
    fn pay(&mut self, token_id: &AccountId, account: &AccountId, tokens: u128, value: u128) -> Promise {
        let t = self.token_mut(token_id);
        t.idle -= tokens;
        t.outgoing += tokens;
        ext_ft::ext(token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(tgas(10))
            .ft_transfer(account.clone(), U128(tokens), Some("questlayer withdraw".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(tgas(10))
                    .on_paid(token_id.clone(), account.clone(), U128(tokens), U128(value)),
            )
    }
    fn start_op(&mut self, token_id: &AccountId, op: u8) -> u64 {
        let now = env::block_timestamp_ms();
        let t = self.token_mut(token_id);
        assert_eq!(t.op, 0, "Another keeper operation is running");
        t.op = op;
        t.op_nonce += 1;
        t.op_ms = now;
        t.op_nonce
    }
    /// Clears the slot only if it is still this operation (a stale callback
    /// after reset_op must not end a newer one).
    fn finish_op(&mut self, token_id: &AccountId, op: u8, nonce: u64) {
        let t = self.token_mut(token_id);
        if t.op == op && t.op_nonce == nonce {
            t.op = 0;
        }
    }
    fn check_op(&self, token_id: &AccountId, op: u8, nonce: u64) {
        let t = self.find(token_id).expect("Unknown token");
        assert!(t.op == op && t.op_nonce == nonce, "Stale callback");
    }
    fn read_rhea(&self, token_id: &AccountId) -> Promise {
        let me = env::current_account_id();
        Promise::new(self.rhea.clone())
            .function_call(
                "get_asset".to_string(),
                json!({ "token_id": token_id }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                tgas(10),
            )
            .and(Promise::new(self.rhea.clone()).function_call(
                "get_account".to_string(),
                json!({ "account_id": me }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                tgas(10),
            ))
    }
    /// (asset, our supplied balance in Rhea's inner units). None when a read
    /// failed; a token never supplied reads as zero.
    fn rhea_reading(&self, token_id: &AccountId) -> Option<(Option<RheaAsset>, u128)> {
        let asset = serde_json::from_slice::<Option<RheaAsset>>(&result_bytes(0)?).ok()?;
        let account = serde_json::from_slice::<Option<RheaAccount>>(&result_bytes(1)?).ok()?;
        let supplied = account
            .and_then(|a| a.supplied.into_iter().find(|s| &s.token_id == token_id))
            .map(|s| s.balance.0)
            .unwrap_or(0);
        if asset.is_none() && supplied > 0 {
            return None;
        }
        Some((asset, supplied))
    }
}

#[cfg(test)]
mod tests;
