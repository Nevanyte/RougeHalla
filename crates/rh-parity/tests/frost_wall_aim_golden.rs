//! P-UNITY-FROST-WALL-1: protocol/fixtures/frost_wall_aim_v1.json must be exactly what the current core's wall placement
//! (`rh_sim::barriers::wall_segment_for`, `wall_cells`) produces. Regenerate with
//! `cargo run -p rh-parity --bin frost-wall-aim-fixtures`.

use rh_parity::frost_wall_goldens::all;

fn repo(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

#[test]
fn committed_frost_wall_aim_golden_is_the_current_core() {
    for (path, want) in all() {
        let got = std::fs::read_to_string(repo(path)).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(
            got == want,
            "{path} differs from the current core: run cargo run -p rh-parity --bin frost-wall-aim-fixtures"
        );
    }
}
