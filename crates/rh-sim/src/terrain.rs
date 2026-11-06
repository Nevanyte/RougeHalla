//! Source terrain surface rules and private runtime; no client or policy receives this memory.
use crate::{FactionId, PlayerId, TileMap};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Mode {
    #[default]
    Off,
    Map,
    All,
}
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Hazards {
    pub burn: bool,
    pub slow: bool,
    pub slip: bool,
    pub heal: bool,
}
impl Hazards {
    pub(crate) fn of(map: &TileMap, mode: Mode) -> Self {
        if mode == Mode::Off {
            return Self::default();
        }
        let mut h = Self::default();
        if let Some(l) = map.layers() {
            for &kind in &l.data().terrain {
                let e = surface(kind, None);
                h.burn |= e.burn > 0.;
                h.slow |= e.speed != 1.;
                h.slip |= e.accel > 0.;
                h.heal |= e.heal > 0.;
            }
        }
        h
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Effect {
    pub speed: f64,
    pub accel: f64,
    pub burn: f64,
    pub heal: f64,
}
pub(crate) const EMBER_NAME: &str = "Lava";
pub(crate) const NEUTRAL: Effect = Effect {
    speed: 1.,
    accel: 0.,
    burn: 0.,
    heal: 0.,
};
pub(crate) use crate::constants::TERRAIN_BOG as BOG;
pub(crate) use crate::constants::TERRAIN_BURN as BURN;
pub(crate) use crate::constants::TERRAIN_HEAL as HEAL;
pub(crate) use crate::constants::TERRAIN_HOME_HEAL as HOME_HEAL;
pub(crate) use crate::constants::TERRAIN_LIGHT_FX_MIN as LIGHT_FX_MIN;
pub(crate) use crate::constants::TERRAIN_LIGHT_FX_MS as LIGHT_FX_MS;
pub(crate) use crate::constants::TERRAIN_SLIP_MS as SLIP_MS;
pub(crate) fn surface(kind: u8, faction: Option<FactionId>) -> Effect {
    let mut e = NEUTRAL;
    match kind {
        4 if faction != Some(FactionId::Fire) => e.burn = BURN,
        5 if faction != Some(FactionId::Plague) => e.speed = BOG,
        6 if faction != Some(FactionId::Frost) => e.accel = slip_accel(SLIP_MS),
        7 => {
            e.heal = if faction == Some(FactionId::Holy) {
                HEAL * HOME_HEAL
            } else {
                HEAL
            }
        }
        _ => (),
    }
    e
}
pub(crate) fn at(map: &TileMap, x: f64, y: f64, faction: Option<FactionId>) -> Effect {
    let tx = crate::map::world_to_tile(x);
    let ty = crate::map::world_to_tile(y);
    if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
        return NEUTRAL;
    }
    surface(
        map.layers().map_or(0, |l| {
            l.data().terrain[ty as usize * map.w as usize + tx as usize]
        }),
        faction,
    )
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Runtime {
    pub light_acc: Vec<(PlayerId, f64)>,
    pub light_since: f64,
    pub combat_at: Vec<(PlayerId, f64)>,
    pub seconds: [f64; 4],
    pub damage: Vec<(PlayerId, f64)>,
    pub heal: Vec<(PlayerId, f64)>,
}
pub(crate) fn add(rows: &mut Vec<(PlayerId, f64)>, id: PlayerId, value: f64) {
    if let Some((_, v)) = rows.iter_mut().find(|(key, _)| *key == id) {
        *v += value;
    } else {
        rows.push((id, value));
    }
}
pub(crate) fn stamp(rows: &mut Vec<(PlayerId, f64)>, id: PlayerId, now: f64) {
    if let Some((_, v)) = rows.iter_mut().find(|(key, _)| *key == id) {
        *v = now;
    } else {
        rows.push((id, now));
    }
}
pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    for v in [
        BURN,
        BOG,
        SLIP_MS,
        HEAL,
        HOME_HEAL,
        LIGHT_FX_MS,
        LIGHT_FX_MIN,
    ] {
        word(v.to_bits());
    }
    for kind in 0..8 {
        word(kind as u64);
        for faction in [
            None,
            Some(FactionId::Fire),
            Some(FactionId::Plague),
            Some(FactionId::Frost),
            Some(FactionId::Holy),
            Some(FactionId::Sentenced),
        ] {
            word(faction.map_or(0, |f| f as u64 + 1));
            let e = surface(kind, faction);
            for value in [e.speed, e.accel, e.burn, e.heal] {
                word(value.to_bits());
            }
        }
    }
    for standing in [false, true] {
        for dummy in [false, true] {
            for returning in [false, true] {
                for locked in [false, true] {
                    word(
                        burn_share(surface(4, None), standing, dummy, returning, locked).to_bits(),
                    );
                }
            }
        }
    }
    for player in [false, true] {
        word(light_share(surface(7, None), player).to_bits());
    }
    for b in EMBER_NAME.as_bytes() {
        word(u64::from(*b));
    }
    for b in b"terrain-runtime/1:arena-true;recent-rival;quiet-player-light;dummy-exempt;return-no-burn;locked-no-burn;centre-tile;off-map-all" {word(u64::from(*b));}
    crate::systems::terrain::walk::visit_content(word);
}

pub(crate) fn validate(
    k: &crate::statics::MatchStatic,
    w: &crate::state::World,
    near: impl Fn(f64, f64) -> bool,
) -> Result<(), String> {
    validate_config(&k.config)?;
    // Lifecycle admission owns the source gate producer and its clocks. Legacy Off profiles
    // retain the earlier refusal; terrain never creates or repairs gate state.
    if w.rt.gates_locked && k.config.lifecycle.rules().is_none() {
        return Err("arena gate lock requires source lifecycle".into());
    }
    let rt = &w.terrain;
    if !rt.light_since.is_finite()
        || !(0. ..=w.server_time).contains(&rt.light_since)
        || rt.seconds.iter().any(|x| !x.is_finite() || *x < 0.)
    {
        return Err("invalid terrain clock or seconds".into());
    }
    for (name, rows, players, clock) in [
        ("light accumulator", &rt.light_acc, true, false),
        ("combat clock", &rt.combat_at, false, true),
        ("damage", &rt.damage, false, false),
        ("healing", &rt.heal, true, false),
    ] {
        for (i, (id, value)) in rows.iter().enumerate() {
            if !value.is_finite()
                || *value < 0.
                || (clock && *value > w.server_time)
                || !w.known_actor(*id)
                || (players
                    && !matches!(
                        w.actor_origin(*id),
                        Some(crate::mob_runtime::ActorOrigin::Player { .. })
                    ))
                || rows[..i].iter().any(|(prev, _)| prev == id)
            {
                return Err(format!("invalid terrain {name}"));
            }
        }
    }
    if k.config.hazards == Mode::Off
        && (rt.seconds != [0.; 4]
            || !rt.light_acc.is_empty()
            || !rt.combat_at.is_empty()
            || !rt.damage.is_empty()
            || !rt.heal.is_empty())
    {
        return Err("terrain state requires enabled hazards".into());
    }
    // Each native movement step starts from positions admitted within this map margin,
    // then adds only bounded traction. This deliberately exceeds any one-tick history velocity.
    let span = (f64::from(k.arena.map.w.max(k.arena.map.h)) * crate::constants::TILE + 2048.) * 4.;
    let velocity_limit = span / (crate::constants::TICK_MS / 1000.);
    for i in 0..w.fighter_count() {
        let p = w.core(crate::fighter::FighterIx::of_slot(i));
        if p.motion.path.generation > path_generation_limit(w.tick) {
            return Err("unreachable path generation for tick".into());
        }
        let Some(s) = &p.motion.slip else {
            continue;
        };
        if k.config.hazards == Mode::Off || !k.hazards.slip {
            return Err("slip requires map ice and enabled hazards".into());
        }
        let tuple = [s.stuck_x, s.stuck_y, s.stuck_n, s.stuck_best, s.stuck_at];
        let populated = tuple.iter().filter(|x| x.is_some()).count();
        if !near(s.ax, s.ay)
            || ![s.vx, s.vy]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= velocity_limit)
            || s.path.is_some_and(|g| g > p.motion.path.generation)
            || s.replan_at.is_some_and(|t| {
                !t.is_finite()
                    || t < 0.
                    || t > w.server_time + crate::systems::terrain::walk::REPLAN_MS
            })
            || s.grip_until.is_some_and(|t| {
                !t.is_finite()
                    || t < 0.
                    || t > w.server_time + crate::systems::terrain::walk::GRIP_MS
            })
            || (populated != 0 && populated != 5)
            || ((s.replan_at.is_some() || s.grip_until.is_some()) && populated != 5)
            || (populated == 5
                && (!near(s.stuck_x.unwrap(), s.stuck_y.unwrap())
                    || !s.stuck_n.unwrap().is_finite()
                    || s.stuck_n.unwrap().fract() != 0.
                    || !(0. ..crate::systems::terrain::walk::STUCK_REPLANS)
                        .contains(&s.stuck_n.unwrap())
                    || !s.stuck_best.unwrap().is_finite()
                    || !(0. ..=span).contains(&s.stuck_best.unwrap())
                    || !s.stuck_at.unwrap().is_finite()
                    || !(0. ..=w.server_time).contains(&s.stuck_at.unwrap())))
        {
            return Err("invalid terrain slip state".into());
        }
    }
    Ok(())
}

pub(crate) fn validate_config(config: &crate::SimConfig) -> Result<(), &'static str> {
    if config.hazards != Mode::Off
        && config.mob_mode == crate::mob_runtime::MobMode::SpawnFoundation
    {
        Err("terrain requires complete mob PvE runtime, not spawn-only foundation")
    } else {
        Ok(())
    }
}

pub(crate) fn slip_accel(ms: f64) -> f64 {
    if ms > 0. {
        crate::constants::PLAYER_SPEED * 1000. / ms
    } else {
        0.
    }
}

/// Conservative producer ceiling: at most four replacements per queued action/move,
/// plus 64 for fixed targeting/movement/death/reset links. Inputs admit six actions
/// and one coalesced move per actor per tick; collision replans preserve identity.
/// No current damage callback repeatedly replaces a victim path; death does so once.
/// New path producers must extend this inventory. Even at the u32 tick horizon this
/// leaves over seven orders of magnitude of u64 headroom, rather than a fixed tail.
pub(crate) fn path_generation_limit(tick: u32) -> u64 {
    (u64::from(tick) + 1) * (4 * (crate::constants::MAX_ACTIONS_PER_TICK as u64 + 1) + 64)
}

/// Explicit pure shared-walk harness; never an actor or an alternate input path.
#[cfg(feature = "trusted-status-probes")]
pub mod probe {
    pub struct Slide {
        map: crate::TileMap,
        pf: crate::pathfind::Pathfinder,
        path: crate::state::Path,
        body: crate::Vec2,
        slip: crate::fighter::SlipState,
        radius: f64,
    }
    impl Slide {
        pub fn new(map: crate::TileMap, body: crate::Vec2, goal: crate::Vec2, radius: f64) -> Self {
            let mut s = Self {
                map,
                pf: Default::default(),
                path: Default::default(),
                body,
                slip: crate::systems::terrain::walk::new_slip(body, crate::Vec2::new(0., 0.)),
                radius,
            };
            s.restart(body, goal);
            s
        }
        pub fn restart(&mut self, body: crate::Vec2, goal: crate::Vec2) {
            self.body = body;
            self.slip = crate::systems::terrain::walk::new_slip(body, crate::Vec2::new(0., 0.));
            self.path.replan(&mut self.pf, &self.map, body, goal);
        }
        /// Returns whether the real shared walker replanned and whether its grip is active.
        pub fn step(&mut self, dt: f64, cap: f64, now: f64) -> (bool, bool) {
            let old = self.slip.replan_at;
            crate::systems::terrain::walk::walk(
                &self.map,
                &mut self.body,
                &mut self.slip,
                &mut self.path,
                dt,
                cap,
                |_, _| super::surface(6, Some(crate::FactionId::Fire)).accel,
                now,
                self.radius,
                &mut self.pf,
            );
            (
                old != self.slip.replan_at,
                self.slip.grip_until.is_some_and(|t| t > now),
            )
        }
    }
}

// Shared source eligibility leaves. Dummy helper coverage is not native training admission.
pub(crate) fn burn_share(
    e: Effect,
    standing: bool,
    dummy: bool,
    returning: bool,
    locked: bool,
) -> f64 {
    if standing && !dummy && !returning && !locked {
        e.burn
    } else {
        0.
    }
}
pub(crate) fn light_share(e: Effect, player: bool) -> f64 {
    if player {
        e.heal
    } else {
        0.
    }
}
pub(crate) fn clear_slip(slip: &mut Option<crate::fighter::SlipState>) {
    *slip = None;
}
pub(crate) fn reset_light(rt: &mut Runtime, now: f64) {
    rt.light_acc.clear();
    rt.combat_at.clear();
    rt.light_since = now;
}
