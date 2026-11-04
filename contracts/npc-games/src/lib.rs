//! QuestLayer NPC item games (NPC-PLAN §7, slice N4). Free mini-game rolls
//! with NEAR randomness and a server commitment. There is no wager: a roll can
//! only be started with a ticket the game server signed for an action the
//! player already completed (a sighting or a quest), every player method
//! rejects attached NEAR, and the prize is a cosmetic award claim
//! (`earned:npc-roll:<roll_id>`) that the server signs only for the outcome
//! recorded here.
//!
//! Flow (commit-reveal over `env::random_seed`):
//! 1. The server picks a 32-byte secret, publishes `commit = sha256(secret)`
//!    and signs a ticket `(roll_id, account, commit, table, expires)`.
//! 2. `start_roll` (block h, called by the player) checks the ticket and stores
//!    the commitment. Nothing is decided yet.
//! 3. `resolve_roll` (block >= h + 3, callable by anyone once the secret is
//!    revealed) checks `sha256(secret) == commit` and draws
//!    `sha256(domain | random_seed | secret | roll_id | account)` against the
//!    published table. The seed belongs to the block that runs the reveal, so
//!    the server cannot preview it, and the validator cannot know the secret
//!    beforehand, so neither side alone controls the result.
//! 4. If nobody reveals before `start + timeout_blocks`, `claim_timeout` gives
//!    the table's guaranteed minimum prize, so a withheld secret never leaves
//!    the player with nothing.
//!
//! Prize tables are public, versioned and immutable once published (the owner
//! can only switch a table off for new rolls). A capped tier that already hit
//! its daily cap falls back to the minimum tier, and the roll records that.
use near_sdk::{
    collections::{LookupMap, UnorderedMap},
    env,
    json_types::{Base64VecU8, U64},
    near, AccountId, PanicOnDefault,
};

const DAY_MS: u64 = 86_400_000;
/// Blocks between `start_roll` and the earliest reveal (NPC-PLAN §7.2).
pub const MIN_REVEAL_DELAY_BLOCKS: u64 = 3;
const MIN_TIMEOUT_BLOCKS: u64 = 30;
const MAX_TIMEOUT_BLOCKS: u64 = 100_000;
const MAX_TIERS: usize = 8;
const MAX_TOTAL_WEIGHT: u64 = 1_000_000;
const MAX_ID: usize = 64;
const MAX_ROLL_ID: usize = 96;
const DOMAIN: &[u8] = b"QuestLayer NPC roll v1";

fn network() -> &'static str {
    if env::current_account_id().as_str().ends_with(".testnet") {
        "testnet"
    } else {
        "mainnet"
    }
}

fn valid_id(s: &str, max: usize, what: &str) {
    assert!(
        !s.is_empty()
            && s.len() <= max
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.')),
        "Invalid {what}"
    );
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

/// Decodes exactly 32 bytes of lowercase hex.
fn unhex32(s: &str, what: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64, "{what} must be 64 lowercase hex digits");
    let nibble = |c: u8| match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => env::panic_str(&format!("{what} must be 64 lowercase hex digits")),
    };
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (nibble(b[2 * i]) << 4) | nibble(b[2 * i + 1]);
    }
    out
}

fn ed25519_key(key: Base64VecU8) -> [u8; 32] {
    key.0
        .try_into()
        .unwrap_or_else(|_| env::panic_str("An Ed25519 public key has 32 bytes"))
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Tier {
    /// Prize id the server turns into an award claim (an Aura edition or a voucher).
    pub prize: String,
    pub weight: u32,
    /// At most this many wins of this tier per UTC day for the whole table.
    pub daily_cap: Option<u32>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PrizeTable {
    pub tiers: Vec<Tier>,
    /// Index of the guaranteed minimum tier: uncapped, used on timeout and cap fallback.
    pub minimum: u8,
    pub total_weight: u32,
    pub active: bool,
    pub published_at_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RollStatus {
    Pending,
    Resolved,
    TimedOut,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Roll {
    pub account_id: AccountId,
    pub table_id: String,
    pub commit: String,
    pub start_height: U64,
    pub start_ms: U64,
    pub status: RollStatus,
    pub tier: Option<u8>,
    pub prize: Option<String>,
    /// The drawn tier hit its daily cap and the roll fell back to the minimum.
    pub capped: bool,
    pub secret: Option<String>,
    pub random: Option<String>,
    pub finished_height: Option<U64>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NpcGames {
    owner: AccountId,
    ticket_signer: Option<[u8; 32]>,
    timeout_blocks: u64,
    tables: UnorderedMap<String, PrizeTable>,
    rolls: LookupMap<String, Roll>,
    /// "<table>\n<tier>\n<utc day>" -> wins that day.
    wins: LookupMap<String, u32>,
    started: u64,
    resolved: u64,
    timed_out: u64,
}

#[near]
impl NpcGames {
    #[init]
    pub fn new(owner_id: AccountId, ticket_signer: Option<Base64VecU8>, timeout_blocks: u64) -> Self {
        assert!(
            (MIN_TIMEOUT_BLOCKS..=MAX_TIMEOUT_BLOCKS).contains(&timeout_blocks),
            "timeout_blocks must be between {MIN_TIMEOUT_BLOCKS} and {MAX_TIMEOUT_BLOCKS}"
        );
        Self {
            owner: owner_id,
            ticket_signer: ticket_signer.map(ed25519_key),
            timeout_blocks,
            tables: UnorderedMap::new(b"t".to_vec()),
            rolls: LookupMap::new(b"r".to_vec()),
            wins: LookupMap::new(b"w".to_vec()),
            started: 0,
            resolved: 0,
            timed_out: 0,
        }
    }

    // ---------------------------------------------------------------- owner

    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }

    /// Hands the owner role to another account.
    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner = owner_id;
    }

    /// Sets (or clears, with `None`) the server key that signs roll tickets.
    #[payable]
    pub fn set_ticket_signer(&mut self, key: Option<Base64VecU8>) {
        self.assert_owner();
        self.ticket_signer = key.map(ed25519_key);
    }

    /// Publishes a new prize table. Ids are never reused and tables never change,
    /// so the odds a player saw before rolling are the odds the roll used.
    #[payable]
    pub fn publish_table(&mut self, table_id: String, tiers: Vec<Tier>, minimum: u8) -> PrizeTable {
        self.assert_owner();
        valid_id(&table_id, MAX_ID, "table id");
        assert!(self.tables.get(&table_id).is_none(), "Table ids are immutable; publish a new version");
        assert!(!tiers.is_empty() && tiers.len() <= MAX_TIERS, "A table has 1 to {MAX_TIERS} tiers");
        let mut total: u64 = 0;
        for t in &tiers {
            valid_id(&t.prize, MAX_ID, "prize id");
            assert!(t.weight > 0, "Every tier needs a positive weight");
            assert!(t.daily_cap != Some(0), "A daily cap must be at least 1");
            total += t.weight as u64;
        }
        assert!(total <= MAX_TOTAL_WEIGHT, "Total weight is at most {MAX_TOTAL_WEIGHT}");
        let min = tiers.get(minimum as usize).expect("minimum must index a tier");
        assert!(min.daily_cap.is_none(), "The guaranteed minimum tier cannot be capped");
        let table = PrizeTable {
            tiers,
            minimum,
            total_weight: total as u32,
            active: true,
            published_at_ms: U64(env::block_timestamp_ms()),
        };
        self.tables.insert(&table_id, &table);
        self.event("table_published", near_sdk::serde_json::json!({ "table_id": table_id, "table": table }));
        table
    }

    /// Stops (or restarts) new rolls on a table. Rolls already started still finish.
    #[payable]
    pub fn set_table_active(&mut self, table_id: String, active: bool) {
        self.assert_owner();
        let mut table = self.tables.get(&table_id).expect("Unknown table");
        table.active = active;
        self.tables.insert(&table_id, &table);
        self.event("table_active", near_sdk::serde_json::json!({ "table_id": table_id, "active": active }));
    }

    // --------------------------------------------------------------- player

    /// The exact text the server signs for a roll ticket.
    pub fn ticket_message(
        &self,
        roll_id: String,
        account_id: AccountId,
        commit: String,
        table_id: String,
        expires_at_ms: U64,
    ) -> String {
        format!(
            "QuestLayer NPC roll ticket v1\nContract: {}\nNetwork: {}\nRoll: {}\nAccount: {}\nCommit: {}\nTable: {}\nExpires: {}",
            env::current_account_id(),
            network(),
            roll_id,
            account_id,
            commit,
            table_id,
            expires_at_ms.0
        )
    }

    /// Starts an earned roll. Only the ticket's own account can start it, once,
    /// before the ticket expires, and with no NEAR attached.
    pub fn start_roll(
        &mut self,
        roll_id: String,
        table_id: String,
        commit: String,
        expires_at_ms: U64,
        signature: Base64VecU8,
    ) -> Roll {
        assert_eq!(env::attached_deposit().as_yoctonear(), 0, "Mini-games take no deposit");
        valid_id(&roll_id, MAX_ROLL_ID, "roll id");
        unhex32(&commit, "commit");
        let account_id = env::predecessor_account_id();
        let key = self.ticket_signer.expect("Roll tickets are not enabled");
        let sig: [u8; 64] = signature
            .0
            .try_into()
            .unwrap_or_else(|_| env::panic_str("An Ed25519 signature has 64 bytes"));
        let message = self.ticket_message(roll_id.clone(), account_id.clone(), commit.clone(), table_id.clone(), expires_at_ms);
        assert!(env::ed25519_verify(&sig, message.as_bytes(), &key), "Invalid roll ticket");
        assert!(env::block_timestamp_ms() <= expires_at_ms.0, "Roll ticket expired");
        assert!(self.rolls.get(&roll_id).is_none(), "Roll already used");
        let table = self.tables.get(&table_id).expect("Unknown table");
        assert!(table.active, "Table is closed for new rolls");
        let roll = Roll {
            account_id,
            table_id,
            commit,
            start_height: U64(env::block_height()),
            start_ms: U64(env::block_timestamp_ms()),
            status: RollStatus::Pending,
            tier: None,
            prize: None,
            capped: false,
            secret: None,
            random: None,
            finished_height: None,
        };
        self.rolls.insert(&roll_id, &roll);
        self.started += 1;
        self.event("roll_started", near_sdk::serde_json::json!({ "roll_id": roll_id, "roll": roll }));
        roll
    }

    /// Reveals the server secret and draws the prize. Anyone may call it from
    /// `start_height + 3` until the timeout block.
    pub fn resolve_roll(&mut self, roll_id: String, secret: String) -> Roll {
        assert_eq!(env::attached_deposit().as_yoctonear(), 0, "Mini-games take no deposit");
        let mut roll = self.rolls.get(&roll_id).expect("Unknown roll");
        assert_eq!(roll.status, RollStatus::Pending, "Roll already finished");
        let h = env::block_height();
        assert!(h >= roll.start_height.0 + MIN_REVEAL_DELAY_BLOCKS, "Too early: wait {MIN_REVEAL_DELAY_BLOCKS} blocks after the start");
        assert!(h < roll.start_height.0 + self.timeout_blocks, "Reveal window closed; claim the timeout prize");
        let secret_bytes = unhex32(&secret, "secret");
        assert_eq!(hex(&env::sha256_array(&secret_bytes)), roll.commit, "Secret does not match the commitment");
        let mut input = Vec::with_capacity(DOMAIN.len() + 64 + roll_id.len() + 2 + roll.account_id.len());
        input.extend_from_slice(DOMAIN);
        input.extend_from_slice(&env::random_seed_array());
        input.extend_from_slice(&secret_bytes);
        input.extend_from_slice(roll_id.as_bytes());
        input.push(b'\n');
        input.extend_from_slice(roll.account_id.as_bytes());
        let r = env::sha256_array(&input);
        let table = self.tables.get(&roll.table_id).expect("Unknown table");
        let drawn = pick_tier(&table, u64::from_be_bytes(r[..8].try_into().unwrap()));
        let day = env::block_timestamp_ms() / DAY_MS;
        let mut tier = drawn;
        if let Some(cap) = table.tiers[drawn as usize].daily_cap {
            if self.wins.get(&wins_key(&roll.table_id, drawn, day)).unwrap_or(0) >= cap {
                tier = table.minimum;
                roll.capped = true;
            }
        }
        self.count_win(&roll.table_id, tier, day);
        roll.status = RollStatus::Resolved;
        roll.tier = Some(tier);
        roll.prize = Some(table.tiers[tier as usize].prize.clone());
        roll.secret = Some(secret);
        roll.random = Some(hex(&r));
        roll.finished_height = Some(U64(h));
        self.rolls.insert(&roll_id, &roll);
        self.resolved += 1;
        self.event("roll_resolved", near_sdk::serde_json::json!({ "roll_id": roll_id, "roll": roll, "drawn_tier": drawn }));
        roll
    }

    /// After the reveal window closes without a reveal, anyone can settle the
    /// roll on the table's guaranteed minimum prize.
    pub fn claim_timeout(&mut self, roll_id: String) -> Roll {
        assert_eq!(env::attached_deposit().as_yoctonear(), 0, "Mini-games take no deposit");
        let mut roll = self.rolls.get(&roll_id).expect("Unknown roll");
        assert_eq!(roll.status, RollStatus::Pending, "Roll already finished");
        let h = env::block_height();
        assert!(h >= roll.start_height.0 + self.timeout_blocks, "The reveal window is still open");
        let table = self.tables.get(&roll.table_id).expect("Unknown table");
        self.count_win(&roll.table_id, table.minimum, env::block_timestamp_ms() / DAY_MS);
        roll.status = RollStatus::TimedOut;
        roll.tier = Some(table.minimum);
        roll.prize = Some(table.tiers[table.minimum as usize].prize.clone());
        roll.finished_height = Some(U64(h));
        self.rolls.insert(&roll_id, &roll);
        self.timed_out += 1;
        self.event("roll_timed_out", near_sdk::serde_json::json!({ "roll_id": roll_id, "roll": roll }));
        roll
    }

    // ---------------------------------------------------------------- views

    pub fn get_roll(&self, roll_id: String) -> Option<Roll> {
        self.rolls.get(&roll_id)
    }
    pub fn get_table(&self, table_id: String) -> Option<PrizeTable> {
        self.tables.get(&table_id)
    }
    pub fn get_tables(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<(String, PrizeTable)> {
        self.tables
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }
    /// Wins of one tier on one UTC day (`day` = unix ms / 86 400 000).
    pub fn get_wins(&self, table_id: String, tier: u8, day: U64) -> u32 {
        self.wins.get(&wins_key(&table_id, tier, day.0)).unwrap_or(0)
    }
    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "owner_id": self.owner,
            "network": network(),
            "ticket_signer": self.ticket_signer.map(|k| Base64VecU8(k.to_vec())),
            "min_reveal_delay_blocks": MIN_REVEAL_DELAY_BLOCKS,
            "timeout_blocks": self.timeout_blocks,
            "tables": self.tables.len(),
            "rolls_started": self.started,
            "rolls_resolved": self.resolved,
            "rolls_timed_out": self.timed_out,
            "wagering": false,
        })
    }

    fn count_win(&mut self, table_id: &str, tier: u8, day: u64) {
        let key = wins_key(table_id, tier, day);
        let n = self.wins.get(&key).unwrap_or(0);
        self.wins.insert(&key, &(n + 1));
    }
    fn event(&self, name: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({ "standard": "questlayer_npc_games", "version": "1.0.0", "event": name, "data": [data] })
        ));
    }
}

fn wins_key(table_id: &str, tier: u8, day: u64) -> String {
    format!("{table_id}\n{tier}\n{day}")
}

/// Maps a uniform u64 onto the weighted tiers. The modulo bias is below
/// 1e6 / 2^64 and irrelevant for cosmetic drops.
fn pick_tier(table: &PrizeTable, x: u64) -> u8 {
    let mut point = x % table.total_weight as u64;
    for (i, t) in table.tiers.iter().enumerate() {
        if point < t.weight as u64 {
            return i as u8;
        }
        point -= t.weight as u64;
    }
    unreachable!()
}

#[cfg(test)]
mod tests;
