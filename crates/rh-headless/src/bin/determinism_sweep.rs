mod determinism_sweep_support;

fn main() {
    if let Err(error) = determinism_sweep_support::main_entry() {
        eprintln!("determinism_sweep: {error}");
        std::process::exit(1);
    }
}
