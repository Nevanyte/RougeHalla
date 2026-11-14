//! cargo run -p rh-parity --bin frost-wall-aim-fixtures [--check]: writes (or checks) the P-UNITY-FROST-WALL-1 client
//! golden protocol/fixtures/frost_wall_aim_v1.json from the current core.
fn main() {
    let check = std::env::args().any(|a| a == "--check");
    let stale = rh_parity::frost_wall_goldens::write_or_check(check);
    if check {
        if stale.is_empty() {
            println!("frost-wall-aim-fixtures --check: frost_wall_aim_v1 is current");
        } else {
            eprintln!(
                "frost-wall-aim-fixtures --check: stale {stale:?}; run cargo run -p rh-parity --bin frost-wall-aim-fixtures"
            );
            std::process::exit(1);
        }
    } else {
        println!(
            "wrote {:?}",
            rh_parity::frost_wall_goldens::all()
                .iter()
                .map(|(p, _)| *p)
                .collect::<Vec<_>>()
        );
    }
}
