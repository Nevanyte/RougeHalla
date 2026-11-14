//! P-BOT-BRAIN-THEMED-1 oracle: the Brain values a camp by the buff it actually pays.
//!
//! Legacy reference: the camp-buff patch `a7b5c4ce` (`origin/claude/adoring-edison-mxt8ab`, not in `packages/`) changed
//! the Brain's camp value to `typeWeight(this.build, c.buff || c.type || undefined)` (`buildRoute.ts` campValue), the
//! buff being the normal type whose stat the camp's kills pay. A type's weight is the build's weight for that type's stat
//! (`typeWeight` -> `mobStatReward(type)` -> `BUILD_GOALS` weight, floored), so valuing by the paid stat is that rule.
//!
//! The seat reads only its own composed percept (C-OBS): `extras.camps[].reward` is the composer's HUD stat code of the
//! camp's per-kill reward (public content, `observe.rs` `camp_hud_into`), present for every camp row in both buff modes.
//! Loose-proof standard (owner direction 2026-11-10): the numbers are the source formula on a real composed percept.
use super::adapters;
use super::compose14::{brain_map, test_support::seed1_arena, Composer14, Setup14};
use crate::bots::build_route::{
    reward_stat, type_weight, BuildGoal, FarmStat, BUILD_GOALS, ELITE_VALUE, STAT_FLOOR,
};
use crate::bots::temporal_percept::strategy::types::RouteCamp;
use crate::bots::temporal_percept::strategy::{
    route_camp_value, route_camps, BuildRoute, RouteInput,
};
use crate::delivery::DeliverySession;
use rh_sim::mob_runtime::MobMode;
use rh_sim::{
    ArenaMode, CampBuffRule, FactionId, ItemObserver, Observation, Secrets, Sim, SimConfig, Vec2,
};

/// The composer's HUD stat codes (`compose14.rs` HUD_STATS) and the farm stat each one is (`observe.rs` `hud_stat`).
/// The unthemed test checks this table against the real pipeline (every camp's code is its own type's stat).
const HUD_STAT: [(&str, FarmStat); 9] = [
    ("offense", FarmStat::Ad),
    ("soulOffense", FarmStat::Ap),
    ("damage", FarmStat::Damage),
    ("attackSpeed", FarmStat::AttackSpeed),
    ("lifeSteal", FarmStat::Lifesteal),
    ("health", FarmStat::MaxHp),
    ("defense", FarmStat::Armor),
    ("soulDefense", FarmStat::Shield),
    ("moveSpeed", FarmStat::MoveSpeed),
];

fn stat_of(code: &str) -> Option<FarmStat> {
    HUD_STAT.iter().find(|(c, _)| *c == code).map(|(_, s)| *s)
}

fn builds() -> impl Iterator<Item = &'static BuildGoal> {
    BUILD_GOALS.iter().flatten()
}

/// The camp value before this packet (`buildRoute.ts` campValue before `a7b5c4ce`): weighted by the mob type.
fn by_type(build: &BuildGoal, c: &RouteCamp, elites: bool) -> f64 {
    shaped(c, elites, || {
        type_weight(
            build,
            (!c.mob_type.is_empty()).then_some(c.mob_type.as_str()),
        )
    })
}

/// The camp value after `a7b5c4ce`: weighted by the stat the camp pays, as the seat's percept reports it; by the mob
/// type when the percept carries no stat for the camp.
fn by_reward(build: &BuildGoal, c: &RouteCamp, elites: bool) -> f64 {
    match stat_of(&c.reward) {
        Some(stat) => shaped(c, elites, || build.weight(stat).max(STAT_FLOOR)),
        None => by_type(build, c, elites),
    }
}

/// The source campValue shape around a weight (elite gate, normals, ELITE_VALUE), in its float order.
fn shaped(c: &RouteCamp, elites: bool, weight: impl Fn() -> f64) -> f64 {
    if c.elite && !elites {
        return 0.;
    }
    let mobs = if c.state == 2 {
        f64::from(c.spots)
    } else {
        f64::from(c.alive)
    };
    let normals = if c.elite { (mobs - 1.).max(0.) } else { mobs };
    let mut v = normals * weight();
    if c.elite && mobs > 0. {
        v += ELITE_VALUE;
    }
    v
}

/// The route's camps as one Brain seat composes them: the source-arena map (seed1) in its lobby, the given buff rule,
/// one seated bot, frames through the real observer, delivery session, composer and strategy adapter.
fn composed_route_camps(rule: CampBuffRule, seed: u64) -> (Sim, Vec<RouteCamp>) {
    let arena = seed1_arena();
    // The source-arena lifecycle (the composer needs the arena view), mobs on, as the Brain tournament world.
    let config = SimConfig {
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        camp_buffs: rule,
        ..SimConfig::default()
    };
    let mut sim = Sim::try_new(config.clone(), arena.clone(), Secrets::from_seed(seed))
        .expect("seed1 Pve world");
    let me = sim
        .add_player("seat", Some(FactionId::Fire), true)
        .expect("seat");
    let features = crate::bots::brain_features(&config, &arena);
    let mut composer = Composer14::new(Setup14::public(&arena, features, 0.6));
    let mut session = DeliverySession::new(me);
    let mut observer = ItemObserver::new(me);
    let mut last = None;
    for _ in 0..6 {
        let mut obs = Observation::default();
        observer
            .prepare_into(&sim, &[], &mut obs, None)
            .expect("seat scene")
            .commit();
        let prepared = session
            .prepare(&obs, false, false, &[])
            .expect("representable scene");
        let frame = session.commit(prepared);
        last = Some(composer.compose(frame.frame()).expect("frame composes"));
        sim.step();
    }
    let composed = last.expect("composed");
    let percept = adapters::strategy_percept(&composed.percept).expect("strategy percept");
    let views = percept.extras.camps.expect("the camps feature is on");
    let camps = route_camps(&views, &brain_map(&arena).strategy.camps);
    assert_eq!(
        camps.len(),
        sim.camp_rosters().len(),
        "every camp of the map reaches the route"
    );
    (sim, camps)
}

const SEED: u64 = 11;

/// (1) Themed world: a camp is worth what its kills pay. Off-theme camps (the stat differs from the mob type's own) are
/// valued by the stat; red before this packet, which values them by the mob type.
#[test]
fn themed_camps_are_valued_by_the_stat_they_pay_not_their_mob_type() {
    let (sim, camps) = composed_route_camps(CampBuffRule::Themed, SEED);
    assert!(
        sim.camp_buffs().iter().any(Option::is_some),
        "the Themed world names buffs"
    );
    // Every camp's reward is a stat code; about three in ten pay a stat other than their mob type's own.
    let mut off_theme = 0usize;
    for c in &camps {
        let paid = stat_of(&c.reward).unwrap_or_else(|| {
            panic!(
                "camp {} ({}): the percept carries every camp's reward stat in a themed world, got {:?}",
                c.index, c.mob_type, c.reward
            )
        });
        if Some(paid) != reward_stat(Some(&c.mob_type)) {
            off_theme += 1;
        }
    }
    eprintln!("{off_theme} of {} camps off theme", camps.len());
    // Not drastically off: the patch measured about 29% of camps off theme (theme 71.3%).
    assert!(
        off_theme * 10 >= camps.len() && off_theme * 2 <= camps.len(),
        "{off_theme} of {} camps off theme",
        camps.len()
    );
    let mut moved = 0usize;
    for c in &camps {
        for build in builds() {
            for elites in [false, true] {
                let want = by_reward(build, c, elites);
                if want != by_type(build, c, elites) {
                    moved += 1;
                }
                let got = route_camp_value(build, c, elites);
                assert_eq!(
                    got.to_bits(),
                    want.to_bits(),
                    "camp {} ({} paying {}), build {}, elites {elites}: value {got}, the paid stat gives {want}",
                    c.index,
                    c.mob_type,
                    c.reward,
                    build.id
                );
            }
        }
    }
    assert!(moved > 0, "some build values some camp differently");
}

/// (1, direction) Two camps of one mob type paying different stats: the build that wants one of them prefers it, by its
/// weight table, and the planner's first step goes there. Red before this packet (both get the type's weight).
#[test]
fn two_camps_of_one_type_paying_different_stats_are_ranked_by_the_build_weights() {
    // Fire A (AD burst assassin): Damage 1, Offense (AD) 0.75; Soul Offense (AP) is not asked for, the floor 0.25.
    let build = &BUILD_GOALS[0][0];
    assert_eq!(build.id, "fire:A");
    let camp = |index: u32, x: f64, reward: &str| RouteCamp {
        index,
        id: format!("c{index}"),
        zone: FactionId::Fire,
        x,
        y: 500.,
        r: 100.,
        elite: false,
        spots: 4,
        mob_type: "flameCaller".into(),
        reward: reward.into(),
        alive: 4,
        state: 0,
        respawn_at: 0.,
    };
    let soul = camp(0, 500., "soulOffense");
    let damage = camp(1, 900., "damage");
    let offense = camp(2, 900., "offense");
    let v = |c: &RouteCamp| route_camp_value(build, c, false);
    assert_eq!(v(&soul), 4. * STAT_FLOOR);
    assert_eq!(v(&damage), 4. * 1.);
    assert_eq!(v(&offense), 4. * 0.75);
    assert!(v(&damage) > v(&offense) && v(&offense) > v(&soul));
    // a7b5c4ce buildRoute.test.ts: "damage, past the nearer Soul Offence camp".
    let camps = vec![soul, damage];
    let players: Vec<Vec2> = Vec::new();
    let can_farm = |_: &RouteCamp| true;
    let mut planner = BuildRoute::new(FactionId::Fire, 0.2);
    assert_eq!(planner.build.id, "fire:A");
    let first = planner
        .update(&RouteInput {
            now: 1000.,
            run_ms: 0.,
            self_pos: Vec2::new(100., 500.),
            speed: 170.,
            mob_kills: 0.,
            power: 0.,
            camps: &camps,
            players: &players,
            can_farm: &can_farm,
        })
        .map(|step| step.camp);
    assert_eq!(
        first,
        Some(1),
        "Fire A walks past the nearer Soul Offence camp to the Damage one"
    );
}

/// (2) A camp whose reward the percept does not carry (the frozen corpus's legacy CampState.reward "", a hidden "?",
/// any non-stat text) is valued by its mob type, exactly as before this packet. Green today; stays green.
#[test]
fn a_camp_without_a_reward_stat_in_the_percept_is_valued_by_its_mob_type() {
    for reward in ["", "?", "skills", "relic", "cursed", "Damage", "ad"] {
        for mob_type in ["flameCaller", "emberImp", "pardoner", ""] {
            for (elite, state, alive) in [(false, 0, 3), (true, 0, 4), (false, 2, 0), (true, 1, 1)]
            {
                let c = RouteCamp {
                    index: 0,
                    id: "c0".into(),
                    zone: FactionId::Fire,
                    x: 0.,
                    y: 0.,
                    r: 100.,
                    elite,
                    spots: 4,
                    mob_type: mob_type.into(),
                    reward: reward.into(),
                    alive,
                    state,
                    respawn_at: 0.,
                };
                for build in builds() {
                    for elites in [false, true] {
                        assert_eq!(
                            route_camp_value(build, &c, elites).to_bits(),
                            by_type(build, &c, elites).to_bits(),
                            "reward {reward:?}, type {mob_type:?}, build {}",
                            build.id
                        );
                    }
                }
            }
        }
    }
}

/// (3) Unthemed (legacy) world: every camp pays its own type's stat, so every camp's value is today's, bit for bit, for
/// every build. Green today; stays green (the frozen corpus and `parity/policy/` captures guard the source paths).
#[test]
fn unthemed_rewards_leave_every_camp_value_as_today() {
    let (sim, camps) = composed_route_camps(CampBuffRule::Legacy, SEED);
    assert!(sim.camp_buffs().is_empty(), "no buffs under Legacy");
    for c in &camps {
        assert_eq!(
            stat_of(&c.reward),
            reward_stat(Some(&c.mob_type)),
            "camp {} ({}): under Legacy the percept's reward is the type's own stat, got {:?}",
            c.index,
            c.mob_type,
            c.reward
        );
        for build in builds() {
            for elites in [false, true] {
                assert_eq!(
                    route_camp_value(build, c, elites).to_bits(),
                    by_type(build, c, elites).to_bits(),
                    "camp {} ({}), build {}",
                    c.index,
                    c.mob_type,
                    build.id
                );
            }
        }
    }
}
