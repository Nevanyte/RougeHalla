//! Frost: the cave (P-MAPGEN-SIG-FROST-1; no legacy counterpart, DEV-020). A wall chamber on the Frost zone's back edge
//! round the zone's far elite camp (the elite camp farthest from the map centre), containing the camp's clearing, closed
//! except for one mouth toward the front (the anchor's `entrance`), with ice floor inside owned by the cave. Like the
//! church it may be an off-centre rectangle or lean on the map border, so every map gets one. The shape the server
//! post-pass drew is `frozen_cave` in `crates/rh-server/src/signature.rs` (a rock arch, open on the inward side).
//!
//! STUB: places nothing and is not called from `SignatureContext::apply`. The implementer wires it in (Frost's slot, its
//! own stream as the other zones), returns the Frost anchor (kind `Cave`, entrance = the mouth tiles), extends
//! `is_signature`, `intact` and `finish` for the kind, and keeps every tunable in `Definition`.
use super::{Built, Site};
use crate::mapgen::zones::camps::CampSite;
use crate::rng::Mulberry32;

/// The cave round the Frost zone's far elite camp, or `None` when the zone has no legal site (the attempt is refused,
/// G5).
#[allow(dead_code)] // STUB (P-MAPGEN-SIG-FROST-1): wired into `SignatureContext::apply` by the implementer.
pub(super) fn place(_site: &Site, _camps: &[CampSite], _rng: &mut Mulberry32) -> Option<Built> {
    None
}
