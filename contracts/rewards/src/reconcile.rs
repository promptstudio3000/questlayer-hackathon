//! Recovery for a QGOLD mint whose callback never ran (docs/DAILY-PAYOUTS.md, "Callback recovery").
//!
//! Every payout leaf and every withdrawal records one attempt when its mint is
//! issued: a contract-wide nonce, the issue time and exactly what the callback
//! will book. The callback must present that nonce and removes the record, so a
//! callback can settle an attempt once and a stale callback changes nothing.
//!
//! If the callback receipt itself fails (for example out of gas), its state
//! changes are reverted and the attempt stays pending: the leaf bit stays set
//! and `close_payout_day` waits, or `withdraw` stays blocked for the player.
//! After `RECONCILE_AFTER_MS` the attempt can be settled from recorded state:
//!
//! - World payout leaves (`mint_with_carry_for`) are settled by anyone with
//!   `reconcile_payout`. QGOLD keeps a unique conversion receipt per memo for
//!   `RECEIPT_RETENTION_MS` (30 days). A receipt that matches the leaf's account
//!   and amount books the leaf paid; no receipt books it failed and reopens it.
//!   The mint receipt executed long before the timeout, so absence inside the
//!   evidence window is proof of failure, and QGOLD refuses a second conversion
//!   with the same memo in any case.
//! - Daily payout leaves and withdrawals use `mint_for`, which stores no receipt.
//!   Only the owner may settle them, with `owner_reconcile_payout` and
//!   `owner_reconcile_withdrawal`, stating the outcome of the finalized mint
//!   receipt. The contract checks timing, nonce and state; it cannot check the
//!   owner's statement, so a false "not minted" could pay that one amount again.
//!
//! Attempts issued by code older than this module have no record. Their
//! callbacks still settle them (they carry no nonce), but they cannot be
//! reconciled here: drain them before an upgrade.
use crate::*;

/// Age of an unsettled attempt before it may be reconciled. Mint and callback
/// receipts execute within a few blocks; a day leaves no plausible receipt in flight.
pub const RECONCILE_AFTER_MS: u64 = DAY_MS;
/// QGOLD `RECEIPT_RETENTION_MS` is 30 days. A missing receipt is evidence of a
/// failed mint only well inside that window (the receipt cannot be pruned yet).
pub const RECEIPT_EVIDENCE_MS: u64 = 29 * DAY_MS;
const RECONCILE_VIEW_GAS: Gas = Gas::from_tgas(10);
const RECONCILE_CALLBACK_GAS: Gas = Gas::from_tgas(15);
const NONCE_KEY: &[u8] = b"native-callback-nonce";

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct PayoutAttempt {
    pub nonce: u64,
    pub at_ms: u64,
    pub account_id: AccountId,
    pub coins: u128,
    pub zones: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct WithdrawAttempt {
    pub nonce: u64,
    pub at_ms: u64,
    pub amount: u128,
}

fn payout_attempts() -> LookupMap<String, PayoutAttempt> {
    LookupMap::new(b"native-payout-attempts".to_vec())
}
fn withdraw_attempts() -> LookupMap<AccountId, WithdrawAttempt> {
    LookupMap::new(b"native-withdraw-attempts".to_vec())
}
fn attempt_key(day_id: &str, index: u32) -> String {
    format!("{day_id}|{index}")
}
fn next_nonce() -> u64 {
    let n = env::storage_read(NONCE_KEY).map(|b| u64::from_le_bytes(b.try_into().expect("Nonce"))).unwrap_or(0) + 1;
    env::storage_write(NONCE_KEY, &n.to_le_bytes());
    n
}
pub(crate) fn world_memo(day_id: &str, index: u32) -> String {
    format!("world payout {day_id}:{index}")
}

pub(crate) fn record_payout_attempt(day_id: &str, index: u32, account_id: &AccountId, coins: u128, zones: u128) -> u64 {
    let nonce = next_nonce();
    payout_attempts().insert(
        &attempt_key(day_id, index),
        &PayoutAttempt { nonce, at_ms: now_ms(), account_id: account_id.clone(), coins, zones },
    );
    nonce
}

/// Consumes the attempt a callback settles. A callback without a nonce comes
/// from an attempt issued before records existed and is accepted only if no
/// record exists; every other mismatch is a stale or duplicate callback.
pub(crate) fn take_payout_attempt(day_id: &str, index: u32, nonce: Option<u64>) {
    let key = attempt_key(day_id, index);
    let mut attempts = payout_attempts();
    match (attempts.get(&key), nonce) {
        (Some(a), Some(n)) if a.nonce == n => {
            attempts.remove(&key);
        }
        (None, None) => {}
        _ => env::panic_str("Payout callback is not pending"),
    }
}

pub(crate) fn record_withdraw_attempt(account_id: &AccountId, amount: u128) -> u64 {
    let nonce = next_nonce();
    withdraw_attempts().insert(account_id, &WithdrawAttempt { nonce, at_ms: now_ms(), amount });
    nonce
}

pub(crate) fn take_withdraw_attempt(account_id: &AccountId, nonce: Option<u64>) {
    let mut attempts = withdraw_attempts();
    match (attempts.get(account_id), nonce) {
        (Some(a), Some(n)) if a.nonce == n => {
            attempts.remove(account_id);
        }
        (None, None) => {}
        _ => env::panic_str("Withdrawal callback is not pending"),
    }
}

#[allow(dead_code)]
#[ext_contract(ext_qgold_receipts)]
trait QgoldReceipts {
    fn get_game_conversion(&self, minter_id: AccountId, memo: String) -> Option<near_sdk::serde_json::Value>;
}
#[allow(dead_code)]
#[ext_contract(ext_reconcile)]
trait ReconcileCallbacks {
    fn on_payout_reconciled(&mut self, day_id: String, index: u32, nonce: U64) -> bool;
}

impl Rewards {
    /// The attempt of a leaf whose callback is overdue: open day, claimed and
    /// not paid, recorded, and older than `RECONCILE_AFTER_MS`.
    fn stuck_payout(&self, day_id: &str, index: u32) -> PayoutAttempt {
        let day = payouts::payout_days().get(&day_id.to_string()).expect("Unknown payout day");
        assert!(!day.closed && index < day.leaves, "Payout callback is not pending");
        assert!(payouts::leaf_pending(day_id, index), "Payout callback is not pending");
        let a = payout_attempts().get(&attempt_key(day_id, index)).expect("No recorded attempt to reconcile");
        assert!(now_ms() >= a.at_ms + RECONCILE_AFTER_MS, "Payout may still be in flight");
        a
    }
}

#[near_bindgen]
impl Rewards {
    /// The recorded, still unsettled attempt of one payout leaf, if any.
    pub fn get_payout_attempt(&self, day_id: String, index: u32) -> Option<near_sdk::serde_json::Value> {
        payout_attempts().get(&attempt_key(&day_id, index)).map(|a| {
            near_sdk::serde_json::json!({"nonce":U64(a.nonce),"issued_at_ms":U64(a.at_ms),"account_id":a.account_id,
                "coins":a.coins.to_string(),"zones":a.zones.to_string(),"reconcile_after_ms":U64(a.at_ms + RECONCILE_AFTER_MS),
                "receipt_evidence":world_days::is_world_payout(&day_id)})
        })
    }

    /// The recorded, still unsettled withdrawal of one account, if any.
    pub fn get_withdrawal_attempt(&self, account_id: AccountId) -> Option<near_sdk::serde_json::Value> {
        withdraw_attempts().get(&account_id).map(|a| {
            near_sdk::serde_json::json!({"nonce":U64(a.nonce),"issued_at_ms":U64(a.at_ms),"amount":a.amount.to_string(),
                "reconcile_after_ms":U64(a.at_ms + RECONCILE_AFTER_MS)})
        })
    }

    /// Anyone: settles an overdue world payout leaf from QGOLD's conversion
    /// receipt for its unique memo. Nothing is paid here.
    pub fn reconcile_payout(&mut self, day_id: String, index: u32) -> Promise {
        let a = self.stuck_payout(&day_id, index);
        assert!(world_days::is_world_payout(&day_id), "Daily payouts keep no QGOLD receipt: owner_reconcile_payout");
        assert!(now_ms() < a.at_ms + RECEIPT_EVIDENCE_MS, "QGOLD receipt window passed: owner_reconcile_payout");
        ext_qgold_receipts::ext(qgold_vault().expect("QGOLD vault not set"))
            .with_static_gas(RECONCILE_VIEW_GAS)
            .get_game_conversion(env::current_account_id(), world_memo(&day_id, index))
            .then(
                ext_reconcile::ext(env::current_account_id())
                    .with_static_gas(RECONCILE_CALLBACK_GAS)
                    .on_payout_reconciled(day_id, index, U64(a.nonce)),
            )
    }

    #[private]
    pub fn on_payout_reconciled(&mut self, day_id: String, index: u32, nonce: U64) -> bool {
        let a = payout_attempts().get(&attempt_key(&day_id, index)).expect("Payout callback is not pending");
        assert_eq!(a.nonce, nonce.0, "Payout callback is not pending");
        let amount = a.coins + a.zones;
        // A failed view proves nothing: panic, so the attempt stays pending.
        let bytes = env::promise_result_checked(0, 4096).unwrap_or_else(|_| env::panic_str("QGOLD receipt unavailable"));
        let receipt: Option<near_sdk::serde_json::Value> = near_sdk::serde_json::from_slice(&bytes).expect("QGOLD receipt");
        let minted = match receipt {
            Some(r) => {
                assert!(
                    r["account_id"].as_str() == Some(a.account_id.as_str())
                        && r["depositedYocto"].as_str() == Some(amount.to_string().as_str()),
                    "QGOLD receipt does not match the leaf"
                );
                true
            }
            None => false,
        };
        // Evidence is complete: consume the attempt only now.
        take_payout_attempt(&day_id, index, Some(nonce.0));
        event("payout_reconciled", near_sdk::serde_json::json!({"day_id":day_id,"index":index,"minted":minted,"evidence":"qgold_conversion_receipt"}));
        self.settle_payout(&day_id, index, &a.account_id, a.coins, a.zones, minted)
    }

    /// Owner: settles an overdue `mint_for` payout leaf (or a world leaf past
    /// the receipt window) from the finalized mint receipt the owner inspected.
    pub fn owner_reconcile_payout(&mut self, day_id: String, index: u32, minted: bool) -> bool {
        self.owner();
        let a = self.stuck_payout(&day_id, index);
        assert!(
            !world_days::is_world_payout(&day_id) || now_ms() >= a.at_ms + RECEIPT_EVIDENCE_MS,
            "QGOLD receipt decides: reconcile_payout"
        );
        take_payout_attempt(&day_id, index, Some(a.nonce));
        event("payout_reconciled", near_sdk::serde_json::json!({"day_id":day_id,"index":index,"minted":minted,"evidence":"owner"}));
        self.settle_payout(&day_id, index, &a.account_id, a.coins, a.zones, minted)
    }

    /// Owner: settles an overdue withdrawal from the finalized mint receipt the
    /// owner inspected. Not minted restores the credit; minted books it paid.
    pub fn owner_reconcile_withdrawal(&mut self, account_id: AccountId, minted: bool) -> bool {
        self.owner();
        let a = withdraw_attempts().get(&account_id).expect("No recorded withdrawal to reconcile");
        assert!(now_ms() >= a.at_ms + RECONCILE_AFTER_MS, "Withdrawal may still be in flight");
        take_withdraw_attempt(&account_id, Some(a.nonce));
        event("withdrawal_reconciled", near_sdk::serde_json::json!({"account_id":account_id,"minted":minted,"evidence":"owner"}));
        self.settle_withdraw(&account_id, a.amount, minted)
    }
}

#[cfg(test)]
pub(crate) fn payout_nonce(day_id: &str, index: u32) -> Option<U64> {
    payout_attempts().get(&attempt_key(day_id, index)).map(|a| U64(a.nonce))
}
#[cfg(test)]
pub(crate) fn withdraw_nonce(account_id: &AccountId) -> Option<U64> {
    withdraw_attempts().get(account_id).map(|a| U64(a.nonce))
}
/// Simulates attempts issued by code that kept no attempt record.
#[cfg(test)]
pub(crate) fn forget_attempts(day_id: &str, index: u32, account_id: &AccountId) {
    payout_attempts().remove(&attempt_key(day_id, index));
    withdraw_attempts().remove(account_id);
}
