//! P-MAPGEN-GUARANTEES-1: the Frost styler's end-of-attempt guarantees (`style_zones::guarantees(Zone::Frost)`).
//!
//! STUB: the list is empty. The implementer moves the lake rule here from `landmarks/signature/cave.rs`
//! (`lake_at_mouth`, today called from `SignatureContext::intact`) as the guarantee `"lake-at-mouth"`.
use crate::mapgen::style_zones::Guarantee;

/// The Frost styler's guarantees, in the order they run.
pub fn guarantees() -> &'static [Guarantee] {
    &[]
}
