//! P-AUG-RULES-1 oracle (integration half; the in-crate half is `src/cards/tuning_tests.rs`).
//!
//! The elite and augment rework (owner direction 2026-11-18, `docs/backlog/AUGMENT_ELITE_REWORK.md`) is live-only behind
//! two `SimConfig` rules. This packet adds the rules and the seams with EMPTY rework tables, so its proof is:
//! 1. the rules' encoding: `Legacy` by default (writes nothing, folds nothing), `Rework` in the live world, `"rework"` in
//!    JSON, and a statics identity of its own (no collision with any other config tag);
//! 2. the seams answer legacy under both rules (`cards::Tuning`, `mob_runtime::EliteTuning`);
//! 3. equivalence: the same match under `Legacy` and under `Rework` plays out the same (events and world), and differs
//!    only in the config and the digest;
//! 4. a `Rework` checkpoint holding fold cards with a ranged packet in flight restores and plays on identically.
use rh_sim::arenas::practice_arena;
use rh_sim::cards::{CardId, Tuning};
use rh_sim::mob_runtime::{EliteTuning, MobMode};
use rh_sim::reward_chests::{augment_pool, conditional_pool, INTERACTIVE, REWORK_POOL};
use rh_sim::{
    validate, AugmentRule, Command, EliteRule, Event, FactionId, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, Vec2, WeaponId,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

fn with_rules(mut config: SimConfig, augments: AugmentRule, elites: EliteRule) -> SimConfig {
    config.augments = augments;
    config.elites = elites;
    config
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The rules' encoding.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn both_rules_default_to_legacy_and_the_live_world_selects_rework() {
    let default = SimConfig::default();
    assert_eq!(default.augments, AugmentRule::Legacy);
    assert_eq!(default.elites, EliteRule::Legacy);
    assert_eq!(AugmentRule::default(), AugmentRule::Legacy);
    assert_eq!(EliteRule::default(), EliteRule::Legacy);
    let live = SimConfig::live_content();
    assert_eq!(
        live.augments,
        AugmentRule::Rework,
        "live_content() plays the augment rework"
    );
    assert_eq!(
        live.elites,
        EliteRule::Rework,
        "live_content() plays the elite rework"
    );
}

#[test]
fn rework_is_the_string_rework_in_json_and_legacy_writes_nothing() {
    let default = serde_json::to_value(SimConfig::default()).unwrap();
    assert_eq!(default["augments"], Value::Null, "Legacy writes nothing");
    assert_eq!(default["elites"], Value::Null, "Legacy writes nothing");
    let rework = with_rules(SimConfig::default(), AugmentRule::Rework, EliteRule::Rework);
    let v = serde_json::to_value(&rework).unwrap();
    assert_eq!(v["augments"], json!("rework"));
    assert_eq!(v["elites"], json!("rework"));
    let back: SimConfig = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(back, rework, "the JSON round trip keeps both rules");
    // Each rule alone round-trips (the two fields are independent).
    for (a, e) in [
        (AugmentRule::Rework, EliteRule::Legacy),
        (AugmentRule::Legacy, EliteRule::Rework),
    ] {
        let c = with_rules(SimConfig::default(), a, e);
        let back: SimConfig = serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
    // An absent field reads as Legacy (checkpoints from before the fields restore unchanged).
    let mut old = default.clone();
    old.as_object_mut().unwrap().remove("augments");
    old.as_object_mut().unwrap().remove("elites");
    let back: SimConfig = serde_json::from_value(old).unwrap();
    assert_eq!(back, SimConfig::default());
    // JSON refuses anything else, the hasher's tags and other fields' values included.
    for bad in [
        json!("Rework"),
        json!("legacy"),
        json!("themed"),
        json!("wall"),
        json!("augments=rework"),
        json!("elites=rework"),
        json!(1),
    ] {
        for field in ["augments", "elites"] {
            let mut c = default.clone();
            c[field] = bad.clone();
            assert!(
                serde_json::from_value::<SimConfig>(c).is_err(),
                "{field} = {bad} was admitted"
            );
        }
    }
}

/// The base of the identity test: a default world at tick 0 (on the 50 and the 25 ms grid alike). Only its statics config changes below.
fn identity_base() -> Value {
    let sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(81),
        &[Placement {
            profile: "aug-rules-identity".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    serde_json::to_value(&sim).unwrap()
}

/// The hasher folds values, not field names (`statics.rs`, `RegenInCombat`): every one of the seven config switches whose
/// default folds nothing must give its non-default value a word of its own, or two different worlds share a digest.
/// All 128 combinations of the seven, on one fixed world, are 128 different state hashes.
#[test]
fn every_combination_of_the_silent_config_switches_is_its_own_statics_identity() {
    use rh_sim::archetype::MobSpacing;
    use rh_sim::{CampBuffRule, FrostWish, RegenInCombat};
    let base = identity_base();
    let switches: [(&str, Value, Value); 7] = [
        (
            "mob_spacing",
            serde_json::to_value(MobSpacing::Auto).unwrap(),
            serde_json::to_value(MobSpacing::Off).unwrap(),
        ),
        (
            "regen_in_combat",
            serde_json::to_value(RegenInCombat::Legacy).unwrap(),
            serde_json::to_value(RegenInCombat::Off).unwrap(),
        ),
        (
            "camp_buffs",
            serde_json::to_value(CampBuffRule::Legacy).unwrap(),
            serde_json::to_value(CampBuffRule::Themed).unwrap(),
        ),
        (
            "frost_wish",
            serde_json::to_value(FrostWish::Freeze).unwrap(),
            serde_json::to_value(FrostWish::Wall).unwrap(),
        ),
        (
            "augments",
            serde_json::to_value(AugmentRule::Legacy).unwrap(),
            serde_json::to_value(AugmentRule::Rework).unwrap(),
        ),
        (
            "elites",
            serde_json::to_value(EliteRule::Legacy).unwrap(),
            serde_json::to_value(EliteRule::Rework).unwrap(),
        ),
        // P-SYNC-ORIGIN-1-fix: P-TICK-1a's step length. The base world sits at tick 0, on both grids.
        ("tick_ms", json!(null), json!(25)),
    ];
    let mut seen: BTreeMap<u64, String> = BTreeMap::new();
    for mask in 0u32..128 {
        let mut cp = base.clone();
        let mut name = Vec::new();
        for (bit, (field, off, on)) in switches.iter().enumerate() {
            let set = mask & (1 << bit) != 0;
            cp["statics"]["config"][*field] = if set { on.clone() } else { off.clone() };
            if set {
                name.push(*field);
            }
        }
        let name = format!("non-default: {name:?}");
        let sim = Sim::restore(cp).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(
            serde_json::to_value(&sim).unwrap()["world"],
            base["world"],
            "{name}: only the config changed"
        );
        let h = sim.state_hash();
        if let Some(other) = seen.insert(h, name.clone()) {
            panic!("`{other}` and `{name}` share the statics digest (state hash {h:#018x})");
        }
    }
    assert_eq!(seen.len(), 128);
    // The two defaults fold nothing: the all-default restore is the base world's own hash.
    let unchanged = Sim::restore(base.clone()).unwrap().state_hash();
    assert_eq!(
        seen.get(&unchanged).map(String::as_str),
        Some("non-default: []")
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The seams answer legacy under both rules.
// ---------------------------------------------------------------------------------------------------------------------

fn base_build(cards: &[CardId]) -> rh_sim::cards::Build {
    rh_sim::cards::Build::from_counts(cards.iter().map(|c| (*c, 1)))
}

/// P-AUG-CONTENT-1 (oracle-amend): the 18 cards whose Rework rows differ from the catalog.
const REWORKED: [CardId; 18] = [
    CardId::HereComesTheBoom,
    CardId::MachineGun,
    CardId::GlassCannon,
    CardId::VampiricPact,
    CardId::ArcaneOverload,
    CardId::Committed,
    CardId::SlowBurn,
    CardId::FistsOfFury,
    CardId::Overkill,
    CardId::TankEngine,
    CardId::PocketSand,
    CardId::Gambler,
    CardId::ThirdTimesTheCharm,
    CardId::PlantYourFeet,
    CardId::Hemorrhage,
    CardId::SpikedShell,
    CardId::Siphon,
    CardId::SecondWind,
];

/// Legacy is the legacy catalog and constants in every respect; under Rework (P-AUG-CONTENT-1 filled its table) only the
/// 18 reworked cards and the named numbers the packet moves differ: every other card, Race to 0's numbers, the pool and
/// its offers stay legacy. Wishful Thinking's Rework row is text-only (P-AUG-TUNE-1: its rule reads the
/// `REWORK_WISHFUL_*` shares; its catalog rows stay). (The numbers themselves are `cards/rework_content_tests.rs`.)
#[test]
fn the_card_table_is_the_legacy_catalog_under_legacy_and_for_unchanged_cards_under_rework() {
    use rh_sim::constants as c;
    let configs = [
        SimConfig::default(),
        with_rules(SimConfig::default(), AugmentRule::Rework, EliteRule::Legacy),
        SimConfig::live_content(),
    ];
    let fold = rh_sim::stat_fold::default_definition();
    let pickers: Vec<Vec<rh_sim::cards::Build>> = vec![
        vec![],
        vec![base_build(&[])],
        vec![base_build(&[CardId::SlowBurn, CardId::Ad1])],
        vec![
            base_build(&[CardId::SlowBurn, CardId::Ap2, CardId::Gambler]),
            base_build(&[CardId::SlowBurn, CardId::Armor1, CardId::Haste3]),
        ],
        vec![base_build(&INTERACTIVE)],
    ];
    for config in &configs {
        let t = Tuning::of(config);
        let rule = config.augments;
        assert_eq!(t.rule(), rule, "the table knows its rule");
        let legacy_rule = rule == AugmentRule::Legacy;
        for id in CardId::ALL {
            if !legacy_rule && id == CardId::WishfulThinking {
                // Coordinator oracle-amend for P-AUG-TUNE-1: a text-only override (its text describes the share rule).
                assert_eq!(
                    t.def(id).rows,
                    id.definition().rows,
                    "{rule:?} {id:?}: text-only override"
                );
                assert_ne!(
                    t.def(id).text,
                    id.definition().text,
                    "{rule:?} {id:?}: the Rework text"
                );
            } else if legacy_rule || !REWORKED.contains(&id) {
                assert_eq!(
                    t.def(id),
                    id.definition(),
                    "{rule:?} {id:?}: the catalog row"
                );
            } else {
                assert_ne!(
                    t.def(id),
                    id.definition(),
                    "{rule:?} {id:?}: a reworked card has its own row"
                );
            }
        }
        let n = t.numbers();
        if legacy_rule {
            assert_eq!(n.plant_feet_bonus, c::PLANT_FEET_BONUS, "{rule:?}");
            assert_eq!(n.gambler_up_chance, c::GAMBLER_CHANCE, "{rule:?}");
            assert_eq!(n.gambler_down_chance, c::GAMBLER_CHANCE, "{rule:?}");
            assert_eq!(n.third_time_extra, 1., "{rule:?}");
        }
        assert_eq!(n.gambler_up, c::GAMBLER_UP, "{rule:?}");
        assert_eq!(n.gambler_down, c::GAMBLER_DOWN, "{rule:?}");
        assert_eq!(n.wishful_budget_ms, c::WISHFUL_BUDGET_MS, "{rule:?}");
        assert_eq!(n.wishful_window_ms, c::WISHFUL_WINDOW_MS, "{rule:?}");
        assert_eq!(n.wishful_floor_share, c::WISHFUL_FLOOR_SHARE, "{rule:?}");
        if legacy_rule {
            assert_eq!(n.outgoing_row_cap, c::OUTGOING_ROW_CAP, "{rule:?}");
        }
        assert_eq!(
            n.outgoing_row_cap,
            if legacy_rule {
                fold.outgoing_row_cap
            } else {
                2.6
            },
            "{rule:?}: the fold's G1 clamp"
        );
        assert_eq!(
            t.numbers().outgoing_row_cap,
            if legacy_rule { 2.5 } else { 2.6 },
            "{rule:?}: decision 2, the Rework row cap"
        );
        assert_eq!(n.hp_race_cap, c::HP_RACE_CAP, "{rule:?}");
        assert_eq!(
            n.hp_race_cap, fold.hp_race_cap,
            "{rule:?}: the fold's G4 clamp"
        );
        assert_eq!(n.third_time_every, 3, "{rule:?}");
        // P-AUG-POOL-1 (oracle-amend): the Rework table offers its own pool (`REWORK_POOL`); Legacy keeps INTERACTIVE.
        if rule == AugmentRule::Legacy {
            assert_eq!(t.pool(), &INTERACTIVE[..], "{rule:?}");
        } else {
            assert_eq!(t.pool(), REWORK_POOL, "{rule:?}");
        }
        for p in &pickers {
            if rule == AugmentRule::Legacy {
                assert_eq!(t.augment_pool(p), augment_pool(p), "{rule:?} {p:?}");
            }
            assert_eq!(t.conditional_pool(p), conditional_pool(p), "{rule:?} {p:?}");
        }
    }
}

/// Oracle-amend, P-ELITE-TUNE-1: `Legacy` is the legacy constants; `Rework` keeps `k` and moves the two multipliers to
/// the owner's numbers (hp 1.5, damage 1.0; `tests/elite_tune.rs` pins them through the sim). Was: both rules equal legacy.
#[test]
fn the_elite_table_is_the_legacy_constants_under_legacy_and_the_owners_numbers_under_rework() {
    use rh_sim::constants as c;
    let legacy = EliteTuning::of(EliteRule::Legacy);
    assert_eq!(legacy.k, c::ELITE_K);
    assert_eq!(legacy.hp_mult, c::ELITE_HP_MULT);
    assert_eq!(legacy.dmg_mult, c::ELITE_DMG_MULT);
    let rework = EliteTuning::of(EliteRule::Rework);
    assert_eq!(rework.k, c::ELITE_K, "k does not move");
    assert_eq!(rework.hp_mult, 1.5);
    assert_eq!(rework.dmg_mult, 1.0);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Equivalence: the same match under both rules.
// ---------------------------------------------------------------------------------------------------------------------

/// The one-camp PvE fixture (an elite camp, `fire-1`); the players stand inside the camp's room.
fn pve_arena() -> rh_sim::Arena {
    let data = serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap()
}

fn pve_config() -> SimConfig {
    SimConfig {
        quests: false,
        consumables: true,
        mob_mode: MobMode::Pve,
        ..Default::default()
    }
}

fn placements() -> Vec<Placement> {
    placements_at(Vec2::new(200., 200.), Vec2::new(236., 176.))
}

fn placements_at(bow: Vec2, sword: Vec2) -> Vec<Placement> {
    vec![
        Placement {
            profile: "aug-rules-bow".into(),
            faction: FactionId::Fire,
            bot: false,
            at: bow,
            hp: None,
            weapon0: Some(WeaponId::Bow),
            weapon1: None,
        },
        Placement {
            profile: "aug-rules-sword".into(),
            faction: FactionId::Holy,
            bot: false,
            at: sword,
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        },
    ]
}

/// Grants `cards` to `pid` through the real door: one declared chest per card at the holder's feet (as
/// `hash_coverage.rs` `card_choices` does), each taken with `Choose` (the grant re-folds the build). Returns the events.
fn grant_by_chests(sim: Sim, pid: PlayerId, cards: &[CardId]) -> (Sim, Vec<Vec<Event>>) {
    let mut sim = sim;
    let mut out = Vec::new();
    for card in cards {
        let mut cp = serde_json::to_value(&sim).unwrap();
        let chest_id = u32::try_from(cp["world"]["entity_counter"].as_u64().unwrap()).unwrap() + 1;
        let at = {
            let p = sim.player(pid).unwrap();
            json!({"x": p.body.x, "y": p.body.y})
        };
        let chest = json!({
            "id": chest_id, "at": at,
            "expires_at": sim.server_time() + rh_sim::reward_chests::DEFINITION.lifetime_ms,
            "held_until_tick": 0, "options": [{"Card": card.as_str()}, null, null],
            "taken": [null, null, null], "pickers": [], "camp": null, "owner": null
        });
        cp["world"]["reward_chests"]
            .as_array_mut()
            .unwrap()
            .push(chest);
        cp["world"]["entity_counter"] = chest_id.into();
        sim = Sim::restore(cp).expect("a declared chest restores");
        sim.submit(
            pid,
            cmd(RawCommand::Choose {
                chest_id: Some(chest_id),
                pick: 0,
            }),
        )
        .unwrap();
        let events = sim.step();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, Event::ChestTaken { chest, by, pick: 0 } if *chest == chest_id && *by == pid)),
            "{card:?} was not granted"
        );
        assert!(sim.player(pid).unwrap().build.owns(*card), "{card:?}");
        out.push(events);
    }
    (sim, out)
}

/// The nearest standing mob's angle from a player, if any.
fn aim(sim: &Sim, pid: PlayerId) -> Option<f64> {
    let me = sim.player(pid)?.pos();
    sim.mobs()
        .iter()
        .filter(|m| m.core.vitals.hp > 0.)
        .map(|m| {
            let at = m.core.pos();
            let (dx, dy) = (at.x - me.x, at.y - me.y);
            (dx * dx + dy * dy, rh_sim::math::atan2(dy, dx))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, a)| a)
}

/// One scripted tick: both players aim at their nearest mob, attack every 7 ticks and release 3 ticks later.
fn drive_tick(sim: &mut Sim, t: u32) -> Vec<Event> {
    for pid in [PlayerId(1), PlayerId(2)] {
        if let Some(a) = aim(sim, pid) {
            let _ = sim.submit(pid, cmd(RawCommand::Aim { a }));
            if t % 7 == 0 {
                let _ = sim.submit(pid, cmd(RawCommand::Attack { a, t: None }));
            }
            if t % 7 == 3 {
                let _ = sim.submit(pid, cmd(RawCommand::Release { a, t: None }));
            }
        }
    }
    sim.step()
}

/// The checkpoint with the two rule fields taken out of its config (everything else is compared).
fn without_rules(sim: &Sim) -> Value {
    let mut v = serde_json::to_value(sim).unwrap();
    let config = v["statics"]["config"].as_object_mut().unwrap();
    config.remove("augments");
    config.remove("elites");
    v
}

/// The checkpoint with what the Rework elite numbers write taken out (P-ELITE-TUNE-1): the runtime's stored elite rule
/// (`world.mob_runtime.elites`: `null` under Legacy, `"rework"` once the numbers differ) and each elite mob's HP (hp and
/// max hp, scaled by the elite hp multiplier) and the raw damage of an elite's swing in progress (scaled by the elite
/// damage multiplier). Everything else is compared exactly.
fn mask_elite_numbers(mut v: Value) -> Value {
    v["world"]["mob_runtime"]["elites"] = Value::Null;
    fn walk(v: &mut Value) {
        match v {
            Value::Object(o) => {
                if o.get("elite") == Some(&Value::Bool(true)) {
                    if let Some(vitals) = o.get_mut("core").and_then(|c| c.get_mut("vitals")) {
                        vitals["hp"] = Value::Null;
                        vitals["max_hp"] = Value::Null;
                    }
                    // The damage an elite's swing in progress carries (its packet's raw damage, scaled by the elite
                    // damage multiplier when the swing begins).
                    if let Some(packet) = o
                        .get_mut("core")
                        .and_then(|c| c.get_mut("weapon"))
                        .and_then(|w| w.get_mut("action"))
                        .and_then(|a| a.get_mut("packet"))
                    {
                        packet["raw"] = Value::Null;
                    }
                }
                o.values_mut().for_each(walk);
            }
            Value::Array(a) => a.iter_mut().for_each(walk),
            _ => {}
        }
    }
    walk(&mut v["world"]["mobs"]);
    v
}

/// One scripted tick of an approach: each player walks toward the nearest mob until it is within `reach`, and from then on
/// plays `drive_tick`'s script (aim, attack every 7 ticks, release 3 later). Nothing hurts the camp before the first
/// attack, so the camp sleeps through the approach and wakes when the first hit lands.
fn approach_tick(sim: &mut Sim, t: u32, reach: f64) -> Vec<Event> {
    for pid in [PlayerId(1), PlayerId(2)] {
        let Some(me) = sim.player(pid).map(|p| p.pos()) else {
            continue;
        };
        let nearest = sim
            .mobs()
            .iter()
            .filter(|m| m.core.vitals.hp > 0.)
            .map(|m| m.core.pos())
            .map(|p| {
                let (dx, dy) = (p.x - me.x, p.y - me.y);
                (dx * dx + dy * dy, p)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((d2, to)) = nearest else { continue };
        if d2.sqrt() > reach {
            let _ = sim.submit(
                pid,
                cmd(RawCommand::Move {
                    x: to.x,
                    y: to.y,
                    seq: None,
                }),
            );
            continue;
        }
        let a = rh_sim::math::atan2(to.y - me.y, to.x - me.x);
        let _ = sim.submit(pid, cmd(RawCommand::Aim { a }));
        if t % 7 == 0 {
            let _ = sim.submit(pid, cmd(RawCommand::Attack { a, t: None }));
        }
        if t % 7 == 3 {
            let _ = sim.submit(pid, cmd(RawCommand::Release { a, t: None }));
        }
    }
    sim.step()
}

/// The JSON paths where two checkpoints differ (a readable failure for a whole-world comparison).
fn json_diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys().filter(|k| !x.contains_key(*k))) {
                json_diff(
                    &format!("{path}/{k}"),
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                    out,
                );
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                json_diff(&format!("{path}/{i}"), p, q, out);
            }
        }
        _ if a != b => out.push(format!("{path}: {a} vs {b}")),
        _ => {}
    }
}

const FOLD_CARDS: [CardId; 6] = [
    CardId::Committed,
    CardId::MachineGun,
    CardId::Gambler,
    CardId::ArcaneOverload,
    CardId::PlantYourFeet,
    CardId::ThirdTimesTheCharm,
];

/// The events with the amount of every hit an elite deals zeroed (the elite damage multiplier is that number).
fn without_elite_damage(events: &[Event], elites: &[PlayerId]) -> Vec<Event> {
    events
        .iter()
        .cloned()
        .map(|mut e| {
            if let Event::Hit {
                by: Some(b),
                amount,
                ..
            } = &mut e
            {
                if elites.contains(b) {
                    *amount = 0.;
                }
            }
            e
        })
        .collect()
}

/// Whether an elite deals a hit (its damage multiplier is the first thing to differ between the worlds' events).
fn elite_strikes(events: &[Event], elites: &[PlayerId]) -> bool {
    events
        .iter()
        .any(|e| matches!(e, Event::Hit { by: Some(b), .. } if elites.contains(b)))
}

/// Equivalence over a seed sweep. Oracle-amend, P-ELITE-TUNE-1 and P-ELITE-TUNE-1-fix. Before P-ELITE-TUNE-1: the same
/// match under `Legacy` elites and under `Rework` elites with the elite table equal to legacy played out identically
/// (events every tick, the whole world). The Rework table now differs from legacy (hp x1.5 instead of x2.0, damage x1.0
/// instead of x1.5), and an elite's numbers reach every fight with it, so full-match equality cannot hold and the rule
/// seam has no equal-table switch to rebuild it with (`EliteTuning::of` is a pair of statics; there is no `for_test`).
/// The retarget keeps what the test proves about the seam (it adds nothing but the elite numbers and what they cause):
/// the same seed and inputs under both rules, with fold cards and a camp in play, give the same events on every tick (an elite's hit
/// amount aside) and the same world on every tick, apart from the config, the runtime's stored elite rule, the elite's HP and the
/// damage of its swing in progress (the elite numbers themselves), and, from the first hit an elite deals, the HP of the
/// players it hits (a different damage number lands on them; `hp_frac_at_tick_start` is derived from it). The compared
/// prefix ends at the tick an elite or a player dies in either world (0.75x the HP dies sooner, and a victim of the
/// other damage number lives or dies differently: consequences of the numbers, after which loot, counts, timers and the
/// match itself differ for good), or at the cap. Until then the elite's max HP is exactly
/// the legacy one times 1.5/2.0 and it has taken the same damage in both worlds.
///
/// P-ELITE-TUNE-1-fix: the first retarget stopped at the first elite strike, which lands at tick 6 on every seed (a
/// six-tick prefix, one whole-world comparison, three identical runs). Now the players start at the far corners of the
/// camp's room and walk in (the approach, the wake on the first hit and the chase are inside the prefix), three starts
/// by three seeds, and the comparison runs through the fight to the elite's death with the whole world compared on every
/// tick. Floors: every run strikes, its prefix is at least `MIN_PREFIX` ticks, at least four of the nine runs differ in what the
/// prefix looked like (length, strike tick), and the victims' HP is seen to differ after the strike (the mask hides
/// something real). The fight itself (damage x1.0/1.5, hp, the helper share) is pinned by `tests/elite_tune.rs` and
/// `systems/mob_life/share_tests.rs`.
#[test]
fn rework_elites_differ_from_legacy_only_in_elite_numbers_until_the_first_elite_strike() {
    const TICKS: u32 = 400;
    const MIN_PREFIX: u32 = 40;
    const REACH: f64 = 60.;
    // (bow holder, sword holder): the far corners of the fire room, away from the camp at (112, 112).
    const STARTS: [((f64, f64), (f64, f64)); 3] = [
        ((200., 200.), (236., 176.)),
        ((270., 270.), (250., 250.)),
        ((100., 270.), (130., 250.)),
    ];
    let mut runs = std::collections::BTreeSet::new();
    let mut compared = 0;
    for (start, (bow, sword)) in STARTS.iter().enumerate() {
        for seed in [11u64, 12, 13] {
            let at = (Vec2::new(bow.0, bow.1), Vec2::new(sword.0, sword.1));
            let mut sims = [EliteRule::Legacy, EliteRule::Rework].map(|rule| {
                let sim = Sim::reset_active(
                    with_rules(pve_config(), AugmentRule::Legacy, rule),
                    pve_arena(),
                    Secrets::from_seed(seed),
                    &placements_at(at.0, at.1),
                );
                let (sim, e1) = grant_by_chests(sim, PlayerId(1), &FOLD_CARDS);
                let (sim, e2) = grant_by_chests(sim, PlayerId(2), &[CardId::HereComesTheBoom]);
                (sim, e1, e2)
            });
            let label = format!("start {start}, seed {seed}");
            assert_eq!(
                sims[0].1, sims[1].1,
                "{label}: the bow holder's grant events"
            );
            assert_eq!(
                sims[0].2, sims[1].2,
                "{label}: the sword holder's grant events"
            );
            assert!(
                sims[0].0.mobs().iter().any(|m| m.elite),
                "{label}: the fixture's elite camp spawned"
            );
            let elites: Vec<PlayerId> = sims[0]
                .0
                .mobs()
                .iter()
                .filter(|m| m.elite)
                .map(|m| m.core.id)
                .collect();
            let sheet = |s: &Sim| -> Vec<(f64, f64)> {
                s.mobs()
                    .iter()
                    .filter(|m| m.elite)
                    .map(|m| (m.core.vitals.hp, m.core.vitals.max_hp))
                    .collect()
            };
            let elite_down = |s: &Sim| {
                elites.iter().any(|id| {
                    s.mobs()
                        .iter()
                        .find(|m| m.core.id == *id)
                        .is_none_or(|m| m.core.vitals.hp <= 0.)
                })
            };
            let mut prefix = 0;
            let mut struck_at = None;
            let mut victims_differ = false;
            for t in 0..TICKS {
                let legacy = approach_tick(&mut sims[0].0, t, REACH);
                let rework = approach_tick(&mut sims[1].0, t, REACH);
                let player_died = |events: &[Event]| {
                    events.iter().any(|e| {
                        matches!(e, Event::Death { id, .. } if *id == PlayerId(1) || *id == PlayerId(2))
                    })
                };
                if elite_down(&sims[0].0)
                    || elite_down(&sims[1].0)
                    || player_died(&legacy)
                    || player_died(&rework)
                {
                    break;
                }
                if struck_at.is_none()
                    && (elite_strikes(&legacy, &elites) || elite_strikes(&rework, &elites))
                {
                    struck_at = Some(t);
                }
                assert_eq!(
                    without_elite_damage(&legacy, &elites),
                    without_elite_damage(&rework, &elites),
                    "{label}, tick {t}: the events differ"
                );
                assert_ne!(
                    sims[0].0.state_hash(),
                    sims[1].0.state_hash(),
                    "{label}, tick {t}: the Rework world folds no word of its own (same digest as Legacy)"
                );
                // The elite's sheet: its max HP is 0.75 x Legacy's (hp x1.5 against x2.0), and the damage it has taken
                // is the same in both worlds (the players' hits do not read the elite's numbers).
                for ((lh, lm), (rh, rm)) in sheet(&sims[0].0).into_iter().zip(sheet(&sims[1].0)) {
                    assert!(
                        (rm / lm - 0.75).abs() < 1e-9,
                        "{label}, tick {t}: Rework elite max hp {rm} is not 0.75 x Legacy {lm}"
                    );
                    assert!(
                        ((lm - lh) - (rm - rh)).abs() < 1e-6,
                        "{label}, tick {t}: the damage taken differs: Legacy {lh}/{lm}, Rework {rh}/{rm}"
                    );
                }
                // The whole world, every tick. From the first elite strike the players' HP (what the elite's damage
                // number lands on) is masked, and only it.
                let masked = |s: &Sim| {
                    let mut v = mask_elite_numbers(without_rules(s));
                    if struck_at.is_some() {
                        for p in v["world"]["players"].as_array_mut().unwrap() {
                            p["core"]["vitals"]["hp"] = Value::Null;
                            p["core"]["vitals"]["hp_frac_at_tick_start"] = Value::Null;
                        }
                    }
                    v
                };
                let mut diffs = Vec::new();
                json_diff("", &masked(&sims[0].0), &masked(&sims[1].0), &mut diffs);
                assert!(
                    diffs.is_empty(),
                    "{label}, tick {t}: the worlds differ beyond the two rules and the elite numbers: {:?}",
                    &diffs[..diffs.len().min(8)]
                );
                if struck_at.is_some() {
                    victims_differ |= sims[0]
                        .0
                        .players()
                        .iter()
                        .zip(sims[1].0.players())
                        .any(|(l, r)| l.core.vitals.hp != r.core.vitals.hp);
                }
                prefix += 1;
                compared += 1;
            }
            let strike = struck_at.unwrap_or(u32::MAX);
            eprintln!("elite_prefix {label}: prefix {prefix}, first elite strike {strike}");
            assert!(
                strike < u32::MAX,
                "{label}: no elite strike inside the prefix"
            );
            assert!(
                prefix >= MIN_PREFIX,
                "{label}: the compared prefix is {prefix} ticks (floor {MIN_PREFIX})"
            );
            assert!(
                victims_differ,
                "{label}: the victims' HP never differed after the strike: the mask hides nothing, or the damage is not 1.0/1.5"
            );
            runs.insert((prefix, strike));
            let rework_cp = serde_json::to_value(&sims[1].0).unwrap();
            assert_eq!(rework_cp["statics"]["config"]["augments"], Value::Null);
            assert_eq!(rework_cp["statics"]["config"]["elites"], json!("rework"));
        }
    }
    eprintln!("elite_prefix whole-world comparisons: {compared}");
    assert!(
        runs.len() >= 4,
        "the sweep is {} distinct run(s) (prefix length, strike tick): it must differ in what matters",
        runs.len()
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. A Rework checkpoint with fold cards and a ranged packet in flight.
// ---------------------------------------------------------------------------------------------------------------------

/// A live-rule world whose bow holder holds Committed, Machine Gun and Arcane Overload fires; a checkpoint taken while a
/// ranged packet is in flight (a projectile, or a ranged pending action, both checked against the packet envelope by
/// the restore) restores under `Rework`, and the restored match plays on exactly as the original.
#[test]
fn a_rework_checkpoint_with_fold_cards_and_a_ranged_packet_in_flight_restores() {
    let config = with_rules(pve_config(), AugmentRule::Rework, EliteRule::Rework);
    let sim = Sim::reset_active(config, pve_arena(), Secrets::from_seed(21), &placements());
    let (mut sim, _) = grant_by_chests(
        sim,
        PlayerId(1),
        &[
            CardId::Committed,
            CardId::MachineGun,
            CardId::ArcaneOverload,
        ],
    );
    let mut in_flight = None;
    for t in 0..200 {
        drive_tick(&mut sim, t);
        let cp = serde_json::to_value(&sim).unwrap();
        let projectiles = cp["world"]["projectiles"]
            .as_array()
            .is_some_and(|a| !a.is_empty());
        if projectiles {
            in_flight = Some(cp);
            break;
        }
    }
    let cp = in_flight.expect("the bow holder never had a projectile in flight in 200 ticks");
    let mut restored = Sim::restore(cp.clone()).expect("the Rework checkpoint is refused");
    assert_eq!(
        restored.config().augments,
        AugmentRule::Rework,
        "the restore kept the rule"
    );
    assert_eq!(
        restored.config().elites,
        EliteRule::Rework,
        "the restore kept the rule"
    );
    assert_eq!(restored.state_hash(), sim.state_hash());
    for t in 0..60 {
        let a = drive_tick(&mut sim, 1000 + t);
        let b = drive_tick(&mut restored, 1000 + t);
        assert_eq!(a, b, "tick {t} after the restore: events");
        assert_eq!(
            sim.state_hash(),
            restored.state_hash(),
            "tick {t} after the restore"
        );
    }
}
