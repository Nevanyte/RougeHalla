//! The offline Brain table search (P-BOT-TUNER-1; R-ML narrow exception, clause 2): a seeded hill-climb over the
//! existing TIERS / PERSONAS numbers, scored by headless tournament placement, writing the best table found as JSON for
//! review. It never changes the compiled tables or the checked-in table.
fn main() -> std::process::ExitCode {
    eprintln!("tune: not implemented yet");
    std::process::ExitCode::from(2)
}
