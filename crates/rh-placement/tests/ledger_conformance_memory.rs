//! The conformance suite against the memory store, on a paused clock.
mod ledger_support;

use ledger_support::conformance::Fx;
use rh_placement::ledger::memory::MemoryLedger;
use std::sync::Arc;

async fn setup() -> Fx<MemoryLedger> {
    let l = Arc::new(MemoryLedger::new());
    Fx { a: l.clone(), b: l }
}
async fn teardown(_: Fx<MemoryLedger>) {}

mod memory {
    use super::{setup, teardown};
    crate::conformance_cases!(tokio::test(start_paused = true), setup, teardown);
}

#[tokio::test(start_paused = true)]
async fn memory_store_is_bounded_fails_closed_and_never_evicts() {
    use ledger_support::conformance::{ident, LONG};
    use rh_placement::ledger::{memory::MEMORY_CAP, Begin, Ledger};
    let l = MemoryLedger::new();
    for i in 0..MEMORY_CAP {
        let b = l
            .begin(&ident(&format!("cap{i:05}"), "s", "f"), "w", LONG)
            .await
            .unwrap();
        assert!(matches!(b, Begin::Started(_)));
    }
    assert_eq!(
        l.begin(&ident("capextra", "s", "f"), "w", LONG)
            .await
            .unwrap(),
        Begin::Full
    );
    assert_eq!(l.counts().await.unwrap().total, MEMORY_CAP);
    // Existing ids are still answered (never evicted), and a full store still reports conflicts.
    assert_eq!(
        l.begin(&ident("cap00000", "s", "g"), "w", LONG)
            .await
            .unwrap(),
        Begin::Conflict
    );
    assert_eq!(
        l.begin(&ident("cap00000", "s", "f"), "w", LONG)
            .await
            .unwrap(),
        Begin::InProgress
    );
}

#[tokio::test(start_paused = true)]
async fn memory_relinquish_blocking_is_synchronous_and_fenced() {
    use ledger_support::conformance::{ident, LONG};
    use rh_placement::ledger::{Begin, Ledger};
    let l = MemoryLedger::new();
    let Begin::Started(c) = l
        .begin(&ident("blk00001", "s", "f"), "w", LONG)
        .await
        .unwrap()
    else {
        panic!()
    };
    l.relinquish_blocking(&c);
    let got = l.claim_reapable("r", LONG, 4).await.unwrap();
    assert_eq!(got.len(), 1);
    l.relinquish_blocking(&c); // stale: the new claim stands
    assert!(l.claim_reapable("r2", LONG, 4).await.unwrap().is_empty());
}
