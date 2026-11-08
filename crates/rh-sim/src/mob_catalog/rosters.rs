//! Source `rosters.ts`, with caller-supplied draws. No native random generator or runtime spawn.
use super::{elites_of, normal_types_of, MobTypeId, DEFINITION};
use crate::FactionId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampSpec {
    pub zone: FactionId,
    pub spot_count: usize,
    pub elite_spot: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct CampMob {
    #[serde(rename = "type")]
    pub mob_type: MobTypeId,
    pub elite: bool,
}

/// Draws must obey the source Rng contract: finite in [0, 1). Zero camps consume nothing.
pub fn roll_zone_types(
    zone: FactionId,
    camp_count: usize,
    rng: &mut impl FnMut() -> f64,
) -> Vec<MobTypeId> {
    if camp_count == 0 {
        return Vec::new();
    }
    let normals: Vec<_> = normal_types_of(zone).map(|t| t.id).collect();
    let mut bag = Vec::with_capacity(normals.len() * DEFINITION.rules.bag_copies);
    for _ in 0..DEFINITION.rules.bag_copies {
        let mut round = normals.clone();
        for i in (1..round.len()).rev() {
            let draw = rng();
            assert!(
                draw.is_finite() && (0.0..1.0).contains(&draw),
                "draw outside source Rng domain"
            );
            let j = (draw * (i + 1) as f64).floor() as usize;
            round.swap(i, j);
        }
        bag.extend(round);
    }
    (0..camp_count).map(|i| bag[i % bag.len()]).collect()
}
pub fn roll_camp_types(zones: &[FactionId], rng: &mut impl FnMut() -> f64) -> Vec<MobTypeId> {
    let mut represented = Vec::new();
    for &zone in zones {
        if !represented.contains(&zone) {
            represented.push(zone);
        }
    }
    // No arbitrary placeholder mob ID: source returns an empty list for an empty map.
    let mut out = vec![None; zones.len()];
    for zone in represented {
        let indices: Vec<_> = zones
            .iter()
            .enumerate()
            .filter_map(|(i, &z)| (z == zone).then_some(i))
            .collect();
        let types = roll_zone_types(zone, indices.len(), rng);
        for (i, ty) in indices.into_iter().zip(types) {
            out[i] = Some(ty);
        }
    }
    out.into_iter()
        .map(|t| t.expect("every represented camp assigned"))
        .collect()
}
pub fn roll_camp_elites(camps: &[CampSpec]) -> Vec<Option<MobTypeId>> {
    let mut seen: Vec<(FactionId, usize)> = Vec::new();
    camps
        .iter()
        .map(|c| {
            if c.elite_spot < 0 {
                return None;
            }
            let at = match seen.iter().position(|(zone, _)| *zone == c.zone) {
                Some(i) => i,
                None => {
                    seen.push((c.zone, 0));
                    seen.len() - 1
                }
            };
            let k = seen[at].1;
            seen[at].1 += 1;
            let elites: Vec<_> = elites_of(c.zone).map(|t| t.id).collect();
            Some(elites[k % elites.len()])
        })
        .collect()
}
pub fn camp_mobs(
    camp: &CampSpec,
    camp_type: MobTypeId,
    elite_type: Option<MobTypeId>,
) -> Vec<CampMob> {
    let elite =
        elite_type.unwrap_or_else(|| elites_of(camp.zone).next().expect("zone has elite").id);
    (0..camp.spot_count)
        .map(|i| {
            let is_elite = i64::try_from(i).ok() == Some(i64::from(camp.elite_spot));
            CampMob {
                mob_type: if is_elite { elite } else { camp_type },
                elite: is_elite,
            }
        })
        .collect()
}
