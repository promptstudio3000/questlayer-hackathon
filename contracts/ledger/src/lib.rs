//! QuestLayer ledger: every coin, XP and street find a player collects, on
//! NEAR, with what it was for.
//!
//! - This account is the QXP token: a soulbound NEP-141 (0 decimals) whose
//!   balance is the player's lifetime XP. `ft_transfer` always fails.
//! - The game server records actions with `record_batch` (one transaction for
//!   everything collected in the last ~2 s). Each action carries its kind
//!   (coin, find, monster, quest, ...), the XP and GOLD it earned, a coarse
//!   map cell (geohash, never the exact GPS fix), the time and the sha256 of
//!   the server-side evidence. It becomes an NEP-141 `ft_mint` event whose
//!   memo spells all of that out, so an explorer shows what the coins were for.
//! - GOLD goes to the QGOLD token (contracts/soulbound-ft, minter = this
//!   account) in the same transaction, with the same memo.
//! - `profile` is the on-chain player profile: XP, level, GOLD, counts by
//!   kind and the time of the first and last action.
//! - `commit_day` stores one Merkle root over a day's actions (sha256, sorted
//!   pairs), so a single action can be proven with `verify_proof` even when
//!   the game records once a day instead of per action.
//!
//! Recording is idempotent: each account's actions carry a strictly
//! increasing `seq`; an action whose seq is not above the account's last one
//! is skipped, so a retried transaction cannot count anything twice.
use near_sdk::{
    collections::{LookupMap, Vector},
    env,
    json_types::{U128, U64},
    near, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

pub const MAX_BATCH: usize = 25;
pub const MAX_KIND: usize = 16;
pub const MAX_CELL: usize = 12;
pub const MAX_REF: usize = 40;
pub const MAX_XP_PER_ACTION: u64 = 100_000;
pub const MAX_GOLD_PER_ACTION: u128 = 1_000_000_000_000; // 1,000,000 GOLD at 6 decimals
pub const MAX_COUNT: u32 = 100_000;
const GOLD_GAS: Gas = Gas::from_tgas(25);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);
const GEOHASH: &[u8] = b"0123456789bcdefghjkmnpqrstuvwxyz";

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

/// One game action as the server sends it.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Action {
    pub account_id: AccountId,
    /// Strictly increasing per account (the server's record number).
    pub seq: U64,
    /// coin | find | monster | quest | errand | board | roll | day | other ...
    pub kind: String,
    pub xp: U64,
    /// GOLD in micro units (6 decimals, as the game's gold_u).
    pub gold: U128,
    /// How many game actions this record stands for (1, or more for a daily total).
    pub count: Option<u32>,
    /// Geohash of the place, at most 12 characters; the game sends 7 (~150 m).
    pub cell: Option<String>,
    pub at_ms: U64,
    /// sha256 (hex) of the server-side evidence, or a day's Merkle root.
    pub ev: String,
    /// The game's own id of the action (for the ChainLink icon).
    pub ref_id: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Profile {
    pub xp: u64,
    pub gold: u128,
    pub actions: u64,
    pub coins: u64,
    pub finds: u64,
    pub monsters: u64,
    pub quests: u64,
    pub other: u64,
    pub last_seq: u64,
    pub first_at_ms: u64,
    pub last_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ProfileView {
    pub account_id: AccountId,
    pub xp: U64,
    pub level: u32,
    pub next_level_xp: Option<U64>,
    pub gold: U128,
    pub gold_pending: U128,
    pub actions: U64,
    pub coins: U64,
    pub finds: U64,
    pub monsters: U64,
    pub quests: U64,
    pub other: U64,
    pub last_seq: U64,
    pub first_at_ms: U64,
    pub last_at_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct DayRoot {
    pub day: String,
    pub root: String,
    pub count: U64,
    pub xp: U64,
    pub gold: U128,
    pub committed_at_ms: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BatchResult {
    pub applied: u32,
    pub skipped: u32,
    /// ref_id (or seq) of every skipped action: already recorded, or a stale seq.
    pub skipped_refs: Vec<String>,
    pub xp: U64,
    pub gold: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct GoldMint {
    pub account_id: AccountId,
    pub amount: U128,
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub gold_token: Option<AccountId>,
    pub level_base_xp: U64,
    pub max_level: u32,
    pub transferable: bool,
    pub holders: U64,
    pub total_actions: U64,
    pub total_gold: U128,
    pub days: U64,
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

fn isqrt(n: u64) -> u64 {
    // Integer Newton iteration (no floats in contract code).
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = x / 2 + x % 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

fn valid_hex(s: &str, what: &str) {
    assert!(
        s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "{what} must be 64 lowercase hex characters"
    );
}

fn hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(H[(b >> 4) as usize] as char);
        out.push(H[(b & 15) as usize] as char);
    }
    out
}

fn unhex(s: &str) -> Vec<u8> {
    valid_hex(s, "A hash");
    let v = |c: u8| if c <= b'9' { c - b'0' } else { c - b'a' + 10 };
    s.as_bytes().chunks(2).map(|p| (v(p[0]) << 4) | v(p[1])).collect()
}

/// Hash of a sorted pair, as the server builds the tree (server/chain-ledger/merkle.mjs).
pub fn hash_pair(a: &[u8], b: &[u8]) -> Vec<u8> {
    let (l, r) = if a <= b { (a, b) } else { (b, a) };
    let mut buf = Vec::with_capacity(l.len() + r.len());
    buf.extend_from_slice(l);
    buf.extend_from_slice(r);
    env::sha256(&buf)
}

pub fn memo(a: &Action, count: u32) -> String {
    let mut m = format!("ql1 {} x{} xp={} gold={}", a.kind, count, a.xp.0, a.gold.0);
    if let Some(cell) = &a.cell {
        m.push_str(&format!(" cell={cell}"));
    }
    m.push_str(&format!(" t={} ev={} seq={}", a.at_ms.0, &a.ev[..16], a.seq.0));
    if let Some(r) = &a.ref_id {
        m.push_str(&format!(" ref={r}"));
    }
    m
}

fn validate(a: &Action) -> u32 {
    let k = &a.kind;
    assert!(
        !k.is_empty() && k.len() <= MAX_KIND && k.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'),
        "Kind is 1-{MAX_KIND} characters of a-z and dashes"
    );
    assert!(a.xp.0 <= MAX_XP_PER_ACTION, "Too much XP in one action");
    assert!(a.gold.0 <= MAX_GOLD_PER_ACTION, "Too much GOLD in one action");
    assert!(a.xp.0 > 0 || a.gold.0 > 0, "An action earns XP or GOLD");
    let count = a.count.unwrap_or(1);
    assert!((1..=MAX_COUNT).contains(&count), "Count is 1-{MAX_COUNT}");
    if let Some(cell) = &a.cell {
        assert!(
            !cell.is_empty() && cell.len() <= MAX_CELL && cell.bytes().all(|b| GEOHASH.contains(&b)),
            "Cell must be a geohash of at most {MAX_CELL} characters"
        );
    }
    if let Some(r) = &a.ref_id {
        assert!(
            !r.is_empty() && r.len() <= MAX_REF && r.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.')),
            "Invalid ref_id"
        );
    }
    valid_hex(&a.ev, "Evidence");
    assert!(a.at_ms.0 <= env::block_timestamp_ms() + 10 * 60_000, "Action is in the future");
    count
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ledger {
    owner: AccountId,
    gold_token: Option<AccountId>,
    metadata: FungibleTokenMetadata,
    level_base_xp: u64,
    max_level: u32,
    profiles: LookupMap<AccountId, Profile>,
    /// GOLD whose mint on the QGOLD token failed; `retry_gold` sends it again.
    gold_pending: LookupMap<AccountId, u128>,
    days: LookupMap<String, DayRoot>,
    day_list: Vector<String>,
    holders: u64,
    total_xp: u128,
    total_gold: u128,
    total_actions: u64,
}

#[near]
impl Ledger {
    #[init]
    pub fn new(owner_id: AccountId, gold_token: Option<AccountId>, metadata: FungibleTokenMetadata, level_base_xp: Option<U64>, max_level: Option<u32>) -> Self {
        assert_eq!(metadata.spec, "ft-1.0.0", "Metadata spec must be ft-1.0.0");
        assert_eq!(metadata.decimals, 0, "QXP has no decimals");
        Self {
            owner: owner_id,
            gold_token,
            metadata,
            level_base_xp: level_base_xp.map(|v| v.0).unwrap_or(100).max(1),
            max_level: max_level.unwrap_or(10).max(1),
            profiles: LookupMap::new(b"p".to_vec()),
            gold_pending: LookupMap::new(b"g".to_vec()),
            days: LookupMap::new(b"d".to_vec()),
            day_list: Vector::new(b"l".to_vec()),
            holders: 0,
            total_xp: 0,
            total_gold: 0,
            total_actions: 0,
        }
    }

    // ---------------------------------------------------------------- owner

    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }

    /// The game server records through a function-call key on this account;
    /// the owner may record too.
    fn assert_recorder(&self) {
        let caller = env::predecessor_account_id();
        assert!(caller == env::current_account_id() || caller == self.owner, "Recorder only");
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner = owner_id;
    }

    #[payable]
    pub fn set_gold_token(&mut self, gold_token: Option<AccountId>) {
        self.assert_owner();
        self.gold_token = gold_token;
    }

    #[payable]
    pub fn set_levels(&mut self, level_base_xp: U64, max_level: u32) {
        self.assert_owner();
        self.level_base_xp = level_base_xp.0.max(1);
        self.max_level = max_level.max(1);
    }

    // ---------------------------------------------------------------- recording

    /// Records up to 25 actions in one transaction. Recorder only.
    pub fn record_batch(&mut self, actions: Vec<Action>) -> BatchResult {
        self.assert_recorder();
        assert!(!actions.is_empty() && actions.len() <= MAX_BATCH, "1-{MAX_BATCH} actions per batch");
        let mut xp_events = Vec::new();
        let mut gold_mints: Vec<GoldMint> = Vec::new();
        let (mut applied, mut skipped, mut xp_sum, mut gold_sum) = (0u32, 0u32, 0u64, 0u128);
        let mut skipped_refs = Vec::new();
        for a in actions {
            let count = validate(&a);
            let mut p = self.profiles.get(&a.account_id).unwrap_or_default();
            if a.seq.0 <= p.last_seq {
                skipped += 1;
                skipped_refs.push(a.ref_id.clone().unwrap_or_else(|| a.seq.0.to_string()));
                continue;
            }
            if p.actions == 0 && p.xp == 0 && p.gold == 0 {
                self.holders += 1;
                p.first_at_ms = a.at_ms.0;
            }
            p.last_seq = a.seq.0;
            p.last_at_ms = p.last_at_ms.max(a.at_ms.0);
            p.xp = p.xp.checked_add(a.xp.0).expect("XP overflow");
            p.gold = p.gold.checked_add(a.gold.0).expect("GOLD overflow");
            p.actions += count as u64;
            let c = count as u64;
            match a.kind.as_str() {
                "coin" => p.coins += c,
                "find" => p.finds += c,
                "monster" | "boss" => p.monsters += c,
                "quest" | "chest" | "errand" | "clue" => p.quests += c,
                _ => p.other += c,
            }
            self.profiles.insert(&a.account_id, &p);
            let m = memo(&a, count);
            if a.xp.0 > 0 {
                xp_events.push(near_sdk::serde_json::json!({ "owner_id": a.account_id, "amount": a.xp.0.to_string(), "memo": m }));
            }
            if a.gold.0 > 0 {
                gold_mints.push(GoldMint { account_id: a.account_id.clone(), amount: a.gold, memo: Some(m) });
            }
            applied += 1;
            xp_sum += a.xp.0;
            gold_sum += a.gold.0;
            self.total_actions += c;
        }
        self.total_xp += xp_sum as u128;
        self.total_gold += gold_sum;
        if !xp_events.is_empty() {
            env::log_str(&format!(
                "EVENT_JSON:{}",
                near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": xp_events })
            ));
        }
        if !gold_mints.is_empty() {
            self.mint_gold(gold_mints);
        }
        BatchResult { applied, skipped, skipped_refs, xp: U64(xp_sum), gold: U128(gold_sum) }
    }

    fn mint_gold(&mut self, mints: Vec<GoldMint>) {
        match self.gold_token.clone() {
            Some(token) => {
                let args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({ "mints": mints })).unwrap();
                let back = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({ "mints": mints })).unwrap();
                Promise::new(token)
                    .function_call("ft_mint_batch", args, NearToken::from_yoctonear(0), GOLD_GAS)
                    .then(Promise::new(env::current_account_id()).function_call("on_gold_minted", back, NearToken::from_yoctonear(0), CALLBACK_GAS))
                    .detach();
            }
            None => self.hold_gold(&mints),
        }
    }

    fn hold_gold(&mut self, mints: &[GoldMint]) {
        for m in mints {
            let held = self.gold_pending.get(&m.account_id).unwrap_or(0);
            self.gold_pending.insert(&m.account_id, &(held + m.amount.0));
        }
    }

    #[private]
    pub fn on_gold_minted(&mut self, mints: Vec<GoldMint>) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        self.hold_gold(&mints);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({ "standard": "questlayer_ledger", "version": "1.0.0", "event": "gold_held", "data": [{ "accounts": mints.iter().map(|m| m.account_id.to_string()).collect::<Vec<_>>() }] })
        ));
        false
    }

    /// Sends GOLD whose earlier mint failed again. Recorder only.
    pub fn retry_gold(&mut self, account_ids: Vec<AccountId>) -> U128 {
        self.assert_recorder();
        assert!(!account_ids.is_empty() && account_ids.len() <= MAX_BATCH, "1-{MAX_BATCH} accounts");
        let mut mints = Vec::new();
        let mut total = 0u128;
        for id in account_ids {
            if let Some(amount) = self.gold_pending.remove(&id) {
                if amount > 0 {
                    total += amount;
                    mints.push(GoldMint { account_id: id, amount: U128(amount), memo: Some("ql1 retry".into()) });
                }
            }
        }
        if !mints.is_empty() {
            self.mint_gold(mints);
        }
        U128(total)
    }

    /// Stores the Merkle root of one day's actions. Once per day; recorder only.
    pub fn commit_day(&mut self, day: String, root: String, count: U64, xp: U64, gold: U128) -> DayRoot {
        self.assert_recorder();
        let b = day.as_bytes();
        assert!(
            b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()),
            "Day is YYYY-MM-DD"
        );
        valid_hex(&root, "Root");
        assert!(self.days.get(&day).is_none(), "This day is already committed");
        let entry = DayRoot { day: day.clone(), root, count, xp, gold, committed_at_ms: U64(env::block_timestamp_ms()) };
        self.days.insert(&day, &entry);
        self.day_list.push(&day);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({ "standard": "questlayer_ledger", "version": "1.0.0", "event": "day_commit", "data": [entry] })
        ));
        entry
    }

    // ---------------------------------------------------------------- views

    pub fn level_for(&self, xp: U64) -> u32 {
        let level = 1 + isqrt(xp.0 / self.level_base_xp);
        level.min(self.max_level as u64) as u32
    }

    pub fn profile(&self, account_id: AccountId) -> Option<ProfileView> {
        let p = self.profiles.get(&account_id)?;
        let level = self.level_for(U64(p.xp));
        let next = if level < self.max_level { Some(U64(self.level_base_xp * (level as u64) * (level as u64))) } else { None };
        Some(ProfileView {
            gold_pending: U128(self.gold_pending.get(&account_id).unwrap_or(0)),
            account_id,
            xp: U64(p.xp),
            level,
            next_level_xp: next,
            gold: U128(p.gold),
            actions: U64(p.actions),
            coins: U64(p.coins),
            finds: U64(p.finds),
            monsters: U64(p.monsters),
            quests: U64(p.quests),
            other: U64(p.other),
            last_seq: U64(p.last_seq),
            first_at_ms: U64(p.first_at_ms),
            last_at_ms: U64(p.last_at_ms),
        })
    }

    pub fn last_seq(&self, account_id: AccountId) -> U64 {
        U64(self.profiles.get(&account_id).map(|p| p.last_seq).unwrap_or(0))
    }

    pub fn get_day(&self, day: String) -> Option<DayRoot> {
        self.days.get(&day)
    }

    /// Committed days, newest first.
    pub fn days(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<DayRoot> {
        let n = self.day_list.len();
        let skip = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(30).min(100);
        (0..n)
            .rev()
            .skip(skip as usize)
            .take(limit as usize)
            .filter_map(|i| self.day_list.get(i).and_then(|d| self.days.get(&d)))
            .collect()
    }

    /// Checks that `leaf` (sha256 hex of one action) belongs to `day`'s root.
    pub fn verify_proof(&self, day: String, leaf: String, proof: Vec<String>) -> bool {
        let Some(entry) = self.days.get(&day) else { return false };
        let mut node = unhex(&leaf);
        for sibling in proof {
            node = hash_pair(&node, &unhex(&sibling));
        }
        hex(&node) == entry.root
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner.clone(),
            gold_token: self.gold_token.clone(),
            level_base_xp: U64(self.level_base_xp),
            max_level: self.max_level,
            transferable: false,
            holders: U64(self.holders),
            total_actions: U64(self.total_actions),
            total_gold: U128(self.total_gold),
            days: U64(self.day_list.len()),
        }
    }

    // ---------------------------------------------------------------- NEP-141 (QXP)

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let _ = (receiver_id, amount, memo);
        env::panic_str("QXP is soulbound and cannot be transferred");
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128 {
        let _ = (receiver_id, amount, memo, msg);
        env::panic_str("QXP is soulbound and cannot be transferred");
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_xp)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.profiles.get(&account_id).map(|p| p.xp as u128).unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }

    // ---------------------------------------------------------------- NEP-145 (sponsored)

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let deposit = env::attached_deposit();
        if !deposit.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(deposit).detach();
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: U128(0), max: Some(U128(0)) }
    }
}

#[cfg(test)]
mod tests;
