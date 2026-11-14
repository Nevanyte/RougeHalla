//! P-FROST-WALL-3 oracle (rh-sim): the live content world plays Frost Wall; every other world keeps Freeze.
//!
//! Legacy: the unreleased patch `78dd8bd4` makes Frost Wall Frost's only Wish (`packages/shared/src/abilities.ts:274`,
//! `WISHES.frost = "frostWall"`; read with `git show 78dd8bd4:<path>`). Owner decision 2 (2026-11-10): "Frost Wall
//! replaces Freeze" in the live game. The default config (headless, parity, tests) keeps the in-repo legacy oracle's
//! Freeze, so no parity fixture moves.
use rh_sim::{FrostWish, SimConfig};

#[test]
fn the_live_content_world_plays_frost_wall() {
    assert_eq!(
        SimConfig::live_content().frost_wish,
        FrostWish::Wall,
        "live_content() (source arena, practice room, Brain tournament world) selects Frost Wall"
    );
}

#[test]
fn guard_the_default_world_keeps_freeze() {
    assert_eq!(
        SimConfig::default().frost_wish,
        FrostWish::Freeze,
        "SimConfig::default() (headless, parity fixtures, tests) keeps the in-repo legacy Freeze"
    );
}
