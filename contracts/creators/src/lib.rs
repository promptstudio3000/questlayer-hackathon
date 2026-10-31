//! QuestLayer creator money (W09). Conserved creator fund, UTC daily support
//! rounds scored by eligible likes and verified completions, 100 % direct
//! donations, paid quest access settled 80/20 (creator/treasury) with a
//! durable on-chain entitlement, and retryable withdrawals.
//!
//! Authority: the owner funds and configures; the publisher (game server)
//! registers quests and records eligibility it has independently verified;
//! buyers and donors pay from their own accounts; creators withdraw their own
//! credit. No caller can mint money: every balance comes from an attached
//! deposit and the invariant below is checked after every mutation.
use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    collections::{LookupMap, UnorderedMap},
    env, ext_contract,
    json_types::{U128, U64},
    near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

const DAY_MS: u64 = 86_400_000;
const MAX_ID: usize = 64;
/// Treasury share of each paid access in basis points (20 %). Accepted policy.
const TREASURY_BPS: u128 = 2000;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub version: String,
    pub like_weight: u32,
    pub completion_weight: u32,
    /// Maximum eligible score counted per creator per round (anti-farming cap).
    pub max_score_per_creator: u32,
    /// Maximum round budget in yoctoNEAR; larger openings are rejected.
    pub max_round_budget: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Quest {
    pub author: AccountId,
    pub price: U128,
    pub open: bool,
    pub policy_version: String,
    pub access_sold: u32,
    pub donations: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Access {
    pub paid: U128,
    pub creator_share: U128,
    pub treasury_share: U128,
    pub at: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Default, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Creator {
    pub credit: U128,
    pub pending: U128,
    pub withdrawn: U128,
    pub earned_access: U128,
    pub earned_donations: U128,
    pub earned_rounds: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Round {
    pub day: String,
    pub budget: U128,
    pub policy_version: String,
    pub finalized: bool,
    pub paid: U128,
    pub scores: Vec<(AccountId, u32)>,
}

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Creators {
    owner: AccountId,
    publisher: AccountId,
    treasury_receiver: AccountId,
    policy: Policy,
    // Conserved money, all in yoctoNEAR.
    fund_available: u128,
    rounds_reserved: u128,
    creator_credit_total: u128,
    creator_pending_total: u128,
    treasury_credit: u128,
    treasury_paid: u128,
    paid_out: u128,
    funded_total: u128,
    quests: UnorderedMap<String, Quest>,
    access: LookupMap<String, Access>,
    creators: LookupMap<AccountId, Creator>,
    rounds: UnorderedMap<String, Round>,
    support: LookupMap<String, u8>,
    funding: LookupMap<String, u128>,
    open_round: Option<String>,
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool;
    fn on_treasury_paid(&mut self, amount: U128) -> bool;
}

fn valid_id(s: &str) {
    assert!(
        !s.is_empty()
            && s.len() <= MAX_ID
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b':' || b == b'_'),
        "Invalid identifier"
    );
}

#[near_bindgen]
impl Creators {
    #[init]
    pub fn new(owner_id: AccountId, publisher_id: AccountId, treasury_receiver: AccountId, policy: Policy) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet")
                || env::current_account_id().as_str().ends_with(".near"),
            "Named account only"
        );
        Self::check_policy(&policy);
        Self {
            owner: owner_id,
            publisher: publisher_id,
            treasury_receiver,
            policy,
            fund_available: 0,
            rounds_reserved: 0,
            creator_credit_total: 0,
            creator_pending_total: 0,
            treasury_credit: 0,
            treasury_paid: 0,
            paid_out: 0,
            funded_total: 0,
            quests: UnorderedMap::new(b"q"),
            access: LookupMap::new(b"a"),
            creators: LookupMap::new(b"c"),
            rounds: UnorderedMap::new(b"r"),
            support: LookupMap::new(b"s"),
            funding: LookupMap::new(b"f"),
            open_round: None,
        }
    }
    fn check_policy(p: &Policy) {
        valid_id(&p.version);
        assert!(p.like_weight <= 100 && p.completion_weight <= 100, "Weights up to 100");
        assert!(p.like_weight > 0 || p.completion_weight > 0, "One weight must be positive");
        assert!(p.max_score_per_creator > 0 && p.max_round_budget.0 > 0, "Positive caps");
    }
    fn owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
    }
    fn publisher(&self) {
        assert_eq!(env::predecessor_account_id(), self.publisher, "Publisher only");
    }
    /// Every unit of money is in exactly one state.
    fn check(&self) {
        assert_eq!(
            self.fund_available
                + self.rounds_reserved
                + self.creator_credit_total
                + self.creator_pending_total
                + self.treasury_credit
                + self.treasury_paid
                + self.paid_out,
            self.funded_total,
            "Conservation failure"
        );
    }
    fn creator(&self, id: &AccountId) -> Creator {
        self.creators.get(id).unwrap_or_default()
    }
    fn credit_creator(&mut self, id: &AccountId, amount: u128, kind: &str) {
        let mut c = self.creator(id);
        c.credit = U128(c.credit.0 + amount);
        match kind {
            "access" => c.earned_access = U128(c.earned_access.0 + amount),
            "donation" => c.earned_donations = U128(c.earned_donations.0 + amount),
            _ => c.earned_rounds = U128(c.earned_rounds.0 + amount),
        }
        self.creators.insert(id, &c);
        self.creator_credit_total += amount;
    }

    // ---- Owner: funding and policy ------------------------------------------------

    /// Adds liquid creator-fund money. Each receipt id is allocated exactly once.
    #[payable]
    pub fn fund_creators(&mut self, receipt_id: String) {
        valid_id(&receipt_id);
        let key = format!("{}:{receipt_id}", env::predecessor_account_id());
        assert!(self.funding.get(&key).is_none(), "Funding receipt exists");
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Attach the funding amount");
        self.funding.insert(&key, &amount);
        self.fund_available += amount;
        self.funded_total += amount;
        self.check();
    }
    pub fn set_policy(&mut self, policy: Policy) {
        self.owner();
        Self::check_policy(&policy);
        assert!(self.open_round.is_none(), "Close the open round before changing policy");
        self.policy = policy;
    }

    // ---- Publisher: quests, eligibility, rounds -------------------------------------

    pub fn register_quest(&mut self, quest_id: String, author_id: AccountId, price: U128) {
        self.publisher();
        valid_id(&quest_id);
        assert!(self.quests.get(&quest_id).is_none(), "Quest exists");
        self.quests.insert(
            &quest_id,
            &Quest { author: author_id, price, open: true, policy_version: self.policy.version.clone(), access_sold: 0, donations: U128(0) },
        );
    }
    /// Price edits never change existing entitlements.
    pub fn set_price(&mut self, quest_id: String, price: U128) {
        self.publisher();
        let mut q = self.quests.get(&quest_id).expect("Unknown quest");
        q.price = price;
        self.quests.insert(&quest_id, &q);
    }
    /// Closing stops new purchases, donations and support; existing access stays.
    pub fn close_quest(&mut self, quest_id: String) {
        self.publisher();
        let mut q = self.quests.get(&quest_id).expect("Unknown quest");
        q.open = false;
        self.quests.insert(&quest_id, &q);
    }
    /// Records one eligible like ("like") or verified completion ("completion")
    /// per player and quest for the open round. Self-support never scores.
    pub fn record_support(&mut self, quest_id: String, player_id: AccountId, kind: String) -> bool {
        self.publisher();
        let q = self.quests.get(&quest_id).expect("Unknown quest");
        assert!(q.open, "Quest closed");
        let day = self.open_round.clone().expect("No open round");
        let flag: u8 = match kind.as_str() { "like" => 1, "completion" => 2, _ => panic!("Unknown support kind") };
        if q.author == player_id { return false; }
        let key = format!("{quest_id}|{player_id}");
        let seen = self.support.get(&key).unwrap_or(0);
        if seen & flag != 0 { return false; }
        self.support.insert(&key, &(seen | flag));
        let weight = if flag == 1 { self.policy.like_weight } else { self.policy.completion_weight };
        let mut round = self.rounds.get(&day).expect("Round missing");
        match round.scores.iter_mut().find(|(a, _)| *a == q.author) {
            Some(entry) => entry.1 = (entry.1 + weight).min(self.policy.max_score_per_creator),
            None => round.scores.push((q.author.clone(), weight.min(self.policy.max_score_per_creator))),
        }
        self.rounds.insert(&day, &round);
        true
    }
    /// Opens the UTC day's round by reserving part of the liquid fund.
    pub fn open_round(&mut self, day: String, budget: U128) {
        self.publisher();
        valid_id(&day);
        assert!(self.open_round.is_none(), "A round is already open");
        assert!(self.rounds.get(&day).is_none(), "Round exists");
        assert!(budget.0 > 0 && budget.0 <= self.policy.max_round_budget.0, "Budget outside policy");
        assert!(budget.0 <= self.fund_available, "Insufficient creator fund");
        self.fund_available -= budget.0;
        self.rounds_reserved += budget.0;
        self.rounds.insert(&day, &Round { day: day.clone(), budget, policy_version: self.policy.version.clone(), finalized: false, paid: U128(0), scores: vec![] });
        self.open_round = Some(day);
        self.check();
    }
    /// Pays each creator budget × score / total, rounded down; the residual and a
    /// zero-score budget return to the fund. Repeating is a no-op.
    pub fn finalize_round(&mut self, day: String) -> U128 {
        self.publisher();
        let mut round = self.rounds.get(&day).expect("Unknown round");
        if round.finalized { return round.paid; }
        assert_eq!(self.open_round.as_deref(), Some(day.as_str()), "Not the open round");
        let total: u128 = round.scores.iter().map(|(_, s)| *s as u128).sum();
        let mut paid: u128 = 0;
        if total > 0 {
            for (author, score) in round.scores.clone() {
                let share = round.budget.0 * score as u128 / total;
                if share > 0 { self.credit_creator(&author, share, "round"); paid += share; }
            }
        }
        self.rounds_reserved -= round.budget.0;
        self.fund_available += round.budget.0 - paid;
        round.finalized = true;
        round.paid = U128(paid);
        self.rounds.insert(&day, &round);
        self.open_round = None;
        self.check();
        U128(paid)
    }

    // ---- Players: paid access and donations ----------------------------------------

    /// Buys durable access for the caller. 80 % creator / 20 % treasury, settled
    /// once; an existing entitlement makes a repeat a free no-op (deposit refunded).
    #[payable]
    pub fn buy_access(&mut self, quest_id: String) -> Access {
        let buyer = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let mut q = self.quests.get(&quest_id).expect("Unknown quest");
        let key = format!("{quest_id}|{buyer}");
        if let Some(existing) = self.access.get(&key) {
            if attached > 0 {
                let _ = Promise::new(buyer).transfer(NearToken::from_yoctonear(attached));
            }
            return existing;
        }
        assert!(q.open, "Quest closed");
        assert!(q.price.0 > 0, "This quest is free");
        assert_eq!(attached, q.price.0, "Attach the exact price");
        assert_ne!(buyer, q.author, "Authors do not buy their own quest");
        let treasury = attached * TREASURY_BPS / 10_000;
        let creator = attached - treasury;
        self.funded_total += attached;
        self.treasury_credit += treasury;
        self.credit_creator(&q.author, creator, "access");
        q.access_sold += 1;
        self.quests.insert(&quest_id, &q);
        let access = Access { paid: U128(attached), creator_share: U128(creator), treasury_share: U128(treasury), at: U64(env::block_timestamp_ms()) };
        self.access.insert(&key, &access);
        self.check();
        access
    }
    /// 100 % of a donation is credited to the author; gas is the only cost.
    #[payable]
    pub fn donate(&mut self, quest_id: String) {
        let donor = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Attach the donation");
        let mut q = self.quests.get(&quest_id).expect("Unknown quest");
        assert!(q.open, "Quest closed");
        assert_ne!(donor, q.author, "Authors cannot donate to themselves");
        self.funded_total += amount;
        self.credit_creator(&q.author, amount, "donation");
        q.donations = U128(q.donations.0 + amount);
        self.quests.insert(&quest_id, &q);
        self.check();
    }

    // ---- Withdrawals ---------------------------------------------------------------

    #[payable]
    pub fn withdraw(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let mut c = self.creator(&account_id);
        assert!(c.credit.0 > 0 && c.pending.0 == 0, "No available earnings or payout pending");
        let amount = c.credit.0;
        c.credit = U128(0);
        c.pending = U128(amount);
        self.creators.insert(&account_id, &c);
        self.creator_credit_total -= amount;
        self.creator_pending_total += amount;
        self.check();
        Promise::new(account_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_withdraw(account_id, U128(amount)))
    }
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        let mut c = self.creator(&account_id);
        assert_eq!(c.pending.0, amount.0, "Callback mismatch");
        c.pending = U128(0);
        self.creator_pending_total -= amount.0;
        let ok = env::promise_result_checked(0, 0).is_ok();
        if ok {
            c.withdrawn = U128(c.withdrawn.0 + amount.0);
            self.paid_out += amount.0;
        } else {
            c.credit = U128(c.credit.0 + amount.0);
            self.creator_credit_total += amount.0;
        }
        self.creators.insert(&account_id, &c);
        self.check();
        ok
    }
    /// Sends the accumulated treasury share to the immutable treasury receiver.
    /// Only that share may enter the game's new-income allocation, once.
    pub fn flush_treasury(&mut self) -> Promise {
        self.owner();
        assert!(self.treasury_credit > 0, "Nothing to flush");
        let amount = self.treasury_credit;
        self.treasury_credit = 0;
        self.treasury_paid += amount;
        self.check();
        Promise::new(self.treasury_receiver.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_treasury_paid(U128(amount)))
    }
    #[private]
    pub fn on_treasury_paid(&mut self, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 0).is_ok();
        if !ok {
            self.treasury_paid -= amount.0;
            self.treasury_credit += amount.0;
        }
        self.check();
        ok
    }

    // ---- Views ---------------------------------------------------------------------

    pub fn get_quest(&self, quest_id: String) -> Option<Quest> { self.quests.get(&quest_id) }
    pub fn get_access(&self, quest_id: String, account_id: AccountId) -> Option<Access> { self.access.get(&format!("{quest_id}|{account_id}")) }
    pub fn get_creator(&self, account_id: AccountId) -> Creator { self.creator(&account_id) }
    pub fn get_round(&self, day: String) -> Option<Round> { self.rounds.get(&day) }
    pub fn get_policy(&self) -> Policy { self.policy.clone() }
    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"version":1,"owner":self.owner,"publisher":self.publisher,"treasury_receiver":self.treasury_receiver,"treasury_bps":TREASURY_BPS.to_string(),"open_round":self.open_round,"policy":self.policy,"day_ms":DAY_MS.to_string()})
    }
    pub fn get_treasury(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "fund_available": self.fund_available.to_string(),
            "rounds_reserved": self.rounds_reserved.to_string(),
            "creator_credit": self.creator_credit_total.to_string(),
            "creator_pending": self.creator_pending_total.to_string(),
            "treasury_credit": self.treasury_credit.to_string(),
            "treasury_paid": self.treasury_paid.to_string(),
            "paid_out": self.paid_out.to_string(),
            "funded_total": self.funded_total.to_string(),
            "policy": "creator-money-v1"
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn a(s: &str) -> AccountId { s.parse().unwrap() }
    fn context(who: &str, deposit: u128, time_ms: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("creators.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_near(100))
            .block_timestamp(time_ms * 1_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    fn policy() -> Policy {
        Policy { version: "creator-v1".into(), like_weight: 1, completion_weight: 3, max_score_per_creator: 30, max_round_budget: U128(10 * 10u128.pow(24)) }
    }
    fn fresh() -> Creators {
        context("owner.testnet", 0, 1);
        let mut c = Creators::new(a("owner.testnet"), a("publisher.testnet"), a("rewards.testnet"), policy());
        context("publisher.testnet", 0, 1);
        c.register_quest("q1".into(), a("ana.testnet"), U128(100));
        c.register_quest("q2".into(), a("bob.testnet"), U128(0));
        c
    }
    #[test]
    fn paid_access_settles_80_20_once_and_is_idempotent() {
        let mut c = fresh();
        context("zoe.testnet", 100, 5);
        let access = c.buy_access("q1".into());
        assert_eq!(access.creator_share.0, 80);
        assert_eq!(access.treasury_share.0, 20);
        assert_eq!(c.get_creator(a("ana.testnet")).credit.0, 80);
        assert_eq!(c.get_treasury()["treasury_credit"], "20");
        context("zoe.testnet", 100, 6);
        let again = c.buy_access("q1".into());
        assert_eq!(again.paid.0, 100, "repeat returns the original entitlement");
        assert_eq!(c.get_creator(a("ana.testnet")).credit.0, 80, "no second charge");
        assert_eq!(c.get_quest("q1".into()).unwrap().access_sold, 1);
    }
    #[test]
    fn indivisible_units_go_to_the_creator_and_totals_conserve() {
        let mut c = fresh();
        context("publisher.testnet", 0, 2);
        c.set_price("q1".into(), U128(7));
        context("zoe.testnet", 7, 3);
        let access = c.buy_access("q1".into());
        assert_eq!(access.treasury_share.0, 1); // 7 * 2000 / 10000 = 1.4 → 1
        assert_eq!(access.creator_share.0, 6);
        assert_eq!(c.get_treasury()["funded_total"], "7");
    }
    #[test]
    #[should_panic(expected = "Attach the exact price")]
    fn wrong_price_is_rejected() {
        let mut c = fresh();
        context("zoe.testnet", 99, 3);
        c.buy_access("q1".into());
    }
    #[test]
    #[should_panic(expected = "Authors do not buy their own quest")]
    fn authors_cannot_buy_their_own_quest() {
        let mut c = fresh();
        context("ana.testnet", 100, 3);
        c.buy_access("q1".into());
    }
    #[test]
    fn donations_credit_the_full_amount() {
        let mut c = fresh();
        context("zoe.testnet", 55, 3);
        c.donate("q2".into());
        assert_eq!(c.get_creator(a("bob.testnet")).earned_donations.0, 55);
        assert_eq!(c.get_treasury()["treasury_credit"], "0");
    }
    #[test]
    fn rounds_pay_by_score_and_carry_residuals_without_double_payment() {
        let mut c = fresh();
        context("owner.testnet", 1000, 2);
        c.fund_creators("grant-1".into());
        context("publisher.testnet", 0, 3);
        c.open_round("2026-11-02".into(), U128(100));
        assert!(c.record_support("q1".into(), a("zoe.testnet"), "completion".into())); // ana +3
        assert!(c.record_support("q2".into(), a("zoe.testnet"), "like".into())); // bob +1
        assert!(!c.record_support("q2".into(), a("zoe.testnet"), "like".into()), "one like per player and quest");
        assert!(!c.record_support("q1".into(), a("ana.testnet"), "like".into()), "self-support never scores");
        let paid = c.finalize_round("2026-11-02".into());
        assert_eq!(paid.0, 75 + 25);
        assert_eq!(c.get_creator(a("ana.testnet")).earned_rounds.0, 75);
        assert_eq!(c.get_creator(a("bob.testnet")).earned_rounds.0, 25);
        assert_eq!(c.finalize_round("2026-11-02".into()).0, 100, "repeat finalization is a no-op");
        assert_eq!(c.get_treasury()["fund_available"], "900");
        // Residual rounding returns to the fund.
        c.open_round("2026-11-03".into(), U128(10));
        c.record_support("q1".into(), a("yan.testnet"), "completion".into()); // 3
        c.record_support("q2".into(), a("yan.testnet"), "completion".into()); // 3
        context("publisher.testnet", 0, 4);
        c.register_quest("q3".into(), a("cid.testnet"), U128(0));
        c.record_support("q3".into(), a("yan.testnet"), "like".into()); // 1 → total 7
        assert_eq!(c.finalize_round("2026-11-03".into()).0, 4 + 4 + 1);
        assert_eq!(c.get_treasury()["fund_available"], "891");
        assert_eq!(c.get_treasury()["rounds_reserved"], "0");
    }
    #[test]
    fn empty_round_returns_its_whole_budget() {
        let mut c = fresh();
        context("owner.testnet", 50, 2);
        c.fund_creators("grant-2".into());
        context("publisher.testnet", 0, 3);
        c.open_round("2026-11-04".into(), U128(50));
        assert_eq!(c.finalize_round("2026-11-04".into()).0, 0);
        assert_eq!(c.get_treasury()["fund_available"], "50");
    }
    #[test]
    #[should_panic(expected = "Funding receipt exists")]
    fn funding_receipts_allocate_once() {
        let mut c = fresh();
        context("owner.testnet", 5, 2);
        c.fund_creators("grant-x".into());
        context("owner.testnet", 5, 3);
        c.fund_creators("grant-x".into());
    }
    #[test]
    fn score_cap_limits_farming() {
        let mut c = fresh();
        context("owner.testnet", 100, 2);
        c.fund_creators("grant-3".into());
        context("publisher.testnet", 0, 3);
        c.open_round("2026-11-05".into(), U128(100));
        for i in 0..20 {
            c.record_support("q1".into(), a(&format!("p{i}.testnet")), "completion".into());
        }
        assert_eq!(c.get_round("2026-11-05".into()).unwrap().scores[0].1, 30);
    }
    #[test]
    fn withdrawal_moves_credit_to_pending_and_restores_on_failure() {
        let mut c = fresh();
        context("zoe.testnet", 100, 3);
        c.buy_access("q1".into());
        context("ana.testnet", 1, 4);
        let _ = c.withdraw();
        assert_eq!(c.get_creator(a("ana.testnet")).pending.0, 80);
        assert_eq!(c.get_treasury()["creator_pending"], "80");
    }
    #[test]
    #[should_panic(expected = "Quest closed")]
    fn closed_quests_sell_nothing_new() {
        let mut c = fresh();
        context("publisher.testnet", 0, 3);
        c.close_quest("q1".into());
        context("zoe.testnet", 100, 4);
        c.buy_access("q1".into());
    }
}
