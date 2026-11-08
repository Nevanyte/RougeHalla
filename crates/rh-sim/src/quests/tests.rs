//! The actual-source K1 quest data witness: the twenty catalog rows and their reward rules, the roster selection, the map
//! placement of givers/tokens/parcels on the maps the capture pins (seed + attempt + mapHashU32), and the wording. The
//! corpus (`parity/quests/data.json`) is captured by `tools/quest-fixtures/capture.sh` in the pinned container.
use super::{catalog, placement, roster, rules};
use crate::cards::BaseStatId;

fn load() -> serde_json::Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../parity/quests/data.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("quest corpus"))
        .expect("quest corpus json")
}

fn base_name(base: BaseStatId) -> &'static str {
    match base {
        BaseStatId::Ad => "ad",
        BaseStatId::Ap => "ap",
        BaseStatId::Haste => "haste",
        BaseStatId::Vitality => "vitality",
        BaseStatId::Armor => "armor",
        BaseStatId::Mr => "mr",
        BaseStatId::Leech => "leech",
        BaseStatId::Fleet => "fleet",
    }
}

fn assert_f64(actual: f64, expected: &serde_json::Value, what: &str) {
    let want = expected
        .as_f64()
        .unwrap_or_else(|| panic!("{what}: not a number"));
    assert_eq!(
        actual.to_bits(),
        want.to_bits(),
        "{what}: {actual} != {want}"
    );
}

#[test]
fn the_captured_catalog_rows_and_reward_rules_match_the_source() {
    let doc = load();
    assert_eq!(doc["format"], "rh-quest-data-source/1");
    let rows = doc["cases"]["catalog"].as_array().unwrap();
    assert_eq!(rows.len(), catalog::DEFINITION.len());
    for row in rows {
        let id = row["id"].as_str().unwrap();
        let def = catalog::by_id(id).unwrap_or_else(|| panic!("catalog row {id}"));
        assert_eq!(
            def.kind.as_str(),
            row["kind"].as_str().unwrap(),
            "{id} kind"
        );
        assert_eq!(def.name, row["name"].as_str().unwrap(), "{id} name");
        assert_eq!(def.giver, row["giver"].as_str().unwrap(), "{id} giver");
        assert_eq!(def.text, row["text"].as_str().unwrap(), "{id} text");
        assert_eq!(
            def.count,
            row["count"].as_u64().unwrap() as u32,
            "{id} count"
        );
        let region = row["region"]
            .as_str()
            .map(|s| crate::FactionId::parse(s).unwrap());
        assert_eq!(def.region, region, "{id} region");
        assert_eq!(
            def.far_zone,
            crate::FactionId::parse(row["farZone"].as_str().unwrap()).unwrap(),
            "{id} farZone"
        );
        assert_eq!(def.elite, row["elite"].as_bool().unwrap(), "{id} elite");
        assert_eq!(
            def.players,
            row["players"].as_bool().unwrap(),
            "{id} players"
        );
        assert_eq!(def.tour, row["tour"].as_u64().unwrap() as u32, "{id} tour");
        assert_eq!(
            def.tokens.map(|tokens| tokens.code() as u64).unwrap_or(0),
            row["tokens"]
                .as_str()
                .map(|t| match t {
                    "camp" => 1,
                    "rim" => 2,
                    "mid" => 3,
                    other => panic!("{id}: token placement {other}"),
                })
                .unwrap_or(0),
            "{id} tokens"
        );
        assert_eq!(
            def.token_spawns,
            row["tokenSpawns"].as_u64().unwrap() as u32,
            "{id} tokenSpawns"
        );
        assert_f64(def.obj_sec, &row["objSec"], id);
        assert_f64(def.travel_sec, &row["travelSec"], id);
        assert_eq!(
            def.reward_card.as_str(),
            row["rewardCard"].as_str().unwrap(),
            "{id} reward card"
        );
        assert_eq!(
            def.reward_copies,
            row["rewardCopies"].as_u64().unwrap() as u8,
            "{id} reward copies"
        );
        assert_eq!(
            def.reward_gv,
            row["rewardGv"].as_u64().unwrap() as u16,
            "{id} reward gv"
        );
        assert_f64(def.expires_at_sec, &row["expiresAtSec"], id);
        // The rules.
        assert_f64(rules::tier_points(def), &row["tierPoints"], id);
        assert_f64(rules::parity_gv(def), &row["parityGv"], id);
        assert_eq!(
            rules::tier(def),
            row["tier"].as_u64().unwrap() as u8,
            "{id} tier"
        );
        assert_eq!(
            base_name(rules::base(def)),
            row["base"].as_str().unwrap(),
            "{id} base"
        );
        for (i, feed) in doc["provenance"]["feeds"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            assert_eq!(
                rules::reward_card(def, feed.as_f64().unwrap()).as_str(),
                row["cardByFeed"].as_array().unwrap()[i].as_str().unwrap(),
                "{id} card at feed {i}"
            );
        }
        assert_eq!(
            rules::reward_copies(def),
            row["copies"].as_u64().unwrap() as u8,
            "{id} copies"
        );
        let (stat, stacks) = rules::reward_stats(def);
        assert_eq!(
            stat.as_str(),
            row["stat"]["id"].as_str().unwrap(),
            "{id} stat"
        );
        assert_eq!(
            stacks,
            row["stat"]["stacks"].as_u64().unwrap(),
            "{id} stacks"
        );
        assert_eq!(
            rules::reward_text(def),
            row["rewardText"].as_str().unwrap(),
            "{id} reward text"
        );
    }
}

fn quest_rng(words: [u32; 4]) -> crate::private_rng::Sfc32 {
    crate::private_rng::Sfc32::from_words(words)
}

fn salt_words(value: &serde_json::Value) -> [u32; 4] {
    let mut out = [0u32; 4];
    for (i, word) in value.as_array().unwrap().iter().enumerate() {
        out[i] = word.as_u64().unwrap() as u32;
    }
    out
}

#[test]
fn the_captured_rosters_match_the_source_selection() {
    let doc = load();
    let rosters = doc["cases"]["rosters"].as_object().unwrap();
    let mut seen = 0;
    for (name, rows) in rosters {
        // The capture's salts are named; the corpus carries them under `provenance`? No: replay the named salts from the
        // capture's fixed table (alpha/beta/gamma), which this test encodes as the declared seed set.
        let salt = match name.as_str() {
            "alpha" => [5, 6, 7, 8],
            "beta" => [1, 2, 3, 4],
            "gamma" => [0xdeadbeef, 0x1234_5678, 0x9abc_def0, 0x0fed_cba9],
            other => panic!("unexpected roster salt {other}"),
        };
        let mut rng = quest_rng(salt);
        let selected = roster::select_quests(&mut || rng.next_f64());
        let want = rows.as_array().unwrap();
        assert_eq!(selected.len(), want.len(), "{name} roster len");
        for (i, (entry, row)) in selected.iter().zip(want).enumerate() {
            assert_eq!(
                catalog::DEFINITION[entry.def].id,
                row["def"].as_str().unwrap(),
                "{name} roster {i} def"
            );
            assert_eq!(
                entry.known,
                row["known"].as_bool().unwrap(),
                "{name} roster {i} known"
            );
        }
        seen += 1;
    }
    assert_eq!(seen, 3);
}

fn generated_arena(map_meta: &serde_json::Value) -> crate::Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let seed = map_meta["seed"].as_i64().unwrap();
    let attempt = map_meta["attempt"].as_u64().unwrap();
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let map = generator
        .generate_styled(
            seed,
            Some(attempt),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .expect("the captured map regenerates");
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    assert_eq!(
        hash,
        map_meta["mapHashU32"].as_u64().unwrap() as u32,
        "the captured map hash"
    );
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .expect("the captured map is admitted")
    .into_arena()
    .expect("the captured map becomes an arena")
}

#[test]
fn the_captured_placements_match_the_source_on_the_pinned_maps() {
    let doc = load();
    let cases = doc["cases"]["placements"].as_object().unwrap();
    let mut arenas: Vec<(i64, crate::Arena)> = Vec::new();
    for (name, case) in cases {
        let map_meta = &case["map"];
        let seed = map_meta["seed"].as_i64().unwrap();
        if !arenas.iter().any(|(s, _)| *s == seed) {
            arenas.push((seed, generated_arena(map_meta)));
        }
        let map = &arenas
            .iter()
            .find(|(s, _)| *s == seed)
            .expect("seeded arena")
            .1
            .map;
        let salt = if name.ends_with("/alpha") {
            [5, 6, 7, 8]
        } else if name.ends_with("/beta") {
            [1, 2, 3, 4]
        } else {
            [0xdeadbeef, 0x1234_5678, 0x9abc_def0, 0x0fed_cba9]
        };
        let mut rng = quest_rng(salt);
        let selected = roster::select_quests(&mut || rng.next_f64());
        let placements = placement::place_quests(map, &selected, &mut || rng.next_f64());
        // The public placement facts the capture pins first.
        let candidates = placement::npc_candidates(map);
        assert_eq!(
            candidates.len(),
            case["candidates"].as_u64().unwrap() as usize,
            "{name} candidate count"
        );
        assert_eq!(
            placement::home_component(map),
            case["home"].as_i64().unwrap() as i32,
            "{name} home component"
        );
        let mut fold = 0u64;
        for c in &candidates {
            fold = fold
                .wrapping_mul(1_099_511_628_211)
                .wrapping_add((c.x.round() as u64).wrapping_mul(1_000_003))
                .wrapping_add(c.y.round() as u64);
        }
        assert_eq!(
            format!("{fold:x}"),
            case["candidateFold"].as_str().unwrap(),
            "{name} fold"
        );
        let want = case["placements"].as_array().unwrap();
        assert_eq!(placements.len(), want.len(), "{name} placement count");
        for (i, (p, want)) in placements.iter().zip(want).enumerate() {
            assert_eq!(
                catalog::DEFINITION[p.def].id,
                want["def"].as_str().unwrap(),
                "{name} {i} def"
            );
            assert_eq!(
                p.known,
                want["known"].as_bool().unwrap(),
                "{name} {i} known"
            );
            assert_eq!(p.at.x, want["at"]["x"].as_f64().unwrap(), "{name} {i} x");
            assert_eq!(p.at.y, want["at"]["y"].as_f64().unwrap(), "{name} {i} y");
            let tokens = want["tokens"].as_array().unwrap();
            assert_eq!(p.tokens.len(), tokens.len(), "{name} {i} tokens");
            for (t, want) in p.tokens.iter().zip(tokens) {
                assert_eq!(t.x, want["x"].as_f64().unwrap(), "{name} {i} token x");
                assert_eq!(t.y, want["y"].as_f64().unwrap(), "{name} {i} token y");
            }
            match (&p.parcel, want["parcel"].as_object()) {
                (Some(parcel), Some(want)) => {
                    assert_eq!(parcel.x, want["x"].as_f64().unwrap(), "{name} {i} parcel x");
                    assert_eq!(parcel.y, want["y"].as_f64().unwrap(), "{name} {i} parcel y");
                }
                (None, None) => {}
                other => panic!("{name} {i} parcel {other:?}"),
            }
        }
    }
}

#[test]
fn the_captured_wording_matches_the_source() {
    let doc = load();
    let phrases = &doc["cases"]["phrases"];
    let refusal = phrases["refusal"].as_object().unwrap();
    for (key, value) in rules::REFUSAL {
        assert_eq!(refusal[key].as_str().unwrap(), value, "refusal {key}");
    }
    assert_eq!(refusal.len(), rules::REFUSAL.len());
    for (i, def) in catalog::DEFINITION.iter().enumerate() {
        assert_eq!(
            rules::accepted_text(def),
            phrases["accepted"].as_array().unwrap()[i].as_str().unwrap(),
            "accepted text {}",
            def.id
        );
        assert_eq!(
            rules::accept_first_text(def),
            phrases["acceptFirst"].as_array().unwrap()[i]
                .as_str()
                .unwrap(),
            "accept-first text {}",
            def.id
        );
    }
    let salts = doc["provenance"]["mapSeeds"].as_array().unwrap();
    assert_eq!(salts.len(), 2);
    let _ = salt_words(&serde_json::json!([0, 0, 0, 0]));
}
