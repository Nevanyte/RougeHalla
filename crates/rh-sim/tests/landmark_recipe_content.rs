//! Aggregate content identity covers each live recipe input independently.
use rh_sim::content::{
    content_hash, content_hash_of_landmark_recipe_definitions, REGISTRY, STAGGER_WEAPONS,
};
use rh_sim::mapdata::FeatureJob;
use rh_sim::mapgen::landmarks::recipes::{
    self,
    direct_family::{rime, sanctum, warren},
    search_family::{gallows, scorch},
    Definitions, TemplateDefinition,
};

fn hash(d: &Definitions<'_>) -> u64 {
    content_hash_of_landmark_recipe_definitions(REGISTRY, STAGGER_WEAPONS, d)
}
#[derive(Default, Debug, PartialEq, Eq)]
struct Counts {
    scalars: [usize; 5],
    array_elements: usize,
    array_orders: usize,
    array_lengths: usize,
    key_units: usize,
    key_lengths: usize,
    row_units: usize,
    row_string_lengths: usize,
    row_list_lengths: usize,
    row_orders: usize,
    job_elements: usize,
    job_orders: usize,
    job_lengths: usize,
}
fn changed(base: u64, d: &Definitions<'_>, label: &str) {
    assert_ne!(base, hash(d), "aggregate content hash omitted {label}");
}
fn with_template<'a>(
    mut d: Definitions<'a>,
    family: usize,
    t: TemplateDefinition<'a>,
) -> Definitions<'a> {
    match family {
        0 => d.scorch.template = t,
        1 => d.gallows.template = t,
        2 => d.warren.template = t,
        3 => d.rime.template = t,
        4 => d.sanctum.template = t,
        _ => panic!("unknown recipe family"),
    };
    d
}
#[test]
fn every_recipe_input_changes_the_aggregate_content_hash() {
    let base = recipes::default_definitions();
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let mut counts = Counts::default();
    // Exhaustive destructuring makes an added Definition field require an explicit coverage decision.
    let scorch::Definition {
        template: _,
        margins: _,
        forge_disc: _,
        tries: _,
        radius_min4: _,
        radius_max4: _,
        radius_elite_max4: _,
        radius_subtract: _,
        score_margin: _,
        distance_cap: _,
        depth_min: _,
        depth_max: _,
        depth_bonus: _,
        facing_weight: _,
        noise_cell: _,
        noise_salt: _,
        noise_weight: _,
    } = base.scorch;
    {
        let mut d = base;
        d.scorch.forge_disc += 1.0;
        changed(baseline, &d, "scorch.forge_disc");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.tries += 1;
        changed(baseline, &d, "scorch.tries");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.radius_min4 += 1.0;
        changed(baseline, &d, "scorch.radius_min4");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.radius_max4 += 1.0;
        changed(baseline, &d, "scorch.radius_max4");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.radius_elite_max4 += 1.0;
        changed(baseline, &d, "scorch.radius_elite_max4");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.radius_subtract += 1.0;
        changed(baseline, &d, "scorch.radius_subtract");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.score_margin += 1.0;
        changed(baseline, &d, "scorch.score_margin");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.distance_cap += 1.0;
        changed(baseline, &d, "scorch.distance_cap");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.depth_min += 1.0;
        changed(baseline, &d, "scorch.depth_min");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.depth_max += 1.0;
        changed(baseline, &d, "scorch.depth_max");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.depth_bonus += 1.0;
        changed(baseline, &d, "scorch.depth_bonus");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.facing_weight += 1.0;
        changed(baseline, &d, "scorch.facing_weight");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.noise_cell += 1.0;
        changed(baseline, &d, "scorch.noise_cell");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.noise_salt += 1.0;
        changed(baseline, &d, "scorch.noise_salt");
        counts.scalars[0] += 1;
    }
    {
        let mut d = base;
        d.scorch.noise_weight += 1.0;
        changed(baseline, &d, "scorch.noise_weight");
        counts.scalars[0] += 1;
    }
    // Exhaustive destructuring makes an added Definition field require an explicit coverage decision.
    let gallows::Definition {
        template: _,
        far: _,
        min_separation: _,
    } = base.gallows;
    {
        let mut d = base;
        d.gallows.far += 1.0;
        changed(baseline, &d, "gallows.far");
        counts.scalars[1] += 1;
    }
    {
        let mut d = base;
        d.gallows.min_separation += 1.0;
        changed(baseline, &d, "gallows.min_separation");
        counts.scalars[1] += 1;
    }
    // Exhaustive destructuring makes an added Definition field require an explicit coverage decision.
    let warren::Definition {
        template: _,
        road_min2: _,
        roads_tried: _,
        t_permille: _,
        across: _,
        mirror_cell: _,
        mirror_salt: _,
        mirror_threshold: _,
    } = base.warren;
    {
        let mut d = base;
        d.warren.road_min2 += 1.0;
        changed(baseline, &d, "warren.road_min2");
        counts.scalars[2] += 1;
    }
    {
        let mut d = base;
        d.warren.roads_tried += 1;
        changed(baseline, &d, "warren.roads_tried");
        counts.scalars[2] += 1;
    }
    {
        let mut d = base;
        d.warren.mirror_cell += 1.0;
        changed(baseline, &d, "warren.mirror_cell");
        counts.scalars[2] += 1;
    }
    {
        let mut d = base;
        d.warren.mirror_salt += 1.0;
        changed(baseline, &d, "warren.mirror_salt");
        counts.scalars[2] += 1;
    }
    {
        let mut d = base;
        d.warren.mirror_threshold += 1.0;
        changed(baseline, &d, "warren.mirror_threshold");
        counts.scalars[2] += 1;
    }
    // Exhaustive destructuring makes an added Definition field require an explicit coverage decision.
    let rime::Definition {
        template: _,
        margin_camp: _,
        margin_edge: _,
        margin_ring: _,
        margin_landmark: _,
        clearance_slack: _,
        lake_min_clearance: _,
        second_clearance: _,
        second_sep2: _,
        two_lakes_painted: _,
        tower_beyond: _,
        tower_span: _,
        axis_penalty: _,
        local_bad_max: _,
        local_failures: _,
        fallback_tries: _,
    } = base.rime;
    {
        let mut d = base;
        d.rime.margin_camp += 1;
        changed(baseline, &d, "rime.margin_camp");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.margin_edge += 1;
        changed(baseline, &d, "rime.margin_edge");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.margin_ring += 1;
        changed(baseline, &d, "rime.margin_ring");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.margin_landmark += 1;
        changed(baseline, &d, "rime.margin_landmark");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.clearance_slack += 1;
        changed(baseline, &d, "rime.clearance_slack");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.lake_min_clearance += 1;
        changed(baseline, &d, "rime.lake_min_clearance");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.second_clearance += 1;
        changed(baseline, &d, "rime.second_clearance");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.second_sep2 += 1;
        changed(baseline, &d, "rime.second_sep2");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.two_lakes_painted += 1;
        changed(baseline, &d, "rime.two_lakes_painted");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.tower_beyond += 1.0;
        changed(baseline, &d, "rime.tower_beyond");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.tower_span += 1;
        changed(baseline, &d, "rime.tower_span");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.axis_penalty += 1.0;
        changed(baseline, &d, "rime.axis_penalty");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.local_bad_max += 1;
        changed(baseline, &d, "rime.local_bad_max");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.local_failures += 1;
        changed(baseline, &d, "rime.local_failures");
        counts.scalars[3] += 1;
    }
    {
        let mut d = base;
        d.rime.fallback_tries += 1;
        changed(baseline, &d, "rime.fallback_tries");
        counts.scalars[3] += 1;
    }
    // Exhaustive destructuring makes an added Definition field require an explicit coverage decision.
    let sanctum::Definition {
        template: _,
        hall_pitch: _,
        radius_ref: _,
        radius_min: _,
        radius_max: _,
        min_piers: _,
        pier_score: _,
        shrine_gap: _,
        extras: _,
        turn_cost: _,
        inward_cost: _,
    } = base.sanctum;
    {
        let mut d = base;
        d.sanctum.hall_pitch += 1;
        changed(baseline, &d, "sanctum.hall_pitch");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.radius_ref += 1.0;
        changed(baseline, &d, "sanctum.radius_ref");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.radius_min += 1;
        changed(baseline, &d, "sanctum.radius_min");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.radius_max += 1;
        changed(baseline, &d, "sanctum.radius_max");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.min_piers += 1;
        changed(baseline, &d, "sanctum.min_piers");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.pier_score += 1.0;
        changed(baseline, &d, "sanctum.pier_score");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.shrine_gap += 1;
        changed(baseline, &d, "sanctum.shrine_gap");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.turn_cost += 1;
        changed(baseline, &d, "sanctum.turn_cost");
        counts.scalars[4] += 1;
    }
    {
        let mut d = base;
        d.sanctum.inward_cost += 1;
        changed(baseline, &d, "sanctum.inward_cost");
        counts.scalars[4] += 1;
    }

    macro_rules! numeric_array {
        ($family:ident,$field:ident,$delta:expr) => {{
            let original = base.$family.$field;
            assert!(!original.is_empty());
            let check = |values: &[_], kind: &str| {
                let mut d: Definitions<'_> = base;
                d.$family.$field = values;
                changed(
                    baseline,
                    &d,
                    &format!("{}.{} {kind}", stringify!($family), stringify!($field)),
                );
            };
            for i in 0..original.len() {
                let mut values = original.to_vec();
                values[i] += $delta;
                check(&values, "element");
                counts.array_elements += 1;
            }
            for i in 1..original.len() {
                assert_ne!(original[i - 1], original[i]);
                let mut values = original.to_vec();
                values.swap(i - 1, i);
                check(&values, "order");
                counts.array_orders += 1;
            }
            for i in 0..original.len() {
                let mut values = original.to_vec();
                values.remove(i);
                check(&values, "removed element");
                counts.array_lengths += 1;
            }
            let mut values = original.to_vec();
            values.push(original[0]);
            check(&values, "appended element");
            counts.array_lengths += 1;
            check(&[], "empty");
            counts.array_lengths += 1;
        }};
    }
    assert_eq!(
        [
            base.scorch.margins.len(),
            base.warren.t_permille.len(),
            base.warren.across.len(),
            base.sanctum.extras.len()
        ],
        [2, 5, 5, 16]
    );
    numeric_array!(scorch, margins, 1.0);
    numeric_array!(warren, t_permille, 1.0);
    numeric_array!(warren, across, 1.0);
    numeric_array!(sanctum, extras, 1);
    let templates = [
        base.scorch.template,
        base.gallows.template,
        base.warren.template,
        base.rime.template,
        base.sanctum.template,
    ];
    assert_eq!(
        templates.map(|t| t.key),
        ["forge", "guardHouse", "burrow", "watchtower", "shrine"]
    );
    assert_eq!(templates.map(|t| t.rows.len()), [7, 7, 9, 7, 7]);
    assert_eq!(templates.map(|t| t.jobs.len()), [2; 5]);
    assert_eq!(
        templates.map(|t| t.key.encode_utf16().count()),
        [5, 10, 6, 10, 6]
    );
    assert_eq!(
        templates.map(|t| t
            .rows
            .iter()
            .map(|r| r.encode_utf16().count())
            .sum::<usize>()),
        [63, 56, 81, 56, 63]
    );
    for (family, t) in templates.into_iter().enumerate() {
        let check = |template: TemplateDefinition<'_>, kind: &str| {
            changed(
                baseline,
                &with_template(base, family, template),
                &format!("{} {kind}", t.key),
            );
        };
        let key: Vec<u16> = t.key.encode_utf16().collect();
        for i in 0..key.len() {
            let mut units = key.clone();
            units[i] ^= 1;
            let key = String::from_utf16(&units).unwrap();
            check(TemplateDefinition { key: &key, ..t }, "key UTF16 unit");
            counts.key_units += 1;
        }
        let extended = format!("{}x", t.key);
        check(
            TemplateDefinition {
                key: &extended,
                ..t
            },
            "key length",
        );
        check(TemplateDefinition { key: "", ..t }, "empty key");
        counts.key_lengths += 2;
        for (row_index, row) in t.rows.iter().enumerate() {
            let units: Vec<u16> = row.encode_utf16().collect();
            assert!(!units.is_empty());
            for unit_index in 0..units.len() {
                let mut changed_units = units.clone();
                changed_units[unit_index] ^= 1;
                let changed_row = String::from_utf16(&changed_units).unwrap();
                let mut rows = t.rows.to_vec();
                rows[row_index] = &changed_row;
                check(TemplateDefinition { rows: &rows, ..t }, "row UTF16 unit");
                counts.row_units += 1;
            }
            let longer = format!("{row}#");
            let shorter = String::from_utf16(&units[..units.len() - 1]).unwrap();
            for value in [&longer, &shorter] {
                let mut rows = t.rows.to_vec();
                rows[row_index] = value;
                check(TemplateDefinition { rows: &rows, ..t }, "row string length");
                counts.row_string_lengths += 1;
            }
            let mut rows = t.rows.to_vec();
            rows.remove(row_index);
            check(TemplateDefinition { rows: &rows, ..t }, "row removal");
            counts.row_list_lengths += 1;
        }
        let mut rows = t.rows.to_vec();
        rows.push("");
        check(TemplateDefinition { rows: &rows, ..t }, "row append");
        check(TemplateDefinition { rows: &[], ..t }, "empty row list");
        counts.row_list_lengths += 2;
        // Swapping identical rows is identical content; every pair with distinct content is checked.
        for a in 0..t.rows.len() {
            for b in a + 1..t.rows.len() {
                if t.rows[a] == t.rows[b] {
                    continue;
                }
                let mut rows = t.rows.to_vec();
                rows.swap(a, b);
                check(TemplateDefinition { rows: &rows, ..t }, "row order");
                counts.row_orders += 1;
            }
        }
        for i in 0..t.jobs.len() {
            assert_ne!(t.jobs[i], FeatureJob::Cover);
            let mut jobs = t.jobs.to_vec();
            jobs[i] = FeatureJob::Cover;
            check(TemplateDefinition { jobs: &jobs, ..t }, "job element");
            counts.job_elements += 1;
            let mut jobs = t.jobs.to_vec();
            jobs.remove(i);
            check(TemplateDefinition { jobs: &jobs, ..t }, "job removal");
            counts.job_lengths += 1;
        }
        let mut jobs = t.jobs.to_vec();
        jobs.swap(0, 1);
        check(TemplateDefinition { jobs: &jobs, ..t }, "job order");
        counts.job_orders += 1;
        let mut jobs = t.jobs.to_vec();
        jobs.push(FeatureJob::Cover);
        check(TemplateDefinition { jobs: &jobs, ..t }, "job append");
        check(TemplateDefinition { jobs: &[], ..t }, "empty jobs");
        counts.job_lengths += 2;
    }
    assert_eq!(
        counts,
        Counts {
            scalars: [15, 2, 5, 15, 9],
            array_elements: 28,
            array_orders: 24,
            array_lengths: 36,
            key_units: 37,
            key_lengths: 10,
            row_units: 319,
            row_string_lengths: 74,
            row_list_lengths: 47,
            row_orders: 111,
            job_elements: 10,
            job_orders: 5,
            job_lengths: 20
        }
    );
}
