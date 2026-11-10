//! Complete source `ChestHunter` (`bots/chestHunt.ts`): hold/pick/walk decision, stall watch, walk cache, stats.
//!
//! Source-exact port of the unchanged legacy class. The two declared clocks stay separate (`now` drives the walk cache and
//! the stall record; `serverTime` is the chests' own expiry clock); walking distance is the caller's declared path
//! callback; the pick uses the shared card-choice leaves. State is per instance only (the source class): no global, no
//! actor id resolution, no world read. The caller supplies the source constructor's `log` callback to `decide`.

use super::types::CHEST_SECONDS;
pub(crate) use super::types::{HuntChest as ChestLike, HuntSelf};
use rh_sim::constants::{PLAYER_SPEED, TICK_MS, TILE};
use rh_sim::Vec2;

/// Source `ChestHuntConfig` (the eleven fields `CHEST_HUNT` declares).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ChestHuntConfig {
    pub(crate) pick_range: f64,
    pub(crate) pick_margin_ms: f64,
    pub(crate) hold_ms: f64,
    pub(crate) arrive_slack_ms: f64,
    pub(crate) pace_share: f64,
    pub(crate) fight_walk: f64,
    pub(crate) stall_ms: f64,
    pub(crate) stall_progress: f64,
    pub(crate) stall_step_max_ms: f64,
    pub(crate) max_candidates: f64,
    pub(crate) walk_cache_ms: f64,
}
impl Default for ChestHuntConfig {
    fn default() -> Self {
        CHEST_HUNT
    }
}

/// Source `CHEST_HUNT`.
pub(crate) const CHEST_HUNT: ChestHuntConfig = ChestHuntConfig {
    pick_range: super::types::CHEST_RANGE - super::types::CHEST_PANEL_SLACK,
    pick_margin_ms: 350.,
    hold_ms: 3. * TICK_MS,
    arrive_slack_ms: 1000.,
    pace_share: 0.85,
    fight_walk: 12. * TILE,
    stall_ms: 3000.,
    stall_progress: 24.,
    stall_step_max_ms: 500.,
    max_candidates: 3.,
    walk_cache_ms: 250.,
};

/// Source `ChestInput`: the walk/sight callbacks receive the exact declared chest row (the source passes the object).
pub(crate) struct ChestInput<'a> {
    pub(crate) now: f64,
    pub(crate) server_time: f64,
    pub(crate) self_: HuntSelf,
    pub(crate) chests: Vec<ChestLike>,
    pub(crate) walk: &'a mut dyn FnMut(&ChestLike) -> Option<f64>,
    pub(crate) sight: &'a mut dyn FnMut(&ChestLike) -> bool,
    pub(crate) fighting: bool,
    pub(crate) retreating: bool,
    pub(crate) in_coliseum: bool,
    pub(crate) teleport_at: Option<f64>,
}

/// Source `ChestDecision`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ChestDecision {
    Pick {
        chest: String,
        option: i64,
        why: String,
    },
    Walk {
        chest: String,
        to: Vec2,
        why: String,
    },
    None,
}

/// Source `ChestHuntStats`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ChestHuntStats {
    pub(crate) walks: u64,
    pub(crate) gave_up: u64,
}

/// The chest the last think walked to, and when (source `walking: { id, at } | null`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Walking {
    pub(crate) id: String,
    pub(crate) at: f64,
}

/// Source `ChestHunter`; private only.
#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct ChestHunter {
    cfg: ChestHuntConfig,
    pub(crate) stats: ChestHuntStats,
    /// Source `done` Set<string>, in insertion order.
    pub(crate) done: Vec<String>,
    /// Source `walking`.
    pub(crate) walking: Option<Walking>,
    /// Source `stalls` Map<string, {best, walkedMs}> in insertion order: (id, best, walkedMs).
    pub(crate) stalls: Vec<(String, f64, f64)>,
    /// Source `walks` Map<string, {at, len}> in insertion order: (id, at, len).
    pub(crate) walks: Vec<(String, f64, Option<f64>)>,
    /// Diagnostic only: how many declared walk callbacks this instance has made (the source cache misses).
    walk_calls: u64,
}

/// One source `up` row: the input chest by index plus the three derived numbers.
#[derive(Clone, Copy, Debug)]
struct UpRow {
    index: usize,
    d: f64,
    left: f64,
    age: f64,
}

/// JS `Math.min` (NaN-propagating; the chests' clocks are binary64).
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a <= b {
        a
    } else {
        b
    }
}

/// JS `Math.max` (NaN-propagating).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a >= b {
        a
    } else {
        b
    }
}

/// JS `Math.round` (the source uses positive walking lengths only).
fn math_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// JS `String(number)` for the source log template literal.
fn js_number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value == f64::INFINITY {
        return "Infinity".into();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".into();
    }
    super::super::strategy::types::js_number(value)
}

/// JS `Array.prototype.slice(0, end).length` for the candidate cap: ToIntegerOrInfinity, then clamp/negative-from-end.
fn slice_end(len: usize, end: f64) -> usize {
    let integer = if end.is_nan() {
        0.
    } else if end.is_infinite() {
        end
    } else {
        end.trunc()
    };
    let clamped = if integer < 0. {
        (len as f64 + integer).max(0.)
    } else {
        integer.min(len as f64)
    };
    clamped as usize
}

impl ChestHunter {
    pub(crate) fn new(cfg: ChestHuntConfig) -> Self {
        Self {
            cfg,
            ..Self::default()
        }
    }

    /// Has a pick been asked for (or the chest given up on)?
    pub(crate) fn tried(&self, id: &str) -> bool {
        self.done.iter().any(|done| done == id)
    }

    /// The chest the bot is walking to, if any (source `get target`).
    pub(crate) fn target(&self) -> Option<&str> {
        self.walking.as_ref().map(|walking| walking.id.as_str())
    }

    /// The pick for a chest is final: asked once, and never again whether the server took it or not.
    pub(crate) fn mark_done(&mut self, id: &str) {
        if !self.tried(id) {
            self.done.push(id.to_owned());
        }
        self.walks.retain(|(key, _, _)| key != id);
        self.stalls.retain(|(key, _, _)| key != id);
        if self
            .walking
            .as_ref()
            .is_some_and(|walking| walking.id == id)
        {
            self.walking = None;
        }
    }

    pub(crate) fn decide(
        &mut self,
        inp: &mut ChestInput<'_>,
        log: &mut dyn FnMut(&str),
    ) -> ChestDecision {
        let c = self.cfg;
        let now = inp.now;
        let server_time = inp.server_time;
        if inp.in_coliseum {
            self.walking = None;
            return ChestDecision::None;
        }
        let teleport_at = match inp.teleport_at {
            Some(value) if value > 0. => value,
            _ => f64::INFINITY,
        };

        // The chests that are up, that we have not picked at, and their distance.
        let mut up: Vec<UpRow> = Vec::new();
        for (index, chest) in inp.chests.iter().enumerate() {
            if chest.kind != "reward" || self.tried(&chest.id) {
                continue;
            }
            if chest.pickers.iter().any(|picker| picker == &inp.self_.id) {
                // We made our pick already.
                self.mark_done(&chest.id);
                continue;
            }
            let left = js_min(chest.expires_at, teleport_at) - server_time;
            if left <= 0. {
                continue;
            }
            let age =
                chest.life_ms.unwrap_or(CHEST_SECONDS * 1000.) - (chest.expires_at - server_time);
            up.push(UpRow {
                index,
                d: super::types::dist(inp.self_.pos(), chest.pos()),
                left,
                age,
            });
        }
        // Source sort: straight distance, then JS string `<` on the id (stable; NaN/0 fall to the id).
        up.sort_by(|a, b| {
            let diff = a.d - b.d;
            if diff != 0. && !diff.is_nan() {
                if diff < 0. {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            } else if inp.chests[a.index].id < inp.chests[b.index].id {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });
        // A record for a chest that is no longer up (expired, gone) is not needed any more.
        let up_ids: Vec<&str> = up
            .iter()
            .map(|row| inp.chests[row.index].id.as_str())
            .collect();
        self.stalls
            .retain(|(id, _, _)| up_ids.contains(&id.as_str()));

        // 1. In range with sight and time: pick now (a skip when nothing is usable), once out of the birth hold.
        let mut held = false;
        for row in &up {
            let chest = &inp.chests[row.index];
            if row.d > c.pick_range || row.left <= c.pick_margin_ms {
                continue;
            }
            if !(inp.sight)(chest) {
                continue;
            }
            if row.age < c.hold_ms {
                // Too young: not read, not tried, not walked to.
                held = true;
                continue;
            }
            let option =
                super::choice::choose_option(&chest.options, &chest.taken_by, &inp.self_.base);
            self.mark_done(&chest.id);
            self.walking = None;
            let why = if option >= 0 {
                format!(
                    "taking option {option} ({})",
                    chest.options[option as usize]
                )
            } else {
                "nothing usable: skipping".to_owned()
            };
            return ChestDecision::Pick {
                chest: chest.id.clone(),
                option,
                why,
            };
        }
        // A chest in reach that is still in its birth hold is waited for (a few ticks).
        if held {
            self.walking = None;
            return ChestDecision::None;
        }

        // 2. Walk to the nearest chest worth the trip.
        if inp.retreating {
            self.walking = None;
            return ChestDecision::None;
        }
        let candidate_end = slice_end(up.len(), c.max_candidates);
        let mut best: Option<(usize, f64)> = None;
        for row in &up[..candidate_end] {
            let chest = &inp.chests[row.index];
            let now_clock = inp.now;
            let walk = &mut *inp.walk;
            let Some(len) = self.walk_length(chest, now_clock, walk) else {
                continue;
            };
            if inp.fighting && len > c.fight_walk {
                continue;
            }
            let eta_ms = js_max(0., len - c.pick_range) / (PLAYER_SPEED * c.pace_share) * 1000.;
            if eta_ms + c.arrive_slack_ms > row.left {
                continue;
            }
            if best.is_none_or(|(_, best_len)| len < best_len) {
                best = Some((row.index, len));
            }
        }
        let Some((best_index, best_len)) = best else {
            self.walking = None;
            return ChestDecision::None;
        };

        // 3. The walk must keep closing in; the record belongs to the chest, not to the walk.
        let id = inp.chests[best_index].id.clone();
        let d = super::types::dist(inp.self_.pos(), inp.chests[best_index].pos());
        match self
            .stalls
            .iter()
            .position(|(stall_id, _, _)| *stall_id == id)
        {
            None => {
                self.stalls.push((id.clone(), d, 0.));
                self.stats.walks += 1;
                log(&format!(
                    "going for chest {id} ({} u of walking)",
                    js_number_text(math_round(best_len))
                ));
            }
            Some(index) => {
                let last = self.walking.clone();
                if let Some(walking) = &last {
                    if walking.id == id {
                        let step = js_min(js_max(0., now - walking.at), c.stall_step_max_ms);
                        self.stalls[index].2 += step;
                    }
                }
                if d < self.stalls[index].1 - c.stall_progress {
                    self.stalls[index].1 = d;
                    self.stalls[index].2 = 0.;
                } else if self.stalls[index].2 >= c.stall_ms {
                    log(&format!("giving up on chest {id}: not getting any closer"));
                    self.stats.gave_up += 1;
                    self.mark_done(&id);
                    return ChestDecision::None;
                }
            }
        }
        self.walking = Some(Walking {
            id: id.clone(),
            at: now,
        });
        ChestDecision::Walk {
            chest: id.clone(),
            to: inp.chests[best_index].pos(),
            why: format!("chest {id}"),
        }
    }

    /// The walking distance to a chest, recomputed no more often than `walkCacheMs`.
    fn walk_length(
        &mut self,
        chest: &ChestLike,
        now: f64,
        walk: &mut dyn FnMut(&ChestLike) -> Option<f64>,
    ) -> Option<f64> {
        if let Some(index) = self.walks.iter().position(|(id, _, _)| *id == chest.id) {
            let (_, at, len) = self.walks[index].clone();
            if now - at < self.cfg.walk_cache_ms {
                return len;
            }
        }
        let len = walk(chest);
        self.walk_calls += 1;
        match self.walks.iter_mut().find(|(id, _, _)| *id == chest.id) {
            Some(slot) => {
                slot.1 = now;
                slot.2 = len;
            }
            None => self.walks.push((chest.id.clone(), now, len)),
        }
        len
    }

    // ------------------------------------------------------------------------------------------- test diagnostics
    // Read-only source-own-state views for the frozen replay; never fed back as setup.

    #[cfg(test)]
    pub(crate) fn done_ids(&self) -> Vec<String> {
        self.done.clone()
    }

    #[cfg(test)]
    pub(crate) fn walking(&self) -> Option<(&str, f64)> {
        self.walking
            .as_ref()
            .map(|walking| (walking.id.as_str(), walking.at))
    }

    #[cfg(test)]
    pub(crate) fn stalls(&self) -> &[(String, f64, f64)] {
        &self.stalls
    }

    #[cfg(test)]
    pub(crate) fn walk_cache(&self) -> &[(String, f64, Option<f64>)] {
        &self.walks
    }

    #[cfg(test)]
    pub(crate) fn next_walk_index(&self) -> u64 {
        self.walk_calls
    }

    /// One operation's source `hunter` diagnostic: `{ own, target, stats }`.
    #[cfg(test)]
    pub(crate) fn capture(
        &self,
        cfg: &ChestHuntConfig,
        log: super::source_reader::SVal,
    ) -> super::source_reader::SVal {
        let own = self.capture_own(cfg, log);
        super::source_trace::encode_hunter_capture(own, self.target(), self.capture_stats())
    }

    /// The source `ChestHunter` instance own state (`{$instance:"ChestHunter", entries:[cfg, log, stats, done, walking,
    /// stalls, walks]}`), in source own-property order.
    #[cfg(test)]
    pub(crate) fn capture_own(
        &self,
        cfg: &ChestHuntConfig,
        log: super::source_reader::SVal,
    ) -> super::source_reader::SVal {
        use super::source_trace::{self, n, null, obj, s};
        let walking = match &self.walking {
            None => null(),
            Some(walking) => source_trace::encode_hunt_walking(&walking.id, walking.at),
        };
        let stalls = source_trace::map(
            self.stalls
                .iter()
                .map(|(id, best, walked_ms)| {
                    (s(id), source_trace::encode_hunt_stall(*best, *walked_ms))
                })
                .collect(),
        );
        let walks = source_trace::map(
            self.walks
                .iter()
                .map(|(id, at, len)| {
                    (
                        s(id),
                        obj(vec![
                            ("at", n(*at)),
                            (
                                "len",
                                source_trace::encode_opt(len.as_ref(), |value| n(*value)),
                            ),
                        ]),
                    )
                })
                .collect(),
        );
        source_trace::encode_hunter_own(
            source_trace::encode_hunt_config(cfg),
            log,
            self.capture_stats(),
            source_trace::encode_hunter_done(&self.done),
            walking,
            stalls,
            walks,
        )
    }

    #[cfg(test)]
    pub(crate) fn capture_stats(&self) -> super::source_reader::SVal {
        super::source_trace::encode_hunt_stats(&self.stats)
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::{CardCounts, ChestSelf};
    use super::*;
    use rh_sim::WeaponId;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    fn hunt_self() -> HuntSelf {
        HuntSelf {
            id: "me".into(),
            x: 1008.,
            y: 1008.,
            base: ChestSelf {
                faction: "fire".into(),
                weapons: [Some(WeaponId::Sword), None],
                slot: Some(0),
                risk: Some(0.5),
                build: Some(CardCounts::default()),
            },
            raw: None,
        }
    }

    fn chest(id: &str, dx: f64, expires_at: f64) -> ChestLike {
        ChestLike {
            id: id.into(),
            kind: "reward".into(),
            x: 1008. + dx,
            y: 1008.,
            expires_at,
            life_ms: None,
            options: vec!["ad1".into(), "ap1".into()],
            taken_by: vec!["".into(), "".into()],
            pickers: Vec::new(),
            raw: None,
        }
    }

    /// A walk/sight counter pair shared with the declared callbacks.
    struct Calls {
        walk: Rc<Cell<u32>>,
        sight: Rc<Cell<u32>>,
        logs: Rc<RefCell<Vec<String>>>,
    }
    impl Calls {
        fn new() -> Self {
            Self {
                walk: Rc::new(Cell::new(0)),
                sight: Rc::new(Cell::new(0)),
                logs: Rc::new(RefCell::new(Vec::new())),
            }
        }
        fn walker(&self, distance: fn(Vec2, Vec2) -> f64) -> impl FnMut(&ChestLike) -> Option<f64> {
            let walk = self.walk.clone();
            let me = Vec2::new(1008., 1008.);
            move |chest: &ChestLike| {
                walk.set(walk.get() + 1);
                Some(distance(me, chest.pos()))
            }
        }
        fn sighter(&self) -> impl FnMut(&ChestLike) -> bool {
            let sight = self.sight.clone();
            move |_chest: &ChestLike| {
                sight.set(sight.get() + 1);
                true
            }
        }
        fn log(&self) -> impl FnMut(&str) {
            let logs = self.logs.clone();
            move |message: &str| logs.borrow_mut().push(message.to_owned())
        }
    }

    fn straight(a: Vec2, b: Vec2) -> f64 {
        super::super::types::dist(a, b)
    }

    #[test]
    fn birth_hold_boundary_is_strict_149_150() {
        for (age, expected) in [(149., false), (150., true)] {
            let left = 10_000.;
            let mut young = chest("young", 30., 100_000. + left);
            // age = lifeMs - (expiresAt - serverTime); here expiresAt - serverTime == left.
            young.life_ms = Some(left + age);
            let calls = Calls::new();
            let mut walk = calls.walker(straight);
            let mut sight = calls.sighter();
            let mut input = ChestInput {
                now: 100_000.,
                server_time: 100_000.,
                self_: hunt_self(),
                chests: vec![young],
                walk: &mut walk,
                sight: &mut sight,
                fighting: false,
                retreating: false,
                in_coliseum: false,
                teleport_at: None,
            };
            let mut hunter = ChestHunter::new(CHEST_HUNT);
            let decision = hunter.decide(&mut input, &mut calls.log());
            if expected {
                assert_eq!(
                    decision,
                    ChestDecision::Pick {
                        chest: "young".into(),
                        option: 0,
                        why: "taking option 0 (ad1)".into(),
                    },
                    "age {age}"
                );
                assert!(hunter.tried("young"));
            } else {
                assert_eq!(decision, ChestDecision::None, "age {age}");
                assert!(!hunter.tried("young"));
            }
        }
    }

    #[test]
    fn walk_cache_expires_at_250() {
        let calls = Calls::new();
        let mut walk = calls.walker(straight);
        let mut sight = calls.sighter();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        for (now, expected_calls) in [(0., 1), (249., 1), (250., 2)] {
            let mut input = ChestInput {
                now,
                server_time: now,
                self_: hunt_self(),
                chests: vec![chest("box", 500., 10_000.)],
                walk: &mut walk,
                sight: &mut sight,
                fighting: false,
                retreating: false,
                in_coliseum: false,
                teleport_at: None,
            };
            let decision = hunter.decide(&mut input, &mut calls.log());
            assert_eq!(decision.kind_name(), "walk", "now {now}");
            assert_eq!(calls.walk.get(), expected_calls, "walk callbacks at {now}");
        }
    }

    #[test]
    fn stall_gives_up_at_3000_ms_of_walking() {
        let calls = Calls::new();
        let mut walk = calls.walker(straight);
        let mut sight = calls.sighter();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        let mut decision = ChestDecision::None;
        for step in 0..7 {
            let now = f64::from(step) * 500.;
            let mut input = ChestInput {
                now,
                server_time: now,
                self_: hunt_self(),
                chests: vec![chest("box", 500., 10_000.)],
                walk: &mut walk,
                sight: &mut sight,
                fighting: false,
                retreating: false,
                in_coliseum: false,
                teleport_at: None,
            };
            decision = hunter.decide(&mut input, &mut calls.log());
        }
        assert_eq!(decision, ChestDecision::None);
        assert_eq!(hunter.stats.walks, 1);
        assert_eq!(hunter.stats.gave_up, 1);
        assert!(hunter.tried("box"));
        assert_eq!(hunter.target(), None);
        assert_eq!(
            calls.logs.borrow().last().map(String::as_str),
            Some("giving up on chest box: not getting any closer")
        );
    }

    #[test]
    fn stall_progress_needs_strictly_more_than_24() {
        let calls = Calls::new();
        let mut walk = calls.walker(straight);
        let mut sight = calls.sighter();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        let mut decide = |hunter: &mut ChestHunter, now: f64, dx: f64| {
            let mut input = ChestInput {
                now,
                server_time: now,
                self_: hunt_self(),
                chests: vec![chest("box", dx, 10_000.)],
                walk: &mut walk,
                sight: &mut sight,
                fighting: false,
                retreating: false,
                in_coliseum: false,
                teleport_at: None,
            };
            hunter.decide(&mut input, &mut calls.log())
        };
        assert_eq!(decide(&mut hunter, 0., 500.).kind_name(), "walk");
        let at = |dx: f64| {
            super::super::types::dist(Vec2::new(1008., 1008.), Vec2::new(1008. + dx, 1008.))
        };
        // Exactly 24 closer is not progress (strict d < best - 24).
        assert_eq!(decide(&mut hunter, 500., 476.).kind_name(), "walk");
        assert_eq!(
            hunter.stalls().to_vec(),
            vec![("box".to_string(), 500., 500.)]
        );
        // A hair closer than 24 resets the best distance and the walked time.
        assert_eq!(decide(&mut hunter, 1000., 475.9).kind_name(), "walk");
        assert_eq!(
            hunter.stalls().to_vec(),
            vec![("box".to_string(), at(475.9), 0.)]
        );
    }

    #[test]
    fn fighting_only_leaves_for_a_chest_within_fight_walk() {
        for (dx, expected) in [(500., "none"), (300., "walk")] {
            let calls = Calls::new();
            let mut walk = calls.walker(straight);
            let mut sight = calls.sighter();
            let mut input = ChestInput {
                now: 0.,
                server_time: 0.,
                self_: hunt_self(),
                chests: vec![chest("box", dx, 10_000.)],
                walk: &mut walk,
                sight: &mut sight,
                fighting: true,
                retreating: false,
                in_coliseum: false,
                teleport_at: None,
            };
            let mut hunter = ChestHunter::new(CHEST_HUNT);
            let decision = hunter.decide(&mut input, &mut calls.log());
            assert_eq!(decision.kind_name(), expected, "dx {dx}");
        }
    }

    #[test]
    fn teleport_at_is_min_clock_and_nonpositive_means_none() {
        let cases = [
            (Some(0.), 0.1, 10_000., "pick"),
            (Some(100_000.), 0.1, 10_000., "none"),
            (Some(100_350.), 0.1, 10_000., "none"),
            (Some(100_351.), 0.1, 10_000., "pick"),
        ];
        for (teleport_at, dx, left, expected) in cases {
            let calls = Calls::new();
            let mut walk = calls.walker(straight);
            let mut sight = calls.sighter();
            let mut input = ChestInput {
                now: 100_000.,
                server_time: 100_000.,
                self_: hunt_self(),
                chests: vec![chest("box", dx, 100_000. + left)],
                walk: &mut walk,
                sight: &mut sight,
                fighting: false,
                retreating: false,
                in_coliseum: false,
                teleport_at,
            };
            let mut hunter = ChestHunter::new(CHEST_HUNT);
            let decision = hunter.decide(&mut input, &mut calls.log());
            assert_eq!(decision.kind_name(), expected, "teleport {teleport_at:?}");
        }
    }

    #[test]
    fn capture_matches_the_source_own_property_order() {
        let calls = Calls::new();
        let mut walk = calls.walker(straight);
        let mut sight = calls.sighter();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        let mut input = ChestInput {
            now: 0.,
            server_time: 0.,
            self_: hunt_self(),
            chests: vec![chest("box", 500., 10_000.)],
            walk: &mut walk,
            sight: &mut sight,
            fighting: false,
            retreating: false,
            in_coliseum: false,
            teleport_at: None,
        };
        assert_eq!(
            hunter.decide(&mut input, &mut calls.log()).kind_name(),
            "walk"
        );
        let capture = hunter.capture(&CHEST_HUNT, super::super::source_reader::SVal::Callable);
        let super::super::source_reader::SVal::Obj(entries) = &capture else {
            panic!("capture is an object");
        };
        assert_eq!(
            entries
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["own", "target", "stats"]
        );
        let super::super::source_reader::SVal::Instance { name, entries } = &entries[0].1 else {
            panic!("own is an instance");
        };
        assert_eq!(name, "ChestHunter");
        assert_eq!(
            entries
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["cfg", "log", "stats", "done", "walking", "stalls", "walks"]
        );
        assert_eq!(hunter.target(), Some("box"));
        assert_eq!(hunter.walking(), Some(("box", 0.)));
        assert_eq!(hunter.next_walk_index(), 1);
        assert_eq!(
            hunter.walk_cache().to_vec(),
            vec![(
                "box".to_string(),
                0.,
                Some(straight(Vec2::new(1008., 1008.), Vec2::new(1508., 1008.)))
            )]
        );
    }

    // Test-local decision label.
    impl ChestDecision {
        fn kind_name(&self) -> &'static str {
            match self {
                ChestDecision::Pick { .. } => "pick",
                ChestDecision::Walk { .. } => "walk",
                ChestDecision::None => "none",
            }
        }
    }
}
