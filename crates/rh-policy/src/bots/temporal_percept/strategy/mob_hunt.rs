//! Stateful source MobTracker and MobHunter (mobHunt.ts), plus the source hunt input/decision contracts.
//! The static tunables, hunt-config derivation and pure weapon/retreat helpers remain the existing pure port.
pub(crate) use crate::bots::mob_hunt::HuntDecision;
use crate::bots::mob_hunt::{best_edge, hunt_config_for, is_ranged, MobHuntConfig};
use crate::bots::types::{PersonaParams, TierParams};
use rh_sim::{math, FactionId, Vec2, WeaponId};

pub(crate) type TypeWeightFn<'a> = dyn Fn(Option<&str>) -> f64 + 'a;

pub(crate) const NO_MOB_IN_REACH: &str = "no mob in reach";
const EDGE_BONUS: f64 = 90.;
const SHARE_BONUS: f64 = 200.;
const KITER_PENALTY: f64 = 200.;
const EDGE_PENALTY: f64 = 400.;
const CONTEST_PENALTY: f64 = 350.;
const HP_WEIGHT: f64 = 0.12;
const NEW_WEAPON_BONUS: f64 = 120.;
const BUILD_TYPE_BONUS: f64 = 320.;
const OFF_BUILD_WALK: f64 = 140.;
const BUILD_WANTED: f64 = 0.6;
const ELITE_PENALTY: f64 = 120.;
const RISE_EPS: f64 = 0.5;
const RISE_HOLD_MS: f64 = 1500.;
const MOB_STAT_CAP: f64 = 10.;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HuntMobLike {
    pub kind: String,
    pub status: String,
    pub x: f64,
    pub y: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub faction: Option<FactionId>,
    pub faction_text: Option<String>,
    pub weapon0: Option<WeaponId>,
    pub weapon0_text: Option<String>,
    pub type_: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HuntSelf {
    pub faction: Option<FactionId>,
    pub x: f64,
    pub y: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub weapons: [Option<WeaponId>; 2],
    pub power: f64,
    pub mob_kills: f64,
    /// Per normal-type credited kill stacks (source MobStatCounts), in declared order.
    pub mob_stats: Vec<(String, u32)>,
}

#[derive(Default, Clone, Debug, PartialEq)]
pub(crate) struct MobHuntStats {
    pub targets: u64,
    pub drops: u64,
    pub retreats: u64,
    pub focus_ms: f64,
}

pub(crate) struct HuntInput<'a> {
    pub now: f64,
    pub self_: &'a HuntSelf,
    pub player_distance: f64,
    pub players: &'a [Vec2],
    pub in_coliseum: bool,
    pub mobs: &'a [(String, HuntMobLike)],
    pub walk: &'a mut dyn FnMut(&HuntMobLike) -> Option<f64>,
    pub attacking: bool,
    pub shot_by_player_at: f64,
    pub type_weight: Option<&'a TypeWeightFn<'a>>,
    pub elites_ready: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
struct TrackerRec {
    id: String,
    mob: HuntMobLike,
    home: Vec2,
    hp: f64,
    rising_until: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct MobTracker {
    rec: Vec<TrackerRec>,
}

impl MobTracker {
    /// Call with the current mobs every think. Forgets mobs that left the state.
    pub(crate) fn observe(&mut self, mobs: &[(String, HuntMobLike)], now: f64) {
        let mut seen = 0usize;
        for (id, m) in mobs {
            if !is_regional_kind(&m.kind) {
                continue;
            }
            seen += 1;
            if let Some(r) = self.rec.iter_mut().find(|r| &r.id == id) {
                if m.status == "alive" && m.hp > r.hp + RISE_EPS {
                    r.rising_until = now + RISE_HOLD_MS;
                }
                r.mob = m.clone();
                r.hp = m.hp;
            } else {
                self.rec.push(TrackerRec {
                    id: id.clone(),
                    mob: m.clone(),
                    home: Vec2::new(m.x, m.y),
                    hp: m.hp,
                    rising_until: 0.,
                });
            }
        }
        if self.rec.len() > seen {
            let live: Vec<&String> = mobs.iter().map(|(id, _)| id).collect();
            self.rec.retain(|r| live.iter().any(|id| **id == r.id));
        }
    }

    pub(crate) fn mob(&self, id: &str) -> Option<&HuntMobLike> {
        self.rec.iter().find(|r| r.id == id).map(|r| &r.mob)
    }

    pub(crate) fn home(&self, id: &str) -> Option<Vec2> {
        self.rec.iter().find(|r| r.id == id).map(|r| r.home)
    }

    pub(crate) fn returning(&self, id: &str, now: f64) -> bool {
        self.rec
            .iter()
            .find(|r| r.id == id)
            .is_some_and(|r| now < r.rising_until)
    }

    pub(crate) fn awake(&self, id: &str, now: f64, awake_moved: f64) -> bool {
        let Some(r) = self.rec.iter().find(|r| r.id == id) else {
            return false;
        };
        if r.mob.status != "alive" || now < r.rising_until {
            return false;
        }
        distance(&r.mob, r.home) > awake_moved || r.mob.hp < r.mob.max_hp - RISE_EPS
    }

    pub(crate) fn awake_near(
        &self,
        from: Vec2,
        radius: f64,
        now: f64,
        awake_moved: f64,
    ) -> Vec<Vec2> {
        self.rec
            .iter()
            .filter(|r| distance(&r.mob, from) <= radius && self.awake(&r.id, now, awake_moved))
            .map(|r| Vec2::new(r.mob.x, r.mob.y))
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Engagement {
    id: String,
    since: f64,
    best_hp: f64,
    stall_ms: f64,
    approach_ms: f64,
}

pub(crate) struct MobHunter {
    pub tracker: MobTracker,
    pub stats: MobHuntStats,
    cfg: MutHuntConfig,
    banned: Vec<(String, f64)>,
    eng: Option<Engagement>,
    last_at: f64,
    last_kind_is_mob: bool,
    player_lock: bool,
    retreat_until: f64,
    retreat_min_until: f64,
    mob_ban_until: f64,
    next_pick_at: f64,
}

#[derive(Clone, Copy, Debug)]
struct MutHuntConfig(MobHuntConfig);
impl std::ops::Deref for MutHuntConfig {
    type Target = MobHuntConfig;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl MutHuntConfig {
    fn new(cfg: MobHuntConfig) -> Self {
        Self(cfg)
    }
}

impl MobHunter {
    pub(crate) fn new(cfg: MobHuntConfig) -> Self {
        Self {
            tracker: MobTracker::default(),
            stats: MobHuntStats::default(),
            cfg: MutHuntConfig::new(cfg),
            banned: Vec::new(),
            eng: None,
            last_at: 0.,
            last_kind_is_mob: false,
            player_lock: false,
            retreat_until: 0.,
            retreat_min_until: 0.,
            mob_ban_until: 0.,
            next_pick_at: 0.,
        }
    }

    pub(crate) fn config(&self) -> &MobHuntConfig {
        &self.cfg.0
    }

    pub(crate) fn target(&self) -> Option<&str> {
        self.eng.as_ref().map(|e| e.id.as_str())
    }

    pub(crate) fn is_banned(&mut self, id: &str, now: f64) -> bool {
        if let Some(pos) = self.banned.iter().position(|(k, _)| k == id) {
            if now >= self.banned[pos].1 {
                self.banned.remove(pos);
                return false;
            }
            return true;
        }
        false
    }

    pub(crate) fn awake_near(&self, from: Vec2, radius: f64, now: f64) -> Vec<Vec2> {
        self.tracker
            .awake_near(from, radius, now, self.cfg.0.awake_moved)
    }

    pub(crate) fn decide(&mut self, inp: &mut HuntInput<'_>) -> HuntDecision {
        let dt = if self.last_at > 0. {
            (inp.now - self.last_at).clamp(0., 250.)
        } else {
            0.
        };
        self.last_at = inp.now;
        self.tracker.observe(inp.mobs, inp.now);
        if self.last_kind_is_mob {
            self.stats.focus_ms += dt;
        }
        let out = self.choose(inp, dt);
        self.last_kind_is_mob = matches!(out, HuntDecision::Mob { .. });
        out
    }

    fn choose(&mut self, inp: &mut HuntInput<'_>, dt: f64) -> HuntDecision {
        let cfg = self.cfg.0;
        let now = inp.now;
        if inp.in_coliseum {
            self.eng = None;
            return HuntDecision::Player {
                why: "coliseum".into(),
            };
        }
        let near = inp.player_distance;
        if near < cfg.player_threat
            || (now - inp.shot_by_player_at < cfg.under_fire_ms && near < cfg.under_fire_range)
        {
            self.player_lock = true;
        } else if near >= cfg.player_release {
            self.player_lock = false;
        }
        if self.player_lock {
            self.eng = None;
            return HuntDecision::Player {
                why: "a player is close".into(),
            };
        }
        let hp_frac = if inp.self_.max_hp > 0. {
            inp.self_.hp / inp.self_.max_hp
        } else {
            1.
        };
        if let Some(retreat) = self.retreat(inp, hp_frac) {
            return retreat;
        }
        if now < self.mob_ban_until {
            return HuntDecision::Player {
                why: "staying off mobs".into(),
            };
        }
        if self.stats.focus_ms >= cfg.focus_budget_ms {
            return HuntDecision::Player {
                why: "mob time budget spent".into(),
            };
        }
        if inp.self_.mob_kills >= cfg.kill_goal {
            return HuntDecision::Player {
                why: "enough mob kills".into(),
            };
        }
        if let Some(eng) = self.eng.clone() {
            if !self.keep(&eng, inp, dt) {
                self.eng = None;
            }
        }
        if self.eng.is_none() {
            if now < self.next_pick_at {
                return HuntDecision::Player {
                    why: NO_MOB_IN_REACH.into(),
                };
            }
            let Some(id) = self.pick(inp, hp_frac) else {
                self.next_pick_at = now + cfg.repick_ms;
                return HuntDecision::Player {
                    why: NO_MOB_IN_REACH.into(),
                };
            };
            let mob = self.tracker.mob(&id).expect("picked from tracker").clone();
            self.eng = Some(Engagement {
                id,
                since: now,
                best_hp: mob.hp,
                stall_ms: 0.,
                approach_ms: 0.,
            });
            self.stats.targets += 1;
        }
        let eng = self.eng.as_ref().expect("just picked");
        let mob = self.tracker.mob(&eng.id).expect("engagement tracked");
        HuntDecision::Mob {
            id: eng.id.clone(),
            why: format!(
                "{} {} with {}",
                mob.faction_text.as_deref().unwrap_or(""),
                mob.kind,
                mob.weapon0_text.as_deref().unwrap_or("")
            ),
        }
    }

    fn retreat(&mut self, inp: &mut HuntInput<'_>, hp_frac: f64) -> Option<HuntDecision> {
        let cfg = self.cfg.0;
        let now = inp.now;
        let awake = self.awake_near(inp.self_.pos(), cfg.retreat_clear, now);
        if self.retreat_until > now {
            if !awake.is_empty() || now < self.retreat_min_until {
                let mut from = awake;
                from.extend_from_slice(inp.players);
                return Some(HuntDecision::Retreat {
                    from,
                    why: "running".into(),
                });
            }
            self.retreat_until = 0.;
        } else if self.eng.is_some() && hp_frac < cfg.retreat_hp {
            self.eng = None;
            self.mob_ban_until = now + cfg.retreat_ban_ms;
            if !awake.is_empty() {
                self.retreat_until = now + cfg.retreat_max_ms;
                self.retreat_min_until = now + cfg.retreat_min_ms;
                self.stats.retreats += 1;
                let mut from = awake;
                from.extend_from_slice(inp.players);
                return Some(HuntDecision::Retreat {
                    from,
                    why: "low hp".into(),
                });
            }
        }
        None
    }

    fn keep(&mut self, e: &Engagement, inp: &mut HuntInput<'_>, dt: f64) -> bool {
        let cfg = self.cfg.0;
        let Some(m) = self.tracker.mob(&e.id) else {
            return false;
        };
        if m.status != "alive" {
            return false;
        }
        if self.tracker.returning(&e.id, inp.now) {
            return self.drop(e, inp.now, cfg.return_ban_ms);
        }
        let mut eng = e.clone();
        if m.hp < eng.best_hp - RISE_EPS {
            eng.best_hp = m.hp;
            eng.stall_ms = 0.;
            eng.approach_ms = 0.;
        } else if inp.attacking {
            eng.stall_ms += dt;
        } else {
            eng.approach_ms += dt;
        }
        if eng.stall_ms >= cfg.stall_attack_ms
            || eng.approach_ms >= cfg.approach_ms
            || inp.now - eng.since >= cfg.target_budget_ms
        {
            self.eng = Some(eng);
            return self.drop(e, inp.now, cfg.stall_ban_ms);
        }
        self.eng = Some(eng);
        true
    }

    fn drop(&mut self, e: &Engagement, now: f64, ban_ms: f64) -> bool {
        if let Some(pos) = self.banned.iter().position(|(k, _)| k == &e.id) {
            self.banned[pos].1 = now + ban_ms;
        } else {
            self.banned.push((e.id.clone(), now + ban_ms));
        }
        self.stats.drops += 1;
        false
    }

    fn pick(&mut self, inp: &mut HuntInput<'_>, hp_frac: f64) -> Option<String> {
        let cfg = self.cfg.0;
        let now = inp.now;
        if hp_frac < cfg.start_min_hp {
            return None;
        }
        let carried: Vec<WeaponId> = inp.self_.weapons.iter().flatten().copied().collect();
        let reach = if inp.self_.mob_kills == 0. {
            cfg.first_reach
        } else {
            cfg.reach
        };
        let progression_power = inp.self_.power + mob_type_progress(&inp.self_.mob_stats);
        let mut near: Vec<(String, HuntMobLike, f64, Option<WeaponId>, i8, f64)> = Vec::new();
        for (id, m) in inp.mobs {
            if !is_regional_kind(&m.kind) || m.status != "alive" {
                continue;
            }
            let d = math::hypot(m.x - inp.self_.x, m.y - inp.self_.y);
            if d > reach || self.is_banned(id, now) || self.tracker.returning(id, now) {
                continue;
            }
            if m.kind == "elite"
                && (inp.elites_ready == Some(false)
                    || !(progression_power >= cfg.elite_min_power || hp_frac >= cfg.elite_full_hp))
            {
                continue;
            }
            let share = match (inp.self_.faction, m.faction) {
                (Some(me), Some(theirs)) => matchup_share(me, theirs, m.kind == "elite"),
                _ => 0.7,
            };
            let need = if m.kind != "elite" {
                cfg.mob_min_share
            } else if progression_power >= cfg.elite_sure_power {
                cfg.elite_sure_share
            } else {
                cfg.elite_min_share
            };
            if share < need {
                continue;
            }
            let theirs = hunt_mob_weapon(m);
            let edge = match theirs {
                None => 0.,
                Some(t) => f64::from(best_edge(&inp.self_.weapons, t)),
            };
            if edge <= -2. {
                continue;
            }
            if cfg.skip_ranged
                && theirs.is_some_and(is_ranged)
                && !carried.iter().any(|w| is_ranged(*w))
            {
                continue;
            }
            if edge < 0. && m.kind == "elite" {
                continue;
            }
            near.push((id.clone(), m.clone(), d, theirs, edge as i8, share));
        }
        near.sort_by(|a, b| a.2.total_cmp(&b.2));
        let mut best: Option<(String, f64)> = None;
        for (id, m, _, theirs, edge, share) in near.into_iter().take(cfg.max_candidates as usize) {
            let walk = (inp.walk)(&m);
            let Some(walk) = walk else {
                continue;
            };
            if walk > reach * cfg.walk_slack {
                continue;
            }
            let wanted = match inp.type_weight {
                None => 1.,
                Some(_weight) if m.kind == "elite" => 1.,
                Some(weight) => weight(m.type_.as_deref()),
            };
            if wanted < BUILD_WANTED && walk > OFF_BUILD_WALK && inp.self_.mob_kills > 0. {
                continue;
            }
            let mut score = walk - share * SHARE_BONUS + m.max_hp * HP_WEIGHT;
            if edge > 0 {
                score -= EDGE_BONUS;
            } else if edge < 0 {
                score += EDGE_PENALTY;
            }
            if let Some(theirs) = theirs {
                if carried.len() < 2 && !carried.contains(&theirs) {
                    score -= NEW_WEAPON_BONUS;
                }
                if is_ranged(theirs) && !carried.iter().any(|w| is_ranged(*w)) {
                    score += KITER_PENALTY;
                }
            }
            if m.kind == "elite" {
                score += ELITE_PENALTY;
            } else {
                score -= BUILD_TYPE_BONUS * (wanted - 0.25);
            }
            if inp
                .players
                .iter()
                .any(|p| math::hypot(p.x - m.x, p.y - m.y) < walk)
            {
                score += CONTEST_PENALTY;
            }
            if best.as_ref().is_none_or(|(_, s)| score < *s) {
                best = Some((id, score));
            }
        }
        best.map(|(id, _)| id)
    }
}

fn mob_type_progress(stacks: &[(String, u32)]) -> f64 {
    let total: u32 = stacks.iter().map(|(_, n)| *n).sum();
    f64::from(total) / MOB_STAT_CAP
}

fn is_regional_kind(kind: &str) -> bool {
    matches!(kind, "mob" | "elite")
}
fn distance(m: &HuntMobLike, at: Vec2) -> f64 {
    math::hypot(m.x - at.x, m.y - at.y)
}
fn matchup_share(me: FactionId, region: FactionId, elite: bool) -> f64 {
    crate::bots::planning::matchup_share(me, region, elite)
}
fn hunt_mob_weapon(m: &HuntMobLike) -> Option<WeaponId> {
    m.weapon0
        .or_else(|| m.faction.map(rh_sim::mob_catalog::mob_weapon))
}
fn faction_name(f: FactionId) -> &'static str {
    f.as_str()
}
fn weapon_name(w: WeaponId) -> &'static str {
    w.as_str()
}

/// Source hunt tunables for one bot (huntAdapter.ts huntConfigFor).
pub(crate) fn adapter_config(tier: &TierParams, persona: &PersonaParams) -> MobHuntConfig {
    hunt_config_for(tier, persona)
}

/// Source wantsMobs: only the "no mob in reach" player answer lets camps be considered.
pub(crate) fn wants_mobs(decision: &HuntDecision) -> bool {
    matches!(decision, HuntDecision::Player { why } if why == NO_MOB_IN_REACH)
}

impl HuntSelf {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}
