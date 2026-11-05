use super::*;
use serde::Deserialize;
use std::cell::Cell;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    format: String,
    node: String,
    platform: String,
    arch: String,
    actual_source_sha256: String,
    observation_only_final_equality_verified: bool,
    prefix_rules: PrefixRules,
    cases: Vec<Case>,
    coercions: Vec<Coercion>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrefixRules {
    layout_tries: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    seed: i64,
    attempt: u64,
    styled: bool,
    initial_bits: String,
    initial_u32: u32,
    words: Vec<u32>,
    continuation: Vec<u32>,
    events: Vec<Event>,
    frame: Option<Snapshot>,
    final_verified: bool,
    final_hash: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
struct Partition {
    zone: Vec<u8>,
    cost: Vec<i32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
struct Event {
    stage: String,
    round: usize,
    draws: usize,
    partition: Option<Partition>,
    layout: Option<CampLayout>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    seed: i64,
    attempt: u64,
    pillar_variant: usize,
    order: Vec<String>,
    partition: Partition,
    layout: CampLayout,
    tiles: Vec<u8>,
    clearing: Vec<usize>,
    style_camps: Vec<StyleSnapshot>,
    layout_rounds: usize,
}
#[derive(Deserialize)]
struct StyleSnapshot {
    site: usize,
    r: f64,
    territory: u8,
    elite: bool,
}
#[derive(Deserialize)]
struct Coercion {
    bits: String,
    word: u32,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!("../fixtures/attempt-frame.json")).unwrap()
}
fn bits(s: &str) -> u64 {
    u64::from_str_radix(s, 16).unwrap()
}
fn same_state(actual: &AttemptState, expected: &Snapshot) {
    assert_eq!(
        (
            actual.seed,
            actual.attempt,
            actual.pillar_variant,
            actual.layout_rounds
        ),
        (
            expected.seed,
            expected.attempt,
            expected.pillar_variant,
            expected.layout_rounds
        )
    );
    assert_eq!(
        actual.order.iter().map(|f| f.as_str()).collect::<Vec<_>>(),
        expected.order
    );
    assert_eq!(actual.partition.zone, expected.partition.zone);
    assert_eq!(actual.partition.cost, expected.partition.cost);
    assert_eq!(actual.layout, expected.layout);
    assert_eq!(actual.tiles, expected.tiles);
    assert_eq!(actual.clearing, expected.clearing);
    assert_eq!(actual.style_camps.len(), expected.style_camps.len());
    for (a, b) in actual.style_camps.iter().zip(&expected.style_camps) {
        assert_eq!(
            (a.site, a.r.to_bits(), a.territory, a.elite),
            (b.site, b.r.to_bits(), b.territory, b.elite)
        );
    }
    assert!(
        actual.layout.camps.iter().all(|c| c.spots.is_empty()),
        "observer must capture before real stage 8 fills spots"
    );
}
#[test]
fn real_stage3_frames_retry_intermediates_and_entire_rng_transcripts_match() {
    let c = corpus();
    assert_eq!(c.format, "rh-attempt-frame/1");
    assert_eq!(
        (c.node.as_str(), c.platform.as_str(), c.arch.as_str()),
        ("v22.23.4", "linux", "x64")
    );
    assert!(c.observation_only_final_equality_verified);
    assert_eq!(
        default_definition().layout_tries,
        c.prefix_rules.layout_tries
    );
    assert_eq!(c.actual_source_sha256.len(), 64);
    assert!(c
        .actual_source_sha256
        .bytes()
        .all(|b| b.is_ascii_hexdigit()));
    assert!(c.cases.iter().any(|f| f.seed == 17));
    assert!(c.cases.iter().any(|f| f.styled));
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = AttemptContext::new(&fixed);
    for f in c.cases {
        assert!(f.final_verified);
        if let Some(hash) = f.final_hash {
            assert_eq!(hash.len(), 8);
        }
        assert_eq!(
            initial_number(f.seed, f.attempt, &context.rules).to_bits(),
            bits(&f.initial_bits)
        );
        assert_eq!(
            to_uint32(initial_number(f.seed, f.attempt, &context.rules)),
            f.initial_u32
        );
        let mut rng = Mulberry32::new(f.initial_u32);
        let mut words = Vec::new();
        let count = Cell::new(0);
        let mut events = Vec::new();
        let state = assemble(
            &context,
            f.seed,
            f.attempt,
            &mut || {
                let word = rng.next_u32();
                words.push(word);
                count.set(count.get() + 1);
                f64::from(word) / 4294967296.0
            },
            &mut |stage, round, partition, layout| {
                events.push(Event {
                    stage: match stage {
                        PrefixStage::Partition => "partition",
                        PrefixStage::Camps => "camps",
                    }
                    .into(),
                    round,
                    draws: count.get(),
                    partition: partition.map(|p| Partition {
                        zone: p.zone.clone(),
                        cost: p.cost.clone(),
                    }),
                    layout: layout.cloned(),
                })
            },
        );
        assert_eq!(words, f.words, "seed {} attempt {}", f.seed, f.attempt);
        assert_eq!(events, f.events, "retry trace seed {}", f.seed);
        let public = begin_attempt(&context, f.seed, f.attempt).unwrap();
        assert_eq!(state.as_ref(), public.as_ref().map(|p| &p.state));
        if let (Some(state), Some(expected)) = (&state, &f.frame) {
            same_state(state, expected);
        } else {
            assert!(state.is_none() && f.frame.is_none());
        }
        if let Some(frame) = public {
            assert_eq!(
                frame.rng, rng,
                "retained RNG must be the actual advanced stream"
            );
            let mut retained = frame.rng;
            assert_eq!(
                (0..8).map(|_| retained.next_u32()).collect::<Vec<_>>(),
                f.continuation
            );
        }
        assert_eq!(
            (0..8).map(|_| rng.next_u32()).collect::<Vec<_>>(),
            f.continuation
        );
    }
}
#[test]
fn javascript_uint32_coercion_matches_real_number_boundary_vectors() {
    for fixture in corpus().coercions {
        assert_eq!(to_uint32(f64::from_bits(bits(&fixture.bits))), fixture.word);
    }
}
#[test]
fn both_prefix_rules_are_hashed_and_drive_actual_execution() {
    fn words(d: &AttemptDefinition) -> Vec<u64> {
        let mut out = Vec::new();
        visit_content(d, |w| out.push(w));
        out
    }
    let d = default_definition();
    let original = words(&d);
    assert_eq!(original.len(), 2);
    let mut changed = d;
    changed.layout_tries = 1;
    assert_ne!(words(&changed), original);
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let zones = crate::mapgen::zones::default_definition();
    let camps = crate::mapgen::zones::camps::default_definition();
    let normal = AttemptContext::new(&fixed);
    let limited = AttemptContext::from_definitions(&fixed, &changed, &zones, &camps);
    assert!(begin_attempt(&limited, 17, 0).unwrap().is_none());
    assert!(begin_attempt(&normal, 17, 0).unwrap().is_some());
    changed = d;
    changed.retry_seed_stride += 1.0;
    assert_ne!(words(&changed), original);
    assert_ne!(
        to_uint32(initial_number(1, 1, &d)),
        to_uint32(initial_number(1, 1, &changed))
    );
    let changed = AttemptContext::from_definitions(&fixed, &changed, &zones, &camps);
    assert_ne!(
        begin_attempt(&normal, 1, 1).unwrap(),
        begin_attempt(&changed, 1, 1).unwrap()
    );
}
#[test]
fn null_boundaries_preserve_prefix_draws_and_safe_integer_domain() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = AttemptContext::new(&fixed);
    for seed in [
        i64::MIN,
        -9_007_199_254_740_992,
        9_007_199_254_740_992,
        i64::MAX,
    ] {
        assert_eq!(
            begin_attempt(&context, seed, 0),
            Err(AttemptInputError::SeedNotSafeInteger)
        );
    }
    assert_eq!(
        begin_attempt(&context, 1, 9_007_199_254_740_992),
        Err(AttemptInputError::AttemptNotSafeInteger)
    );
    let mut definition = default_definition();
    definition.layout_tries = 0;
    let zones = crate::mapgen::zones::default_definition();
    let camps = crate::mapgen::zones::camps::default_definition();
    let no_layouts = AttemptContext::from_definitions(&fixed, &definition, &zones, &camps);
    let mut draws = 0;
    assert!(assemble(
        &no_layouts,
        1,
        0,
        &mut || {
            draws += 1;
            0.5
        },
        &mut |_, _, _, _| {}
    )
    .is_none());
    assert_eq!(draws, 5);
    let mut disabled_camps = camps;
    disabled_camps.tries = 0;
    let all_camps_fail =
        AttemptContext::from_definitions(&fixed, &default_definition(), &zones, &disabled_camps);
    let mut rng = Mulberry32::new(1);
    let mut rounds = Vec::new();
    assert!(assemble(
        &all_camps_fail,
        1,
        0,
        &mut || rng.next_f64(),
        &mut |stage, round, _, layout| {
            if stage == PrefixStage::Camps {
                assert!(layout.is_none());
                rounds.push(round);
            }
        }
    )
    .is_none());
    assert_eq!(
        rounds,
        (1..=corpus().prefix_rules.layout_tries).collect::<Vec<_>>()
    );
    let mut zones = zones;
    zones.zone_tries = 0;
    let partition_fails =
        AttemptContext::from_definitions(&fixed, &default_definition(), &zones, &camps);
    let mut draws = 0;
    let mut events = Vec::new();
    assert!(assemble(
        &partition_fails,
        1,
        0,
        &mut || {
            draws += 1;
            0.5
        },
        &mut |stage, round, part, _| events.push((stage, round, part.is_some()))
    )
    .is_none());
    assert_eq!(draws, 5);
    assert_eq!(
        events,
        [(PrefixStage::Partition, 1, false)],
        "partition failure must not redraw"
    );
}
#[test]
fn contexts_reuse_shared_geometry_for_clearing_cells_and_style_radius() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let mut zones = crate::mapgen::zones::default_definition();
    zones.camp_radius = 4.5;
    let context = AttemptContext::from_definitions(
        &fixed,
        &default_definition(),
        &zones,
        &crate::mapgen::zones::camps::default_definition(),
    );
    assert_eq!(context.zones.camp_radius(), 4.5);
    assert!(
        context.zones.clearing_offsets().len()
            > AttemptContext::new(&fixed).zones.clearing_offsets().len()
    );
    if let Some(frame) = begin_attempt(&context, 1, 0).unwrap() {
        assert!(frame.state.style_camps.iter().all(|c| c.r == 4.5));
        assert_eq!(
            frame.state.clearing.len(),
            frame.state.layout.camps.len() * context.zones.clearing_offsets().len()
        );
    }
}
