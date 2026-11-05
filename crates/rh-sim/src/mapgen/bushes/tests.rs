use super::*;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    w: usize,
    h: usize,
    seed: i64,
    attempt: u64,
    tiles: Vec<u8>,
    terrain: Vec<u8>,
    zone: Vec<u8>,
    territory_grid: Vec<u8>,
    protect: Vec<u8>,
    pool5: Vec<u8>,
    avoid: Option<Vec<u8>>,
    camps: Vec<CampSite>,
    order: Vec<Zone>,
    features: Vec<MapFeature>,
    feature_owner: Vec<u16>,
    terrain_none: u8,
}
impl Input {
    fn view(&self) -> BushInput<'_> {
        BushInput {
            w: self.w,
            h: self.h,
            seed: self.seed,
            attempt: self.attempt,
            tiles: &self.tiles,
            terrain: &self.terrain,
            zone: &self.zone,
            territory_grid: &self.territory_grid,
            protect: &self.protect,
            pool5: &self.pool5,
            avoid: self.avoid.as_deref(),
            camps: &self.camps,
            order: &self.order,
            terrain_none: self.terrain_none,
        }
    }
}
#[derive(Deserialize)]
struct Stream {
    ci: usize,
    zone: u8,
    seed: u32,
    words: Vec<u32>,
    continuation: Vec<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    input: Input,
    features: Vec<MapFeature>,
    feature_owner: Vec<u16>,
    placed: usize,
    streams: Vec<Stream>,
    main_before: Option<usize>,
    main_after: Option<usize>,
    final_verified: Option<bool>,
    name: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    format: String,
    node: String,
    platform: String,
    arch: String,
    observation_only_final_equality_verified: bool,
    cases: Vec<Case>,
    units: Vec<Case>,
}
fn fixture() -> Fixture {
    serde_json::from_str(include_str!("../fixtures/bushes.json")).unwrap()
}
fn compare(c: &Case) {
    let mut features = c.input.features.clone();
    let mut owner = c.input.feature_owner.clone();
    let before = serde_json::to_value(&c.input.features).unwrap();
    let mut words = vec![Vec::new(); c.input.camps.len()];
    let placed = place_impl(
        &default_definition(),
        &c.input.view(),
        &mut features,
        &mut owner,
        |ci, rng| {
            let word = rng.next_u32();
            words[ci].push(word);
            f64::from(word) / 4_294_967_296.0
        },
    );
    assert_eq!(placed, c.placed);
    assert_eq!(features, c.features);
    assert_eq!(owner, c.feature_owner);
    assert_eq!(
        serde_json::to_value(&features[..c.input.features.len()]).unwrap(),
        before
    );
    let elite: Vec<usize> = c
        .input
        .camps
        .iter()
        .enumerate()
        .filter_map(|(ci, c)| c.elite.then_some(ci))
        .collect();
    assert_eq!(elite, c.streams.iter().map(|s| s.ci).collect::<Vec<_>>());
    for s in &c.streams {
        let camp = &c.input.camps[s.ci];
        assert_eq!(s.zone, camp.zone);
        assert_eq!(
            s.seed,
            hash_seed(
                c.input.seed as u32,
                c.input.attempt as u32,
                u32::from(camp.zone - 1),
                default_definition().stream
                    + (s.ci as u32) * default_definition().camp_stream_stride
            )
        );
        assert_eq!(words[s.ci], s.words, "camp {}", s.ci);
        let mut rng = Mulberry32::new(s.seed);
        for &word in &s.words {
            assert_eq!(rng.next_u32(), word);
        }
        for &word in &s.continuation {
            assert_eq!(rng.next_u32(), word);
        }
    }
    let mut plain_features = c.input.features.clone();
    let mut plain_owner = c.input.feature_owner.clone();
    assert_eq!(
        place_elite_bushes(
            &default_definition(),
            &c.input.view(),
            &mut plain_features,
            &mut plain_owner
        ),
        placed
    );
    assert_eq!(plain_features, features);
    assert_eq!(plain_owner, owner);
}
#[test]
fn actual_stage11b_full_layers_and_exact_streams() {
    let f = fixture();
    assert_eq!(f.format, "rh-bushes/1");
    assert_eq!(f.node, "v22.23.4");
    assert_eq!(f.platform, "linux");
    assert_eq!(f.arch, "x64");
    assert!(f.observation_only_final_equality_verified);
    assert_eq!(f.cases.len(), 6);
    for c in &f.cases {
        assert_eq!(c.final_verified, Some(true));
        assert!(c.main_before.is_some_and(|n| n > 0));
        assert_eq!(c.main_before, c.main_after);
        assert!(c
            .input
            .features
            .iter()
            .any(|f| f.kind == FeatureKind::Landmark));
        for (ci, camp) in c.input.camps.iter().enumerate() {
            assert_eq!(c.input.zone[camp.site], camp.zone);
            assert_eq!(usize::from(c.input.territory_grid[camp.site]), ci + 1);
        }
        assert!(c.placed > 0);
        // New ownership must remain plain, unreserved floor of the referenced internal camp.
        for (t, &owner) in c.feature_owner.iter().enumerate() {
            if usize::from(owner) <= c.input.features.len() {
                continue;
            }
            let feature = &c.features[usize::from(owner - 1)];
            let ci = feature.p[0] as usize;
            assert_eq!(feature.kind, FeatureKind::Bush);
            assert_eq!(c.input.tiles[t], TILE_FLOOR);
            assert_eq!(c.input.terrain[t], c.input.terrain_none);
            assert_eq!(usize::from(c.input.territory_grid[t]), ci + 1);
            assert_eq!(c.input.zone[t], c.input.camps[ci].zone);
            assert_eq!(c.input.protect[t], 0);
            assert_eq!(c.input.pool5[t], 0);
            assert!(c.input.avoid.as_ref().is_none_or(|a| a[t] == 0));
            for u in [
                t as i64 - 1,
                t as i64 + 1,
                t as i64 - c.input.w as i64,
                t as i64 + c.input.w as i64,
            ] {
                if let Some(&other) = usize::try_from(u).ok().and_then(|u| c.feature_owner.get(u)) {
                    if other != 0 && other != owner {
                        assert_ne!(c.features[usize::from(other - 1)].kind, FeatureKind::Bush);
                    }
                }
            }
        }
        compare(c);
    }
    assert!(f.cases.iter().any(|c| c.input.seed < 0));
    assert!(f
        .cases
        .iter()
        .any(|c| c.input.attempt > u64::from(u32::MAX)));
}
#[test]
fn actual_direct_helper_boundaries() {
    let f = fixture();
    assert_eq!(f.units.len(), 4);
    for c in &f.units {
        compare(c);
    }
    let protected = f
        .units
        .iter()
        .find(|c| c.name.as_deref() == Some("all-protected-no-draw"))
        .unwrap();
    assert_eq!(protected.placed, 0);
    assert!(protected.streams.iter().all(|s| s.words.is_empty()));
    let short = f
        .units
        .iter()
        .find(|c| c.name.as_deref() == Some("undersized-patch-no-feature"))
        .unwrap();
    assert_eq!(short.placed, 0);
    assert!(short.streams.iter().any(|s| !s.words.is_empty()));
    assert!(f.units[0].placed > 0);
}
#[test]
fn visitor_covers_every_definition_field_and_runtime_uses_rules() {
    let d = default_definition();
    let mut baseline = Vec::new();
    visit_content(&d, |w| baseline.push(w));
    assert_eq!(baseline.len(), 11);
    let mut mutations = Vec::new();
    macro_rules! mutate {($($field:ident),*)=>{$(let mut changed=d;changed.$field+=1;mutations.push(changed);)*};}
    mutate!(
        stream,
        camp_stream_stride,
        patches_min,
        patches_max,
        tiles_min,
        tiles_max,
        near_min_d2,
        near_max_d2,
        centre_sep_d2,
        scan_radius,
        tries_per_patch
    );
    for (i, m) in mutations.iter().enumerate() {
        let mut words = Vec::new();
        visit_content(m, |w| words.push(w));
        assert_eq!(
            words.iter().zip(&baseline).filter(|(a, b)| a != b).count(),
            1
        );
        assert_ne!(words[i], baseline[i]);
    }
    let f = fixture();
    let c = &f.cases[0];
    let run = |rules: &BushDefinition| {
        let mut fs = c.input.features.clone();
        let mut os = c.input.feature_owner.clone();
        place_elite_bushes(rules, &c.input.view(), &mut fs, &mut os);
        (fs, os)
    };
    let baseline = run(&d);
    let mut changed = d;
    changed.stream += 1;
    assert_ne!(run(&changed), baseline);
    changed = d;
    changed.tries_per_patch = 0;
    assert_eq!(
        run(&changed),
        (c.input.features.clone(), c.input.feature_owner.clone())
    );
    changed = d;
    changed.near_min_d2 = changed.near_max_d2 + 1;
    assert!(std::panic::catch_unwind(|| run(&changed)).is_err());
}
#[test]
fn rejects_invalid_references_before_writing() {
    let f = fixture();
    let c = &f.cases[0];
    let mut fs = c.input.features.clone();
    let mut os = c.input.feature_owner.clone();
    os[0] = u16::MAX;
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| place_elite_bushes(
            &default_definition(),
            &c.input.view(),
            &mut fs,
            &mut os
        )))
        .is_err()
    );
    assert_eq!(fs, c.input.features);
}
