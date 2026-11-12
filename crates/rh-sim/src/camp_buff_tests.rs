//! P-CAMP-BUFF-THEMES-1 oracle: zone-themed camp buffs behind `SimConfig::camp_buffs` (default `Legacy`).
//!
//! Legacy (unreleased commit a7b5c4ce on `origin/claude/adoring-edison-mxt8ab`, read with `git show a7b5c4ce:<path>`):
//! - `packages/shared/src/rosters.ts:232-262` `rollCampRosters`: a shuffled camp order (`shuffle`, n - 1 draws), one
//!   weighted buff draw per camp (`drawBuffs`, :113-148: theme 1 / CAMP_BUFF_OFF_THEME_WEIGHT x need x balance), a
//!   draw-free repair (`repairBuffs`, :151-226) toward every buff within `campBuffBounds` of every camp, then the types
//!   (an on-theme camp: the zone's type paying the buff, `buff` ""; off-theme: a type of its own zone and `buff` the
//!   type paying the stat in the zone of the nearest camp that has it on theme, `spillType`, :284-297).
//! - `packages/shared/src/constants.ts:602-614`: CAMP_BUFF_MAX_DISTANCE_TILES 65, OFF_THEME_WEIGHT 0.15,
//!   NEED_REF_TILES 30, NEED_CAP_TILES 90, BALANCE_POWER 2, REPAIR_STEPS 160.
//! - `packages/server/src/sim/camps.ts:33-39`: rolled at camp publish from `world.rewardRandom` only (2n - 1 draws).
//! - `packages/server/src/sim/mobLife.ts:265-270`: a credited normal kill grants MOB_KILL_STACKS of the camp's buff
//!   (`CampState.buff || type`); elites grant no stat. `packages/server/src/sim/mobStats.ts:7-24`: the toast names the
//!   mob killed when the buff is another type's ("Ember Imp: +3 kill stacks of Pardoner · ...").
//! - `packages/shared/test/rosters.test.ts`, `packages/server/test/camps.test.ts:75-104`: the acceptance numbers (every
//!   buff on 5 or 6 of 50 camps, within the bound of every camp; theme about 70%, worst roll 64%).
//!
//! Loose proof (owner direction 2026-11-10): the spread rules are checked as properties over the five committed legacy
//! full maps and eight reward salts each, not as tick-exact vectors. Measured on the same five maps with the patched
//! legacy TypeScript (mulberry32 draws, 40 rolls, darwin / Node 25, not a capture): theme share >= 64%, every buff on
//! 5 or 6 camps, no bound missed.
use crate::mob_catalog::camp_buffs::{roll_camp_rosters, CampRoll, CampSite};
use crate::mob_catalog::{mob_type_by_id, normal_types_of, MobTypeId};
use crate::modifiers::farm::{RewardStat, DEFINITION as FARM};
use crate::observe::{observe, CampReward, HudStat};
use crate::private_rng::Sfc32;
use crate::stat_fold::{EffectStat, FlatStat};
use crate::{
    Arena, CampBuffRule, FactionId, Placement, PlayerId, RegenInCombat, Secrets, Sim, SimConfig,
    TileMap, Vec2,
};
use serde_json::{json, Value};

/// rosters.ts `campBuffBounds` floor: CAMP_BUFF_MAX_DISTANCE_TILES (65) tiles, in whole world units. A literal of
/// the test's own (legacy constants.ts:602), not the implementation's constant.
fn max_distance_u() -> i64 {
    65 * crate::constants::TILE as i64
}
/// Legacy measured a worst roll of 64% camps on their zone's theme (a7b5c4ce message); "not drastically off".
fn min_theme_share() -> f64 {
    0.60
}

// ---------------------------------------------------------------------------------------------------------------
// Maps and catalog facts, computed here from the catalog (not from the implementation under test).

fn exports() -> Vec<(String, crate::mapdata::MapExport)> {
    let mut out = Vec::new();
    for (name, text) in [
        ("seed1", include_str!("mapdata/fixtures/seed1.map.json")),
        ("seed2", include_str!("mapdata/fixtures/seed2.map.json")),
    ] {
        out.push((name.to_string(), serde_json::from_str(text).unwrap()));
    }
    let domain: Value =
        serde_json::from_str(include_str!("mapdata/fixtures/domain-maps.json")).unwrap();
    for (i, m) in domain["maps"].as_array().unwrap().iter().enumerate() {
        out.push((
            format!("domain{i}"),
            serde_json::from_value(m.clone()).unwrap(),
        ));
    }
    out
}

fn sites_of(export: &crate::mapdata::MapExport) -> Vec<CampSite> {
    export
        .map
        .camps
        .iter()
        .map(|c| CampSite {
            zone: FactionId::parse(c.zone.as_str()).expect("typed zone"),
            x: c.x,
            y: c.y,
        })
        .collect()
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("mapdata/fixtures/seed1.map.json")).unwrap();
    let actual = import.validate().unwrap();
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = actual.into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

/// The nine stat kinds a normal kill can pay, in catalog order of their first type (legacy `MOB_STAT_KEYS`,
/// mobStats.ts:112).
fn stat_keys() -> Vec<RewardStat> {
    let mut keys: Vec<RewardStat> = Vec::new();
    for row in FARM.rows.iter() {
        if !keys.contains(&row.stat) {
            keys.push(row.stat);
        }
    }
    assert_eq!(keys.len(), 9, "the nine legacy stat kinds");
    keys
}

fn stat_of(t: MobTypeId) -> usize {
    let stat = FARM
        .rows
        .iter()
        .find(|r| r.mob == t)
        .unwrap_or_else(|| panic!("{t:?} has no farm reward (an elite?)"))
        .stat;
    stat_keys().iter().position(|k| *k == stat).unwrap()
}

/// By stat index, the zone's normal type that pays it (legacy `zoneStatTypes`, rosters.ts:272-281).
fn zone_stat_type(zone: FactionId, b: usize) -> Option<MobTypeId> {
    normal_types_of(zone)
        .map(|t| t.id)
        .find(|&t| stat_of(t) == b)
}

fn on_theme(zone: FactionId, b: usize) -> bool {
    zone_stat_type(zone, b).is_some()
}

/// Centre-to-centre distance in whole world units (legacy `distances`, rosters.ts:61-73: `Math.round(Math.sqrt(..))`).
fn dist(a: &CampSite, b: &CampSite) -> i64 {
    let (dx, dy) = (a.x - b.x, a.y - b.y);
    (dx * dx + dy * dy).sqrt().round() as i64
}

/// Legacy `campBuffBounds` (rosters.ts:75-89): 65 tiles, or the ninth-nearest camp (itself first) where farther.
fn bounds(camps: &[CampSite]) -> Vec<i64> {
    let k = camps.len().min(9) - 1;
    camps
        .iter()
        .map(|c| {
            let mut row: Vec<i64> = camps.iter().map(|o| dist(c, o)).collect();
            row.sort_unstable();
            row[k].max(max_distance_u())
        })
        .collect()
}

/// The stat a camp's normal kills pay (legacy `campRewardId`, mobStats.ts:118-120).
fn pays(roll: &CampRoll) -> MobTypeId {
    roll.buff.unwrap_or(roll.mob_type)
}

fn salt(i: u32) -> [u32; 4] {
    [0x5eed_0000 + i, 17 * i + 3, 0xa5a5_0000 ^ i, 7 + i]
}

/// How many draws `stream` is past a fresh stream of `salt` (the reward stream is never rewound).
fn draws_since(salt: [u32; 4], stream: &Sfc32) -> usize {
    let mut fresh = Sfc32::from_words(salt);
    for n in 0..100_000 {
        if fresh.words() == stream.words() {
            return n;
        }
        fresh.next_f64();
    }
    panic!("the reward stream is not on the salt's sequence");
}

fn config(rule: CampBuffRule) -> SimConfig {
    SimConfig {
        mob_mode: crate::mob_runtime::MobMode::Pve,
        // As the HUD camp test: the certified seed1 map needs the MVP storage mode for its initial loot.
        initial_loot: true,
        consumables: true,
        camp_buffs: rule,
        ..Default::default()
    }
}

fn secrets(reward: [u32; 4]) -> Secrets {
    let mut s = Secrets::from_seed(41);
    s.reward_salt = reward;
    s
}

/// A world in its lobby: the camps are rolled at construction, before anyone joins (legacy camps.ts:6).
fn lobby(rule: CampBuffRule, reward: [u32; 4]) -> Sim {
    Sim::try_new(config(rule), seed1_arena(), secrets(reward)).expect("seed1 Pve world")
}

fn placement(profile: &str, at: Vec2) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

fn seated(rule: CampBuffRule) -> Sim {
    let arena = seed1_arena();
    let ps = [
        placement("a", arena.spawns[0]),
        placement("b", arena.spawns[1]),
    ];
    Sim::reset_active(config(rule), arena, secrets(salt(1)), &ps)
}

// ---------------------------------------------------------------------------------------------------------------
// (1) The roll: zone themes, an even spread, every buff within reach of every camp.

/// rosters.test.ts / camps.test.ts:75-104 on the five committed legacy maps, eight reward salts each.
#[test]
fn camp_buff_themed_roll_keeps_each_zone_on_its_theme_spreads_the_nine_evenly_and_in_reach() {
    let mut rolls_seen = 0;
    for (name, export) in exports() {
        let camps = sites_of(&export);
        let n = camps.len();
        assert!(n >= 9, "{name}: a full map");
        let bound = bounds(&camps);
        let mut distinct: Vec<Vec<CampRoll>> = Vec::new();
        for s in 1..=8u32 {
            let label = format!("{name} salt {s}");
            let mut stream = Sfc32::from_words(salt(s));
            let mut draws = 0usize;
            let rolls = roll_camp_rosters(&camps, &mut || {
                draws += 1;
                stream.next_f64()
            });
            rolls_seen += 1;
            assert_eq!(rolls.len(), n, "{label}: one roll per camp");
            assert_eq!(
                draws,
                2 * n - 1,
                "{label}: 2n - 1 draws (n - 1 for the shuffle, one per camp: rosters.ts:228-231)"
            );
            let mut count = [0usize; 9];
            let mut themed = 0usize;
            for (c, roll) in rolls.iter().enumerate() {
                let zone = camps[c].zone;
                let ty = mob_type_by_id(roll.mob_type.as_str()).unwrap();
                assert!(
                    ty.zone == zone && !ty.elite,
                    "{label} camp {c}: the mob type is a normal type of its own zone"
                );
                let b = stat_of(pays(roll));
                count[b] += 1;
                match roll.buff {
                    None => {
                        assert!(on_theme(zone, b), "{label} camp {c}");
                        themed += 1;
                    }
                    Some(t) => {
                        let def = mob_type_by_id(t.as_str()).unwrap();
                        assert!(
                            !def.elite && def.zone != zone && !on_theme(zone, b),
                            "{label} camp {c}: a buff is set only off the zone's theme, to another zone's normal type"
                        );
                        // spillType: the type paying it in the zone of the nearest camp that has it on theme.
                        let mut best: Option<(i64, MobTypeId)> = None;
                        for o in &camps {
                            if let Some(pay) = zone_stat_type(o.zone, b) {
                                let d = dist(&camps[c], o);
                                if best.is_none_or(|(bd, _)| d < bd) {
                                    best = Some((d, pay));
                                }
                            }
                        }
                        assert_eq!(
                            Some(t),
                            best.map(|(_, t)| t),
                            "{label} camp {c}: the spill-over type of the nearest zone with the stat on theme"
                        );
                    }
                }
            }
            let (lo, hi) = (n / 9, n.div_ceil(9));
            for (b, k) in count.iter().enumerate() {
                assert!(
                    (lo..=hi).contains(k),
                    "{label}: stat {b} pays on {k} camps, outside the even band {lo}..={hi} (counts {count:?})"
                );
            }
            let share = themed as f64 / n as f64;
            assert!(
                share >= min_theme_share(),
                "{label}: {themed} of {n} camps on their zone's theme ({share:.2})"
            );
            for (c, site) in camps.iter().enumerate() {
                for b in 0..9 {
                    let near = rolls
                        .iter()
                        .zip(&camps)
                        .filter(|(r, _)| stat_of(pays(r)) == b)
                        .map(|(_, o)| dist(site, o))
                        .min()
                        .unwrap();
                    // One tile of slack: legacy met the bound on 399 of 400 rolls (the miss 0.2 tiles over).
                    assert!(
                        near <= bound[c] + crate::constants::TILE as i64,
                        "{label} camp {c}: the nearest camp paying stat {b} is {near} u away, bound {}",
                        bound[c]
                    );
                }
            }
            if !distinct.contains(&rolls) {
                distinct.push(rolls);
            }
        }
        assert!(
            distinct.len() >= 6,
            "{name}: the reward salt decides the roll"
        );
    }
    assert_eq!(rolls_seen, 40);
}

// ---------------------------------------------------------------------------------------------------------------
// (2) Guard: under the default the camp roll and every draw are today's.

#[test]
fn camp_buff_legacy_rule_rolls_the_bag_and_draws_exactly_as_before() {
    let reward = salt(3);
    let sim = lobby(CampBuffRule::Legacy, reward);
    assert_eq!(SimConfig::default().camp_buffs, CampBuffRule::Legacy);
    assert!(sim.camp_buffs().is_empty(), "no buffs under Legacy");
    let zones: Vec<FactionId> = sim
        .k
        .arena
        .map
        .layers()
        .unwrap()
        .data()
        .camps
        .iter()
        .map(|c| FactionId::parse(c.zone.as_str()).unwrap())
        .collect();
    let mut present = zones.clone();
    present.sort_by_key(|z| z.as_str());
    present.dedup();
    // The roll is the last reward-stream consumer at construction: the bag roll, nine draws a zone.
    let total = draws_since(reward, &sim.w.reward_rng);
    let prefix = total - 9 * present.len();
    let mut twin = Sfc32::from_words(reward);
    for _ in 0..prefix {
        twin.next_f64();
    }
    let types = crate::mob_catalog::rosters::roll_camp_types(&zones, &mut || twin.next_f64());
    assert_eq!(
        sim.camp_rosters()
            .iter()
            .map(|c| c.mob_type)
            .collect::<Vec<_>>(),
        types
    );
    assert_eq!(twin.words(), sim.w.reward_rng.words());

    // A config and checkpoint written before the switch existed restore to the same state hash.
    let cp = serde_json::to_value(&sim).unwrap();
    assert_eq!(cp["statics"]["config"]["camp_buffs"], Value::Null);
    assert!(
        cp["world"]["mob_runtime"]["buffs"].is_null(),
        "Legacy writes no buff (null or absent)"
    );
    let mut old = cp.clone();
    old["statics"]["config"]
        .as_object_mut()
        .unwrap()
        .remove("camp_buffs");
    old["world"]["mob_runtime"]
        .as_object_mut()
        .unwrap()
        .remove("buffs");
    assert_eq!(Sim::restore(&old).unwrap().state_hash(), sim.state_hash());
}

// ---------------------------------------------------------------------------------------------------------------
// (3) C-RNG: the roll draws from the reward stream only, 2n - 1 numbers, at the legacy roll's position.

#[test]
fn camp_buff_themed_roll_draws_2n_minus_1_from_the_reward_stream_only() {
    let reward = salt(5);
    let legacy = lobby(CampBuffRule::Legacy, reward);
    let themed = lobby(CampBuffRule::Themed, reward);
    let n = legacy.camp_rosters().len();
    let sites: Vec<CampSite> = themed
        .k
        .arena
        .map
        .layers()
        .unwrap()
        .data()
        .camps
        .iter()
        .map(|c| CampSite {
            zone: FactionId::parse(c.zone.as_str()).unwrap(),
            x: c.x,
            y: c.y,
        })
        .collect();
    let mut zones: Vec<FactionId> = sites.iter().map(|s| s.zone).collect();
    zones.sort_by_key(|z| z.as_str());
    zones.dedup();
    let d_legacy = draws_since(reward, &legacy.w.reward_rng);
    let d_themed = draws_since(reward, &themed.w.reward_rng);
    assert_eq!(
        d_themed + 9 * zones.len(),
        d_legacy + 2 * n - 1,
        "Themed replaces the bag's 9 draws a zone by 2n - 1 (camps.ts:28)"
    );
    // The same prefix, then the roll: what the world published is the pure roll at the legacy roll's position.
    let mut twin = Sfc32::from_words(reward);
    for _ in 0..d_legacy - 9 * zones.len() {
        twin.next_f64();
    }
    let want = roll_camp_rosters(&sites, &mut || twin.next_f64());
    assert_eq!(twin.words(), themed.w.reward_rng.words());
    assert_eq!(
        themed
            .camp_rosters()
            .iter()
            .map(|c| c.mob_type)
            .collect::<Vec<_>>(),
        want.iter().map(|r| r.mob_type).collect::<Vec<_>>()
    );
    assert_eq!(
        themed.camp_buffs(),
        want.iter().map(|r| r.buff).collect::<Vec<_>>().as_slice(),
        "one buff per camp under Themed"
    );
    // The elites are a function of the camp order (rollCampElites): no draw, unchanged.
    assert_eq!(
        themed
            .camp_rosters()
            .iter()
            .map(|c| c.elite)
            .collect::<Vec<_>>(),
        legacy
            .camp_rosters()
            .iter()
            .map(|c| c.elite)
            .collect::<Vec<_>>()
    );
    // The sim's other streams are untouched (never world.random, never the public seed).
    assert_eq!(themed.w.spawn_rng, legacy.w.spawn_rng);
    assert_eq!(themed.w.wind_rng, legacy.w.wind_rng);
}

// ---------------------------------------------------------------------------------------------------------------
// (4) Save, restore, hash and identity.

#[test]
fn camp_buff_themed_buffs_round_trip_and_reach_the_state_hash() {
    let sim = lobby(CampBuffRule::Themed, salt(2));
    let n = sim.camp_rosters().len();
    let cp = serde_json::to_value(&sim).unwrap();
    assert_eq!(cp["statics"]["config"]["camp_buffs"], json!("themed"));
    let buffs = cp["world"]["mob_runtime"]["buffs"]
        .as_array()
        .unwrap_or_else(|| {
            panic!("a Themed world checkpoints its buffs: world.mob_runtime.buffs is an array")
        })
        .clone();
    assert_eq!(buffs.len(), n, "one entry per camp");
    let restored = Sim::restore(&cp).unwrap();
    assert_eq!(restored.state_hash(), sim.state_hash());
    assert_eq!(restored.camp_buffs(), sim.camp_buffs());
    assert_eq!(serde_json::to_value(&restored).unwrap(), cp);

    // Every off-theme camp's buff is hashed: name another normal type paying the same stat, outside the camp's zone.
    let zones: Vec<FactionId> = sim
        .k
        .arena
        .map
        .layers()
        .unwrap()
        .data()
        .camps
        .iter()
        .map(|c| FactionId::parse(c.zone.as_str()).unwrap())
        .collect();
    let mut probed = 0;
    for (c, buff) in sim.camp_buffs().iter().enumerate() {
        let Some(t) = *buff else { continue };
        let Some(other) = crate::mob_catalog::DEFINITION
            .types
            .iter()
            .find(|o| !o.elite && o.id != t && o.zone != zones[c] && stat_of(o.id) == stat_of(t))
        else {
            continue;
        };
        let mut edited = cp.clone();
        edited["world"]["mob_runtime"]["buffs"][c] = json!(other.id.as_str());
        if let Ok(s) = Sim::restore(&edited) {
            assert_ne!(
                s.state_hash(),
                sim.state_hash(),
                "camp {c}'s buff is hashed"
            );
            probed += 1;
        }
    }
    assert!(probed > 0, "some buff edit restored and moved the hash");

    // Refusals (check_world): a Themed world with a buff row of the wrong length, and a Legacy world carrying buffs.
    let mut short = cp.clone();
    short["world"]["mob_runtime"]["buffs"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(
        Sim::restore(&short).is_err(),
        "a buff row per camp, no fewer"
    );
    let legacy = serde_json::to_value(lobby(CampBuffRule::Legacy, salt(2))).unwrap();
    let mut smuggled = legacy.clone();
    smuggled["world"]["mob_runtime"]["buffs"] = Value::Array(buffs);
    assert!(Sim::restore(&smuggled).is_err(), "Legacy carries no buffs");
}

/// A mob-less world stepped once; only its statics config changes below, so a different state hash is a different
/// statics digest.
fn config_base() -> Value {
    let mut sim = Sim::reset_active(
        SimConfig {
            regen: true,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(77),
        &[placement("hash-camp-buffs", Vec2::new(400., 320.))],
    );
    sim.step();
    serde_json::to_value(&sim).unwrap()
}

#[test]
fn camp_buff_rule_is_its_own_statics_identity_and_legacy_folds_nothing() {
    use crate::archetype::MobSpacing;
    let base = config_base();
    let h0 = Sim::restore(&base).unwrap().state_hash();
    let mut old = base.clone();
    old["statics"]["config"]
        .as_object_mut()
        .unwrap()
        .remove("camp_buffs");
    assert_eq!(
        Sim::restore(&old).unwrap().state_hash(),
        h0,
        "Legacy folds nothing"
    );
    let mut seen = std::collections::BTreeMap::new();
    for spacing in [MobSpacing::Auto, MobSpacing::Off] {
        for regen in [RegenInCombat::Legacy, RegenInCombat::Off] {
            for rule in [CampBuffRule::Legacy, CampBuffRule::Themed] {
                let mut cp = base.clone();
                cp["statics"]["config"]["mob_spacing"] = serde_json::to_value(spacing).unwrap();
                cp["statics"]["config"]["regen_in_combat"] = serde_json::to_value(regen).unwrap();
                cp["statics"]["config"]["camp_buffs"] = serde_json::to_value(rule).unwrap();
                let sim = Sim::restore(&cp).unwrap();
                assert_eq!(serde_json::to_value(&sim).unwrap()["world"], base["world"]);
                let name = format!("{spacing:?}/{regen:?}/{rule:?}");
                if let Some(other) = seen.insert(sim.state_hash(), name.clone()) {
                    panic!("`{other}` and `{name}` share a statics digest");
                }
            }
        }
    }
    assert_eq!(seen.len(), 8);
    // JSON keeps "themed"; the hasher folds a tag no other config field writes.
    assert_eq!(
        serde_json::to_value(CampBuffRule::Themed).unwrap(),
        json!("themed")
    );
    assert_eq!(
        serde_json::to_value(CampBuffRule::Legacy).unwrap(),
        Value::Null
    );
    assert!(serde_json::from_value::<CampBuffRule>(json!("camp_buffs=themed")).is_err());
    assert!(serde_json::from_value::<CampBuffRule>(json!("off")).is_err());
    assert_eq!(
        crate::hash::hash_of(0, &CampBuffRule::Themed),
        crate::hash::hash_of(0, "camp_buffs=themed")
    );
}

/// The reviewer note carried from P-REGEN-COMBAT-1-fix: a checkpoint whose `statics` precedes the format tag is held
/// in the checkpoint's `Buf` deserializer until the tag is read; both switches must still read back their JSON value.
#[test]
fn camp_buff_and_regen_switches_restore_when_statics_precede_the_format_tag() {
    for (field, value) in [
        ("regen_in_combat", json!("off")),
        ("camp_buffs", json!("themed")),
    ] {
        let mut cp = config_base();
        cp["statics"]["config"][field] = value.clone();
        let want = Sim::restore(&cp).unwrap().state_hash();
        let obj = cp.as_object().unwrap();
        let mut parts: Vec<String> = Vec::new();
        for key in ["statics", "world", "content_hash", "build", "format"] {
            parts.push(format!(
                "{:?}:{}",
                key,
                serde_json::to_string(&obj[key]).unwrap()
            ));
        }
        assert!(obj.len() == parts.len(), "every checkpoint key reordered");
        let text = format!("{{{}}}", parts.join(","));
        let sim = Sim::restore(&mut serde_json::Deserializer::from_str(&text))
            .unwrap_or_else(|e| panic!("{field}: {e}"));
        assert_eq!(sim.state_hash(), want, "{field}");
        assert_eq!(
            serde_json::to_value(&sim).unwrap()["statics"]["config"][field],
            value
        );
    }
}

#[test]
fn camp_buff_themed_replay_verifies_and_does_not_pass_for_legacy() {
    use crate::replay::{run_replay, Recorder, ReplayError, ReplayStart};
    let live = config(CampBuffRule::Themed);
    let arena = seed1_arena();
    let placements = vec![placement("replay-a", arena.spawns[0])];
    let mut sim = Sim::reset_active(live.clone(), arena, secrets(salt(4)), &placements);
    let mut rec = Recorder::new(
        &sim,
        live,
        ReplayStart::Active {
            placements: placements.clone(),
        },
    );
    for _ in 0..5 {
        sim.step();
        rec.stepped(&sim);
    }
    let replay = rec.replay;
    run_replay(&replay).expect("a Themed replay verifies under its own config");
    let mut other = replay.clone();
    other.config.camp_buffs = CampBuffRule::Legacy;
    match run_replay(&other) {
        Err(ReplayError::Diverged { step: 0, .. }) => {}
        r => panic!(
            "a Themed replay must diverge at step 0 under Legacy; got {:?}",
            r.map(|(s, _)| s.state_hash())
        ),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (5) What a client sees: the camp row's reward is the buff, the same for every seat.

fn hud(stat: RewardStat) -> HudStat {
    // Legacy `rewardIconFor`, packages/client/src/ui/planning.ts:161-174.
    match stat {
        RewardStat::Flat(FlatStat::Ad) => HudStat::Offense,
        RewardStat::Flat(FlatStat::Ap) => HudStat::SoulOffense,
        RewardStat::Stat(EffectStat::Damage) => HudStat::Damage,
        RewardStat::Stat(EffectStat::AttackSpeed) => HudStat::AttackSpeed,
        RewardStat::Stat(EffectStat::Lifesteal) => HudStat::LifeSteal,
        RewardStat::Stat(EffectStat::MaxHp) => HudStat::Health,
        RewardStat::Flat(FlatStat::Armor) => HudStat::Defense,
        RewardStat::Flat(FlatStat::Shield) => HudStat::SoulDefense,
        RewardStat::Stat(EffectStat::MoveSpeed) => HudStat::MoveSpeed,
        other => panic!("no farm reward uses {other:?}"),
    }
}

fn reward_row(t: MobTypeId) -> CampReward {
    let r = FARM.rows.iter().find(|r| r.mob == t).unwrap();
    CampReward {
        stat: hud(r.stat),
        amount: r.value,
    }
}

/// a7b5c4ce `packages/client/src/ui/planning.ts` and `campInfo.ts`: the badge reads `campRewardId` (buff, else type).
#[test]
fn camp_buff_themed_camp_row_reports_the_buff_to_every_seat() {
    let sim = seated(CampBuffRule::Themed);
    let (a, b) = (sim.players()[0].id, sim.players()[1].id);
    let camps = sim.camp_rosters().to_vec();
    let buffs = sim.camp_buffs().to_vec();
    assert_eq!(buffs.len(), camps.len(), "one buff per camp under Themed");
    assert!(
        buffs.iter().any(Option::is_some),
        "seed1 has an off-theme camp under Themed"
    );
    let oa = observe(&sim, a, &[]);
    let ob = observe(&sim, b, &[]);
    assert_eq!(
        oa.camps, ob.camps,
        "the public camp rows are the same for every seat"
    );
    for (i, camp) in camps.iter().enumerate() {
        let want = reward_row(buffs[i].unwrap_or(camp.mob_type));
        assert_eq!(
            oa.camp_hud[i].reward,
            Some(want),
            "camp {i}: seat a sees the buff"
        );
        assert_eq!(
            ob.camp_hud[i].reward,
            Some(want),
            "camp {i}: seat b sees the same row"
        );
        if buffs[i].is_some() {
            assert_ne!(
                Some(want),
                Some(reward_row(camp.mob_type)),
                "camp {i}: an off-theme buff is another stat than the mob type's"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The kill grant (mobLife.ts:265-270).

fn award_at(
    sim: &Sim,
    camp: usize,
    elite: bool,
    killer: PlayerId,
) -> crate::systems::mob_life::Award {
    let m = sim
        .mobs()
        .iter()
        .find(|m| m.camp as usize == camp && m.elite == elite)
        .unwrap_or_else(|| panic!("camp {camp} has a mob (elite {elite})"));
    crate::systems::mob_life::Award {
        mob: m.core.id,
        serial: 1,
        killer: Some(killer),
        camp: camp as u32,
        weapon: m.core.active_weapon(),
        at: m.core.pos(),
        elite,
        mob_type: m.mob_type.unwrap(),
        zone: m.core.faction_id().unwrap(),
        mult: 1.,
        contributors: vec![killer],
    }
}

fn counts(sim: &Sim, p: PlayerId) -> Vec<u64> {
    let i = sim.w.idx(p).unwrap();
    MobTypeId::ALL
        .iter()
        .map(|&t| sim.w.players[i].farm.count(t))
        .collect()
}

#[test]
fn camp_buff_themed_normal_kill_grants_the_buff_stat_and_an_elite_grants_none() {
    let mut sim = seated(CampBuffRule::Themed);
    let a = sim.players()[0].id;
    let stacks = crate::modifiers::farm::DEFINITION.kill_stacks;
    let Some(ci) = sim.camp_buffs().iter().position(|b| b.is_some()) else {
        panic!("seed1 has an off-theme camp under Themed");
    };
    let buff = sim.camp_buffs()[ci].unwrap();
    let award = award_at(&sim, ci, false, a);
    let own = award.mob_type;
    assert_ne!(own, buff);
    let before = counts(&sim, a);
    let mut ev = Vec::new();
    crate::systems::mob_life::pay(&sim.k, &mut sim.w, &mut ev, award);
    let after = counts(&sim, a);
    let idx = |t: MobTypeId| MobTypeId::ALL.iter().position(|&x| x == t).unwrap();
    assert_eq!(
        after[idx(buff)],
        before[idx(buff)] + stacks,
        "the camp's buff pays"
    );
    assert_eq!(
        after[idx(own)],
        before[idx(own)],
        "the mob's own type pays nothing"
    );
    let killed = mob_type_by_id(own.as_str()).unwrap().name;
    let paid = mob_type_by_id(buff.as_str()).unwrap().name;
    let head = format!("{killed}: +{stacks} kill stacks of {paid}");
    assert!(
        ev.iter().any(|e| matches!(e, crate::events::Event::Toast { to: Some(p), text } if *p == a && text.starts_with(&head))),
        "the toast names the mob killed and the stat's type (mobStats.ts:21-22): want {head:?}"
    );

    // An elite at an elite camp of the same world grants no stat (mobLife.ts:265).
    if let Some(ec) = sim.camp_rosters().iter().position(|c| c.elite.is_some()) {
        let before = counts(&sim, a);
        let award = award_at(&sim, ec, true, a);
        crate::systems::mob_life::pay(&sim.k, &mut sim.w, &mut Vec::new(), award);
        assert_eq!(counts(&sim, a), before, "elites grant no stat");
    }
}

/// Guard: under Legacy a normal kill still pays the mob's own type.
#[test]
fn camp_buff_legacy_normal_kill_grants_the_mob_type_stat() {
    let mut sim = seated(CampBuffRule::Legacy);
    let a = sim.players()[0].id;
    let award = award_at(&sim, 0, false, a);
    let own = award.mob_type;
    let i = MobTypeId::ALL.iter().position(|&x| x == own).unwrap();
    let before = counts(&sim, a)[i];
    crate::systems::mob_life::pay(&sim.k, &mut sim.w, &mut Vec::new(), award);
    assert_eq!(
        counts(&sim, a)[i],
        before + crate::modifiers::farm::DEFINITION.kill_stacks
    );
}
