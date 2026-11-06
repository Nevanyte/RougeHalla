use super::*;
use crate::mapgen::{coliseum, pipeline};
use crate::mob_catalog::rosters::roll_camp_types;
use crate::private_rng::Sfc32;
use serde::Deserialize;
use std::collections::BTreeMap;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    format: String,
    provenance: Provenance,
    small_map_input: SmallMap,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provenance {
    node: String,
    platform: String,
    arch: String,
    source_corpus_sha256: String,
    source_sha256: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SmallMap {
    w: u32,
    h: u32,
    seed: i64,
    border_wall: bool,
    spawns: Vec<WorldPt>,
    camps: Vec<CampDef>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    name: String,
    input: CaseInput,
    expected: Expected,
    observer_noninterference: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseInput {
    map: String,
    seed: i64,
    random_seed: u32,
    reward_salt: [u32; 4],
    training: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Expected {
    id_counter: u32,
    uid_counter: u64,
    main_draws: usize,
    hash_salt: [u32; 4],
    containers: Vec<SourceContainer>,
    rosters: Vec<Roster>,
    next_main: [f64; 4],
    next_reward: [f64; 4],
    initial_reward_next: [f64; 4],
    warm_words: WarmWords,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WarmWords {
    a: i64,
    b: i64,
    c: i64,
    d: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Roster {
    alive: u32,
    cleared_at: f64,
    elite: String,
    respawn_at: f64,
    reward: String,
    state: u8,
    r#type: String,
    ward_expires_at: f64,
    ward_owner: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceContainer {
    key: String,
    state: SourceState,
    stat_offer: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceState {
    camp: u32,
    expires_at: f64,
    id: String,
    items: Vec<SourceItem>,
    kind: String,
    label: String,
    opened: bool,
    options: Vec<String>,
    owner: String,
    pickers: Vec<String>,
    ready_at: f64,
    taken_by: Vec<String>,
    target_x: f64,
    target_y: f64,
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceItem {
    def: String,
    uid: String,
}
fn fixture() -> Fixture {
    let bytes = include_bytes!("../../../../parity/initial-world/source.json");
    let parsed: Fixture = serde_json::from_slice(bytes).unwrap();
    assert_eq!(parsed.format, "rh-initial-world/1");
    assert_eq!(
        (
            &*parsed.provenance.node,
            &*parsed.provenance.platform,
            &*parsed.provenance.arch
        ),
        ("v22.23.4", "linux", "x64")
    );
    assert_eq!(
        parsed.provenance.source_corpus_sha256,
        "8dbbe3f16e76246e682925b8d60daf6c1a5e79b5f30f5ef966f52e9cd3f07335"
    );
    assert_eq!(
        parsed
            .cases
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        [
            "full-seed1-salt-a",
            "full-seed1-salt-b",
            "full-seed1-repeat-a",
            "small-one-camp",
            "training-seed1",
            "planning-seed1"
        ]
    );
    assert!(!parsed.provenance.source_sha256.is_empty());
    assert!(parsed
        .provenance
        .source_sha256
        .values()
        .all(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())));
    parsed
}
#[derive(Default, Debug, PartialEq)]
struct Sink {
    serial: u32,
    uid: u64,
    objects: Vec<InitialContainer>,
    calls: Vec<&'static str>,
}
impl InitialSink for Sink {
    fn next_entity_id(&mut self) -> u32 {
        self.calls.push("entity");
        self.serial += 1;
        self.serial
    }
    fn next_item_uid(&mut self) -> u64 {
        self.calls.push("item");
        self.uid += 1;
        self.uid
    }
    fn insert(&mut self, object: InitialContainer) {
        self.calls.push("insert");
        self.objects.push(object)
    }
}
fn compare_object(got: &InitialContainer, expected: &SourceContainer) {
    let s = &expected.state;
    assert_eq!(expected.key, s.id);
    assert_eq!(
        got.id,
        u32::from_str_radix(s.id.strip_prefix('c').unwrap(), 36).unwrap()
    );
    assert_eq!(got.at, Vec2 { x: s.x, y: s.y });
    assert_eq!(got.opened, s.opened);
    assert!(!got.opened);
    assert_eq!(
        got.kind,
        match s.kind.as_str() {
            "chest" => Kind::Chest,
            "ground" => Kind::Ground,
            "cannon" => Kind::Cannon,
            _ => panic!("kind"),
        }
    );
    assert_eq!(got.label(), s.label);
    assert_eq!(got.stat_offer, expected.stat_offer);
    assert_eq!(got.items.len(), s.items.len());
    for (a, b) in got.items.iter().zip(&s.items) {
        assert_eq!(a.def.as_str(), b.def);
        assert_eq!(
            a.uid,
            b.uid.strip_prefix('U').unwrap().parse::<u64>().unwrap()
        );
    }
    if got.kind == Kind::Cannon {
        assert_eq!(
            got.target,
            Some(Vec2 {
                x: s.target_x,
                y: s.target_y
            })
        );
    } else {
        assert_eq!(got.target, None);
        assert_eq!((s.target_x, s.target_y), (0.0, 0.0));
    }
    assert_eq!((s.camp, s.expires_at, s.ready_at), (0, 0.0, 0.0));
    assert!(
        s.options.is_empty() && s.owner.is_empty() && s.pickers.is_empty() && s.taken_by.is_empty()
    );
}
#[test]
fn actual_source_constructor_objects_and_private_rosters() {
    let f = fixture();
    let fixed = coliseum::fixed_layout();
    let pipeline = pipeline::Pipeline::new(&fixed);
    let native = pipeline
        .generate_styled(1, None, pipeline::Options::default())
        .unwrap();
    let generated_collision = TileMap::new(native.w, native.h, native.tiles.clone()).unwrap();
    let small = &f.small_map_input;
    assert_eq!(small.seed, 1);
    assert!(small.border_wall);
    let mut tiles = vec![crate::map::TILE_FLOOR; (small.w * small.h) as usize];
    for y in 0..small.h {
        for x in 0..small.w {
            if x == 0 || y == 0 || x + 1 == small.w || y + 1 == small.h {
                tiles[(y * small.w + x) as usize] = crate::map::TILE_WALL;
            }
        }
    }
    let small_collision = TileMap::new(small.w, small.h, tiles).unwrap();
    for case in &f.cases {
        assert!(case.observer_noninterference);
        assert_eq!(case.input.seed, 1);
        let input = if case.input.map == "generated-seed1" {
            Input::from_map(&generated_collision, &native)
        } else {
            assert_eq!(case.input.map, "trusted-small-map");
            let mut i = Input::empty(&small_collision);
            i.spawns = &small.spawns;
            i.camps = &small.camps;
            i
        };
        let mut main = Mulberry32::new(case.input.random_seed);
        main.next_u32(); // createWorld orderSalt
        let mut sink = Sink::default();
        build_initial(
            &input,
            case.input.training,
            &mut main,
            case.input.reward_salt,
            &mut sink,
        )
        .unwrap();
        assert_eq!(sink.serial, case.expected.id_counter, "{}", case.name);
        assert_eq!(sink.uid, case.expected.uid_counter);
        assert_eq!(sink.objects.len(), case.expected.containers.len());
        for (got, want) in sink.objects.iter().zip(&case.expected.containers) {
            compare_object(got, want);
        }
        assert_eq!(
            mixed_salt(case.input.reward_salt, DEFINITION.gamble_tag),
            case.expected.hash_salt
        );
        let mut warm = Sfc32::from_words(case.input.reward_salt);
        let w = &case.expected.warm_words;
        let expected_words = [w.a, w.b, w.c, w.d].map(|n| {
            assert!((-2147483648..=4294967295).contains(&n));
            n as u32
        });
        assert_eq!(warm.words(), expected_words);
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|_| warm.next_f64()),
            case.expected.initial_reward_next
        );
        let mut reward = Sfc32::from_words(case.input.reward_salt);
        let zones: Vec<_> = if case.input.training {
            Vec::new()
        } else {
            input
                .camps
                .iter()
                .map(|c| crate::FactionId::parse(c.zone.as_str()).unwrap())
                .collect()
        };
        let types = roll_camp_types(&zones, &mut || reward.next_f64());
        assert_eq!(types.len(), case.expected.rosters.len());
        for (ty, row) in types.iter().zip(&case.expected.rosters) {
            assert_eq!(ty.as_str(), row.r#type);
            assert_eq!(row.state, 0);
            assert_eq!(
                (row.cleared_at, row.respawn_at, row.ward_expires_at),
                (0.0, 0.0, 0.0)
            );
            assert!(row.reward.is_empty() && row.ward_owner.is_empty());
            assert!(row.alive > 0);
            assert!(
                row.elite.is_empty() || crate::mob_catalog::MobTypeId::parse(&row.elite).is_some()
            );
        }
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|_| reward.next_f64()),
            case.expected.next_reward
        );
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|_| main.next_f64()),
            case.expected.next_main
        );
        assert!(case.expected.main_draws > 0); // Source evidence only; never used to initialize or advance native state.
        let mut loot_main = Mulberry32::new(case.input.random_seed);
        loot_main.next_u32();
        let mut loot_sink = Sink::default();
        build_loot(
            &input,
            case.input.training,
            &mut loot_main,
            case.input.reward_salt,
            &mut loot_sink,
        )
        .unwrap();
        let expected_loot: Vec<_> = case
            .expected
            .containers
            .iter()
            .filter(|c| c.state.kind != "cannon")
            .collect();
        assert_eq!(loot_sink.objects.len(), expected_loot.len());
        for (got, want) in loot_sink.objects.iter().zip(expected_loot) {
            compare_object(got, want);
        }
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|_| loot_main.next_f64()),
            case.expected.next_main
        );
        for object in &sink.objects {
            assert!(object.id > 0);
        }
    }
}
#[test]
fn malformed_late_geometry_refuses_before_any_draw_or_allocation() {
    let map = TileMap::from_rows(&["....", "....", "....", "...."]).unwrap();
    let mut input = Input::empty(&map);
    let bad = [WorldPt {
        x: f64::NAN,
        y: 1.0,
    }];
    input.ground_spots = &bad;
    let mut rng = Mulberry32::new(12);
    let before = rng.clone();
    let mut sink = Sink::default();
    assert_eq!(
        build_initial(&input, false, &mut rng, [1, 2, 3, 4], &mut sink),
        Err(Error::NonFinitePoint)
    );
    assert_eq!(rng, before);
    assert_eq!(sink, Sink::default());
}
#[test]
fn sink_gets_real_items_before_their_entity_allocation_and_empty_maps_draw_nothing() {
    let map = TileMap::from_rows(&["....", "....", "....", "...."]).unwrap();
    let mut input = Input::empty(&map);
    let spots = [WorldPt { x: 48.0, y: 48.0 }];
    input.crate_spots = &spots;
    let mut rng = Mulberry32::new(12);
    let mut sink = Sink::default();
    build_initial(&input, false, &mut rng, [1, 2, 3, 4], &mut sink).unwrap();
    assert_eq!(sink.calls, ["item", "entity", "insert"]);
    assert_eq!(sink.objects[0].items[0].def, ItemDef::PotionSmall);
    let mut rng = Mulberry32::new(12);
    let before = rng.clone();
    let mut empty = Sink::default();
    build_initial(
        &Input::empty(&map),
        false,
        &mut rng,
        [1, 2, 3, 4],
        &mut empty,
    )
    .unwrap();
    assert_eq!(rng, before);
    assert_eq!(empty, Sink::default());
}
#[test]
fn private_stream_checkpoints_continue_exactly_and_debug_hides_words() {
    let mut rng = Sfc32::from_words([u32::MAX, 0, 2147483648, 17]);
    for _ in 0..19 {
        rng.next_u32();
    }
    let json = serde_json::to_string(&rng).unwrap();
    let mut restored: Sfc32 = serde_json::from_str(&json).unwrap();
    assert_eq!(rng, restored);
    assert_eq!(
        (0..8).map(|_| rng.next_u32()).collect::<Vec<_>>(),
        (0..8).map(|_| restored.next_u32()).collect::<Vec<_>>()
    );
    assert_eq!(format!("{restored:?}"), "Sfc32 { <private> }");
}
