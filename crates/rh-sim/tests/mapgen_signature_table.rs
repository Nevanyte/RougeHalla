//! Oracle of P-MAPGEN-SIG-BLUEPRINT-2 (architecture review 2026-11-13, findings 2, 5 and 6): the per-landmark table
//! (`signature::spec`) says which feature kinds belong to each landmark; the rule-drawn landmarks are gone, so a zone
//! without a reserved site refuses the attempt; each anchor's entrance is row-major; each landmark placed alone equals
//! the same landmark placed with all the others; the terrain codes come from the terrain catalog. No generated map
//! changes but for the entrance order. No legacy counterpart (DEV-020). Brief:
//! `docs/backlog/packets/P-MAPGEN-SIG-BLUEPRINT-2.md`.
//!
//! Definitions (tile units; x to the right, y down):
//! * row-major: sorted by (y, x); strictly ascending means sorted and without repeats.
//! * a landmark on a Landmarks phase (prefix, legacy landmark stage, signature step): for zone z, every feature of the
//!   stage with zone z whose kind is one of z's member kinds (below), in feature order, each as (kind, jobs, anchor
//!   point, bbox, tile count, and every tile it owns as (index, tile, terrain of the step's terrain layer)); plus z's
//!   anchor and z's `Landed` entry (if any) of the step's `Placed`.
//!
//! The digest-neutrality guards (no generated map changes) are Part 1's, in `mapgen_signature_blueprint.rs` with their
//! pins in `tests/support/signature_pins.rs`; they digest sorted entrances and stay green without a re-pin.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::signature::blueprint::{Blueprint, EntranceRule, Write};
use rh_sim::mapgen::landmarks::signature::spec::specs;
use rh_sim::mapgen::landmarks::signature::{
    reserved_zones, Landed, Placed, SignatureContext, TerrainCodes, DEFAULT_DEFINITION,
};
use rh_sim::mapgen::landmarks::stage::LandmarkStage;
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, coliseum, pipeline, terrain_gate};
use std::collections::BTreeSet;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------------------------------------------------
// The membership today (functions, not consts: `tests/content.rs` reads consts as tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// Each landmark's member kinds and by-tile kinds as `signature/mod.rs` writes them by hand on Part 1's tree:
/// `is_signature` (the union of the member kinds), `by_tile` (the lava streams and pools), the `intact` arms (one arm
/// per member kind) and `aprons_apart` (Fire: volcano, streams, pools; Sentenced: church and graveyard; Plague: bog
/// tree; Frost: cave). The Holy hall is not a table entry (`reserved_zones` has no Holy; HOLY-1).
fn membership() -> Vec<(Zone, Vec<FeatureKind>, Vec<FeatureKind>)> {
    use FeatureKind::{BogTree, Cave, Church, Graveyard, LavaPool, LavaStream, Volcano};
    vec![
        (
            Zone::Fire,
            vec![Volcano, LavaStream, LavaPool],
            vec![LavaStream, LavaPool],
        ),
        (Zone::Sentenced, vec![Church, Graveyard], vec![]),
        (Zone::Plague, vec![BogTree], vec![]),
        (Zone::Frost, vec![Cave], vec![]),
    ]
}

fn kind_set(kinds: &[FeatureKind]) -> BTreeSet<String> {
    kinds.iter().map(|k| format!("{k:?}")).collect()
}

fn members_of(zone: Zone) -> Vec<FeatureKind> {
    membership()
        .into_iter()
        .find(|(z, _, _)| *z == zone)
        .map(|(_, m, _)| m)
        .unwrap_or_default()
}

/// The table names each landmark's member kinds and by-tile kinds, exactly today's hand-written sets: no repeats, the
/// member kinds hold every kind the entry's features write, the by-tile kinds are members (the lava streams and pools
/// on the Fire entry, none elsewhere). Red on the stub: the stub's lists are empty.
#[test]
fn the_table_names_each_landmarks_member_and_by_tile_kinds() {
    let table = specs(&DEFAULT_DEFINITION);
    let zones: Vec<Zone> = table.iter().map(|s| s.zone).collect();
    assert_eq!(
        zones,
        reserved_zones().to_vec(),
        "one entry per reserving zone"
    );
    let mut bad = Vec::new();
    for (zone, members, by_tile) in membership() {
        let s = table.iter().find(|s| s.zone == zone).unwrap();
        if s.members.len() != kind_set(&s.members).len()
            || s.by_tile.len() != kind_set(&s.by_tile).len()
        {
            bad.push(format!("{zone:?}: a kind listed twice"));
        }
        if kind_set(&s.members) != kind_set(&members) {
            bad.push(format!(
                "{zone:?}: member kinds {:?}, want {:?}",
                kind_set(&s.members),
                kind_set(&members)
            ));
        }
        if kind_set(&s.by_tile) != kind_set(&by_tile) {
            bad.push(format!(
                "{zone:?}: by-tile kinds {:?}, want {:?}",
                kind_set(&s.by_tile),
                kind_set(&by_tile)
            ));
        }
        let written: Vec<FeatureKind> = s.features.iter().map(|f| f.kind).collect();
        if !kind_set(&written).is_subset(&kind_set(&s.members)) {
            bad.push(format!(
                "{zone:?}: features {:?} not all members",
                kind_set(&written)
            ));
        }
        if !kind_set(&s.by_tile).is_subset(&kind_set(&s.members)) {
            bad.push(format!("{zone:?}: a by-tile kind that is not a member"));
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

/// Guard (green on the stub by construction: today's literals equal the catalog; it keeps the lookup honest). The
/// codes the context writes and checks for the bog, the lava, the ember and the ice are the terrain catalog's codes of
/// the kinds keyed `bog`, `lava`, `ember` and `ice` (their index in `terrain_gate::DEFAULT_DEFINITION.kinds`).
#[test]
fn guard_the_terrain_codes_are_the_catalogs() {
    let code = |key: &str| {
        let k = terrain_gate::DEFAULT_DEFINITION
            .kinds
            .iter()
            .position(|k| k.key == key);
        assert!(k.is_some(), "no terrain kind {key:?} in the catalog");
        u8::try_from(k.unwrap()).unwrap()
    };
    let fixed = coliseum::fixed_layout();
    assert_eq!(
        SignatureContext::new(&fixed).terrain_codes(),
        TerrainCodes {
            bog: code("bog"),
            lava: code("lava"),
            ember: code("ember"),
            ice: code("ice"),
        }
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated maps and Landmarks phases.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, option on, `certified_styled`: (seed, map), generated once per test binary (Part 1's guard's maps).
fn on_maps() -> &'static Vec<(i64, GameMapData)> {
    static MAPS: OnceLock<Vec<(i64, GameMapData)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let on = pipeline::Options {
            signature: true,
            ..pipeline::Options::default()
        };
        (1..=32)
            .map(|seed| {
                let m = generator
                    .certified_styled(seed, on)
                    .expect("generator error")
                    .unwrap_or_else(|| panic!("seed {seed}: no map with the option on"));
                (seed, m)
            })
            .collect()
    })
}

/// Every anchor's entrance on the seed 1-32 option-on maps is strictly ascending row-major (sorted by (y, x), no
/// repeats). Red on the stub: the stamp lands the entrance in the drawing's grid order, which the orientation turns;
/// measured on the stub, 67 of the 96 non-empty entrances (32 maps x the church, the tree and the cave; the volcano's and
/// the hall's are empty) are not row-major.
#[test]
fn every_anchors_entrance_is_row_major() {
    let (mut non_empty, mut bad) = (0, Vec::new());
    for (seed, m) in on_maps() {
        for a in &m.anchors {
            if a.entrance.is_empty() {
                continue;
            }
            non_empty += 1;
            let sorted = a
                .entrance
                .windows(2)
                .all(|w| (w[0].y, w[0].x) < (w[1].y, w[1].x));
            if !sorted {
                bad.push(format!("seed {seed} {:?}", a.zone));
            }
        }
    }
    assert!(non_empty >= 96, "only {non_empty} non-empty entrances");
    assert!(
        bad.is_empty(),
        "{} of {non_empty} non-empty entrances are not strictly row-major: {bad:?}",
        bad.len()
    );
}

/// One landmark of a Landmarks phase (see the definitions).
#[derive(Debug, PartialEq)]
struct Landmark {
    features: Vec<String>,
    cells: Vec<Vec<(usize, u8, u8)>>,
    anchor: Option<ZoneAnchor>,
    landed: Option<Landed>,
}

fn landmark(st: &LandmarkStage, placed: &Placed, zone: Zone) -> Landmark {
    let members = kind_set(&members_of(zone));
    let (mut features, mut cells) = (Vec::new(), Vec::new());
    for (k, f) in st.state.features.iter().enumerate() {
        if f.zone != zone || !members.contains(&format!("{:?}", f.kind)) {
            continue;
        }
        features.push(format!(
            "{:?} {:?} ({}, {}) {:?} {}",
            f.kind, f.jobs, f.ax, f.ay, f.bbox, f.tiles
        ));
        cells.push(
            (0..st.state.feature_owner.len())
                .filter(|&i| usize::from(st.state.feature_owner[i]) == k + 1)
                .map(|i| (i, st.state.tiles[i], placed.terrain[i]))
                .collect(),
        );
    }
    Landmark {
        features,
        cells,
        anchor: placed.anchors().find(|a| a.zone == zone).cloned(),
        landed: placed.landed().into_iter().find(|l| l.zone == zone),
    }
}

/// Each landmark placed alone from the prefix (`SignatureContext::apply_only`) equals the same landmark placed by
/// `apply` with all the others, seeds 1-16, attempts 0 and 1, every reserved zone of every accepted phase: same
/// features, owned tiles with their tile and terrain, anchor and landing; and the alone `Placed` holds that zone's anchor
/// only. This replaces the `pinned_others` digests of `mapgen_signature_scale.rs`, `_church.rs` and `_bog_tree.rs`: a
/// landmark packet pins only its own landmark.
///
/// The volcano's streams and pools leave its site but stay in the Fire zone, and every reserved site lies wholly in its
/// own zone: measured on the stub, on these 30 accepted phases no stream or pool tile lies in another zone's reserved
/// site (0 crossings), so the volcano is compared whole. Red on the stub: `apply_only` refuses every zone.
#[test]
fn each_landmark_placed_alone_equals_it_placed_with_the_others() {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let stages = stage::StageContext::new(&fixed);
    let recipes = recipes::Recipes::default();
    let step = SignatureContext::new(&fixed);
    let w = coliseum::W as i32;
    let (mut phases, mut crossings) = (0, 0);
    let mut bad = Vec::new();
    for seed in 1..=16 {
        for n in 0..2 {
            let Some(frame) =
                attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")
            else {
                continue;
            };
            let Some(mut together) = stages.apply(&frame, &recipes).expect("stage input") else {
                continue;
            };
            let Some(all) = step.apply(&frame, &mut together).expect("signature input") else {
                continue;
            };
            phases += 1;
            // Stream and pool tiles inside another zone's reserved site.
            for (k, f) in together.state.features.iter().enumerate() {
                if !matches!(f.kind, FeatureKind::LavaStream | FeatureKind::LavaPool) {
                    continue;
                }
                for i in (0..together.state.feature_owner.len())
                    .filter(|&i| usize::from(together.state.feature_owner[i]) == k + 1)
                {
                    let (x, y) = (i as i32 % w, i as i32 / w);
                    crossings += frame
                        .state
                        .reserved
                        .iter()
                        .filter(|r| r.zone != Zone::Fire)
                        .filter(|r| {
                            x >= r.rect.x
                                && x < r.rect.x + r.rect.w as i32
                                && y >= r.rect.y
                                && y < r.rect.y + r.rect.h as i32
                        })
                        .count();
                }
            }
            for r in &frame.state.reserved {
                let z = r.zone;
                let want = landmark(&together, &all, z);
                let mut st = stages
                    .apply(&frame, &recipes)
                    .expect("stage input")
                    .expect("the stage accepted this attempt once");
                let Some(alone) = step
                    .apply_only(&frame, &mut st, z)
                    .expect("signature input")
                else {
                    bad.push(format!(
                        "seed {seed} attempt {n} {z:?}: placed alone it refuses"
                    ));
                    continue;
                };
                let zones: Vec<Zone> = alone.anchors().map(|a| a.zone).collect();
                if zones != vec![z] {
                    bad.push(format!(
                        "seed {seed} attempt {n} {z:?}: alone, the anchors are {zones:?}"
                    ));
                }
                let got = landmark(&st, &alone, z);
                if got != want {
                    bad.push(format!(
                        "seed {seed} attempt {n} {z:?}: alone differs from together"
                    ));
                }
            }
        }
    }
    assert!(phases >= 28, "only {phases} accepted Landmarks phases");
    assert_eq!(
        crossings, 0,
        "stream or pool tiles in another zone's site: compare the volcano without them"
    );
    assert!(bad.is_empty(), "{} failures: {bad:#?}", bad.len());
}

/// A prefix without the signature reservation (`attempt::begin_attempt`, the option-off prefix) has no site for any
/// zone, so `apply` refuses the attempt: the rule-drawn landmarks are gone (G5: no zone is built without its site).
/// Seeds 1-8, attempt 0, every one whose prefix and legacy stage accept. Red on the stub: it draws the rule-drawn
/// volcano, church, tree and cave.
#[test]
fn without_a_reserved_site_the_attempt_is_refused() {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let stages = stage::StageContext::new(&fixed);
    let recipes = recipes::Recipes::default();
    let step = SignatureContext::new(&fixed);
    let (mut checked, mut placed) = (0, Vec::new());
    for seed in 1..=8 {
        let Some(frame) = attempt::begin_attempt(&context, seed, 0).expect("prefix input") else {
            continue;
        };
        assert!(
            frame.state.reserved.is_empty(),
            "seed {seed}: sites without the option"
        );
        let Some(mut st) = stages.apply(&frame, &recipes).expect("stage input") else {
            continue;
        };
        checked += 1;
        if step
            .apply(&frame, &mut st)
            .expect("signature input")
            .is_some()
        {
            placed.push(seed);
        }
    }
    assert!(checked >= 4, "only {checked} prefixes checked");
    assert!(
        placed.is_empty(),
        "seeds {placed:?}: landmarks placed without a reserved site"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards on the table and its drawings (green on the stub; asked for by the two reviews of Part 1).
// ---------------------------------------------------------------------------------------------------------------------

/// Guard (green on the stub). Every drawing the table ships is byte-equal to the owner-approved file under
/// `docs/landmarks/blueprints/`. The church and the tree have this check in their own files; the cave had none. An
/// entry that gains a drawing (the volcano, the hall) is added here with its approved file.
#[test]
fn guard_every_shipped_drawing_is_the_approved_file() {
    let approved = |zone: Zone| match zone {
        // P-MAPGEN-SIG-SCALE-4: the volcano's drawing (22 x 22 by the owner decision of 2026-11-14).
        Zone::Fire => Some(include_str!(
            "../../../docs/landmarks/blueprints/volcano.txt"
        )),
        Zone::Sentenced => Some(include_str!(
            "../../../docs/landmarks/blueprints/church.txt"
        )),
        Zone::Plague => Some(include_str!("../../../docs/landmarks/blueprints/bog.txt")),
        Zone::Frost => Some(include_str!("../../../docs/landmarks/blueprints/cave.txt")),
        _ => None,
    };
    for s in specs(&DEFAULT_DEFINITION) {
        let Some(shipped) = s.drawing else { continue };
        let Some(want) = approved(s.zone) else {
            panic!("{:?}: a drawing with no approved file named here", s.zone);
        };
        assert!(
            shipped == want,
            "{:?}: the shipped drawing ({} bytes) is not byte-equal to its approved file ({} bytes)",
            s.zone,
            shipped.len(),
            want.len()
        );
    }
}

/// Guard (green on the stub). In every entry, a glyph that writes a tile names a feature the entry lists, and a glyph
/// that writes nothing names none. The stamp refuses the attempt (quietly, in a release build) on a written tile no
/// feature of the entry owns: a new entry must not get that far.
#[test]
fn guard_every_writing_glyph_is_owned_by_a_feature_of_its_entry() {
    let mut bad = Vec::new();
    for s in specs(&DEFAULT_DEFINITION) {
        for g in &s.legend.0 {
            let listed = g
                .feature
                .is_some_and(|k| s.features.iter().any(|f| f.kind == k));
            let ok = match g.write {
                Write::Nothing => g.feature.is_none(),
                _ => listed,
            };
            if !ok {
                bad.push(format!("{:?} '{}'", s.zone, g.ch as char));
            }
        }
    }
    assert!(
        bad.is_empty(),
        "glyphs whose owner is not a feature of their entry: {bad:?}"
    );
}

/// Guard (green on the stub). Where the entrance is the open run of the front row (`EntranceRule::FrontRun`: the
/// church's main gate), that row holds only open tiles and one closing glyph (the church's fence `+`). The old church
/// reader counted every tile that was not `+` as gate; the table counts only tiles that write nothing. The two agree
/// while the row has no third kind of tile, so a drawing edit that puts a wall or a headstone on it is a decision, not
/// an accident.
#[test]
fn guard_a_front_run_row_is_open_tiles_and_one_closing_glyph() {
    let mut seen = 0;
    for s in specs(&DEFAULT_DEFINITION) {
        let (EntranceRule::FrontRun(_), Some(text)) = (s.entrance, s.drawing) else {
            continue;
        };
        seen += 1;
        let bp = Blueprint::parse(text, &s.legend).expect("the drawing parses");
        let (w, h) = bp.size();
        let mut closing = BTreeSet::new();
        for x in 0..w {
            let ch = bp.char_at((x, h - 1)).expect("a tile of the front row");
            let g = s.legend.glyph(ch).expect("a glyph of the legend");
            if g.write != Write::Nothing {
                closing.insert(ch as char);
            }
        }
        assert!(
            closing.len() <= 1,
            "{:?}: the front row closes with {closing:?}, want one glyph",
            s.zone
        );
    }
    assert!(seen >= 1, "no entry with a front-run entrance");
}
