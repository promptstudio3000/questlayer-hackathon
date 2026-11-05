//! Daily payouts (docs/DAILY-PAYOUTS.md): one Merkle root of what every
//! account earned on one day, paid straight into the QGOLD vault.
//!
//! - `publish_payout_day` (publisher) commits the root of `leaves` accounts and
//!   reserves the day's total in NEAR from the coin and zone buckets, under the
//!   same per-date cap as city and map days (day id `payout-YYYY-MM-DD-v<n>`).
//! - `claim_payout` (anyone, batched) carries leaves and their proofs. The
//!   contract rebuilds each leaf, checks it against the root, sets the leaf's
//!   bit and calls the vault's `mint_for` with exactly that NEAR, so the QGOLD
//!   lands on the account. Nobody can redirect it: the account is in the leaf.
//!   A leaf already paid (or in flight) is skipped, so retries are safe. If the
//!   vault refuses (paused, dust), the callback clears the bit and returns the
//!   NEAR to the day, so the same leaf can be claimed again.
//! - `close_payout_day` (publisher, after the grace period) returns what was
//!   not claimed to the available buckets and frees the bitmap.
//!
//! Per day the contract stores only the root, the totals and a bitmap of
//! claimed leaves (32-byte chunks of 256 leaves). No receipt per account, so
//! there is no per-day receipt limit: a day can pay every player.
//!
//! Leaf: sha256("payout|<day_id>|<index>|<account>|<amount_yocto>"), hex. The
//! tree hashes sorted pairs and carries an odd node up, like map days and
//! server/chain-ledger/merkle.mjs. `index` is the leaf's position (0..leaves),
//! it numbers the bitmap bit.
use crate::*;

/// Grace after publication before an unclaimed day can be closed.
pub const PAYOUT_GRACE_MS: u64 = 3 * DAY_MS;
/// Leaves claimed in one transaction (each is one vault call plus a callback).
pub const PAYOUT_MAX_BATCH: usize = 10;
/// Most accounts one day can pay.
pub const PAYOUT_MAX_LEAVES: u32 = 262_144;
/// Smallest leaf: the vault mints nothing below one QGOLD unit (1e-6 QGOLD,
/// 1e15 yocto at R = 0.001), so the server carries smaller amounts forward.
pub const PAYOUT_MIN_YOCTO: u128 = 10_000_000_000_000_000;
const CHUNK_BITS: u32 = 256;
/// Storage bound of one bitmap chunk (32 bytes, its key and trie overhead).
const CHUNK_STORAGE: u64 = 160;
const MINT_GAS: Gas = Gas::from_tgas(14);
const CALLBACK_GAS: Gas = Gas::from_tgas(6);

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutDay {
    pub root: String,
    pub leaves: u32,
    pub published_at: u64,
    #[serde(with = "u128_str")]
    pub coins_reserved: u128,
    #[serde(with = "u128_str")]
    pub zones_reserved: u128,
    #[serde(with = "u128_str")]
    pub coins_left: u128,
    #[serde(with = "u128_str")]
    pub zones_left: u128,
    #[serde(with = "u128_str")]
    pub paid: u128,
    pub paid_leaves: u32,
    pub closed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutLeaf {
    pub index: u32,
    pub account_id: AccountId,
    pub amount_yocto: U128,
    pub proof: Vec<String>,
}

mod u128_str {
    use near_sdk::serde::Serializer;
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
}

#[allow(dead_code)]
#[ext_contract(ext_payout)]
trait PayoutCallbacks {
    fn on_payout(&mut self, day_id: String, index: u32, account_id: AccountId, coins: U128, zones: U128) -> bool;
}

fn payout_days() -> LookupMap<String, PayoutDay> {
    LookupMap::new(b"native-payout-days-v1".to_vec())
}
fn payout_bits() -> LookupMap<String, Vec<u8>> {
    LookupMap::new(b"native-payout-bits-v1".to_vec())
}
fn chunk_key(day_id: &str, index: u32) -> String {
    format!("{day_id}|{}", index / CHUNK_BITS)
}
fn chunks(leaves: u32) -> u32 {
    leaves.div_ceil(CHUNK_BITS)
}
fn bit_of(index: u32) -> (usize, u8) {
    let i = index % CHUNK_BITS;
    (i as usize / 8, 1u8 << (i % 8))
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

/// The leaf of server/map-rewards/payout-tree.mjs `payoutLeaf`.
pub fn payout_leaf(day_id: &str, index: u32, account_id: &AccountId, amount_yocto: u128) -> String {
    hex(&env::sha256(format!("payout|{day_id}|{index}|{account_id}|{amount_yocto}").as_bytes()))
}

pub fn verify_payout_proof(leaf: &str, proof: &[String], root: &str) -> bool {
    let mut node = unhex(leaf);
    for s in proof {
        node = hash_pair(&node, &unhex(s));
    }
    hex(&node) == root
}

#[near_bindgen]
impl Rewards {
    /// Commits one day's per-account payout root and reserves its NEAR:
    /// `coins_yocto` from the coin bucket, `zones_yocto` from the zone bucket.
    /// The leaves must sum to at most their total; claims can never pay more.
    pub fn publish_payout_day(&mut self, day_id: String, root: String, leaves: u32, coins_yocto: U128, zones_yocto: U128) {
        self.publisher();
        assert!(!self.paused, "Publication paused");
        valid_id(&day_id);
        assert!(day_id.len() <= 40 && day_id.starts_with("payout-"), "Payout day id is payout-YYYY-MM-DD-v<n>");
        valid_hash(&root);
        assert!(leaves > 0 && leaves <= PAYOUT_MAX_LEAVES, "Invalid leaf count");
        assert!(payout_days().get(&day_id).is_none(), "Day exists");
        let (coins, zones) = (coins_yocto.0, zones_yocto.0);
        let total = coins.checked_add(zones).expect("Overflow");
        assert!(total >= PAYOUT_MIN_YOCTO, "Empty payout day");
        assert!(coins <= self.coins.available && zones <= self.zones.available, "Insufficient liquid funding");
        self.add_to_date_total(&day_id, coins, zones);
        // The bitmap is the only storage a day adds; claims add none.
        let bytes = env::storage_usage()
            + storage_slots().get(&"__total".to_string()).unwrap_or(0) * CLAIM_STORAGE
            + chunks(leaves) as u64 * CHUNK_STORAGE
            + 8192;
        let required = bytes as u128 * env::storage_byte_cost().as_yoctonear() + (self.funded - self.withdrawn) + NEAR / 2;
        assert!(env::account_balance().as_yoctonear() >= required, "Top up separate storage and gas funding before publication");
        self.coins.available -= coins;
        self.coins.reserved += coins;
        self.zones.available -= zones;
        self.zones.reserved += zones;
        payout_days().insert(
            &day_id,
            &PayoutDay {
                root: root.clone(),
                leaves,
                published_at: now_ms(),
                coins_reserved: coins,
                zones_reserved: zones,
                coins_left: coins,
                zones_left: zones,
                paid: 0,
                paid_leaves: 0,
                closed: false,
            },
        );
        self.check();
        event(
            "payout_day_published",
            near_sdk::serde_json::json!({"day_id":day_id,"root":root,"leaves":leaves,"coins":coins.to_string(),"zones":zones.to_string()}),
        );
    }

    /// Pays up to PAYOUT_MAX_BATCH leaves of one day into the QGOLD vault.
    /// Anyone may call it: every leaf pays only its own account. Returns, per
    /// leaf, whether this call started its payment (false = already claimed).
    pub fn claim_payout(&mut self, day_id: String, claims: Vec<PayoutLeaf>) -> Vec<bool> {
        assert!(!self.paused, "Claims paused");
        assert!(!claims.is_empty() && claims.len() <= PAYOUT_MAX_BATCH, "Batch is 1 to 10 leaves");
        let vault = qgold_vault().expect("QGOLD vault not set");
        let mut days = payout_days();
        let mut day = days.get(&day_id).expect("Unknown payout day");
        assert!(!day.closed, "Day closed");
        let mut bits = payout_bits();
        let mut started = Vec::with_capacity(claims.len());
        for c in claims {
            assert!(c.index < day.leaves, "Invalid leaf index");
            assert!(c.proof.len() <= 32, "Proof too long");
            let amount = c.amount_yocto.0;
            assert!(amount >= PAYOUT_MIN_YOCTO, "Payout below the QGOLD minimum");
            let leaf = payout_leaf(&day_id, c.index, &c.account_id, amount);
            assert!(verify_payout_proof(&leaf, &c.proof, &day.root), "Leaf is not in the day's root");
            let key = chunk_key(&day_id, c.index);
            let mut chunk = bits.get(&key).unwrap_or_else(|| vec![0; (CHUNK_BITS / 8) as usize]);
            let (byte, mask) = bit_of(c.index);
            if chunk[byte] & mask != 0 {
                started.push(false);
                continue;
            }
            assert!(amount <= day.coins_left + day.zones_left, "Payout day budget spent");
            // Coins first, then zones; the callback undoes exactly this split.
            let from_coins = amount.min(day.coins_left);
            let from_zones = amount - from_coins;
            day.coins_left -= from_coins;
            day.zones_left -= from_zones;
            self.coins.reserved -= from_coins;
            self.coins.awarded += from_coins;
            self.zones.reserved -= from_zones;
            self.zones.awarded += from_zones;
            self.pending += amount;
            day.paid += amount;
            day.paid_leaves += 1;
            chunk[byte] |= mask;
            bits.insert(&key, &chunk);
            Promise::new(vault.clone())
                .function_call(
                    "mint_for",
                    near_sdk::serde_json::json!({"account_id": c.account_id, "memo": format!("daily payout {day_id}")})
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(amount),
                    MINT_GAS,
                )
                .then(ext_payout::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payout(
                    day_id.clone(),
                    c.index,
                    c.account_id,
                    U128(from_coins),
                    U128(from_zones),
                ));
            started.push(true);
        }
        days.insert(&day_id, &day);
        self.check();
        started
    }

    #[private]
    pub fn on_payout(&mut self, day_id: String, index: u32, account_id: AccountId, coins: U128, zones: U128) -> bool {
        let amount = coins.0 + zones.0;
        self.pending -= amount;
        let ok = env::promise_result_checked(0, 64).is_ok();
        let mut days = payout_days();
        let mut day = days.get(&day_id).expect("Unknown payout day");
        if ok {
            self.withdrawn += amount;
            event(
                "payout_paid",
                near_sdk::serde_json::json!({"day_id":day_id,"index":index,"account_id":account_id,"amount":amount.to_string()}),
            );
        } else {
            // Undo the claim: the leaf can be claimed again, nothing is lost.
            self.coins.awarded -= coins.0;
            self.zones.awarded -= zones.0;
            day.paid -= amount;
            day.paid_leaves -= 1;
            if day.closed {
                self.coins.available += coins.0;
                self.zones.available += zones.0;
            } else {
                self.coins.reserved += coins.0;
                self.zones.reserved += zones.0;
                day.coins_left += coins.0;
                day.zones_left += zones.0;
                let mut bits = payout_bits();
                let key = chunk_key(&day_id, index);
                if let Some(mut chunk) = bits.get(&key) {
                    let (byte, mask) = bit_of(index);
                    chunk[byte] &= !mask;
                    bits.insert(&key, &chunk);
                }
            }
            days.insert(&day_id, &day);
            event(
                "payout_failed",
                near_sdk::serde_json::json!({"day_id":day_id,"index":index,"account_id":account_id,"amount":amount.to_string()}),
            );
        }
        self.check();
        ok
    }

    /// After the grace period: unclaimed NEAR goes back to the available
    /// buckets and the day's bitmap is deleted (claims are refused from now).
    pub fn close_payout_day(&mut self, day_id: String) {
        self.publisher();
        let mut days = payout_days();
        let mut day = days.get(&day_id).expect("Unknown payout day");
        if day.closed {
            return;
        }
        assert!(now_ms() >= day.published_at + PAYOUT_GRACE_MS, "Payout grace period");
        self.coins.reserved -= day.coins_left;
        self.coins.available += day.coins_left;
        self.zones.reserved -= day.zones_left;
        self.zones.available += day.zones_left;
        let returned = day.coins_left + day.zones_left;
        day.coins_left = 0;
        day.zones_left = 0;
        day.closed = true;
        days.insert(&day_id, &day);
        let mut bits = payout_bits();
        for c in 0..chunks(day.leaves) {
            bits.remove(&format!("{day_id}|{c}"));
        }
        self.check();
        event("payout_day_closed", near_sdk::serde_json::json!({"day_id":day_id,"returned":returned.to_string()}));
    }

    pub fn get_payout_day(&self, day_id: String) -> Option<PayoutDay> {
        payout_days().get(&day_id)
    }

    /// Whether each leaf index is claimed (paid or in flight) on an open day.
    pub fn payout_claimed(&self, day_id: String, indexes: Vec<u32>) -> Vec<bool> {
        assert!(indexes.len() <= 1024, "At most 1024 indexes");
        let bits = payout_bits();
        indexes
            .into_iter()
            .map(|i| {
                let (byte, mask) = bit_of(i);
                bits.get(&chunk_key(&day_id, i)).is_some_and(|c| c[byte] & mask != 0)
            })
            .collect()
    }

    pub fn get_payout_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"leaf":"payout|<day_id>|<index>|<account>|<amount_yocto>","max_batch":PAYOUT_MAX_BATCH,"max_leaves":PAYOUT_MAX_LEAVES,"min_yocto":PAYOUT_MIN_YOCTO.to_string(),"grace_ms":PAYOUT_GRACE_MS})
    }
}

#[cfg(test)]
mod payout_tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

    const Y: u128 = PAYOUT_MIN_YOCTO;

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, time: u64, deposit: u128, result: Option<PromiseResult>) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("rewards.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .block_timestamp(time * 1_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            result.into_iter().collect()
        );
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
    const DAY: &str = "payout-2026-11-05-v1";
    /// Funds 1 NEAR (0.5 coins, 0.5 zones) and publishes three accounts.
    fn setup() -> (Rewards, Vec<PayoutLeaf>) {
        ctx("owner.testnet", 1, 0, None);
        let mut r = Rewards::new(a("owner.testnet"), a("publisher.testnet"), Base64VecU8(vec![7; 32]));
        r.set_qgold_vault(a("qgold.testnet"));
        ctx("sponsor.testnet", 1, NEAR + SPONSOR_STORAGE_FEE, None);
        r.fund_rewards("sponsor".into(), "fund-1".into());
        let accounts = [("alice.testnet", 3 * Y), ("bob.testnet", 5 * Y), ("carol.testnet", 4 * Y)];
        let leaves: Vec<String> = accounts.iter().enumerate().map(|(i, (acc, amt))| payout_leaf(DAY, i as u32, &a(acc), *amt)).collect();
        let (root, proofs) = tree(&leaves);
        ctx("publisher.testnet", 1, 0, None);
        r.publish_payout_day(DAY.into(), root, 3, U128(10 * Y), U128(2 * Y));
        let claims = accounts
            .iter()
            .zip(proofs)
            .enumerate()
            .map(|(i, ((acc, amt), proof))| PayoutLeaf { index: i as u32, account_id: a(acc), amount_yocto: U128(*amt), proof })
            .collect();
        (r, claims)
    }
    fn vault_calls() -> Vec<String> {
        near_sdk::test_utils::get_created_receipts()
            .iter()
            .filter(|x| x.receiver_id.as_str() == "qgold.testnet")
            .map(|x| format!("{:?}", x.actions))
            .collect()
    }

    #[test]
    fn leaf_matches_the_server_format() {
        ctx("x.testnet", 1, 0, None);
        let want = hex(&env::sha256(b"payout|payout-2026-11-05-v1|7|alice.testnet|12345"));
        assert_eq!(payout_leaf(DAY, 7, &a("alice.testnet"), 12345), want);
        // Fixed vector shared with tests/payout-tree.test.mjs.
        assert_eq!(want, "52fab85dc3cbfbaffe1d994f86f635123b13482655c6cb1110e44507905c9235");
    }

    #[test]
    fn a_batch_mints_each_account_its_amount() {
        let (mut r, claims) = setup();
        assert_eq!((r.coins.reserved, r.zones.reserved), (10 * Y, 2 * Y));
        ctx("anyone.testnet", 2, 0, None);
        assert_eq!(r.claim_payout(DAY.into(), claims.clone()), vec![true, true, true]);
        let calls = vault_calls();
        assert_eq!(calls.len(), 3);
        assert!(calls.iter().any(|c| c.contains(&format!("inner: {} }}", 5 * Y))), "{calls:?}");
        assert_eq!(r.pending, 12 * Y);
        let d = r.get_payout_day(DAY.into()).unwrap();
        assert_eq!((d.coins_left, d.zones_left, d.paid_leaves), (0, 0, 3));
        // Retrying the same batch pays nothing twice.
        assert_eq!(r.claim_payout(DAY.into(), claims), vec![false, false, false]);
        assert_eq!(r.pending, 12 * Y);
        assert_eq!(r.payout_claimed(DAY.into(), vec![0, 1, 2, 3]), vec![true, true, true, false]);
    }

    #[test]
    fn a_paid_callback_books_the_withdrawal() {
        let (mut r, claims) = setup();
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), vec![claims[1].clone()]);
        ctx("rewards.testnet", 2, 0, Some(PromiseResult::Successful(b"\"5000\"".to_vec())));
        assert!(r.on_payout(DAY.into(), 1, a("bob.testnet"), U128(5 * Y), U128(0)));
        assert_eq!((r.pending, r.withdrawn), (0, 5 * Y));
        assert_eq!(r.coins.awarded, 5 * Y);
    }

    #[test]
    fn a_refused_mint_reopens_the_leaf() {
        let (mut r, claims) = setup();
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), claims.clone());
        // carol's 4 Y: 2 Y left in coins after alice and bob, then 2 Y zones.
        ctx("rewards.testnet", 2, 0, Some(PromiseResult::Failed));
        assert!(!r.on_payout(DAY.into(), 2, a("carol.testnet"), U128(2 * Y), U128(2 * Y)));
        let d = r.get_payout_day(DAY.into()).unwrap();
        assert_eq!((d.coins_left, d.zones_left, d.paid_leaves), (2 * Y, 2 * Y, 2));
        assert_eq!(r.payout_claimed(DAY.into(), vec![2]), vec![false]);
        ctx("anyone.testnet", 3, 0, None);
        assert_eq!(r.claim_payout(DAY.into(), vec![claims[2].clone()]), vec![true]);
    }

    #[test]
    #[should_panic(expected = "Leaf is not in the day's root")]
    fn a_forged_amount_fails_the_proof() {
        let (mut r, mut claims) = setup();
        claims[0].amount_yocto = U128(9 * Y);
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), vec![claims[0].clone()]);
    }

    #[test]
    #[should_panic(expected = "Leaf is not in the day's root")]
    fn a_proof_cannot_be_redirected_to_another_account() {
        let (mut r, mut claims) = setup();
        claims[0].account_id = a("mallory.testnet");
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), vec![claims[0].clone()]);
    }

    #[test]
    #[should_panic(expected = "Payout day budget spent")]
    fn leaves_cannot_pay_more_than_was_reserved() {
        ctx("owner.testnet", 1, 0, None);
        let mut r = Rewards::new(a("owner.testnet"), a("publisher.testnet"), Base64VecU8(vec![7; 32]));
        r.set_qgold_vault(a("qgold.testnet"));
        ctx("sponsor.testnet", 1, NEAR + SPONSOR_STORAGE_FEE, None);
        r.fund_rewards("sponsor".into(), "fund-1".into());
        let leaves = vec![payout_leaf(DAY, 0, &a("alice.testnet"), 8 * Y), payout_leaf(DAY, 1, &a("bob.testnet"), 8 * Y)];
        let (root, proofs) = tree(&leaves);
        ctx("publisher.testnet", 1, 0, None);
        r.publish_payout_day(DAY.into(), root, 2, U128(10 * Y), U128(0));
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(
            DAY.into(),
            vec![
                PayoutLeaf { index: 0, account_id: a("alice.testnet"), amount_yocto: U128(8 * Y), proof: proofs[0].clone() },
                PayoutLeaf { index: 1, account_id: a("bob.testnet"), amount_yocto: U128(8 * Y), proof: proofs[1].clone() },
            ],
        );
    }

    #[test]
    #[should_panic(expected = "Daily cap across cities")]
    fn the_date_cap_bounds_a_payout_day() {
        ctx("owner.testnet", 1, 0, None);
        let mut r = Rewards::new(a("owner.testnet"), a("publisher.testnet"), Base64VecU8(vec![7; 32]));
        ctx("sponsor.testnet", 1, NEAR + SPONSOR_STORAGE_FEE, None);
        r.fund_rewards("sponsor".into(), "fund-1".into());
        ctx("publisher.testnet", 1, 0, None);
        r.publish_payout_day(DAY.into(), "a".repeat(64), 10, U128(NEAR / 10 + 1), U128(0));
    }

    #[test]
    #[should_panic(expected = "Publisher only")]
    fn only_the_publisher_publishes() {
        let (mut r, _) = setup();
        ctx("anyone.testnet", 2, 0, None);
        r.publish_payout_day("payout-2026-11-06-v1".into(), "a".repeat(64), 1, U128(Y), U128(0));
    }

    #[test]
    fn close_returns_the_unclaimed_rest_after_the_grace() {
        let (mut r, claims) = setup();
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), vec![claims[0].clone()]);
        let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx("publisher.testnet", 3, 0, None);
            r.close_payout_day(DAY.into());
        }));
        assert!(early.is_err(), "grace period");
        let avail = r.coins.available + r.zones.available;
        ctx("publisher.testnet", 1 + PAYOUT_GRACE_MS, 0, None);
        r.close_payout_day(DAY.into());
        assert_eq!(r.coins.available + r.zones.available, avail + 9 * Y);
        assert_eq!(r.coins.reserved + r.zones.reserved, 0);
        assert_eq!(r.payout_claimed(DAY.into(), vec![0]), vec![false]);
        let late = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx("anyone.testnet", 2 + PAYOUT_GRACE_MS, 0, None);
            r.claim_payout(DAY.into(), vec![claims[1].clone()]);
        }));
        assert!(late.is_err(), "closed day");
        // A mint refused after close returns its NEAR to the available buckets.
        ctx("rewards.testnet", 2 + PAYOUT_GRACE_MS, 0, Some(PromiseResult::Failed));
        r.on_payout(DAY.into(), 0, a("alice.testnet"), U128(3 * Y), U128(0));
        assert_eq!(r.coins.available + r.zones.available, avail + 12 * Y);
        assert_eq!(r.pending, 0);
    }

    #[test]
    #[should_panic(expected = "Batch is 1 to 10 leaves")]
    fn batches_are_bounded() {
        let (mut r, claims) = setup();
        ctx("anyone.testnet", 2, 0, None);
        r.claim_payout(DAY.into(), claims.iter().cycle().take(11).cloned().collect());
    }
}
