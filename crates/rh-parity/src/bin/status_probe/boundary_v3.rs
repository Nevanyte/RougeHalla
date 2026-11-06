//! Trusted source input adapter for the four separately captured boundary witnesses.
//! Modifier folding uses the accepted shared kernel; no expected output supplies a runtime input.
use super::*;
use rh_sim::stat_fold::{self as fold, EffectFlag, EffectKind, EffectRow, EffectStat, MultKey};
use serde::Deserialize;
pub(super) const FARM_COEFFICIENT: f64 = 0.0025;
pub(super) const COUNT_MAX: u64 = 9_007_199_254_740_991;
const SUM_NAMES: [&str; 20] = [
    "maxHp",
    "attackSpeed",
    "moveSpeed",
    "damage",
    "windup",
    "lifesteal",
    "markRate",
    "healTaken",
    "damageTaken",
    "cooldown",
    "executeBand",
    "slowResist",
    "lifestealMult",
    "lifestealDot",
    "critChance",
    "healBarrier",
    "armor",
    "shield",
    "ad",
    "ap",
];
#[derive(Clone, Default)]
pub(super) struct Modifiers {
    pub(super) rows: Vec<EffectRow<'static>>,
    pub(super) counts: BTreeMap<String, u64>,
}
impl Modifiers {
    fn fold(&self) -> fold::Folded {
        // This is a closed trusted pre-state recipe, not mob acquisition or a new authoritative stat owner.
        let farm: Vec<_> = self
            .counts
            .values()
            .map(|count| {
                EffectRow::new(EffectKind::Stat {
                    stat: EffectStat::Lifesteal,
                    v: *count as f64 * FARM_COEFFICIENT,
                })
            })
            .collect();
        fold::fold_rows(
            &self.rows,
            &fold::FoldContext {
                farm_rows: &farm,
                ..Default::default()
            },
        )
    }
    pub(super) fn view(&self) -> rt::StatView {
        let f = self.fold();
        rt::StatView {
            slow_resist: f.sums.slow_resist.clamp(0., 1.),
            buff_move: 1.,
            dot_mult: f.mults.dot,
            crit_chance: rt::crit_chance(f.sums.crit_chance, f.flags.contains(EffectFlag::NoCrit)),
            dot_crit: f.flags.contains(EffectFlag::DotCrit),
            lifesteal_rows: f.sums.lifesteal,
            lifesteal_mult: f.sums.lifesteal_mult,
            lifesteal_dot: f.sums.lifesteal_dot.max(0.),
            farm_lifesteal_rows: f.farm_sums.lifesteal.max(0.),
            heal_taken_mult: (1. + f.sums.heal_taken).max(0.),
            mark_suppression: None,
        }
    }
    fn projection(&self, id: &str) -> V {
        let f = self.fold();
        let view = self.view();
        let sums: BTreeMap<_, _> = SUM_NAMES
            .into_iter()
            .zip(fold::StatKey::source_order())
            .map(|(name, key)| (name, f.farm_sums.get(key)))
            .collect();
        json!({"id":id,"mobStats":self.counts,"farmSums":sums,"farmLifestealRows":view.farm_lifesteal_rows,"regularLifestealRows":view.lifesteal_rows,"lifestealMult":view.lifesteal_mult,"lifestealDot":view.lifesteal_dot,"healTakenMult":view.heal_taken_mult})
    }
}
pub(super) fn rows(v: &V) -> R<Vec<EffectRow<'static>>> {
    v.as_array()
        .ok_or("rows")?
        .iter()
        .map(|row| {
            let kind = match s(&row["k"])? {
                "flag" => {
                    keys(row, &["k", "flag"])?;
                    if row["flag"] != "dotCrit" {
                        return Err("unsupported modifier flag".into());
                    }
                    EffectKind::Flag {
                        flag: EffectFlag::DotCrit,
                    }
                }
                "stat" => {
                    keys(row, &["k", "stat", "v"])?;
                    let stat = match s(&row["stat"])? {
                        "slowResist" => EffectStat::SlowResist,
                        "critChance" => EffectStat::CritChance,
                        "lifesteal" => EffectStat::Lifesteal,
                        "lifestealDot" => EffectStat::LifestealDot,
                        "lifestealMult" => EffectStat::LifestealMult,
                        "healTaken" => EffectStat::HealTaken,
                        _ => return Err("unsupported modifier stat".into()),
                    };
                    EffectKind::Stat {
                        stat,
                        v: n(&row["v"])?,
                    }
                }
                "mult" => {
                    keys(row, &["k", "key", "v"])?;
                    if row["key"] != "dot" {
                        return Err("unsupported modifier product".into());
                    }
                    EffectKind::Mult {
                        key: MultKey::Dot,
                        v: n(&row["v"])?,
                    }
                }
                _ => return Err("modifier row".into()),
            };
            Ok(EffectRow::new(kind))
        })
        .collect()
}
pub(super) fn counts(v: &V) -> R<BTreeMap<String, u64>> {
    let mut out = BTreeMap::new();
    let pairs = v.as_array().ok_or("farm count pairs")?;
    if pairs.is_empty() {
        return Err("empty farm recipe".into());
    }
    for pair in pairs {
        let pair = pair
            .as_array()
            .filter(|p| p.len() == 2)
            .ok_or("farm pair")?;
        let key = s(&pair[0])?;
        let count = pair[1]
            .as_u64()
            .filter(|n| *n <= COUNT_MAX)
            .ok_or("farm count")?;
        if key != "rotMonk" || out.insert(key.into(), count).is_some() {
            return Err("unsupported or duplicate farm key".into());
        }
    }
    Ok(out)
}
pub(super) fn map(v: &V) -> R<rh_sim::map::TileMap> {
    let rows: Vec<String> = parse(v)?;
    // Fixed source factory domain for this trusted replacement recipe, not a production map limit.
    if rows.len() != 20 || rows.iter().any(|r| r.len() != 40) {
        return Err("unsupported replacement map dimensions".into());
    }
    rh_sim::map::TileMap::from_rows(&rows).map_err(|e| e.to_string())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Collision {
    seed: u32,
    w: u32,
    h: u32,
    gates_locked: bool,
    rows: Vec<String>,
    source_map_hash: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModifierProjection {
    id: String,
    mob_stats: BTreeMap<String, u64>,
    farm_sums: BTreeMap<String, f64>,
    farm_lifesteal_rows: f64,
    regular_lifesteal_rows: f64,
    lifesteal_mult: f64,
    lifesteal_dot: f64,
    heal_taken_mult: f64,
}
pub(super) fn validate_projection(v: &V) -> R<()> {
    let c: Collision = parse(&v["collision"])?;
    if c.seed != 11 || c.gates_locked {
        return Err("unsupported collision seed/gate domain".into());
    }
    let m = map(&json!(c.rows))?;
    if m.w != c.w || m.h != c.h {
        return Err("collision shape".into());
    }
    let _ = c.source_map_hash;
    let inputs = parse::<Vec<ModifierProjection>>(&v["modifierInputs"])?;
    let ids: Vec<_> = inputs.iter().map(|p| p.id.as_str()).collect();
    let fighters: Vec<_> = v["fighters"]
        .as_array()
        .ok_or("fighters")?
        .iter()
        .filter(|p| p["role"] == "player")
        .map(|p| s(&p["id"]))
        .collect::<R<_>>()?;
    if ids != fighters {
        return Err("modifier actor order".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for p in inputs {
        if p.id.is_empty() || !seen.insert(p.id) {
            return Err("modifier identity".into());
        }
        if p.mob_stats
            .iter()
            .any(|(key, n)| key != "rotMonk" || *n > COUNT_MAX)
        {
            return Err("modifier farm input".into());
        }
        if p.farm_sums.len() != SUM_NAMES.len()
            || SUM_NAMES.iter().any(|k| !p.farm_sums.contains_key(*k))
            || p.farm_sums.values().any(|v| !v.is_finite())
        {
            return Err("farm sums shape".into());
        }
        if ![
            p.farm_lifesteal_rows,
            p.regular_lifesteal_rows,
            p.lifesteal_mult,
            p.lifesteal_dot,
            p.heal_taken_mult,
        ]
        .into_iter()
        .all(f64::is_finite)
        {
            return Err("nonfinite modifier projection".into());
        }
    }
    Ok(())
}
pub(super) fn compare(ids: &Ids, h: &Harness, source: &V, label: &str) -> R<()> {
    let runtime = &source["runtime"];
    if runtime.get("collision").is_none() {
        return Ok(());
    }
    let c: Collision = parse(&runtime["collision"])?;
    let m = &h.sim().arena().map;
    let rows: Vec<String> = m
        .tiles
        .chunks(m.w as usize)
        .map(|row| {
            row.iter()
                .map(|v| match *v {
                    0 => '.',
                    1 => '#',
                    2 => '~',
                    _ => '?',
                })
                .collect()
        })
        .collect();
    equal(
        &json!({"seed":11,"w":m.w,"h":m.h,"gatesLocked":false,"rows":rows}),
        &json!({"seed":c.seed,"w":c.w,"h":c.h,"gatesLocked":c.gates_locked,"rows":c.rows}),
        &format!("{label}/collision"),
    )?;
    // sourceMapHash also covers unowned legacy map layers. It is typed source evidence; rows are the executed collision assertion.
    let native: Vec<_> = h
        .snapshot()
        .players
        .iter()
        .map(|p| {
            ids.modifiers
                .get(&p.id.0)
                .cloned()
                .unwrap_or_default()
                .projection(ids.name(Some(p.id)))
        })
        .collect();
    equal(
        &json!(native),
        &runtime["modifierInputs"],
        &format!("{label}/modifierInputs"),
    )
}
