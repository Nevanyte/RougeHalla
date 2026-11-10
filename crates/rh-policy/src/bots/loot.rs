//! Live loot and reward-choice executors for the HumanBot seat (fix-bot-loot).
//!
//! Legacy sources, restated for the live seat's own facts:
//!   - `brain/tactics/world.ts` actLoot/takeIt/nextStep: walk to a container, hold still, press F (one `pickup`);
//!   - `brain/strategy.ts` loot() and settle(): which containers are worth the detour, the 30 s skip of a lost cause and
//!     the short exclusion of a goal that just finished or failed;
//!   - `brain/modules/chests.ts` observe/goals/intents/act: the walk to a cleared camp's reward chest and its one `choose`,
//!     re-asked only for another card when the first was taken.
//!
//! The card pick (`chooseOption`) and the walk decision (`ChestHunter`) are the parity-captured private ports
//! (parity/policy/bot-private-modules), reused unchanged through the `live_chests` lease.
//!
//! C-OBS: everything here reads the facts `Perception` takes from the accepted Frame14 (the delivered prop rows and their
//! focus, the reward chests and their admission flag, the owner's own build row and the arena clocks). C-INPUT: a
//! container or chest is named by its public cue key; bot.rs resolves a key to the handle that same observation delivered
//! when it emits, and the command then goes through the seat's normal resolve + validate + `Sim::submit` intake.
//!
//! Documented narrowings of this compatibility seat (it has no full source Memory/Strategy/Knowledge wiring yet):
//!   - loot candidates see visible fighters only (no remembered enemies or containers), and the Knowledge counter term of
//!     strategy.loot() is 0, so a bot with both hands full never offers a swap detour (the source needs a counter > 0.34);
//!   - a mob is awake when it moves faster than a shuffle (the source mobAwake fallback without a Memory record);
//!   - candidate order is the compatibility front end's (chest, loot, then fight/farm/roam), not utility softmax; to
//!     keep the source ranking below a fight (chest worth caps at 0.84, a committed fight is 0.85), no chest goal is
//!     held while `fighting` (engaged, a fighter inside the persona's threat range, or an awake mob within 220 u);
//!   - a two-weapon body: after the first weapon the world.ts slot keeps repeating its Done("picked up") until stale,
//!     so the second is not taken (the source slot rule, kept as is).
use super::brain::{Goal, Output, Status};
use super::paths::RoomPathService;
use super::perception::{ChestRef, Contents, LootFacts, PropRef};
use super::temporal_percept::live_chests::{
    choose_option, CardCounts, ChestDecision, ChestHunter, ChestInput, ChestSelf, HuntChest,
    HuntSelf, CHEST_HUNT,
};
use super::types::{
    BotWeapon, ChooseMsg, FighterView, Intent, IntentBody, IntentTiming, MobView, PersonaParams,
    Stimulus, StimulusKind, TierParams, PRIORITY_COMBAT, PRIORITY_GOAL,
};
use rh_sim::constants::{INTERACT_RANGE, PLAYER_RADIUS, TILE};
use rh_sim::Vec2;
use std::cell::RefCell;

// ------------------------------------------------------------------------------------------- world.ts (actLoot)
/// Inside this distance of a container we start taking; a margin under INTERACT_RANGE for stale positions.
pub const PICKUP_DISTANCE: f64 = INTERACT_RANGE - 12.;
/// Standing this long (ms) before F: the server position has settled.
pub const STILL_BEFORE_PICKUP_MS: f64 = 150.;
pub const PICKUP_RETRY_MS: f64 = 400.;
/// A detour that takes longer than this is dropped for good (world.ts).
pub const LOOT_DETOUR_BUDGET_MS: f64 = 6_000.;
pub const LOOT_ENEMY_DISTANCE: f64 = 240.;
pub const LOOT_MOB_DISTANCE: f64 = 220.;
pub const LOOT_MAX_FAILS: u32 = 2;
const WAYPOINT_FROM: f64 = 150.;
const STOP_RESEND_MS: f64 = 800.;
const STALE_MS: f64 = 3_000.;

// ----------------------------------------------------------------------------------------- strategy.ts (loot)
pub const LOOT_GROUND_RADIUS: f64 = 15. * TILE;
pub const LOOT_CHEST_RADIUS: f64 = 8. * TILE;
pub const LOOT_EARLY_MS: f64 = 25_000.;
pub const LOOT_ENEMY_NEAR: f64 = 240.;
pub const LOOT_MOB_NEAR: f64 = 220.;
/// A loot goal running longer than this is skipped (strategy.ts LOOT_BUDGET_MS).
pub const LOOT_BUDGET_MS: f64 = 8_000.;
pub const LOOT_SKIP_MS: f64 = 30_000.;
const EXCLUDE_FAILED_MS: f64 = 5_000.;
const EXCLUDE_DONE_MS: f64 = 1_500.;

// ------------------------------------------------------------------------------------------ chests.ts (CHEST_RULES)
pub const ASK_WINDOW_MS: f64 = 4_000.;
pub const MAX_ASKS: u32 = 3;
const MOB_NEAR: f64 = 220.;

/// The seat's view of one observation, as the loot/choice executor reads it. Plain borrowed data.
pub struct View<'a> {
    pub now: f64,
    pub at: Vec2,
    pub alive: bool,
    /// The raid is on (hud phase "active").
    pub active: bool,
    pub hp: f64,
    pub max_hp: f64,
    pub effects: u16,
    pub weapons: [Option<BotWeapon>; 2],
    pub slot: u8,
    pub faction: Option<rh_sim::FactionId>,
    /// The owner's rendered key (what `taken_by` names for its own pick).
    pub self_key: &'a str,
    pub fighters: &'a [FighterView],
    pub mobs: &'a [MobView],
    pub facts: &'a LootFacts,
    pub gates_locked: bool,
    /// The toast texts this observation delivered.
    pub toasts: &'a [String],
    /// When the owner last started standing still (Memory own motion).
    pub still_since: f64,
    /// The owner holds an attack lock (source `isEngaged`).
    pub engaged: bool,
    pub persona: &'static PersonaParams,
    pub tier: &'static TierParams,
}

impl View<'_> {
    fn carried(&self) -> usize {
        self.weapons.iter().filter(|w| w.is_some()).count()
    }
    fn dist(&self, to: Vec2) -> f64 {
        dist(self.at, to)
    }
    /// The run is on, the bot stands, and the gates are open (chests.ts `live`).
    fn live(&self) -> bool {
        self.alive && self.active && !self.facts.in_coliseum
    }
    fn mob_awake_near(&self, radius: f64) -> bool {
        self.mobs
            .iter()
            .any(|m| m.status != "dead" && mob_awake(m) && self.dist(Vec2::new(m.x, m.y)) <= radius)
    }
}

fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::math::hypot(a.x - b.x, a.y - b.y)
}

/// Source `mobAwake` without a Memory record: moving faster than a shuffle.
fn mob_awake(m: &MobView) -> bool {
    rh_sim::math::hypot(m.vx, m.vy) > 20.
}

fn to_weapon_id(w: BotWeapon) -> rh_sim::WeaponId {
    rh_sim::WeaponId::parse(w.as_str()).unwrap_or(rh_sim::WeaponId::Fists)
}

fn goal_key(goal: &Goal) -> Option<String> {
    match goal {
        Goal::Loot { container } => Some(format!("loot:{container}")),
        Goal::Chest { chest } => Some(format!("chest:{chest}")),
        _ => None,
    }
}

fn goal_intent(body: IntentBody, why: &str) -> Intent {
    Intent {
        body,
        priority: PRIORITY_GOAL,
        timing: IntentTiming::Step {},
        why: why.into(),
    }
}

fn output(intents: Vec<Intent>, status: Status, why: &'static str) -> Output {
    Output {
        intents,
        status,
        why,
        attacking: false,
    }
}

/// Source world.ts `LootState`: the detour's own bookkeeping, per container key.
#[derive(Clone, Debug)]
struct LootState {
    key: String,
    last_act_at: f64,
    started_at: f64,
    last_now: f64,
    carried_at_start: usize,
    stop_at: Option<f64>,
    pickup_at: Option<f64>,
    fails: u32,
    finished: Option<(Status, &'static str)>,
}

/// Source chests.ts `Ask`.
#[derive(Clone, Debug, PartialEq)]
struct Ask {
    first: f64,
    option: i64,
    n: u32,
}

/// The seat's loot/choice state: the world.ts loot slots, the strategy.ts skip/exclusion records and the chests.ts state.
#[derive(Default)]
pub struct Loot {
    slots: Vec<LootState>,
    skip: Vec<(String, f64)>,
    excluded: Vec<(String, f64)>,
    since: Option<(Option<String>, f64)>,
    hunter: ChestHunter,
    build: CardCounts,
    counted: Vec<String>,
    readable: Vec<(String, f64)>,
    asks: Vec<(String, Ask)>,
    /// chests.ts `st.goal` is fight or hunt (the only goal kinds `fighting` reads).
    fight_goal: bool,
}

impl Loot {
    pub fn new() -> Self {
        Self {
            hunter: ChestHunter::new(CHEST_HUNT),
            ..Self::default()
        }
    }
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    // ===================================================================================== strategy.ts bookkeeping

    /// Source strategy `sync` + `settle`, for the loot and chest goals this seat runs: a goal that finished is not
    /// offered again at once, a failed or overlong loot detour is skipped for LOOT_SKIP_MS.
    pub fn settle(&mut self, current: &Goal, status: Status, now: f64) {
        let key = goal_key(current);
        if self.since.as_ref().is_none_or(|(k, _)| *k != key) {
            self.since = Some((key.clone(), now));
        }
        self.excluded.retain(|(_, until)| *until > now);
        self.skip.retain(|(_, until)| *until > now);
        let Some(key) = key else {
            return;
        };
        match status {
            Status::Failed => self.excluded.push((key, now + EXCLUDE_FAILED_MS)),
            Status::Done => self.excluded.push((key, now + EXCLUDE_DONE_MS)),
            _ => {}
        }
        if let Goal::Loot { container } = current {
            let since = self.since.as_ref().map_or(now, |(_, t)| *t);
            if status == Status::Failed || now - since > LOOT_BUDGET_MS {
                self.skip.push((container.clone(), now + LOOT_SKIP_MS));
            }
        }
    }

    fn is_excluded(&self, goal: &Goal, now: f64) -> bool {
        goal_key(goal).is_some_and(|key| {
            self.excluded
                .iter()
                .any(|(k, until)| *k == key && *until > now)
        })
    }

    /// Source strategy.ts `loot()`, narrowed (see the module header): the best container worth a detour, if any.
    pub fn loot_goal(&self, v: &View) -> Option<Goal> {
        if v.engaged || !v.live() {
            return None;
        }
        let carried: Vec<BotWeapon> = v.weapons.iter().flatten().copied().collect();
        let nearest = v
            .fighters
            .iter()
            .filter(|f| f.status == "alive")
            .map(|f| v.dist(Vec2::new(f.x, f.y)))
            .fold(f64::INFINITY, f64::min);
        if nearest < LOOT_ENEMY_NEAR || v.mob_awake_near(LOOT_MOB_NEAR) {
            return None;
        }
        let early = v.now - v.facts.raid_started_at <= LOOT_EARLY_MS;
        let mut best: Option<(f64, &PropRef)> = None;
        for c in &v.facts.props {
            if !c.closed || c.contents == Contents::Empty {
                continue;
            }
            if self.skip.iter().any(|(k, _)| *k == c.key) {
                continue;
            }
            let reach = match c.kind {
                "ground" => LOOT_GROUND_RADIUS,
                "body" => LOOT_CHEST_RADIUS,
                "chest" if early => LOOT_CHEST_RADIUS,
                _ => 0.,
            };
            let d = v.dist(c.at);
            if d >= reach {
                continue;
            }
            // Somebody else is nearer: they get there first.
            if v.fighters
                .iter()
                .filter(|f| f.status == "alive")
                .any(|f| dist(Vec2::new(f.x, f.y), c.at) < d)
            {
                continue;
            }
            let base = match c.contents {
                Contents::Unknown => {
                    if carried.len() >= 2 {
                        continue;
                    }
                    0.3
                }
                Contents::Weapon(w) => {
                    if carried.contains(&w) || carried.len() >= 2 {
                        // Both hands full: only a clear counter upgrade (counter > 0.34) is a detour; see the header.
                        continue;
                    }
                    0.5
                }
                Contents::Empty => continue,
            };
            let loot = v.persona.loot;
            let u = (loot * base * (1. - 0.5 * (d / reach))
                + if early && carried.len() < 2 {
                    0.1 * loot
                } else {
                    0.
                })
            .min(0.8);
            let goal = Goal::Loot {
                container: c.key.clone(),
            };
            if self.is_excluded(&goal, v.now) {
                continue;
            }
            if best.is_none_or(|(bu, _)| u > bu) {
                best = Some((u, c));
            }
        }
        best.map(|(_, c)| Goal::Loot {
            container: c.key.clone(),
        })
    }

    // ============================================================================================ world.ts actLoot

    /// Source world.ts `actLoot` for the container `key`.
    pub fn act_loot(&mut self, key: &str, v: &View, paths: &mut RoomPathService) -> Output {
        let now = v.now;
        self.slots.retain(|s| now - s.last_act_at <= STALE_MS);
        let i = match self.slots.iter().position(|s| s.key == key) {
            Some(i) => i,
            None => {
                self.slots.push(LootState {
                    key: key.to_owned(),
                    last_act_at: now,
                    started_at: now,
                    last_now: -1.,
                    carried_at_start: v.carried(),
                    stop_at: None,
                    pickup_at: None,
                    fails: 0,
                    finished: None,
                });
                self.slots.len() - 1
            }
        };
        let st = &mut self.slots[i];
        st.last_act_at = now;
        if let Some((status, why)) = st.finished {
            return output(vec![], status, why);
        }
        let finish = |st: &mut LootState, status: Status, why: &'static str| {
            st.finished = Some((status, why));
            output(vec![], status, why)
        };
        if st.last_now != now {
            st.last_now = now;
            // A toast delivered after the press answers it (this observation's events postdate the decision that sent it).
            if st.pickup_at.is_some_and(|t| now > t) {
                for text in v.toasts {
                    let t = text.trim().trim_end_matches('.').to_lowercase();
                    if t == "nothing there" || t == "nothing to take" {
                        st.fails = LOOT_MAX_FAILS;
                    } else if t == "too far away" || t == "can't reach that" {
                        st.fails += 1;
                    }
                }
            }
        }
        let seen = v.facts.props.iter().find(|c| c.key == key);
        if v.carried() > st.carried_at_start {
            return finish(st, Status::Done, "picked up");
        }
        if st.fails >= LOOT_MAX_FAILS {
            return finish(st, Status::Failed, "refused");
        }
        let Some(seen) = seen else {
            return finish(st, Status::Failed, "gone");
        };
        if !seen.closed || seen.contents == Contents::Empty {
            return finish(st, Status::Done, "emptied");
        }
        if now - st.started_at > LOOT_DETOUR_BUDGET_MS {
            return finish(st, Status::Failed, "budget");
        }
        if v.fighters
            .iter()
            .any(|f| f.status == "alive" && v.dist(Vec2::new(f.x, f.y)) < LOOT_ENEMY_DISTANCE)
        {
            return finish(st, Status::Failed, "enemy near");
        }
        if v.mobs.iter().any(|m| {
            m.status != "dead" && v.dist(Vec2::new(m.x, m.y)) < LOOT_MOB_DISTANCE && mob_awake(m)
        }) {
            return finish(st, Status::Failed, "mob near");
        }
        let d = v.dist(seen.at);
        if seen.interactable && d <= PICKUP_DISTANCE {
            // takeIt: halt so the server's position settles, then press F once the bot has stood still.
            let still = now - v.still_since >= STILL_BEFORE_PICKUP_MS;
            let why = if still { "taking" } else { "settling" };
            if !still {
                if st.stop_at.is_some_and(|t| now - t < STOP_RESEND_MS) {
                    return output(vec![], Status::Running, why);
                }
                st.stop_at = Some(now);
                return output(
                    vec![goal_intent(
                        IntentBody::Stop {},
                        "hold still for the pickup",
                    )],
                    Status::Running,
                    why,
                );
            }
            if st.pickup_at.is_some_and(|t| now - t < PICKUP_RETRY_MS) {
                return output(vec![], Status::Running, why);
            }
            st.pickup_at = Some(now);
            return output(
                vec![goal_intent(
                    IntentBody::Pickup {
                        container: seen.key.clone(),
                    },
                    "take the weapon",
                )],
                Status::Running,
                why,
            );
        }
        let Some(to) = next_step(v.at, seen.at, d, paths) else {
            return finish(st, Status::Failed, "unreachable");
        };
        output(
            vec![goal_intent(IntentBody::Move { to }, "to the container")],
            Status::Running,
            "walking",
        )
    }

    // ======================================================================================== chests.ts (module)

    /// Source chests.ts `observe`: when each chest's cards were first readable, the asks of a closed panel dropped, and the
    /// cards this bot took counted into its own build record.
    pub fn observe(&mut self, v: &View) {
        for c in &v.facts.chests {
            let Some(options) = &c.options else {
                self.readable.retain(|(k, _)| *k != c.key);
                self.asks.retain(|(k, _)| *k != c.key);
                continue;
            };
            if !self.readable.iter().any(|(k, _)| *k == c.key) {
                self.readable.push((c.key.clone(), v.now));
            }
            if self.counted.contains(&c.key) {
                continue;
            }
            let Some(i) = c.taken_by.iter().position(|by| by == v.self_key) else {
                continue;
            };
            self.counted.push(c.key.clone());
            if let Some(card) = options.get(i).filter(|card| !card.is_empty()) {
                self.build.add_one(card);
            }
        }
    }

    fn own_build(&self, v: &View) -> CardCounts {
        match &v.facts.build {
            None => self.build.clone(),
            Some(seen) => CardCounts {
                entries: seen.clone(),
            }
            .merged_max(&self.build),
        }
    }

    fn choice_self(&self, v: &View) -> ChestSelf {
        ChestSelf {
            faction: v.faction.map_or("", |f| f.as_str()).to_owned(),
            weapons: v.weapons.map(|w| w.map(to_weapon_id)),
            slot: Some(v.slot),
            risk: Some(v.persona.risk),
            build: Some(self.own_build(v)),
        }
    }

    fn in_hold(v: &View, c: &ChestRef) -> bool {
        c.life_ms - (c.expires_at - v.now) < CHEST_HUNT.hold_ms
    }

    /// Source `cardsInReach`: the nearest readable chest not picked at and with time left; none when its asks ran out.
    fn cards_in_reach<'a>(&self, v: &View<'a>) -> Option<&'a ChestRef> {
        if !v.live() {
            return None;
        }
        let mut chest: Option<&'a ChestRef> = None;
        for c in &v.facts.chests {
            if c.options.is_none() || c.picked || c.expires_at - v.now <= CHEST_HUNT.pick_margin_ms
            {
                continue;
            }
            match chest {
                None => chest = Some(c),
                Some(best) => {
                    let (c_held, best_held) = (Self::in_hold(v, c), Self::in_hold(v, best));
                    let better = if c_held == best_held {
                        v.dist(c.at) < v.dist(best.at)
                    } else {
                        best_held
                    };
                    if better {
                        chest = Some(c);
                    }
                }
            }
        }
        let chest = chest?;
        let expired = self
            .asks
            .iter()
            .find(|(k, _)| *k == chest.key)
            .is_some_and(|(_, ask)| v.now - ask.first > ASK_WINDOW_MS);
        (!expired).then_some(chest)
    }

    /// Source `pickIntent`: the `choose` for the chest in reach, asked again only for another card inside the window.
    pub fn pick_intent(&mut self, v: &View) -> Option<Intent> {
        use super::wish::{EFFECT_CASTING, EFFECT_STUNNED};
        // The server refuses a pick from a stunned or casting player, and a refusal is a try spent: wait it out.
        if v.effects & (EFFECT_STUNNED | EFFECT_CASTING) != 0 {
            return None;
        }
        let chest = self.cards_in_reach(v)?;
        let options = chest.options.as_ref()?;
        if Self::in_hold(v, chest) {
            return None;
        }
        let option = choose_option(options, &chest.taken_by, &self.choice_self(v));
        match self.asks.iter().position(|(k, _)| *k == chest.key) {
            None => self.asks.push((
                chest.key.clone(),
                Ask {
                    first: v.now,
                    option,
                    n: 1,
                },
            )),
            Some(i) => {
                let ask = &mut self.asks[i].1;
                if ask.option != option {
                    if ask.n >= MAX_ASKS {
                        return None;
                    }
                    ask.option = option;
                    ask.n += 1;
                }
            }
        }
        let opened = self
            .readable
            .iter()
            .find(|(k, _)| *k == chest.key)
            .map_or(v.now, |(_, at)| *at);
        let why = if option >= 0 {
            format!(
                "chest {}: card {option} ({})",
                chest.key, options[option as usize]
            )
        } else {
            format!("chest {}: nothing to use, skip", chest.key)
        };
        Some(Intent {
            body: IntentBody::Choose {
                msg: ChooseMsg {
                    chest: chest.key.clone(),
                    pick: option as i8,
                    replace: None,
                },
            },
            priority: PRIORITY_COMBAT,
            timing: IntentTiming::React {
                stimulus: Stimulus {
                    kind: StimulusKind::ChestUp,
                    at: opened,
                    subject: Some(chest.key.clone()),
                    central: true,
                    value: None,
                },
            },
            why,
        })
    }

    /// The module's `intents` hook for a non-module goal: records the goal kind `fighting` reads, then the pick.
    pub fn intents(&mut self, goal: &Goal, v: &View) -> Option<Intent> {
        self.fight_goal = matches!(goal, Goal::Fight { .. });
        self.pick_intent(v)
    }

    fn hunt_chests(&self, v: &View, skip_tried: bool) -> Vec<HuntChest> {
        v.facts
            .chests
            .iter()
            .filter(|c| !c.picked && !(skip_tried && self.hunter.tried(&c.key)))
            .map(|c| HuntChest {
                id: c.key.clone(),
                kind: "reward".into(),
                x: c.at.x,
                y: c.at.y,
                expires_at: c.expires_at,
                life_ms: Some(c.life_ms),
                options: c.options.clone().unwrap_or_else(|| vec!["?".to_owned()]),
                taken_by: if c.options.is_some() {
                    c.taken_by.clone()
                } else {
                    Vec::new()
                },
                pickers: Vec::new(),
                raw: None,
            })
            .collect()
    }

    fn fighting(&self, v: &View) -> bool {
        v.engaged
            || self.fight_goal
            || v.fighters.iter().any(|f| {
                f.status == "alive" && v.dist(Vec2::new(f.x, f.y)) < v.persona.player_threat
            })
            || v.mob_awake_near(MOB_NEAR)
    }

    /// One hunt call over the room path service (chests.ts `huntInput` + the source walk/sight callbacks).
    fn run_hunt(
        &self,
        hunter: &mut ChestHunter,
        v: &View,
        paths: &mut RoomPathService,
        skip_tried: bool,
    ) -> ChestDecision {
        let me = v.at;
        let walk_paths = v.tier.route.walk_paths;
        let cells = RefCell::new(paths);
        let mut walk = |c: &HuntChest| -> Option<f64> {
            if walk_paths {
                cells.borrow_mut().walk(me, c.pos()).map(|a| a.dist)
            } else {
                Some(dist(me, c.pos()) * 1.3)
            }
        };
        let mut sight = |c: &HuntChest| -> bool { cells.borrow().los(me, c.pos()) };
        let mut input = ChestInput {
            now: v.now,
            server_time: v.now,
            self_: HuntSelf {
                id: v.self_key.to_owned(),
                x: me.x,
                y: me.y,
                base: self.choice_self(v),
                raw: None,
            },
            chests: self.hunt_chests(v, skip_tried),
            walk: &mut walk,
            sight: &mut sight,
            fighting: self.fighting(v),
            retreating: v.max_hp > 0. && v.hp / v.max_hp < v.persona.flee_hp,
            in_coliseum: v.facts.in_coliseum,
            teleport_at: Some(if v.gates_locked {
                0.
            } else {
                v.facts.patience_ends_at.unwrap_or(0.)
            }),
        };
        hunter.decide(&mut input, &mut |_| {})
    }

    /// Source chests.ts `goals`: stay for the pick in reach, else the chest a fresh hunt would walk to.
    pub fn chest_goal(&self, v: &View, paths: &mut RoomPathService) -> Option<Goal> {
        if v.facts.chests.is_empty() || !v.live() {
            return None;
        }
        // Source chests.goals() competes by worth() (cap 0.84) against a fight (0.85) or a flight: this seat has no
        // utilities, so while `fighting` the chest is never a goal. The pick still rides along every other goal (the
        // module `intents` hook), so defence keeps its wish/fight intents and the card is not lost.
        if self.fighting(v) {
            return None;
        }
        let goal = if let Some(here) = self.cards_in_reach(v) {
            Goal::Chest {
                chest: here.key.clone(),
            }
        } else {
            let mut fresh = ChestHunter::new(CHEST_HUNT);
            match self.run_hunt(&mut fresh, v, paths, true) {
                ChestDecision::Walk { chest, .. } => Goal::Chest { chest },
                _ => return None,
            }
        };
        (!self.is_excluded(&goal, v.now)).then_some(goal)
    }

    /// Source chests.ts `act` for the chest goal `id`.
    pub fn act_chest(&mut self, id: &str, v: &View, paths: &mut RoomPathService) -> Output {
        self.fight_goal = false;
        let Some(chest) = v.facts.chests.iter().find(|c| c.key == id) else {
            return output(vec![], Status::Done, "the chest is gone, or already picked");
        };
        if chest.picked || chest.expires_at <= v.now || !v.live() {
            return output(vec![], Status::Done, "the chest is gone, or already picked");
        }
        let mut intents = Vec::new();
        let pick = self.pick_intent(v);
        let picking = pick.is_some();
        intents.extend(pick);
        if self.fighting(v) {
            // A fight broke out at the chest: hand the goal back (strategy re-decides at once on a finished goal); the
            // pick sent with this output stays on its way.
            return output(intents, Status::Done, "a fight is on: the pick rides along");
        }
        let mut hunter = std::mem::take(&mut self.hunter);
        let d = self.run_hunt(&mut hunter, v, paths, false);
        self.hunter = hunter;
        if let ChestDecision::Walk { chest: walk_to, .. } = &d {
            if walk_to == id {
                // In reach of its cards it stands: the pick is on its way.
                if chest.options.is_none() {
                    intents.push(goal_intent(
                        IntentBody::Move { to: chest.at },
                        "to reward chest",
                    ));
                }
                return output(intents, Status::Running, "walking to the chest");
            }
        }
        if chest.options.is_some() && Self::in_hold(v, chest) {
            return output(
                intents,
                Status::Running,
                "waiting out the chest's birth hold",
            );
        }
        let asked = self
            .asks
            .iter()
            .find(|(k, _)| k == id)
            .is_some_and(|(_, ask)| v.now - ask.first <= ASK_WINDOW_MS);
        if picking || (chest.options.is_some() && asked) {
            return output(intents, Status::Running, "taking its pick");
        }
        output(
            vec![],
            Status::Done,
            if matches!(d, ChestDecision::Walk { .. }) {
                "another chest is nearer"
            } else {
                "not worth the walk, or given up"
            },
        )
    }
}

/// Source world.ts `nextStep`: the container itself, or around a wall the next waypoint; None when there is no way.
fn next_step(me: Vec2, at: Vec2, d: f64, paths: &mut RoomPathService) -> Option<Vec2> {
    if d <= WAYPOINT_FROM || paths.los(me, at) {
        return Some(at);
    }
    let Some(route) = paths.path(me, at) else {
        return paths.walk(me, at).map(|_| at);
    };
    route
        .iter()
        .find(|w| dist(me, **w) > 2. * PLAYER_RADIUS)
        .or(route.last())
        .copied()
        .or(Some(at))
}

#[cfg(test)]
mod tests;
