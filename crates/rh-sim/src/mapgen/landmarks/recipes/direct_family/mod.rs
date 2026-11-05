//! Actual stage-four direct landmark planners. No terrain styling or RNG draws.
pub mod rime;
pub mod sanctum;
#[cfg(test)]
mod tests;
pub mod warren;

use crate::mapgen::landmarks::{
    runtime::{LandmarkRuntime, PlacedFeature},
    templates::{self, ParsedTemplate, Stamp},
};
fn stamp(
    t: &ParsedTemplate,
    x: i32,
    y: i32,
    rot: u8,
    mirror: bool,
    w: usize,
    h: usize,
) -> Option<Stamp> {
    let result = templates::stamp_template(t, x, y, rot, mirror, w, h);
    #[cfg(test)]
    tests::observe(
        None,
        serde_json::json!({"type":"stamp","template":t.template.key,"x0":x,"y0":y,"rot":rot,"mirror":mirror,"result":result}),
    );
    result
}
fn fits(rt: &LandmarkRuntime<'_>, s: &Stamp) -> bool {
    let result = templates::stamp_fits(rt, s);
    #[cfg(test)]
    tests::observe(
        Some(rt),
        serde_json::json!({"type":"fit","stamp":s,"result":result}),
    );
    result
}
fn place(
    rt: &mut LandmarkRuntime<'_>,
    t: &ParsedTemplate,
    s: &Stamp,
    rot: u8,
    mirror: bool,
) -> Option<PlacedFeature> {
    #[cfg(test)]
    let before = tests::placement_before(rt, t, s, rot, mirror);
    let result = templates::place_landmark(rt, t, s, rot, mirror);
    #[cfg(test)]
    tests::placement_after(rt, s, result.is_some(), before);
    #[cfg(test)]
    tests::observe(
        Some(rt),
        serde_json::json!({"type":"place","template":t.template.key,"stamp":s,"rot":rot,"mirror":mirror,"result":result}),
    );
    result
}
#[cfg(test)]
fn plan(rt: &LandmarkRuntime<'_>, event: serde_json::Value) {
    tests::observe(Some(rt), event);
}
