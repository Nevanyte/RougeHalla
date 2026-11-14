//! Sentenced: the church and its graveyard (no legacy counterpart, DEV-020).
//!
//! The church, its graveyard and its churchyard ARE the owner-approved blueprint (P-MAPGEN-SIG-SCALE-2; ADR 0028 G9,
//! decision 5): `Definition::church_grid`, a 29 x 29 drawing placed in the zone's reserved site (P-MAPGEN-SIG-RESERVE-1)
//! as the cave's: its `E` on the site's camp tile, its front (the door and the main gate) toward the coliseum, mirrored
//! or not by one draw of the Sentenced stream. `#` and `P` are the `Church` feature's walls (the building only); `G`
//! (headstone walls) and `+` (LOW fence, the styler's fence terrain) are one `Graveyard` feature; `.`, `D`, `E` and `*`
//! stay unwritten floor. A site that cannot hold the drawing refuses the attempt; the drawing is never served smaller.
//! The generic stamp (`super::stamp`) draws it from its table entry (`super::spec`); the older rule-drawn church is
//! gone (P-MAPGEN-SIG-BLUEPRINT-2). This file keeps the wall-piece rule the stamp applies to every drawing
//! (`smallest_piece`).
use crate::mapgen::coliseum::W;

/// The size of the smallest 8-connected piece of `cells` (the shape gate's and the certifier's wall-piece rule).
pub(super) fn smallest_piece(cells: &[usize]) -> usize {
    let mut seen = vec![false; cells.len()];
    let mut smallest = usize::MAX;
    for start in 0..cells.len() {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        let mut stack = vec![start];
        let mut n = 0;
        while let Some(k) = stack.pop() {
            n += 1;
            let (x, y) = ((cells[k] % W) as i32, (cells[k] / W) as i32);
            for (j, &c) in cells.iter().enumerate() {
                let (u, v) = ((c % W) as i32, (c / W) as i32);
                if !seen[j] && (u - x).abs() <= 1 && (v - y).abs() <= 1 {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        smallest = smallest.min(n);
    }
    smallest
}
