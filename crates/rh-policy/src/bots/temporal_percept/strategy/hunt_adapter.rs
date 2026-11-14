//! Source HuntAdapter (huntAdapter.ts): build the unchanged MobHunter's snapshot from the real Memory view/query,
//! seed houses once, exclude returning mobs, preserve the 240 ms/14-piece catch-up, and release through a real hunter call.
use super::mob_hunt::{
    adapter_config, HuntDecision, HuntInput, HuntMobLike, HuntSelf, MobHunter, TypeWeightFn,
};
use super::types::{AttackFn, LogFn, StrategyContext};
use crate::bots::mob_hunt::MobHuntConfig;
use crate::bots::types::PersonaParams;
use rh_sim::constants::{ELITE_HP_MULT, ELITE_K, MOB_HP_MULT, MOB_K};
use rh_sim::{math, mob_catalog, FactionId, Vec2};

const PVE_RELIEF: f64 = 0.25;
pub(crate) const WHEREABOUTS_MAX_AGE_MS: f64 = 5000.;
pub(crate) const BLOCKED_THREAT_FACTOR: f64 = 2.;
pub(crate) const STRAIGHT_WALK_FACTOR: f64 = 1.3;
const CATCHUP_PIECE_MS: f64 = 240.;
const CATCHUP_MAX_PIECES: f64 = 14.;

#[derive(Default)]
pub(crate) struct HuntAdapterOptions {
    pub attacking: Option<AttackFn>,
    pub log: Option<LogFn>,
}

pub(crate) struct HuntAdapter {
    pub hunter: MobHunter,
    pub config: MobHuntConfig,
    homed: Vec<String>,
    last_at: f64,
    walk_paths: bool,
    opts: HuntAdapterOptions,
}

impl HuntAdapter {
    pub(crate) fn new(
        tier: &crate::bots::types::TierParams,
        persona: &PersonaParams,
        opts: HuntAdapterOptions,
    ) -> Self {
        let _ = PVE_RELIEF;
        let config = adapter_config(tier, persona);
        Self {
            hunter: MobHunter::new_with_log(config, opts.log.clone()),
            config,
            homed: Vec::new(),
            last_at: 0.,
            walk_paths: tier.route.walk_paths,
            opts,
        }
    }

    pub(crate) fn stats(&self) -> &super::mob_hunt::MobHuntStats {
        &self.hunter.stats
    }

    pub(crate) fn target(&self) -> Option<&str> {
        self.hunter.target()
    }

    fn attacking(&self, ctx: &StrategyContext<'_>) -> bool {
        self.opts
            .attacking
            .as_ref()
            .map_or(ctx.p.self_.attack_target.is_some() && ctx.engaged, |f| f())
    }

    fn log(&self, text: &str) {
        if let Some(log) = &self.opts.log {
            log(text);
        }
    }

    fn mobs(ctx: &StrategyContext<'_>) -> Vec<(String, HuntMobLike)> {
        hunt_mobs(
            ctx.mem.mobs(),
            ctx.p.extras.camps.as_deref(),
            &ctx.cfg.map.camps,
        )
    }

    fn players(ctx: &StrategyContext<'_>) -> (Vec<Vec2>, f64) {
        let mut players = Vec::new();
        let mut nearest = f64::INFINITY;
        let mut on_screen: Vec<&str> = Vec::new();
        for f in &ctx.p.fighters {
            on_screen.push(f.id.as_str());
            if f.status != "alive" {
                continue;
            }
            players.push(f.pos());
            let d = if f.los {
                f.dist
            } else {
                f.dist * BLOCKED_THREAT_FACTOR
            };
            nearest = nearest.min(d);
        }
        for (id, m) in ctx.mem.fighters() {
            if on_screen.contains(&id.as_str())
                || !m.alive
                || ctx.p.now - m.seen_at >= WHEREABOUTS_MAX_AGE_MS
            {
                continue;
            }
            if let Some(w) = ctx.whereabouts(id, ctx.p.now) {
                players.push(w.at);
            }
        }
        (players, nearest)
    }

    fn self_view(ctx: &StrategyContext<'_>) -> HuntSelf {
        let me = &ctx.p.self_;
        HuntSelf {
            faction: me.faction,
            x: me.x,
            y: me.y,
            hp: me.hp,
            max_hp: me.max_hp,
            weapons: me.weapons,
            power: me.power,
            mob_kills: me.mob_kills,
            mob_stats: Vec::new(),
        }
    }

    fn seed_homes(&mut self, ctx: &StrategyContext<'_>, mobs: &[(String, HuntMobLike)]) {
        let mut fresh: Vec<(String, HuntMobLike)> = Vec::new();
        let mut any = false;
        for (id, like) in mobs {
            if self.homed.iter().any(|h| h == id) {
                fresh.push((id.clone(), like.clone()));
                continue;
            }
            self.homed.push(id.clone());
            if let Some(home) = ctx
                .mem
                .mobs()
                .iter()
                .find(|(k, _)| k == id)
                .and_then(|(_, m)| m.home)
            {
                let mut at_home = like.clone();
                at_home.x = home.x;
                at_home.y = home.y;
                fresh.push((id.clone(), at_home));
                any = true;
            } else {
                fresh.push((id.clone(), like.clone()));
            }
        }
        if any {
            self.hunter.tracker.observe(&fresh, ctx.p.now);
        }
    }

    /// The hunt's answer for this think. Call it once per strategy decision.
    pub(crate) fn decide<'a>(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        type_weight: Option<&'a TypeWeightFn<'a>>,
        elites_ready: Option<bool>,
    ) -> HuntDecision {
        let now = ctx.p.now;
        let (players, nearest) = Self::players(ctx);
        let mobs = Self::mobs(ctx);
        let self_view = Self::self_view(ctx);
        self.seed_homes(ctx, &mobs);
        let attacking = self.attacking(ctx);
        let shot_by_player_at = ctx
            .mem
            .self_memory()
            .last_hit_by_player_at
            .unwrap_or(f64::NEG_INFINITY);
        let in_coliseum = ctx.p.hud.in_coliseum;
        let walk_from = ctx.p.self_.pos();
        let walk_paths = self.walk_paths;
        let mut walk = move |mob: &HuntMobLike| -> Option<f64> {
            let to = Vec2::new(mob.x, mob.y);
            if !walk_paths {
                return Some(
                    math::hypot(to.x - walk_from.x, to.y - walk_from.y) * STRAIGHT_WALK_FACTOR,
                );
            }
            ctx.paths.walk_mob(walk_from, mob).map(|w| w.dist)
        };
        let target_before = self.hunter.target().is_some();
        if target_before && self.last_at > 0. && now - self.last_at > CATCHUP_PIECE_MS {
            let gap = now - self.last_at;
            let pieces = CATCHUP_MAX_PIECES.min((gap / CATCHUP_PIECE_MS).ceil()) as u32;
            for k in 1..pieces {
                let piece_now = self.last_at + (gap * f64::from(k)) / f64::from(pieces);
                let mut input = HuntInput {
                    now: piece_now,
                    self_: &self_view,
                    player_distance: nearest,
                    players: &players,
                    in_coliseum,
                    mobs: &mobs,
                    walk: &mut walk,
                    attacking,
                    shot_by_player_at,
                    type_weight,
                    elites_ready,
                };
                let _ = self.hunter.decide(&mut input);
            }
        }
        self.last_at = now;
        let mut input = HuntInput {
            now,
            self_: &self_view,
            player_distance: nearest,
            players: &players,
            in_coliseum,
            mobs: &mobs,
            walk: &mut walk,
            attacking,
            shot_by_player_at,
            type_weight,
            elites_ready,
        };
        self.hunter.decide(&mut input)
    }

    /// The strategy chose something other than the mob hunt: the source synthetic near-player call into the real hunter.
    pub(crate) fn release(&mut self, ctx: &mut StrategyContext<'_>) {
        if self.hunter.target().is_none() {
            return;
        }
        let (players, _) = Self::players(ctx);
        let mobs = Self::mobs(ctx);
        let self_view = Self::self_view(ctx);
        let now = ctx.p.now;
        let in_coliseum = ctx.p.hud.in_coliseum;
        let walk_from = ctx.p.self_.pos();
        let walk_paths = self.walk_paths;
        let attacking = self.attacking(ctx);
        let shot_by_player_at = ctx
            .mem
            .self_memory()
            .last_hit_by_player_at
            .unwrap_or(f64::NEG_INFINITY);
        let mut walk = move |mob: &HuntMobLike| -> Option<f64> {
            let to = Vec2::new(mob.x, mob.y);
            if !walk_paths {
                return Some(
                    math::hypot(to.x - walk_from.x, to.y - walk_from.y) * STRAIGHT_WALK_FACTOR,
                );
            }
            ctx.paths.walk_mob(walk_from, mob).map(|w| w.dist)
        };
        let mut input = HuntInput {
            now,
            self_: &self_view,
            player_distance: 0.,
            players: &players,
            in_coliseum,
            mobs: &mobs,
            walk: &mut walk,
            attacking,
            shot_by_player_at,
            type_weight: None,
            elites_ready: None,
        };
        let _ = self.hunter.decide(&mut input);
    }

    pub(crate) fn awake_near(&self, from: Vec2, radius: f64, now: f64) -> Vec<Vec2> {
        self.hunter.awake_near(from, radius, now)
    }
}

fn is_regional_kind(kind: &str) -> bool {
    matches!(kind, "mob" | "elite")
}

/// The source max HP a remembered mob's type/name/faction gives (huntAdapter.ts mobMaxHp and mobTypeFaction's hp part).
fn mob_max_hp(zone: Option<FactionId>, elite: bool, name: Option<&str>) -> f64 {
    let Some(zone) = zone else {
        return f64::NAN;
    };
    let typed = name.and_then(|name| {
        mob_catalog::mob_types_of(zone).find(|t| t.elite == elite && t.name == name)
    });
    let k = if elite { ELITE_K } else { MOB_K };
    let base = crate::bots::build_route::reward_stat(None).map_or(0., |_| 0.)
        + rh_sim::content::faction(zone).hp
            * k
            * MOB_HP_MULT
            * if elite { ELITE_HP_MULT } else { 1. };
    let typed_mult = typed.map_or(1., |t| t.role_def().hp_mult);
    base * typed_mult
}

fn mob_like_of(m: &super::super::memory::MobMemory) -> Option<HuntMobLike> {
    if !is_regional_kind(&m.kind) {
        return None;
    }
    let max_hp = mob_max_hp(m.faction, m.kind == "elite", m.name.as_deref());
    Some(HuntMobLike {
        kind: m.kind.clone(),
        status: if m.alive {
            "alive".into()
        } else {
            "dead".into()
        },
        x: m.pos.x,
        y: m.pos.y,
        hp: m.hp_frac * max_hp,
        max_hp,
        faction: m.faction,
        faction_text: m.faction.map(|f| f.as_str().to_string()),
        weapon0: m.in_hand,
        weapon0_text: m.in_hand.map(|w| w.as_str().to_string()),
        type_: m.type_.clone(),
        reward: None,
    })
}

/// The hunter's mob snapshot (huntAdapter.ts, the `mobs` loop as patched by a7b5c4ce): every remembered regional mob
/// not walking home, in memory order, each carrying what its kill pays when its camp (`MobMemory::camp_id`, the map
/// camp id `defs[i].id`) pays a stat other than its type's own, as the seat's percept reports it
/// (`camps[j].reward` of the view with `index == i`). `camps` is `None` when the camps feature is off.
/// STUB (P-BOT-BRAIN-THEMED-2): today's snapshot; `camps` and `defs` are not read yet and `reward` stays `None`.
pub(crate) fn hunt_mobs(
    mobs: &[(String, super::super::memory::MobMemory)],
    camps: Option<&[super::types::CampView]>,
    defs: &[super::types::CampDef],
) -> Vec<(String, HuntMobLike)> {
    let _ = (camps, defs);
    let mut out = Vec::new();
    for (id, m) in mobs {
        if m.returning {
            continue;
        }
        if let Some(like) = mob_like_of(m) {
            out.push((id.clone(), like));
        }
    }
    out
}
