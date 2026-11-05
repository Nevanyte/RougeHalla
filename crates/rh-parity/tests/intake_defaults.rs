use rh_parity::{compare, fixtures_dir, load};

#[test]
fn a_legacy_order_burst_increase_changes_acceptance_and_fails_rust_parity() {
    let mut fixture = load(&fixtures_dir().join("order_budget.json"));
    assert!(compare(&fixture).mismatches.is_empty());
    // The capture intake test verifies that production burst + 1 admits this exact formerly refused order.
    // Rust's unchanged production budget must notice the changed legacy admission transcript even though all
    // these move orders coalesce to the same position and therefore leave every tick's visible state unchanged.
    let first_refusal = fixture
        .inputs
        .iter_mut()
        .find(|input| !input.accepted)
        .unwrap();
    first_refusal.accepted = true;
    let report = compare(&fixture);
    assert!(
        report
            .mismatches
            .iter()
            .any(|m| m.contains("acceptance mismatch") && m.contains("OverBudget")),
        "{:?}",
        report.mismatches
    );
}
