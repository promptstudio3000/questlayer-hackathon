use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    collections::{LookupMap, UnorderedSet},
    env, ext_contract,
    json_types::{Base64VecU8, U128, U64},
    near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, Gas, NearToken, PanicOnDefault, Promise,
};
mod map_days;
const NEAR: u128 = 10u128.pow(24);
const DAY_MS: u64 = 86_400_000;
const CLAIM_LIMIT: u16 = 256;
const CLAIM_STORAGE: u64 = 1024;
const SPONSOR_STORAGE_FEE: u128 = 5 * 10u128.pow(21);
/// Plain street coin XP (unchanged since v1).
const COIN_XP: u16 = 2;
/// A street find is a published coin index that pays this XP instead of COIN_XP.
/// Same coin unit, same reservation: a find adds XP, never new money.
const FIND_XP: u16 = 15;
/// Manifest v2 spaces finds about 150 m apart and lists at most 60.
const MAX_FINDS: usize = 60;
#[derive(BorshDeserialize, BorshSerialize, Serialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
struct Bucket {
    available: u128,
    reserved: u128,
    awarded: u128,
}
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct QuestSpec {
    pub reward: U128,
    pub xp: u16,
    pub opens_at: U64,
    pub closes_at: U64,
    pub tier: u8,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Day {
    hash: String,
    starts: u64,
    ends: u64,
    count: u16,
    unit: u128,
    coins: Vec<u8>,
    remaining: u128,
    quests: Vec<QuestSpec>,
    winners: Vec<Option<AccountId>>,
    closed: bool,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Claim {
    pub receipt_id: String,
    pub day_id: String,
    pub kind: String,
    pub index: u16,
    pub receiver_id: AccountId,
    pub received_at: U64,
    pub evidence_hash: String,
}
#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Receipt {
    pub receiver_id: AccountId,
    pub amount: U128,
    pub xp: u16,
    pub message_hash: String,
}
#[derive(BorshDeserialize, BorshSerialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct Player {
    credit: u128,
    pending: u128,
    withdrawn: u128,
    xp: u64,
}
#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Rewards {
    owner: AccountId,
    publisher: AccountId,
    signer: Vec<u8>,
    paused: bool,
    coins: Bucket,
    zones: Bucket,
    funded: u128,
    owed: u128,
    pending: u128,
    withdrawn: u128,
    days: LookupMap<String, Day>,
    receipts: LookupMap<String, Receipt>,
    players: LookupMap<AccountId, Player>,
    personal: UnorderedSet<String>,
    funding: UnorderedSet<String>,
    vaults: UnorderedSet<AccountId>,
}
#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool;
}
#[near_bindgen]
impl Rewards {
    #[init]
    pub fn new(owner_id: AccountId, publisher_id: AccountId, attestor: Base64VecU8) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet only"
        );
        assert_eq!(attestor.0.len(), 32, "Ed25519 key required");
        Self {
            owner: owner_id,
            publisher: publisher_id,
            signer: attestor.0,
            paused: false,
            coins: Bucket::default(),
            zones: Bucket::default(),
            funded: 0,
            owed: 0,
            pending: 0,
            withdrawn: 0,
            days: LookupMap::new(b"d"),
            receipts: LookupMap::new(b"r"),
            players: LookupMap::new(b"p"),
            personal: UnorderedSet::new(b"x"),
            funding: UnorderedSet::new(b"f"),
            vaults: UnorderedSet::new(b"v"),
        }
    }
    #[payable]
    pub fn fund_rewards(&mut self, source: String, receipt_id: String) {
        valid_id(&receipt_id);
        assert!(receipt_id.len() <= 64, "Funding identifier too long");
        assert!(
            source == "sponsor" || source == "realized_yield",
            "Invalid source"
        );
        let sender = env::predecessor_account_id();
        if source == "realized_yield" {
            assert!(self.vaults.contains(&sender), "Approved vault only");
        }
        let key = format!("{sender}:{receipt_id}");
        assert!(!self.funding.contains(&key), "Funding receipt exists");
        let attached = env::attached_deposit().as_yoctonear();
        let storage_fee = if source == "sponsor" {
            SPONSOR_STORAGE_FEE
        } else {
            0
        };
        assert!(
            attached > storage_fee,
            "Funding must include the separate sponsor storage fee"
        );
        let amount = attached - storage_fee;
        let before = env::storage_usage();
        self.funding.insert(&key);
        if source == "sponsor" {
            assert!(
                (env::storage_usage() - before) as u128 * env::storage_byte_cost().as_yoctonear()
                    <= storage_fee,
                "Sponsor storage exceeds paid allowance"
            );
        }

        let coins = amount / 2;
        self.coins.available += coins;
        self.zones.available += amount - coins;
        self.funded += amount;
        // No new funding record may consume already-promised reward or receipt backing.
        let slots = storage_slots().get(&"__total".into()).unwrap_or(0);
        let guarded = (env::storage_usage() + slots * CLAIM_STORAGE + 8192) as u128
            * env::storage_byte_cost().as_yoctonear()
            + (self.funded - self.withdrawn)
            + NEAR / 2;
        assert!(
            env::account_balance().as_yoctonear() >= guarded,
            "Funding needs separate operating storage; reserved rewards are protected"
        );
        self.check();
        event(
            "funded",
            near_sdk::serde_json::json!({"source":source,"sender":sender,"receipt_id":receipt_id,"amount":amount.to_string(),"storage_fee":storage_fee.to_string()}),
        );
    }
    pub fn set_vault(&mut self, account_id: AccountId, approved: bool) {
        self.owner();
        if approved {
            self.vaults.insert(&account_id);
        } else {
            self.vaults.remove(&account_id);
        }
    }
    /// Only the pinned factory can register its successfully initialized children.
    pub fn register_factory_vault(&mut self, account_id: AccountId) {
        // The factory of the same testnet generation: questlayer-rewards-<gen>
        // trusts exactly questlayer-vaults-<gen>. Both ids are published in the
        // manifest; no caller-supplied factory is accepted.
        let own = env::current_account_id();
        let generation = own
            .as_str()
            .strip_prefix("questlayer-rewards-")
            .expect("Pinned reward contract only");
        let factory = format!("questlayer-vaults-{generation}");
        assert_eq!(
            env::predecessor_account_id().as_str(),
            factory,
            "Pinned factory only"
        );
        assert!(
            account_id.as_str().ends_with(&format!(".{factory}")),
            "Factory child required"
        );
        self.vaults.insert(&account_id);
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.owner();
        self.paused = paused;
    }
    pub fn maintain_vault(&self, vault_id: AccountId, action: String) -> Promise {
        self.publisher();
        assert!(self.vaults.contains(&vault_id), "Approved vault only");
        assert!(
            ["refresh", "harvest", "advance", "flush_game"].contains(&action.as_str()),
            "Maintenance action only"
        );
        Promise::new(vault_id).function_call(
            action,
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(220),
        )
    }
    pub fn publish_day(
        &mut self,
        day_id: String,
        starts_at: U64,
        ends_at: U64,
        manifest_hash: String,
        coin_count: u16,
        coin_unit: U128,
        quests: Vec<QuestSpec>,
        finds: Option<Vec<u16>>,
    ) {
        self.publisher();
        assert!(!self.paused, "Publication paused");
        valid_id(&day_id);
        assert!(day_id.len() <= 40, "Day identifier too long");
        valid_hash(&manifest_hash);
        assert!(self.days.get(&day_id).is_none(), "Day exists");
        self.reserve_storage(&day_id);
        let now = now_ms();
        assert!(
            ends_at.0 > now
                && ends_at.0 > starts_at.0
                && ends_at.0 - starts_at.0 <= 25 * 3_600_000
                && starts_at.0 <= now + 2 * DAY_MS,
            "Invalid day window"
        );
        assert!(
            coin_count > 0 && coin_count <= 8192 && coin_unit.0 > 0,
            "Invalid coins"
        );
        assert!(quests.len() == 6, "Six city slots required");
        let finds = normalize_finds(finds.unwrap_or_default(), coin_count);
        let coin_cost = coin_unit
            .0
            .checked_mul(coin_count as u128)
            .expect("Overflow");
        let mut zone_cost = 0u128;
        for q in &quests {
            assert!(
                q.xp <= 500
                    && (1..=3).contains(&q.tier)
                    && q.opens_at.0 >= starts_at.0
                    && q.closes_at.0 <= ends_at.0
                    && q.closes_at.0 > q.opens_at.0,
                "Invalid quest"
            );
            assert!(q.tier != 1 || q.reward.0 == 0, "Free zones award XP only");
            zone_cost = zone_cost.checked_add(q.reward.0).expect("Overflow");
        }
        // The restricted publisher can never publish an unbounded testnet day.
        assert!(
            coin_cost <= NEAR / 10 && zone_cost <= NEAR / 10,
            "Daily testnet cap"
        );
        assert!(
            coin_cost <= self.coins.available && zone_cost <= self.zones.available,
            "Insufficient liquid funding"
        );
        // Every city publishes under `<city>-YYYY-MM-DD-v<n>`. The cap above is per
        // publication; this one is per local date across all cities, so adding a
        // city can never multiply what the treasury commits in one day.
        self.add_to_date_total(&day_id, coin_cost, zone_cost);
        self.coins.available -= coin_cost;
        self.coins.reserved += coin_cost;
        self.zones.available -= zone_cost;
        self.zones.reserved += zone_cost;
        self.days.insert(
            &day_id,
            &Day {
                hash: manifest_hash,
                starts: starts_at.0,
                ends: ends_at.0,
                count: coin_count,
                unit: coin_unit.0,
                coins: vec![0; (coin_count as usize + 7) / 8],
                remaining: coin_cost,
                winners: vec![None; quests.len()],
                quests,
                closed: false,
            },
        );
        if !finds.is_empty() {
            day_finds().insert(&day_id, &finds);
        }
        self.check();
        event(
            "day_published",
            near_sdk::serde_json::json!({"day_id":day_id,"coins":coin_cost.to_string(),"zones":zone_cost.to_string(),"finds":finds.len()}),
        );
    }
    /// The attestor validates consent, fresh location, tier and receipt order off chain.
    /// The signature is not a trustless proof of physical presence.
    pub fn claim(&mut self, claim: Claim, signature: Base64VecU8) -> Receipt {
        valid_id(&claim.receipt_id);
        valid_id(&claim.day_id);
        assert!(
            claim.receipt_id.len() <= 64 && claim.day_id.len() <= 40,
            "Receipt identifier too long"
        );
        valid_hash(&claim.evidence_hash);
        let message = self.claim_message(claim.clone());
        let signature: [u8; 64] = signature.0.try_into().expect("Invalid signature length");
        let key: [u8; 32] = self.signer.clone().try_into().unwrap();
        assert!(
            env::ed25519_verify(&signature, message.as_bytes(), &key),
            "Invalid attestation"
        );
        let message_hash = hex(&env::sha256(message.as_bytes()));
        if let Some(receipt) = self.receipts.get(&claim.receipt_id) {
            assert_eq!(receipt.message_hash, message_hash, "Receipt conflict");
            return receipt;
        }
        assert!(!self.paused, "Claims paused");
        let before_storage = env::storage_usage();
        let mut slots = storage_slots();
        let remaining = slots
            .get(&format!("day:{}", claim.day_id))
            .expect("Day storage not reserved");
        assert!(remaining > 0, "Daily native receipt capacity reached");
        let mut day = self.days.get(&claim.day_id).expect("Unknown day");
        assert!(!day.closed, "Day closed");
        assert!(
            claim.received_at.0 >= day.starts
                && claim.received_at.0 < day.ends
                && claim.received_at.0 <= now_ms(),
            "Invalid receipt time"
        );
        let (amount, xp) = if claim.kind == "coin" {
            assert!(claim.index < day.count, "Invalid coin index");
            let byte = claim.index as usize / 8;
            let mask = 1 << (claim.index % 8);
            assert!(day.coins[byte] & mask == 0, "Coin already claimed");
            day.coins[byte] |= mask;
            day.remaining -= day.unit;
            self.coins.reserved -= day.unit;
            self.coins.awarded += day.unit;
            let find = day_finds()
                .get(&claim.day_id)
                .is_some_and(|f| f.binary_search(&claim.index).is_ok());
            (day.unit, if find { FIND_XP } else { COIN_XP })
        } else {
            assert_eq!(claim.kind, "quest", "Invalid claim kind");
            let i = claim.index as usize;
            let q = day.quests.get(i).expect("Invalid quest index");
            assert!(
                claim.received_at.0 >= q.opens_at.0 && claim.received_at.0 < q.closes_at.0,
                "Quest was closed"
            );
            let personal = format!("{}:{}:{}", claim.day_id, i, claim.receiver_id);
            assert!(
                !self.personal.contains(&personal),
                "Quest already completed"
            );
            self.personal.insert(&personal);
            let amount = if day.winners[i].is_none() {
                day.winners[i] = Some(claim.receiver_id.clone());
                self.zones.reserved -= q.reward.0;
                self.zones.awarded += q.reward.0;
                q.reward.0
            } else {
                0
            };
            (amount, q.xp)
        };
        let mut p = self.players.get(&claim.receiver_id).unwrap_or_default();
        p.credit += amount;
        p.xp += xp as u64;
        self.owed += amount;
        self.players.insert(&claim.receiver_id, &p);
        self.days.insert(&claim.day_id, &day);
        let receipt = Receipt {
            receiver_id: claim.receiver_id.clone(),
            amount: U128(amount),
            xp,
            message_hash,
        };
        self.receipts.insert(&claim.receipt_id, &receipt);
        slots.insert(&format!("day:{}", claim.day_id), &(remaining - 1));
        let count_key = format!("count:{}", claim.day_id);
        let accepted = slots.get(&count_key).unwrap_or(0);
        slots.insert(&count_key, &(accepted + 1));
        let total = slots.get(&"__total".to_string()).unwrap_or(0);
        slots.insert(&"__total".to_string(), &(total - 1));
        assert!(
            env::storage_usage().saturating_sub(before_storage) <= CLAIM_STORAGE,
            "Receipt exceeded sponsored storage bound"
        );
        self.check();
        event(
            "claim",
            near_sdk::serde_json::json!({"receipt_id":claim.receipt_id,"receiver_id":claim.receiver_id,"amount":amount.to_string(),"xp":xp}),
        );
        receipt
    }
    /// The durable worker must drain accepted receipts before finalizing the day.
    pub fn close_day(&mut self, day_id: String) {
        self.publisher();
        let mut day = self.days.get(&day_id).expect("Unknown day");
        if day.closed {
            return;
        }
        assert!(now_ms() >= day.ends + DAY_MS, "Receipt grace period");
        self.coins.reserved -= day.remaining;
        self.coins.available += day.remaining;
        day.remaining = 0;
        for (q, winner) in day.quests.iter().zip(day.winners.iter()) {
            if winner.is_none() {
                self.zones.reserved -= q.reward.0;
                self.zones.available += q.reward.0;
            }
        }
        day.closed = true;
        self.days.insert(&day_id, &day);
        let mut slots = storage_slots();
        if let Some(left) = slots.get(&format!("day:{day_id}")) {
            let total = slots.get(&"__total".into()).unwrap_or(0);
            slots.insert(&"__total".into(), &(total - left));
            slots.insert(&format!("day:{day_id}"), &0);
        }
        self.check();
    }
    /// Records the street finds of a day published before finds were on chain
    /// (a v2 manifest relayed to the v1 contract). Publisher only, once per
    /// day, and only for coins nobody has collected yet, so no earlier receipt
    /// is re-priced. Changes no balances: a find is XP only.
    pub fn record_day_finds(&mut self, day_id: String, finds: Vec<u16>) {
        self.publisher();
        let day = self.days.get(&day_id).expect("Unknown day");
        assert!(!day.closed, "Day closed");
        let mut map = day_finds();
        assert!(map.get(&day_id).is_none(), "Finds already recorded");
        let finds = normalize_finds(finds, day.count);
        assert!(!finds.is_empty(), "No finds");
        for i in &finds {
            assert!(
                day.coins[*i as usize / 8] & (1 << (i % 8)) == 0,
                "Find already collected"
            );
        }
        map.insert(&day_id, &finds);
        event(
            "finds_recorded",
            near_sdk::serde_json::json!({"day_id":day_id,"finds":finds.len()}),
        );
    }
    /// Compatible backfill for the two unclaimed pilot manifests published before
    /// storage budgeting was activated. No economic rights or state layout change.
    pub fn reserve_day_storage(&mut self, day_id: String) {
        self.owner();
        let d = self.days.get(&day_id).expect("Unknown day");
        assert!(
            !d.closed && d.coins.iter().all(|b| *b == 0) && d.winners.iter().all(|w| w.is_none()),
            "Backfill requires an unclaimed day"
        );
        self.reserve_storage(&day_id);
    }
    #[payable]
    pub fn withdraw(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let mut p = self.players.get(&account_id).expect("No rewards");
        assert!(
            p.credit > 0 && p.pending == 0,
            "No available rewards or pending withdrawal"
        );
        let amount = p.credit;
        p.credit = 0;
        p.pending = amount;
        self.owed -= amount;
        self.pending += amount;
        self.players.insert(&account_id, &p);
        self.check();
        // Coin and zone rewards become QGOLD: the NEAR goes into the QGOLD
        // vault, which mints its share at R (no fee) to the player.
        Promise::new(qgold_vault().expect("QGOLD vault not set"))
            .function_call(
                "mint_for",
                near_sdk::serde_json::json!({"account_id": account_id, "memo": "rewards claim"})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(amount),
                Gas::from_tgas(30),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_withdraw(account_id, U128(amount)),
            )
    }
    /// Owner, once: the QGOLD vault that rewards are paid into. It can never be
    /// changed afterwards, so no one can redirect players' rewards.
    pub fn set_qgold_vault(&mut self, account_id: AccountId) {
        self.owner();
        assert!(qgold_vault().is_none(), "QGOLD vault is already set");
        env::storage_write(QGOLD_VAULT_KEY, account_id.as_bytes());
        event("qgold_vault_set", near_sdk::serde_json::json!({"account_id": account_id}));
    }
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        let mut p = self.players.get(&account_id).expect("Unknown player");
        assert_eq!(p.pending, amount.0, "Callback mismatch");
        p.pending = 0;
        self.pending -= amount.0;
        let ok = env::promise_result_checked(0, 0).is_ok();
        if ok {
            p.withdrawn += amount.0;
            self.withdrawn += amount.0;
        } else {
            p.credit += amount.0;
            self.owed += amount.0;
        }
        self.players.insert(&account_id, &p);
        self.check();
        ok
    }
    pub fn claim_message(&self, claim: Claim) -> String {
        format!("QuestLayer native reward v1\nNetwork: testnet\nContract: {}\nReceipt: {}\nDay: {}\nKind: {}\nIndex: {}\nReceiver: {}\nReceived: {}\nEvidence: {}", env::current_account_id(), claim.receipt_id, claim.day_id, claim.kind, claim.index, claim.receiver_id, claim.received_at.0, claim.evidence_hash)
    }
    pub fn get_receipt(&self, receipt_id: String) -> Option<Receipt> {
        self.receipts.get(&receipt_id)
    }
    pub fn get_account(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let p = self.players.get(&account_id).unwrap_or_default();
        near_sdk::serde_json::json!({"credit":p.credit.to_string(),"pending":p.pending.to_string(),"withdrawn":p.withdrawn.to_string(),"xp":p.xp})
    }
    pub fn get_day(&self, day_id: String) -> Option<near_sdk::serde_json::Value> {
        self.days.get(&day_id).map(|d| near_sdk::serde_json::json!({"manifest_hash":d.hash,"starts_at":d.starts.to_string(),"ends_at":d.ends.to_string(),"coin_count":d.count,"coin_unit":d.unit.to_string(),"remaining":d.remaining.to_string(),"quests":d.quests,"winners":d.winners,"closed":d.closed,"claims_accepted":storage_slots().get(&format!("count:{day_id}")).unwrap_or(0),"finds":day_finds().get(&day_id).unwrap_or_default(),"find_xp":FIND_XP,"coin_xp":COIN_XP,"claims_limit":CLAIM_LIMIT,"storage_reserved":storage_slots().get(&format!("day:{day_id}")).is_some()}))
    }
    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"version":2,"network":"testnet","owner":self.owner,"coin_xp":COIN_XP,"find_xp":FIND_XP,"max_finds":MAX_FINDS,"publisher":self.publisher,"attestor":Base64VecU8(self.signer.clone()),"paused":self.paused,"sponsor_storage_fee":SPONSOR_STORAGE_FEE.to_string(),"qgold_vault":qgold_vault()})
    }
    pub fn get_treasury(&self) -> near_sdk::serde_json::Value {
        let bucket = |b: &Bucket| near_sdk::serde_json::json!({"available":b.available.to_string(),"reserved":b.reserved.to_string(),"awarded":b.awarded.to_string()});
        near_sdk::serde_json::json!({"coins":bucket(&self.coins),"zones":bucket(&self.zones),"funded":self.funded.to_string(),"owed":self.owed.to_string(),"pending":self.pending.to_string(),"withdrawn":self.withdrawn.to_string(),"policy":"50/50-v1"})
    }
    /// Records an already-published day (before date totals existed) in its
    /// date's total exactly once. Owner only; it changes no balances.
    pub fn record_existing_day(&mut self, day_id: String) {
        self.owner();
        let d = self.days.get(&day_id).expect("Unknown day");
        let zone_cost: u128 = d.quests.iter().map(|q| q.reward.0).sum();
        let coin_cost = d.unit.checked_mul(d.count as u128).expect("Overflow");
        self.add_to_date_total(&day_id, coin_cost, zone_cost);
    }
    pub fn get_date_totals(&self, date: String) -> near_sdk::serde_json::Value {
        let (coins, zones) = date_totals().get(&date).unwrap_or((0, 0));
        near_sdk::serde_json::json!({"date":date,"coins":coins.to_string(),"zones":zones.to_string(),"cap":(NEAR / 10).to_string()})
    }
    fn add_to_date_total(&self, day_id: &str, coin_cost: u128, zone_cost: u128) {
        let date = day_date(day_id);
        let mut seen = date_seen();
        assert!(seen.get(&day_id.to_string()).is_none(), "Day already counted");
        let mut totals = date_totals();
        let (coins, zones) = totals.get(&date).unwrap_or((0, 0));
        let (coins, zones) = (coins + coin_cost, zones + zone_cost);
        assert!(
            coins <= NEAR / 10 && zones <= NEAR / 10,
            "Daily cap across cities"
        );
        totals.insert(&date, &(coins, zones));
        seen.insert(&day_id.to_string(), &true);
    }
    fn publisher(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.publisher,
            "Publisher only"
        );
    }
    fn owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }
    fn check(&self) {
        assert_eq!(
            self.funded,
            self.coins.available
                + self.coins.reserved
                + self.zones.available
                + self.zones.reserved
                + self.owed
                + self.pending
                + self.withdrawn,
            "Conservation failure"
        );
        assert_eq!(
            self.coins.awarded + self.zones.awarded,
            self.owed + self.pending + self.withdrawn,
            "Award mismatch"
        );
    }
    fn reserve_storage(&self, day: &String) {
        let mut slots = storage_slots();
        if slots.get(&format!("day:{day}")).is_some() {
            return;
        }
        let total = slots.get(&"__total".into()).unwrap_or(0);
        let bytes = env::storage_usage() + (total + CLAIM_LIMIT as u64) * CLAIM_STORAGE + 8192;
        let required = bytes as u128 * env::storage_byte_cost().as_yoctonear()
            + (self.funded - self.withdrawn)
            + NEAR / 2;
        assert!(
            env::account_balance().as_yoctonear() >= required,
            "Top up separate storage and gas funding before publication"
        );
        slots.insert(&format!("day:{day}"), &(CLAIM_LIMIT as u64));
        slots.insert(&"__total".into(), &(total + CLAIM_LIMIT as u64));
    }
}
// New namespaced storage preserves the already deployed V1 state layout.
fn date_totals() -> LookupMap<String, (u128, u128)> {
    LookupMap::new(b"native-date-total-v1".to_vec())
}
fn date_seen() -> LookupMap<String, bool> {
    LookupMap::new(b"native-date-seen-v1".to_vec())
}
/// `<city>-YYYY-MM-DD-v<n>` → `YYYY-MM-DD`; anything else is rejected.
fn day_date(day_id: &str) -> String {
    let parts: Vec<&str> = day_id.split('-').collect();
    let n = parts.len();
    let digits = |p: &str, len: usize| p.len() == len && p.bytes().all(|b| b.is_ascii_digit());
    assert!(
        n >= 5
            && parts[..n - 4].iter().all(|p| !p.is_empty())
            && digits(parts[n - 4], 4)
            && digits(parts[n - 3], 2)
            && digits(parts[n - 2], 2)
            && parts[n - 1].len() >= 2
            && parts[n - 1].starts_with('v')
            && parts[n - 1][1..].bytes().all(|b| b.is_ascii_digit()),
        "Day id must be <city>-YYYY-MM-DD-v<n>"
    );
    format!("{}-{}-{}", parts[n - 4], parts[n - 3], parts[n - 2])
}
/// day id → sorted street-find coin indexes (added in v2, namespaced so the
/// deployed v1 state layout is untouched and no migration call is needed).
fn day_finds() -> LookupMap<String, Vec<u16>> {
    LookupMap::new(b"native-finds-v1".to_vec())
}
fn normalize_finds(mut finds: Vec<u16>, coin_count: u16) -> Vec<u16> {
    assert!(finds.len() <= MAX_FINDS, "Too many street finds");
    finds.sort_unstable();
    assert!(
        finds.windows(2).all(|w| w[0] != w[1]) && finds.last().is_none_or(|i| *i < coin_count),
        "Invalid street finds"
    );
    finds
}
const QGOLD_VAULT_KEY: &[u8] = b"native-qgold-vault-v1";
fn qgold_vault() -> Option<AccountId> {
    env::storage_read(QGOLD_VAULT_KEY).map(|b| String::from_utf8(b).unwrap().parse().unwrap())
}
fn storage_slots() -> LookupMap<String, u64> {
    LookupMap::new(b"native-storage-v1".to_vec())
}
fn now_ms() -> u64 {
    env::block_timestamp_ms()
}
fn valid_id(s: &str) {
    assert!(
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b)),
        "Invalid identifier"
    );
}
fn valid_hash(s: &str) {
    assert!(
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "Invalid hash"
    );
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|x| format!("{x:02x}")).collect()
}
fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({"standard":"questlayer_rewards","version":"1.0.0","event":name,"data":[data]})
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(who: &str, time: u64, deposit: u128, result: Option<PromiseResult>) {
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
    fn setup() -> Rewards {
        context("owner.testnet", 1, 0, None);
        let mut r = Rewards::new(
            a("owner.testnet"),
            a("publisher.testnet"),
            Base64VecU8(
                SigningKey::from_bytes(&[7; 32])
                    .verifying_key()
                    .to_bytes()
                    .to_vec(),
            ),
        );
        r.set_qgold_vault(a("qgold.testnet"));
        context("sponsor.testnet", 1, 1001 + SPONSOR_STORAGE_FEE, None);
        r.fund_rewards("sponsor".into(), "fund-1".into());
        context("publisher.testnet", 1, 0, None);
        r.publish_day(
            "plzen-2026-11-01-v1".into(),
            U64(1),
            U64(1000),
            "a".repeat(64),
            10,
            U128(10),
            (0..6)
                .map(|i| QuestSpec {
                    reward: U128(if i < 3 { 0 } else { 100 }),
                    xp: 50,
                    opens_at: U64(1),
                    closes_at: U64(1000),
                    tier: if i < 3 { 1 } else { 2 },
                })
                .collect(),
            None,
        );
        r
    }
    fn claim(kind: &str, index: u16, receiver: &str, id: &str) -> Claim {
        Claim {
            receipt_id: id.into(),
            day_id: "plzen-2026-11-01-v1".into(),
            kind: kind.into(),
            index,
            receiver_id: a(receiver),
            received_at: U64(2),
            evidence_hash: "b".repeat(64),
        }
    }
    fn signed(r: &Rewards, c: &Claim) -> Base64VecU8 {
        Base64VecU8(
            SigningKey::from_bytes(&[7; 32])
                .sign(r.claim_message(c.clone()).as_bytes())
                .to_bytes()
                .to_vec(),
        )
    }
    #[test]
    fn funding_conserved_and_repeat_claim_recovers_receipt() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let c = claim("coin", 0, "alice.testnet", "receipt-a");
        let s = signed(&r, &c);
        assert_eq!(r.claim(c.clone(), s.clone()).amount.0, 10);
        assert_eq!(r.claim(c, s).amount.0, 10);
        assert_eq!(r.owed, 10);
        r.check();
    }
    #[test]
    #[should_panic(expected = "Coin already claimed")]
    fn shared_coin_second_wallet_rejected() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        for who in ["alice.testnet", "bob.testnet"] {
            let c = claim("coin", 0, who, who.replace('.', "-").as_str());
            let s = signed(&r, &c);
            r.claim(c, s);
        }
    }
    #[test]
    fn personal_xp_and_single_zone_prize() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        for (who, id) in [("alice.testnet", "a"), ("bob.testnet", "b")] {
            let c = claim("quest", 3, who, id);
            let s = signed(&r, &c);
            r.claim(c, s);
        }
        assert_eq!(r.players.get(&a("alice.testnet")).unwrap().credit, 100);
        assert_eq!(r.players.get(&a("bob.testnet")).unwrap().credit, 0);
        assert_eq!(r.players.get(&a("bob.testnet")).unwrap().xp, 50);
        r.check();
    }
    #[test]
    fn rollover_same_bucket_and_late_timely_receipt() {
        let mut r = setup();
        context("relayer.testnet", 1100, 0, None);
        let c = claim("coin", 1, "alice.testnet", "late");
        let s = signed(&r, &c);
        r.claim(c, s);
        context("publisher.testnet", 1000 + DAY_MS, 0, None);
        r.close_day("plzen-2026-11-01-v1".into());
        r.close_day("plzen-2026-11-01-v1".into());
        assert_eq!(r.coins.available, 490);
        assert_eq!(r.zones.available, 501);
        assert_eq!(r.funded, 1001);
        r.check();
    }
    #[test]
    #[should_panic(expected = "Invalid attestation")]
    fn tampered_receiver_rejected() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let mut c = claim("coin", 0, "alice.testnet", "a");
        let s = signed(&r, &c);
        c.receiver_id = a("bob.testnet");
        r.claim(c, s);
    }
    #[test]
    #[should_panic(expected = "Receipt conflict")]
    fn receipt_cannot_change_source() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let mut c = claim("coin", 0, "alice.testnet", "a");
        let s = signed(&r, &c);
        r.claim(c.clone(), s);
        c.index = 1;
        let s = signed(&r, &c);
        r.claim(c, s);
    }
    #[test]
    #[should_panic(expected = "Approved vault only")]
    fn sponsor_cannot_label_principal_yield() {
        let mut r = setup();
        context("sponsor.testnet", 2, 100, None);
        r.fund_rewards("realized_yield".into(), "fake".into());
    }
    #[test]
    #[should_panic(expected = "Funding receipt exists")]
    fn incoming_receipt_replay_reverts() {
        let mut r = setup();
        context("sponsor.testnet", 2, 1001, None);
        r.fund_rewards("sponsor".into(), "fund-1".into());
    }
    #[test]
    #[should_panic(expected = "QGOLD vault is already set")]
    fn qgold_vault_is_set_once() {
        let mut r = setup();
        context("owner.testnet", 2, 0, None);
        r.set_qgold_vault(a("owner.testnet"));
    }
    #[test]
    fn withdraw_pays_the_qgold_vault_not_the_player() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let c = claim("coin", 0, "alice.testnet", "a");
        let s = signed(&r, &c);
        r.claim(c, s);
        context("alice.testnet", 4, 1, None);
        let _ = r.withdraw();
        let receipts = near_sdk::test_utils::get_created_receipts();
        let to_vault = receipts.iter().find(|x| x.receiver_id.as_str() == "qgold.testnet").expect("vault call");
        let s = format!("{:?}", to_vault.actions);
        assert!(s.contains("method_name: [109, 105, 110, 116, 95, 102, 111, 114]") && s.contains("attached_deposit: NearToken { inner: 10 }"), "{s}");
        assert!(!receipts.iter().any(|x| x.receiver_id.as_str() == "alice.testnet"));
        assert_eq!(r.pending, 10);
    }
    #[test]
    fn failed_withdrawal_restores_exact_credit_even_while_paused() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let c = claim("coin", 0, "alice.testnet", "a");
        let s = signed(&r, &c);
        r.claim(c, s);
        r.paused = true;
        context("alice.testnet", 4, 1, None);
        let _ = r.withdraw();
        context("rewards.testnet", 5, 0, Some(PromiseResult::Failed));
        assert!(!r.on_withdraw(a("alice.testnet"), U128(10)));
        assert_eq!(r.owed, 10);
        context("alice.testnet", 6, 1, None);
        let _ = r.withdraw();
        context(
            "rewards.testnet",
            7,
            0,
            Some(PromiseResult::Successful(vec![])),
        );
        assert!(r.on_withdraw(a("alice.testnet"), U128(10)));
        assert_eq!(r.withdrawn, 10);
        r.check();
    }
    #[test]
    fn maximum_pilot_receipt_fits_its_sponsored_storage() {
        let mut r = setup();
        let day = format!("{}-2026-11-01-v12", "a".repeat(25));
        context("publisher.testnet", 1, 0, None);
        r.publish_day(
            day.clone(),
            U64(1),
            U64(1000),
            "c".repeat(64),
            1,
            U128(10),
            (0..6)
                .map(|_| QuestSpec {
                    reward: U128(0),
                    xp: 80,
                    opens_at: U64(1),
                    closes_at: U64(1000),
                    tier: 1,
                })
                .collect(),
            None,
        );
        context("relayer.testnet", 3, 0, None);
        let mut c = claim(
            "quest",
            0,
            &format!("{}.testnet", "a".repeat(56)),
            &"r".repeat(64),
        );
        c.day_id = day.clone();
        let signature = signed(&r, &c);
        r.claim(c, signature);
        assert_eq!(r.get_day(day).unwrap()["claims_accepted"], 1);
        r.check();
    }
    #[test]
    #[should_panic(expected = "Daily native receipt capacity reached")]
    fn exhausted_storage_capacity_cannot_promise_another_receipt() {
        let mut r = setup();
        storage_slots().insert(&"day:plzen-2026-11-01-v1".into(), &0);
        context("relayer.testnet", 3, 0, None);
        let c = claim("coin", 0, "alice.testnet", "a");
        let signature = signed(&r, &c);
        r.claim(c, signature);
    }
    #[test]
    #[should_panic(expected = "Top up separate storage and gas funding")]
    fn reward_principal_is_not_used_as_storage_subsidy() {
        let mut r = setup();
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("rewards.testnet"))
            .predecessor_account_id(a("publisher.testnet"))
            .account_balance(NearToken::from_millinear(100));
        testing_env!(b.build());
        r.publish_day(
            "plzen-2026-11-02-v1".into(),
            U64(1),
            U64(1000),
            "c".repeat(64),
            1,
            U128(10),
            (0..6)
                .map(|_| QuestSpec {
                    reward: U128(0),
                    xp: 80,
                    opens_at: U64(1),
                    closes_at: U64(1000),
                    tier: 1,
                })
                .collect(),
            None,
        );
    }
    #[test]
    #[should_panic(expected = "Funding must include the separate sponsor storage fee")]
    fn tiny_public_sponsors_cannot_spend_promised_receipt_storage() {
        let mut r = setup();
        context("untrusted.testnet", 3, 1, None);
        r.fund_rewards("sponsor".into(), "spam".into());
    }
    #[test]
    fn largest_sponsor_identifier_pays_for_its_own_record_without_diluting_rewards() {
        let mut r = setup();
        let before = r.funded;
        context(
            &format!("{}.testnet", "a".repeat(56)),
            3,
            SPONSOR_STORAGE_FEE + 9,
            None,
        );
        r.fund_rewards("sponsor".into(), "r".repeat(64));
        assert_eq!(r.funded, before + 9);
        r.check();
    }
    #[test]
    #[should_panic(expected = "Funding needs separate operating storage")]
    fn approved_yield_cannot_consume_prepaid_claim_slots_when_operations_are_empty() {
        let mut r = setup();
        context("owner.testnet", 3, 0, None);
        r.set_vault(a("vault.testnet"), true);
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("rewards.testnet"))
            .predecessor_account_id(a("vault.testnet"))
            .attached_deposit(NearToken::from_yoctonear(5))
            .account_balance(NearToken::from_millinear(10));
        testing_env!(b.build());
        r.fund_rewards("realized_yield".into(), "vault-1".into());
    }

    fn publish(r: &mut Rewards, day: &str, unit: u128, reward: u128) {
        context("publisher.testnet", 1, 0, None);
        r.publish_day(
            day.into(),
            U64(1),
            U64(1000),
            "e".repeat(64),
            10,
            U128(unit),
            (0..6)
                .map(|i| QuestSpec {
                    reward: U128(if i < 3 { 0 } else { reward }),
                    xp: 50,
                    opens_at: U64(1),
                    closes_at: U64(1000),
                    tier: if i < 3 { 1 } else { 2 },
                })
                .collect(),
            None,
        );
    }
    fn big_funding() -> Rewards {
        let mut r = setup();
        context("sponsor.testnet", 1, NEAR + SPONSOR_STORAGE_FEE, None);
        r.fund_rewards("sponsor".into(), "fund-big".into());
        r
    }
    #[test]
    fn date_totals_add_up_across_cities_and_report_the_cap() {
        let mut r = big_funding();
        publish(&mut r, "brno-2026-11-01-v1", NEAR / 1000, 0);
        let t = r.get_date_totals("2026-11-01".into());
        // setup() already published plzen-2026-11-01-v1: 10 coins × 10 and 3 × 100.
        assert_eq!(t["coins"], (100 + 10 * (NEAR / 1000)).to_string());
        assert_eq!(t["zones"], "300");
        assert_eq!(t["cap"], (NEAR / 10).to_string());
        assert_eq!(r.get_date_totals("2026-11-02".into())["coins"], "0");
        r.check();
    }
    #[test]
    #[should_panic(expected = "Daily cap across cities")]
    fn a_second_city_cannot_exceed_the_shared_daily_cap() {
        let mut r = big_funding();
        // Each publication alone is within the 0.1 NEAR cap; together they are not.
        publish(&mut r, "brno-2026-11-01-v1", NEAR / 200, 0);
        publish(&mut r, "ostrava-2026-11-01-v1", NEAR / 200, 0);
    }
    #[test]
    fn other_dates_have_their_own_cap() {
        let mut r = big_funding();
        publish(&mut r, "brno-2026-11-02-v1", NEAR / 100, 0);
        publish(&mut r, "brno-2026-11-03-v1", NEAR / 100, 0);
        assert_eq!(r.get_date_totals("2026-11-03".into())["coins"], (NEAR / 10).to_string());
    }
    #[test]
    #[should_panic(expected = "Day id must be <city>-YYYY-MM-DD-v<n>")]
    fn day_ids_must_name_a_city_and_date() {
        let mut r = big_funding();
        publish(&mut r, "day-2", 1, 0);
    }
    #[test]
    fn existing_days_are_backfilled_once_by_the_owner() {
        let mut r = setup();
        // Simulate a day published before totals existed.
        date_totals().remove(&"2026-11-01".to_string());
        date_seen().remove(&"plzen-2026-11-01-v1".to_string());
        context("owner.testnet", 2, 0, None);
        r.record_existing_day("plzen-2026-11-01-v1".into());
        assert_eq!(r.get_date_totals("2026-11-01".into())["coins"], "100");
        assert_eq!(r.get_date_totals("2026-11-01".into())["zones"], "300");
    }
    #[test]
    #[should_panic(expected = "Day already counted")]
    fn a_day_is_never_counted_twice() {
        let mut r = setup();
        context("owner.testnet", 2, 0, None);
        r.record_existing_day("plzen-2026-11-01-v1".into());
    }
    #[test]
    #[should_panic(expected = "Owner only")]
    fn only_the_owner_backfills() {
        let mut r = setup();
        context("publisher.testnet", 2, 0, None);
        r.record_existing_day("plzen-2026-11-01-v1".into());
    }

    fn publish_with_finds(r: &mut Rewards, day: &str, finds: Option<Vec<u16>>) {
        context("publisher.testnet", 1, 0, None);
        r.publish_day(
            day.into(),
            U64(1),
            U64(1000),
            "f".repeat(64),
            10,
            U128(1),
            (0..6)
                .map(|_| QuestSpec {
                    reward: U128(0),
                    xp: 40,
                    opens_at: U64(1),
                    closes_at: U64(1000),
                    tier: 1,
                })
                .collect(),
            finds,
        );
    }
    fn collect(r: &mut Rewards, day: &str, index: u16, id: &str) -> Receipt {
        context("relayer.testnet", 3, 0, None);
        let mut c = claim("coin", index, "alice.testnet", id);
        c.day_id = day.into();
        let s = signed(r, &c);
        r.claim(c, s)
    }
    #[test]
    fn street_find_pays_bonus_xp_but_the_same_coin_unit() {
        let mut r = setup();
        let day = "plzen-2026-11-03-v2";
        publish_with_finds(&mut r, day, Some(vec![7, 2]));
        let find = collect(&mut r, day, 2, "find-2");
        let plain = collect(&mut r, day, 3, "coin-3");
        assert_eq!((find.amount.0, find.xp), (1, FIND_XP));
        assert_eq!((plain.amount.0, plain.xp), (1, COIN_XP));
        assert_eq!(r.players.get(&a("alice.testnet")).unwrap().xp, 17);
        assert_eq!(r.get_day(day.into()).unwrap()["finds"], near_sdk::serde_json::json!([2, 7]));
        r.check();
    }
    #[test]
    fn days_without_finds_keep_v1_coin_xp() {
        let mut r = setup();
        context("relayer.testnet", 3, 0, None);
        let c = claim("coin", 0, "alice.testnet", "a");
        let s = signed(&r, &c);
        assert_eq!(r.claim(c, s).xp, COIN_XP);
        assert_eq!(r.get_day("plzen-2026-11-01-v1".into()).unwrap()["finds"], near_sdk::serde_json::json!([]));
    }
    #[test]
    #[should_panic(expected = "Invalid street finds")]
    fn finds_must_be_published_coins() {
        let mut r = setup();
        publish_with_finds(&mut r, "plzen-2026-11-03-v2", Some(vec![10]));
    }
    #[test]
    #[should_panic(expected = "Invalid street finds")]
    fn duplicate_finds_rejected() {
        let mut r = setup();
        publish_with_finds(&mut r, "plzen-2026-11-03-v2", Some(vec![1, 1]));
    }
    #[test]
    #[should_panic(expected = "Too many street finds")]
    fn find_count_is_bounded() {
        let mut r = setup();
        publish_with_finds(&mut r, "plzen-2026-11-03-v2", Some((0..61).collect()));
    }
    #[test]
    fn finds_backfill_only_for_uncollected_coins_and_only_once() {
        let mut r = setup();
        let day = "plzen-2026-11-03-v2";
        publish_with_finds(&mut r, day, None);
        assert_eq!(collect(&mut r, day, 1, "early").xp, COIN_XP);
        context("publisher.testnet", 4, 0, None);
        r.record_day_finds(day.into(), vec![4]);
        assert_eq!(collect(&mut r, day, 4, "late").xp, FIND_XP);
        // A repeat of the earlier receipt is still the same receipt.
        assert_eq!(collect(&mut r, day, 1, "early").xp, COIN_XP);
    }
    #[test]
    #[should_panic(expected = "Find already collected")]
    fn backfill_cannot_reprice_a_collected_coin() {
        let mut r = setup();
        let day = "plzen-2026-11-03-v2";
        publish_with_finds(&mut r, day, None);
        collect(&mut r, day, 1, "early");
        context("publisher.testnet", 4, 0, None);
        r.record_day_finds(day.into(), vec![1]);
    }
    #[test]
    #[should_panic(expected = "Finds already recorded")]
    fn published_finds_cannot_be_rewritten() {
        let mut r = setup();
        let day = "plzen-2026-11-03-v2";
        publish_with_finds(&mut r, day, Some(vec![1]));
        context("publisher.testnet", 4, 0, None);
        r.record_day_finds(day.into(), vec![2]);
    }
    #[test]
    #[should_panic(expected = "Publisher only")]
    fn only_the_publisher_records_finds() {
        let mut r = setup();
        context("owner.testnet", 4, 0, None);
        r.record_day_finds("plzen-2026-11-01-v1".into(), vec![2]);
    }
    /// Frozen copy of the deployed v1 contract state. The upgrade is a plain
    /// code deploy (no migrate call), so the live layout must read unchanged.
    #[derive(BorshSerialize)]
    #[borsh(crate = "near_sdk::borsh")]
    struct RewardsV1 {
        owner: AccountId,
        publisher: AccountId,
        signer: Vec<u8>,
        paused: bool,
        coins: Bucket,
        zones: Bucket,
        funded: u128,
        owed: u128,
        pending: u128,
        withdrawn: u128,
        days: LookupMap<String, Day>,
        receipts: LookupMap<String, Receipt>,
        players: LookupMap<AccountId, Player>,
        personal: UnorderedSet<String>,
        funding: UnorderedSet<String>,
        vaults: UnorderedSet<AccountId>,
    }
    #[test]
    fn v1_state_reads_without_migration() {
        let r = setup();
        let v1 = RewardsV1 {
            owner: r.owner.clone(),
            publisher: r.publisher.clone(),
            signer: r.signer.clone(),
            paused: r.paused,
            coins: Bucket { available: r.coins.available, reserved: r.coins.reserved, awarded: 0 },
            zones: Bucket { available: r.zones.available, reserved: r.zones.reserved, awarded: 0 },
            funded: r.funded,
            owed: 0,
            pending: 0,
            withdrawn: 0,
            days: LookupMap::new(b"d"),
            receipts: LookupMap::new(b"r"),
            players: LookupMap::new(b"p"),
            personal: UnorderedSet::new(b"x"),
            funding: UnorderedSet::new(b"f"),
            vaults: UnorderedSet::new(b"v"),
        };
        let bytes = near_sdk::borsh::to_vec(&v1).unwrap();
        let read = Rewards::try_from_slice(&bytes).expect("v1 layout");
        assert_eq!(near_sdk::borsh::to_vec(&read).unwrap(), bytes);
        // The day published under v1 is still claimable and pays v1 XP.
        read.check();
    }
}
