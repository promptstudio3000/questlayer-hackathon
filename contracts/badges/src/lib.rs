//! QuestLayer badges: soulbound, POAP-like proof that a player visited a place
//! or finished a quest. Anyone can design a badge; nobody can sell or move one.
//!
//! - A badge design (`Badge`) names its creator, what it proves (a place with a
//!   radius, a quest reference, or an event) and a fixed supply.
//! - A player receives a badge once, either with a claim the game server signed
//!   after checking the visit or quest (`claim`, callable by anyone, so the
//!   server, a worker or the player can submit it), or directly from the
//!   badge's creator (`award`, for event-style handouts).
//! - Tokens are non-transferable: there is no transfer, approval or burn
//!   method. Wallets can still show them through the NEP-171 view methods and
//!   `nft_mint` events.
//! - Storage is prepaid. A creator who calls `create_badge` attaches
//!   `create_cost(max_supply)`; unused claim budget comes back on `close_badge`.
//!   The contract account itself (the game server's function-call key) and the
//!   owner may create sponsored badges on behalf of a player; those carry no
//!   refundable budget.
use near_sdk::{
    collections::{LookupMap, UnorderedMap, Vector},
    env,
    json_types::{Base64VecU8, U128, U64},
    near, AccountId, NearToken, PanicOnDefault, Promise,
};

/// Fixed part of a badge's prepaid budget (its own record and indexes).
pub const BADGE_BASE_YOCTO: u128 = 20_000_000_000_000_000_000_000; // 0.02 NEAR
/// Per-claim budget: one token record, two index entries and the claim gas.
pub const PER_CLAIM_YOCTO: u128 = 4_000_000_000_000_000_000_000; // 0.004 NEAR
pub const MAX_SUPPLY: u32 = 10_000;
pub const MAX_AWARD_BATCH: usize = 50;
pub const MAX_HELD: usize = 2_000;
const MAX_ID: usize = 48;
const MAX_TITLE: usize = 48;
const MAX_DESCRIPTION: usize = 280;
const MAX_ICON: usize = 16;
const MAX_QUEST_REF: usize = 96;
const MAX_RADIUS_M: u32 = 50_000;
const MIN_RADIUS_M: u32 = 25;

fn network() -> &'static str {
    if env::current_account_id().as_str().ends_with(".testnet") {
        "testnet"
    } else {
        "mainnet"
    }
}

fn valid_id(s: &str) {
    assert!(
        s.len() >= 3
            && s.len() <= MAX_ID
            && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !s.starts_with('-')
            && !s.ends_with('-'),
        "A badge id is 3-48 characters of a-z, 0-9 and inner dashes"
    );
}

fn valid_text(s: &str, min: usize, max: usize, what: &str) {
    let n = s.chars().count();
    assert!(n >= min && n <= max, "{what} must be {min}-{max} characters");
    assert!(!s.chars().any(|c| c.is_control()), "{what} cannot contain control characters");
    assert!(s.trim() == s, "{what} cannot start or end with spaces");
}

fn valid_color(s: &str) {
    let b = s.as_bytes();
    assert!(
        b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c)),
        "Color must be #rrggbb in lowercase hex"
    );
}

fn ed25519_key(key: Base64VecU8) -> [u8; 32] {
    key.0
        .try_into()
        .unwrap_or_else(|_| env::panic_str("An Ed25519 public key has 32 bytes"))
}

/// What holding the badge proves.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum BadgeKind {
    /// Reached a point: microdegrees and a radius in metres.
    Place { lat_e6: i32, lng_e6: i32, radius_m: u32 },
    /// Finished a quest the game server can check (its id in QuestLayer).
    Quest { quest_ref: String },
    /// Was there: handed out by the creator or with an event code.
    Event,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct BadgeInput {
    pub title: String,
    pub description: String,
    /// One emoji or a short glyph shown on the badge.
    pub icon: String,
    pub color: String,
    pub kind: BadgeKind,
    pub max_supply: u32,
    pub starts_at_ms: Option<U64>,
    pub ends_at_ms: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Badge {
    pub creator_id: AccountId,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub kind: BadgeKind,
    pub max_supply: u32,
    pub minted: u32,
    pub starts_at_ms: Option<U64>,
    pub ends_at_ms: Option<U64>,
    pub created_at_ms: U64,
    /// Accepting new holders. Creator or owner can pause; `closed` is final.
    pub active: bool,
    pub closed: bool,
    /// Created on the creator's behalf by the game (no refundable budget).
    pub sponsored: bool,
    /// Remaining prepaid claim budget in yoctoNEAR.
    pub budget: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Via {
    /// A claim the game's claim signer issued after checking the visit or quest.
    Signed,
    /// Handed out by the badge's creator.
    Creator,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Holding {
    pub badge_id: String,
    pub serial: u32,
    pub minted_at_ms: U64,
    pub via: Via,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TokenMetadata {
    pub title: String,
    pub description: String,
    pub issued_at: String,
    pub copies: u64,
    pub extra: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Badges {
    owner: AccountId,
    claim_signer: Option<[u8; 32]>,
    badges: UnorderedMap<String, Badge>,
    /// "<badge>\n<serial>" -> holder.
    holders: LookupMap<String, AccountId>,
    /// "<badge>\n<account>" -> serial; one per account per badge.
    held: LookupMap<String, u32>,
    /// account -> its badges, oldest first.
    owned: LookupMap<AccountId, Vector<Holding>>,
    /// creator -> badge ids.
    created: LookupMap<AccountId, Vec<String>>,
    total: u64,
}

#[near]
impl Badges {
    #[init]
    pub fn new(owner_id: AccountId, claim_signer: Option<Base64VecU8>) -> Self {
        Self {
            owner: owner_id,
            claim_signer: claim_signer.map(ed25519_key),
            badges: UnorderedMap::new(b"b".to_vec()),
            holders: LookupMap::new(b"h".to_vec()),
            held: LookupMap::new(b"d".to_vec()),
            owned: LookupMap::new(b"o".to_vec()),
            created: LookupMap::new(b"c".to_vec()),
            total: 0,
        }
    }

    // ---------------------------------------------------------------- owner

    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner = owner_id;
    }

    /// Sets (or clears, which stops all signed claims) the game's claim key.
    #[payable]
    pub fn set_claim_signer(&mut self, key: Option<Base64VecU8>) {
        self.assert_owner();
        self.claim_signer = key.map(ed25519_key);
    }

    // -------------------------------------------------------------- creators

    /// Prepaid deposit a creator attaches to `create_badge`.
    pub fn create_cost(&self, max_supply: u32) -> U128 {
        U128(BADGE_BASE_YOCTO + PER_CLAIM_YOCTO * max_supply as u128)
    }

    /// Publishes a new badge design. Ids are first come, first served and never
    /// reused. A creator pays `create_cost`; the contract's own key (the game
    /// server) or the owner may sponsor a badge for `creator_id`.
    #[payable]
    pub fn create_badge(&mut self, badge_id: String, input: BadgeInput, creator_id: Option<AccountId>) -> Badge {
        valid_id(&badge_id);
        assert!(self.badges.get(&badge_id).is_none(), "Badge id already taken");
        let caller = env::predecessor_account_id();
        let sponsor = caller == env::current_account_id() || caller == self.owner;
        let creator_id = match creator_id {
            Some(c) if sponsor => c,
            Some(c) => {
                assert_eq!(c, caller, "Only the game can create a badge for someone else");
                c
            }
            None => caller.clone(),
        };
        valid_text(&input.title, 3, MAX_TITLE, "Title");
        valid_text(&input.description, 0, MAX_DESCRIPTION, "Description");
        valid_text(&input.icon, 1, MAX_ICON, "Icon");
        assert!(input.icon.len() <= MAX_ICON, "Icon is at most {MAX_ICON} bytes");
        valid_color(&input.color);
        assert!(input.max_supply >= 1 && input.max_supply <= MAX_SUPPLY, "Supply must be 1-{MAX_SUPPLY}");
        match &input.kind {
            BadgeKind::Place { lat_e6, lng_e6, radius_m } => {
                assert!(lat_e6.unsigned_abs() <= 85_000_000 && lng_e6.unsigned_abs() <= 180_000_000, "Invalid place");
                assert!((MIN_RADIUS_M..=MAX_RADIUS_M).contains(radius_m), "Radius must be {MIN_RADIUS_M}-{MAX_RADIUS_M} m");
            }
            BadgeKind::Quest { quest_ref } => {
                assert!(
                    !quest_ref.is_empty()
                        && quest_ref.len() <= MAX_QUEST_REF
                        && quest_ref.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.')),
                    "Invalid quest reference"
                );
            }
            BadgeKind::Event => {}
        }
        if let (Some(s), Some(e)) = (input.starts_at_ms, input.ends_at_ms) {
            assert!(e.0 > s.0, "The claim window must end after it starts");
        }
        let deposit = env::attached_deposit().as_yoctonear();
        let budget = if sponsor {
            0
        } else {
            let cost = self.create_cost(input.max_supply).0;
            assert!(deposit >= cost, "Attach {cost} yoctoNEAR to fund this badge");
            if deposit > cost {
                Promise::new(caller.clone()).transfer(NearToken::from_yoctonear(deposit - cost)).detach();
            }
            cost - BADGE_BASE_YOCTO
        };
        let badge = Badge {
            creator_id: creator_id.clone(),
            title: input.title,
            description: input.description,
            icon: input.icon,
            color: input.color,
            kind: input.kind,
            max_supply: input.max_supply,
            minted: 0,
            starts_at_ms: input.starts_at_ms,
            ends_at_ms: input.ends_at_ms,
            created_at_ms: U64(env::block_timestamp_ms()),
            active: true,
            closed: false,
            sponsored: sponsor,
            budget: U128(budget),
        };
        self.badges.insert(&badge_id, &badge);
        let mut mine = self.created.get(&creator_id).unwrap_or_default();
        mine.push(badge_id.clone());
        self.created.insert(&creator_id, &mine);
        self.event("questlayer_badges", "badge_created", near_sdk::serde_json::json!({ "badge_id": badge_id, "badge": badge }));
        badge
    }

    /// Pauses or resumes new holders. The creator or the owner (moderation).
    #[payable]
    pub fn set_badge_active(&mut self, badge_id: String, active: bool) {
        near_sdk::assert_one_yocto();
        let mut badge = self.badges.get(&badge_id).expect("Unknown badge");
        let caller = env::predecessor_account_id();
        assert!(caller == badge.creator_id || caller == self.owner, "Creator or owner only");
        assert!(!badge.closed, "Badge is closed");
        badge.active = active;
        self.badges.insert(&badge_id, &badge);
        self.event("questlayer_badges", "badge_active", near_sdk::serde_json::json!({ "badge_id": badge_id, "active": active }));
    }

    /// Ends a badge for good and refunds the unused claim budget to its creator.
    /// Badges already held stay with their holders.
    #[payable]
    pub fn close_badge(&mut self, badge_id: String) -> U128 {
        near_sdk::assert_one_yocto();
        let mut badge = self.badges.get(&badge_id).expect("Unknown badge");
        let caller = env::predecessor_account_id();
        assert!(caller == badge.creator_id || caller == self.owner, "Creator or owner only");
        assert!(!badge.closed, "Badge is closed");
        let refund = badge.budget.0;
        badge.active = false;
        badge.closed = true;
        badge.budget = U128(0);
        self.badges.insert(&badge_id, &badge);
        if refund > 0 {
            Promise::new(badge.creator_id.clone()).transfer(NearToken::from_yoctonear(refund)).detach();
        }
        self.event("questlayer_badges", "badge_closed", near_sdk::serde_json::json!({ "badge_id": badge_id, "refund": U128(refund) }));
        U128(refund)
    }

    /// The creator hands the badge to up to 50 accounts. Accounts that already
    /// hold it are skipped. Returns the newly minted token ids.
    pub fn award(&mut self, badge_id: String, account_ids: Vec<AccountId>) -> Vec<String> {
        assert_eq!(env::attached_deposit().as_yoctonear(), 0, "Badges take no deposit here");
        assert!(!account_ids.is_empty() && account_ids.len() <= MAX_AWARD_BATCH, "Award 1-{MAX_AWARD_BATCH} accounts at a time");
        let badge = self.badges.get(&badge_id).expect("Unknown badge");
        assert_eq!(env::predecessor_account_id(), badge.creator_id, "Creator only");
        let mut out = Vec::new();
        for a in account_ids {
            if self.held.get(&held_key(&badge_id, &a)).is_some() {
                continue;
            }
            out.push(self.mint(&badge_id, &a, Via::Creator));
        }
        out
    }

    // --------------------------------------------------------------- claims

    /// The exact text the game's claim signer signs.
    pub fn claim_message(&self, badge_id: String, account_id: AccountId, expires_at_ms: U64) -> String {
        format!(
            "QuestLayer badge claim v1\nContract: {}\nNetwork: {}\nBadge: {}\nAccount: {}\nExpires: {}",
            env::current_account_id(),
            network(),
            badge_id,
            account_id,
            expires_at_ms.0
        )
    }

    /// Mints the badge to `account_id` with a claim the game server signed.
    /// Anyone may submit it; the badge always goes to the signed account.
    pub fn claim(&mut self, badge_id: String, account_id: AccountId, expires_at_ms: U64, signature: Base64VecU8) -> String {
        assert_eq!(env::attached_deposit().as_yoctonear(), 0, "Badges take no deposit here");
        let key = self.claim_signer.expect("Signed claims are not enabled");
        let sig: [u8; 64] = signature
            .0
            .try_into()
            .unwrap_or_else(|_| env::panic_str("An Ed25519 signature has 64 bytes"));
        let message = self.claim_message(badge_id.clone(), account_id.clone(), expires_at_ms);
        assert!(env::ed25519_verify(&sig, message.as_bytes(), &key), "Invalid badge claim");
        assert!(env::block_timestamp_ms() <= expires_at_ms.0, "Badge claim expired");
        assert!(self.held.get(&held_key(&badge_id, &account_id)).is_none(), "Already holds this badge");
        self.mint(&badge_id, &account_id, Via::Signed)
    }

    fn mint(&mut self, badge_id: &str, account_id: &AccountId, via: Via) -> String {
        let mut badge = self.badges.get(&badge_id.to_string()).expect("Unknown badge");
        assert!(badge.active && !badge.closed, "Badge is not accepting holders");
        let now = env::block_timestamp_ms();
        assert!(badge.starts_at_ms.map_or(true, |s| now >= s.0), "Badge is not open yet");
        assert!(badge.ends_at_ms.map_or(true, |e| now < e.0), "Badge has ended");
        assert!(badge.minted < badge.max_supply, "All badges are given out");
        let mut list = self.owned.get(account_id).unwrap_or_else(|| {
            let mut prefix = b"v".to_vec();
            prefix.extend_from_slice(&env::sha256_array(account_id.as_bytes()));
            Vector::new(prefix)
        });
        assert!((list.len() as usize) < MAX_HELD, "This account holds the maximum number of badges");
        badge.minted += 1;
        if !badge.sponsored {
            badge.budget = U128(badge.budget.0.saturating_sub(PER_CLAIM_YOCTO));
        }
        let serial = badge.minted;
        self.badges.insert(&badge_id.to_string(), &badge);
        self.holders.insert(&format!("{badge_id}\n{serial}"), account_id);
        self.held.insert(&held_key(badge_id, account_id), &serial);
        list.push(&Holding { badge_id: badge_id.to_string(), serial, minted_at_ms: U64(now), via: via.clone() });
        self.owned.insert(account_id, &list);
        self.total += 1;
        let token_id = format!("{badge_id}:{serial}");
        self.event(
            "nep171",
            "nft_mint",
            near_sdk::serde_json::json!({ "owner_id": account_id, "token_ids": [token_id], "memo": format!("{via:?}") }),
        );
        token_id
    }

    // ---------------------------------------------------------------- views

    pub fn get_badge(&self, badge_id: String) -> Option<Badge> {
        self.badges.get(&badge_id)
    }
    pub fn get_badges(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<(String, Badge)> {
        self.badges
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }
    pub fn badges_by_creator(&self, creator_id: AccountId) -> Vec<String> {
        self.created.get(&creator_id).unwrap_or_default()
    }
    pub fn has_badge(&self, badge_id: String, account_id: AccountId) -> Option<u32> {
        self.held.get(&held_key(&badge_id, &account_id))
    }
    pub fn badges_of(&self, account_id: AccountId, from_index: Option<u64>, limit: Option<u64>) -> Vec<Holding> {
        match self.owned.get(&account_id) {
            None => vec![],
            Some(list) => {
                let from = from_index.unwrap_or(0);
                let to = (from + limit.unwrap_or(50).min(100)).min(list.len());
                (from..to).filter_map(|i| list.get(i)).collect()
            }
        }
    }
    /// Holders by serial, starting at serial `from_serial` (1-based).
    pub fn holders(&self, badge_id: String, from_serial: Option<u32>, limit: Option<u32>) -> Vec<(u32, AccountId)> {
        let Some(badge) = self.badges.get(&badge_id) else { return vec![] };
        let from = from_serial.unwrap_or(1).max(1);
        let to = from.saturating_add(limit.unwrap_or(50).min(100)).min(badge.minted + 1);
        (from..to)
            .filter_map(|s| self.holders.get(&format!("{badge_id}\n{s}")).map(|a| (s, a)))
            .collect()
    }
    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "owner_id": self.owner,
            "network": network(),
            "claim_signer": self.claim_signer.map(|k| Base64VecU8(k.to_vec())),
            "badges": self.badges.len(),
            "tokens": self.total,
            "badge_base_yocto": U128(BADGE_BASE_YOCTO),
            "per_claim_yocto": U128(PER_CLAIM_YOCTO),
            "max_supply": MAX_SUPPLY,
            "transferable": false,
        })
    }

    // ------------------------------------------- NEP-171 / NEP-177 (views only)

    pub fn nft_metadata(&self) -> ContractMetadata {
        ContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "QuestLayer Badges".into(),
            symbol: "QLBADGE".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
    pub fn nft_total_supply(&self) -> U128 {
        U128(self.total as u128)
    }
    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let (badge_id, serial) = token_id.rsplit_once(':')?;
        let serial: u32 = serial.parse().ok()?;
        let owner = self.holders.get(&format!("{badge_id}\n{serial}"))?;
        let holding = self.badges_of_all(&owner).into_iter().find(|h| h.badge_id == badge_id)?;
        Some(self.token(&owner, &holding))
    }
    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owned.get(&account_id).map_or(0, |l| l.len() as u128))
    }
    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.badges_of(account_id.clone(), from_index.map(|x| x.0 as u64), limit)
            .iter()
            .map(|h| self.token(&account_id, h))
            .collect()
    }

    fn badges_of_all(&self, account_id: &AccountId) -> Vec<Holding> {
        self.owned.get(account_id).map(|l| l.iter().collect()).unwrap_or_default()
    }
    fn token(&self, owner: &AccountId, h: &Holding) -> Token {
        let badge = self.badges.get(&h.badge_id).expect("Unknown badge");
        Token {
            token_id: format!("{}:{}", h.badge_id, h.serial),
            owner_id: owner.clone(),
            metadata: TokenMetadata {
                title: format!("{} {}", badge.icon, badge.title),
                description: badge.description.clone(),
                issued_at: h.minted_at_ms.0.to_string(),
                copies: badge.max_supply as u64,
                extra: near_sdk::serde_json::json!({
                    "badge_id": h.badge_id,
                    "serial": h.serial,
                    "creator_id": badge.creator_id,
                    "kind": badge.kind,
                    "color": badge.color,
                    "via": h.via,
                    "soulbound": true,
                })
                .to_string(),
            },
        }
    }

    fn event(&self, standard: &str, name: &str, data: near_sdk::serde_json::Value) {
        let version = if standard == "nep171" { "1.2.0" } else { "1.0.0" };
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({ "standard": standard, "version": version, "event": name, "data": [data] })
        ));
    }
}

fn held_key(badge_id: &str, account_id: &AccountId) -> String {
    format!("{badge_id}\n{account_id}")
}

#[cfg(test)]
mod tests;
