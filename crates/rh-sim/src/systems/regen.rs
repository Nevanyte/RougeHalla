//! Passive player health regeneration (legacy `regen.ts`): slow and always on when the config asks for it. Out of
//! combat (no hit dealt or taken for `PLAYER_REGEN_QUIET_MS`) a standing player regains `PLAYER_REGEN_SHARE_OUT` of max
//! hp a second; in a fight a quarter of that, or nothing under `SimConfig::regen_in_combat = Off` (unreleased legacy
//! f8cd956e, "out of combat only"; the live profiles opt in, P-REGEN-COMBAT-1). It runs as a system after the damage pass, so this tick's hits have already
//! stamped its clock, and it heals through the shared funnel (anti-heal and the heal-taken cards apply) and is quiet: no
//! fx, no event. Off unless `SimConfig.regen`.
//!
//! Legacy keeps one combat clock for every fighter id and stamps the victim and the attacker of each landed row. Only a
//! player is ever read, and ids are never reused, so the readable state is exactly each player's own last-hit time; the
//! clock therefore lives on the player (hashed, checkpointed, no side table) instead of a map.
use crate::constants::{
    PLAYER_REGEN_QUIET_MS, PLAYER_REGEN_SHARE_IN, PLAYER_REGEN_SHARE_OUT, TICK_MS,
};
use crate::events::Event;
use crate::hooks::{HookArgs, Hx};
use crate::state::{PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::{heal, signatures::LandedHit, Cx};

/// Legacy `regen.regenPass`.
pub(crate) fn pass(cx: &mut Cx) {
    pass_inner(cx.k, cx.w, &cx.s.landed, cx.ev);
}

fn pass_inner(k: &MatchStatic, w: &mut World, landed: &[LandedHit], ev: &mut Vec<Event>) {
    if !k.config.regen {
        return;
    }
    let now = w.server_time;
    for h in landed {
        stamp(w, h.victim, now);
        if let Some(by) = h.by {
            stamp(w, by, now);
        }
    }
    // The locked coliseum is sudden death's ground: no regeneration against its burn. The hits above still stamped the
    // clock first, as the source does.
    if w.rt.gates_locked {
        return;
    }
    let dt = TICK_MS / 1000.0;
    for i in 0..w.players.len() {
        let max_hp = {
            let p = &w.players[i];
            if !p.standing() || p.vitals.hp >= p.vitals.max_hp {
                continue;
            }
            p.vitals.max_hp
        };
        let quiet = w.players[i]
            .regen_at
            .is_none_or(|last| now - last >= PLAYER_REGEN_QUIET_MS);
        let share = if quiet {
            PLAYER_REGEN_SHARE_OUT
        } else if k.config.regen_in_combat == crate::RegenInCombat::Off {
            // Unreleased legacy f8cd956e: PLAYER_REGEN_SHARE_IN is 0 there (P-REGEN-COMBAT-1).
            0.0
        } else {
            PLAYER_REGEN_SHARE_IN
        };
        // Legacy f8cd956e `regen.ts`: `if (share <= 0) continue;`.
        if share <= 0.0 {
            continue;
        }
        heal::apply(w, ev, i, max_hp * share * dt, heal::Kind::QuietRegen);
    }
}

/// Records `now` as `id`'s last landed hit. Only a present player reads the clock, so only a present player is stamped.
fn stamp(w: &mut World, id: PlayerId, now: f64) {
    if let Some(p) = w.players.get_mut(id) {
        p.regen_at = Some(now);
    }
}

/// Legacy `regen.install`'s `raidStarted` link: a fresh run starts with an empty clock.
pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::RaidStarted {
        clear(hx.w);
    }
}

fn clear(w: &mut World) {
    for p in w.players.iter_mut() {
        p.regen_at = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas::practice_arena, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};

    fn sim(regen: bool) -> Sim {
        sim_with(SimConfig {
            regen,
            ..Default::default()
        })
    }

    fn sim_with(config: SimConfig) -> Sim {
        let ps: Vec<_> = (0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 1 {
                    FactionId::Frost
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: Vec2::new(320.0 + 64.0 * i as f64, 320.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let mut sim = Sim::reset_active(config, practice_arena(), Secrets::from_seed(1), &ps);
        sim.w.server_time = 1000.0;
        for p in sim.w.players.iter_mut() {
            p.vitals.hp = 400.0;
        }
        sim
    }

    fn run(sim: &mut Sim, landed: &[LandedHit]) -> Vec<Event> {
        let mut ev = Vec::new();
        pass_inner(&sim.k, &mut sim.w, landed, &mut ev);
        ev
    }

    fn landed(by: u32, victim: u32) -> LandedHit {
        LandedHit {
            race: 1.,
            passive: false,
            derived: false,
            critical: false,
            cut: 0.0,
            ability: None,
            dot: false,
            sig: None,
            weapon: Some(crate::WeaponId::Sword),
            victim: PlayerId(victim),
            by: Some(PlayerId(by)),
            amount: 10.0,
        }
    }

    fn out_share(max_hp: f64) -> f64 {
        max_hp * PLAYER_REGEN_SHARE_OUT * (TICK_MS / 1000.0)
    }

    fn in_share(max_hp: f64) -> f64 {
        max_hp * PLAYER_REGEN_SHARE_IN * (TICK_MS / 1000.0)
    }

    #[test]
    fn regeneration_is_off_unless_the_config_asks() {
        let mut sim = sim(false);
        let before = sim.w.players[0].vitals.hp;
        let ev = run(&mut sim, &[]);
        assert_eq!(sim.w.players[0].vitals.hp, before);
        assert!(sim.w.players[0].regen_at.is_none());
        assert!(ev.is_empty());
    }

    #[test]
    fn without_a_hit_the_out_of_combat_share_applies_and_is_quiet() {
        let mut sim = sim(true);
        let max = sim.w.players[0].vitals.max_hp;
        let before = sim.w.players[0].vitals.hp;
        let ev = run(&mut sim, &[]);
        assert_eq!(sim.w.players[0].vitals.hp, before + out_share(max));
        assert!(sim.w.players[0].regen_at.is_none());
        assert!(ev.is_empty(), "a quiet heal sends no event: {ev:?}");
    }

    #[test]
    fn a_landed_hit_stamps_its_victim_and_its_attacker() {
        let mut sim = sim(true);
        let attacker_max = sim.w.players[0].vitals.max_hp;
        let victim_max = sim.w.players[1].vitals.max_hp;
        let untouched_max = sim.w.players[2].vitals.max_hp;
        let before: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        let ev = run(&mut sim, &[landed(1, 2)]);
        assert_eq!(sim.w.players[0].regen_at, Some(1000.0));
        assert_eq!(sim.w.players[1].regen_at, Some(1000.0));
        assert!(sim.w.players[2].regen_at.is_none());
        assert_eq!(
            sim.w.players[0].vitals.hp,
            before[0] + in_share(attacker_max)
        );
        assert_eq!(sim.w.players[1].vitals.hp, before[1] + in_share(victim_max));
        assert_eq!(
            sim.w.players[2].vitals.hp,
            before[2] + out_share(untouched_max)
        );
        assert!(ev.is_empty());
    }

    #[test]
    fn the_quiet_window_ends_exactly_three_seconds_after_the_last_hit() {
        let mut sim = sim(true);
        sim.w.players[0].regen_at = Some(1000.0 - PLAYER_REGEN_QUIET_MS);
        sim.w.players[1].regen_at = Some(1000.0 - PLAYER_REGEN_QUIET_MS * 0.9);
        let out_max = sim.w.players[0].vitals.max_hp;
        let in_max = sim.w.players[1].vitals.max_hp;
        let before: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        run(&mut sim, &[]);
        assert_eq!(sim.w.players[0].vitals.hp, before[0] + out_share(out_max));
        assert_eq!(sim.w.players[1].vitals.hp, before[1] + in_share(in_max));
    }

    #[test]
    fn a_locked_coliseum_regenerates_nothing_but_still_stamps_the_hit() {
        let mut sim = sim(true);
        sim.w.rt.gates_locked = true;
        let before: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        run(&mut sim, &[landed(1, 2)]);
        assert_eq!(sim.w.players[0].regen_at, Some(1000.0));
        assert_eq!(sim.w.players[1].regen_at, Some(1000.0));
        assert_eq!(
            sim.w
                .players
                .iter()
                .map(|p| p.vitals.hp)
                .collect::<Vec<_>>(),
            before
        );
    }

    #[test]
    fn a_down_player_never_regenerates() {
        let mut sim = sim(true);
        sim.w.players[0].status = crate::Status::Dead;
        sim.w.players[0].vitals.hp = 0.0;
        run(&mut sim, &[]);
        assert_eq!(sim.w.players[0].vitals.hp, 0.0);
    }

    #[test]
    fn the_raid_start_clears_every_clock() {
        let mut sim = sim(true);
        for p in sim.w.players.iter_mut() {
            p.regen_at = Some(1000.0);
        }
        clear(&mut sim.w);
        assert!(sim.w.players.iter().all(|p| p.regen_at.is_none()));
    }

    /// P-REGEN-COMBAT-1 (legacy f8cd956e): with `regen_in_combat = Off` a player heals passively only out of combat. The
    /// attacker and victim of this tick's hit, and a player hit 2.7 s ago, regain nothing; an untouched player and one last
    /// hit exactly 3 s ago regain the out-of-combat share, unchanged.
    #[test]
    fn with_regen_in_combat_off_a_fight_heals_nothing_and_quiet_players_heal_as_before() {
        let mut sim = sim_with(SimConfig {
            regen: true,
            regen_in_combat: crate::RegenInCombat::Off,
            ..Default::default()
        });
        let max: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.max_hp).collect();
        let before: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        let ev = run(&mut sim, &[landed(1, 2)]);
        assert_eq!(
            sim.w.players[0].vitals.hp, before[0],
            "attacker heals in a fight"
        );
        assert_eq!(
            sim.w.players[1].vitals.hp, before[1],
            "victim heals in a fight"
        );
        assert_eq!(sim.w.players[2].vitals.hp, before[2] + out_share(max[2]));
        assert!(ev.is_empty());

        sim.w.server_time = 1000.0 + PLAYER_REGEN_QUIET_MS * 0.9;
        let mid: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        run(&mut sim, &[]);
        assert_eq!(
            sim.w.players[0].vitals.hp, mid[0],
            "still in the quiet window"
        );
        assert_eq!(
            sim.w.players[1].vitals.hp, mid[1],
            "still in the quiet window"
        );

        sim.w.server_time = 1000.0 + PLAYER_REGEN_QUIET_MS;
        let quiet: Vec<f64> = sim.w.players.iter().map(|p| p.vitals.hp).collect();
        run(&mut sim, &[]);
        assert_eq!(sim.w.players[0].vitals.hp, quiet[0] + out_share(max[0]));
        assert_eq!(sim.w.players[1].vitals.hp, quiet[1] + out_share(max[1]));
    }
}
