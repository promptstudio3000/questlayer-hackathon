use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const NOW: u64 = 1_800_000_000_000;
const DUE: u64 = NOW + 2 * HOUR;
const REWARD: u128 = NEAR / 10;
fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(who: &str, time: u64, deposit: u128) {
    let storage = env::storage_usage();
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("tasks.testnet"))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .block_timestamp(time * 1_000_000)
        .account_balance(NearToken::from_near(1000))
        .storage_usage(storage)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}
fn callback(success: bool) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("tasks.testnet"))
        .predecessor_account_id(a("tasks.testnet"))
        .block_timestamp(NOW * 1_000_000)
        .account_balance(NearToken::from_near(1000))
        .storage_usage(env::storage_usage());
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![if success {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        }],
    );
}
fn fresh() -> TaskEscrow {
    context("sponsor.testnet", NOW, 0);
    TaskEscrow::new(a("arbiter.testnet"))
}
fn create(c: &mut TaskEscrow, id: &str) -> TaskView {
    c.create_task(
        id.into(),
        "River path accessibility".into(),
        "Check whether the marked public path is clear.".into(),
        "https://example.test/task".into(),
        "a".repeat(64),
        "Plzen - Bolevec".into(),
        U128(REWARD),
        DUE,
    )
}
fn seeded() -> TaskEscrow {
    let mut c = fresh();
    context("sponsor.testnet", NOW, REWARD + STORAGE);
    create(&mut c, "task-1");
    c
}
fn submit(c: &mut TaskEscrow, who: &str) -> SubmissionView {
    context(who, NOW + 1, STORAGE);
    c.submit_evidence(
        1,
        "Public evidence summary; private photo kept off chain.".into(),
        "urn:questlayer:evidence:1".into(),
        "b".repeat(64),
    )
}
fn review(c: &mut TaskEscrow, id: u32, approved: bool, time: u64) -> TaskView {
    context("sponsor.testnet", time, 0);
    c.review_submission(
        1,
        id,
        approved,
        "The evidence meets the published criteria.".into(),
    )
}
fn appeal(c: &mut TaskEscrow, who: &str, id: u32, time: u64) {
    context(who, time, 0);
    c.appeal_submission(
        1,
        id,
        "Please review the additional private evidence.".into(),
        "urn:questlayer:appeal:1".into(),
        "c".repeat(64),
    );
}
fn resolve(c: &mut TaskEscrow, id: u32, approved: bool, time: u64) -> TaskView {
    context("arbiter.testnet", time, 0);
    c.resolve_appeal(
        1,
        id,
        approved,
        "Independent review outcome under the pilot policy.".into(),
    )
}
fn finish(c: &mut TaskEscrow, time: u64) -> TaskView {
    context("anyone.testnet", time, 0);
    c.finalize_task(1)
}
fn credit(c: &TaskEscrow, who: &str) -> u128 {
    c.get_account(a(who)).credit_yocto.0
}
fn fails(f: impl FnOnce()) {
    assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
}

#[test]
fn first_approved_evidence_awards_immediately_ignoring_later_pending() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    let t = review(&mut c, 0, true, NOW + 2);
    assert_eq!(t.status, "awarded");
    assert_eq!(t.winner_id, Some(a("first.testnet")));
    assert_eq!(credit(&c, "first.testnet"), REWARD);
    assert_eq!(credit(&c, "later.testnet"), 0);
    assert_eq!(c.get_submissions(1, None, None)[1].status, "expired");
    assert!(c.get_totals().conserved);
    assert_eq!(c.storage_funding, 3 * STORAGE);
}
#[test]
fn cannot_skip_earlier_pending_review() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    fails(|| {
        review(&mut c, 1, true, NOW + 2);
    });
    assert_eq!(c.get_task(1).unwrap().review_cursor, 0);
    assert_eq!(c.escrow, REWARD);
}
#[test]
fn later_candidate_waits_for_earlier_rejection_appeal_rights() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    review(&mut c, 0, false, NOW + 2);
    assert_eq!(review(&mut c, 1, true, NOW + 3).status, "closing");
    assert_eq!(credit(&c, "later.testnet"), 0);
    assert_eq!(finish(&mut c, NOW + 2 + APPEAL - 1).status, "closing");
    assert_eq!(
        finish(&mut c, NOW + 2 + APPEAL).winner_id,
        Some(a("later.testnet"))
    );
}
#[test]
fn earlier_successful_appeal_takes_precedence_over_later_candidate() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    review(&mut c, 0, false, NOW + 2);
    review(&mut c, 1, true, NOW + 3);
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    assert_eq!(finish(&mut c, DUE + REVIEW).status, "closing");
    let t = resolve(&mut c, 0, true, DUE + REVIEW + 1);
    assert_eq!(t.winner_id, Some(a("first.testnet")));
    assert_eq!(credit(&c, "later.testnet"), 0);
}
#[test]
fn earlier_failed_appeal_releases_later_candidate_immediately() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    review(&mut c, 0, false, NOW + 2);
    review(&mut c, 1, true, NOW + 3);
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    assert_eq!(
        resolve(&mut c, 0, false, NOW + 5).winner_id,
        Some(a("later.testnet"))
    );
}
#[test]
fn abandoned_arbiter_expires_prior_appeal_and_unlocks_candidate_at_final_deadline() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    review(&mut c, 0, false, NOW + 2);
    review(&mut c, 1, true, NOW + 3);
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    assert_eq!(
        finish(&mut c, DUE + RESOLUTION_CUTOFF - 1).status,
        "closing"
    );
    assert_eq!(
        finish(&mut c, DUE + RESOLUTION_CUTOFF).winner_id,
        Some(a("later.testnet"))
    );
    assert_eq!(c.get_submissions(1, None, None)[0].status, "expired");
}
#[test]
fn abandoned_arbiter_refunds_when_no_approved_candidate() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    appeal(&mut c, "first.testnet", 0, DUE + REVIEW);
    assert_eq!(
        finish(&mut c, DUE + RESOLUTION_CUTOFF - 1).status,
        "closing"
    );
    assert_eq!(finish(&mut c, DUE + RESOLUTION_CUTOFF).status, "refunded");
    assert_eq!(credit(&c, "sponsor.testnet"), REWARD);
}
#[test]
fn pending_has_post_review_appeal_window_then_expires_without_appeal() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    assert_eq!(finish(&mut c, DUE + APPEAL_CUTOFF - 1).status, "closing");
    assert_eq!(finish(&mut c, DUE + APPEAL_CUTOFF).status, "refunded");
    assert_eq!(c.get_submissions(1, None, None)[0].status, "expired");
}
#[test]
fn later_appeal_approval_waits_for_earlier_pending_deadline() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    appeal(&mut c, "later.testnet", 1, DUE + REVIEW);
    assert_eq!(resolve(&mut c, 1, true, DUE + REVIEW + 1).status, "closing");
    assert_eq!(
        finish(&mut c, DUE + APPEAL_CUTOFF).winner_id,
        Some(a("later.testnet"))
    );
}
#[test]
fn cancellation_without_evidence_refunds_once() {
    let mut c = seeded();
    context("sponsor.testnet", NOW + 1, 0);
    assert_eq!(c.cancel_task(1).status, "refunded");
    c.cancel_task(1);
    finish(&mut c, DUE + RESOLUTION_CUTOFF);
    assert_eq!(credit(&c, "sponsor.testnet"), REWARD);
    assert_eq!(c.refunded, REWARD);
}
#[test]
fn cancellation_does_not_erase_pending_evidence_or_prevent_review() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    context("sponsor.testnet", NOW + 2, 0);
    assert_eq!(c.cancel_task(1).status, "closing");
    assert_eq!(c.escrow, REWARD);
    fails(|| {
        submit(&mut c, "late.testnet");
    });
    assert_eq!(
        review(&mut c, 0, true, NOW + 3).winner_id,
        Some(a("first.testnet"))
    );
}
#[test]
fn cancellation_does_not_bypass_rejected_appeal_right() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    review(&mut c, 0, false, NOW + 2);
    context("sponsor.testnet", NOW + 3, 0);
    assert_eq!(c.cancel_task(1).status, "closing");
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    assert_eq!(
        resolve(&mut c, 0, true, NOW + 5).winner_id,
        Some(a("first.testnet"))
    );
}
#[test]
fn live_empty_task_cannot_refund_early_but_due_empty_task_can() {
    let mut c = seeded();
    assert_eq!(finish(&mut c, DUE - 1).status, "open");
    assert_eq!(finish(&mut c, DUE).status, "refunded");
}
#[test]
fn zero_reward_rejected_without_mutation() {
    let mut c = fresh();
    context("sponsor.testnet", NOW, STORAGE);
    fails(|| {
        c.create_task(
            "zero".into(),
            "Title".into(),
            "Description".into(),
            "".into(),
            "a".repeat(64),
            "Area".into(),
            U128(0),
            DUE,
        );
    });
    assert_eq!(c.funded, 0);
    assert_eq!(c.task_count, 0);
}
#[test]
fn maximum_reward_and_exact_funding_enforced() {
    let mut c = fresh();
    context("sponsor.testnet", NOW, REWARD + STORAGE - 1);
    fails(|| {
        create(&mut c, "under");
    });
    context("sponsor.testnet", NOW, REWARD + STORAGE + 1);
    fails(|| {
        create(&mut c, "over");
    });
    context("sponsor.testnet", NOW, NEAR + 1 + STORAGE);
    fails(|| {
        c.create_task(
            "large".into(),
            "Title".into(),
            "Description".into(),
            "".into(),
            "a".repeat(64),
            "Area".into(),
            U128(NEAR + 1),
            DUE,
        );
    });
    assert_eq!(c.task_count, 0);
}
#[test]
fn client_id_is_scoped_to_sponsor_and_replay_is_rejected() {
    let mut c = seeded();
    context("sponsor.testnet", NOW, REWARD + STORAGE);
    fails(|| {
        create(&mut c, "task-1");
    });
    context("other.testnet", NOW, REWARD + STORAGE);
    assert_eq!(create(&mut c, "task-1").task_id, 2);
    assert_eq!(c.funded, 2 * REWARD);
}
#[test]
fn one_submission_per_account_and_exact_storage_funding() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    fails(|| {
        submit(&mut c, "first.testnet");
    });
    context("second.testnet", NOW + 1, STORAGE - 1);
    fails(|| {
        c.submit_evidence(1, "Evidence".into(), "".into(), "a".repeat(64));
    });
    assert_eq!(c.get_task(1).unwrap().submission_count, 1);
}
#[test]
fn approval_closes_new_submissions_even_while_prior_appeal_right_lives() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    submit(&mut c, "later.testnet");
    review(&mut c, 0, false, NOW + 2);
    review(&mut c, 1, true, NOW + 3);
    fails(|| {
        submit(&mut c, "third.testnet");
    });
}
#[test]
fn caller_roles_and_arbiter_separation_are_enforced() {
    let mut c = seeded();
    fails(|| {
        submit(&mut c, "sponsor.testnet");
    });
    fails(|| {
        submit(&mut c, "arbiter.testnet");
    });
    context("arbiter.testnet", NOW, REWARD + STORAGE);
    fails(|| {
        create(&mut c, "self-review");
    });
    submit(&mut c, "first.testnet");
    context("attacker.testnet", NOW + 2, 0);
    fails(|| {
        c.review_submission(1, 0, true, "Reason".into());
    });
    fails(|| {
        c.cancel_task(1);
    });
    review(&mut c, 0, false, NOW + 3);
    context("attacker.testnet", NOW + 4, 0);
    fails(|| {
        c.appeal_submission(1, 0, "Reason".into(), "".into(), "a".repeat(64));
    });
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    context("sponsor.testnet", NOW + 5, 0);
    fails(|| {
        c.resolve_appeal(1, 0, true, "Reason".into());
    });
}
#[test]
fn all_deadlines_use_exclusive_action_cutoffs() {
    let mut c = seeded();
    context("first.testnet", DUE, STORAGE);
    fails(|| {
        c.submit_evidence(1, "Evidence".into(), "".into(), "a".repeat(64));
    });
    submit(&mut c, "first.testnet");
    fails(|| {
        review(&mut c, 0, true, DUE + REVIEW);
    });
    fails(|| {
        appeal(&mut c, "first.testnet", 0, DUE + REVIEW - 1);
    });
    fails(|| {
        appeal(&mut c, "first.testnet", 0, DUE + APPEAL_CUTOFF);
    });
    appeal(&mut c, "first.testnet", 0, DUE + APPEAL_CUTOFF - 1);
    fails(|| {
        resolve(&mut c, 0, true, DUE + RESOLUTION_CUTOFF);
    });
}
#[test]
fn rejection_appeal_deadline_and_arbiter_finality() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    review(&mut c, 0, false, NOW + 2);
    fails(|| {
        appeal(&mut c, "first.testnet", 0, NOW + 2 + APPEAL);
    });
    appeal(&mut c, "first.testnet", 0, NOW + 2 + APPEAL - 1);
    resolve(&mut c, 0, false, NOW + 2 + APPEAL - 1);
    fails(|| {
        appeal(&mut c, "first.testnet", 0, NOW + 2 + APPEAL - 1);
    });
}
#[test]
fn review_appeal_resolution_and_finalization_replays_do_not_pay_twice() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    review(&mut c, 0, false, NOW + 2);
    fails(|| {
        review(&mut c, 0, false, NOW + 3);
    });
    appeal(&mut c, "first.testnet", 0, NOW + 4);
    fails(|| {
        appeal(&mut c, "first.testnet", 0, NOW + 5);
    });
    resolve(&mut c, 0, true, NOW + 6);
    fails(|| {
        resolve(&mut c, 0, true, NOW + 7);
    });
    for _ in 0..3 {
        finish(&mut c, DUE + RESOLUTION_CUTOFF);
    }
    assert_eq!(credit(&c, "first.testnet"), REWARD);
    assert_eq!(c.awarded, REWARD);
}
#[test]
fn transfer_failure_retry_and_stale_callback_preserve_credits() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    review(&mut c, 0, true, NOW + 2);
    context("first.testnet", NOW + 3, 1);
    let _ = c.withdraw();
    assert_eq!(c.credits, 0);
    assert_eq!(c.pending, REWARD);
    fails(|| {
        let _ = c.withdraw();
    });
    callback(false);
    assert!(!c.on_withdraw(a("first.testnet"), 1, U128(REWARD)));
    assert_eq!(credit(&c, "first.testnet"), REWARD);
    assert_eq!(c.pending, 0);
    context("first.testnet", NOW + 4, 1);
    let _ = c.withdraw();
    callback(true);
    assert!(!c.on_withdraw(a("first.testnet"), 1, U128(REWARD)));
    assert!(!c.on_withdraw(a("first.testnet"), 2, U128(REWARD - 1)));
    assert_eq!(c.pending, REWARD);
    assert!(c.on_withdraw(a("first.testnet"), 2, U128(REWARD)));
    assert!(!c.on_withdraw(a("first.testnet"), 2, U128(REWARD)));
    assert_eq!(c.withdrawn, REWARD);
    assert_eq!(credit(&c, "first.testnet"), 0);
    assert_eq!(c.operating_funding, 2);
    assert!(c.get_totals().conserved);
}
#[test]
fn zero_credit_withdraw_and_public_callback_do_not_mutate() {
    let mut c = seeded();
    context("attacker.testnet", NOW, 1);
    fails(|| {
        let _ = c.withdraw();
    });
    context("attacker.testnet", NOW, 0);
    fails(|| {
        c.on_withdraw(a("sponsor.testnet"), 1, U128(REWARD));
    });
    assert_eq!(c.escrow, REWARD);
    assert_eq!(c.pending, 0);
}
#[test]
fn settlement_can_credit_account_while_an_older_withdrawal_is_pending() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    review(&mut c, 0, true, NOW + 2);
    context("first.testnet", NOW + 3, 1);
    let _ = c.withdraw();
    context("first.testnet", NOW, REWARD + STORAGE);
    create(&mut c, "second-task");
    context("first.testnet", NOW + 4, 0);
    c.cancel_task(2);
    assert_eq!(credit(&c, "first.testnet"), REWARD);
    callback(false);
    c.on_withdraw(a("first.testnet"), 1, U128(REWARD));
    assert_eq!(credit(&c, "first.testnet"), 2 * REWARD);
    assert!(c.get_totals().conserved);
}
#[test]
fn storage_and_reward_totals_stay_separate_through_refund() {
    let mut c = seeded();
    submit(&mut c, "first.testnet");
    finish(&mut c, DUE + RESOLUTION_CUTOFF);
    context("sponsor.testnet", DUE + RESOLUTION_CUTOFF, 1);
    let _ = c.withdraw();
    callback(true);
    assert!(c.on_withdraw(a("sponsor.testnet"), 1, U128(REWARD)));
    assert_eq!(c.withdrawn, REWARD);
    assert_eq!(c.storage_funding, 2 * STORAGE);
    assert_eq!(c.operating_funding, 1);
}
#[test]
fn bounded_views_and_lifetime_task_cap() {
    let mut c = fresh();
    for id in 0..MAX_TASKS {
        context("sponsor.testnet", NOW, REWARD + STORAGE);
        create(&mut c, &format!("task-{id}"));
    }
    assert_eq!(c.get_tasks(None, Some(1000)).len(), 50);
    assert_eq!(c.get_tasks(Some(128), Some(50)).len(), 1);
    assert!(c.get_tasks(Some(u64::MAX), Some(50)).is_empty());
    assert!(c.get_task(129).is_none());
    context("sponsor.testnet", NOW, REWARD + STORAGE);
    fails(|| {
        create(&mut c, "overflow");
    });
    assert_eq!(c.task_count, MAX_TASKS);
}
#[test]
fn submission_cap_and_paging_do_not_allow_unbounded_growth() {
    let mut c = seeded();
    for id in 0..MAX_SUBMISSIONS {
        submit(&mut c, &format!("player-{id}.testnet"));
    }
    fails(|| {
        submit(&mut c, "overflow.testnet");
    });
    assert_eq!(
        c.get_submissions(1, None, Some(1000)).len(),
        MAX_SUBMISSIONS as usize
    );
    assert_eq!(c.get_submissions(1, Some(31), Some(10)).len(), 1);
    assert!(c.get_submissions(1, Some(u32::MAX), None).is_empty());
}
#[test]
fn text_hash_reference_and_due_bounds_are_enforced() {
    let mut c = fresh();
    context("sponsor.testnet", NOW, REWARD + STORAGE);
    fails(|| {
        c.create_task(
            "bad id".into(),
            "Title".into(),
            "D".into(),
            "".into(),
            "a".repeat(64),
            "Area".into(),
            U128(REWARD),
            DUE,
        );
    });
    fails(|| {
        c.create_task(
            "x".into(),
            "é".repeat(49),
            "D".into(),
            "".into(),
            "a".repeat(64),
            "Area".into(),
            U128(REWARD),
            DUE,
        );
    });
    fails(|| {
        c.create_task(
            "x".into(),
            "Title".into(),
            "D".into(),
            "javascript:alert(1)".into(),
            "a".repeat(64),
            "Area".into(),
            U128(REWARD),
            DUE,
        );
    });
    fails(|| {
        c.create_task(
            "x".into(),
            "Title".into(),
            "D".into(),
            "".into(),
            "A".repeat(64),
            "Area".into(),
            U128(REWARD),
            DUE,
        );
    });
    for deadline in [NOW + HOUR - 1, NOW + 14 * 24 * HOUR + 1] {
        fails(|| {
            c.create_task(
                "x".into(),
                "Title".into(),
                "D".into(),
                "".into(),
                "a".repeat(64),
                "Area".into(),
                U128(REWARD),
                deadline,
            );
        });
    }
    assert_eq!(c.task_count, 0);
}
#[test]
fn longest_task_and_full_evidence_lifecycle_fit_explicit_storage_reservations() {
    let mut c = fresh();
    let long_sponsor = format!("{}.testnet", "s".repeat(56));
    let long_claimant = format!("{}.testnet", "c".repeat(56));
    context(&long_sponsor, NOW, REWARD + STORAGE);
    let start = env::storage_usage();
    c.create_task(
        "x".repeat(64),
        "t".repeat(96),
        "d".repeat(512),
        format!("https://{}", "r".repeat(248)),
        "a".repeat(64),
        "l".repeat(80),
        U128(REWARD),
        DUE,
    );
    let task_bytes = env::storage_usage() - start;
    context(&long_claimant, NOW + 1, STORAGE);
    let start_evidence = env::storage_usage();
    c.submit_evidence(
        1,
        "e".repeat(512),
        format!("https://{}", "r".repeat(248)),
        "b".repeat(64),
    );
    context(&long_sponsor, NOW + 2, 0);
    c.review_submission(1, 0, false, "r".repeat(256));
    context(&long_claimant, NOW + 3, 0);
    c.appeal_submission(
        1,
        0,
        "e".repeat(512),
        format!("https://{}", "r".repeat(248)),
        "c".repeat(64),
    );
    context("arbiter.testnet", NOW + 4, 0);
    c.resolve_appeal(1, 0, true, "r".repeat(256));
    context(&long_claimant, NOW + 5, 1);
    let _ = c.withdraw();
    let full_evidence_bytes = env::storage_usage() - start_evidence;
    assert!(task_bytes + 256 < 5000, "task max bytes {task_bytes}");
    assert!(
        full_evidence_bytes + 256 < 5000,
        "evidence max bytes {full_evidence_bytes}"
    );
    assert_eq!(STORAGE / env::storage_byte_cost().as_yoctonear(), 5000);
    println!("Maximum fixture storage: task={task_bytes} bytes, full evidence/settlement/withdrawal={full_evidence_bytes} bytes; each fee backs 5000 bytes");
}
#[test]
fn contract_cannot_initialize_on_mainnet_or_self_arbitrate() {
    context("sponsor.testnet", NOW, 0);
    fails(|| {
        TaskEscrow::new(a("tasks.testnet"));
    });
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("tasks.near"));
    testing_env!(b.build());
    fails(|| {
        TaskEscrow::new(a("arbiter.testnet"));
    });
}
