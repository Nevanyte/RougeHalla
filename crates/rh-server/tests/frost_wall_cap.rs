//! The largest Frost Wall the content numbers allow fits the wire's tile cap. `rh-protocol` cannot see `rh-sim`, so
//! this lives in `rh-server`, which depends on both. A retune of the wall's length must fail here before it makes every
//! State carrying a wall fail to encode.
use rh_protocol::state::MAX_WALL_TILES;
use rh_sim::abilities::FROST_WALL_LENGTH;
use rh_sim::barriers::{WALL_CELL_REACH, WALL_END_SLACK};
use rh_sim::constants::TILE;

#[test]
fn the_largest_frost_wall_the_content_numbers_allow_fits_the_wire_cap() {
    // A wall takes tiles whose centres lie within WALL_CELL_REACH of the segment extended by WALL_END_SLACK at each
    // end: a stadium inside a rectangle of length L + 2*slack + 2*reach and width 2*reach. Tile centres sit on a grid
    // of pitch TILE, so a span s holds at most ceil(s / TILE + 1) centres along an axis. Counting the long side for its
    // full length and the short side for its full width is a crude but honest upper bound at any orientation.
    let long = FROST_WALL_LENGTH + 2. * WALL_END_SLACK + 2. * WALL_CELL_REACH;
    let wide = 2. * WALL_CELL_REACH;
    let bound = ((long / TILE + 1.).ceil() * (wide / TILE + 1.).ceil()) as usize;
    println!("largest wall bound: {bound} tiles (cap {MAX_WALL_TILES})");
    assert!(
        bound <= MAX_WALL_TILES,
        "a wall of length {FROST_WALL_LENGTH} may take {bound} tiles, over the wire cap {MAX_WALL_TILES}"
    );
}
