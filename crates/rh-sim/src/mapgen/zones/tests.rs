use super::*;
use crate::rng::Mulberry32;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    format: String,
    node: String,
    platform: String,
    arch: String,
    scan: Vec<Scan>,
    cases: Vec<Case>,
    metrics: Vec<Metric>,
    angles: Vec<Angle>,
    terminal_failure: TerminalFailure,
}
#[derive(Deserialize)]
struct TerminalFailure {
    kind: String,
    value: f64,
    draws: usize,
    success: bool,
    failures: std::collections::BTreeMap<String, usize>,
}
#[derive(Deserialize)]
struct Scan {
    seed: u32,
    success: bool,
    draws: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    seed: i64,
    attempt: u64,
    initial_u32: u32,
    prefix: bool,
    pillar: Option<usize>,
    order: Option<Vec<String>>,
    prefix_words: Vec<u32>,
    draws: usize,
    words: Vec<u32>,
    continuation: Vec<u32>,
    zone: Option<Vec<u8>>,
    cost: Option<Vec<i32>>,
    contact: Option<Vec<i32>>,
    slivers: Option<Vec<i32>>,
    label_distance: Option<Vec<i32>>,
}
#[derive(Deserialize)]
struct Metric {
    kind: String,
    mask: Vec<u8>,
    binary: Vec<i32>,
    labels: Vec<i32>,
}
#[derive(Deserialize)]
struct Angle {
    dx: String,
    dy: String,
    result: String,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!("../fixtures/zones-partition.json")).unwrap()
}
fn bits(s: &str) -> u64 {
    u64::from_str_radix(s, 16).unwrap()
}
fn prefix(rng: &mut Mulberry32, pillars: usize) -> (usize, Vec<&'static str>, Vec<u32>) {
    let mut words = Vec::new();
    let word = rng.next_u32();
    words.push(word);
    let pillar = ((f64::from(word) / 4294967296.0) * pillars as f64).floor() as usize;
    let mut order: Vec<&str> = crate::content::FactionId::ALL
        .iter()
        .map(|f| f.as_str())
        .collect();
    for i in (1..order.len()).rev() {
        let w = rng.next_u32();
        words.push(w);
        let j = ((f64::from(w) / 4294967296.0) * (i + 1) as f64).floor() as usize;
        order.swap(i, j);
    }
    (pillar, order, words)
}
#[test]
fn partitions_match_actual_full_arrays_draw_transcripts_and_continuations() {
    let c = corpus();
    assert_eq!(c.format, "rh-zone-partition/1");
    assert_eq!(
        (c.node.as_str(), c.platform.as_str(), c.arch.as_str()),
        ("v22.23.4", "linux", "x64")
    );
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = ZoneContext::new(&fixed);
    for fixture in c.cases {
        // The stage's input stream is captured after actual JS arithmetic and ToUint32;
        // this module does not claim to port the complete attempt initializer.
        let initial = if fixture.attempt == 0 {
            fixture.seed as f64
        } else {
            fixture.seed as f64 + fixture.attempt as f64 * 2654435761.0
        };
        let wrapped = ((initial % 4294967296.0) + 4294967296.0) % 4294967296.0;
        assert_eq!(fixture.initial_u32, wrapped as u32);
        let mut rng = Mulberry32::new(fixture.initial_u32);
        if fixture.prefix {
            let (pillar, order, words) = prefix(&mut rng, fixed.pillars.len());
            assert_eq!(Some(pillar), fixture.pillar);
            assert_eq!(
                Some(order.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
                fixture.order
            );
            assert_eq!(words, fixture.prefix_words);
        } else {
            assert!(fixture.prefix_words.is_empty());
        }
        let mut words = Vec::new();
        let result = partition_zones(&context, &mut || {
            let w = rng.next_u32();
            words.push(w);
            f64::from(w) / 4294967296.0
        });
        assert_eq!(
            words.len(),
            fixture.draws,
            "seed {} attempt {}",
            fixture.seed,
            fixture.attempt
        );
        assert_eq!(words, fixture.words);
        let continuation: Vec<u32> = (0..8).map(|_| rng.next_u32()).collect();
        assert_eq!(continuation, fixture.continuation);
        if let Some(part) = result {
            assert_eq!(
                Some(&part.zone),
                fixture.zone.as_ref(),
                "zone seed {}",
                fixture.seed
            );
            assert_eq!(
                Some(&part.cost),
                fixture.cost.as_ref(),
                "cost seed {}",
                fixture.seed
            );
            assert_eq!(
                Some(ring_contact(&context, &part.zone).to_vec()),
                fixture.contact
            );
            let mut dt = vec![0; N];
            assert_eq!(
                Some(sliver_counts(&context, &part.zone, &mut dt).to_vec()),
                fixture.slivers
            );
            assert_eq!(Some(dt), fixture.label_distance);
        } else {
            assert!(fixture.zone.is_none() && fixture.cost.is_none());
        }
    }
}
#[test]
fn bounded_real_seed_scan_matches_success_failure_and_retry_consumption() {
    let c = corpus();
    assert!((256..=1024).contains(&c.scan.len()));
    let f = crate::mapgen::coliseum::fixed_layout();
    let context = ZoneContext::new(&f);
    for (index, s) in c.scan.iter().enumerate() {
        assert_eq!(s.seed, index as u32);
        let mut rng = Mulberry32::new(s.seed);
        prefix(&mut rng, f.pillars.len());
        let mut draws = 0;
        let part = partition_zones(&context, &mut || {
            draws += 1;
            rng.next_f64()
        });
        assert_eq!(part.is_some(), s.success, "seed {}", s.seed);
        assert_eq!(draws, s.draws, "seed {}", s.seed);
    }
}
#[test]
fn chamfers_and_pseudo_angles_match_real_legacy_numeric_outputs() {
    let c = corpus();
    for m in c.metrics {
        let mut out = vec![0; N];
        chamfer(&m.mask, &mut out);
        assert_eq!(out, m.binary, "{} binary", m.kind);
        chamfer_labels(&m.mask, &mut out);
        assert_eq!(out, m.labels, "{} labelled", m.kind);
    }
    for a in c.angles {
        let result = pseudo_angle(f64::from_bits(bits(&a.dx)), f64::from_bits(bits(&a.dy)));
        let expected = f64::from_bits(bits(&a.result));
        if expected.is_nan() {
            assert!(result.is_nan());
        } else {
            assert_eq!(result.to_bits(), expected.to_bits());
        }
    }
}
#[test]
fn rule_content_words_cover_every_partition_tunable() {
    fn words(d: &ZoneDefinition) -> Vec<u64> {
        let mut out = Vec::new();
        visit_content(d, |w| out.push(w));
        out
    }
    let d = default_definition();
    let original = words(&d);
    assert_eq!(original.len(), 28);
    macro_rules! changed {
        ($field:ident,$value:expr) => {{
            let mut next = d;
            next.$field = $value;
            assert_ne!(words(&next), original, stringify!($field));
        }};
    }
    changed!(ring_contact_min, d.ring_contact_min + 1);
    changed!(sliver_max, d.sliver_max + 1);
    changed!(area_tolerance, d.area_tolerance + 1);
    changed!(cost_base, d.cost_base + 1);
    changed!(cost_amp, d.cost_amp + 1);
    changed!(arc_min, d.arc_min + 1);
    changed!(arc_trim, d.arc_trim + 1);
    changed!(annulus_lo, d.annulus_lo + 0.01);
    changed!(annulus_hi, d.annulus_hi + 0.01);
    changed!(annulus_edge, d.annulus_edge + 1);
    changed!(seed_candidates, d.seed_candidates + 1);
    changed!(smooth_passes, d.smooth_passes + 1);
    changed!(zone_tries, d.zone_tries + 1);
    changed!(camp_radius, d.camp_radius + 0.1);
    changed!(core_dt, d.core_dt + 1);
    changed!(balance_rounds, d.balance_rounds + 1);
    changed!(balance_tolerance, d.balance_tolerance + 1);
    changed!(arc_weight_bias, d.arc_weight_bias + 0.1);
    changed!(smooth_majority, d.smooth_majority + 1);
    changed!(peel_to_weight, d.peel_to_weight + 1);
    changed!(peel_bias, d.peel_bias + 1);
    changed!(peel_ceiling, d.peel_ceiling + 1);
    changed!(noise_coarse_scale, d.noise_coarse_scale + 1.0);
    changed!(noise_fine_scale, d.noise_fine_scale + 1.0);
    changed!(noise_reference_width, d.noise_reference_width + 1.0);
    changed!(noise_coarse_weight, d.noise_coarse_weight + 1);
    changed!(noise_fine_weight, d.noise_fine_weight + 1);
    changed!(noise_divisor, d.noise_divisor + 1);
    let f = crate::mapgen::coliseum::fixed_layout();
    let context = ZoneContext::new(&f);
    let mut rng = Mulberry32::new(1);
    let normal = partition_zones(&context, &mut || rng.next_f64());
    let mut changed_rules = d;
    changed_rules.cost_base += 1;
    let context = ZoneContext::from_definition(&f, &changed_rules);
    let mut rng = Mulberry32::new(1);
    let mutated = partition_zones(&context, &mut || rng.next_f64());
    assert_ne!(
        normal, mutated,
        "generation actually consumes hashed definition"
    );
}

#[test]
fn custom_definition_rebuilds_geometry_before_partitioning() {
    let f = crate::mapgen::coliseum::fixed_layout();
    let original = ZoneContext::new(&f);
    let mut definition = default_definition();
    definition.annulus_lo += 0.05;
    let changed = ZoneContext::from_definition(&f, &definition);
    assert_ne!(original.annulus, changed.annulus);
    definition = default_definition();
    definition.camp_radius = 3.5;
    let changed = ZoneContext::from_definition(&f, &definition);
    assert_ne!(original.clear_offsets, changed.clear_offsets);
    definition = default_definition();
    definition.zone_tries = 0;
    let changed = ZoneContext::from_definition(&f, &definition);
    let mut draws = 0;
    assert!(partition_zones(&changed, &mut || {
        draws += 1;
        0.5
    })
    .is_none());
    assert_eq!(draws, 0);
}

#[test]
fn larger_clear_radii_preserve_the_references_out_of_array_read_behavior() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    for radius in [3.5, 4.5] {
        let mut definition = default_definition();
        definition.camp_radius = radius;
        let context = ZoneContext::from_definition(&fixed, &definition);
        // Actual pinned legacy helper, with CAMP_R alone changed to this admitted custom radius.
        assert_eq!(
            sliver_counts(&context, &vec![1; N], &mut vec![0; N]),
            [0; ZONES + 1]
        );
    }
    let mut definition = default_definition();
    definition.camp_radius = 4.5;
    let context = ZoneContext::from_definition(&fixed, &definition);
    let mut rng = Mulberry32::new(1);
    let mut draws = 0;
    let result = partition_zones(&context, &mut || {
        draws += 1;
        rng.next_f64()
    })
    .unwrap();
    assert_eq!(draws, 236);
    assert_eq!(
        sliver_counts(&context, &result.zone, &mut vec![0; N]),
        [0, 0, 0, 21, 0, 0]
    );
}

#[test]
fn injected_rng_terminal_failure_matches_actual_legacy_call() {
    let c = corpus().terminal_failure;
    assert_eq!(c.kind, "injected-constant-zero");
    assert_eq!(c.value, 0.0);
    assert!(!c.success);
    assert_eq!(c.failures.get("zoneSpine"), Some(&8));
    assert_eq!(c.failures.get("A:zones"), Some(&1));
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = ZoneContext::new(&fixed);
    let mut draws = 0;
    let result = partition_zones(&context, &mut || {
        draws += 1;
        c.value
    });
    assert!(result.is_none());
    assert_eq!(draws, c.draws);
}
