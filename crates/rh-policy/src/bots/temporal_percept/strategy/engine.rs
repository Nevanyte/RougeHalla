//! Complete private source Strategy (strategy.ts): exact decide order, candidate formulas, retained timers, hunts, loot,
//! camps, route/hunter coupling and source stochastic selection. No public Brain/tactics/module wiring is added here.
use super::build_route::{BuildRoute, RouteInput};
use super::hunt_adapter::{HuntAdapter, HuntAdapterOptions};
use super::mob_hunt::HuntDecision;
use super::types::RngStream;
use super::types::{
    goal_json_eq, goal_key, lookup, odds, Enemy, Goal, GoalDecision, GoalKind, GoalState,
    GoalStatus, HoldWhy, RoamWhy, RouteCamp, RouteStep, StrategyContext, StrategySelf,
    StrategyState,
};
use crate::bots::build_route::{ready_for_elites, type_weight};
use crate::bots::mob_hunt::{best_edge, is_ranged};
use crate::bots::types::FightOdds;
use rh_sim::constants::{
    MOB_REWARD_FLOOR, MOB_REWARD_MID, MOB_REWARD_WIDTH, PLAYER_SPEED, TARGET_RANGE, TILE,
};
use rh_sim::{math, mob_catalog, FactionId, Vec2};

pub(crate) const ORBIT_PROGRESS: f64 = 40.;
pub(crate) const ORBIT_JITTER_MS: f64 = 1500.;
pub(crate) const ORBIT_AVOID_MS: f64 = 6000.;
pub(crate) const ORBIT_MIN_DISTANCE: f64 = 150.;
pub(crate) const HYSTERESIS: f64 = 0.1;
const FIGHT_U: f64 = 0.85;
const FLEE_U: f64 = 1.1;
const FLEE_DEPTH_U: f64 = 0.15;
const HUNT_CAP: f64 = 0.84;
const COLISEUM_ROAM_U: f64 = 0.5;
const CENTRE_ROAM_U: f64 = 0.03;
const PATROL_U: f64 = 0.1;
const WAIT_U: f64 = 0.06;
const HOLD_PATIENCE_MS: f64 = 12_000.;
const HOLD_PATIENCE_SPAN_MS: f64 = 36_000.;
const LIE_LOW_U: f64 = 0.18;
const CAMP_ROAM_FACTOR: f64 = 0.6;
const ROUTE_BOOST: f64 = 1.4;
const OFF_ROUTE: f64 = 0.8;
const MAX_UTILITY: f64 = 1.3;
const FLEE_NEAR: f64 = 360.;
const FLEE_KEEP: f64 = 520.;
const FLEE_MOB_NEAR: f64 = 320.;
const FLEE_HIT_MS: f64 = 2500.;
const FLEE_GIVE_UP_MS: f64 = 8000.;
const FLEE_BAN_MS: f64 = 6000.;
const FLEE_MIN_MS: f64 = 1500.;
const FLEE_SPAN_MS: f64 = 1500.;
const THIRD_PARTY_MS: f64 = 6000.;
const REMEMBERED_HUNT_MS: f64 = 12_000.;
const BOUNTY_FULL: f64 = 30.;
const BOUNTY_LOGIT_RELIEF: f64 = 0.8;
const BUSY_BASE: f64 = 0.5;
const JUDGE_KEEP_MS: f64 = 5000.;
const HUNT_SHARPNESS: f64 = 1.5;
const EVADE_KEEP_MS: f64 = 1800.;
const EVADE_HYSTERESIS: f64 = 120.;
const EVADE_CLOSE_SHARE: f64 = 0.55;
const EVADE_U: f64 = 0.9;
const OPENING_LOGIT: f64 = 4.5;
const OPENING_MS: f64 = 240_000.;
const OPENING_TIMER_FREE_MS: f64 = 20_000.;
const OPENING_TIMER_SPAN_MS: f64 = 60_000.;
const HP_READY_FLOOR: f64 = 0.15;
const STALE_FACTOR: f64 = 0.55;
const LOOT_GROUND_RADIUS: f64 = 15. * TILE;
const LOOT_CHEST_RADIUS: f64 = 8. * TILE;
const LOOT_EARLY_MS: f64 = 25_000.;
const LOOT_ENEMY_NEAR: f64 = 240.;
const LOOT_MOB_NEAR: f64 = 220.;
const LOOT_BUDGET_MS: f64 = 8000.;
const LOOT_SKIP_MS: f64 = 30_000.;
const CAMP_MAX_WALKS: u32 = 4;
const PATIENCE_DASH_MS: f64 = 20_000.;
const PATROL_REVISIT_MS: f64 = 45_000.;
const PATROL_AGE_FULL_MS: f64 = 120_000.;
const ARRIVED: f64 = 96.;
const HOLD_SAFE: f64 = 260.;
const EXCLUDE_FAILED_MS: f64 = 5000.;
const EXCLUDE_DONE_MS: f64 = 1500.;
const LEARN_WEIGHT: f64 = 0.3;
const LEARN_CAP: f64 = 0.25;
const FEED_MOB_KILL_WEIGHT: f64 = 0.25;

#[derive(Default)]
pub(crate) struct StrategyOptions {
    pub attacking: Option<fn() -> bool>,
    pub log: Option<fn(&str)>,
}

struct Cand {
    decision: GoalDecision,
    key: String,
}

pub(crate) struct Strategy {
    adapter: Option<HuntAdapter>,
    avoid_id: Option<String>,
    avoid_until: f64,
    avoid_since: f64,
    chase: Option<super::types::Chase>,
    current_key: String,
    goal_since: f64,
    flee_ban_until: f64,
    excluded: Vec<(String, f64)>,
    loot_skip: Vec<(String, f64)>,
    judged: Vec<(String, f64, f64)>,
    last: Vec<GoalDecision>,
    route: Option<BuildRoute>,
    route_next: Option<RouteStep>,
    returned_current: bool,
    opts: StrategyOptions,
}

impl Strategy {
    pub(crate) fn new(opts: StrategyOptions) -> Self {
        Self {
            adapter: None,
            avoid_id: None,
            avoid_until: 0.,
            avoid_since: 0.,
            chase: None,
            current_key: String::new(),
            goal_since: 0.,
            flee_ban_until: 0.,
            excluded: Vec::new(),
            loot_skip: Vec::new(),
            judged: Vec::new(),
            last: Vec::new(),
            route: None,
            route_next: None,
            returned_current: false,
            opts,
        }
    }

    pub(crate) fn last_returned_current(&self) -> bool {
        self.returned_current
    }

    pub(crate) fn state(&self) -> StrategyState {
        StrategyState {
            avoid_id: self.avoid_id.clone(),
            avoid_until: self.avoid_until,
            chase: self.chase.clone(),
            goal_since: self.goal_since,
            candidates: self.last.clone(),
        }
    }

    pub(crate) fn hunt_stats(&self) -> super::mob_hunt::MobHuntStats {
        self.adapter
            .as_ref()
            .map(|a| a.stats().clone())
            .unwrap_or_default()
    }

    pub(crate) fn plan(&self) -> Option<(String, Vec<RouteStep>, u64)> {
        self.route
            .as_ref()
            .map(|r| (r.build.id.to_string(), r.route.clone(), r.stats.contests))
    }

    pub(crate) fn hunt_target(&self) -> Option<String> {
        self.adapter
            .as_ref()
            .and_then(|a| a.target().map(str::to_string))
    }

    pub(crate) fn awake_near(&self, from: Vec2, radius: f64, now: f64) -> Vec<Vec2> {
        self.adapter
            .as_ref()
            .map_or_else(Vec::new, |a| a.awake_near(from, radius, now))
    }

    fn log(&self, msg: &str) {
        if let Some(log) = self.opts.log {
            log(msg);
        }
    }

    fn attacking(&self, ctx: &StrategyContext<'_>) -> bool {
        self.opts
            .attacking
            .map_or(ctx.p.self_.attack_target.is_some() && ctx.engaged, |f| f())
    }

    pub(crate) fn decide(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        current: &Goal,
        status: &GoalStatus,
    ) -> GoalDecision {
        let now = ctx.p.now;
        if ctx.p.self_.status != "alive" {
            self.last.clear();
            return GoalDecision {
                goal: Goal::Idle,
                utility: 0.,
                why: "not alive".into(),
                choice: None,
            };
        }
        if self.adapter.is_none() {
            self.adapter = Some(HuntAdapter::new(
                ctx.cfg.tier,
                ctx.cfg.persona,
                HuntAdapterOptions {
                    attacking: self.opts.attacking,
                    log: self.opts.log,
                },
            ));
        }
        self.sync(current, now);
        self.settle(current, status, now);
        self.plan_route(ctx);
        let build = self.route.as_ref().map(|r| r.build);
        let type_weight_fn =
            build.map(|b| move |mob_type: Option<&str>| -> f64 { type_weight(b, mob_type) });
        let elites_ready = build.map(|_| {
            ready_for_elites(
                now - ctx.p.hud.raid_started_at,
                ctx.p.self_.mob_kills,
                ctx.p.self_.power,
            )
        });
        let tw_ref = type_weight_fn
            .as_ref()
            .map(|f| f as &dyn Fn(Option<&str>) -> f64);
        let hunt =
            self.adapter
                .as_mut()
                .expect("adapter initialized")
                .decide(ctx, tw_ref, elites_ready);
        let enemies = enemies_of(ctx);
        self.refresh_avoid(ctx, &enemies);
        self.track_chase(ctx, current, &enemies);
        let sd = ctx.p.hud.sudden_death_at > 0. && now >= ctx.p.hud.sudden_death_at;
        let mut cands: Vec<Cand> = Vec::new();
        push_opt(
            &mut cands,
            self.flee(ctx, current, hunt_from(&hunt), &enemies),
        );
        let fight = self.fight(ctx, current, &enemies);
        let fight_target = match &fight {
            Some(c) => match &c.decision.goal {
                Goal::Fight { target } => Some(target.clone()),
                _ => None,
            },
            None => None,
        };
        push_opt(&mut cands, clone_cand_opt(&fight));
        if ctx.p.hud.in_coliseum {
            for c in self.coliseum(ctx, current, &enemies, sd, fight_target.as_deref()) {
                cands.push(c);
            }
        } else {
            if let HuntDecision::Mob { id, .. } = &hunt {
                push_opt(&mut cands, self.farm(ctx, id));
            }
            let hcands = self.hunts(
                ctx,
                &enemies,
                if sd { "sd" } else { "normal" },
                fight_target.as_deref(),
            );
            for c in &hcands {
                cands.push(clone_cand(c));
            }
            push_opt(
                &mut cands,
                self.evade(ctx, current, &enemies, &hcands, fight.as_ref()),
            );
            push_opt(&mut cands, self.last_seen(ctx, &enemies));
            if super::mob_hunt::wants_mobs(&hunt) {
                for c in self.camps(ctx) {
                    cands.push(c);
                }
            }
            push_opt(&mut cands, self.patience_dash(ctx));
            push_opt(&mut cands, self.patrol(ctx));
            push_opt(&mut cands, self.lie_low(ctx));
            push_opt(&mut cands, self.centre(ctx));
        }
        for c in self.loot(ctx, &enemies) {
            cands.push(c);
        }
        for m in ctx.cfg.modules {
            if !m.enabled(ctx.cfg.features) {
                continue;
            }
            for g in m.goals(ctx) {
                let key = goal_key(&g.goal);
                cands.push(Cand {
                    decision: GoalDecision {
                        utility: g.utility.max(0.),
                        ..g
                    },
                    key,
                });
            }
        }
        let mut live: Vec<Cand> = dedupe(
            cands
                .into_iter()
                .filter(|c| !self.is_excluded(&c.key, now))
                .collect(),
        );
        if live.is_empty() {
            live.push(Cand {
                decision: GoalDecision {
                    goal: Goal::Hold {
                        at: ctx.p.self_.pos(),
                        why: HoldWhy::Wait,
                    },
                    utility: WAIT_U,
                    why: "nothing to do".into(),
                    choice: None,
                },
                key: "hold:wait".into(),
            });
        }
        self.last = live.iter().map(|c| c.decision.clone()).collect();
        let cur_key = goal_key(current);
        let cur = live.iter().position(|c| c.key == cur_key);
        let chosen_idx = if let Some(cur) = cur {
            if current.kind() == GoalKind::Fight
                && status.state != GoalState::Done
                && status.state != GoalState::Failed
                && hunt_from(&hunt).is_none()
                && now - self.goal_since < ctx.cfg.tier.attention.reconsider_ms
            {
                cur
            } else {
                self.pick_or_hysteresis(ctx, &live, cur, current)
            }
        } else {
            self.pick_or_hysteresis(ctx, &live, usize::MAX, current)
        };
        let chosen = clone_cand(&live[chosen_idx]);
        if !matches!(chosen.decision.goal, Goal::Farm { .. })
            && self.adapter.as_ref().and_then(|a| a.target()).is_some()
        {
            self.adapter.as_mut().expect("adapter present").release(ctx);
        }
        let kept = chosen.key == cur_key;
        let returned_current = kept && goal_json_eq(&chosen.decision.goal, current);
        self.returned_current = returned_current;
        let goal = if returned_current {
            current.clone()
        } else {
            chosen.decision.goal.clone()
        };
        let out = GoalDecision {
            goal,
            utility: chosen.decision.utility,
            why: if kept {
                format!("keeping: {}", chosen.decision.why)
            } else {
                chosen.decision.why.clone()
            },
            choice: if kept || chosen.decision.choice.is_none() {
                None
            } else {
                chosen.decision.choice.clone()
            },
        };
        out
    }

    fn pick_or_hysteresis(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        live: &[Cand],
        cur: usize,
        current: &Goal,
    ) -> usize {
        let (chosen, _) = source_pick_option(
            ctx.decide,
            ctx.lapse,
            &live.iter().map(|c| c.decision.utility).collect::<Vec<_>>(),
            ctx.cfg.tier.softmax_t,
            ctx.cfg.tier.lapse_p,
        );
        let mut chosen = chosen.min(live.len().saturating_sub(1));
        let idling = matches!(current, Goal::Idle)
            || matches!(
                current,
                Goal::Hold {
                    why: HoldWhy::Wait,
                    ..
                }
            );
        if let Some(cur_idx) = (cur < live.len()).then_some(cur) {
            if !idling
                && chosen != cur_idx
                && live[chosen].decision.utility < live[cur_idx].decision.utility + HYSTERESIS
            {
                chosen = cur_idx;
            }
        }
        chosen
    }

    fn sync(&mut self, current: &Goal, now: f64) {
        let key = goal_key(current);
        if key != self.current_key {
            self.current_key = key;
            self.goal_since = now;
        }
    }

    fn settle(&mut self, current: &Goal, status: &GoalStatus, now: f64) {
        self.excluded.retain(|(_, until)| *until > now);
        self.loot_skip.retain(|(_, until)| *until > now);
        if status.state == GoalState::Failed
            || (status.state == GoalState::Done && !matches!(current, Goal::Flee { .. }))
        {
            self.excluded.push((
                goal_key(current),
                now + if status.state == GoalState::Failed {
                    EXCLUDE_FAILED_MS
                } else {
                    EXCLUDE_DONE_MS
                },
            ));
            if status.state == GoalState::Failed && matches!(current, Goal::Flee { .. }) {
                self.flee_ban_until = now + FLEE_BAN_MS;
            }
            if status.state == GoalState::Failed {
                if let Goal::Loot { container } = current {
                    self.loot_skip.push((container.clone(), now + LOOT_SKIP_MS));
                }
            }
        }
        if let Goal::Loot { container } = current {
            if now - self.goal_since > LOOT_BUDGET_MS {
                self.loot_skip.push((container.clone(), now + LOOT_SKIP_MS));
            }
        }
    }

    fn is_excluded(&self, key: &str, now: f64) -> bool {
        self.excluded
            .iter()
            .any(|(k, until)| k == key && *until > now)
    }

    fn scored(
        &self,
        ctx: &StrategyContext<'_>,
        goal: Goal,
        base: f64,
        why: impl Into<String>,
        choice: Option<String>,
    ) -> Cand {
        let mut utility = base;
        if let Some(choice) = &choice {
            if ctx.cfg.learned.enabled() {
                let bias = ctx.cfg.learned.bias(choice);
                utility += LEARN_WEIGHT
                    * clamp(
                        if bias.is_finite() { bias } else { 0. },
                        -LEARN_CAP,
                        LEARN_CAP,
                    );
            }
        }
        let key = goal_key(&goal);
        Cand {
            decision: GoalDecision {
                goal,
                utility: clamp(utility, 0., MAX_UTILITY),
                why: why.into(),
                choice,
            },
            key,
        }
    }

    fn flee(
        &mut self,
        ctx: &StrategyContext<'_>,
        current: &Goal,
        retreat_from: Option<&[Vec2]>,
        enemies: &[Enemy],
    ) -> Option<Cand> {
        let now = ctx.p.now;
        if now < self.flee_ban_until {
            return None;
        }
        let me = &ctx.p.self_;
        let persona = ctx.cfg.persona;
        let hp = me.hp_share();
        let was_fleeing = matches!(current, Goal::Flee { .. });
        let radius = if was_fleeing { FLEE_KEEP } else { FLEE_NEAR };
        let mut threats: Vec<Vec2> = Vec::new();
        for e in enemies {
            if e.visible && e.dist <= radius {
                threats.push(e.pos);
            }
        }
        for h in &ctx.mem.self_memory().recent_hits {
            if h.by.is_none() || now - h.t > FLEE_HIT_MS {
                continue;
            }
            if let Some(at) = position_of(ctx, h.by.as_deref().unwrap_or_default()) {
                threats.push(at);
            }
        }
        threats.extend(self.awake_near(me.pos(), FLEE_MOB_NEAR, now));
        if let Some(from) = retreat_from {
            threats.extend_from_slice(from);
        }
        if threats.is_empty() {
            return None;
        }
        let hurt = hp < persona.flee_hp || (was_fleeing && hp < persona.reengage_hp);
        if !hurt && retreat_from.is_none() {
            return None;
        }
        if was_fleeing
            && now - self.goal_since > FLEE_GIVE_UP_MS
            && threats
                .iter()
                .any(|t| distance(*t, me.pos()) < ORBIT_MIN_DISTANCE)
        {
            self.flee_ban_until = now + FLEE_BAN_MS;
            return None;
        }
        let depth = clamp01(1. - hp / persona.flee_hp);
        let threat_count = threats.len();
        let from = threats.into_iter().take(6).collect::<Vec<_>>();
        Some(self.scored(
            ctx,
            Goal::Flee {
                from,
                until: now + FLEE_MIN_MS + FLEE_SPAN_MS * depth,
            },
            FLEE_U + FLEE_DEPTH_U * depth,
            format!(
                "hp {}% below {}%, {} threat(s)",
                (hp * 100.).round() as i64,
                (persona.flee_hp * 100.).round() as i64,
                threat_count
            ),
            None,
        ))
    }

    fn evade(
        &self,
        ctx: &StrategyContext<'_>,
        current: &Goal,
        enemies: &[Enemy],
        hunts: &[Cand],
        fight: Option<&Cand>,
    ) -> Option<Cand> {
        let r0 = ctx.cfg.tier.wary;
        if r0 <= 0.
            || fight.is_some()
            || ctx.engaged
            || ctx.p.now < self.flee_ban_until
            || ctx.p.hud.gates_locked
        {
            return None;
        }
        let r = if matches!(current, Goal::Flee { .. }) {
            r0 + EVADE_HYSTERESIS
        } else {
            r0
        };
        let wanted: Vec<&str> = hunts
            .iter()
            .filter_map(|c| match &c.decision.goal {
                Goal::Hunt { target } => Some(target.as_str()),
                _ => None,
            })
            .collect();
        let mut from = Vec::new();
        for e in enemies {
            if !e.visible
                || e.dist > r
                || !e.targetable
                || e.immune
                || wanted.contains(&e.id.as_str())
            {
                continue;
            }
            let chasing = lookup(ctx.mem.fighters(), &e.id).is_some_and(|m| m.chasing_me);
            if chasing || e.dist < EVADE_CLOSE_SHARE * r {
                from.push(e.pos);
            }
        }
        if from.is_empty() {
            return None;
        }
        let threat_count = from.len();
        Some(self.scored(
            ctx,
            Goal::Flee {
                from: from.into_iter().take(4).collect(),
                until: ctx.p.now + EVADE_KEEP_MS,
            },
            EVADE_U,
            format!("keeping away from {threat_count} player(s) it does not want to fight"),
            None,
        ))
    }

    fn fight(&self, ctx: &StrategyContext<'_>, current: &Goal, enemies: &[Enemy]) -> Option<Cand> {
        let me = &ctx.p.self_;
        let mut target: Option<&Enemy> = None;
        if ctx.engaged {
            if let Some(id) = &me.attack_target {
                target = enemies.iter().find(|e| &e.id == id && e.visible);
            }
            if target.is_none() {
                let mut hits = ctx.mem.self_memory().recent_hits.clone();
                hits.sort_by(|a, b| b.t.total_cmp(&a.t));
                for h in hits {
                    if let Some(by) = h.by {
                        target = enemies.iter().find(|e| e.id == by && e.visible);
                        if target.is_some() {
                            break;
                        }
                    }
                }
            }
        }
        if target.is_none() {
            if let Goal::Fight {
                target: current_target,
            } = current
            {
                target = enemies
                    .iter()
                    .find(|e| &e.id == current_target && e.visible && e.dist < TARGET_RANGE);
            }
        }
        let target = target?;
        Some(self.scored(
            ctx,
            Goal::Fight {
                target: target.id.clone(),
            },
            FIGHT_U,
            format!("trading blows with {}", target.id),
            None,
        ))
    }

    fn farm(&self, ctx: &StrategyContext<'_>, mob_id: &str) -> Option<Cand> {
        let me = &ctx.p.self_;
        let m = lookup(ctx.mem.mobs(), mob_id);
        let persona = ctx.cfg.persona;
        let reward = reward_curve(feed_score(me.kills, me.mob_kills));
        let mut base = persona.pve * (0.5 + 0.4 * reward);
        if m.is_some_and(|m| m.kind == "elite") {
            base *= 0.55 + 0.45 * persona.elite_appetite;
        }
        let first =
            me.mob_kills == 0. && !ctx.mem.choices().iter().any(|k| k.starts_with("opener|"));
        let choice = if first && me.faction.is_some() {
            m.and_then(|m| m.faction).map(|f| {
                format!(
                    "opener|{}|{}",
                    faction_str(me.faction.expect("checked")),
                    faction_str(f)
                )
            })
        } else {
            None
        };
        Some(self.scored(
            ctx,
            Goal::Farm {
                mob: mob_id.to_string(),
                camp: m.and_then(|m| m.camp_id.clone()),
            },
            base,
            format!(
                "{} {}, reward {:.2}",
                m.and_then(|m| m.faction).map_or("?", faction_str),
                m.map_or("mob", |m| m.kind.as_str()),
                reward
            ),
            choice,
        ))
    }

    fn hunts(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        enemies: &[Enemy],
        mode: &str,
        fight_target: Option<&str>,
    ) -> Vec<Cand> {
        let persona = ctx.cfg.persona;
        let me = &ctx.p.self_;
        let hp_ready = healthy_hp(me, persona);
        let mut out = Vec::new();
        let mut avoided: Option<Enemy> = None;
        for e in enemies {
            if fight_target == Some(e.id.as_str()) || e.immune || !e.targetable {
                continue;
            }
            if !e.visible && e.age > REMEMBERED_HUNT_MS {
                continue;
            }
            if self.avoid_id.as_deref() == Some(e.id.as_str())
                && ctx.p.now < self.avoid_until
                && e.dist >= ORBIT_MIN_DISTANCE
            {
                avoided = Some(e.clone());
                continue;
            }
            let odds = odds(ctx.know, me, e);
            if let Some(c) = self.hunt_cand(ctx, e, &odds, mode, hp_ready) {
                out.push(c);
            }
        }
        if out.is_empty() {
            if let Some(e) = avoided {
                let odds = odds(ctx.know, me, &e);
                if let Some(c) = self.hunt_cand(ctx, &e, &odds, mode, hp_ready) {
                    out.push(c);
                }
            }
        }
        out.sort_by(|a, b| b.decision.utility.total_cmp(&a.decision.utility));
        out.truncate(3);
        out
    }

    fn appraise(&mut self, ctx: &mut StrategyContext<'_>, e: &Enemy, odds: &FightOdds) -> f64 {
        let a = ctx.cfg.tier.appraisal;
        let me = &ctx.p.self_;
        let mine = me.hp_share();
        let judged = self.judged.iter_mut().find(|(id, _, _)| id == &e.id);
        let z = match judged {
            Some((_, until, z)) if *until > ctx.p.now => *z,
            Some((_, until, z)) => {
                let fresh = source_gaussian(ctx.decide, 0., 1.);
                *until = ctx.p.now + JUDGE_KEEP_MS;
                *z = fresh;
                fresh
            }
            None => {
                let fresh = source_gaussian(ctx.decide, 0., 1.);
                self.judged
                    .push((e.id.clone(), ctx.p.now + JUDGE_KEEP_MS, fresh));
                fresh
            }
        };
        a.bias
            + a.lead * (mine - e.hp_frac)
            + a.busy * (BUSY_BASE + ctx.cfg.persona.third_party) * e.cue
            + a.hue * odds.score
            + a.noise * z
    }

    fn hunt_cand(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        e: &Enemy,
        odds: &FightOdds,
        mode: &str,
        hp_ready: f64,
    ) -> Option<Cand> {
        let persona = ctx.cfg.persona;
        let bounty_share = clamp01(e.bounty / BOUNTY_FULL);
        let fresh = if e.visible {
            1.
        } else {
            STALE_FACTOR * (1. - e.age / REMEMBERED_HUNT_MS)
        };
        let goal = Goal::Hunt {
            target: e.id.clone(),
        };
        if mode == "sd" {
            let u = (0.6 + 0.25 * (1. - e.hp_frac) + 0.1 * (1. - (e.dist / 800.).min(1.))) * fresh;
            return Some(self.scored(
                ctx,
                goal,
                HUNT_CAP.min(u),
                format!(
                    "sudden death: {} at {}% hp",
                    e.id,
                    (e.hp_frac * 100.).round() as i64
                ),
                None,
            ));
        }
        let logit = self.appraise(ctx, e, odds);
        let since_start = ctx.p.now - ctx.p.hud.raid_started_at;
        let timer_left = if ctx.p.hud.patience_ends_at > 0. {
            ctx.p.hud.patience_ends_at - ctx.p.now
        } else {
            f64::INFINITY
        };
        let opening = if since_start < OPENING_MS {
            OPENING_LOGIT
                * (1. - since_start.max(0.) / OPENING_MS)
                * clamp(
                    (timer_left - OPENING_TIMER_FREE_MS) / OPENING_TIMER_SPAN_MS,
                    0.,
                    1.,
                )
        } else {
            0.
        };
        let needed = persona.engage_edge
            + opening
            + if ctx.p.self_.bounty > 0. {
                persona.bounty_caution
            } else {
                0.
            }
            - BOUNTY_LOGIT_RELIEF * persona.bounty * bounty_share;
        let surplus = logit - needed;
        if surplus <= 0. {
            return None;
        }
        let gate = 1. - math::exp(-HUNT_SHARPNESS * surplus);
        let mut u = persona.pvp * gate * hp_ready * (1. - 0.3 * (e.dist / 800.).min(1.)) * fresh;
        u += (0.25 * persona.bounty * bounty_share + 0.2 * persona.third_party * e.cue)
            * if e.visible { 1. } else { 0.7 };
        Some(self.scored(
            ctx,
            goal,
            HUNT_CAP.min(u),
            format!(
                "{}: {}% to win, wants {}%{}",
                e.id,
                (100. / (1. + math::exp(-logit))).round() as i64,
                (100. / (1. + math::exp(-needed))).round() as i64,
                if e.cue > 0. { ", third party" } else { "" }
            ),
            None,
        ))
    }

    fn last_seen(&self, ctx: &StrategyContext<'_>, enemies: &[Enemy]) -> Option<Cand> {
        let persona = ctx.cfg.persona;
        let mut best: Option<Cand> = None;
        for e in enemies {
            if e.visible || e.age <= REMEMBERED_HUNT_MS || e.dist < ARRIVED || persona.pvp < 0.9 {
                continue;
            }
            let u = HUNT_CAP
                .min(0.45 * persona.bounty * clamp01(e.bounty / BOUNTY_FULL) + 0.15 * persona.pvp);
            let c = self.scored(
                ctx,
                Goal::Roam {
                    to: e.pos,
                    why: RoamWhy::LastSeen,
                },
                u,
                format!(
                    "{} last seen {} s ago",
                    e.id,
                    (e.age / 1000.).round() as i64
                ),
                None,
            );
            if best
                .as_ref()
                .is_none_or(|b| c.decision.utility > b.decision.utility)
            {
                best = Some(c);
            }
        }
        best
    }

    fn loot(&self, ctx: &StrategyContext<'_>, enemies: &[Enemy]) -> Vec<Cand> {
        let me = &ctx.p.self_;
        let now = ctx.p.now;
        let persona = ctx.cfg.persona;
        if ctx.engaged {
            return Vec::new();
        }
        let carried: Vec<rh_sim::WeaponId> = me.weapons.iter().flatten().copied().collect();
        let nearest = enemies
            .iter()
            .filter(|e| e.visible)
            .map(|e| e.dist)
            .fold(f64::INFINITY, f64::min);
        if nearest < LOOT_ENEMY_NEAR || !self.awake_near(me.pos(), LOOT_MOB_NEAR, now).is_empty() {
            return Vec::new();
        }
        let early = now - ctx.p.hud.raid_started_at <= LOOT_EARLY_MS;
        #[derive(Clone)]
        struct Seen {
            id: String,
            kind: String,
            pos: Vec2,
            closed: bool,
            weapon: super::super::memory::ContainersWeapon,
            seen_at: f64,
            visible: bool,
        }
        let mut all: Vec<Seen> = Vec::new();
        for (id, c) in ctx.mem.containers() {
            if c.skipped {
                all.retain(|s| &s.id != id);
                continue;
            }
            let row = Seen {
                id: id.clone(),
                kind: c.kind.clone(),
                pos: c.pos,
                closed: c.closed,
                weapon: c.weapon,
                seen_at: c.seen_at,
                visible: false,
            };
            if let Some(pos) = all.iter().position(|s| &s.id == id) {
                all[pos] = row;
            } else {
                all.push(row);
            }
        }
        for c in &ctx.p.containers {
            if lookup(ctx.mem.containers(), &c.id).is_some_and(|m| m.skipped) {
                continue;
            }
            let row = Seen {
                id: c.id.clone(),
                kind: c.kind.clone(),
                pos: Vec2::new(c.x, c.y),
                closed: c.closed,
                weapon: c.weapon,
                seen_at: now,
                visible: true,
            };
            if let Some(pos) = all.iter().position(|s| s.id == c.id) {
                all[pos] = row;
            } else {
                all.push(row);
            }
        }
        let counter = |w: rh_sim::WeaponId| -> f64 {
            let mut sum = 0.;
            let mut n = 0.;
            for e in enemies {
                let theirs = e.snap.in_hand.or(e.snap.other_slot);
                let Some(theirs) = theirs else {
                    continue;
                };
                sum += f64::from(ctx.know.weapon_edge(super::types::to_bot_weapon(w), theirs));
                n += 1.;
            }
            if n == 0. {
                0.
            } else {
                sum / n
            }
        };
        let held_best = if carried.is_empty() {
            -1.
        } else {
            carried
                .iter()
                .map(|w| counter(*w))
                .fold(f64::NEG_INFINITY, f64::max)
        };
        let mut out = Vec::new();
        for c in all {
            if !c.closed || matches!(c.weapon, super::super::memory::ContainersWeapon::Null) {
                continue;
            }
            if self.loot_skip.iter().any(|(id, _)| id == &c.id) {
                continue;
            }
            if c.kind == "ground" && !c.visible && now - c.seen_at > 60_000. {
                continue;
            }
            let reach = match c.kind.as_str() {
                "ground" => LOOT_GROUND_RADIUS,
                "body" => LOOT_CHEST_RADIUS,
                "chest" if early => LOOT_CHEST_RADIUS,
                _ => 0.,
            };
            let d = distance(me.pos(), c.pos);
            if d >= reach {
                continue;
            }
            if enemies.iter().any(|e| distance(e.pos, c.pos) < d) {
                continue;
            }
            let (base, choice) = match c.weapon {
                super::super::memory::ContainersWeapon::Undefined => {
                    if carried.len() >= 2 {
                        continue;
                    }
                    (0.3, None)
                }
                super::super::memory::ContainersWeapon::Weapon(w) => {
                    if carried.contains(&w) {
                        continue;
                    }
                    let k = counter(w);
                    if carried.len() < 2 {
                        let choice = if carried.len() == 1 {
                            me.faction.map(|faction| {
                                format!("second|{}|{}", faction_str(faction), weapon_str(w))
                            })
                        } else {
                            None
                        };
                        (0.5 + 0.35 * k, choice)
                    } else {
                        if k <= 0.34 || k < held_best + 0.3 {
                            continue;
                        }
                        (0.35 + 0.3 * (k - held_best), None)
                    }
                }
                super::super::memory::ContainersWeapon::Null => continue,
            };
            let u = persona.loot * base * (1. - 0.5 * (d / reach))
                + if early && carried.len() < 2 {
                    0.1 * persona.loot
                } else {
                    0.
                };
            let kind_weapon = match c.weapon {
                super::super::memory::ContainersWeapon::Weapon(w) => weapon_str(w).to_string(),
                _ => "?".into(),
            };
            out.push(self.scored(
                ctx,
                Goal::Loot {
                    container: c.id.clone(),
                },
                u.min(0.8),
                format!("{} in {} {} u away", kind_weapon, c.kind, d.round() as i64),
                choice,
            ));
        }
        out.sort_by(|a, b| b.decision.utility.total_cmp(&a.decision.utility));
        out.truncate(2);
        out
    }

    fn camps(&mut self, ctx: &mut StrategyContext<'_>) -> Vec<Cand> {
        let me = &ctx.p.self_;
        let persona = ctx.cfg.persona;
        let Some(faction) = me.faction else {
            return Vec::new();
        };
        if me.mob_kills >= persona.mob_kill_goal
            || (me.max_hp > 0. && me.hp_share() < (0.5f64).max(persona.flee_hp + 0.05))
        {
            return Vec::new();
        }
        let first = !ctx.mem.choices().iter().any(|k| k.starts_with("opener|"));
        let mut near: Vec<(usize, f64)> = ctx
            .cfg
            .map
            .camps
            .iter()
            .enumerate()
            .map(|(index, camp)| (index, distance(me.pos(), Vec2::new(camp.x, camp.y))))
            .collect();
        near.sort_by(|a, b| a.1.total_cmp(&b.1));
        near.truncate(ctx.cfg.tier.route.horizon as usize);
        let planned = self.route_next.map_or(u32::MAX, |st| st.camp);
        if planned != u32::MAX && !near.iter().any(|(i, _)| *i as u32 == planned) {
            if let Some(camp) = ctx.cfg.map.camps.get(planned as usize) {
                near.push((
                    planned as usize,
                    distance(me.pos(), Vec2::new(camp.x, camp.y)),
                ));
            }
        }
        let mut out = Vec::new();
        let mut walks = 0u32;
        for (index, d) in near {
            let Some(camp) = ctx.cfg.map.camps.get(index) else {
                continue;
            };
            let cm = lookup(ctx.mem.camps(), &camp.id);
            let on_route = index as u32 == planned;
            if cm.is_some_and(|c| c.cleared_at.is_some()) && !on_route {
                continue;
            }
            let elite = camp.elite_spot >= 0.;
            let type_ = ctx
                .p
                .extras
                .camps
                .as_ref()
                .and_then(|views| views.iter().find(|v| v.index == index))
                .and_then(|v| v.type_.as_deref());
            let theirs = camp_weapon(camp.zone, type_);
            if (is_ranged(theirs) && !carries_ranged(&me.weapons))
                || best_edge(&me.weapons, theirs) <= -2
                || (elite && best_edge(&me.weapons, theirs) < 0)
            {
                continue;
            }
            if d < camp.r {
                continue;
            }
            let share = ctx.know.mob_share(faction, camp.zone, elite);
            if share < if elite { 0.6 } else { 0.5 } {
                continue;
            }
            let mut walk = d * 1.3;
            if ctx.cfg.tier.route.walk_paths && walks < CAMP_MAX_WALKS {
                walks += 1;
                if ctx
                    .paths
                    .walk(me.pos(), Vec2::new(camp.x, camp.y))
                    .is_none()
                {
                    continue;
                }
                walk = ctx
                    .paths
                    .walk(me.pos(), Vec2::new(camp.x, camp.y))
                    .map_or(walk, |w| w.dist);
            }
            let value = 0.3 + 0.4 * share + 0.25 * (1. - (walk / ctx.cfg.map.span()).min(1.));
            let mut u = persona.pve * CAMP_ROAM_FACTOR * value;
            if elite {
                u *= 0.55 + 0.45 * persona.elite_appetite;
            }
            if cm.is_some_and(|c| c.contested_at.is_some_and(|t| ctx.p.now - t < 20_000.)) {
                u *= 0.7;
            }
            if self.route.is_some() {
                u *= if on_route { ROUTE_BOOST } else { OFF_ROUTE };
            }
            let why = if cm.is_none_or(|c| c.visited_at.is_none()) {
                RoamWhy::Explore
            } else {
                RoamWhy::Camp
            };
            let choice = if first {
                Some(format!(
                    "opener|{}|{}",
                    faction_str(faction),
                    faction_str(camp.zone)
                ))
            } else {
                None
            };
            out.push(self.scored(
                ctx,
                Goal::Roam {
                    to: Vec2::new(camp.x, camp.y),
                    why,
                },
                u,
                format!(
                    "{} ({}), share {:.2}",
                    camp.id,
                    faction_str(camp.zone),
                    share
                ),
                choice,
            ));
        }
        out.sort_by(|a, b| b.decision.utility.total_cmp(&a.decision.utility));
        out.truncate(2);
        out
    }

    fn plan_route(&mut self, ctx: &mut StrategyContext<'_>) {
        let me = &ctx.p.self_;
        let Some(faction) = me.faction else {
            self.route_next = None;
            return;
        };
        let views = ctx.p.extras.camps.as_ref();
        if ctx.p.hud.in_coliseum || views.is_none_or(|v| v.is_empty()) {
            self.route_next = None;
            return;
        }
        let views = views.expect("checked");
        let prefix = format!("{}:", faction_str(faction));
        if self
            .route
            .as_ref()
            .is_none_or(|r| !r.build.id.starts_with(&prefix))
        {
            self.route = Some(BuildRoute::new(
                faction,
                unit_hash(ctx.cfg.seed, &ctx.cfg.id),
            ));
        }
        let mut camps = Vec::new();
        for v in views {
            let Some(def) = ctx.cfg.map.camps.get(v.index) else {
                continue;
            };
            let mob_type = v
                .type_
                .as_deref()
                .and_then(rh_sim::mob_catalog::mob_type_by_id)
                .map_or_else(String::new, |t| t.id.as_str().to_string());
            camps.push(RouteCamp {
                index: v.index as u32,
                id: def.id.clone(),
                zone: def.zone,
                x: def.x,
                y: def.y,
                r: def.r,
                elite: def.elite_spot >= 0.,
                spots: def.spots,
                mob_type,
                alive: v.alive,
                state: v.state,
                respawn_at: v.respawn_at.unwrap_or(0.),
            });
        }
        let players: Vec<Vec2> = ctx
            .p
            .fighters
            .iter()
            .filter(|f| f.status == "alive")
            .map(|f| f.pos())
            .collect();
        let speed = PLAYER_SPEED
            * if me.speed_mult > 0. {
                me.speed_mult
            } else {
                1.
            };
        let weapons = me.weapons;
        let know = ctx.know;
        let can_farm = |c: &RouteCamp| -> bool {
            let Some(def) = ctx.cfg.map.camps.get(c.index as usize) else {
                return false;
            };
            let theirs = camp_weapon(
                def.zone,
                if c.mob_type.is_empty() {
                    None
                } else {
                    Some(c.mob_type.as_str())
                },
            );
            if is_ranged(theirs) && !carries_ranged(&weapons) {
                return false;
            }
            let edge = best_edge(&weapons, theirs);
            if edge <= -2 || (c.elite && edge < 0) {
                return false;
            }
            know.mob_share(faction, c.zone, c.elite) >= if c.elite { 0.6 } else { 0.5 }
        };
        let inp = RouteInput {
            now: ctx.p.now,
            run_ms: ctx.p.now - ctx.p.hud.raid_started_at,
            self_pos: me.pos(),
            speed,
            mob_kills: me.mob_kills,
            power: me.power,
            camps: &camps,
            players: &players,
            can_farm: &can_farm,
        };
        let route = self.route.as_mut().expect("route created");
        self.route_next = route.update(&inp);
    }

    fn patience_dash(&self, ctx: &StrategyContext<'_>) -> Option<Cand> {
        let left = ctx.p.hud.patience_ends_at - ctx.p.now;
        if ctx.p.hud.patience_ends_at <= 0.
            || left <= 0.
            || left > PATIENCE_DASH_MS
            || ctx.p.hud.gates_locked
        {
            return None;
        }
        let to = ctx.cfg.map.coliseum.centre;
        if distance(ctx.p.self_.pos(), to) < ARRIVED {
            return None;
        }
        Some(self.scored(
            ctx,
            Goal::Roam {
                to,
                why: RoamWhy::Coliseum,
            },
            COLISEUM_ROAM_U,
            format!("patience ends in {} s", (left / 1000.).round() as i64),
            None,
        ))
    }

    fn patrol(&self, ctx: &StrategyContext<'_>) -> Option<Cand> {
        let mut best: Option<(Vec2, String, f64)> = None;
        for camp in &ctx.cfg.map.camps {
            let at = Vec2::new(camp.x, camp.y);
            let d = distance(ctx.p.self_.pos(), at);
            if d < camp.r + ARRIVED {
                continue;
            }
            let visited = lookup(ctx.mem.camps(), &camp.id).and_then(|c| c.visited_at);
            let age = visited.map_or(PATROL_AGE_FULL_MS, |t| ctx.p.now - t);
            if age < PATROL_REVISIT_MS {
                continue;
            }
            let score = (age / PATROL_AGE_FULL_MS).min(1.) - d / (2. * ctx.cfg.map.span());
            if best.as_ref().is_none_or(|(_, _, s)| score > *s) {
                best = Some((at, camp.id.clone(), score));
            }
        }
        let (at, id, _) = best?;
        Some(self.scored(
            ctx,
            Goal::Roam {
                to: at,
                why: RoamWhy::Explore,
            },
            PATROL_U * self.healthy(ctx),
            format!("looking for people at {id}"),
            None,
        ))
    }

    fn healthy(&self, ctx: &StrategyContext<'_>) -> f64 {
        let me = &ctx.p.self_;
        let persona = ctx.cfg.persona;
        clamp(
            (me.hp_share() - persona.flee_hp) / (persona.reengage_hp - persona.flee_hp).max(0.01),
            HP_READY_FLOOR,
            1.,
        )
    }

    fn lie_low(&self, ctx: &StrategyContext<'_>) -> Option<Cand> {
        let h = self.healthy(ctx);
        if h >= 1. {
            return None;
        }
        let me = &ctx.p.self_;
        Some(self.scored(
            ctx,
            Goal::Hold {
                at: me.pos(),
                why: HoldWhy::Ambush,
            },
            LIE_LOW_U * (1. - h),
            format!(
                "hurt ({}% hp): lying low",
                (me.hp / me.max_hp.max(1.) * 100.).round() as i64
            ),
            None,
        ))
    }

    fn centre(&self, ctx: &StrategyContext<'_>) -> Option<Cand> {
        let to = ctx.cfg.map.centre();
        if distance(ctx.p.self_.pos(), to) < 2. * ARRIVED {
            return None;
        }
        Some(self.scored(
            ctx,
            Goal::Roam {
                to,
                why: RoamWhy::Centre,
            },
            CENTRE_ROAM_U,
            "nothing better to do",
            None,
        ))
    }

    fn coliseum(
        &mut self,
        ctx: &mut StrategyContext<'_>,
        current: &Goal,
        enemies: &[Enemy],
        sd: bool,
        fight_target: Option<&str>,
    ) -> Vec<Cand> {
        let persona = ctx.cfg.persona;
        let me = &ctx.p.self_;
        if sd {
            return self.hunts(ctx, enemies, "sd", fight_target);
        }
        let mut out = Vec::new();
        let cue = enemies.iter().map(|e| e.cue).fold(0., f64::max);
        if ctx.p.hud.alive > 2 && persona.coliseum < 1. {
            let since = ctx
                .mem
                .self_memory()
                .teleported_at
                .map_or(0., |t| ctx.p.now - t);
            let patience = (1.
                - since / (HOLD_PATIENCE_MS + HOLD_PATIENCE_SPAN_MS * (1. - persona.coliseum)))
                .max(0.);
            let u =
                (1. - persona.coliseum) * 0.85 * (1. - 0.8 * persona.third_party * cue) * patience;
            out.push(self.scored(
                ctx,
                Goal::Hold {
                    at: self.hold_spot(ctx, current, enemies),
                    why: HoldWhy::Coliseum,
                },
                u,
                format!("hold the ring (aggression {})", persona.coliseum),
                None,
            ));
        }
        for e in enemies {
            if fight_target == Some(e.id.as_str())
                || e.immune
                || !e.targetable
                || (!e.visible && e.age > REMEMBERED_HUNT_MS)
            {
                continue;
            }
            let edge = odds(ctx.know, me, e).edge;
            let bounty_share = clamp01(e.bounty / BOUNTY_FULL);
            let fresh = if e.visible {
                1.
            } else {
                STALE_FACTOR * (1. - e.age / REMEMBERED_HUNT_MS)
            };
            let u = (0.3
                + 0.55 * persona.coliseum * (0.5 + 0.5 * sigmoid(edge))
                + 0.25 * (1. - e.hp_frac)
                + 0.4 * persona.third_party * e.cue
                + 0.15 * persona.bounty * bounty_share)
                * fresh;
            out.push(self.scored(
                ctx,
                Goal::Hunt {
                    target: e.id.clone(),
                },
                HUNT_CAP.min(u),
                format!(
                    "coliseum: {} at {}% hp",
                    e.id,
                    (e.hp_frac * 100.).round() as i64
                ),
                None,
            ));
        }
        out.sort_by(|a, b| b.decision.utility.total_cmp(&a.decision.utility));
        out.truncate(4);
        let middle = ctx.cfg.map.coliseum.centre;
        if distance(me.pos(), middle) > 2. * ARRIVED {
            out.push(self.scored(
                ctx,
                Goal::Roam {
                    to: middle,
                    why: RoamWhy::Coliseum,
                },
                CENTRE_ROAM_U + 0.05 * persona.coliseum,
                "find the others",
                None,
            ));
        }
        out
    }

    fn hold_spot(&self, ctx: &StrategyContext<'_>, current: &Goal, enemies: &[Enemy]) -> Vec2 {
        let me = &ctx.p.self_;
        let others: Vec<Vec2> = enemies.iter().map(|e| e.pos).collect();
        let clearance = |pt: Vec2| {
            others
                .iter()
                .map(|o| distance(pt, *o))
                .fold(f64::INFINITY, f64::min)
        };
        if let Goal::Hold {
            at,
            why: HoldWhy::Coliseum,
        } = current
        {
            if clearance(*at) >= HOLD_SAFE {
                return *at;
            }
        }
        let mut best = me.pos();
        let mut best_score = clearance(best).min(600.);
        for s in &ctx.cfg.map.coliseum.inner_spawns {
            let score = clearance(*s).min(600.) - 0.35 * distance(me.pos(), *s);
            if score > best_score {
                best_score = score;
                best = *s;
            }
        }
        best
    }

    fn refresh_avoid(&mut self, ctx: &StrategyContext<'_>, enemies: &[Enemy]) {
        let Some(id) = self.avoid_id.clone() else {
            return;
        };
        let now = ctx.p.now;
        if now >= self.avoid_until {
            self.avoid_id = None;
            return;
        }
        let m = lookup(ctx.mem.fighters(), &id);
        let hit = m.is_some_and(|m| m.hit_me_at.is_some_and(|t| t >= self.avoid_since))
            || ctx
                .mem
                .self_memory()
                .recent_hits
                .iter()
                .any(|h| h.by.as_deref() == Some(id.as_str()) && h.t >= self.avoid_since);
        let close = enemies
            .iter()
            .any(|e| e.id == id && e.visible && e.dist < ORBIT_MIN_DISTANCE);
        if hit || close {
            self.avoid_id = None;
        }
    }

    fn track_chase(&mut self, ctx: &mut StrategyContext<'_>, current: &Goal, enemies: &[Enemy]) {
        let id = match current {
            Goal::Hunt { target } | Goal::Fight { target } => target.clone(),
            _ => {
                self.chase = None;
                return;
            }
        };
        let Some(e) = enemies.iter().find(|e| e.id == id) else {
            self.chase = None;
            return;
        };
        let now = ctx.p.now;
        let attacking = self.attacking(ctx);
        match &mut self.chase {
            Some(c) if c.id == e.id => {
                if attacking || e.dist < ORBIT_MIN_DISTANCE || e.dist < c.best - ORBIT_PROGRESS {
                    c.best = e.dist;
                    c.since = now;
                } else if now - c.since > c.limit {
                    self.log(&format!(
                        "chase of {} is going nowhere: turning on someone else",
                        e.id
                    ));
                    self.avoid_id = Some(e.id.clone());
                    self.avoid_since = now;
                    self.avoid_until = now + ORBIT_AVOID_MS;
                    self.chase = None;
                }
            }
            _ => {
                self.chase = Some(super::types::Chase {
                    id: e.id.clone(),
                    best: e.dist,
                    since: now,
                    limit: ctx.cfg.persona.chase_give_up_ms + ctx.decide.draw() * ORBIT_JITTER_MS,
                });
            }
        }
    }

    fn log_chase_placeholder(&self) {}
}

// ---------------------------------------------------------------------------------------------------------------- helpers

fn clone_cand(c: &Cand) -> Cand {
    Cand {
        decision: c.decision.clone(),
        key: c.key.clone(),
    }
}

fn hunt_from(decision: &HuntDecision) -> Option<&[Vec2]> {
    match decision {
        HuntDecision::Retreat { from, .. } => Some(from),
        _ => None,
    }
}

fn dedupe(cands: Vec<Cand>) -> Vec<Cand> {
    let mut best: Vec<Cand> = Vec::new();
    for c in cands {
        if let Some(pos) = best.iter().position(|old| old.key == c.key) {
            if c.decision.utility > best[pos].decision.utility {
                best[pos] = c;
            }
        } else {
            best.push(c);
        }
    }
    best
}

fn enemies_of(ctx: &StrategyContext<'_>) -> Vec<Enemy> {
    let now = ctx.p.now;
    let mut out = Vec::new();
    let mut on_screen: Vec<&str> = Vec::new();
    for f in &ctx.p.fighters {
        on_screen.push(f.id.as_str());
        if f.status != "alive" {
            continue;
        }
        let m = lookup(ctx.mem.fighters(), &f.id);
        let bounty = f.bounty.max(
            ctx.mem
                .bounties()
                .iter()
                .find(|(id, _)| id == &f.id)
                .map_or(0., |(_, b)| *b),
        );
        out.push(Enemy {
            id: f.id.clone(),
            pos: f.pos(),
            dist: f.dist,
            hp_frac: f.hp_frac,
            bounty,
            visible: true,
            immune: f.immune,
            targetable: f.targetable,
            age: 0.,
            cue: third_party_cue(ctx, m, &ctx.p.self_.id),
            snap: crate::bots::types::OpponentSnapshot {
                id: f.id.clone(),
                faction: f.faction,
                in_hand: f.in_hand.map(super::types::to_bot_weapon),
                other_slot: m
                    .and_then(|m| m.other_slot)
                    .map(super::types::to_bot_weapon),
                hp_frac: f.hp_frac,
                bounty: bounty.max(0.) as u32,
                dist: f.dist,
                tint: f.tint,
            },
        });
    }
    for (id, m) in ctx.mem.fighters() {
        if on_screen.contains(&id.as_str()) || !m.alive {
            continue;
        }
        let Some(w) = ctx.whereabouts(id, now) else {
            continue;
        };
        let d = distance(ctx.p.self_.pos(), w.at);
        let bounty = m.bounty.max(
            ctx.mem
                .bounties()
                .iter()
                .find(|(k, _)| k == id)
                .map_or(0., |(_, b)| *b),
        );
        out.push(Enemy {
            id: id.clone(),
            pos: w.at,
            dist: d,
            hp_frac: m.hp_frac,
            bounty,
            visible: false,
            immune: false,
            targetable: true,
            age: (now - m.seen_at).max(0.),
            cue: third_party_cue(ctx, Some(m), &ctx.p.self_.id),
            snap: crate::bots::types::OpponentSnapshot {
                id: id.clone(),
                faction: m.faction,
                in_hand: m.in_hand.map(super::types::to_bot_weapon),
                other_slot: m.other_slot.map(super::types::to_bot_weapon),
                hp_frac: m.hp_frac,
                bounty: bounty.max(0.) as u32,
                dist: d,
                tint: 0.,
            },
        });
    }
    out
}

fn third_party_cue(
    ctx: &StrategyContext<'_>,
    m: Option<&super::super::memory::FighterMemory>,
    self_id: &str,
) -> f64 {
    let Some(m) = m else {
        return 0.;
    };
    let (Some(with), Some(at)) = (m.engaged_with.as_deref(), m.engaged_at) else {
        return 0.;
    };
    if with == self_id {
        return 0.;
    }
    let age = ctx.p.now - at;
    if age > THIRD_PARTY_MS {
        return 0.;
    }
    if lookup(ctx.mem.fighters(), with).is_some_and(|other| !other.alive) {
        return 0.;
    }
    1. - age / THIRD_PARTY_MS
}

fn position_of(ctx: &StrategyContext<'_>, id: &str) -> Option<Vec2> {
    if let Some(f) = ctx.p.fighters.iter().find(|f| f.id == id) {
        return Some(f.pos());
    }
    if let Some(m) = ctx.p.mobs.iter().find(|m| m.id == id) {
        return Some(Vec2::new(m.x, m.y));
    }
    lookup(ctx.mem.fighters(), id)
        .map(|m| m.pos)
        .or_else(|| lookup(ctx.mem.mobs(), id).map(|m| m.pos))
}

fn distance(a: Vec2, b: Vec2) -> f64 {
    math::hypot(a.x - b.x, a.y - b.y)
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    hi.min(lo.max(v))
}

fn clamp01(v: f64) -> f64 {
    clamp(v, 0., 1.)
}

fn sigmoid(x: f64) -> f64 {
    1. / (1. + math::exp(-x))
}

fn feed_score(player_kills: f64, mob_kills: f64) -> f64 {
    player_kills + FEED_MOB_KILL_WEIGHT * mob_kills
}

fn reward_curve(feed: f64) -> f64 {
    MOB_REWARD_FLOOR
        + (1. - MOB_REWARD_FLOOR) * (1. - sigmoid((feed - MOB_REWARD_MID) / MOB_REWARD_WIDTH))
}

fn healthy_hp(me: &StrategySelf, persona: &crate::bots::types::PersonaParams) -> f64 {
    clamp(
        (me.hp_share() - persona.flee_hp) / (persona.reengage_hp - persona.flee_hp).max(0.01),
        HP_READY_FLOOR,
        1.,
    )
}

fn carries_ranged(weapons: &[Option<rh_sim::WeaponId>; 2]) -> bool {
    weapons.iter().flatten().any(|w| is_ranged(*w))
}

fn camp_weapon(zone: FactionId, type_: Option<&str>) -> rh_sim::WeaponId {
    mob_catalog::mob_type_weapon(zone, type_)
}

fn faction_str(f: FactionId) -> &'static str {
    f.as_str()
}

fn weapon_str(w: rh_sim::WeaponId) -> &'static str {
    w.as_str()
}

fn unit_hash(seed: u32, id: &str) -> f64 {
    let mut h = seed ^ 0x811c_9dc5;
    for code in id.encode_utf16() {
        h = (h ^ u32::from(code)).wrapping_mul(0x0100_0193);
    }
    f64::from(h) / 4_294_967_296.
}

fn threats_count(_v: &[Vec2]) -> usize {
    0
}

fn clone_cand_opt(c: &Option<Cand>) -> Option<Cand> {
    c.as_ref().map(clone_cand)
}

fn push_opt(dst: &mut Vec<Cand>, c: Option<Cand>) {
    if let Some(c) = c {
        dst.push(c);
    }
}

fn source_gaussian(rng: &mut dyn RngStream, mu: f64, sigma: f64) -> f64 {
    let u1 = rng.draw().max(1e-12);
    let u2 = rng.draw();
    mu + sigma * math::sqrt(-2. * crate::bots::random::ln(u1)) * math::cos(2. * math::PI * u2)
}

fn source_softmax_index(rng: &mut dyn RngStream, utilities: &[f64], temperature: f64) -> usize {
    if utilities.is_empty() {
        return usize::MAX;
    }
    let mut best = 0usize;
    for i in 1..utilities.len() {
        if utilities[i] > utilities[best] {
            best = i;
        }
    }
    if temperature <= 0. || utilities.len() == 1 {
        return best;
    }
    let top = utilities[best];
    let weights: Vec<f64> = utilities
        .iter()
        .map(|u| math::exp((u - top) / temperature))
        .collect();
    let sum: f64 = weights.iter().sum();
    let mut r = rng.draw() * sum;
    for (i, w) in weights.iter().enumerate() {
        r -= *w;
        if r <= 0. {
            return i;
        }
    }
    best
}

fn source_pick_option(
    rng: &mut dyn RngStream,
    lapse: &mut dyn RngStream,
    utilities: &[f64],
    temperature: f64,
    lapse_p: f64,
) -> (usize, bool) {
    let n = utilities.len();
    if n == 0 {
        return (usize::MAX, false);
    }
    if n > 1 && lapse.draw() < lapse_p {
        let mut order: Vec<(f64, usize)> = utilities.iter().copied().zip(0..n).collect();
        order.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        order.truncate(3);
        let k = ((lapse.draw() * order.len() as f64).floor() as usize).min(order.len() - 1);
        return (order[k].1, true);
    }
    (source_softmax_index(rng, utilities, temperature), false)
}
