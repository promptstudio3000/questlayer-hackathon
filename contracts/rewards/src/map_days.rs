//! Map days (docs/MAP-REWARDS.md): one Merkle root of per-cell budgets for the
//! whole map per day, instead of a published coin list per city.
//!
//! - `publish_map_day` (publisher) commits the root and reserves the day's coin
//!   and zone budget in NEAR from the same coin/zone buckets as city days (the
//!   same per-date cap across cities applies; day id `map-YYYY-MM-DD-v<n>`).
//! - `claim_map` (attested like `claim`) carries the cell's leaf fields and its
//!   proof. The contract rebuilds the leaf, checks it against the root, and pays
//!   a coin only while the cell's budget lasts (coins: coinsU, twice that on a
//!   pioneer cell; zones: zonesU across at most `zones` first finishers). Every
//!   claim is also bounded by the day's reserved remainder, so no proof can pay
//!   more than was reserved.
//! - `close_map_day` returns what nobody collected to the available buckets.
//!
//! Amounts in the leaf are GOLD micro units; `yocto_per_u` fixed at publish
//! turns them into NEAR. Credits are withdrawn like any reward: into the QGOLD
//! vault, minted at R. State lives under new storage keys (no layout change).
use crate::*;

/// Largest coin: 0.2 GOLD (map-rewards-v1 cap).
pub const MAP_MAX_COIN_U: u128 = 200_000;
pub const MAP_MAX_COINS_PER_CELL: u16 = 1024;
const MAP_ZONE_XP: u16 = 40;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct MapDay {
    pub date: String,
    pub policy: String,
    pub root: String,
    pub starts: u64,
    pub ends: u64,
    #[serde(with = "u128_str")]
    pub yocto_per_u: u128,
    #[serde(with = "u128_str")]
    pub coins_reserved: u128,
    #[serde(with = "u128_str")]
    pub zones_reserved: u128,
    #[serde(with = "u128_str")]
    pub coins_left: u128,
    #[serde(with = "u128_str")]
    pub zones_left: u128,
    pub claims: u32,
    pub closed: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct MapCell {
    coins_spent_u: u128,
    zones_spent_u: u128,
    coins: Vec<u8>,
    zones_won: u8,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MapClaim {
    pub receipt_id: String,
    pub day_id: String,
    /// "coin" or "zone".
    pub kind: String,
    pub cell: String,
    pub coins_u: U128,
    pub zones_u: U128,
    pub zones: u8,
    pub pioneer: bool,
    pub seed: String,
    pub proof: Vec<String>,
    /// Coin index in the cell, or zone index (0..zones).
    pub index: u16,
    pub value_u: U128,
    pub receiver_id: AccountId,
    pub received_at: U64,
    pub evidence_hash: String,
}

mod u128_str {
    use near_sdk::serde::Serializer;
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
}

fn map_days() -> LookupMap<String, MapDay> {
    LookupMap::new(b"native-map-days-v1".to_vec())
}
fn map_cells() -> LookupMap<String, MapCell> {
    LookupMap::new(b"native-map-cells-v1".to_vec())
}

fn hash_pair(a: &[u8], b: &[u8]) -> Vec<u8> {
    let (l, r) = if a <= b { (a, b) } else { (b, a) };
    let mut buf = Vec::with_capacity(l.len() + r.len());
    buf.extend_from_slice(l);
    buf.extend_from_slice(r);
    env::sha256(&buf)
}
fn unhex(s: &str) -> Vec<u8> {
    valid_hash(s);
    (0..32).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

/// The leaf of server/map-rewards/day-plan.mjs `cellLeaf`.
pub fn map_leaf(policy: &str, date: &str, c: &MapClaim) -> String {
    hex(&env::sha256(
        format!(
            "qlmap1|{policy}|{date}|{}|{}|{}|{}|{}|{}",
            c.cell,
            c.coins_u.0,
            c.zones_u.0,
            c.zones,
            if c.pioneer { 1 } else { 0 },
            c.seed
        )
        .as_bytes(),
    ))
}

pub fn verify_map_proof(leaf: &str, proof: &[String], root: &str) -> bool {
    let mut node = unhex(leaf);
    for s in proof {
        node = hash_pair(&node, &unhex(s));
    }
    hex(&node) == root
}

fn valid_token(s: &str, max: usize, what: &str) {
    assert!(
        !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.'),
        "Invalid {what}"
    );
}

#[near_bindgen]
impl Rewards {
    #[allow(clippy::too_many_arguments)]
    pub fn publish_map_day(
        &mut self,
        day_id: String,
        policy: String,
        root: String,
        starts_at: U64,
        ends_at: U64,
        coins_u: U128,
        zones_u: U128,
        yocto_per_u: U128,
    ) {
        self.publisher();
        assert!(!self.paused, "Publication paused");
        valid_id(&day_id);
        assert!(day_id.len() <= 40 && day_id.starts_with("map-"), "Map day id is map-YYYY-MM-DD-v<n>");
        valid_token(&policy, 40, "policy");
        valid_hash(&root);
        assert!(map_days().get(&day_id).is_none() && self.days.get(&day_id).is_none(), "Day exists");
        let now = now_ms();
        assert!(
            ends_at.0 > now && ends_at.0 > starts_at.0 && ends_at.0 - starts_at.0 <= 25 * 3_600_000 && starts_at.0 <= now + 2 * DAY_MS,
            "Invalid day window"
        );
        assert!(yocto_per_u.0 > 0 && yocto_per_u.0 <= NEAR / 1_000_000, "Invalid GOLD rate");
        let coin_cost = coins_u.0.checked_mul(yocto_per_u.0).expect("Overflow");
        let zone_cost = zones_u.0.checked_mul(yocto_per_u.0).expect("Overflow");
        assert!(coin_cost > 0 || zone_cost > 0, "Empty map day");
        assert!(coin_cost <= self.coins.available && zone_cost <= self.zones.available, "Insufficient liquid funding");
        // Same per-date cap across cities and the map (0.1 NEAR each on testnet).
        self.add_to_date_total(&day_id, coin_cost, zone_cost);
        self.reserve_storage(&day_id);
        self.coins.available -= coin_cost;
        self.coins.reserved += coin_cost;
        self.zones.available -= zone_cost;
        self.zones.reserved += zone_cost;
        let date = day_id[4..14].to_string();
        map_days().insert(
            &day_id,
            &MapDay {
                date,
                policy,
                root: root.clone(),
                starts: starts_at.0,
                ends: ends_at.0,
                yocto_per_u: yocto_per_u.0,
                coins_reserved: coin_cost,
                zones_reserved: zone_cost,
                coins_left: coin_cost,
                zones_left: zone_cost,
                claims: 0,
                closed: false,
            },
        );
        self.check();
        event(
            "map_day_published",
            near_sdk::serde_json::json!({"day_id":day_id,"root":root,"coins":coin_cost.to_string(),"zones":zone_cost.to_string()}),
        );
    }

    pub fn map_claim_message(&self, claim: MapClaim) -> String {
        format!(
            "QuestLayer map reward v1\nNetwork: testnet\nContract: {}\nReceipt: {}\nDay: {}\nKind: {}\nCell: {}\nIndex: {}\nValue: {}\nReceiver: {}\nReceived: {}\nEvidence: {}",
            env::current_account_id(),
            claim.receipt_id,
            claim.day_id,
            claim.kind,
            claim.cell,
            claim.index,
            claim.value_u.0,
            claim.receiver_id,
            claim.received_at.0,
            claim.evidence_hash
        )
    }

    /// The attestor validates presence off chain; the root bounds the money.
    pub fn claim_map(&mut self, claim: MapClaim, signature: Base64VecU8) -> Receipt {
        valid_id(&claim.receipt_id);
        valid_id(&claim.day_id);
        assert!(claim.receipt_id.len() <= 64 && claim.day_id.len() <= 40, "Receipt identifier too long");
        valid_token(&claim.cell, 20, "cell");
        valid_token(&claim.seed, 64, "seed");
        valid_hash(&claim.evidence_hash);
        assert!(claim.proof.len() <= 32, "Proof too long");
        let message = self.map_claim_message(claim.clone());
        let signature: [u8; 64] = signature.0.try_into().expect("Invalid signature length");
        let key: [u8; 32] = self.signer.clone().try_into().unwrap();
        assert!(env::ed25519_verify(&signature, message.as_bytes(), &key), "Invalid attestation");
        let message_hash = hex(&env::sha256(message.as_bytes()));
        if let Some(receipt) = self.receipts.get(&claim.receipt_id) {
            assert_eq!(receipt.message_hash, message_hash, "Receipt conflict");
            return receipt;
        }
        assert!(!self.paused, "Claims paused");
        let before_storage = env::storage_usage();
        let mut slots = storage_slots();
        let remaining_slots = slots.get(&format!("day:{}", claim.day_id)).expect("Day storage not reserved");
        assert!(remaining_slots > 0, "Daily native receipt capacity reached");
        let mut days = map_days();
        let mut day = days.get(&claim.day_id).expect("Unknown map day");
        assert!(!day.closed, "Day closed");
        assert!(
            claim.received_at.0 >= day.starts && claim.received_at.0 < day.ends && claim.received_at.0 <= now_ms(),
            "Invalid receipt time"
        );
        assert!(claim.zones <= 3, "At most 3 zones per cell");
        let leaf = map_leaf(&day.policy, &day.date, &claim);
        assert!(verify_map_proof(&leaf, &claim.proof, &day.root), "Cell is not in the day's root");
        let key = format!("{}|{}", claim.day_id, claim.cell);
        let mut cells = map_cells();
        let mut cell = cells.get(&key).unwrap_or_default();
        let value = claim.value_u.0;
        assert!(value > 0, "Empty reward");
        let amount = value.checked_mul(day.yocto_per_u).expect("Overflow");
        let xp = if claim.kind == "coin" {
            assert!(claim.index < MAP_MAX_COINS_PER_CELL, "Invalid coin index");
            assert!(value <= MAP_MAX_COIN_U, "Coin above the 0.2 GOLD cap");
            if cell.coins.is_empty() {
                cell.coins = vec![0; MAP_MAX_COINS_PER_CELL as usize / 8];
            }
            let (byte, mask) = (claim.index as usize / 8, 1u8 << (claim.index % 8));
            assert!(cell.coins[byte] & mask == 0, "Coin already claimed");
            let budget = claim.coins_u.0 * if claim.pioneer { 2 } else { 1 };
            assert!(cell.coins_spent_u + value <= budget, "Cell coin budget spent");
            assert!(amount <= day.coins_left, "Map day coin budget spent");
            cell.coins[byte] |= mask;
            cell.coins_spent_u += value;
            day.coins_left -= amount;
            self.coins.reserved -= amount;
            self.coins.awarded += amount;
            COIN_XP
        } else {
            assert_eq!(claim.kind, "zone", "Invalid claim kind");
            assert!((claim.index as u8) < claim.zones && claim.index < 3, "Invalid zone index");
            let bit = 1u8 << claim.index;
            assert!(cell.zones_won & bit == 0, "Zone already won");
            assert!(cell.zones_spent_u + value <= claim.zones_u.0, "Cell zone budget spent");
            assert!(amount <= day.zones_left, "Map day zone budget spent");
            cell.zones_won |= bit;
            cell.zones_spent_u += value;
            day.zones_left -= amount;
            self.zones.reserved -= amount;
            self.zones.awarded += amount;
            MAP_ZONE_XP
        };
        day.claims += 1;
        let mut p = self.players.get(&claim.receiver_id).unwrap_or_default();
        p.credit += amount;
        p.xp += xp as u64;
        self.owed += amount;
        self.players.insert(&claim.receiver_id, &p);
        cells.insert(&key, &cell);
        days.insert(&claim.day_id, &day);
        let receipt = Receipt { receiver_id: claim.receiver_id.clone(), amount: U128(amount), xp, message_hash };
        self.receipts.insert(&claim.receipt_id, &receipt);
        slots.insert(&format!("day:{}", claim.day_id), &(remaining_slots - 1));
        let total = slots.get(&"__total".to_string()).unwrap_or(0);
        slots.insert(&"__total".to_string(), &(total - 1));
        // A first claim in a cell also stores its 128-byte coin bitmap.
        assert!(env::storage_usage().saturating_sub(before_storage) <= CLAIM_STORAGE, "Receipt exceeded sponsored storage bound");
        self.check();
        event(
            "map_claim",
            near_sdk::serde_json::json!({"receipt_id":claim.receipt_id,"receiver_id":claim.receiver_id,"cell":claim.cell,"kind":claim.kind,"amount":amount.to_string(),"xp":xp}),
        );
        receipt
    }

    /// Returns what nobody collected to the available buckets (after a grace day).
    pub fn close_map_day(&mut self, day_id: String) {
        self.publisher();
        let mut days = map_days();
        let mut day = days.get(&day_id).expect("Unknown map day");
        if day.closed {
            return;
        }
        assert!(now_ms() >= day.ends + DAY_MS, "Receipt grace period");
        self.coins.reserved -= day.coins_left;
        self.coins.available += day.coins_left;
        self.zones.reserved -= day.zones_left;
        self.zones.available += day.zones_left;
        day.coins_left = 0;
        day.zones_left = 0;
        day.closed = true;
        days.insert(&day_id, &day);
        let mut slots = storage_slots();
        if let Some(left) = slots.get(&format!("day:{day_id}")) {
            let total = slots.get(&"__total".into()).unwrap_or(0);
            slots.insert(&"__total".into(), &(total - left));
            slots.insert(&format!("day:{day_id}"), &0);
        }
        self.check();
        event("map_day_closed", near_sdk::serde_json::json!({"day_id":day_id}));
    }

    pub fn get_map_day(&self, day_id: String) -> Option<MapDay> {
        map_days().get(&day_id)
    }

    /// Spent budget and claimed coins of one cell on one map day.
    pub fn get_map_cell(&self, day_id: String, cell: String) -> near_sdk::serde_json::Value {
        let c = map_cells().get(&format!("{day_id}|{cell}")).unwrap_or_default();
        let claimed: Vec<u16> = (0..MAP_MAX_COINS_PER_CELL)
            .filter(|i| c.coins.get(*i as usize / 8).is_some_and(|b| b & (1 << (i % 8)) != 0))
            .collect();
        near_sdk::serde_json::json!({"coins_spent_u":c.coins_spent_u.to_string(),"zones_spent_u":c.zones_spent_u.to_string(),"claimed_coins":claimed,"zones_won":c.zones_won})
    }
}

#[cfg(test)]
mod map_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::{test_utils::VMContextBuilder, testing_env};

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, time: u64, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("rewards.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .block_timestamp(time * 1_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    fn mk(cell: &str, coins: u128, zones: u128, nz: u8, pioneer: bool) -> MapClaim {
        MapClaim {
            receipt_id: format!("r-{cell}"),
            day_id: "map-2026-11-01-v1".into(),
            kind: "coin".into(),
            cell: cell.into(),
            coins_u: U128(coins),
            zones_u: U128(zones),
            zones: nz,
            pioneer,
            seed: "ab12".into(),
            proof: vec![],
            index: 0,
            value_u: U128(0),
            receiver_id: a("alice.testnet"),
            received_at: U64(2),
            evidence_hash: "b".repeat(64),
        }
    }
    /// Same tree as server/chain-ledger/merkle.mjs.
    fn tree(leaves: &[String]) -> (String, Vec<Vec<String>>) {
        let mut level: Vec<Vec<u8>> = leaves.iter().map(|l| unhex(l)).collect();
        let mut pos: Vec<usize> = (0..leaves.len()).collect();
        let mut proofs = vec![vec![]; leaves.len()];
        while level.len() > 1 {
            let next: Vec<Vec<u8>> = level.chunks(2).map(|c| if c.len() == 2 { hash_pair(&c[0], &c[1]) } else { c[0].clone() }).collect();
            for (i, p) in pos.iter_mut().enumerate() {
                let s = *p ^ 1;
                if s < level.len() {
                    proofs[i].push(hex(&level[s]));
                }
                *p >>= 1;
            }
            level = next;
        }
        (hex(&level[0]), proofs)
    }
    fn sign(r: &Rewards, c: &MapClaim) -> Base64VecU8 {
        Base64VecU8(SigningKey::from_bytes(&[7; 32]).sign(r.map_claim_message(c.clone()).as_bytes()).to_bytes().to_vec())
    }
    /// Three cells; returns the contract and the cells' claims with proofs.
    fn setup() -> (Rewards, Vec<MapClaim>) {
        ctx("owner.testnet", 1, 0);
        let mut r = Rewards::new(a("owner.testnet"), a("publisher.testnet"), Base64VecU8(SigningKey::from_bytes(&[7; 32]).verifying_key().to_bytes().to_vec()));
        ctx("sponsor.testnet", 1, 2001 + SPONSOR_STORAGE_FEE);
        r.fund_rewards("sponsor".into(), "fund-1".into());
        let mut cells = vec![mk("871e3519affffff", 100, 60, 2, false), mk("871e351a8ffffff", 50, 0, 1, true), mk("871e351b0ffffff", 20, 0, 1, false)];
        ctx("publisher.testnet", 1, 0);
        let leaves: Vec<String> = cells.iter().map(|c| map_leaf("map-rewards-v1", "2026-11-01", c)).collect();
        let (root, proofs) = tree(&leaves);
        for (c, p) in cells.iter_mut().zip(proofs) {
            c.proof = p;
        }
        r.publish_map_day("map-2026-11-01-v1".into(), "map-rewards-v1".into(), root, U64(1), U64(1000), U128(220), U128(60), U128(2));
        (r, cells)
    }
    fn claim(r: &mut Rewards, base: &MapClaim, kind: &str, index: u16, value: u128, id: &str) -> Receipt {
        let mut c = base.clone();
        c.kind = kind.into();
        c.index = index;
        c.value_u = U128(value);
        c.receipt_id = id.into();
        ctx("relayer.testnet", 3, 0);
        let s = sign(r, &c);
        r.claim_map(c, s)
    }

    #[test]
    fn leaf_matches_the_server_format() {
        ctx("x.testnet", 1, 0);
        let c = mk("871e3519affffff", 100, 60, 2, true);
        let want = hex(&env::sha256(b"qlmap1|map-rewards-v1|2026-11-01|871e3519affffff|100|60|2|1|ab12"));
        assert_eq!(map_leaf("map-rewards-v1", "2026-11-01", &c), want);
    }

    #[test]
    fn coins_pay_from_the_cell_budget_in_near() {
        let (mut r, cells) = setup();
        assert_eq!(r.coins.reserved, 440);
        let rc = claim(&mut r, &cells[0], "coin", 0, 30, "c1");
        assert_eq!(rc.amount.0, 60);
        claim(&mut r, &cells[0], "coin", 1, 70, "c2");
        assert_eq!(r.get_account(a("alice.testnet"))["credit"], "200");
        let left = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| claim(&mut r, &cells[0], "coin", 2, 1, "c3")));
        assert!(left.is_err(), "cell budget spent");
        // Pioneer cells pay up to twice their coinsU.
        claim(&mut r, &cells[1], "coin", 0, 100, "p1");
        assert_eq!(r.get_map_day("map-2026-11-01-v1".into()).unwrap().claims, 3);
    }

    #[test]
    #[should_panic(expected = "Coin already claimed")]
    fn a_coin_pays_once() {
        let (mut r, cells) = setup();
        claim(&mut r, &cells[2], "coin", 4, 5, "a");
        claim(&mut r, &cells[2], "coin", 4, 5, "b");
    }

    #[test]
    #[should_panic(expected = "Cell is not in the day's root")]
    fn a_forged_budget_fails_the_proof() {
        let (mut r, cells) = setup();
        let mut c = cells[2].clone();
        c.coins_u = U128(10_000);
        claim(&mut r, &c, "coin", 0, 5_000, "x");
    }

    #[test]
    #[should_panic(expected = "Coin above the 0.2 GOLD cap")]
    fn coins_are_capped() {
        let (mut r, cells) = setup();
        claim(&mut r, &cells[0], "coin", 0, MAP_MAX_COIN_U + 1, "x");
    }

    #[test]
    fn zones_pay_their_first_finishers_and_close_returns_the_rest() {
        let (mut r, cells) = setup();
        claim(&mut r, &cells[0], "zone", 0, 40, "z1");
        let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| claim(&mut r, &cells[0], "zone", 0, 10, "z2")));
        assert!(again.is_err(), "zone already won");
        let third = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| claim(&mut r, &cells[0], "zone", 2, 10, "z3")));
        assert!(third.is_err(), "cell has 2 zones");
        let avail = (r.coins.available, r.zones.available);
        ctx("publisher.testnet", 1000 + DAY_MS, 0);
        r.close_map_day("map-2026-11-01-v1".into());
        assert_eq!(r.coins.available, avail.0 + 440);
        assert_eq!(r.zones.available, avail.1 + 120 - 80);
        assert_eq!(r.coins.reserved + r.zones.reserved, 0);
    }

    #[test]
    #[should_panic(expected = "Invalid attestation")]
    fn claims_need_the_attestor() {
        let (mut r, cells) = setup();
        let mut c = cells[0].clone();
        c.value_u = U128(10);
        ctx("relayer.testnet", 3, 0);
        let s = Base64VecU8(SigningKey::from_bytes(&[9; 32]).sign(r.map_claim_message(c.clone()).as_bytes()).to_bytes().to_vec());
        r.claim_map(c, s);
    }
}
