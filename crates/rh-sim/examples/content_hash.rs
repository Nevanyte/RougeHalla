//! Prints `rh_sim::content::content_hash()` as 16 lower-case hex digits (used by scripts/regolden-content.sh).
fn main() {
    println!("{:016x}", rh_sim::content::content_hash());
}
