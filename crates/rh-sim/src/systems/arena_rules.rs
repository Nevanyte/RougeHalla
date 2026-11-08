//! Actual source arena lifecycle rules. Public configuration remains explicitly opt-in.
use crate::{state::World, statics::MatchStatic};
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ArenaMode {
    #[default]
    Off,
    /// Source lifecycle over the explicitly admitted mechanic domains, not a full-game profile.
    Source(ArenaRules),
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColiseumSchedule {
    pub first_seconds: f64,
    pub second_seconds: f64,
    pub repeat_seconds: f64,
    pub min_gap_seconds: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArenaRules {
    pub plan_seconds: f64,
    pub first_patience_seconds: Option<f64>,
    pub coliseum_schedule: Option<ColiseumSchedule>,
    pub patience_seconds: f64,
    pub patience_min_seconds: f64,
    pub sudden_death_seconds: f64,
}
impl Default for ArenaRules {
    fn default() -> Self {
        Self {
            plan_seconds: 45.,
            first_patience_seconds: None,
            coliseum_schedule: Some(ColiseumSchedule {
                first_seconds: 600.,
                second_seconds: 900.,
                repeat_seconds: 120.,
                min_gap_seconds: 30.,
            }),
            patience_seconds: 300.,
            patience_min_seconds: 120.,
            sudden_death_seconds: 60.,
        }
    }
}
impl ArenaMode {
    pub(crate) fn rules(&self) -> Option<&ArenaRules> {
        match self {
            Self::Off => None,
            Self::Source(r) => Some(r),
        }
    }
}
impl ArenaRules {
    pub(crate) fn schedule(&self) -> Option<ColiseumSchedule> {
        self.coliseum_schedule
            .filter(|_| self.first_patience_seconds != Some(0.))
    }
}
pub(crate) const MAX_DURATION_SECONDS: f64 = 86_400.;
pub(crate) const PATIENCE_MIN_PLAYERS: f64 = 3.;
pub(crate) const PATIENCE_FULL_PLAYERS: f64 = 8.;
pub(crate) const SD_START: f64 = 0.02;
pub(crate) const SD_RAMP: f64 = 0.02;
pub(crate) fn validate_config(k: &MatchStatic) -> Result<(), &'static str> {
    let Some(r) = k.config.lifecycle.rules() else {
        return Ok(());
    };
    let bounded = |v: f64| (0. ..=MAX_DURATION_SECONDS).contains(&v);
    if ![
        r.plan_seconds,
        r.patience_seconds,
        r.patience_min_seconds,
        r.sudden_death_seconds,
    ]
    .into_iter()
    .all(bounded)
        || r.first_patience_seconds.is_some_and(|v| !bounded(v))
        || r.coliseum_schedule.is_some_and(|s| {
            ![
                s.first_seconds,
                s.second_seconds,
                s.repeat_seconds,
                s.min_gap_seconds,
            ]
            .into_iter()
            .all(bounded)
        })
    {
        return Err("invalid source arena duration");
    }
    if k.config.mob_mode != crate::mob_runtime::MobMode::Off && !k.config.initial_loot {
        return Err("source arena mob/loot module prefix is not admitted without initial loot");
    }
    if k.config.mob_mode == crate::mob_runtime::MobMode::SpawnFoundation {
        return Err("source arena requires runtime mobs, not the constructor-only foundation");
    }
    if k.config.faction_mode != crate::FactionMode::Off
        && (k.config.mob_mode != crate::mob_runtime::MobMode::Off || k.config.initial_loot)
    {
        return Err(
            "source faction lifecycle admits base players only, without NPC or loot/card producers",
        );
    }
    if k.arena.spawns.is_empty()
        && k.arena
            .map
            .layers()
            .is_none_or(|l| l.coliseum().inner_spawns.len() < crate::constants::MAX_PLAYERS)
    {
        return Err("source coliseum fallback requires ordinary spawn points");
    }
    Ok(())
}
pub(crate) fn slot_at(started: f64, not_before: f64, s: ColiseumSchedule) -> Option<f64> {
    let first = started + s.first_seconds * 1000.;
    if not_before <= first {
        return Some(first);
    }
    let second = started + s.second_seconds * 1000.;
    if not_before <= second {
        return Some(second);
    }
    if s.repeat_seconds <= 0. {
        return None;
    }
    let k = ((not_before - second) / (s.repeat_seconds * 1000.)).ceil();
    let at = second + k * s.repeat_seconds * 1000.;
    at.is_finite().then_some(at)
}
pub(crate) fn patience_seconds(alive: usize, full: f64, min: f64) -> f64 {
    let k = ((alive as f64 - PATIENCE_MIN_PLAYERS)
        / (PATIENCE_FULL_PLAYERS - PATIENCE_MIN_PLAYERS))
        .clamp(0., 1.);
    min + (full - min) * k
}
pub(crate) fn sudden_death_share(elapsed: f64) -> f64 {
    SD_START + SD_RAMP * (elapsed.max(0.) / 1000.).floor()
}
pub(crate) fn begin_run(k: &MatchStatic, w: &mut World) {
    let starters = w.planning.as_ref().map_or(0, |p| p.starters);
    let humans = w.players.iter().filter(|p| !p.seat.bot).count();
    w.rt.started_with = (w.players.len().max(starters)) as u32;
    w.rt.started_humans = humans.max(w.planning.as_ref().map_or(0, |p| p.started_humans));
    w.rt.downs_between_ticks = 0;
    w.rt.voided = false;
    w.rt.gates_locked = false;
    w.rt.in_coliseum = false;
    w.rt.sudden_death_at = 0.;
    w.winner = None;
    w.rt.patience_ends_at = k.config.lifecycle.rules().and_then(|r| {
        if let Some(s) = r.schedule() {
            slot_at(w.server_time, w.server_time, s)
        } else {
            Some(
                w.server_time
                    + match r.first_patience_seconds {
                        Some(s) if s > 0. => s * 1000.,
                        _ => {
                            patience_seconds(
                                w.players.len(),
                                r.patience_seconds,
                                r.patience_min_seconds,
                            ) * 1000.
                        }
                    },
            )
        }
    });
}
pub(crate) const SUDDEN_DEATH_NAME: &str = "sudden death";
pub(crate) fn sudden_death(cx: &mut crate::systems::Cx) {
    use crate::{state::Packet, systems::ledger, WeaponId};
    if cx.k.config.lifecycle.rules().is_none()
        || !cx.w.rt.gates_locked
        || cx.w.rt.sudden_death_at <= 0.
    {
        return;
    }
    let start = cx.w.server_time - crate::constants::TICK_MS;
    if start < cx.w.rt.sudden_death_at {
        return;
    }
    let share =
        sudden_death_share(start - cx.w.rt.sudden_death_at) * (crate::constants::TICK_MS / 1000.);
    for i in 0..cx.w.players.len() {
        let p = &cx.w.players[i];
        if !p.standing() {
            continue;
        }
        let e = ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: true,
            source: Some(cx.k.arena_source.clone()),
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: p.id,
            by: None,
            packet: Packet {
                raw: share * p.vitals.max_hp,
                phys: 0.,
                magic: 0.,
                true_: 1.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        ledger::record_hit(cx.w, &mut cx.s.ledger, e);
    }
}

pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    for n in [
        MAX_DURATION_SECONDS,
        PATIENCE_MIN_PLAYERS,
        PATIENCE_FULL_PLAYERS,
        SD_START,
        SD_RAMP,
        super::coliseum::RING_RADIUS,
        super::coliseum::IMMUNITY_MS,
    ] {
        word(n.to_bits());
    }
    word(super::coliseum::SPOT_SEARCH_TILES as u64);
    for b in SUDDEN_DEATH_NAME.as_bytes() {
        word(u64::from(*b));
    }
    super::planning::deal::visit_content(&mut word);
    for b in b"arena-source/1:shared-reward-deals;shared-main-shuffle;outside-slot-preserved;locked-death-reschedule;retained-planning;source-core-roster;void-sticky;SD-true-arena-no-credit;owner-resolved-plan"{word(u64::from(*b));}
}
