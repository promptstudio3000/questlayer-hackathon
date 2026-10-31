//! Bounded native testnet sponsored tasks. See docs/NATIVE-TASK-ESCROW.md.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

const POLICY: &str = "sponsored-tasks-testnet-v1";
const MAX_TASKS: u64 = 128;
const MAX_SUBMISSIONS: u32 = 32;
const NEAR: u128 = 10u128.pow(24);
const STORAGE: u128 = NEAR / 20;
const HOUR: u64 = 3_600_000;
const REVIEW: u64 = 48 * HOUR;
const APPEAL: u64 = 24 * HOUR;
const APPEAL_CUTOFF: u64 = 72 * HOUR;
const RESOLUTION_CUTOFF: u64 = 120 * HOUR;

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Evidence {
    pub text: String,
    pub reference: String,
    pub content_hash: String,
}
#[derive(BorshDeserialize, BorshSerialize, Clone, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
enum Status {
    Pending,
    Rejected,
    Approved,
    Appealed,
}
#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct Submission {
    claimant_id: AccountId,
    submitted_at_ms: u64,
    status: Status,
    evidence: Evidence,
    reviewed_at_ms: Option<u64>,
    review_reason: Option<String>,
    appeal_until_ms: Option<u64>,
    appeal: Option<Evidence>,
    resolved_at_ms: Option<u64>,
    resolution_reason: Option<String>,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Settlement {
    winner_id: Option<AccountId>,
    settled_at_ms: u64,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Task {
    client_id: String,
    sponsor_id: AccountId,
    title: String,
    description: String,
    reference: String,
    content_hash: String,
    area: String,
    reward: u128,
    due_at_ms: u64,
    created_at_ms: u64,
    cancelled: bool,
    submission_count: u32,
    review_cursor: u32,
    candidate_id: Option<u32>,
    settlement: Option<Settlement>,
}
#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct Withdrawal {
    id: u64,
    amount: u128,
}
#[derive(BorshDeserialize, BorshSerialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct Account {
    credit: u128,
    pending: Option<Withdrawal>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TaskView {
    pub task_id: u64,
    pub client_id: String,
    pub sponsor_id: AccountId,
    pub title: String,
    pub description: String,
    pub reference: String,
    pub content_hash: String,
    pub area: String,
    pub reward_yocto: U128,
    pub due_at_ms: u64,
    pub created_at_ms: u64,
    pub review_ends_at_ms: u64,
    pub appeal_ends_at_ms: u64,
    pub resolve_ends_at_ms: u64,
    pub status: String,
    pub cancelled: bool,
    pub submission_count: u32,
    pub review_cursor: u32,
    pub candidate_id: Option<u32>,
    pub winner_id: Option<AccountId>,
    pub settled_at_ms: Option<u64>,
}
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SubmissionView {
    pub submission_id: u32,
    pub claimant_id: AccountId,
    pub submitted_at_ms: u64,
    pub status: String,
    pub evidence: Evidence,
    pub reviewed_at_ms: Option<u64>,
    pub review_reason: Option<String>,
    pub appeal_until_ms: Option<u64>,
    pub appeal: Option<Evidence>,
    pub resolved_at_ms: Option<u64>,
    pub resolution_reason: Option<String>,
}
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct WithdrawalView {
    pub withdrawal_id: u64,
    pub amount_yocto: U128,
}
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AccountView {
    pub account_id: AccountId,
    pub credit_yocto: U128,
    pub pending_withdrawal: Option<WithdrawalView>,
}
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TotalsView {
    pub reward_deposits_yocto: U128,
    pub open_escrow_yocto: U128,
    pub credits_yocto: U128,
    pub pending_withdrawals_yocto: U128,
    pub withdrawn_yocto: U128,
    pub awarded_yocto: U128,
    pub refunded_yocto: U128,
    pub storage_funding_yocto: U128,
    pub operating_funding_yocto: U128,
    pub task_count: u64,
    pub conserved: bool,
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn on_withdraw(
        &mut self,
        account_id: AccountId,
        withdrawal_id: u64,
        amount_yocto: U128,
    ) -> bool;
}

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TaskEscrow {
    arbiter_id: AccountId,
    tasks: LookupMap<u64, Task>,
    submissions: LookupMap<(u64, u32), Submission>,
    operations: LookupMap<(AccountId, String), u64>,
    accounts: LookupMap<AccountId, Account>,
    task_count: u64,
    next_withdrawal: u64,
    funded: u128,
    escrow: u128,
    credits: u128,
    pending: u128,
    withdrawn: u128,
    awarded: u128,
    refunded: u128,
    storage_funding: u128,
    operating_funding: u128,
}

#[near_bindgen]
impl TaskEscrow {
    #[init]
    pub fn new(arbiter_id: AccountId) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Tasks are testnet-only"
        );
        assert!(
            arbiter_id.as_str().ends_with(".testnet"),
            "Use a named testnet arbiter"
        );
        assert_ne!(
            arbiter_id,
            env::current_account_id(),
            "Arbiter must be a separate account"
        );
        Self {
            arbiter_id,
            tasks: LookupMap::new(b"t"),
            submissions: LookupMap::new(b"s"),
            operations: LookupMap::new(b"o"),
            accounts: LookupMap::new(b"a"),
            task_count: 0,
            next_withdrawal: 1,
            funded: 0,
            escrow: 0,
            credits: 0,
            pending: 0,
            withdrawn: 0,
            awarded: 0,
            refunded: 0,
            storage_funding: 0,
            operating_funding: 0,
        }
    }

    #[payable]
    pub fn create_task(
        &mut self,
        client_id: String,
        title: String,
        description: String,
        reference: String,
        content_hash: String,
        area: String,
        reward_yocto: U128,
        due_at_ms: u64,
    ) -> TaskView {
        let sponsor_id = env::predecessor_account_id();
        assert_ne!(sponsor_id, self.arbiter_id, "Arbiter cannot sponsor tasks");
        Self::text(&client_id, 64, "Client ID");
        assert!(
            client_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "Invalid client ID"
        );
        assert!(
            self.operations
                .get(&(sponsor_id.clone(), client_id.clone()))
                .is_none(),
            "Client ID already used"
        );
        assert!(self.task_count < MAX_TASKS, "Pilot task capacity reached");
        Self::text(&title, 96, "Title");
        Self::text(&description, 512, "Description");
        Self::reference(&reference);
        Self::hash(&content_hash);
        Self::text(&area, 80, "Area");
        assert!(
            reward_yocto.0 > 0 && reward_yocto.0 <= NEAR,
            "Reward must be positive and at most 1 test NEAR"
        );
        let now = Self::now();
        assert!(
            due_at_ms >= now.checked_add(HOUR).expect("Timestamp overflow")
                && due_at_ms <= now.checked_add(14 * 24 * HOUR).expect("Timestamp overflow"),
            "Deadline must be 1 hour to 14 days away"
        );
        due_at_ms
            .checked_add(RESOLUTION_CUTOFF)
            .expect("Deadline overflow");
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            reward_yocto.0 + STORAGE,
            "Attach exact reward plus task storage funding"
        );
        let task_id = self.task_count + 1;
        let task = Task {
            client_id: client_id.clone(),
            sponsor_id: sponsor_id.clone(),
            title,
            description,
            reference,
            content_hash,
            area,
            reward: reward_yocto.0,
            due_at_ms,
            created_at_ms: now,
            cancelled: false,
            submission_count: 0,
            review_cursor: 0,
            candidate_id: None,
            settlement: None,
        };
        self.tasks.insert(&task_id, &task);
        self.operations
            .insert(&(sponsor_id.clone(), client_id), &task_id);
        self.task_count = task_id;
        self.funded += task.reward;
        self.escrow += task.reward;
        self.storage_funding += STORAGE;
        self.check();
        Self::event(
            "task_created",
            near_sdk::serde_json::json!({"task_id":task_id,"sponsor_id":sponsor_id,"reward_yocto":task.reward.to_string(),"policy_version":POLICY}),
        );
        self.task_view(task_id, task)
    }

    #[payable]
    pub fn submit_evidence(
        &mut self,
        task_id: u64,
        text: String,
        reference: String,
        content_hash: String,
    ) -> SubmissionView {
        let mut task = self.task(task_id);
        let claimant_id = env::predecessor_account_id();
        assert_ne!(
            claimant_id, task.sponsor_id,
            "Sponsor cannot claim their own task"
        );
        assert_ne!(
            claimant_id, self.arbiter_id,
            "Arbiter cannot submit evidence"
        );
        assert!(
            task.settlement.is_none()
                && !task.cancelled
                && task.candidate_id.is_none()
                && Self::now() < task.due_at_ms,
            "Task is closed to new evidence"
        );
        assert!(
            task.submission_count < MAX_SUBMISSIONS,
            "Submission capacity reached"
        );
        for id in 0..task.submission_count {
            assert_ne!(
                self.submission(task_id, id).claimant_id,
                claimant_id,
                "One submission per account per task"
            );
        }
        let evidence = Self::evidence(text, reference, content_hash);
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            STORAGE,
            "Attach exact submission storage funding"
        );
        let submission_id = task.submission_count;
        let submission = Submission {
            claimant_id: claimant_id.clone(),
            submitted_at_ms: Self::now(),
            status: Status::Pending,
            evidence,
            reviewed_at_ms: None,
            review_reason: None,
            appeal_until_ms: None,
            appeal: None,
            resolved_at_ms: None,
            resolution_reason: None,
        };
        self.submissions
            .insert(&(task_id, submission_id), &submission);
        task.submission_count += 1;
        self.tasks.insert(&task_id, &task);
        self.storage_funding += STORAGE;
        self.check();
        Self::event(
            "evidence_submitted",
            near_sdk::serde_json::json!({"task_id":task_id,"submission_id":submission_id,"claimant_id":claimant_id}),
        );
        self.submission_view(submission_id, submission, &task)
    }

    pub fn review_submission(
        &mut self,
        task_id: u64,
        submission_id: u32,
        approved: bool,
        reason: String,
    ) -> TaskView {
        Self::nonpayable();
        let mut task = self.task(task_id);
        assert_eq!(
            env::predecessor_account_id(),
            task.sponsor_id,
            "Sponsor only"
        );
        assert!(
            task.settlement.is_none() && task.candidate_id.is_none(),
            "Task already has an approved candidate or settlement"
        );
        assert!(
            Self::now() < task.due_at_ms + REVIEW,
            "Sponsor review deadline passed"
        );
        assert_eq!(
            submission_id, task.review_cursor,
            "Review earlier evidence first"
        );
        let mut submission = self.submission(task_id, submission_id);
        assert!(
            submission.status == Status::Pending,
            "Submission is not pending sponsor review"
        );
        Self::text(&reason, 256, "Review reason");
        submission.status = if approved {
            Status::Approved
        } else {
            Status::Rejected
        };
        submission.reviewed_at_ms = Some(Self::now());
        submission.review_reason = Some(reason);
        submission.appeal_until_ms = if approved {
            None
        } else {
            Some((Self::now() + APPEAL).min(task.due_at_ms + APPEAL_CUTOFF))
        };
        self.submissions
            .insert(&(task_id, submission_id), &submission);
        task.review_cursor += 1;
        if approved {
            task.candidate_id = Some(submission_id);
        }
        Self::event(
            "submission_reviewed",
            near_sdk::serde_json::json!({"task_id":task_id,"submission_id":submission_id,"approved":approved}),
        );
        self.finalize(task_id, &mut task);
        self.tasks.insert(&task_id, &task);
        self.task_view(task_id, task)
    }

    pub fn appeal_submission(
        &mut self,
        task_id: u64,
        submission_id: u32,
        text: String,
        reference: String,
        content_hash: String,
    ) -> SubmissionView {
        Self::nonpayable();
        let task = self.task(task_id);
        assert!(task.settlement.is_none(), "Task already settled");
        let mut submission = self.submission(task_id, submission_id);
        assert_eq!(
            env::predecessor_account_id(),
            submission.claimant_id,
            "Claimant only"
        );
        assert!(
            submission.resolved_at_ms.is_none(),
            "Arbiter decision is final"
        );
        let now = Self::now();
        let eligible = match submission.status {
            Status::Rejected => now < submission.appeal_until_ms.expect("Missing appeal deadline"),
            Status::Pending => {
                now >= task.due_at_ms + REVIEW && now < task.due_at_ms + APPEAL_CUTOFF
            }
            _ => false,
        };
        assert!(eligible, "Submission is not eligible for appeal now");
        submission.appeal = Some(Self::evidence(text, reference, content_hash));
        submission.status = Status::Appealed;
        self.submissions
            .insert(&(task_id, submission_id), &submission);
        Self::event(
            "submission_appealed",
            near_sdk::serde_json::json!({"task_id":task_id,"submission_id":submission_id}),
        );
        self.submission_view(submission_id, submission, &task)
    }

    pub fn resolve_appeal(
        &mut self,
        task_id: u64,
        submission_id: u32,
        approved: bool,
        reason: String,
    ) -> TaskView {
        Self::nonpayable();
        assert_eq!(
            env::predecessor_account_id(),
            self.arbiter_id,
            "Arbiter only"
        );
        let mut task = self.task(task_id);
        assert!(task.settlement.is_none(), "Task already settled");
        assert!(
            Self::now() < task.due_at_ms + RESOLUTION_CUTOFF,
            "Arbitration deadline passed"
        );
        let mut submission = self.submission(task_id, submission_id);
        assert!(
            submission.status == Status::Appealed,
            "Submission is not appealed"
        );
        Self::text(&reason, 256, "Resolution reason");
        submission.status = if approved {
            Status::Approved
        } else {
            Status::Rejected
        };
        submission.resolved_at_ms = Some(Self::now());
        submission.resolution_reason = Some(reason);
        self.submissions
            .insert(&(task_id, submission_id), &submission);
        if approved {
            task.candidate_id = Some(
                task.candidate_id
                    .map_or(submission_id, |old| old.min(submission_id)),
            );
        }
        Self::event(
            "appeal_resolved",
            near_sdk::serde_json::json!({"task_id":task_id,"submission_id":submission_id,"approved":approved}),
        );
        self.finalize(task_id, &mut task);
        self.tasks.insert(&task_id, &task);
        self.task_view(task_id, task)
    }

    pub fn cancel_task(&mut self, task_id: u64) -> TaskView {
        Self::nonpayable();
        let mut task = self.task(task_id);
        assert_eq!(
            env::predecessor_account_id(),
            task.sponsor_id,
            "Sponsor only"
        );
        if task.settlement.is_none() && !task.cancelled {
            task.cancelled = true;
            Self::event(
                "task_cancelled",
                near_sdk::serde_json::json!({"task_id":task_id}),
            );
        }
        self.finalize(task_id, &mut task);
        self.tasks.insert(&task_id, &task);
        self.task_view(task_id, task)
    }

    pub fn finalize_task(&mut self, task_id: u64) -> TaskView {
        Self::nonpayable();
        let mut task = self.task(task_id);
        self.finalize(task_id, &mut task);
        self.tasks.insert(&task_id, &task);
        self.task_view(task_id, task)
    }

    #[payable]
    pub fn withdraw(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        assert!(
            env::prepaid_gas() >= Gas::from_tgas(35),
            "Attach at least 35 Tgas"
        );
        let account_id = env::predecessor_account_id();
        let mut account = self.accounts.get(&account_id).expect("No reward credit");
        assert!(account.pending.is_none(), "Withdrawal already pending");
        assert!(account.credit > 0, "No reward credit");
        let amount = account.credit;
        let withdrawal_id = self.next_withdrawal;
        self.next_withdrawal = self
            .next_withdrawal
            .checked_add(1)
            .expect("Withdrawal ID overflow");
        account.credit = 0;
        account.pending = Some(Withdrawal {
            id: withdrawal_id,
            amount,
        });
        self.accounts.insert(&account_id, &account);
        self.credits -= amount;
        self.pending += amount;
        self.operating_funding += 1;
        self.check();
        Self::event(
            "withdrawal_started",
            near_sdk::serde_json::json!({"account_id":account_id,"withdrawal_id":withdrawal_id,"amount_yocto":amount.to_string()}),
        );
        Promise::new(account_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_withdraw(account_id, withdrawal_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        account_id: AccountId,
        withdrawal_id: u64,
        amount_yocto: U128,
    ) -> bool {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "Private callback"
        );
        let Some(mut account) = self.accounts.get(&account_id) else {
            return false;
        };
        let Some(pending) = account.pending.clone() else {
            return false;
        };
        if pending.id != withdrawal_id || pending.amount != amount_yocto.0 {
            return false;
        }
        assert_eq!(
            env::promise_results_count(),
            1,
            "Expected one transfer result"
        );
        let success = env::promise_result_checked(0, 64).is_ok();
        account.pending = None;
        self.pending -= pending.amount;
        if success {
            self.withdrawn += pending.amount;
        } else {
            account.credit += pending.amount;
            self.credits += pending.amount;
        }
        self.accounts.insert(&account_id, &account);
        self.check();
        Self::event(
            "withdrawal_completed",
            near_sdk::serde_json::json!({"account_id":account_id,"withdrawal_id":withdrawal_id,"amount_yocto":pending.amount.to_string(),"success":success}),
        );
        success
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"policy_version":POLICY,"network":"testnet","arbiter_id":self.arbiter_id,
            "max_tasks":MAX_TASKS,"max_submissions":MAX_SUBMISSIONS,"max_reward_yocto":NEAR.to_string(),
            "task_storage_yocto":STORAGE.to_string(),"submission_storage_yocto":STORAGE.to_string(),
            "min_due_delay_ms":HOUR,"max_due_delay_ms":14*24*HOUR,"review_period_ms":REVIEW,
            "appeal_period_ms":APPEAL,"appeal_cutoff_ms":APPEAL_CUTOFF,"resolution_cutoff_ms":RESOLUTION_CUTOFF})
    }
    pub fn get_task(&self, task_id: u64) -> Option<TaskView> {
        self.tasks.get(&task_id).map(|t| self.task_view(task_id, t))
    }
    pub fn get_tasks(&self, from_index: Option<u64>, limit: Option<u32>) -> Vec<TaskView> {
        let from = from_index.unwrap_or(1).max(1);
        let limit = u64::from(limit.unwrap_or(20).min(50));
        (from..from.saturating_add(limit).min(self.task_count + 1))
            .filter_map(|id| self.get_task(id))
            .collect()
    }
    pub fn get_submissions(
        &self,
        task_id: u64,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<SubmissionView> {
        let task = self.task(task_id);
        let from = from_index.unwrap_or(0);
        (from..from
            .saturating_add(limit.unwrap_or(MAX_SUBMISSIONS).min(MAX_SUBMISSIONS))
            .min(task.submission_count))
            .map(|id| self.submission_view(id, self.submission(task_id, id), &task))
            .collect()
    }
    pub fn get_account(&self, account_id: AccountId) -> AccountView {
        let account = self.accounts.get(&account_id).unwrap_or_default();
        AccountView {
            account_id,
            credit_yocto: U128(account.credit),
            pending_withdrawal: account.pending.map(|p| WithdrawalView {
                withdrawal_id: p.id,
                amount_yocto: U128(p.amount),
            }),
        }
    }
    pub fn get_totals(&self) -> TotalsView {
        TotalsView {
            reward_deposits_yocto: U128(self.funded),
            open_escrow_yocto: U128(self.escrow),
            credits_yocto: U128(self.credits),
            pending_withdrawals_yocto: U128(self.pending),
            withdrawn_yocto: U128(self.withdrawn),
            awarded_yocto: U128(self.awarded),
            refunded_yocto: U128(self.refunded),
            storage_funding_yocto: U128(self.storage_funding),
            operating_funding_yocto: U128(self.operating_funding),
            task_count: self.task_count,
            conserved: self.funded == self.escrow + self.credits + self.pending + self.withdrawn,
        }
    }
}

impl TaskEscrow {
    fn now() -> u64 {
        env::block_timestamp_ms()
    }
    fn nonpayable() {
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            0,
            "No deposit required"
        );
    }
    fn text(text: &str, maximum: usize, field: &str) {
        assert!(
            !text.trim().is_empty() && text.len() <= maximum,
            "{field} has invalid UTF-8 byte length"
        );
        assert!(
            !text.chars().any(|c| c.is_control() && c != '\n'),
            "{field} contains control characters"
        );
    }
    fn reference(reference: &str) {
        assert!(
            reference.len() <= 256 && !reference.chars().any(char::is_control),
            "Invalid reference"
        );
        assert!(
            reference.is_empty()
                || reference.starts_with("https://")
                || reference.starts_with("ipfs://")
                || reference.starts_with("urn:"),
            "Reference must use https, ipfs or urn"
        );
    }
    fn hash(hash: &str) {
        assert!(
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "Use a lowercase SHA-256 hex hash"
        );
    }
    fn evidence(text: String, reference: String, content_hash: String) -> Evidence {
        Self::text(&text, 512, "Evidence");
        Self::reference(&reference);
        Self::hash(&content_hash);
        Evidence {
            text,
            reference,
            content_hash,
        }
    }
    fn task(&self, task_id: u64) -> Task {
        self.tasks.get(&task_id).expect("Task not found")
    }
    fn submission(&self, task_id: u64, submission_id: u32) -> Submission {
        self.submissions
            .get(&(task_id, submission_id))
            .expect("Submission not found")
    }
    fn blocks(&self, task: &Task, submission: &Submission) -> bool {
        match submission.status {
            Status::Pending => Self::now() < task.due_at_ms + APPEAL_CUTOFF,
            Status::Appealed => Self::now() < task.due_at_ms + RESOLUTION_CUTOFF,
            Status::Rejected => {
                submission.resolved_at_ms.is_none()
                    && Self::now() < submission.appeal_until_ms.unwrap_or(0)
            }
            Status::Approved => false,
        }
    }
    fn finalize(&mut self, task_id: u64, task: &mut Task) {
        if task.settlement.is_some() {
            return;
        }
        for id in 0..task.submission_count {
            let submission = self.submission(task_id, id);
            if self.blocks(task, &submission) {
                return;
            }
            if submission.status == Status::Approved {
                self.settle(task_id, task, Some(submission.claimant_id));
                return;
            }
        }
        if task.cancelled || Self::now() >= task.due_at_ms {
            self.settle(task_id, task, None);
        }
    }
    fn settle(&mut self, task_id: u64, task: &mut Task, winner: Option<AccountId>) {
        assert!(
            task.settlement.is_none() && task.reward > 0,
            "Invalid settlement"
        );
        let recipient = winner.as_ref().unwrap_or(&task.sponsor_id).clone();
        let mut account = self.accounts.get(&recipient).unwrap_or_default();
        account.credit += task.reward;
        self.accounts.insert(&recipient, &account);
        self.escrow -= task.reward;
        self.credits += task.reward;
        if winner.is_some() {
            self.awarded += task.reward;
        } else {
            self.refunded += task.reward;
        }
        task.settlement = Some(Settlement {
            winner_id: winner.clone(),
            settled_at_ms: Self::now(),
        });
        self.check();
        Self::event(
            "task_settled",
            near_sdk::serde_json::json!({"task_id":task_id,"recipient_id":recipient,"outcome":if winner.is_some(){"awarded"}else{"refunded"},"amount_yocto":task.reward.to_string()}),
        );
    }
    fn check(&self) {
        assert_eq!(
            self.funded,
            self.escrow + self.credits + self.pending + self.withdrawn,
            "Reward conservation failure"
        );
        assert_eq!(
            self.funded,
            self.escrow + self.awarded + self.refunded,
            "Settlement attribution failure"
        );
    }
    fn task_view(&self, task_id: u64, task: Task) -> TaskView {
        let status = if let Some(settlement) = &task.settlement {
            if settlement.winner_id.is_some() {
                "awarded"
            } else {
                "refunded"
            }
        } else if task.cancelled || task.candidate_id.is_some() || Self::now() >= task.due_at_ms {
            "closing"
        } else {
            "open"
        };
        TaskView {
            task_id,
            client_id: task.client_id,
            sponsor_id: task.sponsor_id,
            title: task.title,
            description: task.description,
            reference: task.reference,
            content_hash: task.content_hash,
            area: task.area,
            reward_yocto: U128(task.reward),
            due_at_ms: task.due_at_ms,
            created_at_ms: task.created_at_ms,
            review_ends_at_ms: task.due_at_ms + REVIEW,
            appeal_ends_at_ms: task.due_at_ms + APPEAL_CUTOFF,
            resolve_ends_at_ms: task.due_at_ms + RESOLUTION_CUTOFF,
            status: status.into(),
            cancelled: task.cancelled,
            submission_count: task.submission_count,
            review_cursor: task.review_cursor,
            candidate_id: task.candidate_id,
            winner_id: task.settlement.as_ref().and_then(|s| s.winner_id.clone()),
            settled_at_ms: task.settlement.map(|s| s.settled_at_ms),
        }
    }
    fn submission_view(
        &self,
        submission_id: u32,
        submission: Submission,
        task: &Task,
    ) -> SubmissionView {
        let status = match submission.status {
            Status::Pending
                if task.settlement.is_some() || Self::now() >= task.due_at_ms + APPEAL_CUTOFF =>
            {
                "expired"
            }
            Status::Appealed
                if task.settlement.is_some()
                    || Self::now() >= task.due_at_ms + RESOLUTION_CUTOFF =>
            {
                "expired"
            }
            Status::Pending => "pending",
            Status::Appealed => "appealed",
            Status::Approved => "approved",
            Status::Rejected => "rejected",
        };
        let appeal_until = if submission.status == Status::Pending {
            Some(task.due_at_ms + APPEAL_CUTOFF)
        } else {
            submission.appeal_until_ms
        };
        SubmissionView {
            submission_id,
            claimant_id: submission.claimant_id,
            submitted_at_ms: submission.submitted_at_ms,
            status: status.into(),
            evidence: submission.evidence,
            reviewed_at_ms: submission.reviewed_at_ms,
            review_reason: submission.review_reason,
            appeal_until_ms: appeal_until,
            appeal: submission.appeal,
            resolved_at_ms: submission.resolved_at_ms,
            resolution_reason: submission.resolution_reason,
        }
    }
    fn event(name: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"questlayer_tasks","version":"1.0.0","event":name,"data":[data]})
        ));
    }
}

#[cfg(test)]
mod tests;
