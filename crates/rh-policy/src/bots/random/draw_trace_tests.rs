//! Focused controls for the Root-granted `cfg(test)` draw observer at `Rng::next_f64` (P-BOT-BRAIN-NATIVE-1 bridge,
//! review SHA256 `3f2cc11b2253789dbe67ff2d2cec624ef5260a55e2fffdd6231717517a9b4294`).
//!
//! These prove the bridge is observation-only: the actual returned values are recorded at the real draw site in the real
//! cross-lane order, observed and unobserved runs produce identical outputs/final RNG states/draw counts, the scope is
//! restored after return and unwind, and registrations do not leak to unregistered clones, later calls, nested scopes or
//! other threads.

use super::draw_observer::scope_draws;
use super::Rng;
use std::sync::{Arc, Mutex};
use std::thread;

type Trace = Arc<Mutex<Vec<(usize, f64)>>>;

fn recording_lane(trace: &Trace, lane: usize) -> Box<dyn FnMut(f64)> {
    let trace = Arc::clone(trace);
    Box::new(move |value| {
        trace
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .push((lane, value));
    })
}

fn address(rng: &Rng) -> usize {
    rng as *const Rng as usize
}

fn lane_values(trace: &Trace) -> Vec<(usize, f64)> {
    trace
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
}

#[test]
fn observer_records_actual_cross_lane_order_values_and_restores_scope() {
    let mut first = Rng::new(0x1234_5678);
    let mut second = Rng::new(0x8765_4321);
    let trace: Trace = Arc::new(Mutex::new(Vec::new()));
    let mut expected = Vec::new();
    {
        let _scope = scope_draws(vec![
            (address(&first), recording_lane(&trace, 0)),
            (address(&second), recording_lane(&trace, 1)),
        ]);
        // The already-computed value is observed in the real call order across the two lanes.
        for _ in 0..3 {
            expected.push((0, first.next_f64()));
            expected.push((1, second.next_f64()));
            expected.push((0, first.next_f64()));
        }
    }
    assert_eq!(
        lane_values(&trace),
        expected,
        "actual returned f64 values and their cross-lane order are recorded"
    );
    // Unobserved draws after (and before) the scope are not recorded.
    let after = trace.lock().unwrap().len();
    let _ = first.next_f64();
    let _ = second.next_f64();
    assert_eq!(
        trace.lock().unwrap().len(),
        after,
        "scope restored on return"
    );
}

#[test]
fn observed_and_unobserved_runs_have_identical_outputs_states_and_counts() {
    let mut observed = Rng::new(7);
    let mut plain = Rng::new(7);
    let trace: Trace = Arc::new(Mutex::new(Vec::new()));
    let mut expected = Vec::new();
    {
        let _scope = scope_draws(vec![(address(&observed), recording_lane(&trace, 0))]);
        for _ in 0..64 {
            expected.push(observed.next_f64());
        }
    }
    let mut plain_values = Vec::new();
    for _ in 0..64 {
        plain_values.push(plain.next_f64());
    }
    assert_eq!(expected, plain_values, "observed draws are the real draws");
    assert_eq!(
        observed, plain,
        "final RNG state identical with and without the observer"
    );
    assert_eq!(lane_values(&trace).len(), 64, "draw count recorded");
}

#[test]
fn scope_restores_on_unwind_and_nested_scopes_nest() {
    let mut first = Rng::new(11);
    let mut second = Rng::new(22);
    let outer: Trace = Arc::new(Mutex::new(Vec::new()));
    let inner: Trace = Arc::new(Mutex::new(Vec::new()));
    {
        let _outer_scope = scope_draws(vec![(address(&first), recording_lane(&outer, 0))]);
        let _ = first.next_f64();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _inner_scope = scope_draws(vec![(address(&second), recording_lane(&inner, 1))]);
            let _ = second.next_f64();
            panic!("bridge unwind control");
        }));
        assert!(result.is_err(), "the unwind control panics");
        assert_eq!(
            lane_values(&inner).len(),
            1,
            "inner scope recorded exactly its own draw"
        );
        // The outer registration is restored after the inner unwind: the outer lane is still observed, the inner one is
        // no longer registered.
        let _ = first.next_f64();
        let _ = second.next_f64();
        let mut probe = Rng::new(11);
        let first_value = probe.next_f64();
        let second_value = probe.next_f64();
        assert_eq!(
            lane_values(&outer),
            vec![(0, first_value), (0, second_value)],
            "outer scope restored after nested unwind"
        );
    }
    let before = lane_values(&outer).len();
    let _ = first.next_f64();
    assert_eq!(
        lane_values(&outer).len(),
        before,
        "observer gone after outermost return"
    );
}

#[test]
fn registered_address_only_matches_the_actual_instance_not_a_clone_or_other_thread() {
    let registered = Rng::new(99);
    let mut clone = registered.clone();
    let mut other = Rng::new(99);
    let trace: Trace = Arc::new(Mutex::new(Vec::new()));
    {
        let _scope = scope_draws(vec![(address(&registered), recording_lane(&trace, 0))]);
        let _ = clone.next_f64();
        let _ = other.next_f64();
        assert!(
            lane_values(&trace).is_empty(),
            "an unregistered clone/other instance is not observed"
        );
        // A different thread has its own (empty) thread-local registry.
        let traced = Arc::clone(&trace);
        let handle = thread::spawn(move || {
            let mut local = Rng::new(99);
            let _ = local.next_f64();
            traced
        });
        let traced = handle.join().expect("thread joins");
        assert!(
            lane_values(&traced).is_empty(),
            "another thread does not inherit the registration"
        );
    }
    let _ = registered;
}

#[test]
fn scope_is_restored_to_previous_registration_after_an_explicit_nested_scope() {
    let mut first = Rng::new(5);
    let mut second = Rng::new(6);
    let outer: Trace = Arc::new(Mutex::new(Vec::new()));
    let inner: Trace = Arc::new(Mutex::new(Vec::new()));
    let _outer_scope = scope_draws(vec![(address(&first), recording_lane(&outer, 0))]);
    {
        let _inner_scope = scope_draws(vec![(address(&second), recording_lane(&inner, 1))]);
        let _ = second.next_f64();
        let _ = first.next_f64();
        assert_eq!(lane_values(&inner).len(), 1);
        assert!(lane_values(&outer).is_empty(), "inner scope shadows outer");
    }
    let _ = first.next_f64();
    assert_eq!(
        lane_values(&outer).len(),
        1,
        "outer scope restored after inner drop"
    );
}
