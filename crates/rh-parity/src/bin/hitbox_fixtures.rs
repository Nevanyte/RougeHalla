//! cargo run -p rh-parity --bin hitbox-fixtures [--check]: writes (or checks) the ADR0024 client goldens
//! protocol/fixtures/archetypes_v1.json, pathfinding_v2.json and server_walk_v2.json from the current core.
fn main() {
    let check = std::env::args().any(|a| a == "--check");
    let stale = rh_parity::hitbox_goldens::write_or_check(check);
    if check {
        if stale.is_empty() {
            println!("hitbox-fixtures --check: archetypes_v1, pathfinding_v2 and server_walk_v2 are current");
        } else {
            eprintln!("hitbox-fixtures --check: stale {stale:?}; run cargo run -p rh-parity --bin hitbox-fixtures");
            std::process::exit(1);
        }
    } else {
        println!(
            "wrote {:?}",
            rh_parity::hitbox_goldens::all()
                .iter()
                .map(|(p, _)| *p)
                .collect::<Vec<_>>()
        );
    }
}
