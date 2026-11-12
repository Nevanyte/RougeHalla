//! Fire: the volcano (P-MAPGEN-SIG-FIRE-1; no legacy counterpart, DEV-020). A cone of wall with a crater on the Fire
//! zone's back edge (its centre farther from the map centre than the zone's centroid), and two or three lava streams
//! (`LavaStream`, LOW lava) that run from it toward the front, each ending in a lava pool (`LavaPool`), edged with ember
//! floor owned by the stream or pool. A site that cannot fit two streams is not used. The shape to port is the server
//! post-pass's `volcano` (`crates/rh-server/src/signature.rs`).
//!
//! STUB: places nothing and is not called from `SignatureContext::apply`. The implementer wires it in (Fire's slot, its
//! own stream as the other zones), returns the Fire anchor (kind `Volcano`), and keeps every tunable in `Definition`.
use super::{Built, Site};
use crate::rng::Mulberry32;

/// The volcano with its streams and pools for the Fire zone, or `None` when the zone has no legal site (the attempt is
/// refused, G5).
#[allow(dead_code)] // STUB (P-MAPGEN-SIG-FIRE-1): wired into `SignatureContext::apply` by the implementer.
pub(super) fn place(_site: &Site, _rng: &mut Mulberry32) -> Option<Built> {
    None
}
