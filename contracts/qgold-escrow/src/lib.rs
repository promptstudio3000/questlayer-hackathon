//! QGOLD escrow: task rewards, paid Secrets and conditional P2P transfers held in
//! the game's NEP-141 QGOLD token. See docs/QGOLD-ESCROW.md.
//!
//! Funds arrive only through `ft_transfer_call` on the configured token
//! (`ft_on_transfer`). Every payout or refund becomes a per-account credit that
//! its owner pulls with `withdraw()`; a failed `ft_transfer` restores the
//! credit in `on_withdraw`. There is no admin withdrawal of any kind.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

pub const FEE_BPS: u128 = 1000;
pub const BPS: u128 = 10_000;
pub const MAX_ID: usize = 64;
pub const MAX_SLOTS: u32 = 50;
pub const MAX_OPEN_PER_ACCOUNT: u32 = 20;
/// Open plus rejected disputes per task.
pub const MAX_DISPUTES: usize = 100;
pub const MAX_RADIUS_M: u32 = 10_000;
pub const DAY_MS: u64 = 86_400_000;
pub const SECRET_HOLD_MS: u64 = 7 * DAY_MS;
pub const MAX_DURATION_MS: u64 = 365 * DAY_MS;
const STANDARD: &str = "questlayer-escrow";
const VERSION: &str = "1.0.0";
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(15);
const GAS_WITHDRAW_MIN: Gas = Gas::from_tgas(50);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_WITHDRAW_FOR_MIN: Gas = Gas::from_tgas(60);
/// NEP-145 registration on the QGOLD vault (0.00125 NEAR, contracts/qgold STORAGE_FEE).
const STORAGE_DEPOSIT_YOCTO: u128 = 1_250_000_000_000_000_000_000;
// Native storage headroom per open agreement, sized by what that agreement can
// still add: one bounded account id plus credit record (256 bytes) per possible
// worker, dispute or payee, plus 4 KiB for the fixed record, keys and callbacks.
// Sizing per agreement (not by the largest possible task) keeps the service
// open: a flat 42 KiB per agreement let a few 1-unit sends block every new
// task. This is native storage headroom, not a token price or fee.
const ENTRY_BYTES: u64 = 256;
const FIXED_BYTES: u64 = 4096;
/// Sum of the headroom reserved for open agreements. Kept under its own key so
/// the contract state layout is unchanged.
const RESERVED_GROWTH_KEY: &[u8] = b"reserved-growth-bytes";
/// Disputes plus resolved disputes a task can hold: two per slot plus four,
/// capped at MAX_DISPUTES.
pub fn task_dispute_cap(slots: u32) -> usize {
    (2 * slots as usize + 4).min(MAX_DISPUTES)
}
fn task_growth(slots: u32) -> u64 {
    (u64::from(slots) + task_dispute_cap(slots) as u64) * ENTRY_BYTES + FIXED_BYTES
}
/// Secrets and sends credit at most the payee and the payer.
const PAIR_GROWTH: u64 = 2 * ENTRY_BYTES + FIXED_BYTES;
fn reserved_growth() -> u64 {
    env::storage_read(RESERVED_GROWTH_KEY)
        .map(|b| u64::from_le_bytes(b.try_into().expect("Invalid reserved growth")))
        .unwrap_or(0)
}

/// Platform fee, rounded up: ceil(amount * FEE_BPS / BPS).
pub fn fee_of(amount: u128) -> u128 {
    amount
        .checked_mul(FEE_BPS)
        .expect("Amount overflow")
        .div_ceil(BPS)
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Condition {
    BothConfirm,
    After { at_ms: U64 },
    Gps { place_id: String, radius_m: u32 },
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub enum Status {
    Held,
    Disputed,
    Released,
    Refunded,
}
impl Status {
    fn name(self) -> &'static str {
        match self {
            Status::Held => "held",
            Status::Disputed => "disputed",
            Status::Released => "released",
            Status::Refunded => "refunded",
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Task {
    poster: AccountId,
    reward: u128,
    fee: u128,
    slots: u32,
    assignee: Option<AccountId>,
    deadline_ms: u64,
    created_at_ms: u64,
    paid_slots: u32,
    refunded_slots: u32,
    reward_left: u128,
    fee_left: u128,
    paid: Vec<AccountId>,
    disputes: Vec<AccountId>,
    rejected: Vec<AccountId>,
}
impl Task {
    fn open_slots(&self) -> u32 {
        self.slots - self.paid_slots - self.refunded_slots
    }
    fn free_slots(&self) -> u32 {
        self.open_slots() - self.disputes.len() as u32
    }
    fn closed(&self) -> bool {
        self.open_slots() == 0
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Secret {
    buyer: AccountId,
    secret_id: String,
    creator: AccountId,
    price: u128,
    funded_at_ms: u64,
    status: Status,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Transfer {
    sender: AccountId,
    to: AccountId,
    amount: u128,
    condition: Condition,
    expires_ms: u64,
    created_at_ms: u64,
    sender_confirmed: bool,
    receiver_confirmed: bool,
    status: Status,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TaskMsg {
    #[allow(dead_code)]
    kind: String,
    id: String,
    reward: U128,
    #[serde(default)]
    assignee: Option<AccountId>,
    deadline_ms: U64,
    #[serde(default)]
    slots: Option<u32>,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct SecretMsg {
    #[allow(dead_code)]
    kind: String,
    id: String,
    secret_id: String,
    creator: AccountId,
    price: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TransferMsg {
    #[allow(dead_code)]
    kind: String,
    id: String,
    to: AccountId,
    condition: Condition,
    expires_ms: U64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct TaskView {
    pub id: String,
    pub poster: AccountId,
    pub reward: U128,
    pub fee: U128,
    pub slots: u32,
    pub reward_per_slot: U128,
    pub assignee: Option<AccountId>,
    pub deadline_ms: U64,
    pub created_at_ms: U64,
    pub paid_slots: u32,
    pub refunded_slots: u32,
    pub open_slots: u32,
    pub held: U128,
    pub paid_workers: Vec<AccountId>,
    pub open_disputes: Vec<AccountId>,
    pub rejected_disputes: Vec<AccountId>,
    pub status: String,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct SecretView {
    pub id: String,
    pub buyer: AccountId,
    pub secret_id: String,
    pub creator: AccountId,
    pub price: U128,
    pub creator_share: U128,
    pub fee: U128,
    pub funded_at_ms: U64,
    pub auto_release_at_ms: U64,
    pub status: String,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct TransferView {
    pub id: String,
    pub sender: AccountId,
    pub to: AccountId,
    pub amount: U128,
    pub condition: Condition,
    pub expires_ms: U64,
    pub created_at_ms: U64,
    pub sender_confirmed: bool,
    pub receiver_confirmed: bool,
    pub status: String,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct StatsView {
    pub total_held: U128,
    pub escrowed: U128,
    pub credits: U128,
    pub pending_withdrawals: U128,
    pub deposited: U128,
    pub withdrawn: U128,
    pub fees_collected: U128,
    pub task_count: u64,
    pub secret_count: u64,
    pub transfer_count: u64,
    pub open_escrows: u64,
    pub conserved: bool,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub publisher_id: AccountId,
    pub moderator_id: AccountId,
    pub guardian_id: AccountId,
    pub treasury_id: AccountId,
    pub paused: bool,
    pub fee_bps: u32,
    pub max_slots: u32,
    pub max_id_len: u32,
    pub max_open_per_account: u32,
    pub secret_hold_ms: U64,
    pub max_duration_ms: U64,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit_sponsored(&mut self, account_id: AccountId);
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> U128;
}

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct QgoldEscrow {
    owner_id: AccountId,
    token_id: AccountId,
    publisher_id: AccountId,
    moderator_id: AccountId,
    guardian_id: AccountId,
    treasury_id: AccountId,
    paused: bool,
    tasks: LookupMap<String, Task>,
    secrets: LookupMap<String, Secret>,
    transfers: LookupMap<String, Transfer>,
    credits: LookupMap<AccountId, u128>,
    open_by_account: LookupMap<AccountId, u32>,
    /// Tokens this contract accounts for: accepted deposits minus completed withdrawals.
    total_held: u128,
    /// Sum still locked in open tasks, secrets and transfers.
    escrowed: u128,
    /// Sum of all withdrawable credits.
    credits_total: u128,
    /// Sum of withdrawals sent to the token and awaiting their callback.
    pending_total: u128,
    deposited: u128,
    withdrawn: u128,
    fees_collected: u128,
    task_count: u64,
    secret_count: u64,
    transfer_count: u64,
    open_escrows: u64,
}

#[near_bindgen]
impl QgoldEscrow {
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        publisher_id: AccountId,
        moderator_id: AccountId,
        guardian_id: AccountId,
        treasury_id: AccountId,
    ) -> Self {
        let me = env::current_account_id();
        for role in [&owner_id, &token_id, &publisher_id, &moderator_id, &guardian_id, &treasury_id] {
            assert_ne!(*role, me, "Roles must be separate accounts");
        }
        assert_ne!(treasury_id, token_id, "Treasury cannot be the token");
        Self {
            owner_id,
            token_id,
            publisher_id,
            moderator_id,
            guardian_id,
            treasury_id,
            paused: false,
            tasks: LookupMap::new(b"t"),
            secrets: LookupMap::new(b"s"),
            transfers: LookupMap::new(b"x"),
            credits: LookupMap::new(b"c"),
            open_by_account: LookupMap::new(b"o"),
            total_held: 0,
            escrowed: 0,
            credits_total: 0,
            pending_total: 0,
            deposited: 0,
            withdrawn: 0,
            fees_collected: 0,
            task_count: 0,
            secret_count: 0,
            transfer_count: 0,
            open_escrows: 0,
        }
    }

    // ---------------------------------------------------------------- deposits

    /// NEP-141 receiver. Returns the unused amount the token must refund:
    /// 0 when the escrow is created, the full amount while paused. Any invalid
    /// message panics, which makes the token refund the full amount as well.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        assert_eq!(
            env::predecessor_account_id(),
            self.token_id,
            "Only the configured QGOLD token can deposit"
        );
        if self.paused {
            Self::event("deposit_refunded", json!({"sender_id":sender_id,"amount":amount,"reason":"paused"}));
            return amount;
        }
        assert!(amount.0 > 0, "Amount must be positive");
        assert_ne!(sender_id, env::current_account_id(), "Invalid sender");
        let value: Value = serde_json::from_str(&msg).expect("Invalid msg JSON");
        let kind = value
            .get("kind")
            .and_then(Value::as_str)
            .expect("msg.kind is required")
            .to_string();
        match kind.as_str() {
            "task" => self.fund_task(sender_id, amount.0, value),
            "secret" => self.fund_secret(sender_id, amount.0, value),
            "transfer" => self.fund_transfer(sender_id, amount.0, value),
            _ => env::panic_str("Unknown msg.kind"),
        }
        self.total_held = self.total_held.checked_add(amount.0).expect("Overflow");
        self.deposited = self.deposited.checked_add(amount.0).expect("Overflow");
        self.escrowed = self.escrowed.checked_add(amount.0).expect("Overflow");
        self.open_escrows += 1;
        self.check();
        // Reject before accepting tokens when the service cannot fund their
        // complete settlement state. ft_transfer_call then refunds the sender.
        self.require_native_reserve(0);
        U128(0)
    }

    // ------------------------------------------------------------------- tasks

    /// Publisher (after off-chain GPS/photo verification) or the poster pays one slot to `worker`.
    pub fn approve_task(&mut self, id: String, worker: AccountId) -> TaskView {
        self.not_paused();
        let mut task = self.task(&id);
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.publisher_id || caller == task.poster,
            "Only the publisher or the poster can approve"
        );
        assert!(
            !task.disputes.contains(&worker),
            "This worker has an open dispute; the moderator resolves it"
        );
        Self::check_worker(&task, &worker);
        assert!(task.free_slots() > 0, "No open slot left");
        self.pay_slot(&id, &mut task, worker);
        self.save_task(&id, task)
    }

    /// Poster (or the publisher on the poster's request in the game) refunds
    /// every unpaid slot (reward + fee) while no dispute is open. Refunds only
    /// ever go to the poster.
    pub fn cancel_task(&mut self, id: String) -> TaskView {
        self.not_paused();
        let mut task = self.task(&id);
        let caller = env::predecessor_account_id();
        assert!(
            caller == task.poster || caller == self.publisher_id,
            "Only the poster or the publisher can cancel"
        );
        assert!(task.disputes.is_empty(), "A dispute is open");
        assert!(!task.closed(), "Task is closed");
        let n = task.free_slots();
        self.refund_slots(&id, &mut task, n, "cancelled");
        self.save_task(&id, task)
    }

    /// After the deadline anyone refunds the unused, undisputed slots to the poster.
    pub fn expire_task(&mut self, id: String) -> TaskView {
        self.not_paused();
        let mut task = self.task(&id);
        assert!(Self::now() >= task.deadline_ms, "Task deadline not reached");
        let n = task.free_slots();
        assert!(n > 0, "No unreserved slot to refund");
        self.refund_slots(&id, &mut task, n, "expired");
        self.save_task(&id, task)
    }

    /// Worker, poster or publisher (a proof waiting for review in the game)
    /// reserves one slot for `worker`, so cancel/expire cannot take it.
    pub fn open_dispute(&mut self, id: String, worker: AccountId) -> TaskView {
        self.not_paused();
        let mut task = self.task(&id);
        let caller = env::predecessor_account_id();
        assert!(
            caller == worker || caller == task.poster || caller == self.publisher_id,
            "Only the worker, the poster or the publisher can open a dispute"
        );
        if caller == worker && caller != task.poster && caller != self.publisher_id {
            assert!(task.assignee.as_ref() == Some(&worker), "Unassigned participation must be verified by the publisher or poster");
            assert!(Self::now() < task.deadline_ms, "Ask the publisher to verify a proof submitted before the deadline");
        }
        Self::check_worker(&task, &worker);
        assert!(!task.disputes.contains(&worker), "Dispute already open");
        assert!(!task.rejected.contains(&worker), "Dispute already resolved for this worker");
        assert!(task.free_slots() > 0, "No open slot left");
        assert!(
            task.disputes.len() + task.rejected.len() < task_dispute_cap(task.slots),
            "Dispute capacity reached"
        );
        task.disputes.push(worker.clone());
        Self::event(
            "disputed",
            json!({"kind":"task","id":id,"worker":worker,"by":caller}),
        );
        self.save_task(&id, task)
    }

    /// Moderator pays the disputed slot (`pay`) or releases it; a released slot
    /// past the deadline goes straight back to the poster.
    pub fn resolve_dispute(&mut self, id: String, worker: AccountId, pay: bool) -> TaskView {
        self.not_paused();
        assert_eq!(env::predecessor_account_id(), self.moderator_id, "Only the moderator");
        let mut task = self.task(&id);
        let pos = task
            .disputes
            .iter()
            .position(|w| *w == worker)
            .expect("No open dispute for this worker");
        task.disputes.swap_remove(pos);
        Self::event(
            "resolved",
            json!({"kind":"task","id":id,"worker":worker,"pay":pay}),
        );
        if pay {
            self.pay_slot(&id, &mut task, worker);
        } else {
            task.rejected.push(worker);
            if Self::now() >= task.deadline_ms {
                self.refund_slots(&id, &mut task, 1, "dispute_rejected");
            }
        }
        self.save_task(&id, task)
    }

    // ----------------------------------------------------------------- secrets

    /// Publisher attests the buyer's GPS visit: the creator is paid immediately.
    pub fn confirm_visit(&mut self, id: String) -> SecretView {
        self.not_paused();
        assert_eq!(env::predecessor_account_id(), self.publisher_id, "Only the publisher");
        let mut s = self.secret(&id);
        assert!(s.status == Status::Held, "Secret purchase is not held");
        self.release_secret_funds(&id, &mut s, "visit_confirmed");
        self.save_secret(&id, s)
    }

    /// Anyone, once 7 days passed without a dispute.
    pub fn release_secret(&mut self, id: String) -> SecretView {
        self.not_paused();
        let mut s = self.secret(&id);
        assert!(s.status == Status::Held, "Secret purchase is not held");
        assert!(
            Self::now() >= s.funded_at_ms + SECRET_HOLD_MS,
            "Hold period has not ended"
        );
        self.release_secret_funds(&id, &mut s, "hold_elapsed");
        self.save_secret(&id, s)
    }

    /// Buyer (or the publisher for a dispute filed in the game) within 7 days.
    pub fn dispute_secret(&mut self, id: String) -> SecretView {
        self.not_paused();
        let mut s = self.secret(&id);
        let caller = env::predecessor_account_id();
        assert!(caller == s.buyer || caller == self.publisher_id, "Only the buyer or the publisher");
        assert!(s.status == Status::Held, "Secret purchase is not held");
        assert!(
            Self::now() < s.funded_at_ms + SECRET_HOLD_MS,
            "Dispute window has closed"
        );
        s.status = Status::Disputed;
        Self::event("disputed", json!({"kind":"secret","id":id,"by":s.buyer}));
        self.save_secret(&id, s)
    }

    /// Moderator refunds the buyer in full (`refund`) or pays the creator 90/10.
    pub fn resolve_secret(&mut self, id: String, refund: bool) -> SecretView {
        self.not_paused();
        assert_eq!(env::predecessor_account_id(), self.moderator_id, "Only the moderator");
        let mut s = self.secret(&id);
        assert!(s.status == Status::Disputed, "Secret purchase is not disputed");
        Self::event("resolved", json!({"kind":"secret","id":id,"refund":refund}));
        if refund {
            let buyer = s.buyer.clone();
            self.unlock(&[(buyer.clone(), s.price)], 0);
            s.status = Status::Refunded;
            Self::event(
                "refunded",
                json!({"kind":"secret","id":id,"to":buyer,"amount":U128(s.price),"reason":"dispute"}),
            );
        } else {
            self.release_secret_funds(&id, &mut s, "dispute_rejected");
        }
        self.save_secret(&id, s)
    }

    // --------------------------------------------------------------- transfers

    /// both_confirm: sender and receiver each confirm before expiry; the second
    /// confirmation releases. The publisher releases once the game recorded both.
    pub fn confirm_transfer(&mut self, id: String) -> TransferView {
        self.not_paused();
        let mut t = self.transfer(&id);
        assert!(t.condition == Condition::BothConfirm, "Not a both_confirm transfer");
        assert!(t.status == Status::Held, "Transfer is not held");
        assert!(Self::now() < t.expires_ms, "Transfer expired");
        let caller = env::predecessor_account_id();
        if caller == self.publisher_id {
            // The game recorded both confirmations of its signed-in players.
            t.sender_confirmed = true;
            t.receiver_confirmed = true;
        } else if caller == t.sender {
            t.sender_confirmed = true;
        } else if caller == t.to {
            t.receiver_confirmed = true;
        } else {
            env::panic_str("Only the sender or the receiver can confirm");
        }
        if t.sender_confirmed && t.receiver_confirmed {
            self.release_transfer_funds(&id, &mut t, "both_confirmed");
        }
        self.save_transfer(&id, t)
    }

    /// after: anyone releases at or after `at_ms`.
    pub fn release_transfer(&mut self, id: String) -> TransferView {
        self.not_paused();
        let mut t = self.transfer(&id);
        assert!(t.status == Status::Held, "Transfer is not held");
        match t.condition {
            Condition::After { at_ms } => {
                assert!(Self::now() >= at_ms.0, "Release time not reached")
            }
            _ => env::panic_str("Not a time-locked transfer"),
        }
        self.release_transfer_funds(&id, &mut t, "time_reached");
        self.save_transfer(&id, t)
    }

    /// gps: the publisher attests the receiver was at the place, before expiry.
    pub fn confirm_transfer_gps(&mut self, id: String) -> TransferView {
        self.not_paused();
        assert_eq!(env::predecessor_account_id(), self.publisher_id, "Only the publisher");
        let mut t = self.transfer(&id);
        assert!(matches!(t.condition, Condition::Gps { .. }), "Not a GPS transfer");
        assert!(t.status == Status::Held, "Transfer is not held");
        assert!(Self::now() < t.expires_ms, "Transfer expired");
        self.release_transfer_funds(&id, &mut t, "gps_confirmed");
        self.save_transfer(&id, t)
    }

    /// Sender (or the publisher for them) takes the funds back once the transfer expired unreleased.
    pub fn refund_transfer(&mut self, id: String) -> TransferView {
        self.not_paused();
        let mut t = self.transfer(&id);
        let caller = env::predecessor_account_id();
        assert!(caller == t.sender || caller == self.publisher_id, "Only the sender or the publisher");
        assert!(t.status == Status::Held, "Transfer is not held");
        assert!(Self::now() >= t.expires_ms, "Transfer has not expired");
        self.refund_transfer_funds(&id, &mut t, "expired");
        self.save_transfer(&id, t)
    }

    /// Receiver (or the publisher for them) declines at any time: the sender is refunded.
    pub fn decline_transfer(&mut self, id: String) -> TransferView {
        self.not_paused();
        let mut t = self.transfer(&id);
        let caller = env::predecessor_account_id();
        assert!(caller == t.to || caller == self.publisher_id, "Only the receiver or the publisher");
        assert!(t.status == Status::Held, "Transfer is not held");
        self.refund_transfer_funds(&id, &mut t, "declined");
        self.save_transfer(&id, t)
    }

    // ---------------------------------------------------------------- withdraw

    /// Sends the caller's whole credit with `ft_transfer` (1 yocto attached by
    /// this contract). Attach exactly 1 yocto and at least 50 Tgas.
    #[payable]
    pub fn withdraw(&mut self) -> Promise {
        assert_one_yocto();
        self.not_paused();
        assert!(env::prepaid_gas() >= GAS_WITHDRAW_MIN, "Attach at least 50 Tgas");
        let account_id = env::predecessor_account_id();
        let amount = self.start_withdraw(&account_id);
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account_id.clone(), U128(amount), Some("QuestLayer escrow withdrawal".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_WITHDRAW)
                    .on_withdraw(account_id, U128(amount)),
            )
    }

    /// Pushes `account_id`'s whole credit to that account. Anyone may call it
    /// (the game server does after every payout): the tokens can only go to
    /// the credit's owner. The escrow first registers the account on the token
    /// with a nonrefundable lifetime grant. The token refunds the deposit when
    /// already registered or previously sponsored. Attach at least 60 Tgas.
    pub fn withdraw_for(&mut self, account_id: AccountId) -> Promise {
        self.not_paused();
        assert!(env::prepaid_gas() >= GAS_WITHDRAW_FOR_MIN, "Attach at least 60 Tgas");
        self.require_native_reserve(STORAGE_DEPOSIT_YOCTO + 1);
        let amount = self.start_withdraw(&account_id);
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(STORAGE_DEPOSIT_YOCTO))
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit_sponsored(account_id.clone())
            .then(
                ext_ft::ext(self.token_id.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(account_id.clone(), U128(amount), Some("QuestLayer escrow payout".into())),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_WITHDRAW)
                    .on_withdraw(account_id, U128(amount)),
            )
    }

    /// Returns the amount actually withdrawn; on failure the credit is restored.
    /// Runs even while paused so no withdrawal can be left half-done.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> U128 {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "Method on_withdraw is private"
        );
        let failed = matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed));
        self.pending_total -= amount.0;
        if failed {
            let credit = self.credits.get(&account_id).unwrap_or(0);
            self.credits.insert(&account_id, &(credit + amount.0));
            self.credits_total += amount.0;
            Self::event("withdraw_failed", json!({"account_id":account_id,"amount":amount}));
        } else {
            self.total_held -= amount.0;
            self.withdrawn += amount.0;
            Self::event("withdrawn", json!({"account_id":account_id,"amount":amount}));
        }
        self.check();
        if failed {
            U128(0)
        } else {
            amount
        }
    }

    // ------------------------------------------------------------------- admin

    pub fn set_publisher(&mut self, publisher_id: AccountId) {
        self.owner_only();
        self.not_self(&publisher_id);
        Self::event("config_changed", json!({"publisher_id":publisher_id}));
        self.publisher_id = publisher_id;
    }
    pub fn set_moderator(&mut self, moderator_id: AccountId) {
        self.owner_only();
        self.not_self(&moderator_id);
        Self::event("config_changed", json!({"moderator_id":moderator_id}));
        self.moderator_id = moderator_id;
    }
    pub fn set_guardian(&mut self, guardian_id: AccountId) {
        self.owner_only();
        self.not_self(&guardian_id);
        Self::event("config_changed", json!({"guardian_id":guardian_id}));
        self.guardian_id = guardian_id;
    }
    /// Future fees go to the new treasury; credits already earned stay with the old one.
    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        self.owner_only();
        self.not_self(&treasury_id);
        assert_ne!(treasury_id, self.token_id, "Treasury cannot be the token");
        Self::event("config_changed", json!({"treasury_id":treasury_id}));
        self.treasury_id = treasury_id;
    }
    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.guardian_id || caller == self.owner_id,
            "Only the guardian or the owner can pause"
        );
        self.paused = true;
        Self::event("paused", json!({"by":caller}));
    }
    pub fn unpause(&mut self) {
        self.owner_only();
        self.paused = false;
        Self::event("unpaused", json!({"by":self.owner_id}));
    }

    // ------------------------------------------------------------------- views

    pub fn get_task(&self, id: String) -> Option<TaskView> {
        self.tasks.get(&id).map(|t| Self::task_view(id, t))
    }
    pub fn get_secret(&self, id: String) -> Option<SecretView> {
        self.secrets.get(&id).map(|s| Self::secret_view(id, s))
    }
    pub fn get_transfer(&self, id: String) -> Option<TransferView> {
        self.transfers.get(&id).map(|t| Self::transfer_view(id, t))
    }
    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).unwrap_or(0))
    }
    pub fn get_open_count(&self, account_id: AccountId) -> u32 {
        self.open_by_account.get(&account_id).unwrap_or(0)
    }
    /// Native storage headroom for monitoring: new agreements are refused
    /// while `free_yocto` is below what the next one needs, so top up early.
    pub fn get_storage_reserve(&self) -> Value {
        let reserved = reserved_growth();
        let required = (u128::from(env::storage_usage()) + u128::from(reserved)) * env::storage_byte_cost().as_yoctonear();
        let balance = env::account_balance().as_yoctonear();
        json!({"reserved_growth_bytes": reserved, "required_yocto": required.to_string(),
            "balance_yocto": balance.to_string(), "free_yocto": balance.saturating_sub(required).to_string(),
            "pair_growth_bytes": PAIR_GROWTH, "one_slot_task_growth_bytes": task_growth(1)})
    }
    pub fn get_stats(&self) -> StatsView {
        StatsView {
            total_held: U128(self.total_held),
            escrowed: U128(self.escrowed),
            credits: U128(self.credits_total),
            pending_withdrawals: U128(self.pending_total),
            deposited: U128(self.deposited),
            withdrawn: U128(self.withdrawn),
            fees_collected: U128(self.fees_collected),
            task_count: self.task_count,
            secret_count: self.secret_count,
            transfer_count: self.transfer_count,
            open_escrows: self.open_escrows,
            conserved: self.conserved(),
        }
    }
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            token_id: self.token_id.clone(),
            publisher_id: self.publisher_id.clone(),
            moderator_id: self.moderator_id.clone(),
            guardian_id: self.guardian_id.clone(),
            treasury_id: self.treasury_id.clone(),
            paused: self.paused,
            fee_bps: FEE_BPS as u32,
            max_slots: MAX_SLOTS,
            max_id_len: MAX_ID as u32,
            max_open_per_account: MAX_OPEN_PER_ACCOUNT,
            secret_hold_ms: U64(SECRET_HOLD_MS),
            max_duration_ms: U64(MAX_DURATION_MS),
        }
    }
}

impl QgoldEscrow {
    fn now() -> u64 {
        env::block_timestamp_ms()
    }
    fn not_paused(&self) {
        assert!(!self.paused, "Escrow is paused");
    }
    /// Moves the account's whole credit to pending (the token transfer follows).
    fn start_withdraw(&mut self, account_id: &AccountId) -> u128 {
        let amount = self.credits.get(account_id).unwrap_or(0);
        assert!(amount > 0, "No credit to withdraw");
        self.credits.remove(account_id);
        self.credits_total -= amount;
        self.pending_total += amount;
        self.check();
        Self::event("withdraw_started", json!({"account_id":account_id,"amount":U128(amount)}));
        amount
    }
    fn owner_only(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Only the owner");
    }
    fn not_self(&self, account: &AccountId) {
        assert_ne!(*account, env::current_account_id(), "Roles must be separate accounts");
    }
    fn check_id(id: &str, field: &str) {
        assert!(
            !id.is_empty()
                && id.len() <= MAX_ID
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':')),
            "{field} must be 1-64 chars of [A-Za-z0-9-_.:]"
        );
    }
    fn check_party(&self, account: &AccountId) {
        assert!(
            *account != env::current_account_id() && *account != self.token_id,
            "Invalid counterparty"
        );
    }
    fn check_future(deadline_ms: u64, field: &str) {
        let now = Self::now();
        assert!(deadline_ms > now, "{field} must be in the future");
        assert!(deadline_ms - now <= MAX_DURATION_MS, "{field} is more than 365 days away");
    }
    fn check_worker(task: &Task, worker: &AccountId) {
        assert_ne!(*worker, task.poster, "The poster cannot be the worker");
        assert_ne!(*worker, env::current_account_id(), "Invalid worker");
        if let Some(assignee) = &task.assignee {
            assert_eq!(worker, assignee, "Task is assigned to another account");
        }
        assert!(!task.paid.contains(worker), "Worker already paid for this task");
    }
    fn open_inc(&mut self, account: &AccountId, growth: u64) {
        let n = self.open_by_account.get(account).unwrap_or(0);
        assert!(n < MAX_OPEN_PER_ACCOUNT, "Too many open escrows for this account");
        self.open_by_account.insert(account, &(n + 1));
        let total = reserved_growth().checked_add(growth).expect("Reserved growth overflow");
        env::storage_write(RESERVED_GROWTH_KEY, &total.to_le_bytes());
    }
    fn open_dec(&mut self, account: &AccountId, growth: u64) {
        // Agreements opened before this accounting existed reserved nothing.
        let total = reserved_growth().saturating_sub(growth);
        env::storage_write(RESERVED_GROWTH_KEY, &total.to_le_bytes());
        let n = self.open_by_account.get(account).expect("Open count underflow");
        if n <= 1 {
            self.open_by_account.remove(account);
        } else {
            self.open_by_account.insert(account, &(n - 1));
        }
        self.open_escrows -= 1;
    }
    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let c = self.credits.get(account).unwrap_or(0);
        self.credits.insert(account, &c.checked_add(amount).expect("Overflow"));
        self.credits_total += amount;
    }
    /// Moves `parts` (plus `fee` to the treasury) out of escrow into credits.
    fn unlock(&mut self, parts: &[(AccountId, u128)], fee: u128) {
        let mut sum = fee;
        for (account, amount) in parts {
            self.credit(account, *amount);
            sum += amount;
        }
        if fee > 0 {
            let treasury = self.treasury_id.clone();
            self.credit(&treasury, fee);
            self.fees_collected += fee;
        }
        self.escrowed = self.escrowed.checked_sub(sum).expect("Escrow underflow");
    }

    fn fund_task(&mut self, poster: AccountId, amount: u128, value: Value) {
        let m: TaskMsg = serde_json::from_value(value).expect("Invalid task msg");
        Self::check_id(&m.id, "id");
        assert!(self.tasks.get(&m.id).is_none(), "Task id already used");
        let reward = m.reward.0;
        assert!(reward > 0, "Reward must be positive");
        let slots = m.slots.unwrap_or(1);
        assert!((1..=MAX_SLOTS).contains(&slots), "Slots must be 1-50");
        assert!(reward % u128::from(slots) == 0, "Reward must be divisible by slots");
        if let Some(assignee) = &m.assignee {
            assert_eq!(slots, 1, "A named-user task has exactly one slot");
            assert_ne!(*assignee, poster, "The poster cannot be the assignee");
            self.check_party(assignee);
        }
        Self::check_future(m.deadline_ms.0, "deadline_ms");
        let fee = fee_of(reward);
        assert_eq!(
            amount,
            reward.checked_add(fee).expect("Overflow"),
            "Amount must equal reward plus the 10% fee exactly"
        );
        self.open_inc(&poster, task_growth(slots));
        let task = Task {
            poster: poster.clone(),
            reward,
            fee,
            slots,
            assignee: m.assignee.clone(),
            deadline_ms: m.deadline_ms.0,
            created_at_ms: Self::now(),
            paid_slots: 0,
            refunded_slots: 0,
            reward_left: reward,
            fee_left: fee,
            paid: Vec::new(),
            disputes: Vec::new(),
            rejected: Vec::new(),
        };
        self.tasks.insert(&m.id, &task);
        self.task_count += 1;
        Self::event(
            "funded",
            json!({"kind":"task","id":m.id,"poster":poster,"amount":U128(amount),"reward":m.reward,
                "fee":U128(fee),"slots":slots,"assignee":m.assignee,"deadline_ms":m.deadline_ms}),
        );
    }

    fn fund_secret(&mut self, buyer: AccountId, amount: u128, value: Value) {
        let m: SecretMsg = serde_json::from_value(value).expect("Invalid secret msg");
        Self::check_id(&m.id, "id");
        Self::check_id(&m.secret_id, "secret_id");
        assert!(self.secrets.get(&m.id).is_none(), "Secret purchase id already used");
        assert!(m.price.0 > 0, "Price must be positive");
        assert_ne!(m.creator, buyer, "The creator cannot buy their own Secret");
        self.check_party(&m.creator);
        assert_eq!(amount, m.price.0, "Amount must equal the price exactly");
        self.open_inc(&buyer, PAIR_GROWTH);
        self.secrets.insert(
            &m.id,
            &Secret {
                buyer: buyer.clone(),
                secret_id: m.secret_id.clone(),
                creator: m.creator.clone(),
                price: amount,
                funded_at_ms: Self::now(),
                status: Status::Held,
            },
        );
        self.secret_count += 1;
        Self::event(
            "funded",
            json!({"kind":"secret","id":m.id,"buyer":buyer,"secret_id":m.secret_id,"creator":m.creator,"amount":m.price}),
        );
    }

    fn fund_transfer(&mut self, sender: AccountId, amount: u128, value: Value) {
        let m: TransferMsg = serde_json::from_value(value).expect("Invalid transfer msg");
        Self::check_id(&m.id, "id");
        assert!(self.transfers.get(&m.id).is_none(), "Transfer id already used");
        assert_ne!(m.to, sender, "Cannot transfer to yourself");
        self.check_party(&m.to);
        Self::check_future(m.expires_ms.0, "expires_ms");
        match &m.condition {
            Condition::BothConfirm => {}
            Condition::After { at_ms } => {
                assert!(at_ms.0 < m.expires_ms.0, "at_ms must be before expires_ms")
            }
            Condition::Gps { place_id, radius_m } => {
                Self::check_id(place_id, "place_id");
                assert!(
                    (1..=MAX_RADIUS_M).contains(radius_m),
                    "radius_m must be 1-10000"
                );
            }
        }
        self.open_inc(&sender, PAIR_GROWTH);
        self.transfers.insert(
            &m.id,
            &Transfer {
                sender: sender.clone(),
                to: m.to.clone(),
                amount,
                condition: m.condition.clone(),
                expires_ms: m.expires_ms.0,
                created_at_ms: Self::now(),
                sender_confirmed: false,
                receiver_confirmed: false,
                status: Status::Held,
            },
        );
        self.transfer_count += 1;
        Self::event(
            "funded",
            json!({"kind":"transfer","id":m.id,"sender":sender,"to":m.to,"amount":U128(amount),
                "condition":m.condition,"expires_ms":m.expires_ms}),
        );
    }

    /// One slot's share; the last open slot takes whatever rounding left over.
    fn take_slot(task: &mut Task) -> (u128, u128) {
        let open = task.open_slots();
        assert!(open > 0, "No open slot");
        let (r, f) = if open == 1 {
            (task.reward_left, task.fee_left)
        } else {
            let s = u128::from(task.slots);
            (task.reward / s, task.fee / s)
        };
        task.reward_left -= r;
        task.fee_left -= f;
        (r, f)
    }
    fn pay_slot(&mut self, id: &str, task: &mut Task, worker: AccountId) {
        let (r, f) = Self::take_slot(task);
        task.paid_slots += 1;
        task.paid.push(worker.clone());
        let poster = task.poster.clone();
        self.unlock(&[(worker.clone(), r)], f);
        Self::event(
            "paid",
            json!({"kind":"task","id":id,"worker":worker,"amount":U128(r),"fee":U128(f),"treasury":self.treasury_id}),
        );
        if task.closed() {
            self.open_dec(&poster, task_growth(task.slots));
        }
        self.check();
    }
    fn refund_slots(&mut self, id: &str, task: &mut Task, n: u32, reason: &str) {
        if n == 0 {
            return;
        }
        let mut total = 0u128;
        for _ in 0..n {
            let (r, f) = Self::take_slot(task);
            task.refunded_slots += 1;
            total += r + f;
        }
        let poster = task.poster.clone();
        self.unlock(&[(poster.clone(), total)], 0);
        Self::event(
            "refunded",
            json!({"kind":"task","id":id,"to":poster,"slots":n,"amount":U128(total),"reason":reason}),
        );
        if task.closed() {
            self.open_dec(&poster, task_growth(task.slots));
        }
        self.check();
    }
    fn release_secret_funds(&mut self, id: &str, s: &mut Secret, reason: &str) {
        let fee = fee_of(s.price);
        let share = s.price - fee;
        let buyer = s.buyer.clone();
        self.unlock(&[(s.creator.clone(), share)], fee);
        s.status = Status::Released;
        self.open_dec(&buyer, PAIR_GROWTH);
        Self::event(
            "paid",
            json!({"kind":"secret","id":id,"creator":s.creator,"amount":U128(share),"fee":U128(fee),"treasury":self.treasury_id,"reason":reason}),
        );
        self.check();
    }
    fn release_transfer_funds(&mut self, id: &str, t: &mut Transfer, reason: &str) {
        let sender = t.sender.clone();
        self.unlock(&[(t.to.clone(), t.amount)], 0);
        t.status = Status::Released;
        self.open_dec(&sender, PAIR_GROWTH);
        Self::event(
            "paid",
            json!({"kind":"transfer","id":id,"to":t.to,"amount":U128(t.amount),"reason":reason}),
        );
        self.check();
    }
    fn refund_transfer_funds(&mut self, id: &str, t: &mut Transfer, reason: &str) {
        let sender = t.sender.clone();
        self.unlock(&[(sender.clone(), t.amount)], 0);
        t.status = Status::Refunded;
        self.open_dec(&sender, PAIR_GROWTH);
        Self::event(
            "refunded",
            json!({"kind":"transfer","id":id,"to":sender,"amount":U128(t.amount),"reason":reason}),
        );
        self.check();
    }

    fn task(&self, id: &str) -> Task {
        self.tasks.get(&id.to_string()).expect("Task not found")
    }
    fn secret(&self, id: &str) -> Secret {
        self.secrets.get(&id.to_string()).expect("Secret purchase not found")
    }
    fn transfer(&self, id: &str) -> Transfer {
        self.transfers.get(&id.to_string()).expect("Transfer not found")
    }
    fn save_task(&mut self, id: &str, task: Task) -> TaskView {
        self.tasks.insert(&id.to_string(), &task);
        self.check();
        Self::task_view(id.to_string(), task)
    }
    fn save_secret(&mut self, id: &str, s: Secret) -> SecretView {
        self.secrets.insert(&id.to_string(), &s);
        self.check();
        Self::secret_view(id.to_string(), s)
    }
    fn save_transfer(&mut self, id: &str, t: Transfer) -> TransferView {
        self.transfers.insert(&id.to_string(), &t);
        self.check();
        Self::transfer_view(id.to_string(), t)
    }

    fn conserved(&self) -> bool {
        self.escrowed
            .checked_add(self.credits_total)
            .and_then(|v| v.checked_add(self.pending_total))
            == Some(self.total_held)
            && self.deposited.checked_sub(self.withdrawn) == Some(self.total_held)
    }
    /// Liabilities (open escrows + credits + in-flight withdrawals) equal the
    /// accounted token balance (deposits - completed withdrawals).
    fn check(&self) {
        assert!(self.conserved(), "Escrow conservation invariant failed");
    }

    fn require_native_reserve(&self, outgoing: u128) {
        let bytes = u128::from(env::storage_usage()) + u128::from(reserved_growth());
        let required = bytes.checked_mul(env::storage_byte_cost().as_yoctonear())
            .and_then(|cost| cost.checked_add(outgoing)).expect("Native storage reserve overflow");
        assert!(env::account_balance().as_yoctonear() >= required, "Escrow storage reserve is insufficient; existing token rights remain saved");
    }

    fn task_view(id: String, t: Task) -> TaskView {
        let status = if t.paid_slots + t.refunded_slots < t.slots {
            if t.disputes.is_empty() { "open" } else { "disputed" }
        } else if t.refunded_slots == 0 {
            "paid"
        } else if t.paid_slots == 0 {
            "refunded"
        } else {
            "settled"
        };
        TaskView {
            id,
            reward_per_slot: U128(t.reward / u128::from(t.slots)),
            open_slots: t.open_slots(),
            held: U128(t.reward_left + t.fee_left),
            poster: t.poster,
            reward: U128(t.reward),
            fee: U128(t.fee),
            slots: t.slots,
            assignee: t.assignee,
            deadline_ms: U64(t.deadline_ms),
            created_at_ms: U64(t.created_at_ms),
            paid_slots: t.paid_slots,
            refunded_slots: t.refunded_slots,
            paid_workers: t.paid,
            open_disputes: t.disputes,
            rejected_disputes: t.rejected,
            status: status.into(),
        }
    }
    fn secret_view(id: String, s: Secret) -> SecretView {
        let fee = fee_of(s.price);
        SecretView {
            id,
            buyer: s.buyer,
            secret_id: s.secret_id,
            creator: s.creator,
            price: U128(s.price),
            creator_share: U128(s.price - fee),
            fee: U128(fee),
            funded_at_ms: U64(s.funded_at_ms),
            auto_release_at_ms: U64(s.funded_at_ms + SECRET_HOLD_MS),
            status: s.status.name().into(),
        }
    }
    fn transfer_view(id: String, t: Transfer) -> TransferView {
        TransferView {
            id,
            sender: t.sender,
            to: t.to,
            amount: U128(t.amount),
            condition: t.condition,
            expires_ms: U64(t.expires_ms),
            created_at_ms: U64(t.created_at_ms),
            sender_confirmed: t.sender_confirmed,
            receiver_confirmed: t.receiver_confirmed,
            status: t.status.name().into(),
        }
    }
    fn event(name: &str, data: Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":STANDARD,"version":VERSION,"event":name,"data":[data]})
        ));
    }
}

#[cfg(test)]
mod tests;
