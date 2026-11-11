//! STUB (oracle author, packet P-BALANCE-2). Prints an empty versioned report and exits 0 so that
//! `crates/rh-headless/tests/camp_bench.rs` fails on assertions, not on a missing binary. The implementer replaces this
//! file; the report schema is in docs/backlog/packets/P-BALANCE-2.md section 8a.
//!
//! The implementer keeps the named constant below in THIS file (the test reads this file's source for it).

/// The owner-approved relative band (plus or minus 10%, plan 2026-11-10) outside which a cell is listed.
const BAND: f64 = 0.10;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let quick = args.iter().any(|a| a == "--quick");
    println!(
        "{{\"version\":1,\"seed\":0,\"quick\":{quick},\"list_only\":false,\"max_ticks\":0,\"band\":{BAND},\"cells\":[],\"comparisons\":[],\"out_of_band\":[]}}"
    );
}
