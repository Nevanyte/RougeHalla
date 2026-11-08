//! The actual-source Trophy witness (`real-trophy-owner-private-refusal-and-pick` in the pinned card-runtime corpus)
//! and the kill-augment boundaries that the captured case cannot reach.
use crate::events::Event;
use crate::kill_augments::{self, KillStatKey, KillStats};
use crate::{
    input::validate, input::RawCommand, map::TileMap, Arena, FactionId, Placement, PlayerId,
    Secrets, Sim, SimConfig, Vec2,
};

/// The capture rig's default `room` (the same arena the witness consumer builds).
fn room() -> Arena {
    let (w, h) = (40usize, 24usize);
    let mut rows = Vec::with_capacity(h);
    for y in 0..h {
        let mut r = String::with_capacity(w);
        for x in 0..w {
            r.push(if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                '#'
            } else {
                '.'
            });
        }
        rows.push(r);
    }
    let map = TileMap::from_rows(&rows).expect("witness room");
    let spawns = [
        (112., 112.),
        (400., 112.),
        (800., 112.),
        (112., 624.),
        (800., 624.),
    ]
    .iter()
    .map(|&(x, y)| Vec2::new(x, y))
    .collect();
    Arena { map, spawns }
}

fn load() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/card-runtime/source.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("card-runtime corpus"))
        .expect("card-runtime json")
}

fn case<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == name)
        .expect("captured case")
}

fn sim_for(case: &serde_json::Value) -> Sim {
    let input = &case["input"];
    let mut rng = crate::rng::Mulberry32::new(input["mainSeed"].as_u64().unwrap() as u32);
    let order_salt = rng.next_u32();
    let mut ps = Vec::new();
    for p in input["players"].as_array().unwrap() {
        let at = &p["at"];
        ps.push(Placement {
            profile: p["faction"].as_str().unwrap().into(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap()),
            hp: None,
            weapon0: p["weapon"]
                .as_str()
                .and_then(crate::content::WeaponId::parse),
            weapon1: None,
        });
    }
    let secrets = Secrets {
        order_salt,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let config = SimConfig {
        quests: false,
        pvp_rules: false,
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, room(), secrets, &ps);
    let p1 = &mut sim.w.players[1];
    p1.vitals.hp = 1.;
    assert!(crate::cards::grant(
        &sim.k,
        &mut sim.w,
        PlayerId(2),
        crate::cards::CardId::Ad1
    ));
    sim
}

fn command(raw: RawCommand) -> crate::input::Command {
    validate(raw).expect("a valid witness command")
}

fn chest_ids(sim: &Sim) -> Vec<u32> {
    sim.w.reward_chests.iter().map(|c| c.id).collect()
}

/// The captured case, replayed through the ordinary C-INPUT door: p0's real sword swing kills p1, the source drops a
/// private Trophy with the victim's top investment, a stranger is refused, and the owner's pick folds the kill stat.
#[test]
fn trophy_owner_refusal_and_pick_reproduce_the_source_witness() {
    let doc = load();
    let case = case(&doc, "real-trophy-owner-private-refusal-and-pick");
    let mut sim = sim_for(case);
    assert_eq!(sim.w.tick, 1, "the declared bootstrap tick");
    assert_eq!(sim.w.reward_chests.len(), 0);
    // The declared victim mirror: ad1 alone reads as the source's encoded flat 120.
    assert_eq!(
        crate::stat_fold::encode_flat(sim.w.players[1].modifiers.mirrors().ad_bonus),
        120.
    );
    // action-0: attack (the sword swing lands and kills).
    let attack = command(RawCommand::Attack { a: 0., t: None });
    sim.submit(PlayerId(1), attack).unwrap();
    let events = sim.step();
    assert_eq!(sim.w.tick, 2);
    assert!(events.iter().any(|e| matches!(
        e,
        Event::Gv {
            reason: crate::results::GvReason::Kill,
            ..
        }
    )));
    assert_eq!(sim.w.players[0].credit.gv, 10);
    assert_eq!(sim.w.players[1].vitals.hp, 0.);
    assert!(sim.w.players[1].down == Some(crate::results::Outcome::Died));
    let chest = &sim.w.reward_chests[0];
    assert_eq!(chest.at, Vec2::new(300., 320.));
    assert_eq!(chest.owner, Some(PlayerId(1)));
    assert!(chest.camp.is_none());
    assert_eq!(chest.expires_at, 30100.);
    let options: Vec<String> = chest
        .options
        .iter()
        .flatten()
        .map(|o| o.as_str().into_owned())
        .collect();
    assert_eq!(options, vec!["kill:ad:6.0".to_string()]);
    assert_eq!(chest.taken, [None; 3]);
    assert!(chest.pickers.is_empty());
    // action-1: release.
    let release = command(RawCommand::Release { a: 0., t: None });
    sim.submit(PlayerId(1), release).unwrap();
    let _ = sim.step();
    assert_eq!(sim.w.reward_chests.len(), 1);
    // span 2: quiet ticks.
    let _ = sim.step();
    let _ = sim.step();
    // action-3: a stranger's pick is refused with the source's "Not yours".
    let chest_id = Some(sim.w.reward_chests[0].id);
    let choose = command(RawCommand::Choose { chest_id, pick: 0 });
    sim.submit(PlayerId(3), choose).unwrap();
    let events = sim.step();
    assert_eq!(sim.w.tick, 6);
    assert!(events.iter().any(|e| matches!(
        e,
        Event::ChestRefused {
            id: PlayerId(3),
            reason: crate::reward_chests::Refusal::NotYours,
        }
    )));
    assert_eq!(sim.w.players[2].kill_stats, KillStats::default());
    assert_eq!(sim.w.reward_chests[0].taken, [None; 3]);
    // action-5: the owner's pick takes the option and folds the enemy's ad into killStats.
    let choose = command(RawCommand::Choose { chest_id, pick: 0 });
    sim.submit(PlayerId(1), choose).unwrap();
    let events = sim.step();
    assert_eq!(sim.w.tick, 7);
    assert!(events.iter().any(|e| matches!(
        e,
        Event::ChestTaken {
            by: PlayerId(1),
            pick: 0,
            ..
        }
    )));
    let p0 = &sim.w.players[0];
    assert_eq!(p0.kill_stats.get(KillStatKey::Ad), 6.);
    assert_eq!(p0.modifiers.mirrors().ad_bonus, 6.);
    assert_eq!(
        crate::stat_fold::encode_flat(p0.modifiers.mirrors().ad_bonus),
        60.
    );
    assert_eq!(sim.w.reward_chests[0].taken[0], Some(PlayerId(1)));
    assert_eq!(sim.w.reward_chests[0].pickers, vec![PlayerId(1)]);
    // span 2 and the final captured tick: the trophy stays, the pick persists.
    let _ = sim.step();
    let _ = sim.step();
    assert_eq!(sim.w.tick, 9);
    assert_eq!(chest_ids(&sim).len(), 1);
    assert_eq!(sim.w.players[0].kill_stats.get(KillStatKey::Ad), 6.);
    assert_eq!(sim.w.players[0].credit.gv, 10);
}

#[test]
fn js_to_fixed_rounds_like_the_source_helper() {
    assert_eq!(kill_augments::js_to_fixed(6.0, 1), "6.0");
    assert_eq!(kill_augments::js_to_fixed(0.0625, 2), "0.06");
    assert_eq!(kill_augments::js_to_fixed(0.5, 0), "1");
    assert_eq!(kill_augments::js_to_fixed(1.5, 0), "2");
    assert_eq!(kill_augments::js_to_fixed(2.5, 0), "3");
    assert_eq!(kill_augments::js_to_fixed(0.01, 4), "0.0100");
    assert_eq!(kill_augments::js_to_fixed(123.456, 1), "123.5");
    assert_eq!(kill_augments::js_to_fixed(-0.25, 1), "-0.3");
}

#[test]
fn kill_augment_ids_round_trip_every_key() {
    for key in KillStatKey::ALL {
        let a = kill_augments::KillAugment { key, gain: 6.0 };
        let id = kill_augments::encode(a);
        assert!(id.starts_with("kill:"));
        assert_eq!(kill_augments::parse(&id), Some(a), "{id}");
    }
    assert_eq!(
        kill_augments::parse("kill:ad:6.0"),
        Some(kill_augments::KillAugment {
            key: KillStatKey::Ad,
            gain: 6.0,
        })
    );
    // Source: two segments are read, extra segments are ignored, and only positive finite gains parse.
    assert!(kill_augments::parse("kill:ad:6.0:junk").is_some());
    assert_eq!(kill_augments::parse("kill:ad:0"), None);
    assert_eq!(kill_augments::parse("kill:ad:-1"), None);
    assert_eq!(kill_augments::parse("kill:nope:1"), None);
    assert_eq!(kill_augments::parse("boost:ad:1.0"), None);
}

#[test]
fn kill_augment_text_matches_the_source_wording() {
    let flat = kill_augments::KillAugment {
        key: KillStatKey::Ad,
        gain: 6.0,
    };
    assert_eq!(
        kill_augments::text(flat),
        (
            "+6.0 Offense".to_string(),
            "Take 50% of your victim's Offense: +6.0 for the rest of the run.".to_string()
        )
    );
    let pct = kill_augments::KillAugment {
        key: KillStatKey::Damage,
        gain: 0.0125,
    };
    assert_eq!(
        kill_augments::text(pct),
        (
            "+1.3% damage".to_string(),
            "Take 50% of your victim's damage: +1.3% for the rest of the run.".to_string()
        )
    );
}

#[test]
fn kill_stats_fold_as_farm_rows_outside_the_card_caps() {
    let doc = load();
    let case = case(&doc, "real-trophy-owner-private-refusal-and-pick");
    let mut sim = sim_for(case);
    let mut stats = KillStats::default();
    stats.add(KillStatKey::Ad, 6.);
    stats.add(KillStatKey::Ap, 6.);
    stats.add(KillStatKey::Armor, 15.);
    stats.add(KillStatKey::Mr, 15.);
    stats.add(KillStatKey::Damage, 0.05);
    stats.add(KillStatKey::Health, 0.09);
    stats.add(KillStatKey::AttackSpeed, 0.05);
    stats.add(KillStatKey::Speed, 0.05);
    stats.add(KillStatKey::Leech, 0.01);
    sim.w.players[0].kill_stats = stats;
    crate::modifiers::recompute(&sim.k, &mut sim.w, crate::fighter::FighterIx::of_slot(0));
    crate::modifiers::sync_max_hp(&mut sim.w.players[0]);
    let p0 = &sim.w.players[0];
    let m = p0.modifiers.mirrors();
    assert!((m.ad_bonus - 6.).abs() < 1e-9);
    assert!((m.ap_bonus - 6.).abs() < 1e-9);
    assert!((m.armor_bonus - 15.).abs() < 1e-9);
    assert!((m.shield_bonus - 15.).abs() < 1e-9);
    assert!((m.as_mult - 1.05).abs() < 1e-9);
    assert!((m.speed_mult - 1.05).abs() < 1e-9);
    // The percent rows fold into the farm sums (outside the card caps): max hp and the damage multiplier.
    assert!(
        (p0.vitals.max_hp - 1145. * 1.09).abs() < 1e-6,
        "{}",
        p0.vitals.max_hp
    );
}

#[test]
fn a_trophy_is_never_dropped_for_the_wrong_outcome_or_self_kill() {
    let doc = load();
    let case = case(&doc, "real-trophy-owner-private-refusal-and-pick");
    let mut sim = sim_for(case);
    // Every player-death argument is fed through the real chain: Mia pays no trophy, and a self kill pays none.
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::PlayerKilled {
            by: PlayerId(1),
            victim: PlayerId(1),
            outcome: crate::results::Outcome::Died,
        },
    );
    assert!(sim.w.reward_chests.is_empty());
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::PlayerKilled {
            by: PlayerId(1),
            victim: PlayerId(2),
            outcome: crate::results::Outcome::Mia,
        },
    );
    assert!(sim.w.reward_chests.is_empty());
}
