//! Complete private source Memory component (packages/server/src/bots/brain/memory.ts lines 174-920).
//! Declared source-method data only: no World, Sim, RNG, public/wire or live dispatch. Time is the Percept clock.
//! Retained ordered state is kept in insertion order (never sorted); all twelve source folds run in source order.

pub(super) mod source_input;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tracked_tests;

use self::source_input::MemoryPercept;
use crate::bots::types::{ServerMs, Stimulus, StimulusKind, TierParams};
use crate::bots::types::{BOT_VIEW_HALF_H, BOT_VIEW_HALF_W};
use crate::bots::view::Features;
use rh_sim::constants::{ENGAGE_TRADE_SECONDS, PLAYER_RADIUS, PLAYER_SPEED, RANGED_SLACK};
use rh_sim::mapgen::certify::source_hypot as hypot;
use rh_sim::math::{atan2, sin};
use rh_sim::{FactionId, Vec2, WeaponId};
use std::fmt;

const REENTRY_MS: ServerMs = 3000.;
/// P-BOT-BRAIN-CONTINUITY-1 (live seats only): a mob record whose track key the percept no longer carries is kept this
/// long after it was last carried, then dropped (legacy keeps mob records for the run, keyed by a fighter id that never
/// changes; a track key never recurs once its track ends, so an ended track's record is bounded instead). The window is
/// legacy's REENTRY_MS, the time it gives a fighter that left the screen.
pub(crate) const TRACK_RETAIN_MS: ServerMs = REENTRY_MS;
const HP_FORGET_MS: ServerMs = 20_000.;
const TRADE_MS: ServerMs = ENGAGE_TRADE_SECONDS * 1000.;
const RECENT_HIT_MS: ServerMs = 3000.;
const FACING_RANGE: f64 = 400.;
const AIM_LATERAL: f64 = 60.;
const CHASE_COS: f64 = 0.7;
const CHASE_CLOSING: f64 = 20.;
const DRAW_SAME_MS: ServerMs = 200.;
const FEINT_SLACK_MS: ServerMs = 400.;
const MOB_AWAKE_U: f64 = 24.;
const MOB_CAMP_U: f64 = 40.;
const RISE_EPS: f64 = 0.02;
const RETURN_MAX_MS: ServerMs = 15_000.;
const VISIT_U: f64 = 150.;
const ARRIVE_U: f64 = 24.;
const ORDER_CHECK_MS: ServerMs = 400.;
const WALKED_U: f64 = 8.;
const PICKUP_TOAST_MS: ServerMs = 5000.;
const LOOSE_WEAPON_MS: ServerMs = 60_000.;
const HIDDEN_MARGIN_U: f64 = 80.;
const DYING_HP: f64 = 0.15;
const LOCK_WAIT_MS: ServerMs = 60.;
const LOCK_GIVE_UP_MS: ServerMs = 1500.;
const HP_CREDIT_MS: ServerMs = 500.;
const HP_ALONE_SHARE: f64 = 0.02;
const RANGED_HIT_REACH: f64 = PLAYER_RADIUS + RANGED_SLACK;
const PICKUP_REFUSED_PLAIN: [&str; 3] = ["nothing there", "nothing to take", "too far away"];

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum MemoryError {
    Shape(String),
    Missing(String),
    Unsupported(String),
}
impl fmt::Display for MemoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shape(s) => write!(f, "shape: {s}"),
            Self::Missing(s) => write!(f, "missing: {s}"),
            Self::Unsupported(s) => write!(f, "unsupported: {s}"),
        }
    }
}
impl std::error::Error for MemoryError {}

/// Presence of a container weapon: explicit undefined, explicit null, or a named weapon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContainersWeapon {
    Undefined,
    Null,
    Weapon(WeaponId),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CampGeom {
    pub id: String,
    pub zone: FactionId,
    pub elite: bool,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub spots: Vec<Vec2>,
}

#[derive(Clone, Debug)]
pub(crate) struct MemoryMap {
    pub camps: Vec<CampGeom>,
}

pub(crate) struct MemoryConfig {
    pub self_id: String,
    pub tier: &'static TierParams,
    pub map: MemoryMap,
    pub features: Features,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FighterMemory {
    pub id: String,
    pub name: String,
    pub bot: bool,
    pub faction: Option<FactionId>,
    pub weapons_seen: Vec<WeaponId>,
    pub in_hand: Option<WeaponId>,
    pub other_slot: Option<WeaponId>,
    pub seen_at: ServerMs,
    pub pos: Vec2,
    pub vel: Vec2,
    pub hp_frac: f64,
    pub bounty: f64,
    pub alive: bool,
    pub died_at: Option<ServerMs>,
    pub hit_me_at: Option<ServerMs>,
    pub hit_by_me_at: Option<ServerMs>,
    pub damage_to_me: f64,
    pub damage_by_me: f64,
    pub engaged_with: Option<String>,
    pub engaged_at: Option<ServerMs>,
    pub chasing_me: bool,
    pub wish_seen_at: Option<ServerMs>,
    pub wish_ready_guess: Option<ServerMs>,
    pub feints: u64,
    pub last_feint_at: Option<ServerMs>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MobMemory {
    pub id: String,
    pub type_: Option<String>,
    pub kind: String,
    pub faction: Option<FactionId>,
    pub name: Option<String>,
    pub home: Option<Vec2>,
    pub camp_id: Option<String>,
    pub pos: Vec2,
    pub dot_at: ServerMs,
    pub seen_at: Option<ServerMs>,
    pub hp_frac: f64,
    pub in_hand: Option<WeaponId>,
    pub awake: bool,
    pub returning: bool,
    pub alive: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CampMemory {
    pub id: String,
    pub zone: FactionId,
    pub elite: bool,
    pub alive_seen: u32,
    pub cleared_at: Option<ServerMs>,
    pub contested_at: Option<ServerMs>,
    pub visited_at: Option<ServerMs>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ContainerMemory {
    pub id: String,
    pub kind: String,
    pub pos: Vec2,
    pub closed: bool,
    pub weapon: ContainersWeapon,
    pub seen_at: ServerMs,
    pub skipped: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RecentHit {
    pub t: ServerMs,
    pub by: Option<String>,
    pub amount: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SelfMemory {
    pub last_hit_at: Option<ServerMs>,
    pub last_hit_by_player_at: Option<ServerMs>,
    pub last_dealt_at: Option<ServerMs>,
    pub recent_damage: f64,
    pub recent_hits: Vec<RecentHit>,
    pub teleported_at: Option<ServerMs>,
    pub last_order: Option<MemoryTimedCommand>,
    pub last_cast: Option<MemoryTimedCommand>,
    pub still_since: ServerMs,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum MemoryCommand {
    Move { x: f64, y: f64, seq: Option<f64> },
    Stop { seq: Option<f64> },
    Target { id: String },
    Pickup { container_id: String },
    Cast,
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MemoryTimedCommand {
    pub at: ServerMs,
    pub cmd: MemoryCommand,
    /// Complete declared method record (retained for the private API; never reconstructed).
    pub raw: super::data::MethodValue,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Whereabouts {
    pub at: Vec2,
    pub radius: f64,
}

pub(crate) struct MemoryView<'a> {
    pub fighters: &'a [(String, FighterMemory)],
    pub mobs: &'a [(String, MobMemory)],
    pub camps: &'a [(String, CampMemory)],
    pub containers: &'a [(String, ContainerMemory)],
    pub self_memory: &'a SelfMemory,
    pub stimuli: &'a [Stimulus],
    pub bounties: &'a [(String, f64)],
    pub choices: &'a [String],
}

#[derive(Clone, Debug, PartialEq)]
struct FighterAux {
    ever_seen: bool,
    announced: bool,
    visible: bool,
    hp_seen_at: ServerMs,
    held: Option<WeaponId>,
    hidden_suspect: bool,
}
#[derive(Clone, Debug, PartialEq)]
struct MobAux {
    dotted: bool,
    low: f64,
    returning_until: ServerMs,
    /// Live seats ([`Memory::tracked_mobs`]): when the percept last carried this key.
    carried_at: ServerMs,
}
#[derive(Clone, Debug, PartialEq)]
struct PendingOrder {
    tc: MemoryTimedCommand,
    move_seq: f64,
    from: Option<Vec2>,
    reflected: bool,
    arrived: bool,
    done: bool,
}
#[derive(Clone, Debug, PartialEq)]
enum CreditSrc {
    Hp,
    Hit,
}
#[derive(Clone, Debug, PartialEq)]
struct HpCredit {
    src: CreditSrc,
    amount: f64,
    t: ServerMs,
}
#[derive(Clone, Debug, PartialEq)]
struct Dropped {
    id: String,
    at: ServerMs,
    intentional: bool,
}
#[derive(Clone, Debug, PartialEq)]
struct Trade {
    key: String,
    t: ServerMs,
}
#[derive(Default)]
struct ObsState {
    deaths: Vec<String>,
    hit_sum: f64,
    flip: bool,
}

pub(crate) struct Memory {
    /// P-BOT-BRAIN-CONTINUITY-1: the live seat's mob ids are its own track keys (`brain/mob_tracks.rs`), which never
    /// recur once a track ends; a record is kept while its key is carried and [`TRACK_RETAIN_MS`] after, then dropped.
    /// Off (the source rule: records are kept for the run) for every source-shaped caller.
    tracked_mobs: bool,
    self_id: String,
    tier: &'static TierParams,
    features: Features,
    geoms: Vec<CampGeom>,
    fighters: Vec<(String, FighterMemory)>,
    mobs: Vec<(String, MobMemory)>,
    camps: Vec<(String, CampMemory)>,
    containers: Vec<(String, ContainerMemory)>,
    bounties: Vec<(String, f64)>,
    choices: Vec<String>,
    self_mem: SelfMemory,
    f_aux: Vec<(String, FighterAux)>,
    m_aux: Vec<(String, MobAux)>,
    camp_had: Vec<(String, bool)>,
    windups: Vec<(String, Windup)>,
    draw_at: Vec<(String, ServerMs)>,
    trades: Vec<Trade>,
    incoming_seen: Vec<String>,
    seen_chests: Vec<String>,
    recent: Vec<RecentHit>,
    credits: Vec<HpCredit>,
    stimuli: Vec<Stimulus>,
    started: bool,
    still_anchor: Vec2,
    prev_hp: f64,
    prev_coliseum: bool,
    prev_hp_share: f64,
    prev_target: Option<String>,
    dropped: Option<Dropped>,
    pending: Option<PendingOrder>,
    pickup: Option<(String, ServerMs)>,
    last_minimap_t: f64,
    last_move_seq: f64,
    last_pos: Option<Vec2>,
    last_plan_end: f64,
    current_now: ServerMs,
}
#[derive(Clone, Debug, PartialEq)]
struct Windup {
    t: ServerMs,
    ms: f64,
    at_me: bool,
}

fn dist(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
fn angle_diff(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % (2. * std::f64::consts::PI);
    if d > std::f64::consts::PI {
        d -= 2. * std::f64::consts::PI;
    } else if d < -std::f64::consts::PI {
        d += 2. * std::f64::consts::PI;
    }
    d
}
fn aimed_at(origin: Vec2, angle: f64, at: Vec2) -> bool {
    let d = dist(origin, at);
    if d > FACING_RANGE {
        return false;
    }
    if d < 1. {
        return true;
    }
    let diff = angle_diff(angle, atan2(at.y - origin.y, at.x - origin.x)).abs();
    diff < std::f64::consts::FRAC_PI_2 && d * sin(diff) <= AIM_LATERAL
}
fn is_regional_kind(kind: &str) -> bool {
    matches!(kind, "mob" | "elite")
}
fn has_own_ability_named(name: &str) -> Option<rh_sim::status_runtime::AbilityId> {
    use rh_sim::status_runtime::AbilityId;
    AbilityId::ALL.into_iter().find(|id| id.as_str() == name)
}
fn wish_of(faction: FactionId) -> Option<rh_sim::status_runtime::AbilityId> {
    use rh_sim::status_runtime::AbilityId;
    Some(match faction {
        FactionId::Frost => AbilityId::Freeze,
        FactionId::Plague => AbilityId::Swarm,
        FactionId::Sentenced => AbilityId::Trial,
        FactionId::Fire => AbilityId::Blaze,
        FactionId::Holy => AbilityId::LastStand,
    })
}
fn wish_cooldown(id: rh_sim::status_runtime::AbilityId) -> f64 {
    rh_sim::abilities::cooldown(id, false, None)
}
fn ascii_lower_u16(c: u16) -> u16 {
    if (u16::from(b'A')..=u16::from(b'Z')).contains(&c) {
        c + 32
    } else {
        c
    }
}

fn match_units_ascii_ci(units: &[u16], at: usize, pattern: &str) -> bool {
    for (i, p) in pattern.encode_utf16().enumerate() {
        let Some(&unit) = units.get(at + i) else {
            return false;
        };
        if ascii_lower_u16(unit) != ascii_lower_u16(p) {
            return false;
        }
    }
    true
}

fn is_js_line_terminator(c: u16) -> bool {
    matches!(c, 0x000A | 0x000D | 0x2028 | 0x2029)
}

fn pickup_refused(text: &str) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    if PICKUP_REFUSED_PLAIN
        .iter()
        .any(|p| (0..units.len()).any(|i| match_units_ascii_ci(&units, i, p)))
    {
        return true;
    }
    const TAIL: &str = " reach that";
    for i in 0..units.len() {
        if !match_units_ascii_ci(&units, i, "can") {
            continue;
        }
        if match_units_ascii_ci(&units, i + 3, "t") && match_units_ascii_ci(&units, i + 4, TAIL) {
            return true;
        }
        if i + 3 < units.len()
            && !is_js_line_terminator(units[i + 3])
            && match_units_ascii_ci(&units, i + 4, "t")
            && match_units_ascii_ci(&units, i + 5, TAIL)
        {
            return true;
        }
    }
    false
}

impl Memory {
    pub(crate) fn new(config: MemoryConfig) -> Result<Self, MemoryError> {
        if config.self_id.is_empty() {
            return Err(MemoryError::Missing("selfId".into()));
        }
        let geoms = config.map.camps;
        let camps = geoms
            .iter()
            .map(|g| {
                (
                    g.id.clone(),
                    CampMemory {
                        id: g.id.clone(),
                        zone: g.zone,
                        elite: g.elite,
                        alive_seen: 0,
                        cleared_at: None,
                        contested_at: None,
                        visited_at: None,
                    },
                )
            })
            .collect();
        Ok(Self {
            tracked_mobs: false,
            self_id: config.self_id,
            tier: config.tier,
            features: config.features,
            geoms,
            fighters: Vec::new(),
            mobs: Vec::new(),
            camps,
            containers: Vec::new(),
            bounties: Vec::new(),
            choices: Vec::new(),
            self_mem: SelfMemory {
                last_hit_at: None,
                last_hit_by_player_at: None,
                last_dealt_at: None,
                recent_damage: 0.,
                recent_hits: Vec::new(),
                teleported_at: None,
                last_order: None,
                last_cast: None,
                still_since: 0.,
            },
            f_aux: Vec::new(),
            m_aux: Vec::new(),
            camp_had: Vec::new(),
            windups: Vec::new(),
            draw_at: Vec::new(),
            trades: Vec::new(),
            incoming_seen: Vec::new(),
            seen_chests: Vec::new(),
            recent: Vec::new(),
            credits: Vec::new(),
            stimuli: Vec::new(),
            started: false,
            still_anchor: Vec2::new(0., 0.),
            prev_hp: 0.,
            prev_coliseum: false,
            prev_hp_share: 1.,
            prev_target: None,
            dropped: None,
            pending: None,
            pickup: None,
            last_minimap_t: f64::NEG_INFINITY,
            last_move_seq: 0.,
            last_pos: None,
            last_plan_end: -1.,
            current_now: 0.,
        })
    }

    fn fighter(&self, id: &str) -> Option<&FighterMemory> {
        self.fighters.iter().find(|(k, _)| k == id).map(|(_, v)| v)
    }
    fn fighter_mut(&mut self, id: &str) -> Option<&mut FighterMemory> {
        self.fighters
            .iter_mut()
            .find(|(k, _)| k == id)
            .map(|(_, v)| v)
    }
    fn mob(&self, id: &str) -> Option<&MobMemory> {
        self.mobs.iter().find(|(k, _)| k == id).map(|(_, v)| v)
    }
    fn fighter_aux(&mut self, id: &str) -> &mut FighterAux {
        if let Some(pos) = self.f_aux.iter().position(|(k, _)| k == id) {
            return &mut self.f_aux[pos].1;
        }
        self.f_aux.push((
            id.to_string(),
            FighterAux {
                ever_seen: false,
                announced: false,
                visible: false,
                hp_seen_at: 0.,
                held: None,
                hidden_suspect: false,
            },
        ));
        &mut self.f_aux.last_mut().unwrap().1
    }
    fn mob_aux(&mut self, id: &str) -> &mut MobAux {
        if let Some(pos) = self.m_aux.iter().position(|(k, _)| k == id) {
            return &mut self.m_aux[pos].1;
        }
        self.m_aux.push((
            id.to_string(),
            MobAux {
                dotted: false,
                low: 1.,
                returning_until: 0.,
                carried_at: 0.,
            },
        ));
        &mut self.m_aux.last_mut().unwrap().1
    }
    fn set_bounty(&mut self, id: &str, bounty: f64) {
        if let Some(pos) = self.bounties.iter().position(|(k, _)| k == id) {
            self.bounties[pos].1 = bounty;
            if bounty <= 0. {
                self.bounties.remove(pos);
            }
        } else if bounty > 0. {
            self.bounties.push((id.to_string(), bounty));
        }
    }
    fn drop_bounty(&mut self, id: &str) {
        self.bounties.retain(|(k, _)| k != id);
    }
    fn camp_had(&self, id: &str) -> bool {
        self.camp_had
            .iter()
            .find(|(k, _)| k == id)
            .is_some_and(|(_, v)| *v)
    }
    fn set_camp_had(&mut self, id: &str) {
        if let Some(pos) = self.camp_had.iter().position(|(k, _)| k == id) {
            self.camp_had[pos].1 = true;
        } else {
            self.camp_had.push((id.to_string(), true));
        }
    }
    fn ensure_fighter(&mut self, id: &str, name: &str) -> &mut FighterMemory {
        if let Some(pos) = self.fighters.iter().position(|(k, _)| k == id) {
            if self.fighters[pos].1.name.is_empty() && !name.is_empty() {
                self.fighters[pos].1.name = name.to_string();
            }
            return &mut self.fighters[pos].1;
        }
        self.fighters
            .push((id.to_string(), blank_fighter(id, name)));
        self.fighter_aux(id);
        &mut self.fighters.last_mut().unwrap().1
    }
    fn camp_at(&self, at: Vec2) -> Option<String> {
        let mut best: Option<&str> = None;
        let mut best_d = MOB_CAMP_U;
        for g in &self.geoms {
            for s in &g.spots {
                let d = dist(*s, at);
                if d <= best_d {
                    best_d = d;
                    best = Some(&g.id);
                }
            }
        }
        best.map(str::to_string)
    }
    fn central(&self, me: Vec2, at: Vec2) -> bool {
        let c = self.tier.attention.central;
        (at.x - me.x).abs() <= c * BOT_VIEW_HALF_W && (at.y - me.y).abs() <= c * BOT_VIEW_HALF_H
    }
    fn drawn_at(&self, p: &MemoryPercept, id: &str) -> Option<(Vec2, f64, String)> {
        if let Some(f) = p.fighters.iter().find(|f| f.id == id) {
            return Some((Vec2::new(f.x, f.y), f.hp_frac, f.status.clone()));
        }
        if let Some(m) = p.mobs.iter().find(|m| m.id == id) {
            return Some((Vec2::new(m.x, m.y), m.hp_frac, m.status.clone()));
        }
        None
    }
    fn pos_of(&self, p: &MemoryPercept, id: &str, fallback: Option<Vec2>) -> Option<Vec2> {
        if let Some((pos, _, _)) = self.drawn_at(p, id) {
            return Some(pos);
        }
        if let Some(m) = self.fighter(id) {
            if self
                .f_aux
                .iter()
                .find(|(k, _)| k == id)
                .is_some_and(|(_, a)| a.ever_seen)
            {
                return Some(m.pos);
            }
        }
        if let Some(m) = self.mob(id) {
            return Some(m.pos);
        }
        fallback
    }
    fn is_down(&self, p: &MemoryPercept, deaths: &[String], id: &str) -> bool {
        if deaths.iter().any(|d| d == id) {
            return true;
        }
        if let Some((_, _, status)) = self.drawn_at(p, id) {
            if status != "alive" {
                return true;
            }
        }
        if self.fighter(id).is_some_and(|f| !f.alive) {
            return true;
        }
        self.mob(id).is_some_and(|m| !m.alive)
    }
    fn chasing(&self, me: Vec2, at: Vec2, vx: f64, vy: f64) -> bool {
        let speed = hypot(vx, vy);
        let d = dist(me, at);
        if speed < CHASE_CLOSING || d < 1. {
            return false;
        }
        let toward = (vx * (me.x - at.x) + vy * (me.y - at.y)) / d;
        toward >= CHASE_CLOSING && toward / speed > CHASE_COS
    }
    fn off_home(m: &MobMemory) -> bool {
        m.home.is_some_and(|h| dist(m.pos, h) > MOB_AWAKE_U)
    }
    fn emit(
        &self,
        out: &mut Vec<Stimulus>,
        me: Vec2,
        kind: StimulusKind,
        subject: Option<String>,
        at: Option<Vec2>,
        value: Option<f64>,
    ) {
        let central = at.is_none_or(|a| self.central(me, a));
        out.push(Stimulus {
            kind,
            at: self.current_now,
            subject,
            central,
            value,
        });
    }

    fn fold_self(&mut self, p: &MemoryPercept, o: &mut ObsState, now: ServerMs) {
        let me = &p.self_;
        if !self.started {
            self.started = true;
            self.still_anchor = Vec2::new(me.x, me.y);
            self.self_mem.still_since = now;
            self.prev_hp = me.hp;
            self.prev_coliseum = p.hud_in_coliseum;
        } else if dist(Vec2::new(me.x, me.y), self.still_anchor) > 1. {
            self.still_anchor = Vec2::new(me.x, me.y);
            self.self_mem.still_since = now;
        }
        o.flip = p.hud_in_coliseum != self.prev_coliseum;
        self.prev_coliseum = p.hud_in_coliseum;
        if o.flip {
            self.pending = None;
        }
    }

    fn fold_fighters(&mut self, p: &MemoryPercept, out: &mut Vec<Stimulus>, now: ServerMs) {
        let me = Vec2::new(p.self_.x, p.self_.y);
        let hiding_possible = self.features.status_effects || p.features.status_effects;
        let mut on_screen: Vec<String> = Vec::new();
        for f in &p.fighters {
            if f.id == self.self_id {
                continue;
            }
            on_screen.push(f.id.clone());
            let idx = if let Some(i) = self.fighters.iter().position(|(k, _)| *k == f.id) {
                i
            } else {
                self.fighters
                    .push((f.id.clone(), blank_fighter(&f.id, &f.name)));
                self.fighter_aux(&f.id);
                self.fighters.len() - 1
            };
            let mut m = self.fighters[idx].1.clone();
            let mut a = self
                .f_aux
                .iter()
                .find(|(k, _)| *k == f.id)
                .unwrap()
                .1
                .clone();
            let known =
                a.ever_seen && a.announced && !a.hidden_suspect && now - m.seen_at <= REENTRY_MS;
            let here = Vec2::new(f.x, f.y);
            m.name = f.name.clone();
            m.bot = f.bot;
            if let Some(faction) = f.faction {
                m.faction = Some(faction);
            }
            if f.status == "dead" || f.status == "mia" {
                if m.alive {
                    m.alive = false;
                    m.died_at = Some(now);
                }
                self.drop_bounty(&f.id);
            }
            if let Some(in_hand) = f.in_hand {
                if !m.weapons_seen.contains(&in_hand) {
                    m.weapons_seen.push(in_hand);
                }
                if let Some(held) = a.held {
                    if held != in_hand {
                        m.other_slot = Some(held);
                    }
                }
                if known && m.alive && m.in_hand.is_some() && m.in_hand != Some(in_hand) {
                    self.emit(
                        out,
                        me,
                        StimulusKind::FoeSwapped,
                        Some(f.id.clone()),
                        Some(here),
                        None,
                    );
                }
                a.held = Some(in_hand);
            }
            m.in_hand = f.in_hand;
            m.pos = here;
            m.vel = Vec2::new(f.vx, f.vy);
            m.hp_frac = f.hp_frac;
            a.hp_seen_at = now;
            m.bounty = f.bounty;
            if m.alive {
                if f.bounty > 0. {
                    self.set_bounty(&f.id, f.bounty);
                } else {
                    self.drop_bounty(&f.id);
                }
            }
            m.chasing_me = m.alive && self.chasing(me, here, f.vx, f.vy);
            if m.alive && f.status == "alive" {
                if !known {
                    self.emit(
                        out,
                        me,
                        StimulusKind::NewThreat,
                        Some(f.id.clone()),
                        Some(here),
                        Some(dist(me, here)),
                    );
                }
                a.announced = true;
                a.hidden_suspect = false;
                if f.draw_started_at > 0. && aimed_at(here, f.facing, me) {
                    let last = self
                        .draw_at
                        .iter()
                        .find(|(k, _)| *k == f.id)
                        .map(|(_, t)| *t);
                    if last.is_none_or(|last| (f.draw_started_at - last).abs() > DRAW_SAME_MS) {
                        if let Some(pos) = self.draw_at.iter().position(|(k, _)| *k == f.id) {
                            self.draw_at[pos].1 = f.draw_started_at;
                        } else {
                            self.draw_at.push((f.id.clone(), f.draw_started_at));
                        }
                        self.emit(
                            out,
                            me,
                            StimulusKind::DrawAtMe,
                            Some(f.id.clone()),
                            Some(here),
                            None,
                        );
                    }
                }
            }
            m.seen_at = now;
            a.ever_seen = true;
            a.visible = true;
            self.fighters[idx].1 = m;
            if let Some(pos) = self.f_aux.iter().position(|(k, _)| *k == f.id) {
                self.f_aux[pos].1 = a;
            }
        }
        let ids: Vec<String> = self.f_aux.iter().map(|(k, _)| k.clone()).collect();
        for id in ids {
            if on_screen.contains(&id) {
                continue;
            }
            let Some(idx) = self.fighters.iter().position(|(k, _)| *k == id) else {
                continue;
            };
            let mut m = self.fighters[idx].1.clone();
            let mut a = self.f_aux.iter().find(|(k, _)| *k == id).unwrap().1.clone();
            if a.visible {
                a.visible = false;
                a.hidden_suspect = hiding_possible
                    && m.alive
                    && (m.pos.x - me.x).abs() <= BOT_VIEW_HALF_W - HIDDEN_MARGIN_U
                    && (m.pos.y - me.y).abs() <= BOT_VIEW_HALF_H - HIDDEN_MARGIN_U;
            }
            if m.chasing_me && now - m.seen_at > 1500. {
                m.chasing_me = false;
            }
            if a.ever_seen && now - a.hp_seen_at > HP_FORGET_MS {
                m.hp_frac = 1.;
            }
            self.fighters[idx].1 = m;
            if let Some(pos) = self.f_aux.iter().position(|(k, _)| *k == id) {
                self.f_aux[pos].1 = a;
            }
        }
    }

    fn trade(&mut self, victim: &str, by: &Option<String>, t: ServerMs) {
        let Some(by) = by else {
            return;
        };
        if by == &self.self_id || victim == self.self_id {
            return;
        }
        if self.fighter(by).is_none() || self.fighter(victim).is_none() {
            return;
        }
        let key = format!("{by}>{victim}");
        if let Some(pos) = self.trades.iter().position(|tr| tr.key == key) {
            self.trades[pos].t = t;
        } else {
            self.trades.push(Trade { key, t });
        }
        let back_key = format!("{victim}>{by}");
        let back = self
            .trades
            .iter()
            .find(|tr| tr.key == back_key)
            .map(|tr| tr.t);
        let Some(back) = back else {
            return;
        };
        if (t - back).abs() > TRADE_MS {
            return;
        }
        if let Some(a) = self.fighter_mut(by) {
            a.engaged_with = Some(victim.to_string());
            a.engaged_at = Some(t);
        }
        if let Some(b) = self.fighter_mut(victim) {
            b.engaged_with = Some(by.clone());
            b.engaged_at = Some(t);
        }
    }

    fn on_cancel(&mut self, id: String, t: ServerMs) {
        if id == self.self_id {
            return;
        }
        let w = self
            .windups
            .iter()
            .position(|(k, _)| *k == id)
            .map(|pos| self.windups.remove(pos).1);
        let Some(w) = w else {
            return;
        };
        let Some(f) = self.fighter_mut(&id) else {
            return;
        };
        if !w.at_me || t - w.t > w.ms + FEINT_SLACK_MS {
            return;
        }
        f.feints += 1;
        f.last_feint_at = Some(t);
    }

    fn on_bounty(
        &mut self,
        out: &mut Vec<Stimulus>,
        id: String,
        name: String,
        bounty: f64,
        _now: ServerMs,
        me: Vec2,
    ) {
        if id != self.self_id {
            let f = self.ensure_fighter(&id, &name);
            f.bounty = bounty;
            if bounty > 0. && f.alive {
                self.set_bounty(&id, bounty);
            } else {
                self.drop_bounty(&id);
            }
        }
        self.emit(
            out,
            me,
            StimulusKind::Announcement,
            Some(id),
            None,
            Some(bounty),
        );
    }

    fn on_toast(&mut self, text: &str, now: ServerMs) {
        let Some((id, at)) = self.pickup.clone() else {
            return;
        };
        if now - at > PICKUP_TOAST_MS {
            return;
        }
        if !pickup_refused(text) {
            return;
        }
        if let Some(c) = self.containers.iter_mut().find(|(k, _)| *k == id) {
            c.1.skipped = true;
        }
        self.pickup = None;
    }

    fn fold_events(
        &mut self,
        p: &MemoryPercept,
        o: &mut ObsState,
        out: &mut Vec<Stimulus>,
        now: ServerMs,
    ) {
        let me = Vec2::new(p.self_.x, p.self_.y);
        let mut plan_seen = false;
        for e in &p.events {
            let t = e.t;
            match &e.kind {
                self::source_input::PerceptEvent::Windup { by, weapon, a, ms } => {
                    let by = by.clone();
                    let weapon = *weapon;
                    let a = *a;
                    let ms = *ms;
                    if let Some(pos) = self.windups.iter().position(|(k, _)| *k == by) {
                        self.windups[pos].1 = Windup {
                            t,
                            ms,
                            at_me: false,
                        };
                    } else {
                        self.windups.push((
                            by.clone(),
                            Windup {
                                t,
                                ms,
                                at_me: false,
                            },
                        ));
                    }
                    if by != self.self_id {
                        if let Some(origin) = self.pos_of(p, &by, e.at) {
                            if aimed_at(origin, a, Vec2::new(p.self_.x, p.self_.y)) {
                                if let Some(w) = self.windups.iter_mut().find(|(k, _)| *k == by) {
                                    w.1.at_me = true;
                                }
                                if weapon == WeaponId::Bow {
                                    let last = self
                                        .draw_at
                                        .iter()
                                        .find(|(k, _)| *k == by)
                                        .map(|(_, t)| *t);
                                    if last.is_none_or(|last| (t - last).abs() > DRAW_SAME_MS) {
                                        if let Some(pos) =
                                            self.draw_at.iter().position(|(k, _)| *k == by)
                                        {
                                            self.draw_at[pos].1 = t;
                                        } else {
                                            self.draw_at.push((by.clone(), t));
                                        }
                                        self.emit(
                                            out,
                                            me,
                                            StimulusKind::DrawAtMe,
                                            Some(by),
                                            Some(origin),
                                            Some((t + ms - now).max(0.)),
                                        );
                                    }
                                } else {
                                    self.emit(
                                        out,
                                        me,
                                        StimulusKind::WindupAtMe,
                                        Some(by),
                                        Some(origin),
                                        Some((t + ms - now).max(0.)),
                                    );
                                }
                            }
                        }
                    }
                }
                self::source_input::PerceptEvent::Swing { by, .. } => {
                    self.windups.retain(|(k, _)| k != by);
                }
                self::source_input::PerceptEvent::Hit { id, by, amount, .. } => {
                    if id == &self.self_id {
                        o.hit_sum += *amount;
                    }
                    self.on_hit_event(out, t, id.clone(), by.clone(), *amount);
                }
                self::source_input::PerceptEvent::Block { id, by, .. } => {
                    self.trade(id, by, t);
                }
                self::source_input::PerceptEvent::Cancel { id } => {
                    self.on_cancel(id.clone(), t);
                }
                self::source_input::PerceptEvent::Death {
                    id,
                    name,
                    by: _,
                    mob,
                    ..
                } => {
                    o.deaths.push(id.clone());
                    if *mob {
                        if let Some(m) = self.mobs.iter_mut().find(|(k, _)| *k == *id) {
                            m.1.alive = false;
                        }
                    } else if id != &self.self_id {
                        let f = self.ensure_fighter(id, name);
                        if f.alive {
                            f.alive = false;
                            f.died_at = Some(t);
                        }
                        f.bounty = 0.;
                        self.drop_bounty(id);
                        self.emit(
                            out,
                            me,
                            StimulusKind::Announcement,
                            Some(id.clone()),
                            e.at,
                            None,
                        );
                    }
                }
                self::source_input::PerceptEvent::Teleport => {
                    self.self_mem.teleported_at = Some(t);
                    self.pending = None;
                    self.dropped = None;
                    self.emit(out, me, StimulusKind::Teleport, None, None, None);
                }
                self::source_input::PerceptEvent::Bounty { id, name, bounty } => {
                    self.on_bounty(out, id.clone(), name.clone(), *bounty, now, me);
                }
                self::source_input::PerceptEvent::Victory { id, .. } => {
                    self.emit(out, me, StimulusKind::Announcement, id.clone(), None, None);
                }
                self::source_input::PerceptEvent::Toast { text } => {
                    self.on_toast(text, now);
                }
                self::source_input::PerceptEvent::Private { type_ } => {
                    if type_ == "plan" && p.extras.plan.is_none() {
                        plan_seen = true;
                    }
                }
                self::source_input::PerceptEvent::Ext { fx, data } if fx == "castLand" => {
                    let by = ext_by(data);
                    if by.as_deref() != Some(&self.self_id) {
                        if let Some(who) = &by {
                            if let Some(f) = self.fighter_mut(who) {
                                f.wish_seen_at = Some(t);
                                let named = ext_ability(data);
                                let wish = named
                                    .and_then(|n| has_own_ability_named(&n))
                                    .or_else(|| f.faction.and_then(wish_of));
                                f.wish_ready_guess =
                                    Some(t + wish.map(wish_cooldown).unwrap_or(0.));
                            }
                        }
                        self.emit(out, me, StimulusKind::CastSeen, by, e.at, None);
                    }
                }
                _ => {}
            }
        }
        if plan_seen {
            self.emit(out, me, StimulusKind::PlanOffer, None, None, None);
        }
    }

    fn on_hit_event(
        &mut self,
        out: &mut Vec<Stimulus>,
        t: ServerMs,
        id: String,
        by: Option<String>,
        amount: f64,
    ) {
        if id == self.self_id {
            self.self_mem.last_hit_at = Some(t);
            self.recent.push(RecentHit {
                t,
                by: by.clone(),
                amount,
            });
            if let Some(by) = &by {
                if self.fighter(by).is_some() {
                    self.self_mem.last_hit_by_player_at = Some(t);
                    let f = self.fighter_mut(by).expect("checked remembered fighter");
                    f.hit_me_at = Some(t);
                    f.damage_to_me += amount;
                }
            }
            return;
        }
        if by.as_deref() == Some(&self.self_id) {
            self.self_mem.last_dealt_at = Some(t);
            if let Some(f) = self.fighter_mut(&id) {
                f.hit_by_me_at = Some(t);
                f.damage_by_me += amount;
            }
            return;
        }
        self.trade(&id, &by, t);
        let _ = out;
    }

    /// See [`Memory::tracked_mobs`]; set once, by the live seat.
    pub(crate) fn set_tracked_mobs(&mut self, on: bool) {
        self.tracked_mobs = on;
    }

    fn fold_mobs(&mut self, p: &MemoryPercept, o: &mut ObsState, now: ServerMs) {
        if p.minimap.t != self.last_minimap_t {
            self.last_minimap_t = p.minimap.t;
            let mut live: Vec<String> = Vec::new();
            for d in &p.minimap.mobs {
                live.push(d.id.clone());
                self.mob_aux(&d.id).dotted = true;
                if self.mob(&d.id).is_none() {
                    let home = Vec2::new(d.x, d.y);
                    self.mobs.push((
                        d.id.clone(),
                        MobMemory {
                            id: d.id.clone(),
                            type_: None,
                            kind: if d.elite { "elite" } else { "mob" }.to_string(),
                            faction: d.faction,
                            name: None,
                            home: Some(home),
                            camp_id: self.camp_at(home),
                            pos: home,
                            dot_at: p.minimap.t,
                            seen_at: None,
                            hp_frac: 1.,
                            in_hand: None,
                            awake: false,
                            returning: false,
                            alive: true,
                        },
                    ));
                    continue;
                }
                let idx = self.mobs.iter().position(|(k, _)| *k == d.id).unwrap();
                let mut m = self.mobs[idx].1.clone();
                if !m.alive {
                    continue;
                }
                m.pos = Vec2::new(d.x, d.y);
                m.dot_at = p.minimap.t;
                self.mobs[idx].1 = m;
            }
            let dotted: Vec<(String, bool)> = self
                .m_aux
                .iter()
                .map(|(k, a)| (k.clone(), a.dotted))
                .collect();
            for idx in 0..self.mobs.len() {
                let (id, alive) = (self.mobs[idx].1.id.clone(), self.mobs[idx].1.alive);
                let is_dotted = dotted
                    .iter()
                    .find(|(k, _)| *k == id)
                    .is_some_and(|(_, d)| *d);
                if alive && is_dotted && !live.contains(&id) {
                    self.mobs[idx].1.alive = false;
                }
            }
        }
        if self.tracked_mobs {
            // A track key never recurs once its track ends: keep a record while carried and TRACK_RETAIN_MS after.
            let cutoff = now - TRACK_RETAIN_MS;
            let keep: Vec<String> = self
                .m_aux
                .iter()
                .filter(|(id, a)| a.carried_at >= cutoff || p.mobs.iter().any(|v| v.id == *id))
                .map(|(id, _)| id.clone())
                .collect();
            self.mobs.retain(|(id, _)| keep.contains(id));
            self.m_aux.retain(|(id, _)| keep.contains(id));
        }
        for v in &p.mobs {
            if !is_regional_kind(&v.kind) {
                continue;
            }
            self.mob_aux(&v.id).carried_at = now;
            if self.mob(&v.id).is_none() {
                let home = Vec2::new(v.x, v.y);
                self.mobs.push((
                    v.id.clone(),
                    MobMemory {
                        id: v.id.clone(),
                        type_: None,
                        kind: v.kind.clone(),
                        faction: v.faction,
                        name: Some(v.name.clone()),
                        home: Some(home),
                        camp_id: self.camp_at(home),
                        pos: home,
                        dot_at: now,
                        seen_at: None,
                        hp_frac: v.hp_frac,
                        in_hand: v.in_hand,
                        awake: false,
                        returning: false,
                        alive: true,
                    },
                ));
            }
            let idx = self.mobs.iter().position(|(k, _)| *k == v.id).unwrap();
            let mut m = self.mobs[idx].1.clone();
            if !m.alive {
                continue;
            }
            m.kind = v.kind.clone();
            if let Some(faction) = v.faction {
                m.faction = Some(faction);
            }
            m.name = Some(v.name.clone());
            if v.type_.is_some() {
                m.type_ = v.type_.clone();
            }
            m.pos = Vec2::new(v.x, v.y);
            m.in_hand = v.in_hand;
            if v.status != "alive" {
                m.alive = false;
                o.deaths.push(v.id.clone());
                self.mobs[idx].1 = m;
                continue;
            }
            let mut a = self
                .m_aux
                .iter()
                .find(|(k, _)| *k == v.id)
                .unwrap()
                .1
                .clone();
            if m.seen_at.is_none() || v.hp_frac < m.hp_frac {
                a.low = v.hp_frac;
                a.returning_until = 0.;
            }
            let off = m.home.is_some_and(|h| dist(m.pos, h) > MOB_AWAKE_U);
            if !off {
                a.low = v.hp_frac;
            } else if v.hp_frac > a.low + RISE_EPS {
                a.returning_until = now + RETURN_MAX_MS;
            }
            m.hp_frac = v.hp_frac;
            m.seen_at = Some(now);
            self.mobs[idx].1 = m;
            if let Some(pos) = self.m_aux.iter().position(|(k, _)| *k == v.id) {
                self.m_aux[pos].1 = a;
            }
        }
        for idx in 0..self.mobs.len() {
            let id = self.mobs[idx].1.id.clone();
            let mut m = self.mobs[idx].1.clone();
            if !m.alive {
                m.awake = false;
                m.returning = false;
                self.mobs[idx].1 = m;
                continue;
            }
            let off = m.home.is_some_and(|h| dist(m.pos, h) > MOB_AWAKE_U);
            let mut a = self.m_aux.iter().find(|(k, _)| *k == id).unwrap().1.clone();
            if !off {
                a.returning_until = 0.;
            }
            m.returning = off && now < a.returning_until;
            m.awake = off && !m.returning;
            self.mobs[idx].1 = m;
            if let Some(pos) = self.m_aux.iter().position(|(k, _)| *k == id) {
                self.m_aux[pos].1 = a;
            }
        }
    }

    fn fold_camps(&mut self, p: &MemoryPercept, now: ServerMs, me: Vec2) {
        let mut alive: Vec<(String, u32)> = Vec::new();
        for (_, m) in &self.mobs {
            if m.alive {
                if let Some(camp) = &m.camp_id {
                    if let Some(pos) = alive.iter().position(|(k, _)| k == camp) {
                        alive[pos].1 += 1;
                    } else {
                        alive.push((camp.clone(), 1));
                    }
                }
            }
        }
        for i in 0..self.geoms.len() {
            let g = self.geoms[i].clone();
            let n = alive
                .iter()
                .find(|(k, _)| *k == g.id)
                .map(|(_, n)| *n)
                .unwrap_or(0);
            let had = self.camp_had(&g.id);
            let cleared = self.camps[i].1.cleared_at;
            let state2 = p.extras.camps.iter().any(|v| v.id == g.id && v.state == 2);
            let visited = dist(me, Vec2::new(g.x, g.y)) <= VISIT_U;
            let mut contested = self.camps[i].1.contested_at;
            for f in &p.fighters {
                if f.id != self.self_id
                    && f.status == "alive"
                    && dist(Vec2::new(f.x, f.y), Vec2::new(g.x, g.y)) <= g.radius
                {
                    contested = Some(now);
                }
            }
            {
                let c = &mut self.camps[i].1;
                c.alive_seen = n;
                if n > 0 {
                    c.cleared_at = None;
                } else if had && cleared.is_none() {
                    c.cleared_at = Some(now);
                }
                if state2 && c.cleared_at.is_none() {
                    c.cleared_at = Some(now);
                }
                if visited {
                    c.visited_at = Some(now);
                }
                c.contested_at = contested;
            }
            if n > 0 {
                self.set_camp_had(&g.id);
            }
        }
    }

    fn fold_containers(&mut self, p: &MemoryPercept, now: ServerMs) {
        let mut seen: Vec<String> = Vec::new();
        for c in &p.containers {
            seen.push(c.id.clone());
            if self.containers.iter().all(|(k, _)| *k != c.id) {
                self.containers.push((
                    c.id.clone(),
                    ContainerMemory {
                        id: c.id.clone(),
                        kind: c.kind.clone(),
                        pos: Vec2::new(c.x, c.y),
                        closed: c.closed,
                        weapon: convert_weapon(c.weapon),
                        seen_at: now,
                        skipped: false,
                    },
                ));
                continue;
            }
            let m = self
                .containers
                .iter_mut()
                .find(|(k, _)| *k == c.id)
                .unwrap();
            m.1.kind = c.kind.clone();
            m.1.pos = Vec2::new(c.x, c.y);
            m.1.closed = c.closed;
            if c.weapon != self::source_input::PerceptWeapon::Undefined {
                m.1.weapon = convert_weapon(c.weapon);
            }
            m.1.seen_at = now;
        }
        for m in self.containers.iter_mut() {
            if seen.contains(&m.0) || m.1.kind != "ground" || now - m.1.seen_at <= LOOSE_WEAPON_MS {
                continue;
            }
            m.1.closed = false;
            m.1.weapon = ContainersWeapon::Null;
        }
    }

    fn time_to_impact(pr: &self::source_input::PerceptProjectile, me: Vec2) -> Option<f64> {
        let speed = hypot(pr.vx, pr.vy);
        if speed < 1e-6 {
            return None;
        }
        let ux = pr.vx / speed;
        let uy = pr.vy / speed;
        // JS `Math.max(0, NaN)` is NaN (an unpublished course leaves `range`/`x0` undefined), where `f64::max` would
        // answer 0; every finite value reads as before.
        let raw_left = pr.range - hypot(pr.x - pr.x0, pr.y - pr.y0);
        let left = if raw_left.is_nan() {
            raw_left
        } else {
            raw_left.max(0.)
        };
        let dx = me.x - pr.x;
        let dy = me.y - pr.y;
        let along = dx * ux + dy * uy;
        let perp = (dx * uy - dy * ux).abs();
        let reach = RANGED_HIT_REACH + PLAYER_RADIUS;
        if perp > reach {
            return None;
        }
        let half = (reach * reach - perp * perp).sqrt();
        if along < -half {
            return None;
        }
        let enter = (along - half).max(0.);
        if enter > left {
            return None;
        }
        Some((enter / speed) * 1000.)
    }

    fn fold_projectiles(
        &mut self,
        p: &MemoryPercept,
        out: &mut Vec<Stimulus>,
        _now: ServerMs,
        me: Vec2,
    ) {
        let mut live: Vec<String> = Vec::new();
        for pr in &p.projectiles {
            live.push(pr.id.clone());
            if self.incoming_seen.contains(&pr.id) || pr.from.as_deref() == Some(&self.self_id) {
                continue;
            }
            let Some(ms) = Self::time_to_impact(pr, me) else {
                continue;
            };
            self.incoming_seen.push(pr.id.clone());
            self.emit(
                out,
                me,
                StimulusKind::Incoming,
                Some(pr.id.clone()),
                Some(Vec2::new(pr.x, pr.y)),
                Some(ms),
            );
        }
        self.incoming_seen.retain(|id| live.contains(id));
    }

    fn take_credit(&mut self, src: CreditSrc, amount: f64) -> f64 {
        let mut left = amount;
        for c in self.credits.iter_mut() {
            if c.src != src || left <= 0. {
                continue;
            }
            let take = c.amount.min(left);
            c.amount -= take;
            left -= take;
        }
        left
    }

    fn fold_hp_loss(
        &mut self,
        p: &MemoryPercept,
        out: &mut Vec<Stimulus>,
        now: ServerMs,
        me: Vec2,
        hit_sum: f64,
    ) {
        self.credits
            .retain(|c| now - c.t <= HP_CREDIT_MS && c.amount > 1e-9);
        let drop = (self.prev_hp - p.self_.hp).max(0.);
        self.prev_hp = p.self_.hp;
        let drop_net = if drop >= (1f64).max(HP_ALONE_SHARE * p.self_.max_hp) {
            self.take_credit(CreditSrc::Hit, drop)
        } else {
            0.
        };
        let hit_net = if hit_sum > 0. {
            self.take_credit(CreditSrc::Hp, hit_sum)
        } else {
            0.
        };
        let loss = drop_net.max(hit_net);
        self.credits.retain(|c| c.amount > 1e-9);
        if loss <= 0. {
            return;
        }
        if drop_net > hit_net {
            self.credits.push(HpCredit {
                src: CreditSrc::Hp,
                amount: drop_net - hit_net,
                t: now,
            });
        } else if hit_net > drop_net {
            self.credits.push(HpCredit {
                src: CreditSrc::Hit,
                amount: hit_net - drop_net,
                t: now,
            });
        }
        let by = self.recent.last().and_then(|h| h.by.clone());
        let subject = if hit_sum > 0. {
            by.filter(|by| self.fighter(by).is_some())
        } else {
            None
        };
        self.emit(out, me, StimulusKind::HpLoss, subject, None, Some(loss));
    }

    fn fold_low_hp(
        &mut self,
        p: &MemoryPercept,
        out: &mut Vec<Stimulus>,
        _now: ServerMs,
        me: Vec2,
    ) {
        let share = if p.self_.max_hp > 0. {
            p.self_.hp / p.self_.max_hp
        } else {
            1.
        };
        if self.prev_hp_share >= 0.5 && share < 0.5 {
            self.emit(out, me, StimulusKind::LowHp, None, None, Some(share));
        }
        self.prev_hp_share = share;
    }

    fn dropped_on_purpose(&self, now: ServerMs) -> bool {
        self.self_mem.last_order.as_ref().is_some_and(|t| {
            matches!(
                t.cmd,
                MemoryCommand::Move { .. } | MemoryCommand::Stop { .. }
            ) && now - t.at <= 1000.
        })
    }

    fn fold_lock(
        &mut self,
        p: &MemoryPercept,
        out: &mut Vec<Stimulus>,
        o: &ObsState,
        now: ServerMs,
        me: Vec2,
    ) {
        let target = p.self_.attack_target.clone();
        if self.prev_target.is_some() && target != self.prev_target {
            self.dropped = if target.is_none() {
                Some(Dropped {
                    id: self.prev_target.clone().unwrap(),
                    at: now,
                    intentional: self.dropped_on_purpose(now),
                })
            } else {
                None
            };
        }
        self.prev_target = target.clone();
        if target.is_some() || o.flip {
            self.dropped = None;
        }
        let Some(d) = self.dropped.clone() else {
            return;
        };
        let where_ = self.pos_of(p, &d.id, None);
        if self.is_down(p, &o.deaths, &d.id) {
            self.dropped = None;
            if !d.intentional {
                self.emit(out, me, StimulusKind::TargetDown, Some(d.id), where_, None);
            }
            return;
        }
        if d.intentional {
            self.dropped = None;
            return;
        }
        let Some(seen) = self.drawn_at(p, &d.id) else {
            if now - d.at > LOCK_GIVE_UP_MS {
                self.dropped = None;
            }
            return;
        };
        let lag = (now - p.view_t).max(0.);
        if seen.1 > DYING_HP || now - d.at >= lag + LOCK_WAIT_MS {
            self.dropped = None;
            self.emit(
                out,
                me,
                StimulusKind::LockLost,
                Some(d.id),
                Some(seen.0),
                None,
            );
            if let Some(last) = out.last_mut() {
                last.at = d.at;
            }
        }
    }

    fn fold_orders(&mut self, p: &MemoryPercept, out: &mut Vec<Stimulus>, now: ServerMs, me: Vec2) {
        let mut order = self.pending.clone();
        if let Some(order) = order.as_mut() {
            if !order.done {
                match &order.tc.cmd {
                    MemoryCommand::Move { x, y, seq } => {
                        if !order.reflected {
                            order.reflected = match seq {
                                Some(seq) => p.self_.move_seq == *seq,
                                None => {
                                    p.self_.move_seq != order.move_seq
                                        || order.from.is_some_and(|from| dist(me, from) > WALKED_U)
                                }
                            };
                        }
                        if !order.arrived && dist(me, Vec2::new(*x, *y)) <= ARRIVE_U {
                            order.arrived = true;
                            order.done = true;
                            self.emit(out, me, StimulusKind::Arrived, None, None, None);
                        } else if !order.reflected && now - order.tc.at >= ORDER_CHECK_MS {
                            order.done = true;
                            self.emit(out, me, StimulusKind::OrderFailed, None, None, None);
                        }
                    }
                    MemoryCommand::Stop { seq } => {
                        if !order.reflected {
                            order.reflected = match seq {
                                Some(seq) => p.self_.move_seq == *seq,
                                None => true,
                            };
                        }
                        if !order.reflected && now - order.tc.at >= ORDER_CHECK_MS {
                            order.done = true;
                            self.emit(out, me, StimulusKind::OrderFailed, None, None, None);
                        }
                    }
                    MemoryCommand::Target { id } => {
                        if !order.reflected {
                            order.reflected = p.self_.attack_target.as_deref() == Some(id);
                        }
                        if !order.reflected && now - order.tc.at >= ORDER_CHECK_MS {
                            order.done = true;
                            self.emit(
                                out,
                                me,
                                StimulusKind::OrderFailed,
                                Some(id.clone()),
                                None,
                                None,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
        self.pending = order;
        self.last_move_seq = p.self_.move_seq;
        self.last_pos = Some(me);
    }

    fn fold_extras(
        &mut self,
        p: &MemoryPercept,
        out: &mut Vec<Stimulus>,
        _now: ServerMs,
        me: Vec2,
    ) {
        if let Some(plan) = &p.extras.plan {
            if plan.ends_at != self.last_plan_end {
                self.last_plan_end = plan.ends_at;
                self.emit(out, me, StimulusKind::PlanOffer, None, None, None);
            }
        }
        for c in &p.extras.chests {
            if c.picked || self.seen_chests.contains(&c.id) {
                continue;
            }
            self.seen_chests.push(c.id.clone());
            self.emit(
                out,
                me,
                StimulusKind::ChestUp,
                Some(c.id.clone()),
                Some(Vec2::new(c.x, c.y)),
                None,
            );
        }
    }

    pub(crate) fn observe(&mut self, p: &MemoryPercept) -> Result<&[Stimulus], MemoryError> {
        let now = p.now;
        let me = Vec2::new(p.self_.x, p.self_.y);
        self.current_now = now;
        let mut out: Vec<Stimulus> = Vec::new();
        let mut o = ObsState::default();
        self.fold_self(p, &mut o, now);
        self.fold_fighters(p, &mut out, now);
        self.fold_events(p, &mut o, &mut out, now);
        self.fold_mobs(p, &mut o, now);
        self.fold_camps(p, now, me);
        self.fold_containers(p, now);
        self.fold_projectiles(p, &mut out, now, me);
        self.fold_hp_loss(p, &mut out, now, me, o.hit_sum);
        self.fold_low_hp(p, &mut out, now, me);
        self.fold_lock(p, &mut out, &o, now, me);
        self.fold_orders(p, &mut out, now, me);
        self.fold_extras(p, &mut out, now, me);
        self.recent.retain(|h| now - h.t <= RECENT_HIT_MS);
        self.self_mem.recent_hits = self.recent.clone();
        // Source reduce uses an explicit 0 identity; Rust f64 Sum starts at -0.0 for an empty iterator.
        let mut recent_damage = 0.0f64;
        for hit in &self.recent {
            recent_damage += hit.amount;
        }
        self.self_mem.recent_damage = recent_damage;
        let alive = p.self_.status != "dead" && p.self_.status != "mia";
        self.stimuli = if alive {
            out
        } else {
            out.into_iter()
                .filter(|s| s.kind == StimulusKind::Announcement)
                .collect()
        };
        Ok(&self.stimuli)
    }

    pub(crate) fn note_sent(&mut self, tc: MemoryTimedCommand) -> Result<(), MemoryError> {
        match &tc.cmd {
            MemoryCommand::Pickup { container_id } => {
                self.pickup = Some((container_id.clone(), tc.at));
                return Ok(());
            }
            MemoryCommand::Cast => {
                self.self_mem.last_cast = Some(tc);
                return Ok(());
            }
            MemoryCommand::Move { .. }
            | MemoryCommand::Stop { .. }
            | MemoryCommand::Target { .. } => {}
            _ => return Ok(()),
        }
        self.self_mem.last_order = Some(tc.clone());
        self.pending = Some(PendingOrder {
            tc,
            move_seq: self.last_move_seq,
            from: self.last_pos,
            reflected: false,
            arrived: false,
            done: false,
        });
        Ok(())
    }

    pub(crate) fn record_choice(&mut self, key: &str) {
        self.choices.push(key.to_string());
    }

    pub(crate) fn view(&self) -> MemoryView<'_> {
        MemoryView {
            fighters: &self.fighters,
            mobs: &self.mobs,
            camps: &self.camps,
            containers: &self.containers,
            self_memory: &self.self_mem,
            stimuli: &self.stimuli,
            bounties: &self.bounties,
            choices: &self.choices,
        }
    }

    pub(crate) fn whereabouts(
        &self,
        id: &str,
        now: ServerMs,
    ) -> Result<Option<Whereabouts>, MemoryError> {
        let Some(m) = self.fighter(id) else {
            return Ok(None);
        };
        if !m.alive {
            return Ok(None);
        }
        if !self
            .f_aux
            .iter()
            .find(|(k, _)| k == id)
            .is_some_and(|(_, a)| a.ever_seen)
        {
            return Ok(None);
        }
        let age = (now - m.seen_at).max(0.);
        if age > self.tier.memory_span_ms {
            return Ok(None);
        }
        Ok(Some(Whereabouts {
            at: m.pos,
            radius: 0.6 * PLAYER_SPEED * (age / 1000.),
        }))
    }
}

fn convert_weapon(w: self::source_input::PerceptWeapon) -> ContainersWeapon {
    match w {
        self::source_input::PerceptWeapon::Undefined => ContainersWeapon::Undefined,
        self::source_input::PerceptWeapon::Null => ContainersWeapon::Null,
        self::source_input::PerceptWeapon::Weapon(w) => ContainersWeapon::Weapon(w),
    }
}

fn blank_fighter(id: &str, name: &str) -> FighterMemory {
    FighterMemory {
        id: id.to_string(),
        name: name.to_string(),
        bot: false,
        faction: None,
        weapons_seen: Vec::new(),
        in_hand: None,
        other_slot: None,
        seen_at: 0.,
        pos: Vec2::new(0., 0.),
        vel: Vec2::new(0., 0.),
        hp_frac: 1.,
        bounty: 0.,
        alive: true,
        died_at: None,
        hit_me_at: None,
        hit_by_me_at: None,
        damage_to_me: 0.,
        damage_by_me: 0.,
        engaged_with: None,
        engaged_at: None,
        chasing_me: false,
        wish_seen_at: None,
        wish_ready_guess: None,
        feints: 0,
        last_feint_at: None,
    }
}
fn ext_by(data: &super::data::MethodValue) -> Option<String> {
    match data {
        super::data::MethodValue::Obj(fields) => {
            fields
                .iter()
                .find(|(k, _)| k == "by")
                .and_then(|(_, v)| match v {
                    super::data::MethodValue::Str(s) => Some(s.clone()),
                    _ => None,
                })
        }
        _ => None,
    }
}
fn ext_ability(data: &super::data::MethodValue) -> Option<String> {
    match data {
        super::data::MethodValue::Obj(fields) => fields
            .iter()
            .find(|(k, _)| k == "ability")
            .and_then(|(_, v)| match v {
                super::data::MethodValue::Str(s) => Some(s.clone()),
                _ => None,
            }),
        _ => None,
    }
}
