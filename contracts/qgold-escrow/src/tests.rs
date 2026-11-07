use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const NOW: u64 = 1_800_000_000_000;
const HOUR: u64 = 3_600_000;
const Q: u128 = 1_000_000; // 1 QGOLD in base units for these tests
const ME: &str = "escrow.testnet";
const TOKEN: &str = "qgold.testnet";
const TREASURY: &str = "treasury.testnet";

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx_full(who: &str, time: u64, deposit: u128, gas_tgas: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(ME))
        .predecessor_account_id(a(who))
        .signer_account_id(a(who))
        .block_timestamp(time * 1_000_000)
        .account_balance(NearToken::from_near(100))
        .storage_usage(env::storage_usage())
        .prepaid_gas(Gas::from_tgas(gas_tgas))
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}
fn ctx(who: &str, time: u64) {
    ctx_full(who, time, 0, 300);
}
fn callback(result: PromiseResult) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(ME))
        .predecessor_account_id(a(ME))
        .block_timestamp(NOW * 1_000_000)
        .account_balance(NearToken::from_near(100))
        .storage_usage(env::storage_usage());
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![result],
    );
}
fn fresh() -> QgoldEscrow {
    ctx("owner.testnet", NOW);
    QgoldEscrow::new(
        a("owner.testnet"),
        a(TOKEN),
        a("publisher.testnet"),
        a("moderator.testnet"),
        a("guardian.testnet"),
        a(TREASURY),
    )
}
fn fails<F: FnOnce()>(f: F) -> String {
    let r = catch_unwind(AssertUnwindSafe(f));
    match r {
        Ok(_) => panic!("expected a panic"),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    }
}
fn deposit(c: &mut QgoldEscrow, from: &str, amount: u128, msg: Value) -> U128 {
    ctx(TOKEN, NOW);
    c.ft_on_transfer(a(from), U128(amount), msg.to_string())
}
fn task_msg(id: &str, reward: u128, slots: u32) -> Value {
    json!({"kind":"task","id":id,"reward":U128(reward),"deadline_ms":U64(NOW + 24 * HOUR),"slots":slots})
}
fn fund_task(c: &mut QgoldEscrow, id: &str, reward: u128, slots: u32) {
    assert_eq!(deposit(c, "poster.testnet", reward + fee_of(reward), task_msg(id, reward, slots)).0, 0);
}
fn credit(c: &QgoldEscrow, who: &str) -> u128 {
    c.get_credit(a(who)).0
}
fn assert_conserved(c: &QgoldEscrow) {
    let s = c.get_stats();
    assert!(s.conserved);
    assert_eq!(s.total_held.0, s.escrowed.0 + s.credits.0 + s.pending_withdrawals.0);
}

// ------------------------------------------------------------------ deposits

#[test]
fn fee_math_rounds_up() {
    assert_eq!(fee_of(100 * Q), 10 * Q);
    assert_eq!(fee_of(10), 1);
    assert_eq!(fee_of(11), 2); // 1.1 -> 2
    assert_eq!(fee_of(1), 1);
    assert_eq!(fee_of(19), 2); // 1.9 -> 2
    assert_eq!(fee_of(20), 2);
}

#[test]
fn rejects_wrong_token() {
    let mut c = fresh();
    ctx("fake-token.testnet", NOW);
    let msg = task_msg("t1", 100, 1).to_string();
    let e = fails(|| {
        c.ft_on_transfer(a("poster.testnet"), U128(110), msg);
    });
    assert!(e.contains("Only the configured QGOLD token"), "{e}");
    assert_eq!(c.get_stats().total_held.0, 0);
}

#[test]
fn task_amount_must_be_exact() {
    let mut c = fresh();
    for amount in [100, 109, 111, 1000] {
        let e = fails(|| {
            deposit(&mut c, "poster.testnet", amount, task_msg("t1", 100, 1));
        });
        assert!(e.contains("reward plus the 10% fee"), "{e}");
    }
    // Rounded-up fee: reward 11 -> fee 2 -> 13.
    let e = fails(|| {
        deposit(&mut c, "poster.testnet", 12, task_msg("t2", 11, 1));
    });
    assert!(e.contains("reward plus"), "{e}");
    assert_eq!(deposit(&mut c, "poster.testnet", 13, task_msg("t2", 11, 1)).0, 0);
    assert_eq!(c.get_task("t2".into()).unwrap().fee.0, 2);
    assert_conserved(&c);
}

#[test]
fn rejects_bad_task_messages() {
    let mut c = fresh();
    let bad = [
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW + HOUR),"slots":0}), "Slots"),
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW + HOUR),"slots":51}), "Slots"),
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW + HOUR),"slots":3}), "divisible"),
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW - 1)}), "future"),
        (json!({"kind":"task","id":"x".repeat(65),"reward":"100","deadline_ms":U64(NOW + HOUR)}), "id must"),
        (json!({"kind":"task","id":"bad id","reward":"100","deadline_ms":U64(NOW + HOUR)}), "id must"),
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW + HOUR),"extra":1}), "Invalid task msg"),
        (json!({"kind":"task","id":"t","reward":"100","deadline_ms":U64(NOW + HOUR),"assignee":"w.testnet","slots":2}), "exactly one slot"),
        (json!({"kind":"lottery","id":"t"}), "Unknown msg.kind"),
    ];
    for (msg, want) in bad {
        let e = fails(|| {
            deposit(&mut c, "poster.testnet", 110, msg);
        });
        assert!(e.contains(want), "{want}: {e}");
    }
    let e = fails(|| {
        ctx(TOKEN, NOW);
        c.ft_on_transfer(a("poster.testnet"), U128(110), "not json".into());
    });
    assert!(e.contains("Invalid msg JSON"), "{e}");
    assert_eq!(c.get_stats().task_count, 0);
}

#[test]
fn id_reuse_rejected_forever() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 1);
    ctx("poster.testnet", NOW);
    c.cancel_task("t1".into());
    let e = fails(|| fund_task(&mut c, "t1", 100, 1));
    assert!(e.contains("already used"), "{e}");
    let s = json!({"kind":"secret","id":"p1","secret_id":"s1","creator":"creator.testnet","price":"100"});
    deposit(&mut c, "buyer.testnet", 100, s.clone());
    let e = fails(|| {
        deposit(&mut c, "buyer.testnet", 100, s);
    });
    assert!(e.contains("already used"), "{e}");
    let t = json!({"kind":"transfer","id":"x1","to":"bob.testnet","condition":{"type":"both_confirm"},"expires_ms":U64(NOW + HOUR)});
    deposit(&mut c, "alice.testnet", 5, t.clone());
    let e = fails(|| {
        deposit(&mut c, "alice.testnet", 5, t);
    });
    assert!(e.contains("already used"), "{e}");
}

#[test]
fn open_escrows_per_account_are_bounded() {
    let mut c = fresh();
    for i in 0..MAX_OPEN_PER_ACCOUNT {
        fund_task(&mut c, &format!("t{i}"), 10, 1);
    }
    let e = fails(|| fund_task(&mut c, "one-more", 10, 1));
    assert!(e.contains("Too many open escrows"), "{e}");
    ctx("poster.testnet", NOW);
    c.cancel_task("t0".into());
    fund_task(&mut c, "one-more", 10, 1);
    assert_eq!(c.get_open_count(a("poster.testnet")), MAX_OPEN_PER_ACCOUNT);
}

// --------------------------------------------------------------------- tasks

#[test]
fn approve_pays_worker_and_fee_to_treasury() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100 * Q, 1);
    assert_eq!(c.get_stats().total_held.0, 110 * Q);
    ctx("publisher.testnet", NOW);
    let v = c.approve_task("t1".into(), a("worker.testnet"));
    assert_eq!(v.status, "paid");
    assert_eq!(credit(&c, "worker.testnet"), 100 * Q);
    assert_eq!(credit(&c, TREASURY), 10 * Q);
    assert_eq!(credit(&c, "poster.testnet"), 0);
    assert_eq!(c.get_stats().fees_collected.0, 10 * Q);
    assert_eq!(c.get_stats().open_escrows, 0);
    assert!(get_logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("\"event\":\"paid\"")
        && l.contains("\"standard\":\"questlayer-escrow\"")));
    assert_conserved(&c);
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a("worker2.testnet"));
    });
    assert!(e.contains("No open slot"), "{e}");
}

#[test]
fn poster_can_approve_but_others_cannot() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 2);
    for who in ["worker.testnet", "moderator.testnet", "owner.testnet", "guardian.testnet"] {
        let e = fails(|| {
            ctx(who, NOW);
            c.approve_task("t1".into(), a("worker.testnet"));
        });
        assert!(e.contains("Only the publisher or the poster"), "{who}: {e}");
    }
    ctx("poster.testnet", NOW);
    c.approve_task("t1".into(), a("worker.testnet"));
    assert_eq!(credit(&c, "worker.testnet"), 50);
    let e = fails(|| {
        ctx("poster.testnet", NOW);
        c.approve_task("t1".into(), a("poster.testnet"));
    });
    assert!(e.contains("poster cannot be the worker"), "{e}");
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a("worker.testnet"));
    });
    assert!(e.contains("already paid"), "{e}");
}

#[test]
fn slots_split_reward_and_last_slot_takes_fee_remainder() {
    let mut c = fresh();
    // reward 33, 3 slots -> 11 each; fee ceil(3.3) = 4 -> 1, 1, then the last slot takes 2.
    fund_task(&mut c, "t1", 33, 3);
    assert_eq!(c.get_task("t1".into()).unwrap().fee.0, 4);
    for (i, w) in ["w1.testnet", "w2.testnet", "w3.testnet"].iter().enumerate() {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a(w));
        assert_eq!(credit(&c, w), 11);
        assert_eq!(credit(&c, TREASURY), [1, 2, 4][i]);
    }
    let v = c.get_task("t1".into()).unwrap();
    assert_eq!((v.paid_slots, v.open_slots, v.held.0, v.status.as_str()), (3, 0, 0, "paid"));
    assert_conserved(&c);
}

#[test]
fn named_user_task_only_pays_assignee() {
    let mut c = fresh();
    let msg = json!({"kind":"task","id":"n1","reward":"100","assignee":"named.testnet","deadline_ms":U64(NOW + HOUR)});
    deposit(&mut c, "poster.testnet", 110, msg);
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.approve_task("n1".into(), a("other.testnet"));
    });
    assert!(e.contains("assigned to another"), "{e}");
    ctx("publisher.testnet", NOW);
    c.approve_task("n1".into(), a("named.testnet"));
    assert_eq!(credit(&c, "named.testnet"), 100);
}

#[test]
fn cancel_refunds_reward_and_fee_for_unpaid_slots() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 4); // fee 10 -> 2,2,2,4
    ctx("publisher.testnet", NOW);
    c.approve_task("t1".into(), a("w1.testnet"));
    let e = fails(|| {
        ctx("stranger.testnet", NOW);
        c.cancel_task("t1".into());
    });
    assert!(e.contains("Only the poster or the publisher"), "{e}");
    ctx("poster.testnet", NOW);
    let v = c.cancel_task("t1".into());
    assert_eq!((v.paid_slots, v.refunded_slots, v.status.as_str()), (1, 3, "settled"));
    assert_eq!(credit(&c, "w1.testnet"), 25);
    assert_eq!(credit(&c, TREASURY), 2);
    assert_eq!(credit(&c, "poster.testnet"), 75 + 8);
    assert_eq!(c.get_stats().escrowed.0, 0);
    assert_conserved(&c);
    let e = fails(|| {
        ctx("poster.testnet", NOW);
        c.cancel_task("t1".into());
    });
    assert!(e.contains("closed"), "{e}");
}

#[test]
fn full_cancel_returns_everything_and_no_fee() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100 * Q, 1);
    ctx("poster.testnet", NOW);
    assert_eq!(c.cancel_task("t1".into()).status, "refunded");
    assert_eq!(credit(&c, "poster.testnet"), 110 * Q);
    assert_eq!(credit(&c, TREASURY), 0);
    assert_eq!(c.get_stats().fees_collected.0, 0);
}

#[test]
fn dispute_blocks_cancel_and_reserves_slot_on_expiry() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 2); // fee 10 -> 5,5
    let e = fails(|| {
        ctx("stranger.testnet", NOW);
        c.open_dispute("t1".into(), a("w1.testnet"));
    });
    assert!(e.contains("Only the worker, the poster or the publisher"), "{e}");
    ctx("publisher.testnet", NOW);
    assert_eq!(c.open_dispute("t1".into(), a("w1.testnet")).status, "disputed");
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.open_dispute("t1".into(), a("w1.testnet"));
    });
    assert!(e.contains("already open"), "{e}");
    let e = fails(|| {
        ctx("poster.testnet", NOW);
        c.cancel_task("t1".into());
    });
    assert!(e.contains("dispute is open"), "{e}");
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a("w1.testnet"));
    });
    assert!(e.contains("open dispute"), "{e}");
    // Expiry before the deadline is rejected.
    let e = fails(|| {
        ctx("anyone.testnet", NOW + HOUR);
        c.expire_task("t1".into());
    });
    assert!(e.contains("deadline not reached"), "{e}");
    // After the deadline only the undisputed slot is refunded.
    ctx("anyone.testnet", NOW + 25 * HOUR);
    let v = c.expire_task("t1".into());
    assert_eq!((v.refunded_slots, v.open_slots, v.open_disputes.len()), (1, 1, 1));
    assert_eq!(credit(&c, "poster.testnet"), 55);
    let e = fails(|| {
        ctx("anyone.testnet", NOW + 25 * HOUR);
        c.expire_task("t1".into());
    });
    assert!(e.contains("No unreserved slot"), "{e}");
    // Moderator pays the reserved slot.
    let e = fails(|| {
        ctx("publisher.testnet", NOW + 26 * HOUR);
        c.resolve_dispute("t1".into(), a("w1.testnet"), true);
    });
    assert!(e.contains("Only the moderator"), "{e}");
    ctx("moderator.testnet", NOW + 26 * HOUR);
    let v = c.resolve_dispute("t1".into(), a("w1.testnet"), true);
    assert_eq!(v.status, "settled");
    assert_eq!(credit(&c, "w1.testnet"), 50);
    assert_eq!(credit(&c, TREASURY), 5);
    assert_eq!(c.get_stats().open_escrows, 0);
    assert_conserved(&c);
}

#[test]
fn rejected_dispute_frees_slot_or_refunds_after_deadline() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 1);
    ctx("poster.testnet", NOW);
    c.open_dispute("t1".into(), a("w1.testnet"));
    ctx("moderator.testnet", NOW);
    let v = c.resolve_dispute("t1".into(), a("w1.testnet"), false);
    assert_eq!((v.open_slots, v.status.as_str()), (1, "open"));
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.open_dispute("t1".into(), a("w1.testnet"));
    });
    assert!(e.contains("already resolved"), "{e}");
    // A second worker disputes; rejected after the deadline -> poster refunded at once.
    ctx("publisher.testnet", NOW);
    c.open_dispute("t1".into(), a("w2.testnet"));
    ctx("moderator.testnet", NOW + 25 * HOUR);
    let v = c.resolve_dispute("t1".into(), a("w2.testnet"), false);
    assert_eq!(v.status, "refunded");
    assert_eq!(credit(&c, "poster.testnet"), 110);
    assert_eq!(credit(&c, "w1.testnet") + credit(&c, "w2.testnet"), 0);
    assert_conserved(&c);
}

#[test]
fn expiry_refunds_all_unused_slots() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 90, 3); // fee 9 -> 3,3,3
    ctx("publisher.testnet", NOW);
    c.approve_task("t1".into(), a("w1.testnet"));
    ctx("anyone.testnet", NOW + 24 * HOUR);
    let v = c.expire_task("t1".into());
    assert_eq!((v.paid_slots, v.refunded_slots), (1, 2));
    assert_eq!(credit(&c, "poster.testnet"), 66);
    assert_eq!(credit(&c, "w1.testnet"), 30);
    assert_eq!(credit(&c, TREASURY), 3);
    assert_eq!(c.get_stats().escrowed.0, 0);
    assert_conserved(&c);
}

// ------------------------------------------------------------------- secrets

fn secret_msg(id: &str, price: u128) -> Value {
    json!({"kind":"secret","id":id,"secret_id":"route-42","creator":"creator.testnet","price":U128(price)})
}

#[test]
fn secret_amount_must_equal_price() {
    let mut c = fresh();
    for amount in [99, 101, 110] {
        let e = fails(|| {
            deposit(&mut c, "buyer.testnet", amount, secret_msg("p1", 100));
        });
        assert!(e.contains("equal the price"), "{e}");
    }
    let e = fails(|| {
        deposit(&mut c, "creator.testnet", 100, secret_msg("p1", 100));
    });
    assert!(e.contains("own Secret"), "{e}");
}

#[test]
fn secret_visit_pays_creator_90_treasury_10() {
    let mut c = fresh();
    deposit(&mut c, "buyer.testnet", 100 * Q, secret_msg("p1", 100 * Q));
    let e = fails(|| {
        ctx("buyer.testnet", NOW);
        c.confirm_visit("p1".into());
    });
    assert!(e.contains("Only the publisher"), "{e}");
    ctx("publisher.testnet", NOW + HOUR);
    assert_eq!(c.confirm_visit("p1".into()).status, "released");
    assert_eq!(credit(&c, "creator.testnet"), 90 * Q);
    assert_eq!(credit(&c, TREASURY), 10 * Q);
    assert_eq!(credit(&c, "buyer.testnet"), 0);
    assert_conserved(&c);
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.confirm_visit("p1".into());
    });
    assert!(e.contains("not held"), "{e}");
}

#[test]
fn secret_rounding_favours_treasury_by_at_most_one_unit() {
    let mut c = fresh();
    deposit(&mut c, "buyer.testnet", 15, secret_msg("p1", 15));
    ctx("publisher.testnet", NOW);
    let v = c.confirm_visit("p1".into());
    assert_eq!((v.creator_share.0, v.fee.0), (13, 2));
    assert_eq!(credit(&c, "creator.testnet") + credit(&c, TREASURY), 15);
}

#[test]
fn secret_auto_release_after_seven_days() {
    let mut c = fresh();
    deposit(&mut c, "buyer.testnet", 1000, secret_msg("p1", 1000));
    let e = fails(|| {
        ctx("anyone.testnet", NOW + SECRET_HOLD_MS - 1);
        c.release_secret("p1".into());
    });
    assert!(e.contains("Hold period"), "{e}");
    ctx("anyone.testnet", NOW + SECRET_HOLD_MS);
    c.release_secret("p1".into());
    assert_eq!(credit(&c, "creator.testnet"), 900);
    assert_eq!(credit(&c, TREASURY), 100);
    let e = fails(|| {
        ctx("buyer.testnet", NOW + SECRET_HOLD_MS);
        c.dispute_secret("p1".into());
    });
    assert!(e.contains("not held"), "{e}");
}

#[test]
fn secret_dispute_refund_and_rejection() {
    let mut c = fresh();
    deposit(&mut c, "buyer.testnet", 1000, secret_msg("p1", 1000));
    deposit(&mut c, "buyer.testnet", 500, secret_msg("p2", 500));
    let e = fails(|| {
        ctx("creator.testnet", NOW);
        c.dispute_secret("p1".into());
    });
    assert!(e.contains("Only the buyer"), "{e}");
    ctx("buyer.testnet", NOW + DAY_MS);
    assert_eq!(c.dispute_secret("p1".into()).status, "disputed");
    // Disputed purchases neither auto-release nor accept a visit confirmation.
    let e = fails(|| {
        ctx("anyone.testnet", NOW + 30 * DAY_MS);
        c.release_secret("p1".into());
    });
    assert!(e.contains("not held"), "{e}");
    let e = fails(|| {
        ctx("publisher.testnet", NOW + 2 * DAY_MS);
        c.confirm_visit("p1".into());
    });
    assert!(e.contains("not held"), "{e}");
    let e = fails(|| {
        ctx("publisher.testnet", NOW + 2 * DAY_MS);
        c.resolve_secret("p1".into(), true);
    });
    assert!(e.contains("Only the moderator"), "{e}");
    ctx("moderator.testnet", NOW + 2 * DAY_MS);
    assert_eq!(c.resolve_secret("p1".into(), true).status, "refunded");
    assert_eq!(credit(&c, "buyer.testnet"), 1000);
    assert_eq!(credit(&c, "creator.testnet"), 0);
    assert_eq!(credit(&c, TREASURY), 0);
    // Dispute window closes after 7 days.
    let e = fails(|| {
        ctx("buyer.testnet", NOW + SECRET_HOLD_MS);
        c.dispute_secret("p2".into());
    });
    assert!(e.contains("window has closed"), "{e}");
    ctx("buyer.testnet", NOW + SECRET_HOLD_MS - 1);
    c.dispute_secret("p2".into());
    ctx("moderator.testnet", NOW + SECRET_HOLD_MS);
    assert_eq!(c.resolve_secret("p2".into(), false).status, "released");
    assert_eq!(credit(&c, "creator.testnet"), 450);
    assert_eq!(credit(&c, TREASURY), 50);
    assert_conserved(&c);
}

// ----------------------------------------------------------------- transfers

fn transfer_msg(id: &str, condition: Value) -> Value {
    json!({"kind":"transfer","id":id,"to":"bob.testnet","condition":condition,"expires_ms":U64(NOW + 10 * HOUR)})
}

#[test]
fn transfer_both_confirm_has_no_fee() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 777, transfer_msg("x1", json!({"type":"both_confirm"})));
    ctx("alice.testnet", NOW);
    let v = c.confirm_transfer("x1".into());
    assert_eq!((v.sender_confirmed, v.receiver_confirmed, v.status.as_str()), (true, false, "held"));
    let e = fails(|| {
        ctx("carol.testnet", NOW);
        c.confirm_transfer("x1".into());
    });
    assert!(e.contains("Only the sender or the receiver"), "{e}");
    let e = fails(|| {
        ctx("anyone.testnet", NOW);
        c.release_transfer("x1".into());
    });
    assert!(e.contains("Not a time-locked"), "{e}");
    ctx("bob.testnet", NOW + HOUR);
    assert_eq!(c.confirm_transfer("x1".into()).status, "released");
    assert_eq!(credit(&c, "bob.testnet"), 777);
    assert_eq!(credit(&c, TREASURY), 0);
    assert_eq!(c.get_stats().fees_collected.0, 0);
    assert_conserved(&c);
}

#[test]
fn transfer_after_time() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 50, transfer_msg("x1", json!({"type":"after","at_ms":U64(NOW + 2 * HOUR)})));
    let e = fails(|| {
        ctx("bob.testnet", NOW + 2 * HOUR - 1);
        c.release_transfer("x1".into());
    });
    assert!(e.contains("Release time not reached"), "{e}");
    ctx("stranger.testnet", NOW + 2 * HOUR);
    assert_eq!(c.release_transfer("x1".into()).status, "released");
    assert_eq!(credit(&c, "bob.testnet"), 50);
    let e = fails(|| {
        deposit(&mut c, "alice.testnet", 50, transfer_msg("x2", json!({"type":"after","at_ms":U64(NOW + 10 * HOUR)})));
    });
    assert!(e.contains("before expires_ms"), "{e}");
}

#[test]
fn transfer_gps_confirmed_by_publisher_only() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 40, transfer_msg("x1", json!({"type":"gps","place_id":"place-7","radius_m":50})));
    for who in ["bob.testnet", "alice.testnet", "moderator.testnet"] {
        let e = fails(|| {
            ctx(who, NOW);
            c.confirm_transfer_gps("x1".into());
        });
        assert!(e.contains("Only the publisher"), "{who}: {e}");
    }
    let e = fails(|| {
        ctx("bob.testnet", NOW);
        c.confirm_transfer("x1".into());
    });
    assert!(e.contains("Not a both_confirm"), "{e}");
    let e = fails(|| {
        ctx("publisher.testnet", NOW + 10 * HOUR);
        c.confirm_transfer_gps("x1".into());
    });
    assert!(e.contains("expired"), "{e}");
    ctx("publisher.testnet", NOW + HOUR);
    let v = c.confirm_transfer_gps("x1".into());
    assert_eq!(v.status, "released");
    assert_eq!(v.condition, Condition::Gps { place_id: "place-7".into(), radius_m: 50 });
    assert_eq!(credit(&c, "bob.testnet"), 40);
    let e = fails(|| {
        deposit(&mut c, "alice.testnet", 40, transfer_msg("x2", json!({"type":"gps","place_id":"p","radius_m":0})));
    });
    assert!(e.contains("radius_m"), "{e}");
}

#[test]
fn transfer_refund_only_after_expiry() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 60, transfer_msg("x1", json!({"type":"both_confirm"})));
    ctx("bob.testnet", NOW);
    c.confirm_transfer("x1".into());
    let e = fails(|| {
        ctx("alice.testnet", NOW + 10 * HOUR - 1);
        c.refund_transfer("x1".into());
    });
    assert!(e.contains("has not expired"), "{e}");
    let e = fails(|| {
        ctx("alice.testnet", NOW + 10 * HOUR);
        c.confirm_transfer("x1".into());
    });
    assert!(e.contains("expired"), "{e}");
    let e = fails(|| {
        ctx("bob.testnet", NOW + 10 * HOUR);
        c.refund_transfer("x1".into());
    });
    assert!(e.contains("Only the sender"), "{e}");
    ctx("alice.testnet", NOW + 10 * HOUR);
    assert_eq!(c.refund_transfer("x1".into()).status, "refunded");
    assert_eq!(credit(&c, "alice.testnet"), 60);
    assert_eq!(credit(&c, "bob.testnet"), 0);
    assert_conserved(&c);
}

#[test]
fn transfer_decline_refunds_sender() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 60, transfer_msg("x1", json!({"type":"after","at_ms":U64(NOW)})));
    let e = fails(|| {
        ctx("alice.testnet", NOW);
        c.decline_transfer("x1".into());
    });
    assert!(e.contains("Only the receiver"), "{e}");
    ctx("bob.testnet", NOW);
    assert_eq!(c.decline_transfer("x1".into()).status, "refunded");
    assert_eq!(credit(&c, "alice.testnet"), 60);
    let e = fails(|| {
        ctx("anyone.testnet", NOW + HOUR);
        c.release_transfer("x1".into());
    });
    assert!(e.contains("not held"), "{e}");
    let e = fails(|| {
        deposit(&mut c, "bob.testnet", 1, transfer_msg("x2", json!({"type":"both_confirm"})));
    });
    assert!(e.contains("yourself"), "{e}");
}

// ---------------------------------------------------------- pause and admin

#[test]
fn pause_refunds_deposits_and_blocks_everything() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 1);
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.pause();
    });
    assert!(e.contains("guardian or the owner"), "{e}");
    ctx("guardian.testnet", NOW);
    c.pause();
    assert!(c.get_config().paused);
    // A paused deposit is returned in full by the token (unused amount = all).
    assert_eq!(deposit(&mut c, "poster.testnet", 110, task_msg("t2", 100, 1)).0, 110);
    assert!(c.get_task("t2".into()).is_none());
    assert_eq!(c.get_stats().total_held.0, 110);
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a("w.testnet"));
    });
    assert!(e.contains("paused"), "{e}");
    let e = fails(|| {
        ctx("poster.testnet", NOW);
        c.cancel_task("t1".into());
    });
    assert!(e.contains("paused"), "{e}");
    let e = fails(|| {
        ctx_full("poster.testnet", NOW, 1, 300);
        let _ = c.withdraw();
    });
    assert!(e.contains("paused"), "{e}");
    let e = fails(|| {
        ctx("guardian.testnet", NOW);
        c.unpause();
    });
    assert!(e.contains("Only the owner"), "{e}");
    ctx("owner.testnet", NOW);
    c.unpause();
    ctx("publisher.testnet", NOW);
    c.approve_task("t1".into(), a("w.testnet"));
    assert_eq!(credit(&c, "w.testnet"), 100);
}

#[test]
fn only_owner_changes_roles() {
    let mut c = fresh();
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.set_publisher(a("evil.testnet"));
    });
    assert!(e.contains("Only the owner"), "{e}");
    let e = fails(|| {
        ctx("guardian.testnet", NOW);
        c.set_treasury(a("evil.testnet"));
    });
    assert!(e.contains("Only the owner"), "{e}");
    ctx("owner.testnet", NOW);
    c.set_publisher(a("pub2.testnet"));
    c.set_moderator(a("mod2.testnet"));
    c.set_guardian(a("guard2.testnet"));
    c.set_treasury(a("treasury2.testnet"));
    let cfg = c.get_config();
    assert_eq!(
        (cfg.publisher_id, cfg.moderator_id, cfg.guardian_id, cfg.treasury_id),
        (a("pub2.testnet"), a("mod2.testnet"), a("guard2.testnet"), a("treasury2.testnet"))
    );
    let e = fails(|| {
        ctx("owner.testnet", NOW);
        c.set_treasury(a(TOKEN));
    });
    assert!(e.contains("Treasury cannot be the token"), "{e}");
}

// ------------------------------------------------------------------ withdraw

#[test]
fn withdraw_requires_one_yocto_gas_and_credit() {
    let mut c = fresh();
    let e = fails(|| {
        ctx_full("nobody.testnet", NOW, 1, 300);
        let _ = c.withdraw();
    });
    assert!(e.contains("No credit"), "{e}");
    let e = fails(|| {
        ctx_full("nobody.testnet", NOW, 0, 300);
        let _ = c.withdraw();
    });
    assert!(e.contains("1 yoctoNEAR"), "{e}");
    let e = fails(|| {
        ctx_full("nobody.testnet", NOW, 1, 30);
        let _ = c.withdraw();
    });
    assert!(e.contains("50 Tgas"), "{e}");
}

#[test]
fn withdraw_success_reduces_total_held() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 1);
    ctx("publisher.testnet", NOW);
    c.approve_task("t1".into(), a("w.testnet"));
    ctx_full("w.testnet", NOW, 1, 300);
    let _ = c.withdraw();
    assert_eq!(credit(&c, "w.testnet"), 0);
    assert_eq!(c.get_stats().pending_withdrawals.0, 100);
    assert_conserved(&c);
    callback(PromiseResult::Successful(vec![]));
    assert_eq!(c.on_withdraw(a("w.testnet"), U128(100)).0, 100);
    let s = c.get_stats();
    assert_eq!((s.total_held.0, s.withdrawn.0, s.pending_withdrawals.0, s.credits.0), (10, 100, 0, 10));
    assert_conserved(&c);
    // The treasury withdraws its own fee credit; nobody else can touch it.
    let e = fails(|| {
        ctx_full("w.testnet", NOW, 1, 300);
        let _ = c.withdraw();
    });
    assert!(e.contains("No credit"), "{e}");
    ctx_full(TREASURY, NOW, 1, 300);
    let _ = c.withdraw();
    callback(PromiseResult::Successful(vec![]));
    c.on_withdraw(a(TREASURY), U128(10));
    assert_eq!(c.get_stats().total_held.0, 0);
    assert_conserved(&c);
}

#[test]
fn withdraw_failure_restores_credit() {
    let mut c = fresh();
    deposit(&mut c, "alice.testnet", 500, transfer_msg("x1", json!({"type":"after","at_ms":U64(NOW)})));
    ctx("bob.testnet", NOW);
    c.release_transfer("x1".into());
    ctx_full("bob.testnet", NOW, 1, 300);
    let _ = c.withdraw();
    assert_eq!(credit(&c, "bob.testnet"), 0);
    // Payout keeps working while the withdrawal is in flight: new credit adds up.
    callback(PromiseResult::Failed);
    assert_eq!(c.on_withdraw(a("bob.testnet"), U128(500)).0, 0);
    assert_eq!(credit(&c, "bob.testnet"), 500);
    let s = c.get_stats();
    assert_eq!((s.total_held.0, s.withdrawn.0, s.pending_withdrawals.0), (500, 0, 0));
    assert!(get_logs().iter().any(|l| l.contains("withdraw_failed")));
    assert_conserved(&c);
    // Callback runs even while paused.
    ctx("guardian.testnet", NOW);
    c.pause();
    ctx("owner.testnet", NOW);
    c.unpause();
    ctx_full("bob.testnet", NOW, 1, 300);
    let _ = c.withdraw();
    ctx("guardian.testnet", NOW);
    c.pause();
    callback(PromiseResult::Failed);
    c.on_withdraw(a("bob.testnet"), U128(500));
    assert_eq!(credit(&c, "bob.testnet"), 500);
    assert_conserved(&c);
}

#[test]
fn on_withdraw_is_private() {
    let mut c = fresh();
    let e = fails(|| {
        ctx("bob.testnet", NOW);
        c.on_withdraw(a("bob.testnet"), U128(1));
    });
    assert!(e.contains("private"), "{e}");
}

#[test]
fn invariant_holds_across_mixed_flows() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 1000, 10);
    fund_task(&mut c, "t2", 7, 7);
    deposit(&mut c, "buyer.testnet", 333, secret_msg("p1", 333));
    deposit(&mut c, "alice.testnet", 12, transfer_msg("x1", json!({"type":"both_confirm"})));
    let total = 1100 + 7 + 1 + 333 + 12;
    assert_eq!(c.get_stats().total_held.0, total);
    assert_eq!(c.get_stats().escrowed.0, total);
    for i in 0..4 {
        ctx("publisher.testnet", NOW);
        c.approve_task("t1".into(), a(&format!("w{i}.testnet")));
        assert_conserved(&c);
    }
    ctx("publisher.testnet", NOW);
    c.open_dispute("t1".into(), a("w9.testnet"));
    ctx("publisher.testnet", NOW);
    c.approve_task("t2".into(), a("w0.testnet"));
    ctx("poster.testnet", NOW);
    c.cancel_task("t2".into());
    ctx("anyone.testnet", NOW + 25 * HOUR);
    c.expire_task("t1".into());
    ctx("moderator.testnet", NOW + 25 * HOUR);
    c.resolve_dispute("t1".into(), a("w9.testnet"), true);
    ctx("anyone.testnet", NOW + SECRET_HOLD_MS);
    c.release_secret("p1".into());
    ctx("bob.testnet", NOW);
    c.decline_transfer("x1".into());
    let s = c.get_stats();
    assert_eq!(s.escrowed.0, 0);
    assert_eq!(s.open_escrows, 0);
    assert_eq!(s.credits.0, total);
    let sum: u128 = ["poster.testnet", "buyer.testnet", "alice.testnet", "creator.testnet", TREASURY]
        .iter()
        .map(|w| credit(&c, w))
        .sum::<u128>()
        + (0..10).map(|i| credit(&c, &format!("w{i}.testnet"))).sum::<u128>();
    assert_eq!(sum, total);
    // Fees: t1 5 paid slots of 1000/10 each, fee 100 -> 10 per slot = 50; t2 fee 1 on its
    // single paid slot (fee 1 / 7 slots = 0, so 0); secret fee ceil(33.3) = 34.
    assert_eq!(s.fees_collected.0, 50 + 34);
    assert_eq!(credit(&c, "creator.testnet"), 299);
    assert_conserved(&c);
}

// ------------------------------------------------- game server (publisher) acts

#[test]
fn publisher_cancels_task_refunding_only_the_poster() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 2);
    ctx("publisher.testnet", NOW);
    c.open_dispute("t1".into(), a("w1.testnet"));
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.cancel_task("t1".into());
    });
    assert!(e.contains("A dispute is open"), "{e}");
    ctx("moderator.testnet", NOW);
    c.resolve_dispute("t1".into(), a("w1.testnet"), true);
    ctx("publisher.testnet", NOW);
    let v = c.cancel_task("t1".into());
    assert_eq!((v.paid_slots, v.refunded_slots), (1, 1));
    assert_eq!(credit(&c, "w1.testnet"), 50);
    assert_eq!(credit(&c, "poster.testnet"), 55);
    assert_eq!(credit(&c, "publisher.testnet"), 0);
    assert_conserved(&c);
}

#[test]
fn publisher_disputes_secret_and_settles_transfers_for_players() {
    let mut c = fresh();
    deposit(&mut c, "buyer.testnet", 100, secret_msg("p1", 100));
    ctx("publisher.testnet", NOW);
    assert_eq!(c.dispute_secret("p1".into()).status, "disputed");
    let e = fails(|| {
        ctx("stranger.testnet", NOW);
        c.dispute_secret("p1".into());
    });
    assert!(e.contains("Only the buyer or the publisher"), "{e}");

    deposit(&mut c, "alice.testnet", 300, transfer_msg("x1", json!({"type":"both_confirm"})));
    ctx("publisher.testnet", NOW);
    assert_eq!(c.confirm_transfer("x1".into()).status, "released");
    assert_eq!(credit(&c, "bob.testnet"), 300);

    deposit(&mut c, "alice.testnet", 40, transfer_msg("x2", json!({"type":"both_confirm"})));
    ctx("publisher.testnet", NOW);
    assert_eq!(c.decline_transfer("x2".into()).status, "refunded");
    assert_eq!(credit(&c, "alice.testnet"), 40);

    deposit(&mut c, "alice.testnet", 60, transfer_msg("x3", json!({"type":"both_confirm"})));
    let e = fails(|| {
        ctx("publisher.testnet", NOW);
        c.refund_transfer("x3".into());
    });
    assert!(e.contains("not expired"), "{e}");
    ctx("publisher.testnet", NOW + 10 * HOUR);
    assert_eq!(c.refund_transfer("x3".into()).status, "refunded");
    assert_eq!(credit(&c, "alice.testnet"), 100);
    assert_eq!(credit(&c, "publisher.testnet"), 0);
    assert_conserved(&c);
}

#[test]
fn withdraw_for_pays_only_the_credit_owner() {
    let mut c = fresh();
    fund_task(&mut c, "t1", 100, 1);
    ctx("publisher.testnet", NOW);
    c.approve_task("t1".into(), a("w.testnet"));
    let e = fails(|| {
        ctx_full("anyone.testnet", NOW, 0, 300);
        let _ = c.withdraw_for(a("nobody.testnet"));
    });
    assert!(e.contains("No credit"), "{e}");
    let e = fails(|| {
        ctx_full("anyone.testnet", NOW, 0, 50);
        let _ = c.withdraw_for(a("w.testnet"));
    });
    assert!(e.contains("60 Tgas"), "{e}");
    ctx_full("anyone.testnet", NOW, 0, 300);
    let _ = c.withdraw_for(a("w.testnet"));
    assert_eq!(credit(&c, "w.testnet"), 0);
    assert_eq!(credit(&c, "anyone.testnet"), 0);
    assert_eq!(c.get_stats().pending_withdrawals.0, 100);
    assert_conserved(&c);
    callback(PromiseResult::Failed);
    assert_eq!(c.on_withdraw(a("w.testnet"), U128(100)).0, 0);
    assert_eq!(credit(&c, "w.testnet"), 100);
    assert_conserved(&c);
    ctx_full("anyone.testnet", NOW, 0, 300);
    let _ = c.withdraw_for(a("w.testnet"));
    callback(PromiseResult::Successful(vec![]));
    assert_eq!(c.on_withdraw(a("w.testnet"), U128(100)).0, 100);
    assert_eq!(c.get_stats().withdrawn.0, 100);
    assert_conserved(&c);
}

#[test]
fn unassigned_worker_cannot_reserve_a_strangers_slot_but_verified_appeals_survive_delay() {
    let mut c = fresh();
    fund_task(&mut c, "public", 100, 2);
    let e = fails(|| {
        ctx("unrelated.testnet", NOW);
        c.open_dispute("public".into(), a("unrelated.testnet"));
    });
    assert!(e.contains("participation must be verified"), "{e}");
    assert_eq!(c.get_task("public".into()).unwrap().open_disputes.len(), 0);
    // The game authenticated a timely submission; publisher retries can arrive
    // after the task deadline without deleting that worker's appeal.
    ctx("publisher.testnet", NOW + 25 * HOUR);
    c.open_dispute("public".into(), a("verified.testnet"));
    ctx("anyone.testnet", NOW + 26 * HOUR);
    c.expire_task("public".into());
    ctx("moderator.testnet", NOW + 30 * DAY_MS);
    c.resolve_dispute("public".into(), a("verified.testnet"), true);
    assert_eq!(credit(&c, "verified.testnet"), 50);
    assert_conserved(&c);
}

#[test]
fn named_worker_has_a_direct_timely_appeal_but_not_an_unbounded_opening_window() {
    let mut c = fresh();
    for id in ["timely", "late"] {
        deposit(&mut c, "poster.testnet", 110, json!({"kind":"task","id":id,"reward":"100","slots":1,
            "assignee":"named.testnet","deadline_ms":U64(NOW + HOUR)}));
    }
    ctx("named.testnet", NOW);
    c.open_dispute("timely".into(), a("named.testnet"));
    let e = fails(|| {
        ctx("named.testnet", NOW + HOUR);
        c.open_dispute("late".into(), a("named.testnet"));
    });
    assert!(e.contains("before the deadline"), "{e}");
    ctx("publisher.testnet", NOW + HOUR);
    c.open_dispute("late".into(), a("named.testnet"));
}

#[test]
fn admission_reserves_the_maximum_bounded_settlement_growth() {
    let mut c = fresh();
    fund_task(&mut c, "capacity", 5000, MAX_SLOTS);
    let before = env::storage_usage();
    for i in 0..MAX_DISPUTES {
        let worker = a(&format!("w{i:03}{}", "a".repeat(60)));
        ctx("publisher.testnet", NOW);
        c.open_dispute("capacity".into(), worker.clone());
        ctx("moderator.testnet", NOW);
        c.resolve_dispute("capacity".into(), worker, false);
    }
    for i in 0..MAX_SLOTS {
        ctx("publisher.testnet", NOW);
        c.approve_task("capacity".into(), a(&format!("p{i:03}{}", "a".repeat(60))));
    }
    assert!(env::storage_usage() - before < STORAGE_GROWTH_PER_OPEN);
    assert_conserved(&c);
}

#[test]
fn exhausted_native_reserve_cannot_consume_existing_withdrawal_credit() {
    let mut c = fresh(); fund_task(&mut c, "existing", 100, 1);
    ctx("publisher.testnet", NOW); c.approve_task("existing".into(), a("worker.testnet"));
    let before = credit(&c, "worker.testnet");
    let mut b = VMContextBuilder::new();
    b.current_account_id(a(ME)).predecessor_account_id(a("caller.testnet"))
        .account_balance(NearToken::from_yoctonear(0)).storage_usage(env::storage_usage()).prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
    assert!(fails(|| { c.withdraw_for(a("worker.testnet")); }).contains("storage reserve"));
    assert_eq!(credit(&c, "worker.testnet"), before);
    assert_eq!(c.get_stats().pending_withdrawals.0, 0);
}
