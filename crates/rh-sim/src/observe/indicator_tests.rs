//! ADR0026 fairness: the indicator facts of an actor travel only on that actor's delivered row, and each is the legacy
//! verdict (never a clock or a magnitude).
use super::*;
use crate::kill_augments::KillStatKey;
use crate::{Placement, Secrets, SimConfig, Vec2};

/// The owner at x 100 and a Fire rival at x 150 (in sight) or x 300 (out of sight), the rival holding a sword in slot 0
/// and a bow in slot 1.
fn world(visible: bool) -> Sim {
    let mut arena = crate::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(100., 176.)];
    let placements = [
        (100., "owner", None, None),
        (
            if visible { 150. } else { 300. },
            "rival",
            Some(WeaponId::Sword),
            Some(WeaponId::Bow),
        ),
    ]
    .into_iter()
    .map(|(x, profile, weapon0, weapon1)| Placement {
        profile: profile.into(),
        faction: FactionId::Fire,
        bot: false,
        at: Vec2::new(x, 176.),
        hp: None,
        weapon0,
        weapon1,
    })
    .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(7),
        &placements,
    )
}

/// Gives the rival a damage investment, an immunity deadline inside the ring window and an armed roam burst.
fn decorate(sim: &mut Sim) -> (PlayerId, PlayerId) {
    let now = sim.server_time();
    let (owner, rival) = (sim.w.players[0].id, sim.w.players[1].id);
    let p = &mut sim.w.players[1];
    p.kill_stats.add(KillStatKey::Damage, 0.05);
    p.kill_stats.add(KillStatKey::Leech, 0.02);
    p.vitals.immune_until = now + 1000.;
    p.roam.ready = true;
    (owner, rival)
}

#[test]
fn a_rival_out_of_sight_delivers_none_of_its_indicator_facts() {
    let mut sim = world(false);
    let (owner, rival) = decorate(&mut sim);
    let obs = observe(&sim, owner, &[]);
    assert!(
        obs.visible.iter().all(|a| a.id != rival),
        "the rival is not delivered"
    );
    // Nothing of the rival's loadout, build, immunity or roam state appears anywhere in the observation.
    assert!(obs
        .visible
        .iter()
        .all(|a| a.facts == IndicatorFacts::default()));
    let me = obs.me.as_ref().unwrap();
    assert_eq!(
        me.facts.offhand, None,
        "the self view never carries an off-hand"
    );
    assert_eq!(me.facts.build_marks, [None, None]);
    assert!(!me.facts.roam_ready && !me.facts.teleport_immune);
    let text = format!("{obs:?}");
    assert!(
        !text.contains("Bow"),
        "the rival's second slot leaks nowhere: {text}"
    );
}

#[test]
fn a_rival_in_sight_carries_exactly_the_legacy_verdicts() {
    let mut sim = world(true);
    let (owner, rival) = decorate(&mut sim);
    let obs = observe(&sim, owner, &[]);
    let row = obs
        .visible
        .iter()
        .find(|a| a.id == rival)
        .expect("in sight");
    assert_eq!(row.weapon, Some(WeaponId::Sword));
    assert_eq!(
        row.facts.offhand,
        Some(WeaponId::Bow),
        "the slot not in hand"
    );
    assert_eq!(
        row.facts.build_marks,
        [Some(KillStatKey::Damage), Some(KillStatKey::Leech)],
        "damage 5.0 then leech 0.4: keys only"
    );
    assert!(row.facts.teleport_immune && row.facts.roam_ready);
    assert!(!row.facts.engaged, "a player is never `engaged`");
    // The ring is legacy's window: more than 1.5 s of immunity left shows nothing yet; none left shows nothing.
    let now = sim.server_time();
    sim.w.players[1].vitals.immune_until = now + 1501.;
    let row = observe(&sim, owner, &[])
        .visible
        .into_iter()
        .find(|a| a.id == rival)
        .unwrap();
    assert!(!row.facts.teleport_immune);
    sim.w.players[1].vitals.immune_until = now;
    let row = observe(&sim, owner, &[])
        .visible
        .into_iter()
        .find(|a| a.id == rival)
        .unwrap();
    assert!(!row.facts.teleport_immune);
    // The rival's own view of itself carries the same marks, but its own off-hand stays in its inventory.
    let own = observe(&sim, rival, &[]).me.unwrap();
    assert_eq!(own.facts.build_marks, row.facts.build_marks);
    assert_eq!(own.facts.offhand, None);
}

#[test]
fn wish_ready_is_a_verdict_of_the_ready_time_and_engaged_reads_the_mob_clocks() {
    let mut sim = world(true);
    let now = sim.server_time();
    let p = &mut sim.w.players[1];
    p.stocks.wish_ready_at = now + 1.;
    assert!(!IndicatorFacts::player(p, now, true).wish_ready);
    p.stocks.wish_ready_at = now;
    assert!(IndicatorFacts::player(p, now, true).wish_ready);
    assert!(
        !IndicatorFacts::player(p, now, false).wish_ready,
        "no Wishes in this match"
    );
    p.status = Status::Lobby;
    assert!(
        !IndicatorFacts::player(p, now, true).wish_ready,
        "legacy shows no Wish in the lobby"
    );
    let core = &mut sim.w.players[1].core;
    core.weapon.ready_at = now + 1.;
    core.weapon.draw_started_at = 0.;
    assert!(
        IndicatorFacts::mob(core, true, now).engaged,
        "a cooldown runs"
    );
    assert!(
        !IndicatorFacts::mob(core, false, now).engaged,
        "only regional mobs"
    );
    core.weapon.ready_at = now;
    assert!(!IndicatorFacts::mob(core, true, now).engaged, "calm");
    core.weapon.draw_started_at = 5.;
    assert!(
        IndicatorFacts::mob(core, true, now).engaged,
        "a bow is drawn"
    );
    let mob = IndicatorFacts::mob(core, true, now);
    assert_eq!((mob.offhand, mob.build_marks), (None, [None, None]));
    assert!(!mob.wish_ready && !mob.teleport_immune && !mob.roam_ready);
}

#[test]
fn the_windup_telegraph_reaches_exactly_the_observers_of_its_swing() {
    for visible in [false, true] {
        let sim = world(visible);
        let (owner, rival) = (sim.w.players[0].id, sim.w.players[1].id);
        let windup = Event::Windup {
            by: rival,
            weapon: WeaponId::Sword,
            a: 1.0,
            ms: 300.,
        };
        let swing = Event::Swing {
            by: rival,
            weapon: WeaponId::Sword,
            x: 1.,
            y: 2.,
            a: 1.0,
        };
        assert_eq!(windup.visibility(), swing.visibility());
        assert_eq!(windup.class(), swing.class());
        let cancel = Event::AttackCancelled { id: rival };
        let obs = observe(&sim, owner, &[windup.clone(), swing, cancel]);
        let windups = obs
            .events
            .iter()
            .filter(|e| matches!(e, SeenEvent::Windup { .. }))
            .count();
        let swings = obs
            .events
            .iter()
            .filter(|e| matches!(e, SeenEvent::Swing { .. }))
            .count();
        let cancels = obs
            .events
            .iter()
            .filter(|e| matches!(e, SeenEvent::AttackCancelled { .. }))
            .count();
        assert_eq!(
            (windups, swings, cancels),
            if visible { (1, 1, 1) } else { (0, 0, 0) }
        );
        // The attacker always sees its own telegraph.
        let own = observe(&sim, rival, &[windup]);
        assert!(matches!(
            own.events[..],
            [SeenEvent::Windup { by, ms, .. }] if by == rival && ms == 300.
        ));
    }
}

#[test]
fn the_roster_lists_every_seated_player_for_every_viewer_and_nothing_else() {
    for visible in [false, true] {
        let mut sim = world(visible);
        sim.w.players[1].seat.bot = true;
        let (owner, rival) = (sim.w.players[0].id, sim.w.players[1].id);
        let mine = observe(&sim, owner, &[]);
        let theirs = observe(&sim, rival, &[]);
        assert_eq!(mine.roster, theirs.roster, "the same for every viewer");
        assert_eq!(
            mine.roster,
            vec![
                RosterRow {
                    id: owner,
                    name: "owner".into(),
                    bot: false
                },
                RosterRow {
                    id: rival,
                    name: "rival".into(),
                    bot: true
                },
            ],
            "whether or not the rival is in sight"
        );
    }
    // A reused buffer is refreshed in place (a rename, a shorter roster).
    let mut sim = world(true);
    let mut out = Observation::default();
    observe_into(&sim, sim.w.players[0].id, &[], &mut out);
    sim.w.players[1].seat.name = "renamed".into();
    observe_into(&sim, sim.w.players[0].id, &[], &mut out);
    assert_eq!(out.roster[1].name, "renamed");
}
