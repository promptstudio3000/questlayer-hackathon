//! QGOLD: the QuestLayer gold token and the vault that backs it, in one
//! contract (testnet only, unaudited). Design: docs/QGOLD-VAULT.md.
//!
//! - QGOLD is a transferable NEP-141 (6 decimals) with NEP-145 storage and a
//!   holder `ft_burn` that carries a memo (in-game spending burns QGOLD).
//! - Every QGOLD is a share of `backing`, the NEAR this contract holds for it.
//!   R = backing / supply, in yoctoNEAR per whole QGOLD. R never falls through
//!   any call here: mints round down, redeems round down, burns raise it.
//! - QGOLD is minted only against NEAR that arrives in the same call:
//!   `mint_for` (approved minters, e.g. the rewards contract paying a coin, no
//!   fee) and `deposit` (anyone, R + 1 %). There is no other mint.
//! - `redeem` burns the caller's QGOLD first and pays exactly its share at
//!   R - 1 %. Instant exits are capped per 24 h globally and per account; the
//!   rest waits in a queue for a 24-48 h safe window and is then paid by
//!   `claim_exit` to the account that burned, never to anyone else.
//! - Fees: 10 % to the insurance fund, the rest to the fixed treasury account.
//! - No admin withdraw exists. The guardian (and any council member) can only
//!   pause, for at most 72 h and once per 7 days per account; unpausing and
//!   cancelling a proposal take the council threshold. Upgrades and parameter
//!   changes go through the council (multisig threshold) and a fixed 48 h timelock.
//! - Every state change ends in `after_change()`: the contract balance must
//!   cover backing + insurance + treasury fees + queued exits (less their
//!   storage bonds) + refundable storage deposits + unconverted game earnings
//!   + storage cost. A drain by any bug makes every later call fail until
//!   `reconcile()` books the missing money as a loss (insurance first) and
//!   refills R from the insurance fund. Storage is never a loss: sponsored
//!   records stop at `MIN_OPERATING_SLACK` and `fund_operating()` refills it.
//! - A burn or redeem leaves no supply or at least `MIN_SUPPLY`, and `r_peak`
//!   returns to the initial rate once nobody holds QGOLD (H1 of the 8 Nov review).
use near_sdk::{
    collections::LookupMap,
    env, ext_contract,
    json_types::{Base64VecU8, U128, U64},
    near,
    serde_json::{self, json, Value},
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

pub const ONE: u128 = 1_000_000; // 1 QGOLD at 6 decimals
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const BPS: u128 = 10_000;
pub const DAY_MS: u64 = 86_400_000;
pub const HOUR_MS: u64 = 3_600_000;
/// Fixed upgrade / parameter timelock (Lubos's hard rule: 48 h).
pub const TIMELOCK_MS: u64 = 48 * HOUR_MS;
/// Shortest council timelock on a `.testnet` account (council-set, `SetTimelock`).
pub const MIN_TESTNET_TIMELOCK_MS: u64 = 10 * 60_000;
/// Shortest council timelock on any other account: mainnet keeps a real delay.
pub const MIN_MAINNET_TIMELOCK_MS: u64 = 24 * HOUR_MS;
/// Longest council timelock on every network.
pub const MAX_TIMELOCK_MS: u64 = 48 * HOUR_MS;
/// A guardian or council pause lasts at most this long unless renewed.
pub const MAX_PAUSE_MS: u64 = 72 * HOUR_MS;
/// Deposit (buy) and redeem (sell) fee: 1 % each, for everyone.
pub const DEPOSIT_FEE_BPS: u128 = 100;
pub const REDEEM_FEE_BPS: u128 = 100;
/// Share of every fee that goes to the insurance fund.
pub const INSURANCE_SHARE_BPS: u128 = 1_000;
/// NEP-145 registration: about 160 bytes of holder record.
pub const STORAGE_FEE: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR
/// Smallest redeem, against dust exits that only cost storage.
pub const MIN_REDEEM: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR
pub const MAX_OPEN_EXITS: usize = 20;
pub const MAX_MEMO: usize = 200;
pub const MAX_COUNCIL: usize = 9;
pub const MAX_MINTERS: usize = 8;
/// A burn or redeem leaves either no supply at all or at least this much. A
/// near-100 % holder could otherwise leave one unit behind a large backing,
/// which makes R so high that ordinary coins mint nothing (H1).
pub const MIN_SUPPLY: u128 = ONE;
/// Storage bond held out of a queued exit while its record exists; it is paid
/// back with the claim. Sized for a 64-byte account id (see tests).
pub const EXIT_STORAGE_BOND: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR
/// A lifetime grant pays for the holder record and its grant marker. It is
/// not refundable to anyone, so it is not an obligation.
pub const SPONSORED_STORAGE_FEE: u128 = 2 * STORAGE_FEE; // 0.0025 NEAR
/// Contract-paid storage (sponsored holder records, game conversion receipts)
/// may not take the operating slack below this; `fund_operating` refills it.
pub const MIN_OPERATING_SLACK: u128 = NEAR / 10;
/// Anyone may prune a game conversion receipt this long after it was written.
pub const RECEIPT_RETENTION_MS: u64 = 30 * DAY_MS;
/// One guardian or council account can start or extend a pause once per this.
pub const PAUSE_COOLDOWN_MS: u64 = 7 * DAY_MS;
const PAY_GAS: Gas = Gas::from_tgas(10);
const RESOLVE_GAS: Gas = Gas::from_tgas(10);
const RECEIVER_GAS: Gas = Gas::from_tgas(35);

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "Division by zero");
    let r = primitive_types::U256::from(a) * primitive_types::U256::from(b) / primitive_types::U256::from(c);
    assert!(r <= primitive_types::U256::from(u128::MAX), "Overflow");
    r.as_u128()
}
fn mul_div_up(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "Division by zero");
    let n = primitive_types::U256::from(a) * primitive_types::U256::from(b);
    let c = primitive_types::U256::from(c);
    let r = (n + c - 1) / c;
    assert!(r <= primitive_types::U256::from(u128::MAX), "Overflow");
    r.as_u128()
}
fn now_ms() -> u64 {
    env::block_timestamp_ms()
}
fn s(v: u128) -> String {
    v.to_string()
}
// Namespaced external state keeps the deployed contract layout unchanged.
// Unconverted game earnings are liabilities, never backing or insurance.
const MINT_CARRY_TOTAL:&[u8]=b"world-mint-carry-total";
/// Sum of the storage bonds held out of open queued exits.
const EXIT_BOND_TOTAL: &[u8] = b"exit-bond-total";
/// Council timelock in force, as little-endian u64 ms. Absent = `TIMELOCK_MS`.
const COUNCIL_TIMELOCK: &[u8] = b"council-timelock-ms";
fn timelock_ms() -> u64 {
    env::storage_read(COUNCIL_TIMELOCK).map(|b| u64::from_le_bytes(b.try_into().expect("Invalid stored timelock"))).unwrap_or(TIMELOCK_MS)
}
/// Allowed timelock range for the current account: 10 min-48 h on `.testnet`,
/// 24-48 h everywhere else.
fn timelock_bounds() -> (u64, u64) {
    let min = if env::current_account_id().as_str().ends_with(".testnet") { MIN_TESTNET_TIMELOCK_MS } else { MIN_MAINNET_TIMELOCK_MS };
    (min, MAX_TIMELOCK_MS)
}
fn validate_timelock(ms: u64) {
    let (min, max) = timelock_bounds();
    assert!((min..=max).contains(&ms), "timelock_ms must be {min}-{max} ms on this account");
}
fn stored_amount(key:&[u8])->u128 {
    env::storage_read(key).map(|b|u128::from_le_bytes(b.try_into().expect("Invalid stored amount"))).unwrap_or(0)
}
fn write_amount(key: &[u8], v: u128) {
    if v == 0 {
        env::storage_remove(key);
    } else {
        env::storage_write(key, &v.to_le_bytes());
    }
}
fn mint_carry_key(minter:&AccountId,account:&AccountId)->Vec<u8>{format!("world-mint-carry:{minter}:{account}").into_bytes()}
fn receipt_key(minter: &AccountId, memo: &str) -> Vec<u8> {
    format!("world-mint-receipt:{minter}:{memo}").into_bytes()
}
/// Bond per open exit id (prefix `eb`).
fn exit_bonds() -> LookupMap<u64, u128> {
    LookupMap::new(b"eb".to_vec())
}
/// Council cancel votes per proposal id (prefix `cv`).
fn cancel_votes() -> LookupMap<u64, Vec<AccountId>> {
    LookupMap::new(b"cv".to_vec())
}
/// Council unpause votes per pause instance (`paused_until`, prefix `uv`).
fn unpause_votes() -> LookupMap<u64, Vec<AccountId>> {
    LookupMap::new(b"uv".to_vec())
}
/// When each guardian or council account last called `pause` (prefix `lp`).
fn last_pause() -> LookupMap<AccountId, u64> {
    LookupMap::new(b"lp".to_vec())
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

/// Exit limits. Changed only by a council proposal (48 h timelock), always
/// inside the bounds in `Params::validate`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    /// Instant exits per 24 h window, in bps of the backing at window start.
    pub instant_cap_bps: u16,
    /// ...but at least this much NEAR, so a young, small vault is still usable.
    pub instant_floor: U128,
    /// Instant exits per account per 24 h, in bps of the same backing...
    pub account_cap_bps: u16,
    /// ...but at least this much NEAR (small players always exit at once).
    pub account_floor: U128,
    /// Queue wait before a queued exit can be claimed.
    pub safe_window_ms: U64,
}
impl Params {
    pub fn defaults() -> Self {
        Self { instant_cap_bps: 500, instant_floor: U128(NEAR), account_cap_bps: 100, account_floor: U128(NEAR / 5), safe_window_ms: U64(24 * HOUR_MS) }
    }
    fn validate(&self) {
        assert!((100..=1_000).contains(&self.instant_cap_bps), "instant_cap_bps is 100-1000");
        assert!((10..=500).contains(&self.account_cap_bps), "account_cap_bps is 10-500");
        assert!(self.instant_floor.0 <= 10 * NEAR, "instant_floor is at most 10 NEAR");
        assert!(self.account_floor.0 <= self.instant_floor.0.max(NEAR), "account_floor is at most instant_floor");
        assert!((24 * HOUR_MS..=48 * HOUR_MS).contains(&self.safe_window_ms.0), "safe_window_ms is 24-48 h");
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Upgrade { code_sha256: String },
    SetParams { params: Params },
    SetGuardian { account_id: AccountId },
    SetTreasury { account_id: AccountId },
    SetMinter { account_id: AccountId, allowed: bool },
    SetCouncil { members: Vec<AccountId>, threshold: u8 },
    /// Sets the council timelock for proposals made after it executes.
    /// Appended last so stored proposals keep their Borsh tags.
    SetTimelock { timelock_ms: U64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub action: Action,
    pub proposer: AccountId,
    pub approvals: Vec<AccountId>,
    pub created_at: U64,
    pub executable_at: U64,
    pub done: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
struct Holder {
    balance: u128,
    /// Refundable NEP-145 deposit (0 when the game sponsored the record).
    storage_paid: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
struct Window {
    start: u64,
    used: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Exit {
    pub id: u64,
    pub account_id: AccountId,
    /// QGOLD that was burned for this exit.
    pub qgold: U128,
    /// NEAR share taken out of the backing (before the 1 % fee).
    pub gross: U128,
    pub created_at: U64,
    pub ready_at: U64,
    /// A retried payout whose fee was already taken.
    pub fee_free: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RedeemResult {
    /// "paid" (instant transfer sent) or "queued".
    pub status: String,
    pub qgold: U128,
    pub gross: U128,
    pub fee: U128,
    pub amount: U128,
    pub exit_id: Option<U64>,
    pub ready_at: Option<U64>,
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait SelfCallbacks {
    fn on_payout(&mut self, account_id: AccountId, amount: U128, qgold: U128) -> bool;
    fn on_flushed(&mut self, amount: U128) -> bool;
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128;
}

#[allow(dead_code)]
#[ext_contract(ext_receiver)]
trait FungibleTokenReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct QGold {
    metadata: FungibleTokenMetadata,
    council: Vec<AccountId>,
    threshold: u8,
    guardian: AccountId,
    treasury: AccountId,
    minters: Vec<AccountId>,
    params: Params,
    holders: LookupMap<AccountId, Holder>,
    holder_count: u64,
    supply: u128,
    backing: u128,
    insurance: u128,
    treasury_due: u128,
    queued: u128,
    in_flight: u128,
    storage_deposits: u128,
    initial_rate: u128,
    r_peak: u128,
    minted_total: u128,
    burned_total: u128,
    redeemed_total: u128,
    fees_total: u128,
    losses_total: u128,
    refilled_total: u128,
    window: Window,
    window_base: u128,
    account_windows: LookupMap<AccountId, Window>,
    exits: LookupMap<u64, Exit>,
    account_exits: LookupMap<AccountId, Vec<u64>>,
    next_exit: u64,
    open_exits: u64,
    paused_until: u64,
    proposals: LookupMap<u64, Proposal>,
    next_proposal: u64,
}

#[near]
impl QGold {
    #[init]
    pub fn new(
        council: Vec<AccountId>,
        threshold: u8,
        guardian_id: AccountId,
        treasury_id: AccountId,
        minters: Vec<AccountId>,
        initial_rate: U128,
        metadata: FungibleTokenMetadata,
    ) -> Self {
        assert!(env::current_account_id().as_str().ends_with(".testnet"), "Testnet only");
        assert_eq!(metadata.spec, "ft-1.0.0", "Metadata spec must be ft-1.0.0");
        assert_eq!(metadata.decimals, 6, "QGOLD has 6 decimals");
        assert!(!metadata.symbol.is_empty() && metadata.symbol.len() <= 12, "Symbol is 1-12 bytes");
        assert!(initial_rate.0 > 0, "Initial rate must be positive");
        assert!(minters.len() <= MAX_MINTERS, "Too many minters");
        let mut c = Self {
            metadata,
            council: Vec::new(),
            threshold: 1,
            guardian: guardian_id,
            treasury: treasury_id,
            minters,
            params: Params::defaults(),
            holders: LookupMap::new(b"h".to_vec()),
            holder_count: 0,
            supply: 0,
            backing: 0,
            insurance: 0,
            treasury_due: 0,
            queued: 0,
            in_flight: 0,
            storage_deposits: 0,
            initial_rate: initial_rate.0,
            r_peak: initial_rate.0,
            minted_total: 0,
            burned_total: 0,
            redeemed_total: 0,
            fees_total: 0,
            losses_total: 0,
            refilled_total: 0,
            window: Window::default(),
            window_base: 0,
            account_windows: LookupMap::new(b"w".to_vec()),
            exits: LookupMap::new(b"e".to_vec()),
            account_exits: LookupMap::new(b"x".to_vec()),
            next_exit: 1,
            open_exits: 0,
            paused_until: 0,
            proposals: LookupMap::new(b"p".to_vec()),
            next_proposal: 1,
        };
        c.set_council(council, threshold);
        c
    }

    /// Code-only upgrade target (the state layout is unchanged). A layout change
    /// ships its own migration in that release.
    ///
    /// On a `.testnet` account that never set a council timelock, the upgrade
    /// that introduces `SetTimelock` also sets it to 10 min, so testnet waits
    /// 48 h only once. Any other account, or a stored value, is left as it is.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let c: Self = env::state_read().expect("No state");
        if env::current_account_id().as_str().ends_with(".testnet") && !env::storage_has_key(COUNCIL_TIMELOCK) {
            env::storage_write(COUNCIL_TIMELOCK, &MIN_TESTNET_TIMELOCK_MS.to_le_bytes());
            c.event("timelock_set", json!({"timelock_ms": U64(MIN_TESTNET_TIMELOCK_MS), "by": "migrate"}));
        }
        c
    }

    // ------------------------------------------------------------- minting

    /// Mints QGOLD at exactly R for the attached NEAR, with no fee. Approved
    /// minters only (the rewards contract pays a collected coin here). The
    /// holder record is sponsored from the contract's operating balance.
    #[payable]
    pub fn mint_for(&mut self, account_id: AccountId, memo: Option<String>) -> U128 {
        self.assert_running();
        assert!(self.minters.contains(&env::predecessor_account_id()), "Approved minter only");
        if let Some(m) = &memo {
            assert!(m.len() <= MAX_MEMO, "Memo is at most {MAX_MEMO} bytes");
        }
        let b = env::attached_deposit().as_yoctonear();
        let q = self.shares_for(b);
        assert!(q > 0, "Amount below one QGOLD unit");
        self.backing += b;
        let sponsored = self.holders.get(&account_id).is_none();
        self.ensure_holder(&account_id, 0);
        self.credit(&account_id, q, memo);
        self.after_change();
        if sponsored {
            self.assert_operating_slack();
        }
        U128(q)
    }

    /// Converts game earnings at the actual receipt-time ratio. The fraction
    /// below a token unit remains a covered NEAR credit for this exact account
    /// and approved minter, and joins its next conversion. No refund promise
    /// or stale exchange-rate quote can lose or duplicate that remainder.
    #[payable]
    pub fn mint_with_carry_for(&mut self,account_id:AccountId,memo:Option<String>)->Value {
        self.assert_running();let minter=env::predecessor_account_id();
        assert!(self.minters.contains(&minter),"Approved minter only");
        let receipt=memo.as_ref().expect("A unique game conversion memo is required");
        assert!(!receipt.is_empty()&&receipt.len()<=MAX_MEMO,"Invalid conversion memo");
        let receipt_key=receipt_key(&minter,receipt);
        assert!(!env::storage_has_key(&receipt_key),"Game conversion already recorded");
        let key=mint_carry_key(&minter,&account_id);let previous=stored_amount(&key);
        let deposit=env::attached_deposit().as_yoctonear();
        let input=previous.checked_add(deposit).expect("Mint carry overflow");assert!(input>0,"No earning to convert");
        let q=self.shares_for(input);
        let used=if q==0{0}else if self.supply==0{mul_div_up(q,self.rate(),ONE)}else{mul_div_up(q,self.backing,self.supply)};
        assert!(used<=input,"Conversion exceeds earnings");let carry=input-used;
        let total=stored_amount(MINT_CARRY_TOTAL).checked_sub(previous).expect("Carry total mismatch").checked_add(carry).expect("Carry total overflow");
        if carry==0{env::storage_remove(&key);}else{env::storage_write(&key,&carry.to_le_bytes());}
        env::storage_write(MINT_CARRY_TOTAL,&total.to_le_bytes());
        if q>0{self.backing=self.backing.checked_add(used).expect("Backing overflow");self.ensure_holder(&account_id,0);self.credit(&account_id,q,memo);}
        let result=json!({"minter":minter,"account_id":account_id,"depositedYocto":s(deposit),"previousCarryYocto":s(previous),"consumedYocto":s(used),"carryYocto":s(carry),"qgoldU":s(q),"ts":now_ms()});
        env::storage_write(&receipt_key,&near_sdk::serde_json::to_vec(&result).expect("Conversion receipt"));
        self.after_change();
        // The receipt (and a first holder record) is contract-paid storage.
        self.assert_operating_slack();
        self.event("game_earning_converted",result.clone());result
    }
    /// A finalized receipt survives a worker losing the transaction response.
    pub fn get_game_conversion(&self,minter_id:AccountId,memo:String)->Option<Value>{
        assert!(memo.len()<=MAX_MEMO,"Memo too long");
        env::storage_read(&receipt_key(&minter_id,&memo)).map(|b|near_sdk::serde_json::from_slice(&b).expect("Conversion receipt"))
    }
    /// Frees a conversion receipt older than `RECEIPT_RETENTION_MS`. Anyone may
    /// call it: the receipt only served the worker's recovery window, and the
    /// rewards contract never pays the same leaf twice, so the minter cannot
    /// replay a pruned memo with new NEAR by accident.
    pub fn prune_game_conversion(&mut self, minter_id: AccountId, memo: String) {
        assert!(memo.len() <= MAX_MEMO, "Memo too long");
        let key = receipt_key(&minter_id, &memo);
        let bytes = env::storage_read(&key).expect("Unknown conversion receipt");
        let v: Value = serde_json::from_slice(&bytes).expect("Conversion receipt");
        let ts = v["ts"].as_u64().unwrap_or(0);
        assert!(now_ms() >= ts + RECEIPT_RETENTION_MS, "Receipt is still within its retention window");
        env::storage_remove(&key);
        self.event("conversion_receipt_pruned", json!({"minter": minter_id, "memo": memo}));
    }

    /// Adds NEAR to the operating balance that pays for contract-sponsored
    /// storage (holder records of `mint_for`, conversion receipts). It is not
    /// owed to anyone; `audit().operating_slack` shows what is left. It never
    /// fails on the invariant: more NEAR cannot make the books worse, and it
    /// is how a storage-frozen vault is unfrozen.
    #[payable]
    pub fn fund_operating(&mut self) {
        let d = env::attached_deposit().as_yoctonear();
        assert!(d > 0, "Attach NEAR");
        self.event("operating_funded", json!({"sender": env::predecessor_account_id(), "amount": s(d), "operating_slack": s(self.operating_slack())}));
    }
    pub fn get_mint_carry(&self,minter_id:AccountId,account_id:AccountId)->U128 {U128(stored_amount(&mint_carry_key(&minter_id,&account_id)))}

    /// Buys QGOLD: the attached NEAR minus the 1 % fee is added to the backing
    /// and mints at R. A new holder's NEP-145 fee is taken from the deposit.
    #[payable]
    pub fn deposit(&mut self, min_out: Option<U128>, receiver_id: Option<AccountId>) -> U128 {
        self.assert_running();
        let receiver = receiver_id.unwrap_or_else(env::predecessor_account_id);
        let mut d = env::attached_deposit().as_yoctonear();
        if self.holders.get(&receiver).is_none() {
            assert!(d > STORAGE_FEE, "Deposit must also cover the storage fee");
            d -= STORAGE_FEE;
            self.ensure_holder(&receiver, STORAGE_FEE);
        }
        let fee = mul_div(d, DEPOSIT_FEE_BPS, BPS);
        let net = d - fee;
        let q = self.shares_for(net);
        assert!(q > 0, "Amount below one QGOLD unit");
        assert!(q >= min_out.map(|m| m.0).unwrap_or(0), "Price moved: less than min_out");
        self.backing += net;
        self.take_fee(fee);
        self.credit(&receiver, q, Some("deposit".into()));
        self.event("deposit", json!({"account_id": receiver, "near": s(d), "fee": s(fee), "qgold": s(q)}));
        self.after_change();
        U128(q)
    }

    // ------------------------------------------------------------- exits

    /// Sells QGOLD back to the vault at R - 1 %. Burns the caller's QGOLD first.
    /// `path`: "near_instant" (default; falls into the queue above the caps),
    /// "near_queue", or "lst" (not enabled yet). `min_out` bounds the NEAR paid.
    #[payable]
    pub fn redeem(&mut self, amount: U128, path: Option<String>, min_out: Option<U128>) -> RedeemResult {
        near_sdk::assert_one_yocto();
        self.assert_running();
        let account_id = env::predecessor_account_id();
        let path = path.unwrap_or_else(|| "near_instant".into());
        assert!(path == "near_instant" || path == "near_queue", "Exit path not enabled: {path}");
        let q = amount.0;
        assert!(q > 0 && self.supply > 0, "Nothing to redeem");
        self.assert_no_dust_supply_after(q);
        self.roll_window();
        let gross = mul_div(q, self.backing, self.supply);
        assert!(gross >= MIN_REDEEM, "Redeem at least 0.001 NEAR");
        let fee = mul_div(gross, REDEEM_FEE_BPS, BPS);
        let net = gross - fee;
        assert!(net >= min_out.map(|m| m.0).unwrap_or(0), "Price moved: less than min_out");
        let instant = path == "near_instant" && self.fits_instant(&account_id, gross);
        if !instant {
            // The record's storage is held out of the exit itself until the claim.
            assert!(net >= EXIT_STORAGE_BOND, "A queued exit is at least 0.005 NEAR after the fee (its storage bond)");
        }
        // Burn first: the caller's balance is the only source.
        self.debit(&account_id, q);
        self.supply -= q;
        self.backing -= gross;
        self.redeemed_total += q;
        let result = if instant {
            self.use_instant(&account_id, gross);
            self.take_fee(fee);
            self.in_flight += net;
            RedeemResult { status: "paid".into(), qgold: U128(q), gross: U128(gross), fee: U128(fee), amount: U128(net), exit_id: None, ready_at: None }
        } else {
            let (id, ready) = self.queue_exit(&account_id, q, gross, false);
            RedeemResult { status: "queued".into(), qgold: U128(q), gross: U128(gross), fee: U128(fee), amount: U128(net), exit_id: Some(U64(id)), ready_at: Some(U64(ready)) }
        };
        self.ft_event("ft_burn", &account_id, q, Some(format!("redeem {path}")));
        self.event("redeem", json!({"account_id": account_id, "qgold": s(q), "gross": s(gross), "fee": s(fee), "amount": s(net), "status": result.status, "exit_id": result.exit_id}));
        self.after_change();
        if instant {
            self.pay(account_id, net, q);
        }
        result
    }

    /// Pays a queued exit after its safe window. Anyone may call; the NEAR goes
    /// only to the account that burned the QGOLD.
    pub fn claim_exit(&mut self, exit_id: U64) -> U128 {
        self.assert_running();
        let e = self.exits.get(&exit_id.0).expect("Unknown exit");
        assert!(now_ms() >= e.ready_at.0, "Exit is still in its safe window");
        let bond = self.remove_exit(&e);
        let gross = e.gross.0;
        // The bond was never in `queued`; the freed record pays it back here.
        self.queued -= gross - bond;
        let fee = if e.fee_free { 0 } else { mul_div(gross, REDEEM_FEE_BPS, BPS) };
        self.take_fee(fee);
        let net = gross - fee;
        self.in_flight += net;
        self.event("exit_claimed", json!({"exit_id": U64(e.id), "account_id": e.account_id, "amount": s(net), "fee": s(fee)}));
        self.after_change();
        self.pay(e.account_id.clone(), net, e.qgold.0);
        U128(net)
    }

    /// Council member, only while paused: cancels a queued exit during an
    /// incident. The NEAR goes back to the backing and the same QGOLD is minted
    /// back to the same account. Nothing leaves the contract.
    pub fn void_exit(&mut self, exit_id: U64) {
        self.assert_council();
        assert!(self.is_paused(), "Only while paused");
        let e = self.exits.get(&exit_id.0).expect("Unknown exit");
        let bond = self.remove_exit(&e);
        self.queued -= e.gross.0 - bond;
        self.backing += e.gross.0;
        self.redeemed_total -= e.qgold.0.min(self.redeemed_total);
        self.ensure_holder(&e.account_id, 0);
        self.credit(&e.account_id, e.qgold.0, Some("exit voided".into()));
        self.event("exit_voided", json!({"exit_id": exit_id, "account_id": e.account_id, "qgold": e.qgold}));
        self.after_change();
    }

    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: U128, qgold: U128) -> bool {
        self.in_flight -= amount.0;
        let ok = !matches!(env::promise_result_checked(0, 0), Err(near_sdk::PromiseError::Failed));
        if !ok {
            // The NEAR came back (or will): keep it claimable by the same account.
            let (id, _) = self.queue_exit_ready(&account_id, qgold.0, amount.0);
            self.event("payout_failed", json!({"account_id": account_id, "amount": amount, "exit_id": U64(id)}));
        }
        ok
    }

    // ------------------------------------------------------------- burning

    /// Burns the caller's QGOLD (in-game spending). The backing stays, so R rises.
    #[payable]
    pub fn ft_burn(&mut self, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        self.assert_running();
        if let Some(m) = &memo {
            assert!(m.len() <= MAX_MEMO, "Memo is at most {MAX_MEMO} bytes");
        }
        let account_id = env::predecessor_account_id();
        assert!(amount.0 > 0, "Burn amount must be positive");
        self.assert_no_dust_supply_after(amount.0);
        self.debit(&account_id, amount.0);
        self.supply -= amount.0;
        self.burned_total += amount.0;
        self.ft_event("ft_burn", &account_id, amount.0, memo);
        self.after_change();
    }

    // ------------------------------------------------------------- fees and insurance

    /// Adds NEAR to the insurance fund (10 % of every outside fee comes here).
    #[payable]
    pub fn fund_insurance(&mut self) {
        let d = env::attached_deposit().as_yoctonear();
        assert!(d > 0, "Attach NEAR");
        self.insurance += d;
        self.event("insurance_funded", json!({"sender": env::predecessor_account_id(), "amount": s(d)}));
        self.after_change();
    }

    /// Sends the collected fees to the fixed treasury account. Anyone may call.
    pub fn flush_treasury(&mut self) -> U128 {
        let amount = self.treasury_due;
        assert!(amount > 0, "No fees to send");
        self.treasury_due = 0;
        self.in_flight += amount;
        self.after_change();
        Promise::new(self.treasury.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(PAY_GAS).on_flushed(U128(amount)))
            .detach();
        U128(amount)
    }

    #[private]
    pub fn on_flushed(&mut self, amount: U128) -> bool {
        self.in_flight -= amount.0;
        let ok = !matches!(env::promise_result_checked(0, 0), Err(near_sdk::PromiseError::Failed));
        if !ok {
            self.treasury_due += amount.0;
        }
        ok
    }

    /// Invariant repair. Anyone may call. If the contract holds less NEAR than
    /// it owes, the shortfall is booked against the insurance fund first and the
    /// backing second. Then the insurance fund refills the backing back to the
    /// highest R reached (`r_peak`), as far as it can.
    ///
    /// Only money owed counts as a loss. Storage that has outgrown the operating
    /// balance keeps the vault frozen (`after_change`) until `fund_operating`,
    /// but it never debits the insurance fund or the backing.
    pub fn reconcile(&mut self) -> Value {
        let have = self.balance();
        let owed = self.obligations();
        let shortfall = owed.saturating_sub(have);
        let storage_shortfall = (owed + self.storage_cost()).saturating_sub(have) - shortfall;
        if shortfall > 0 {
            let from_ins = shortfall.min(self.insurance);
            self.insurance -= from_ins;
            let rest = (shortfall - from_ins).min(self.backing);
            self.backing -= rest;
            self.losses_total += from_ins + rest;
            self.event("loss_recognized", json!({"shortfall": s(shortfall), "insurance": s(from_ins), "backing": s(rest)}));
        }
        let mut refill = 0;
        if self.supply > 0 {
            let target = mul_div_up(self.supply, self.r_peak, ONE);
            refill = target.saturating_sub(self.backing).min(self.insurance);
            if refill > 0 {
                self.insurance -= refill;
                self.backing += refill;
                self.refilled_total += refill;
                self.event("refilled", json!({"amount": s(refill), "rate": s(self.rate())}));
            }
        }
        // No balance assert here: if a loss is bigger than insurance + backing,
        // the books stay short and every other call keeps failing (frozen) until
        // a council upgrade; reconcile itself must still be able to record it.
        self.settle();
        json!({"shortfall": s(shortfall), "storage_shortfall": s(storage_shortfall), "refilled": s(refill), "rate": s(self.rate()), "r_peak": s(self.r_peak)})
    }

    // ------------------------------------------------------------- pause

    /// Guardian or council member: pauses mints, transfers, burns and exits for
    /// up to 72 h. It moves no funds. One account can start or extend a pause
    /// only once per `PAUSE_COOLDOWN_MS`, so a single compromised key cannot
    /// keep the vault paused; another guardian or member must take over.
    pub fn pause(&mut self) {
        let who = env::predecessor_account_id();
        assert!(who == self.guardian || self.council.contains(&who), "Guardian or council only");
        let now = now_ms();
        let mut last = last_pause();
        if let Some(t) = last.get(&who) {
            assert!(now >= t + PAUSE_COOLDOWN_MS, "This account paused recently: another guardian or council member must pause, or wait for the cooldown");
        }
        last.insert(&who, &now);
        if !self.is_paused() {
            // Votes against a pause that already ended are void.
            unpause_votes().remove(&self.paused_until);
        }
        self.paused_until = self.paused_until.max(now + MAX_PAUSE_MS);
        self.event("paused", json!({"by": who, "until": U64(self.paused_until)}));
    }

    /// Council member: votes to end a pause early. The pause ends once
    /// `threshold` current members have voted on this same pause.
    pub fn unpause(&mut self) {
        self.assert_council();
        assert!(self.is_paused(), "Not paused");
        let who = env::predecessor_account_id();
        let key = self.paused_until;
        let mut votes = unpause_votes();
        let n = self.record_vote(&mut votes, key, &who);
        if n >= self.threshold as usize {
            votes.remove(&key);
            self.paused_until = 0;
            self.event("unpaused", json!({"by": who, "votes": n}));
        } else {
            self.event("unpause_voted", json!({"by": who, "votes": n, "threshold": self.threshold}));
        }
    }

    // ------------------------------------------------------------- council (multisig + timelock, 48 h by default)

    pub fn propose(&mut self, action: Action) -> U64 {
        self.assert_council();
        match &action {
            Action::SetParams { params } => params.validate(),
            Action::Upgrade { code_sha256 } => assert!(code_sha256.len() == 64 && code_sha256.chars().all(|c| c.is_ascii_hexdigit()), "code_sha256 is 64 hex chars"),
            Action::SetCouncil { members, threshold } => validate_council(members, *threshold),
            Action::SetMinter { allowed, .. } => assert!(!*allowed || self.minters.len() < MAX_MINTERS, "Too many minters"),
            Action::SetTimelock { timelock_ms } => validate_timelock(timelock_ms.0),
            _ => {}
        }
        let id = self.next_proposal;
        self.next_proposal += 1;
        let now = now_ms();
        let p = Proposal {
            id,
            action,
            proposer: env::predecessor_account_id(),
            approvals: vec![env::predecessor_account_id()],
            created_at: U64(now),
            // The timelock in force now; a later SetTimelock does not move it.
            executable_at: U64(now + timelock_ms()),
            done: false,
        };
        self.event("proposed", json!({"id": U64(id), "action": p.action, "executable_at": p.executable_at}));
        self.proposals.insert(&id, &p);
        self.after_change();
        U64(id)
    }

    pub fn approve(&mut self, id: U64) {
        self.assert_council();
        let mut p = self.proposals.get(&id.0).expect("Unknown proposal");
        assert!(!p.done, "Proposal finished");
        let who = env::predecessor_account_id();
        if !p.approvals.contains(&who) {
            p.approvals.push(who);
        }
        self.proposals.insert(&id.0, &p);
    }

    /// Cancels a proposal: by its proposer alone, or once `threshold` current
    /// council members have voted to cancel it. A single member cannot veto
    /// the rest of the council.
    pub fn cancel(&mut self, id: U64) {
        self.assert_council();
        let mut p = self.proposals.get(&id.0).expect("Unknown proposal");
        assert!(!p.done, "Proposal finished");
        let who = env::predecessor_account_id();
        let mut votes = cancel_votes();
        let n = self.record_vote(&mut votes, id.0, &who);
        if who == p.proposer || n >= self.threshold as usize {
            p.done = true;
            self.proposals.insert(&id.0, &p);
            votes.remove(&id.0);
            self.event("cancelled", json!({"id": id, "by": who}));
        } else {
            self.event("cancel_voted", json!({"id": id, "by": who, "votes": n, "threshold": self.threshold}));
        }
    }

    /// Current-member cancel votes on a proposal (for the UI).
    pub fn get_cancel_votes(&self, id: U64) -> Vec<AccountId> {
        cancel_votes().get(&id.0).unwrap_or_default().into_iter().filter(|a| self.council.contains(a)).collect()
    }

    /// Executes a ready proposal (all but upgrades). Anyone may call.
    pub fn execute(&mut self, id: U64) {
        let mut p = self.ready(id.0);
        match p.action.clone() {
            Action::Upgrade { .. } => env::panic_str("Use apply_upgrade"),
            Action::SetParams { params } => {
                params.validate();
                self.params = params;
            }
            Action::SetGuardian { account_id } => self.guardian = account_id,
            Action::SetTreasury { account_id } => self.treasury = account_id,
            Action::SetMinter { account_id, allowed } => {
                self.minters.retain(|m| m != &account_id);
                if allowed {
                    assert!(self.minters.len() < MAX_MINTERS, "Too many minters");
                    self.minters.push(account_id);
                }
            }
            Action::SetCouncil { members, threshold } => self.set_council(members, threshold),
            Action::SetTimelock { timelock_ms } => {
                validate_timelock(timelock_ms.0);
                // Always stored, even at 48 h: an absent key means "never set",
                // which a testnet migrate() replaces with 10 min.
                env::storage_write(COUNCIL_TIMELOCK, &timelock_ms.0.to_le_bytes());
                self.event("timelock_set", json!({"timelock_ms": timelock_ms}));
            }
        }
        p.done = true;
        self.proposals.insert(&id.0, &p);
        self.event("executed", json!({"id": id}));
        self.after_change();
    }

    /// Deploys code whose sha256 a ready Upgrade proposal approved. Anyone may call.
    pub fn apply_upgrade(&mut self, id: U64, code: Base64VecU8) -> Promise {
        let mut p = self.ready(id.0);
        let Action::Upgrade { code_sha256 } = p.action.clone() else { env::panic_str("Not an upgrade") };
        let got: String = env::sha256(&code.0).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(got, code_sha256.to_lowercase(), "Code does not match the approved sha256");
        p.done = true;
        self.proposals.insert(&id.0, &p);
        self.event("upgraded", json!({"id": id, "code_sha256": got}));
        Promise::new(env::current_account_id())
            .deploy_contract(code.0)
            .function_call("migrate", b"{}".to_vec(), NearToken::from_yoctonear(0), Gas::from_tgas(30))
    }

    // ------------------------------------------------------------- NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        self.assert_running();
        let sender = env::predecessor_account_id();
        self.transfer(&sender, &receiver_id, amount.0, memo);
        self.after_change();
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        near_sdk::assert_one_yocto();
        self.assert_running();
        assert!(env::prepaid_gas().as_gas() > RECEIVER_GAS.as_gas() + RESOLVE_GAS.as_gas() + Gas::from_tgas(10).as_gas(), "More gas is required");
        let sender = env::predecessor_account_id();
        self.transfer(&sender, &receiver_id, amount.0, memo);
        self.after_change();
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(RECEIVER_GAS)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(RESOLVE_GAS).ft_resolve_transfer(sender, receiver_id, amount))
            .into()
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(bytes) => serde_json::from_slice::<U128>(&bytes).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        if unused == 0 {
            return amount;
        }
        let back = self.holders.get(&receiver_id).map(|h| h.balance.min(unused)).unwrap_or(0);
        if back > 0 {
            if self.holders.get(&sender_id).is_some() {
                self.debit(&receiver_id, back);
                self.add_balance(&sender_id, back);
                self.ft_event_transfer(&receiver_id, &sender_id, back, Some("refund".into()));
            } else if self.supply - back > 0 && self.supply - back < MIN_SUPPLY {
                // Burning the refund would leave a dust supply (MIN_SUPPLY): the
                // receiver keeps it instead, as if it had been used.
                return amount;
            } else {
                // Sender unregistered meanwhile: the refund is burned (R rises).
                self.debit(&receiver_id, back);
                self.supply -= back;
                self.burned_total += back;
                self.ft_event("ft_burn", &receiver_id, back, Some("refund to unregistered sender".into()));
            }
        }
        U128(amount.0 - back)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.holders.get(&account_id).map(|h| h.balance).unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }

    // ------------------------------------------------------------- NEP-145

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let d = env::attached_deposit().as_yoctonear();
        if self.holders.get(&account).is_some() {
            if d > 0 {
                Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(d)).detach();
            }
        } else {
            assert!(d >= STORAGE_FEE, "Attach at least the storage fee");
            self.ensure_holder(&account, STORAGE_FEE);
            if d > STORAGE_FEE {
                Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(d - STORAGE_FEE)).detach();
            }
            self.after_change();
        }
        StorageBalance { total: U128(STORAGE_FEE), available: U128(0) }
    }

    /// Application-funded lifetime registration. Unlike NEP-145 deposits, this
    /// explicit grant is not redeemable by the recipient, so it is not booked as
    /// an obligation: it stays on the balance and pays for the grant marker and
    /// the holder record (`SPONSORED_STORAGE_FEE`). The marker survives
    /// unregister/register cycles.
    #[payable]
    pub fn storage_deposit_sponsored(&mut self, account_id: AccountId) -> StorageBalance {
        let d = env::attached_deposit().as_yoctonear();
        let mut grants: LookupMap<AccountId, bool> = LookupMap::new(b"sg".to_vec());
        let mut retained = 0;
        if self.holders.get(&account_id).is_none() {
            if !grants.get(&account_id).unwrap_or(false) {
                assert!(d >= SPONSORED_STORAGE_FEE, "Attach at least the storage grant");
                grants.insert(&account_id, &true);
                retained = SPONSORED_STORAGE_FEE;
            }
            self.ensure_holder(&account_id, 0);
        }
        if d > retained {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(d - retained)).detach();
        }
        self.after_change();
        StorageBalance { total: U128(STORAGE_FEE), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.holders.get(&account_id).map(|_| StorageBalance { total: U128(STORAGE_FEE), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: U128(STORAGE_FEE), max: Some(U128(STORAGE_FEE)) }
    }

    /// Removes an empty holder record and refunds what the holder paid for it.
    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        near_sdk::assert_one_yocto();
        let _ = force; // never burns a balance: empty records only
        let account = env::predecessor_account_id();
        let Some(h) = self.holders.get(&account) else { return false };
        assert_eq!(h.balance, 0, "Balance must be zero (send or redeem it first)");
        assert!(self.account_exits.get(&account).map(|v| v.is_empty()).unwrap_or(true), "Claim open exits first");
        self.holders.remove(&account);
        self.account_windows.remove(&account);
        self.holder_count -= 1;
        self.storage_deposits -= h.storage_paid;
        if h.storage_paid > 0 {
            Promise::new(account).transfer(NearToken::from_yoctonear(h.storage_paid)).detach();
        }
        true
    }

    // ------------------------------------------------------------- views

    pub fn get_state(&self) -> Value {
        let base = self.current_base();
        let used = if now_ms() >= self.window.start + DAY_MS { 0 } else { self.window.used };
        json!({
            "version": 1,
            "network": "testnet",
            "backing": s(self.backing),
            "mint_carry_total":s(stored_amount(MINT_CARRY_TOTAL)),
            "exact_game_mint":1,
            "supply": s(self.supply),
            "rate": s(self.rate()),
            "r_peak": s(self.r_peak),
            "initial_rate": s(self.initial_rate),
            "reserve_near": s(self.backing),
            "lsts": [],
            "insurance": s(self.insurance),
            "treasury_due": s(self.treasury_due),
            "minted_total": s(self.minted_total),
            "burned_total": s(self.burned_total),
            "redeemed_total": s(self.redeemed_total),
            "fees_total": s(self.fees_total),
            "losses_total": s(self.losses_total),
            "refilled_total": s(self.refilled_total),
            "holders": self.holder_count,
            "fees": {"deposit_bps": DEPOSIT_FEE_BPS as u64, "redeem_bps": REDEEM_FEE_BPS as u64, "insurance_share_bps": INSURANCE_SHARE_BPS as u64},
            "exit": {
                "instant_used_24h": s(used),
                "instant_cap_24h": s(self.global_cap(base)),
                "account_cap_24h": s(self.account_cap(base)),
                "window_resets_at": U64(if used == 0 { 0 } else { self.window.start + DAY_MS }),
                "safe_window_ms": self.params.safe_window_ms,
                "queue_pending": s(self.queued),
                "queue_bonds": s(stored_amount(EXIT_BOND_TOTAL)),
                "queue_count": self.open_exits,
                "in_flight": s(self.in_flight),
                "paths": ["near_instant", "near_queue"],
            },
            "paused": self.is_paused(),
            "pause_until": U64(if self.is_paused() { self.paused_until } else { 0 }),
        })
    }

    /// The invariant monitor: what the contract holds against what it owes.
    pub fn audit(&self) -> Value {
        let have = self.balance();
        let money = self.obligations();
        let storage = self.storage_cost();
        let owed = money + storage;
        let rate = self.rate();
        json!({
            "ok": have >= owed && rate >= self.r_peak,
            "balance": s(have),
            "owed": s(owed),
            "slack": s(have.saturating_sub(owed)),
            "shortfall": s(owed.saturating_sub(have)),
            "monetary_shortfall": s(money.saturating_sub(have)),
            "storage_cost": s(storage),
            "operating_slack": s(have.saturating_sub(owed)),
            "min_operating_slack": s(MIN_OPERATING_SLACK),
            "backing": s(self.backing),
            "supply": s(self.supply),
            "rate": s(rate),
            "r_peak": s(self.r_peak),
            "backing_covers_supply_at_peak": self.supply == 0 || self.backing >= mul_div_up(self.supply, self.r_peak, ONE).saturating_sub(1),
            "insurance": s(self.insurance),
        })
    }

    pub fn get_config(&self) -> Value {
        json!({
            "council": self.council,
            "threshold": self.threshold,
            "guardian": self.guardian,
            "treasury": self.treasury,
            "minters": self.minters,
            "params": self.params,
            "timelock_ms": U64(timelock_ms()),
            "default_timelock_ms": U64(TIMELOCK_MS),
            "timelock_bounds_ms": [U64(timelock_bounds().0), U64(timelock_bounds().1)],
            "max_pause_ms": U64(MAX_PAUSE_MS),
            "storage_fee": s(STORAGE_FEE),
            "sponsored_storage_fee": s(SPONSORED_STORAGE_FEE),
            "min_redeem": s(MIN_REDEEM),
            "min_supply": s(MIN_SUPPLY),
            "exit_storage_bond": s(EXIT_STORAGE_BOND),
            "min_operating_slack": s(MIN_OPERATING_SLACK),
            "receipt_retention_ms": U64(RECEIPT_RETENTION_MS),
            "pause_cooldown_ms": U64(PAUSE_COOLDOWN_MS),
            "transferable": true,
        })
    }

    pub fn get_account_exits(&self, account_id: AccountId) -> Vec<Exit> {
        self.account_exits.get(&account_id).unwrap_or_default().iter().filter_map(|id| self.exits.get(id)).collect()
    }

    pub fn get_exit(&self, exit_id: U64) -> Option<Exit> {
        self.exits.get(&exit_id.0)
    }

    pub fn get_proposal(&self, id: U64) -> Option<Proposal> {
        self.proposals.get(&id.0)
    }

    /// What `redeem` of `amount` would pay now, and whether it fits the instant caps.
    pub fn quote_redeem(&self, account_id: AccountId, amount: U128) -> Value {
        if self.supply == 0 || amount.0 == 0 {
            return json!({"gross": "0", "fee": "0", "amount": "0", "instant": false});
        }
        let gross = mul_div(amount.0.min(self.supply), self.backing, self.supply);
        let fee = mul_div(gross, REDEEM_FEE_BPS, BPS);
        let base = self.current_base();
        let used = if now_ms() >= self.window.start + DAY_MS { 0 } else { self.window.used };
        let acc_used = self.account_used(&account_id);
        let instant = used + gross <= self.global_cap(base) && acc_used + gross <= self.account_cap(base);
        json!({"gross": s(gross), "fee": s(fee), "amount": s(gross - fee), "instant": instant, "ready_at_if_queued": U64(now_ms() + self.params.safe_window_ms.0)})
    }

    /// What `deposit` of `near` would mint now (the storage fee not included).
    pub fn quote_deposit(&self, near: U128) -> Value {
        let fee = mul_div(near.0, DEPOSIT_FEE_BPS, BPS);
        json!({"fee": s(fee), "qgold": s(self.shares_for(near.0 - fee)), "storage_fee_if_new": s(STORAGE_FEE)})
    }

    // ------------------------------------------------------------- internals

    fn rate(&self) -> u128 {
        if self.supply == 0 {
            self.initial_rate.max(self.r_peak)
        } else {
            mul_div(self.backing, ONE, self.supply)
        }
    }

    fn shares_for(&self, near: u128) -> u128 {
        if self.supply == 0 {
            mul_div(near, ONE, self.rate())
        } else {
            assert!(self.backing > 0, "Vault impaired");
            mul_div(near, self.supply, self.backing)
        }
    }

    fn take_fee(&mut self, fee: u128) {
        if fee == 0 {
            return;
        }
        let ins = mul_div(fee, INSURANCE_SHARE_BPS, BPS);
        self.insurance += ins;
        self.treasury_due += fee - ins;
        self.fees_total += fee;
    }

    fn balance(&self) -> u128 {
        env::account_balance().as_yoctonear() + env::account_locked_balance().as_yoctonear()
    }

    fn obligations(&self) -> u128 {
        // `in_flight` is not owed here: a NEAR transfer leaves the balance when
        // its promise is created. If it fails, the refund comes back and the
        // callback books it as a claimable exit (or treasury fee) again.
        self.backing + self.insurance + self.treasury_due + self.queued + self.storage_deposits + stored_amount(MINT_CARRY_TOTAL)
    }

    fn storage_cost(&self) -> u128 {
        env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear()
    }

    /// Runs after every state change: R never below its peak (only `reconcile`
    /// after a booked loss may leave it there), and the balance covers everything owed.
    fn after_change(&mut self) {
        self.settle();
        assert!(self.balance() >= self.obligations() + self.storage_cost(), "Invariant: balance does not cover obligations (run reconcile)");
    }

    fn settle(&mut self) {
        if self.supply == 0 {
            if self.backing > 0 {
                // Nobody holds QGOLD: leftover backing would be a gift to the next minter.
                self.insurance += self.backing;
                self.backing = 0;
            }
            // With no holders there is nobody whose R the peak protects, and
            // the next minter is backed only by their own NEAR. Keeping a peak
            // reached by a dust supply would price every later coin at zero.
            self.r_peak = self.initial_rate;
        }
        let rate = self.rate();
        if rate > self.r_peak {
            self.r_peak = rate;
        }
    }

    /// A burn or redeem of `q` must leave no supply or at least `MIN_SUPPLY`.
    fn assert_no_dust_supply_after(&self, q: u128) {
        let left = self.supply.checked_sub(q).unwrap_or(0);
        assert!(left == 0 || left >= MIN_SUPPLY, "Would leave less than 1 QGOLD in supply: take all of it or leave at least 1 QGOLD");
    }

    /// NEAR above everything owed and the storage cost: what pays for
    /// contract-sponsored storage.
    fn operating_slack(&self) -> u128 {
        self.balance().saturating_sub(self.obligations() + self.storage_cost())
    }

    fn assert_operating_slack(&self) {
        assert!(self.operating_slack() >= MIN_OPERATING_SLACK, "Operating balance is low: sponsored storage waits for fund_operating()");
    }

    /// Records `who`'s vote under `key` and returns how many current council
    /// members have voted there.
    fn record_vote(&self, votes: &mut LookupMap<u64, Vec<AccountId>>, key: u64, who: &AccountId) -> usize {
        let mut v = votes.get(&key).unwrap_or_default();
        if !v.contains(who) {
            v.push(who.clone());
            votes.insert(&key, &v);
        }
        v.iter().filter(|a| self.council.contains(a)).count()
    }

    fn assert_running(&self) {
        assert!(!self.is_paused(), "QGOLD is paused");
    }

    fn is_paused(&self) -> bool {
        self.paused_until > now_ms()
    }

    fn assert_council(&self) {
        assert!(self.council.contains(&env::predecessor_account_id()), "Council only");
    }

    fn set_council(&mut self, members: Vec<AccountId>, threshold: u8) {
        validate_council(&members, threshold);
        self.council = members;
        self.threshold = threshold;
    }

    fn ready(&self, id: u64) -> Proposal {
        let p = self.proposals.get(&id).expect("Unknown proposal");
        assert!(!p.done, "Proposal finished");
        assert!(now_ms() >= p.executable_at.0, "Timelock: not yet executable");
        let approvals = p.approvals.iter().filter(|a| self.council.contains(a)).count();
        assert!(approvals >= self.threshold as usize, "Not enough council approvals");
        p
    }

    fn ensure_holder(&mut self, account_id: &AccountId, paid: u128) {
        if self.holders.get(account_id).is_none() {
            self.holders.insert(account_id, &Holder { balance: 0, storage_paid: paid });
            self.holder_count += 1;
            self.storage_deposits += paid;
        }
    }

    fn add_balance(&mut self, account_id: &AccountId, q: u128) {
        let mut h = self.holders.get(account_id).expect("Account is not registered");
        h.balance = h.balance.checked_add(q).expect("Balance overflow");
        self.holders.insert(account_id, &h);
    }

    fn credit(&mut self, account_id: &AccountId, q: u128, memo: Option<String>) {
        self.add_balance(account_id, q);
        self.supply = self.supply.checked_add(q).expect("Supply overflow");
        self.minted_total += q;
        self.ft_event("ft_mint", account_id, q, memo);
    }

    fn debit(&mut self, account_id: &AccountId, q: u128) {
        let mut h = self.holders.get(account_id).expect("Account is not registered");
        assert!(h.balance >= q, "Not enough QGOLD");
        h.balance -= q;
        self.holders.insert(account_id, &h);
    }

    fn transfer(&mut self, sender: &AccountId, receiver: &AccountId, q: u128, memo: Option<String>) {
        assert!(sender != receiver, "Sender and receiver must differ");
        assert!(q > 0, "Amount must be positive");
        if let Some(m) = &memo {
            assert!(m.len() <= MAX_MEMO, "Memo is at most {MAX_MEMO} bytes");
        }
        assert!(self.holders.get(receiver).is_some(), "Receiver is not registered (storage_deposit first)");
        self.debit(sender, q);
        self.add_balance(receiver, q);
        self.ft_event_transfer(sender, receiver, q, memo);
    }

    fn roll_window(&mut self) {
        if now_ms() >= self.window.start + DAY_MS {
            self.window = Window { start: now_ms(), used: 0 };
            self.window_base = self.backing;
        }
    }

    fn current_base(&self) -> u128 {
        if now_ms() >= self.window.start + DAY_MS {
            self.backing
        } else {
            self.window_base
        }
    }

    fn global_cap(&self, base: u128) -> u128 {
        mul_div(base, self.params.instant_cap_bps as u128, BPS).max(self.params.instant_floor.0)
    }

    fn account_cap(&self, base: u128) -> u128 {
        let global = self.global_cap(base);
        mul_div(base, self.params.account_cap_bps as u128, BPS).max(self.params.account_floor.0).min(global)
    }

    fn account_used(&self, account_id: &AccountId) -> u128 {
        match self.account_windows.get(account_id) {
            Some(w) if now_ms() < w.start + DAY_MS => w.used,
            _ => 0,
        }
    }

    fn fits_instant(&self, account_id: &AccountId, gross: u128) -> bool {
        let base = self.window_base;
        self.window.used + gross <= self.global_cap(base)
            && self.account_used(account_id) + gross <= self.account_cap(base)
    }

    fn use_instant(&mut self, account_id: &AccountId, gross: u128) {
        self.window.used += gross;
        let w = match self.account_windows.get(account_id) {
            Some(w) if now_ms() < w.start + DAY_MS => Window { start: w.start, used: w.used + gross },
            _ => Window { start: now_ms(), used: gross },
        };
        self.account_windows.insert(account_id, &w);
    }

    fn queue_exit(&mut self, account_id: &AccountId, q: u128, gross: u128, fee_free: bool) -> (u64, u64) {
        let ready = now_ms() + self.params.safe_window_ms.0;
        self.push_exit(account_id, q, gross, ready, fee_free)
    }

    fn queue_exit_ready(&mut self, account_id: &AccountId, q: u128, net: u128) -> (u64, u64) {
        self.push_exit(account_id, q, net, now_ms(), true)
    }

    fn push_exit(&mut self, account_id: &AccountId, q: u128, gross: u128, ready: u64, fee_free: bool) -> (u64, u64) {
        let mut ids = self.account_exits.get(account_id).unwrap_or_default();
        assert!(ids.len() < MAX_OPEN_EXITS || fee_free, "Too many open exits: claim some first");
        let id = self.next_exit;
        self.next_exit += 1;
        let e = Exit { id, account_id: account_id.clone(), qgold: U128(q), gross: U128(gross), created_at: U64(now_ms()), ready_at: U64(ready), fee_free };
        self.exits.insert(&id, &e);
        ids.push(id);
        self.account_exits.insert(account_id, &ids);
        // The first EXIT_STORAGE_BOND of the exit is not owed while the record
        // exists: it stays on the balance and covers the record's storage. A
        // fee-free retry smaller than the bond is bonded in full.
        let bond = EXIT_STORAGE_BOND.min(gross);
        if bond > 0 {
            exit_bonds().insert(&id, &bond);
            write_amount(EXIT_BOND_TOTAL, stored_amount(EXIT_BOND_TOTAL) + bond);
        }
        self.queued += gross - bond;
        self.open_exits += 1;
        self.event("exit_queued", json!({"exit_id": U64(id), "account_id": account_id, "qgold": s(q), "gross": s(gross), "bond": s(bond), "ready_at": U64(ready)}));
        (id, ready)
    }

    /// Removes the exit record and returns its storage bond (0 for exits that
    /// were queued before bonds existed).
    fn remove_exit(&mut self, e: &Exit) -> u128 {
        self.exits.remove(&e.id);
        let mut ids = self.account_exits.get(&e.account_id).unwrap_or_default();
        ids.retain(|i| *i != e.id);
        if ids.is_empty() {
            self.account_exits.remove(&e.account_id);
        } else {
            self.account_exits.insert(&e.account_id, &ids);
        }
        self.open_exits -= 1;
        let bond = exit_bonds().remove(&e.id).unwrap_or(0);
        if bond > 0 {
            write_amount(EXIT_BOND_TOTAL, stored_amount(EXIT_BOND_TOTAL) - bond);
        }
        bond
    }

    fn pay(&self, account_id: AccountId, net: u128, qgold: u128) {
        Promise::new(account_id.clone())
            .transfer(NearToken::from_yoctonear(net))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(PAY_GAS).on_payout(account_id, U128(net), U128(qgold)))
            .detach();
    }

    fn ft_event(&self, event: &str, owner: &AccountId, q: u128, memo: Option<String>) {
        let mut d = json!({"owner_id": owner, "amount": s(q)});
        if let Some(m) = memo {
            d["memo"] = Value::String(m);
        }
        env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "nep141", "version": "1.0.0", "event": event, "data": [d]})));
    }

    fn ft_event_transfer(&self, from: &AccountId, to: &AccountId, q: u128, memo: Option<String>) {
        let mut d = json!({"old_owner_id": from, "new_owner_id": to, "amount": s(q)});
        if let Some(m) = memo {
            d["memo"] = Value::String(m);
        }
        env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [d]})));
    }

    fn event(&self, event: &str, data: Value) {
        env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "questlayer_qgold", "version": "1.0.0", "event": event, "data": [data]})));
    }
}

fn validate_council(members: &[AccountId], threshold: u8) {
    assert!(!members.is_empty() && members.len() <= MAX_COUNCIL, "Council is 1-{MAX_COUNCIL} members");
    let mut sorted: Vec<&AccountId> = members.iter().collect();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), members.len(), "Council members must be distinct");
    assert!(threshold >= 1 && threshold as usize <= members.len(), "Threshold is 1..=members");
}

#[cfg(test)]
mod tests;
