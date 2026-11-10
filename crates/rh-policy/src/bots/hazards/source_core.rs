//! The private source hazard core (`packages/server/src/bots/brain/modules/hazards.ts`).
//!
//! One implementation of the source's ground classification, its stable dy/dx nearest-tile search and its
//! step/hold/expiry/arrival/throttle/light/adjust transitions, parameterized by explicit owner facts and the caller's
//! real `collisionMap`/`clear` service callbacks. Both the existing public [`Hazards`] compatibility wrapper and the
//! complete source hazards feature module (`temporal_percept/modules/hazards.rs`) call these functions; this file never
//! constructs an `Observation`, invents an actor identity, moves a body or applies a terrain effect.
//!
//! The state is the public wrapper's own retained state (`Hazards { step, last_step_at }`), reused directly as the
//! source module's per-cfg state so no second state machine exists. `Step`/`Facts`/`Services` are the complete source
//! contract the two adapters fill:
//!
//! * `Facts` are delivered owner/memory hook facts (position, status, `Option` faction with its present/null distinction,
//!   hp/maxHp, attack target presence, HUD phase/coliseum, source goal union subset, engagement, reengageHp, stillSince).
//! * `Services` are the two declared path-service callbacks. `collision_map()` is called at exactly the source point:
//!   after the guards and the retained-step check for `intents`, and immediately after the alive/faction guard for
//!   `adjust` (even for an unchanged/empty intent list). `clear(a,b)` is the `nearestTile` accept callback for the step
//!   search and the `towardLight` candidate test; the adjust search passes no accept callback.
//!
//! `terrain` is the declared map's `GameMap.terrain` layer, passed explicitly because a hand-built source arena has no
//! admitted full-layer metadata on its collision `TileMap`; the public wrapper derives it from `map.layers()` (a
//! layer-less map is source NONE ground, its old behavior) and the source module passes `ctx.cfg.terrain`.
//!
//! `dist` is parameterized because the public wrapper keeps its admitted `rh_sim::math::hypot` behavior while the
//! source module must use the admitted source `Math.hypot` leaf (`strategy::types::dist`).

use super::{
    Goal, Hazards, ARRIVE_U, HOLD_MS, LIGHT_TILES, REDIRECT_MIN_U, REDIRECT_TILES, STEP_EVERY_MS,
    STEP_TILES, STILL_MS,
};
use crate::bots::types::{Intent, IntentBody, IntentTiming, PRIORITY_GOAL};
use rh_sim::geometry::circle_clear;
use rh_sim::map::{tile_to_world_center, world_to_tile, MASK_MOVE};
use rh_sim::{constants::PLAYER_RADIUS, FactionId, TileMap, Vec2};

/// `TERRAIN_LIGHT` (`shared/terrain.ts`): the kind `surfaceAt` heals on and `towardLight` searches.
const TERRAIN_LIGHT: u8 = 7;

/// The source `Step`: a decided destination kept (offered again) for `HOLD_MS` or until arrival.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Step {
    pub(crate) to: Vec2,
    pub(crate) at: f64,
    pub(crate) why: &'static str,
}

const STEP_WHY: &str = "step off the embers";
const LIGHT_WHY: &str = "lie low in the light";

// ----------------------------------------------------------------------------------------------- ground classification

/// The recognized source faction spelling (`FACTION_IDS` column 1+i of `surfaceAt`). Any other spelling — including the
/// empty string a null faction retains — has **no** home rule and is never coerced into a recognized faction.
pub(crate) fn faction_of_text(text: &str) -> Option<FactionId> {
    FactionId::parse(text)
}

/// The kind under a world point from the declared `GameMap.terrain` layer; out of bounds is NONE (source
/// `terrainAt`). The declared slice is passed explicitly because a hand-built source arena has no admitted full-layer
/// metadata on its collision `TileMap`; an empty slice is source NONE ground.
pub(crate) fn terrain_kind(map: &TileMap, terrain: &[u8], at: Vec2) -> u8 {
    let x = world_to_tile(at.x);
    let y = world_to_tile(at.y);
    if x < 0 || y < 0 || x >= i64::from(map.w) || y >= i64::from(map.h) {
        return 0;
    }
    terrain
        .get((y * i64::from(map.w) + x) as usize)
        .copied()
        .unwrap_or(0)
}

/// Source `burns`: `surfaceAt(...).burnShare > 0` — embers burn everyone who is not at home on them.
pub(crate) fn burns(map: &TileMap, terrain: &[u8], faction: Option<FactionId>, at: Vec2) -> bool {
    terrain_kind(map, terrain, at) == 4 && faction != Some(FactionId::Fire)
}

/// Source `bad`: `burnShare > 0 || speedMult < 1 || accel > 0` — embers, bog or ice to everyone without a home rule.
pub(crate) fn bad(map: &TileMap, terrain: &[u8], faction: Option<FactionId>, at: Vec2) -> bool {
    match terrain_kind(map, terrain, at) {
        4 => faction != Some(FactionId::Fire),
        5 => faction != Some(FactionId::Plague),
        6 => faction != Some(FactionId::Frost),
        _ => false,
    }
}

/// Source `clean`: the tile and its four body-standable neighbours are not bad, so a click's scatter stays on good ground.
pub(crate) fn clean(map: &TileMap, terrain: &[u8], faction: Option<FactionId>, at: Vec2) -> bool {
    if bad(map, terrain, faction, at) {
        return false;
    }
    for (dx, dy) in [
        (rh_sim::constants::TILE, 0.),
        (-rh_sim::constants::TILE, 0.),
        (0., rh_sim::constants::TILE),
        (0., -rh_sim::constants::TILE),
    ] {
        let p = Vec2::new(at.x + dx, at.y + dy);
        if circle_clear(map, p, 0., MASK_MOVE) && bad(map, terrain, faction, p) {
            return false;
        }
    }
    true
}

// ------------------------------------------------------------------------------------------------- parameterized search

/// One ordered preference test of the source `nearestTile` test list; the strictest (`Clean`) comes first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TileTest {
    Clean,
    NotBad,
}

/// Source `nearestTile`, exactly: tile-centre candidates within `tiles` (Chebyshev) of `around` in the source's dy
/// outer / dx inner generation order, filtered by `circleClear(map, p, PLAYER_RADIUS)`, JS-stably sorted by the source
/// `dist(p, from)`, then for each ordered test iterate that sorted list and return the first candidate that holds and
/// whose `accept` callback returns true. `around` picks the tile box; `from` picks the distance ordering origin.
/// `accept` is called at exactly the source point — once per candidate that passes its current test, and again for a
/// candidate accepted-rejected in an earlier pass when a later test also holds (the source loops tests outer, list inner).
#[allow(clippy::too_many_arguments)] // The source `nearestTile` signature carries every parameterized seam.
pub(crate) fn nearest_tile(
    map: &TileMap,
    terrain: &[u8],
    around: Vec2,
    from: Vec2,
    tiles: i64,
    faction: Option<FactionId>,
    tests: &[TileTest],
    accept: &dyn Fn(Vec2) -> bool,
    dist: &dyn Fn(Vec2, Vec2) -> f64,
) -> Option<Vec2> {
    let cx = world_to_tile(around.x);
    let cy = world_to_tile(around.y);
    let mut open = Vec::new();
    for dy in -tiles..=tiles {
        for dx in -tiles..=tiles {
            let p = Vec2::new(tile_to_world_center(cx + dx), tile_to_world_center(cy + dy));
            if circle_clear(map, p, PLAYER_RADIUS, MASK_MOVE) {
                open.push(p);
            }
        }
    }
    // JS stable Array.sort keeps the generated dy/dx order on equal distances.
    open.sort_by(|a, b| dist(*a, from).total_cmp(&dist(*b, from)));
    for test in tests {
        for &p in &open {
            let holds = match test {
                TileTest::Clean => clean(map, terrain, faction, p),
                TileTest::NotBad => !bad(map, terrain, faction, p),
            };
            if holds && accept(p) {
                return Some(p);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------------- facts/services

/// The delivered facts the source hooks read (no fabricated observation, no derived actor id).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Facts {
    /// Source `p.now` (delivered server time).
    pub(crate) now: f64,
    /// Source `p.self` position.
    pub(crate) pos: Vec2,
    /// Source `self.status === "alive"`; only callers that can deliver a live owner pass true.
    pub(crate) status_alive: bool,
    /// Source `self.faction !== null` — an unknown non-null spelling still passes this guard.
    pub(crate) faction_present: bool,
    /// The recognized home faction of that spelling, if any (unknown/empty has no home rule).
    pub(crate) home: Option<FactionId>,
    pub(crate) hp: f64,
    pub(crate) max_hp: f64,
    /// Source `self.attackTarget !== null`.
    pub(crate) attack_target: bool,
    /// Source `p.hud.phase === "active"`.
    pub(crate) phase_active: bool,
    /// Source `p.hud.inColiseum`.
    pub(crate) in_coliseum: bool,
    /// The source goal as the hook reads it (only `kind`/hold `why` matter to hazards).
    pub(crate) goal: Goal,
    /// Source `ctx.engaged` (the composing caller's declared fact).
    pub(crate) engaged: bool,
    /// Source `ctx.cfg.persona.reengageHp`.
    pub(crate) reengage_hp: f64,
    /// Source `ctx.mem.self.stillSince` (the admitted Memory anchor).
    pub(crate) still_since: f64,
}

/// The two declared path-service callbacks the source hooks use, in source call order.
pub(crate) trait Services {
    fn collision_map(&self) -> &TileMap;
    fn clear(&self, a: Vec2, b: Vec2) -> bool;
}

/// Static-map services: the public wrapper's admitted map/`segment_clear` behavior made callable at the source points.
pub(crate) struct MapService<'a> {
    pub(crate) map: &'a TileMap,
}
impl Services for MapService<'_> {
    fn collision_map(&self) -> &TileMap {
        self.map
    }
    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        rh_sim::geometry::segment_clear(self.map, a, b, PLAYER_RADIUS, MASK_MOVE)
    }
}

// -------------------------------------------------------------------------------------------------------------- intents

/// The source `keeping` retained-step test: expire after strictly more than `HOLD_MS`, or clear on arrival.
fn keeping(state: &mut Hazards, facts: &Facts, dist: &dyn Fn(Vec2, Vec2) -> f64) -> Option<Step> {
    let step = state.step?;
    if facts.now - step.at > HOLD_MS || dist(facts.pos, step.to) <= ARRIVE_U {
        state.step = None;
        return None;
    }
    Some(step)
}

/// Source `stepOff`: standing still on ground that burns the bot, nothing locked.
fn step_off(
    facts: &Facts,
    map: &TileMap,
    terrain: &[u8],
    services: &dyn Services,
    dist: &dyn Fn(Vec2, Vec2) -> f64,
) -> Option<Step> {
    let me = facts.pos;
    if !burns(map, terrain, facts.home, me) {
        return None;
    }
    if facts.attack_target {
        return None;
    }
    if facts.now - facts.still_since < STILL_MS {
        return None;
    }
    let accept = |q: Vec2| services.clear(me, q);
    let to = nearest_tile(
        map,
        terrain,
        me,
        me,
        STEP_TILES,
        facts.home,
        &[TileTest::Clean, TileTest::NotBad],
        &accept,
        dist,
    )?;
    Some(Step {
        to,
        at: facts.now,
        why: STEP_WHY,
    })
}

/// Source `towardLight`: a hurt bot lying low with nothing to do looks for light within `LIGHT_TILES`.
fn toward_light(
    facts: &Facts,
    map: &TileMap,
    terrain: &[u8],
    services: &dyn Services,
    dist: &dyn Fn(Vec2, Vec2) -> f64,
) -> Option<Step> {
    if !matches!(facts.goal, Goal::HoldAmbush | Goal::HoldWait) {
        return None;
    }
    let me = facts.pos;
    if facts.max_hp <= 0. || facts.hp / facts.max_hp >= facts.reengage_hp || facts.engaged {
        return None;
    }
    if terrain_kind(map, terrain, me) == TERRAIN_LIGHT {
        return None;
    }
    let cx = world_to_tile(me.x);
    let cy = world_to_tile(me.y);
    let radius = LIGHT_TILES;
    let mut best = None;
    let mut best_d = f64::INFINITY;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let q = Vec2::new(tile_to_world_center(cx + dx), tile_to_world_center(cy + dy));
            if terrain_kind(map, terrain, q) != TERRAIN_LIGHT
                || !circle_clear(map, q, PLAYER_RADIUS, MASK_MOVE)
            {
                continue;
            }
            let d = dist(me, q);
            if d < best_d && services.clear(me, q) {
                best = Some(q);
                best_d = d;
            }
        }
    }
    best.map(|to| Step {
        to,
        at: facts.now,
        why: LIGHT_WHY,
    })
}

/// Source `intents`: guards, retained step before any `collisionMap` call, then the 600 ms step-off search and the
/// light search. Returns the step to offer (retained or newly decided), or `None` for no intent.
pub(crate) fn intents(
    state: &mut Hazards,
    facts: &Facts,
    services: &dyn Services,
    terrain: &[u8],
    dist: &dyn Fn(Vec2, Vec2) -> f64,
) -> Option<Step> {
    if !facts.phase_active || !facts.status_alive || !facts.faction_present || facts.in_coliseum {
        return None;
    }
    if let Some(step) = keeping(state, facts, dist) {
        return Some(step);
    }
    let map = services.collision_map();
    let mut next = None;
    if facts.goal != Goal::Loot
        && state
            .last_step_at
            .is_none_or(|last| facts.now - last >= STEP_EVERY_MS)
    {
        next = step_off(facts, map, terrain, services, dist);
        if next.is_some() {
            state.last_step_at = Some(facts.now);
        }
    }
    if next.is_none() {
        next = toward_light(facts, map, terrain, services, dist);
    }
    if next.is_some() {
        state.step = next;
    }
    next
}

/// The exact source `move` intent for one decided step (`PRIORITY.goal`, `timing: step`, its exact `why`).
pub(crate) fn intent(step: Step) -> Intent {
    Intent {
        body: IntentBody::Move { to: step.to },
        priority: PRIORITY_GOAL,
        timing: IntentTiming::Step {},
        why: step.why.into(),
    }
}

// --------------------------------------------------------------------------------------------------------------- adjust

/// Source `adjust`: a walk's destination on bad ground is moved onto the nearest good ground within `REDIRECT_TILES`,
/// when the walk is at least `REDIRECT_MIN_U`. The alive/faction guard precedes the `collisionMap` call, which then
/// happens even for an unchanged/empty list. The returned list keeps its identity until the first actual redirect.
pub(crate) fn adjust<'a>(
    facts: &Facts,
    services: &dyn Services,
    terrain: &[u8],
    intents: &'a [Intent],
    dist: &dyn Fn(Vec2, Vec2) -> f64,
) -> std::borrow::Cow<'a, [Intent]> {
    if !facts.status_alive || !facts.faction_present {
        return std::borrow::Cow::Borrowed(intents);
    }
    let map = services.collision_map();
    let mut out: Option<Vec<Intent>> = None;
    for (k, intent) in intents.iter().enumerate() {
        let IntentBody::Move { to } = intent.body else {
            continue;
        };
        if dist(facts.pos, to) < REDIRECT_MIN_U || !bad(map, terrain, facts.home, to) {
            continue;
        }
        let Some(redirect) = nearest_tile(
            map,
            terrain,
            to,
            to,
            REDIRECT_TILES,
            facts.home,
            &[TileTest::Clean, TileTest::NotBad],
            &|_| true,
            dist,
        ) else {
            continue;
        };
        let list = out.get_or_insert_with(|| intents.to_vec());
        list[k] = Intent {
            body: IntentBody::Move { to: redirect },
            priority: intent.priority,
            timing: intent.timing.clone(),
            why: format!("{} (round the bad ground)", intent.why),
        };
    }
    match out {
        Some(list) => std::borrow::Cow::Owned(list),
        None => std::borrow::Cow::Borrowed(intents),
    }
}

// ----------------------------------------------------------------------------------------------------------- witnesses

/// Read-only loader for the unaffected legacy hazard corpus (`parity/policy/bot-hazards.json`). It declares the five
/// static maps and the owner facts the public adapter replay uses; the core witnesses below consume only its maps.
#[cfg(test)]
pub(crate) mod fixture {
    use rh_sim::{TileMap, Vec2};
    use serde_json::Value;

    pub(crate) fn corpus() -> Value {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/policy/bot-hazards.json"
        ))
        .expect("read-only legacy hazard corpus");
        serde_json::from_str(&text).expect("legacy hazard corpus json")
    }

    pub(crate) fn maps(corpus: &Value) -> Vec<(String, TileMap)> {
        corpus["maps"]
            .as_object()
            .expect("declared maps")
            .iter()
            .map(|(name, value)| {
                let export: rh_sim::mapdata::MapExport =
                    serde_json::from_value(value.clone()).expect("declared map export");
                let (w, h, tiles, layers) =
                    export.validate().expect("admitted static map").into_parts();
                (
                    name.clone(),
                    TileMap::new(w, h, tiles)
                        .expect("tile shape")
                        .with_layers(layers)
                        .expect("layer shape"),
                )
            })
            .collect()
    }

    pub(crate) fn map<'a>(maps: &'a [(String, TileMap)], name: &str) -> &'a TileMap {
        &maps
            .iter()
            .find(|(n, _)| n == name)
            .expect("declared map")
            .1
    }

    /// The corpus anchor tile centre (`anchor: {x:48, y:11}` as world centre).
    pub(crate) fn anchor() -> Vec2 {
        Vec2::new((48. + 0.5) * 32., (11. + 0.5) * 32.)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::fixture;
    use super::*;

    fn public_dist(a: Vec2, b: Vec2) -> f64 {
        rh_sim::math::hypot(a.x - b.x, a.y - b.y)
    }

    fn terrain_of(map: &TileMap) -> &[u8] {
        map.layers()
            .map_or(&[], |layers| layers.data().terrain.as_slice())
    }

    fn search(
        map: &TileMap,
        around: Vec2,
        from: Vec2,
        tests: &[TileTest],
        accept: &dyn Fn(Vec2) -> bool,
    ) -> Option<Vec2> {
        nearest_tile(
            map,
            terrain_of(map),
            around,
            from,
            6,
            Some(FactionId::Holy),
            tests,
            accept,
            &public_dist,
        )
    }

    #[test]
    fn stable_generation_order_breaks_equal_distance_ties() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let ember = fixture::map(&maps, "ember");
        let anchor = fixture::anchor();
        // The nearest `Clean` ring (the ember region is a 5x5 block at the anchor tile) sits at Chebyshev distance 4:
        // the four cardinal tiles are exactly 128u away, so the stable dy/dx generation order must decide.
        let clean = search(ember, anchor, anchor, &[TileTest::Clean], &|_| true);
        assert_eq!(clean, Some(Vec2::new(1552., 240.)), "dy=-4 generated first");
        // The nearest `!bad` ring sits one tile in and also ties: (1552,272) (dy=-3) is generated before (1456,368).
        let loose = search(ember, anchor, anchor, &[TileTest::NotBad], &|_| true);
        assert_eq!(loose, Some(Vec2::new(1552., 272.)), "dy=-3 generated first");
    }

    #[test]
    fn ordered_tests_prefer_clean_over_a_closer_not_bad_tile() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let ember = fixture::map(&maps, "ember");
        let anchor = fixture::anchor();
        // Source stepOff tests are [clean, !bad]: the clean(er) farther tile wins over the nearer merely-not-bad one.
        let preferred = search(
            ember,
            anchor,
            anchor,
            &[TileTest::Clean, TileTest::NotBad],
            &|_| true,
        );
        assert_eq!(preferred, Some(Vec2::new(1552., 240.)));
        // The same ordered list falls back to the `!bad` pass when the clean candidate's accept denies it.
        let clean_denied = RefCell::new(0usize);
        let fallback = search(
            ember,
            anchor,
            anchor,
            &[TileTest::Clean, TileTest::NotBad],
            &|_| {
                *clean_denied.borrow_mut() += 1;
                false
            },
        );
        assert_eq!(
            fallback, None,
            "accept denies every candidate in both passes"
        );
        assert!(*clean_denied.borrow() > 4);
        // A single-pass `!bad` list accepts the nearer tile directly.
        let nearer = search(ember, anchor, anchor, &[TileTest::NotBad], &|_| true);
        assert_eq!(nearer, Some(Vec2::new(1552., 272.)));
    }

    #[test]
    fn accept_is_called_at_the_source_point_and_stops_at_first_success() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let ember = fixture::map(&maps, "ember");
        let anchor = fixture::anchor();
        let calls = RefCell::new(Vec::new());
        let accepted = search(
            ember,
            anchor,
            anchor,
            &[TileTest::Clean, TileTest::NotBad],
            &|q| {
                calls.borrow_mut().push(q);
                true
            },
        );
        assert_eq!(accepted, Some(Vec2::new(1552., 240.)));
        assert_eq!(
            &*calls.borrow(),
            &[Vec2::new(1552., 240.)],
            "one accept call at the first clean candidate"
        );
    }

    #[test]
    fn denied_accept_traverses_both_passes_in_source_order() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let ember = fixture::map(&maps, "ember");
        let anchor = fixture::anchor();
        let calls = RefCell::new(Vec::new());
        let accepted = search(
            ember,
            anchor,
            anchor,
            &[TileTest::Clean, TileTest::NotBad],
            &|q| {
                calls.borrow_mut().push(q);
                false
            },
        );
        assert_eq!(accepted, None);
        let calls = calls.into_inner();
        // The `[clean, !bad]` order plus the 5x5 ember block: the 4 cardinal clean tiles are visited first (stable
        // generation order), then the same sorted list is re-walked by the `!bad` pass (so clean tiles appear again).
        assert_eq!(
            &calls[..4],
            &[
                Vec2::new(1552., 240.),
                Vec2::new(1424., 368.),
                Vec2::new(1680., 368.),
                Vec2::new(1552., 496.),
            ]
        );
        let mut unique: Vec<(u64, u64)> = calls
            .iter()
            .map(|p| (p.x.to_bits(), p.y.to_bits()))
            .collect();
        unique.sort_unstable();
        unique.dedup();
        assert!(
            unique.len() < calls.len(),
            "the loose pass re-walks clean candidates"
        );
        // Frozen corpus `hazard-path-denial` records 268 denied accepts for this same 5x5 ember geometry.
        assert_eq!(calls.len(), 268);
    }

    #[test]
    fn around_chooses_the_tile_box_while_from_chooses_the_order() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let ember = fixture::map(&maps, "ember");
        let anchor = fixture::anchor();
        // Same box (around), different ordering origin (from): distinct first clean tile.
        let centered = search(ember, anchor, anchor, &[TileTest::Clean], &|_| true);
        let shifted = search(
            ember,
            anchor,
            Vec2::new(anchor.x + 1., anchor.y),
            &[TileTest::Clean],
            &|_| true,
        );
        assert_eq!(centered, Some(Vec2::new(1552., 240.)));
        assert_eq!(shifted, Some(Vec2::new(1680., 368.)));
        // Same ordering origin, a far-away box: the candidates come from the `around` box only.
        let far = search(
            ember,
            Vec2::new(1008., 1008.),
            anchor,
            &[TileTest::Clean],
            &|_| true,
        );
        let far = far.expect("a clean tile near the far box");
        assert!((816.0..=1200.0).contains(&far.x) && (816.0..=1200.0).contains(&far.y));
        assert_ne!(Some(far), centered);
    }

    #[test]
    fn unknown_or_empty_faction_has_no_home_rule() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let anchor = fixture::anchor();
        let ember = fixture::map(&maps, "ember");
        let bog = fixture::map(&maps, "bog");
        let ice = fixture::map(&maps, "ice");
        // Known homes keep their exemption; every other spelling falls through to the neutral effect.
        let ember_terrain = terrain_of(ember);
        let bog_terrain = terrain_of(bog);
        let ice_terrain = terrain_of(ice);
        assert!(!burns(ember, ember_terrain, Some(FactionId::Fire), anchor));
        assert!(burns(ember, ember_terrain, Some(FactionId::Holy), anchor));
        assert!(burns(ember, ember_terrain, None, anchor));
        assert!(burns(
            ember,
            ember_terrain,
            faction_of_text("not-a-faction"),
            anchor
        ));
        assert!(burns(ember, ember_terrain, faction_of_text(""), anchor));
        assert!(!bad(bog, bog_terrain, Some(FactionId::Plague), anchor));
        assert!(bad(bog, bog_terrain, None, anchor));
        assert!(!bad(ice, ice_terrain, Some(FactionId::Frost), anchor));
        assert!(bad(ice, ice_terrain, None, anchor));
        // The mapping only recognizes the five actual spellings, never a fabricated faction.
        assert_eq!(faction_of_text("fire"), Some(FactionId::Fire));
        assert_eq!(faction_of_text("unknown"), None);
        assert_eq!(faction_of_text(""), None);
    }
}
