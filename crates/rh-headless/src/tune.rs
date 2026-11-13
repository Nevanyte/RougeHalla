//! P-BOT-TUNER-1: the port of legacy `tune.ts` (`applyTune`: a JSON patch of the Brain's TIERS / PERSONAS numbers for a
//! tournament run) and an offline, seeded search over those same existing numbers (R-ML narrow exception, clause 2).
//!
//! What this is not: a learning system. The search moves numbers that already exist, inside stated bounds, scores each
//! proposal by headless tournament placement, and writes the best table found as a JSON file for a person to review.
//! Nothing here runs in the live server, which reads only the compiled tables (the checked-in
//! `crates/rh-policy/data/brain_tuning.json` equals them; adopting a searched table is a separate, reviewed change).
//!
//! Pure: no clock, no file I/O (the binaries read and write files); the search's draws come from its own seeded stream.
//! A patched table is installed per thread with [`with_tables`] around each game, so games may run on any worker count
//! and are folded in plan order. Each installed table is leaked once (`'static`, as the Brain holds its tables): a
//! search leaks one small table per proposal, which an offline run can afford.
use crate::tournament::{
    aggregate, aggregate_with, play_each, win_band, GameSummary, Proportion, TournamentPlan,
};
use crate::tournament_cli::lineup_text;
use crate::tournament_learning::{run_learning_game, SeatPolicy};
use rh_policy::bots::learning::LearnedBias;
use rh_policy::bots::types::{with_tables, BrainTables, PersonaParams, TierParams};
use rh_policy::bots::TierId;
use rh_sim::rng::Mulberry32;
use rh_sim::{Arena, SimConfig};
use serde_json::{json, Map, Value};

/// The format tag of a table file (the checked-in table and a search's `table`).
pub const TABLE_FORMAT: &str = "rh-brain-tuning/1";
/// The format tag of a search's output file.
pub const SEARCH_FORMAT: &str = "rh-brain-search/1";
/// The objective's weight on the persona spread (relative to the compiled spread, capped at 1).
pub const SPREAD_WEIGHT: f64 = 0.1;
/// Proposals a search draws before giving up on finding one that keeps the tier order and the persona spread.
const MAX_TRIES: u32 = 1000;

const TIER_IDS: [&str; 3] = ["easy", "normal", "hard"];
const PERSONA_IDS: [&str; 4] = ["farmer", "hunter", "opportunist", "cautious"];

/// One leaf value, typed as the table holds it.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Leaf {
    Num(f64),
    Int(u32),
    Bool(bool),
}

impl Leaf {
    fn as_f64(self) -> f64 {
        match self {
            Leaf::Num(x) => x,
            Leaf::Int(x) => f64::from(x),
            Leaf::Bool(b) => f64::from(u8::from(b)),
        }
    }
    fn json(self) -> Value {
        match self {
            Leaf::Num(x) => json!(x),
            Leaf::Int(x) => json!(x),
            Leaf::Bool(b) => json!(b),
        }
    }
}

/// The leaves of one table type, with the legacy camelCase names, in the legacy order: a getter and a setter.
macro_rules! leaves {
    ($get:ident, $set:ident, $ty:ty { $($name:literal : $($field:ident).+ => $kind:ident),* $(,)? }) => {
        fn $get(t: &$ty) -> Vec<(&'static str, Leaf)> {
            vec![$(($name, Leaf::$kind(t.$($field).+))),*]
        }
        fn $set(t: &mut $ty, name: &str, value: Leaf) -> bool {
            match (name, value) {
                $(($name, Leaf::$kind(x)) => {
                    t.$($field).+ = x;
                    true
                })*
                _ => false,
            }
        }
    };
}

leaves!(tier_leaves, set_tier_leaf, TierParams {
    "reaction.mu": reaction.mu => Num,
    "reaction.sigma": reaction.sigma => Num,
    "reaction.tau": reaction.tau => Num,
    "reaction.floor": reaction.floor => Num,
    "reaction.cap": reaction.cap => Num,
    "step.mu": step.mu => Num,
    "step.sigma": step.sigma => Num,
    "step.tau": step.tau => Num,
    "step.floor": step.floor => Num,
    "step.cap": step.cap => Num,
    "daze.mu": daze.mu => Num,
    "daze.sigma": daze.sigma => Num,
    "daze.tau": daze.tau => Num,
    "daze.floor": daze.floor => Num,
    "daze.cap": daze.cap => Num,
    "refractoryMs": refractory_ms => Num,
    "thinkMs.mean": think_ms.mean => Num,
    "thinkMs.jitter": think_ms.jitter => Num,
    "strategyMs.mean": strategy_ms.mean => Num,
    "strategyMs.jitter": strategy_ms.jitter => Num,
    "apm": apm => Num,
    "burst": burst => Num,
    "minGapMs": min_gap_ms => Num,
    "moveScatter.base": move_scatter.base => Num,
    "moveScatter.perUnit": move_scatter.per_unit => Num,
    "targetScatter.sigma": target_scatter.sigma => Num,
    "targetScatter.lagS": target_scatter.lag_s => Num,
    "targetScatter.slipP": target_scatter.slip_p => Num,
    "targetScatter.slipMult": target_scatter.slip_mult => Num,
    "minimapSigma": minimap_sigma => Num,
    "edgeClickP": edge_click_p => Num,
    "timingSigmaMs": timing_sigma_ms => Num,
    "hesitation.p": hesitation.p => Num,
    "hesitation.minMs": hesitation.min_ms => Num,
    "hesitation.maxMs": hesitation.max_ms => Num,
    "softmaxT": softmax_t => Num,
    "lapseP": lapse_p => Num,
    "dodgeP": dodge_p => Num,
    "jukeP": juke_p => Num,
    "orbwalk.p": orbwalk.p => Num,
    "orbwalk.stepU": orbwalk.step_u => Num,
    "orbwalk.angleJitter": orbwalk.angle_jitter => Num,
    "knowledge": knowledge => Num,
    "mobShareNoise": mob_share_noise => Num,
    "route.horizon": route.horizon => Int,
    "route.walkPaths": route.walk_paths => Bool,
    "route.reach": route.reach => Num,
    "attention.central": attention.central => Num,
    "attention.peripheryMult": attention.periphery_mult => Num,
    "attention.engagedMult": attention.engaged_mult => Num,
    "attention.reconsiderMs": attention.reconsider_ms => Num,
    "memorySpanMs": memory_span_ms => Num,
    "feintRead": feint_read => Num,
    "appraisal.bias": appraisal.bias => Num,
    "appraisal.lead": appraisal.lead => Num,
    "appraisal.busy": appraisal.busy => Num,
    "appraisal.hue": appraisal.hue => Num,
    "appraisal.noise": appraisal.noise => Num,
    "wary": wary => Num,
    "caution.mobShare": caution.mob_share => Num,
    "caution.eliteShare": caution.elite_share => Num,
    "caution.startHp": caution.start_hp => Num,
});

leaves!(persona_leaves, set_persona_leaf, PersonaParams {
    "pve": pve => Num,
    "pvp": pvp => Num,
    "loot": loot => Num,
    "bounty": bounty => Num,
    "thirdParty": third_party => Num,
    "engageEdge": engage_edge => Num,
    "bountyCaution": bounty_caution => Num,
    "fleeHp": flee_hp => Num,
    "reengageHp": reengage_hp => Num,
    "kite": kite => Num,
    "chaseGiveUpMs": chase_give_up_ms => Num,
    "mobKillGoal": mob_kill_goal => Num,
    "playerThreat": player_threat => Num,
    "eliteAppetite": elite_appetite => Num,
    "coliseum": coliseum => Num,
    "risk": risk => Num,
});

/// The validity range of a leaf (`tiers` or `personas`, its name): shares and probabilities in [0, 1], the appraisal
/// bias in [-1, 1], the route horizon a whole number of steps in [1, 64], everything else non-negative.
fn validity(table: &str, name: &str) -> (f64, f64) {
    let last = name.rsplit('.').next().unwrap_or(name);
    let share = if table == "tiers" {
        last == "p"
            || last.ends_with('P')
            || matches!(
                name,
                "knowledge" | "mobShareNoise" | "attention.central" | "feintRead"
            )
    } else {
        matches!(name, "fleeHp" | "reengageHp")
    };
    if name == "appraisal.bias" {
        (-1., 1.)
    } else if name == "route.horizon" {
        (1., 64.)
    } else if share {
        (0., 1.)
    } else {
        (0., 1e7)
    }
}

fn check_leaf(table: &str, name: &str, value: Leaf) -> Result<(), String> {
    let (lo, hi) = validity(table, name);
    let ok = match value {
        Leaf::Bool(_) => true,
        Leaf::Int(x) => (lo..=hi).contains(&f64::from(x)),
        Leaf::Num(x) => x.is_finite() && (lo..=hi).contains(&x),
    };
    if ok {
        Ok(())
    } else {
        Err(format!(
            "{table}.*.{name} = {} is out of bounds [{lo}, {hi}]",
            value.as_f64()
        ))
    }
}

/// Nest `a.b` names into a JSON object.
fn nest(leaves: Vec<(&'static str, Leaf)>) -> Value {
    let mut root = Map::new();
    for (name, value) in leaves {
        let mut node = &mut root;
        let mut parts = name.split('.').peekable();
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                node.insert(part.to_owned(), value.json());
            } else {
                node = node
                    .entry(part.to_owned())
                    .or_insert_with(|| Value::Object(Map::new()))
                    .as_object_mut()
                    .expect("a group");
            }
        }
    }
    Value::Object(root)
}

/// Flatten a JSON object into `a.b` leaves.
fn flatten<'a>(value: &'a Value, prefix: &str, out: &mut Vec<(String, &'a Value)>) {
    match value.as_object() {
        Some(map) => {
            for (k, v) in map {
                let path = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten(v, &path, out);
            }
        }
        None => out.push((prefix.to_owned(), value)),
    }
}

/// Read one leaf of the given kind from JSON.
fn leaf_from(table: &str, name: &str, like: Leaf, value: &Value) -> Result<Leaf, String> {
    let read = match like {
        Leaf::Bool(_) => value.as_bool().map(Leaf::Bool),
        Leaf::Num(_) => value.as_f64().map(Leaf::Num),
        Leaf::Int(_) => match value.as_f64() {
            Some(x) if x.fract() == 0. && (0. ..=f64::from(u32::MAX)).contains(&x) => {
                Some(Leaf::Int(x as u32))
            }
            Some(x) => {
                return Err(format!(
                    "{table}.*.{name} = {x} is out of bounds (a whole number)"
                ));
            }
            None => None,
        },
    };
    let read = read.ok_or_else(|| {
        format!(
            "{table}.*.{name} must be a {}",
            if matches!(like, Leaf::Bool(_)) {
                "boolean"
            } else {
                "number"
            }
        )
    })?;
    check_leaf(table, name, read)?;
    Ok(read)
}

/// The two tables as the legacy spec spells them: `{"tiers":{"easy":{...}},"personas":{"farmer":{...}}}`, every number
/// of both tables with the legacy camelCase names (no `id`).
pub fn tables_json(tables: &BrainTables) -> Value {
    let mut tiers = Map::new();
    for (id, t) in TIER_IDS.iter().zip(&tables.tiers) {
        tiers.insert((*id).to_owned(), nest(tier_leaves(t)));
    }
    let mut personas = Map::new();
    for (id, p) in PERSONA_IDS.iter().zip(&tables.personas) {
        personas.insert((*id).to_owned(), nest(persona_leaves(p)));
    }
    json!({ "tiers": tiers, "personas": personas })
}

/// Read one table entry: exactly the compiled entry's leaves, each in its validity range.
fn entry_from<T: Copy>(
    table: &str,
    id: &str,
    value: &Value,
    base: T,
    get: fn(&T) -> Vec<(&'static str, Leaf)>,
    set: fn(&mut T, &str, Leaf) -> bool,
) -> Result<T, String> {
    if !value.is_object() {
        return Err(format!("{table}.{id} is missing or not a group"));
    }
    let mut found = Vec::new();
    flatten(value, "", &mut found);
    let names = get(&base);
    if found.len() != names.len() {
        return Err(format!(
            "{table}.{id} has {} values, not {}",
            found.len(),
            names.len()
        ));
    }
    let mut out = base;
    for (name, like) in names {
        let raw = found
            .iter()
            .find(|(path, _)| path == name)
            .map(|(_, v)| *v)
            .ok_or_else(|| format!("{table}.{id}.{name} is missing"))?;
        let leaf = leaf_from(table, name, like, raw)?;
        set(&mut out, name, leaf);
    }
    Ok(out)
}

/// Read a complete table (every key present, nothing else, every value in its validity range).
pub fn tables_from_json(value: &Value) -> Result<BrainTables, String> {
    let map = value.as_object().ok_or("a table is a JSON object")?;
    if let Some(key) = map.keys().find(|k| *k != "tiers" && *k != "personas") {
        return Err(format!("unknown table key {key}"));
    }
    let mut out = BrainTables::COMPILED;
    for (i, id) in TIER_IDS.iter().enumerate() {
        out.tiers[i] = entry_from(
            "tiers",
            id,
            &value["tiers"][id],
            out.tiers[i],
            tier_leaves,
            set_tier_leaf,
        )?;
    }
    for (i, id) in PERSONA_IDS.iter().enumerate() {
        out.personas[i] = entry_from(
            "personas",
            id,
            &value["personas"][id],
            out.personas[i],
            persona_leaves,
            set_persona_leaf,
        )?;
    }
    for (group, len) in [("tiers", TIER_IDS.len()), ("personas", PERSONA_IDS.len())] {
        if value[group].as_object().map(Map::len) != Some(len) {
            return Err(format!("{group} must list exactly the compiled ids"));
        }
    }
    Ok(out)
}

/// The checked-in table file: the format tag and the tables.
pub fn table_file(tables: &BrainTables) -> Value {
    let mut value = tables_json(tables);
    value["format"] = json!(TABLE_FORMAT);
    value
}

/// Read a table file written by [`table_file`].
pub fn read_table_file(value: &Value) -> Result<BrainTables, String> {
    if value["format"] != TABLE_FORMAT {
        return Err(format!("not a {TABLE_FORMAT} table"));
    }
    let mut tables = value.clone();
    tables
        .as_object_mut()
        .expect("an object with a format")
        .remove("format");
    tables_from_json(&tables)
}

/// Every leaf of the tables as `tiers.easy.reaction.mu` paths, in table order.
pub fn leaf_paths() -> Vec<String> {
    let c = BrainTables::COMPILED;
    let mut out = Vec::new();
    for (id, t) in TIER_IDS.iter().zip(&c.tiers) {
        out.extend(
            tier_leaves(t)
                .into_iter()
                .map(|(n, _)| format!("tiers.{id}.{n}")),
        );
    }
    for (id, p) in PERSONA_IDS.iter().zip(&c.personas) {
        out.extend(
            persona_leaves(p)
                .into_iter()
                .map(|(n, _)| format!("personas.{id}.{n}")),
        );
    }
    out
}

/// A path's table, entry index and leaf name.
fn parse_path(path: &str) -> Option<(&'static str, usize, &str)> {
    let mut parts = path.splitn(3, '.');
    let table = parts.next()?;
    let id = parts.next()?;
    let name = parts.next()?;
    match table {
        "tiers" => Some(("tiers", TIER_IDS.iter().position(|t| *t == id)?, name)),
        "personas" => Some(("personas", PERSONA_IDS.iter().position(|p| *p == id)?, name)),
        _ => None,
    }
}

fn leaf_of(tables: &BrainTables, path: &str) -> Option<(&'static str, Leaf)> {
    let (table, i, name) = parse_path(path)?;
    let leaves = if table == "tiers" {
        tier_leaves(&tables.tiers[i])
    } else {
        persona_leaves(&tables.personas[i])
    };
    leaves.into_iter().find(|(n, _)| *n == name)
}

/// One leaf's value (a bool reads as 0/1).
pub fn leaf(tables: &BrainTables, path: &str) -> Option<f64> {
    leaf_of(tables, path).map(|(_, v)| v.as_f64())
}

/// Set a numeric leaf (a whole-number leaf is rounded).
fn set_leaf(tables: &mut BrainTables, path: &str, value: f64) {
    let Some((table, i, name)) = parse_path(path) else {
        return;
    };
    let Some((_, like)) = leaf_of(tables, path) else {
        return;
    };
    let leaf = match like {
        Leaf::Num(_) => Leaf::Num(value),
        Leaf::Int(_) => Leaf::Int(value.round() as u32),
        Leaf::Bool(_) => return,
    };
    if table == "tiers" {
        set_tier_leaf(&mut tables.tiers[i], name, leaf);
    } else {
        set_persona_leaf(&mut tables.personas[i], name, leaf);
    }
}

/// Source tune.ts `merge`: plain values into keys the target already has.
fn merge(
    target: &mut Map<String, Value>,
    patch: &Map<String, Value>,
    path: &str,
) -> Result<(), String> {
    for (k, v) in patch {
        let Some(old) = target.get_mut(k) else {
            return Err(format!("--tune: unknown key {path}.{k}"));
        };
        match (v.as_object(), old.is_object()) {
            (Some(group), true) => merge(
                old.as_object_mut().expect("a group"),
                group,
                &format!("{path}.{k}"),
            )?,
            (Some(_), false) => return Err(format!("--tune: {path}.{k} is not a group")),
            (None, true) => {
                return Err(format!("--tune: {path}.{k} is a group, not a value"));
            }
            (None, false) => {
                if old.is_boolean() && !v.is_boolean() {
                    return Err(format!("--tune: {path}.{k} must be a boolean"));
                }
                if old.is_number() && !v.is_number() {
                    return Err(format!("--tune: {path}.{k} must be a number"));
                }
                *old = v.clone();
            }
        }
    }
    Ok(())
}

/// The table checks every searched or patched table passes: the tier order (unless an ablation) and the spread floor.
fn check_tables(tables: &BrainTables, ablation: bool) -> Result<(), String> {
    let broken = tier_order_violations(tables);
    if !ablation && !broken.is_empty() {
        return Err(format!(
            "--tune: the patch breaks the tier order on {} (an ablation diagnostic says \"ablation\": true)",
            broken.join(", ")
        ));
    }
    let spread = persona_spread(tables);
    if spread < spread_floor() {
        return Err(format!(
            "--tune: the personas' spread {spread} is below the floor {}",
            spread_floor()
        ));
    }
    Ok(())
}

/// Source `applyTune(spec)`, on a copy: deep-merge plain numbers and booleans into keys the tables already have. An
/// unknown tier, persona or key, a group where a number is (or the reverse), a wrong type or a value outside its validity
/// range is refused, as is a result that breaks the tier order (unless the spec says `"ablation": true`) or brings two
/// personas closer than [`spread_floor`].
pub fn apply_tune(base: &BrainTables, spec: &Value) -> Result<BrainTables, String> {
    let spec = spec
        .as_object()
        .ok_or("--tune: the spec is a JSON object")?;
    let mut ablation = false;
    let mut doc = tables_json(base);
    for (key, value) in spec {
        match key.as_str() {
            "ablation" => {
                ablation = value
                    .as_bool()
                    .ok_or("--tune: ablation must be a boolean")?;
            }
            "tiers" | "personas" => {
                let entries = value
                    .as_object()
                    .ok_or_else(|| format!("--tune: {key} is not a group"))?;
                let what = if key == "tiers" { "tier" } else { "persona" };
                for (id, patch) in entries {
                    let Some(target) = doc[key.as_str()].get_mut(id) else {
                        return Err(format!("--tune: unknown {what} {id}"));
                    };
                    let patch = patch
                        .as_object()
                        .ok_or_else(|| format!("--tune: {key}.{id} is not a group"))?;
                    merge(
                        target.as_object_mut().expect("a table entry"),
                        patch,
                        &format!("{key}.{id}"),
                    )?;
                }
            }
            other => return Err(format!("--tune: unknown spec key {other}")),
        }
    }
    let tables = tables_from_json(&doc).map_err(|e| format!("--tune: {e}"))?;
    check_tables(&tables, ablation)?;
    Ok(tables)
}

/// The tier-ordered leaves the tables break: a leaf whose compiled values run easy -> normal -> hard in one direction
/// must keep that (weak) direction.
pub fn tier_order_violations(tables: &BrainTables) -> Vec<String> {
    let c = BrainTables::COMPILED;
    let compiled: Vec<Vec<(&str, Leaf)>> = c.tiers.iter().map(tier_leaves).collect();
    let now: Vec<Vec<(&str, Leaf)>> = tables.tiers.iter().map(tier_leaves).collect();
    let mut out = Vec::new();
    for j in 0..compiled[0].len() {
        let v = |rows: &Vec<Vec<(&str, Leaf)>>, i: usize| rows[i][j].1.as_f64();
        let (e, n, h) = (v(&compiled, 0), v(&compiled, 1), v(&compiled, 2));
        let up = e <= n && n <= h && e < h;
        let down = e >= n && n >= h && e > h;
        let (pe, pn, ph) = (v(&now, 0), v(&now, 1), v(&now, 2));
        let broken = (up && !(pe <= pn && pn <= ph)) || (down && !(pe >= pn && pn >= ph));
        if broken {
            out.push(format!("tiers.*.{}", compiled[0][j].0));
        }
    }
    out
}

/// How distinct the four personas are: the smallest pairwise RMS distance over the persona leaves, each leaf scaled by
/// its largest compiled magnitude.
pub fn persona_spread(tables: &BrainTables) -> f64 {
    let compiled: Vec<Vec<f64>> = BrainTables::COMPILED
        .personas
        .iter()
        .map(|p| {
            persona_leaves(p)
                .into_iter()
                .map(|(_, v)| v.as_f64())
                .collect()
        })
        .collect();
    let rows: Vec<Vec<f64>> = tables
        .personas
        .iter()
        .map(|p| {
            persona_leaves(p)
                .into_iter()
                .map(|(_, v)| v.as_f64())
                .collect()
        })
        .collect();
    let scale: Vec<f64> = (0..compiled[0].len())
        .map(|j| {
            let m = compiled.iter().map(|r| r[j].abs()).fold(0., f64::max);
            if m > 0. {
                m
            } else {
                1.
            }
        })
        .collect();
    let mut spread = f64::INFINITY;
    for a in 0..rows.len() {
        for b in a + 1..rows.len() {
            let sum: f64 = (0..scale.len())
                .map(|j| {
                    let d = (rows[a][j] - rows[b][j]) / scale[j];
                    d * d
                })
                .sum();
            spread = spread.min((sum / scale.len() as f64).sqrt());
        }
    }
    spread
}

/// The least spread a table may have: half the compiled tables' spread.
pub fn spread_floor() -> f64 {
    persona_spread(&BrainTables::COMPILED) / 2.
}

/// The search bounds of one leaf: half to one and a half times its compiled value, inside its validity range (a zero
/// or boolean leaf is not searched: None).
pub fn search_bounds(path: &str) -> Option<(f64, f64)> {
    let (table, _, name) = parse_path(path)?;
    let (_, value) = leaf_of(&BrainTables::COMPILED, path)?;
    let d = match value {
        Leaf::Bool(_) => return None,
        other => other.as_f64(),
    };
    if d == 0. {
        return None;
    }
    let (vlo, vhi) = validity(table, name);
    let lo = (0.5 * d).min(1.5 * d).max(vlo);
    let hi = (0.5 * d).max(1.5 * d).min(vhi);
    match value {
        Leaf::Int(_) => Some((lo.ceil(), hi.floor())),
        _ => Some((lo, hi)),
    }
}

/// The tables a plan's `tune` patch asks for (None: no patch), leaked once for [`with_tables`].
pub fn plan_tables(plan: &TournamentPlan) -> Result<Option<&'static BrainTables>, String> {
    match &plan.tune {
        None => Ok(None),
        Some(spec) => {
            let tables = apply_tune(&BrainTables::COMPILED, spec)?;
            Ok(Some(Box::leak(Box::new(tables))))
        }
    }
}

/// `f` with `tables` installed when there are any.
pub(crate) fn scoped<R>(tables: Option<&'static BrainTables>, f: impl FnOnce() -> R) -> R {
    match tables {
        Some(tables) => with_tables(tables, f),
        None => f(),
    }
}

/// Play the plan with `policy` seats reading `tables` (the plan's own `tune` is ignored here).
pub fn play_tuned(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
    tables: &'static BrainTables,
) -> Vec<GameSummary> {
    let plan = TournamentPlan {
        tune: None,
        ..plan.clone()
    };
    play_each(&plan, plan.workers, |index| {
        with_tables(tables, || {
            run_learning_game(index, &plan, arena, sim, policy, &LearnedBias::NO_BIAS).summary
        })
    })
}

/// The objective of a played table: minus each tier's distance from its legacy win band (`tournament::win_band`), plus
/// [`SPREAD_WEIGHT`] times the table's spread relative to the compiled spread (capped at 1).
pub fn objective(games: &[GameSummary], tables: &BrainTables) -> f64 {
    let report = aggregate(games);
    let mut miss = 0.;
    for tier in &report.tiers {
        let p = tier.win_rate.p;
        if tier.bot_games > 0. && p.is_finite() {
            let (lo, hi) = win_band(tier.tier);
            miss += (lo - p).max(0.) + (p - hi).max(0.);
        }
    }
    let spread = (persona_spread(tables) / persona_spread(&BrainTables::COMPILED)).min(1.);
    -miss + SPREAD_WEIGHT * spread
}

/// A search's settings.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchConfig {
    pub seed: u32,
    pub generations: u32,
    /// Proposals per generation.
    pub population: u32,
    /// Leaves changed per proposal.
    pub changes: u32,
    /// Largest step, as a share of a leaf's bound width.
    pub step: f64,
    pub plan: TournamentPlan,
    pub policy: SeatPolicy,
    /// The commit the search ran on (written into the file).
    pub commit: String,
}

/// One scored table of a search.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub generation: u32,
    /// The leaves this proposal changed from the table it was drawn from, with their new values.
    pub changed: Vec<(String, f64)>,
    pub score: f64,
    pub spread: f64,
    /// It became the current table.
    pub accepted: bool,
}

/// What a search found.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchResult {
    pub best: BrainTables,
    pub best_score: f64,
    /// The compiled tables' score under the same plan (generation 0).
    pub baseline_score: f64,
    pub candidates: Vec<Candidate>,
}

fn evaluate(config: &SearchConfig, arena: &Arena, sim: &SimConfig, tables: BrainTables) -> f64 {
    let installed: &'static BrainTables = Box::leak(Box::new(tables));
    let games = play_tuned(&config.plan, arena, sim, config.policy, installed);
    objective(&games, &tables)
}

/// Draw one proposal from `current`: `changes` searchable leaves, each moved by a uniform step of at most `step` of its
/// bound width and clamped to its bounds; redrawn until the table keeps the tier order and the spread floor.
fn propose(
    rng: &mut Mulberry32,
    config: &SearchConfig,
    current: &BrainTables,
    searchable: &[(String, f64, f64)],
) -> Option<(BrainTables, Vec<(String, f64)>)> {
    for _ in 0..MAX_TRIES {
        let mut table = *current;
        let mut changed: Vec<(String, f64)> = Vec::new();
        for _ in 0..config.changes.max(1) {
            let j = ((rng.next_f64() * searchable.len() as f64) as usize).min(searchable.len() - 1);
            let (path, lo, hi) = &searchable[j];
            let old = leaf(&table, path).expect("a searchable leaf");
            let delta = (rng.next_f64() * 2. - 1.) * config.step * (hi - lo);
            set_leaf(&mut table, path, (old + delta).clamp(*lo, *hi));
            let new = leaf(&table, path).expect("a searchable leaf");
            match changed.iter_mut().find(|(p, _)| p == path) {
                Some(entry) => entry.1 = new,
                None => changed.push((path.clone(), new)),
            }
        }
        changed.retain(|(path, value)| leaf(current, path) != Some(*value));
        if !changed.is_empty() && check_tables(&table, false).is_ok() {
            return Some((table, changed));
        }
    }
    None
}

/// A seeded (1+lambda) hill-climb from the compiled tables: each generation draws `population` proposals from the
/// current table, scores each by a tournament of the plan, and moves to the best of them if it beats the current score.
pub fn search(config: &SearchConfig, arena: &Arena, sim: &SimConfig) -> SearchResult {
    let mut rng = Mulberry32::new(config.seed);
    let searchable: Vec<(String, f64, f64)> = leaf_paths()
        .into_iter()
        .filter_map(|p| search_bounds(&p).map(|(lo, hi)| (p, lo, hi)))
        .filter(|(_, lo, hi)| hi > lo)
        .collect();
    let mut current = BrainTables::COMPILED;
    let baseline_score = evaluate(config, arena, sim, current);
    let mut current_score = baseline_score;
    let mut candidates = Vec::new();
    for generation in 1..=config.generations {
        let first = candidates.len();
        let mut best: Option<(usize, BrainTables, f64)> = None;
        for _ in 0..config.population {
            let Some((table, changed)) = propose(&mut rng, config, &current, &searchable) else {
                continue;
            };
            let score = evaluate(config, arena, sim, table);
            candidates.push(Candidate {
                generation,
                changed,
                score,
                spread: persona_spread(&table),
                accepted: false,
            });
            if best.as_ref().is_none_or(|(_, _, s)| score > *s) {
                best = Some((candidates.len() - 1, table, score));
            }
        }
        if let Some((index, table, score)) = best {
            if score > current_score && index >= first {
                current = table;
                current_score = score;
                candidates[index].accepted = true;
            }
        }
    }
    SearchResult {
        best: current,
        best_score: current_score,
        baseline_score,
        candidates,
    }
}

/// The plan as the output files record it.
fn plan_json(plan: &TournamentPlan, policy: SeatPolicy) -> Value {
    json!({
        "games": plan.games,
        "seed": plan.seed,
        "lineup": lineup_text(&plan.tiers),
        "persona": plan.persona.as_str(),
        "faction": plan.faction.as_str(),
        "maxSimMs": plan.max_sim_ms,
        "patienceSeconds": plan.patience_seconds,
        "suddenDeathSeconds": plan.sudden_death_seconds,
        "policy": policy.as_str(),
    })
}

/// The search's output file: seed, commit, plan, objective, bounds, every candidate, and the best table.
pub fn search_file(config: &SearchConfig, result: &SearchResult) -> Value {
    let mut bounds = Map::new();
    for path in leaf_paths() {
        if let Some((lo, hi)) = search_bounds(&path) {
            bounds.insert(path, json!([lo, hi]));
        }
    }
    let bands: Map<String, Value> = crate::tournament::TIER_IDS
        .iter()
        .map(|t| {
            let (lo, hi) = win_band(*t);
            (t.as_str().to_owned(), json!([lo, hi]))
        })
        .collect();
    json!({
        "format": SEARCH_FORMAT,
        "seed": config.seed,
        "commit": config.commit,
        "plan": plan_json(&config.plan, config.policy),
        "objective": {
            "text": "maximise: minus the sum over tiers of each tier's distance from its legacy win band \
                     (tournament::win_band; a win is placement 1), plus spreadWeight times the persona spread \
                     relative to the compiled spread, capped at 1",
            "winBands": bands,
            "spreadWeight": SPREAD_WEIGHT,
            "spreadFloor": spread_floor(),
            "compiledSpread": persona_spread(&BrainTables::COMPILED),
        },
        "search": {
            "method": "seeded (1+lambda) hill-climb from the compiled tables (Mulberry32)",
            "generations": config.generations,
            "population": config.population,
            "changes": config.changes,
            "step": config.step,
        },
        "bounds": bounds,
        "baselineScore": result.baseline_score,
        "bestScore": result.best_score,
        "candidates": result.candidates.iter().map(|c| json!({
            "generation": c.generation,
            "changed": c.changed.iter().map(|(p, v)| json!([p, v])).collect::<Vec<_>>(),
            "score": c.score,
            "spread": c.spread,
            "accepted": c.accepted,
        })).collect::<Vec<_>>(),
        "table": table_file(&result.best),
    })
}

/// How a table's per-tier win interval compares with the baseline's (both over the same games).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Better,
    Worse,
    NotDistinguishable,
}

impl Verdict {
    /// "better", "worse" or "not distinguishable".
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Better => "better",
            Verdict::Worse => "worse",
            Verdict::NotDistinguishable => "not distinguishable",
        }
    }
}

/// Better when the best table's lower bound is strictly above the baseline's upper bound, worse when its upper bound is
/// strictly below the baseline's lower bound, otherwise (and for an empty tier, whose bounds are NaN) not
/// distinguishable.
pub fn verdict(best: &Proportion, baseline: &Proportion) -> Verdict {
    if best.lo > baseline.hi {
        Verdict::Better
    } else if best.hi < baseline.lo {
        Verdict::Worse
    } else {
        Verdict::NotDistinguishable
    }
}

/// One tier's win proportions for the baseline and a candidate table over the same games, and the verdict.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TierComparison {
    pub tier: TierId,
    pub baseline: Proportion,
    pub best: Proportion,
    pub verdict: Verdict,
}

/// Play `plan` once with `baseline` and once with `candidate` (the same games) and compare per tier, in tier order.
pub fn compare_tables(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
    baseline: &BrainTables,
    candidate: &BrainTables,
) -> Vec<TierComparison> {
    let play = |tables: &BrainTables| {
        let installed: &'static BrainTables = Box::leak(Box::new(*tables));
        let games = play_tuned(plan, arena, sim, policy, installed);
        aggregate_with(&games, tables)
    };
    let base = play(baseline);
    let best = play(candidate);
    base.tiers
        .iter()
        .filter_map(|b| {
            let c = best.tiers.iter().find(|c| c.tier == b.tier)?;
            Some(TierComparison {
                tier: b.tier,
                baseline: b.win_rate,
                best: c.win_rate,
                verdict: verdict(&c.win_rate, &b.win_rate),
            })
        })
        .collect()
}

/// The held-out re-score: the seed and the per-tier comparison (shipped tables against the best table).
#[derive(Clone, Debug, PartialEq)]
pub struct HeldOut {
    pub seed: u32,
    pub tiers: Vec<TierComparison>,
}

/// What a search's output file adds in P-BOT-TUNER-2.
#[derive(Clone, Debug, PartialEq)]
pub struct Evidence {
    pub baseline_spread: f64,
    pub best_spread: f64,
    /// Baseline against best on the search's own plan (the seeds the search used: optimistic).
    pub search: Vec<TierComparison>,
    pub held_out: Option<HeldOut>,
}

/// A held-out seed must differ from the search's own seeds (`--seed`, `--tournament-seed`).
pub fn check_held_out_seed(config: &SearchConfig, seed: u32) -> Result<(), String> {
    if seed == config.plan.seed {
        return Err(format!(
            "held-out seed {seed} equals --tournament-seed: the held-out seed must differ from every search seed"
        ));
    }
    if seed == config.seed {
        return Err(format!(
            "held-out seed {seed} equals --seed: the held-out seed must differ from every search seed"
        ));
    }
    Ok(())
}

/// Compare the best table with the shipped tables on the search's plan and, given a seed, on a held-out seed.
pub fn evidence(
    config: &SearchConfig,
    result: &SearchResult,
    arena: &Arena,
    sim: &SimConfig,
    held_out_seed: Option<u32>,
) -> Result<Evidence, String> {
    if let Some(seed) = held_out_seed {
        check_held_out_seed(config, seed)?;
    }
    let baseline = BrainTables::COMPILED;
    let search = compare_tables(
        &config.plan,
        arena,
        sim,
        config.policy,
        &baseline,
        &result.best,
    );
    let held_out = held_out_seed.map(|seed| {
        let plan = TournamentPlan {
            seed,
            ..config.plan.clone()
        };
        HeldOut {
            seed,
            tiers: compare_tables(&plan, arena, sim, config.policy, &baseline, &result.best),
        }
    });
    Ok(Evidence {
        baseline_spread: persona_spread(&baseline),
        best_spread: persona_spread(&result.best),
        search,
        held_out,
    })
}

fn proportion_json(p: &Proportion) -> Value {
    json!({"wins": p.k as u64, "games": p.n as u64, "p": p.p, "lo": p.lo, "hi": p.hi})
}

fn tiers_json(rows: &[TierComparison]) -> Value {
    let tiers: Map<String, Value> = rows
        .iter()
        .map(|r| {
            (
                r.tier.as_str().to_owned(),
                json!({
                    "baseline": proportion_json(&r.baseline),
                    "best": proportion_json(&r.best),
                    "verdict": r.verdict.as_str(),
                }),
            )
        })
        .collect();
    Value::Object(tiers)
}

/// [`search_file`] plus one top-level `evidence` object.
pub fn search_file_with_evidence(
    config: &SearchConfig,
    result: &SearchResult,
    evidence: &Evidence,
) -> Value {
    let mut file = search_file(config, result);
    file["evidence"] = json!({
        "interval": "wilson 95% (z = 1.96) of per-bot wins",
        "spread": {"baseline": evidence.baseline_spread, "best": evidence.best_spread},
        "search": {
            "basis": "in sample: the search's own games; optimistic",
            "tiers": tiers_json(&evidence.search),
        },
        "heldOut": evidence.held_out.as_ref().map(|h| json!({
            "basis": "held out: fresh game seeds, same arena and lineup",
            "seed": h.seed,
            "tiers": tiers_json(&h.tiers),
        })),
    });
    file
}
