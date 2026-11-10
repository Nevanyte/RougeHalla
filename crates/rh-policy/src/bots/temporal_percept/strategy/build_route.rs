//! Stateful source BuildRoute (buildRoute.ts): build choice, greedy route, contests, zone memory and replanning.
//! The static build table, value/type-weight and elite-readiness leaves are the existing source-derived pure helpers.
use super::types::{RouteCamp, RouteStep};
use crate::bots::build_route::{
    build_of, ready_for_elites, type_weight, BuildGoal, CLEAR_MS_ELITE, CLEAR_MS_PER_MOB,
    CONTEST_MS, CONTEST_PLAYER_RANGE, MAX_WAIT_MS, OWN_FIGHT_SLACK, REPLAN_MS, ROUTE_STEPS,
    WALK_FACTOR, ZONE_AVOID_MS, ZONE_CONTESTS, ZONE_MEMORY_MS,
};
use rh_sim::{math, FactionId, Vec2};

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct BuildRouteStats {
    pub plans: u64,
    pub contests: u64,
}

pub(crate) struct RouteInput<'a> {
    pub now: f64,
    pub run_ms: f64,
    pub self_pos: Vec2,
    pub speed: f64,
    pub mob_kills: f64,
    pub power: f64,
    pub camps: &'a [RouteCamp],
    pub players: &'a [Vec2],
    pub can_farm: &'a dyn Fn(&RouteCamp) -> bool,
}

pub(crate) struct BuildRoute {
    pub build: &'static BuildGoal,
    pub route: Vec<RouteStep>,
    pub planned_at: f64,
    pub contested: Vec<(u32, f64)>,
    pub zone_hits: Vec<(FactionId, Vec<f64>)>,
    pub zone_avoid: Vec<(FactionId, f64)>,
    pub heading: Option<(u32, u8)>,
    pub last_alive: Vec<(u32, u32)>,
    pub stats: BuildRouteStats,
}

impl BuildRoute {
    pub(crate) fn new(faction: FactionId, draw: f64) -> Self {
        Self {
            build: build_of(faction, draw),
            route: Vec::new(),
            planned_at: f64::NEG_INFINITY,
            contested: Vec::new(),
            zone_hits: Vec::new(),
            zone_avoid: Vec::new(),
            heading: None,
            last_alive: Vec::new(),
            stats: BuildRouteStats::default(),
        }
    }

    fn contested_until(&self, camp: u32) -> Option<f64> {
        self.contested
            .iter()
            .find(|(k, _)| *k == camp)
            .map(|(_, t)| *t)
    }

    pub(crate) fn is_contested(&self, camp: u32, now: f64) -> bool {
        self.contested_until(camp).is_some_and(|until| until > now)
    }

    fn zone_hits_for(&self, zone: FactionId) -> Option<&Vec<f64>> {
        self.zone_hits
            .iter()
            .find(|(z, _)| *z == zone)
            .map(|(_, hs)| hs)
    }

    fn zone_hits_mut(&mut self, zone: FactionId) -> &mut Vec<f64> {
        if let Some(pos) = self.zone_hits.iter().position(|(z, _)| *z == zone) {
            return &mut self.zone_hits[pos].1;
        }
        self.zone_hits.push((zone, Vec::new()));
        &mut self.zone_hits.last_mut().expect("just pushed").1
    }

    fn zone_avoid_until(&self, zone: FactionId) -> Option<f64> {
        self.zone_avoid
            .iter()
            .find(|(z, _)| *z == zone)
            .map(|(_, t)| *t)
    }

    fn set_zone_avoid(&mut self, zone: FactionId, until: f64) {
        if let Some(pos) = self.zone_avoid.iter().position(|(z, _)| *z == zone) {
            self.zone_avoid[pos].1 = until;
        } else {
            self.zone_avoid.push((zone, until));
        }
    }

    fn last_alive(&self, camp: u32) -> Option<u32> {
        self.last_alive
            .iter()
            .find(|(k, _)| *k == camp)
            .map(|(_, n)| *n)
    }

    fn set_last_alive(&mut self, camp: u32, alive: u32) {
        if let Some(pos) = self.last_alive.iter().position(|(k, _)| *k == camp) {
            self.last_alive[pos].1 = alive;
        } else {
            self.last_alive.push((camp, alive));
        }
    }

    /// The first planned camp, after noting contests and planning again when the plan is stale or broken.
    pub(crate) fn update(&mut self, inp: &RouteInput<'_>) -> Option<RouteStep> {
        self.note_contests(inp);
        let broken = self
            .route
            .first()
            .is_some_and(|first| self.is_contested(first.camp, inp.now) || self.done(inp, *first));
        if broken || inp.now - self.planned_at >= REPLAN_MS || self.route.is_empty() {
            self.plan(inp);
        }
        let next = self.route.first().copied();
        let heading = next.and_then(|step| {
            inp.camps
                .iter()
                .find(|c| c.index == step.camp)
                .map(|c| (c.index, c.state))
        });
        self.heading = heading;
        next
    }

    fn done(&self, inp: &RouteInput<'_>, step: RouteStep) -> bool {
        match inp.camps.iter().find(|k| k.index == step.camp) {
            None => true,
            Some(c) => c.state == 2 && c.respawn_at - inp.now > MAX_WAIT_MS,
        }
    }

    fn note_contests(&mut self, inp: &RouteInput<'_>) {
        let now = inp.now;
        let planned: Vec<u32> = self.route.iter().map(|s| s.camp).collect();
        for c in inp.camps {
            let before = self.last_alive(c.index);
            self.set_last_alive(c.index, c.alive);
            if !planned.contains(&c.index) || self.is_contested(c.index, now) {
                continue;
            }
            let near = math::hypot(inp.self_pos.x - c.x, inp.self_pos.y - c.y);
            let away = near > c.r + OWN_FIGHT_SLACK;
            let farmed_by_other = away && before.is_some_and(|b| c.alive < b);
            let player_at = near > c.r
                && inp
                    .players
                    .iter()
                    .any(|p| math::hypot(p.x - c.x, p.y - c.y) <= CONTEST_PLAYER_RANGE);
            let stolen = away
                && self
                    .heading
                    .is_some_and(|(camp, state)| camp == c.index && state != 2)
                && c.state == 2;
            if !farmed_by_other && !player_at && !stolen {
                continue;
            }
            if let Some(pos) = self.contested.iter().position(|(camp, _)| *camp == c.index) {
                self.contested[pos].1 = now + CONTEST_MS;
            } else {
                self.contested.push((c.index, now + CONTEST_MS));
            }
            self.stats.contests += 1;
            let hits = self.zone_hits_mut(c.zone);
            hits.retain(|t| now - *t < ZONE_MEMORY_MS);
            hits.push(now);
            if hits.len() as u32 >= ZONE_CONTESTS {
                self.set_zone_avoid(c.zone, now + ZONE_AVOID_MS);
            }
        }
    }

    /// Greedy by value per second, ROUTE_STEPS ahead, with respawns planned and contested camps and zones left out.
    pub(crate) fn plan(&mut self, inp: &RouteInput<'_>) {
        self.planned_at = inp.now;
        self.stats.plans += 1;
        let elites = ready_for_elites(inp.run_ms, inp.mob_kills, inp.power);
        let speed = inp.speed.max(1.);
        let mut out: Vec<RouteStep> = Vec::new();
        let mut used: Vec<u32> = Vec::new();
        let mut at = inp.self_pos;
        let mut t = inp.now;
        for _step in 0..ROUTE_STEPS {
            let mut best: Option<(RouteCamp, f64, f64, f64, f64)> = None;
            for c in inp.camps {
                if used.contains(&c.index)
                    || self.is_contested(c.index, inp.now)
                    || self
                        .zone_avoid_until(c.zone)
                        .is_some_and(|until| until > inp.now)
                    || !(inp.can_farm)(c)
                {
                    continue;
                }
                let value = route_camp_value(self.build, c, elites);
                if !matches!(value.partial_cmp(&0.), Some(std::cmp::Ordering::Greater)) {
                    continue;
                }
                let dist = math::hypot(at.x - c.x, at.y - c.y);
                let arrive = t + (dist * WALK_FACTOR / speed) * 1000.;
                let ready = if c.state == 2 { c.respawn_at } else { inp.now };
                if ready - arrive > MAX_WAIT_MS {
                    continue;
                }
                let start = arrive.max(ready);
                let mobs = if c.state == 2 { c.spots } else { c.alive };
                let clear = if c.elite {
                    CLEAR_MS_ELITE + f64::from(mobs.saturating_sub(1)) * CLEAR_MS_PER_MOB
                } else {
                    f64::from(mobs) * CLEAR_MS_PER_MOB
                };
                let score = value / ((start - t + clear) / 1000. + 1.);
                let better = match &best {
                    None => true,
                    Some((c_best, _, _, _, score_best)) => {
                        score > *score_best || (score == *score_best && c.index < c_best.index)
                    }
                };
                if better {
                    best = Some((c.clone(), arrive, start, start + clear, score));
                }
            }
            let Some((camp, arrive, start, done, _)) = best else {
                break;
            };
            out.push(RouteStep {
                camp: camp.index,
                arrive_at: arrive,
                start_at: start,
            });
            used.push(camp.index);
            at = Vec2::new(camp.x, camp.y);
            t = done;
        }
        self.route = out;
    }
}

pub(crate) fn route_camp_value(build: &BuildGoal, c: &RouteCamp, elites: bool) -> f64 {
    if c.elite && !elites {
        return 0.;
    }
    let mobs = if c.state == 2 {
        f64::from(c.spots)
    } else {
        f64::from(c.alive)
    };
    let normals = if c.elite { (mobs - 1.).max(0.) } else { mobs };
    let mob_type = (!c.mob_type.is_empty()).then_some(c.mob_type.as_str());
    let mut value = normals * type_weight(build, mob_type);
    if c.elite && mobs > 0. {
        value += crate::bots::build_route::ELITE_VALUE;
    }
    value
}
