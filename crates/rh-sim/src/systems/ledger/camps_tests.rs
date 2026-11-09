//! Pack Leader ledger pass context: one pass-start canonical camps snapshot, read by outgoing damage and by the
//! execute/full-versus-without queries; transient and cleared at every pass end (including the empty-ledger early exit).
use super::*;
use crate::cards::CardId;
use crate::mob_runtime::MobMode;
use crate::state::Packet;
use crate::{
    validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};

fn arena() -> Arena {
    let data: crate::mapdata::GameMapData = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/initial-loot/input-map.json"
    )))
    .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    }
}

fn pve_sim() -> Sim {
    let mut sim = Sim::new(
        SimConfig {
            consumables: true,
            initial_loot: true,
            mob_mode: MobMode::Pve,
            pvp_rules: false,
            min_players: 3,
            fill_seconds: 0.0,
            ..Default::default()
        },
        arena(),
        Secrets::from_seed(3),
    );
    for i in 0..3 {
        sim.add_player(&format!("p{i}"), Some(FactionId::Fire), false);
    }
    let _ = sim.step();
    assert!(sim.w.mob_runtime.is_some(), "the PvE world publishes camps");
    sim.w.server_time = 1000.0;
    sim
}

fn grant(sim: &mut Sim, cards: &[CardId]) {
    for card in cards {
        assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), *card));
    }
}

fn cx<'a>(s: &'a mut Sim, ev: &'a mut Vec<Event>) -> Cx<'a> {
    Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev,
        pf: &mut s.pf,
    }
}

fn entry(victim: PlayerId, by: PlayerId, raw: f64, true_damage: bool) -> Entry {
    Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim,
        by: Some(by),
        packet: Packet {
            raw,
            phys: if true_damage { 0. } else { 1. },
            magic: 0.,
            true_: if true_damage { 1. } else { 0. },
        },
        weapon: None,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    }
}

fn p1_index(sim: &Sim) -> usize {
    sim.w.idx(PlayerId(2)).expect("declared victim")
}

/// One pass with a declared non-lethal player hit and (optionally) a real camp clear from real camp-member deaths.
fn run_pass(sim: &mut Sim, kill_camp: Option<u32>, camp_counts_from_mobs: bool) -> f64 {
    let i = p1_index(sim);
    let before = sim.w.players[i].vitals.hp;
    let mut ev = Vec::new();
    if let Some(camp) = kill_camp {
        let mob_ids: Vec<PlayerId> = sim
            .w
            .mobs
            .iter()
            .filter(|m| m.camp == camp && m.status == crate::state::Status::Alive)
            .map(|m| m.core.id)
            .collect();
        assert!(!mob_ids.is_empty(), "camp has live members");
        if camp_counts_from_mobs {
            sim.w.mob_runtime.as_mut().unwrap().life[camp as usize].contributors =
                vec![PlayerId(1)];
        }
        for id in mob_ids {
            sim.s.ledger.push(entry(id, PlayerId(1), 1_000_000., true));
        }
    }
    sim.s
        .ledger
        .push(entry(PlayerId(2), PlayerId(1), 40., true));
    super::apply(&mut cx(sim, &mut ev));
    assert!(
        sim.s.camps_at_pass_start.is_empty(),
        "the pass snapshot is cleared at the pass end"
    );
    before - sim.w.players[i].vitals.hp
}

fn no_camp_pass(sim: &mut Sim) -> f64 {
    run_pass(sim, None, false)
}

#[test]
fn the_pass_snapshot_is_read_per_attacker_and_cleared_after_the_pass() {
    let mut zero = pve_sim();
    let mut eight = pve_sim();
    grant(&mut zero, &[CardId::PackLeader]);
    grant(&mut eight, &[CardId::PackLeader]);
    eight.w.players[0].camps_cleared = 8;
    let d0 = no_camp_pass(&mut zero);
    let d8 = no_camp_pass(&mut eight);
    assert!(d0 > 0. && d8 > 0.);
    let ratio = d8 / d0;
    assert!(
        (ratio - 1.24).abs() < 1e-9,
        "the attacker's pass-start count 8 must scale the outgoing row by the source cap: ratio {ratio}"
    );
    // Every pass end clears the snapshot, including the empty-ledger early exit.
    let mut sim = pve_sim();
    let mut ev = Vec::new();
    assert!(sim.s.ledger.is_empty());
    super::apply(&mut cx(&mut sim, &mut ev));
    assert!(sim.s.camps_at_pass_start.is_empty());
}

#[test]
fn the_scratch_capacity_is_prepared_by_reserve_actors_past_eight_actors() {
    let mut s = TickScratch::default();
    // The private diagnostic bench supports more than the eight real seats: reserve_actors prepares the snapshot
    // capacity for the actual actor count, so the pass-start extend never allocates or resizes in the hot pass.
    s.reserve_actors(crate::constants::MAX_PLAYERS + 4);
    assert!(s.camps_at_pass_start.capacity() >= crate::constants::MAX_PLAYERS + 4);
    s.camps_at_pass_start.clear();
    debug_assert!(s.camps_at_pass_start.capacity() >= 12);
    s.camps_at_pass_start.extend(std::iter::repeat_n(0u16, 12));
    assert_eq!(s.camps_at_pass_start.len(), 12);
    s.camps_at_pass_start.clear();
    assert!(s.is_settled());
}

#[test]
fn a_same_pass_camp_clear_uses_the_pass_start_count_and_the_next_pass_the_new_count() {
    // Reference worlds: one ordinary non-lethal player hit at count 0 and at count 1, with a tier-4 mark denial so the
    // execute/full-versus-without queries are exercised as well.
    let mut ref0 = pve_sim();
    let mut ref1 = pve_sim();
    for r in [&mut ref0, &mut ref1] {
        grant(r, &[CardId::PackLeader, CardId::CoupDeGrace]);
        // Declared component context: a real tier-4 mark denial edge (victim p1, attacker p0), the same accepted shape
        // signatures::freeze_denials produces, so the production execute_share callsite is actually reached.
        r.s.mark_denials.push((PlayerId(2), PlayerId(1)));
        let i = p1_index(r);
        r.w.players[i].vitals.hp = r.w.players[i].vitals.max_hp * 0.2;
        r.w.players[i].vitals.hp_frac_at_tick_start = 0.2;
    }
    ref1.w.players[0].camps_cleared = 1;
    let d0 = no_camp_pass(&mut ref0);
    let d1 = no_camp_pass(&mut ref1);
    assert!(d1 > d0, "count 1 scales the same hit: {d0} -> {d1}");

    // The genuine one-clear control: in ONE pass the real last camp members die (queuing the real deferred CampCleared
    // payout) and the player hit is applied. The pass must use the old count 0; the payout increments the canonical count
    // to 1 only after the victims, and the NEXT ordinary pass must use the new count.
    let mut sim = pve_sim();
    grant(&mut sim, &[CardId::PackLeader, CardId::CoupDeGrace]);
    sim.s.mark_denials.push((PlayerId(2), PlayerId(1)));
    let i = p1_index(&sim);
    sim.w.players[i].vitals.hp = sim.w.players[i].vitals.max_hp * 0.2;
    sim.w.players[i].vitals.hp_frac_at_tick_start = 0.2;
    // Put the contributor at camp 0's centre so the real campHeal eligibility counts the clear for p0.
    let camp = 0u32;
    let centre = {
        let c = &sim.k.arena.map.layers().unwrap().data().camps[camp as usize];
        Vec2::new(c.x, c.y)
    };
    sim.w.players[0].body.x = centre.x;
    sim.w.players[0].body.y = centre.y;
    let d_same = run_pass(&mut sim, Some(camp), true);
    assert_eq!(
        sim.w.players[0].camps_cleared, 1,
        "the real camp payout counts the clear"
    );
    assert!(
        (d_same - d0).abs() < 1e-12,
        "the same-pass later hit must use the pass-start count 0: {d_same} != {d0}"
    );
    let d_next = no_camp_pass(&mut sim);
    assert!(
        (d_next - d1).abs() < 1e-12,
        "the next pass must use the new count 1: {d_next} != {d1}"
    );
}

/// Declared producer setup mirroring the admitted Sentenced tier fixtures: the second player is the Sentenced Mark
/// owner/victim and the first is the PackLeader+Coup de Grace attacker it marks; tier4 is earned by validated ordinary
/// targets/attacks/swap, never installed.
fn h1_duel() -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            pvp_rules: false,
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            min_players: 2,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[
            Placement {
                profile: "att".into(),
                faction: FactionId::Frost,
                at: Vec2::new(400., 320.),
                bot: false,
                hp: None,
                weapon0: Some(WeaponId::Sword),
                weapon1: Some(WeaponId::Wand),
            },
            Placement {
                profile: "mark".into(),
                faction: FactionId::Sentenced,
                at: Vec2::new(430., 320.),
                bot: false,
                hp: None,
                weapon0: Some(WeaponId::Sword),
                weapon1: Some(WeaponId::Wand),
            },
        ],
    );
    // Placement has no weapon field in this view: set the admitted weapons explicitly (declared setup).
    sim.w.players[0].weapon.weapon0 = Some(WeaponId::Sword);
    sim.w.players[0].weapon.weapon1 = Some(WeaponId::Wand);
    sim.w.players[1].weapon.weapon0 = Some(WeaponId::Sword);
    sim.w.players[1].weapon.weapon1 = Some(WeaponId::Wand);
    for (id, cards) in [
        (PlayerId(1), &[CardId::PackLeader, CardId::CoupDeGrace][..]),
        (
            PlayerId(2),
            &[
                CardId::Haste1,
                CardId::SwiftJudgment,
                CardId::NoCommutation,
                CardId::SlowBurn,
            ][..],
        ),
    ] {
        for c in cards {
            assert!(crate::cards::grant(&sim.k, &mut sim.w, id, *c));
        }
    }
    for (by, target, aim) in [(1u32, 2u32, 0.), (2, 1, crate::math::PI)] {
        sim.submit(
            PlayerId(by),
            validate(RawCommand::Target {
                id: PlayerId(target),
            })
            .unwrap(),
        )
        .unwrap();
        sim.submit(
            PlayerId(by),
            validate(RawCommand::Attack { a: aim, t: None }).unwrap(),
        )
        .unwrap();
    }
    sim
}

#[test]
fn h1_outcome_sensitive_execute_callsite_with_genuine_mark_denial() {
    let mut sim = h1_duel();
    // Earn the real Mark: the second player (owner/victim) earns hits through the validated ordinary duel producer.
    let mut earned = false;
    for _ in 0..240 {
        let before = sim.w.players[1].signature.mark.hits;
        let _ = sim.step();
        if sim.w.players[1].signature.mark.hits > before {
            earned = true;
            break;
        }
    }
    assert!(earned, "the genuine producer earns a Mark hit");
    // Victim swaps advance the tier through the validated command path.
    let mut tier = 0;
    for (n, slot) in [Some(1u8), Some(0u8), Some(1u8)].into_iter().enumerate() {
        if let Some(slot) = slot {
            sim.submit(
                PlayerId(1),
                validate(RawCommand::Swap { slot: Some(slot) }).unwrap(),
            )
            .unwrap();
        }
        let _ = sim.step();
        tier = sim.w.players[1].signature.mark.tier;
        println!(
            "H-1 earn: swap #{n} tier {tier} hits {} swaps {}",
            sim.w.players[1].signature.mark.hits, sim.w.players[1].signature.mark.swaps
        );
        if tier == 4 {
            break;
        }
    }
    assert_eq!(tier, 4, "earned tier4 (not installed)");
    // Real freeze_denials at the declared ledger boundary produces the nonempty (victim/mark owner, attacker) pair.
    crate::systems::sentenced::freeze_denials(&sim.k, &sim.w, &mut sim.s.mark_denials);
    assert!(
        sim.s.mark_denials.contains(&(PlayerId(2), PlayerId(1))),
        "the genuine freeze produces (mark owner/victim p1, attacker p0), got {:?}",
        sim.s.mark_denials
    );

    // Declared arithmetic diagnostic: B raw true damage, H-1 = 1.027*B, victim below Coup de Grace's hpBelow threshold.
    // Count 1 full/without are 1.33/1.03 (PackLeader 1.03 * Coup 1.30); wrong count0 share would leave 1.023076923B.
    let b = 100.0_f64;
    let max_hp = sim.w.players[1].vitals.max_hp;
    let h = 1.0 + 1.027 * b;
    assert!(
        h / max_hp < 0.3,
        "the declared victim hp fraction holds the Coup de Grace row"
    );
    sim.w.players[1].vitals.hp = h;
    sim.w.players[1].vitals.hp_frac_at_tick_start = h / max_hp;
    sim.w.players[0].camps_cleared = 1;
    let mut ev = Vec::new();
    sim.s.ledger.push(entry(PlayerId(2), PlayerId(1), b, true));
    super::apply(&mut cx(&mut sim, &mut ev));
    let loss = h - sim.w.players[1].vitals.hp;
    println!(
        "H-1: max_hp {max_hp:.3} H {h:.6} loss {loss:.9} denial {:?}",
        sim.s.mark_denials
    );
    // Correct count1 leaves 1.03*B applied (the wrong count0 share would leave 1.023076923*B).
    assert!((loss - 1.03 * b).abs() < 1e-9,
        "correct pass-start count1 leaves 1.03B (wrong count0 would leave 1.023076923B): loss {loss}");
    assert!(
        (loss - 1.0230769230769231 * b).abs() > 1e-6,
        "the count0 share is excluded"
    );

    // The same-pass old-count/new-pass-new-count control remains covered by the existing camps test.
}
