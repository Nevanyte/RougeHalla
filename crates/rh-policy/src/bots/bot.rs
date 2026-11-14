//! The human-like seat: a Policy that reads only accepted Frame14 (C-OBS), decides through the ported hand, and proposes
//! through the one validated input path (C-INPUT). docs/BOTS.md 4 describes the legacy layers; this is the bounded core
//! slice: observed-player memory -> source scheduling/world goals -> the ported humanizer -> PublicCommands.
//! Candidate selection and combat remain the bounded compatibility front end. The loot (world.ts actLoot) and reward
//! chest (chests.ts) executors run through bots::loot on the frame's own delivered handles. Full source memory,
//! FrameRing, strategy scoring and fight/reflex executors remain pending.
use crate::bots::brain::{merge_intents, Brain, Goal, Output, Status as GoalStatus};
use crate::bots::clicks::BotMap;
use crate::bots::delivered::{Epoch, PlayerRef};
use crate::bots::humanizer::{Context, Humanizer};
use crate::bots::knowledge::Knowledge;
use crate::bots::loot::{Loot, View as LootView};
use crate::bots::memory_prefix::{Memory, OwnerSight, Scene, MAX_RECORDS};
use crate::bots::paths::{PathBudget, RoomPathService};
use crate::bots::perception::{LootFacts, Perception};
use crate::bots::planning::{PlanDeal, PlanLearned, PlanMap, PlanModule};
use crate::bots::random::{derive, Rng};
use crate::bots::types::{
    Intent, IntentBody, IntentTiming, Percept, PersonaId, PersonaParams, Stimulus, StimulusKind,
    TierId, TierParams,
};
use crate::bots::wish::{WishFoe, WishModule};
use crate::bots::world_tactics::{Context as WorldContext, WorldTactics};
use crate::delivery::Frame14;
use crate::{
    InputKind, InputPreview, InputRefusal, MatchStart, Policy, PolicyInput, PolicySpec,
    POLICY_CONTRACT_VERSION,
};
use rh_sim::{Observation, PlayerId, PublicCommand, OBSERVATION_VERSION};

/// The declared default mixes (docs/BOTS.md 5: tiers 30/45/25, personas uniform).
pub const TIER_MIX: [(TierId, f64); 3] = [
    (TierId::Easy, 0.30),
    (TierId::Normal, 0.45),
    (TierId::Hard, 0.25),
];
pub const PERSONA_MIX: [(PersonaId, f64); 4] = [
    (PersonaId::Farmer, 0.25),
    (PersonaId::Hunter, 0.25),
    (PersonaId::Opportunist, 0.25),
    (PersonaId::Cautious, 0.25),
];

/// Deterministic seat assignment from the manager's own stream: tiers by the cumulative mix, personas uniform, drawn in
/// that order per bot (a replay of the same seed seats the same bots).
pub fn assign_seats(seed: u64, count: usize) -> Vec<(TierId, PersonaId)> {
    let mut rng = Rng::new((seed as u32) ^ 0x51ed_270b);
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let t = rng.next_f64();
        let mut acc = 0.;
        let mut tier = TierId::Hard;
        for (id, share) in TIER_MIX {
            acc += share;
            if t < acc {
                tier = id;
                break;
            }
        }
        let p = rng.next_f64();
        let mut acc = 0.;
        let mut persona = PersonaId::Cautious;
        for (id, share) in PERSONA_MIX {
            acc += share;
            if p < acc {
                persona = id;
                break;
            }
        }
        out.push((tier, persona));
    }
    out
}

/// A human-like bot on a policy seat: the ported human-likeness core executing a bounded combat/roam front end.
pub struct HumanBot {
    tier: TierId,
    persona: PersonaId,
    humanizer: Option<Humanizer>,
    perception: Perception,
    map: Option<BotMap>,
    motor: Rng,
    lapse: Rng,
    decide: Rng,
    me: Option<PlayerId>,
    ids: Vec<(String, PlayerId)>,
    stimuli: Vec<Stimulus>,
    prev_hp_frac: f64,
    low_hp_prev_share: f64,
    roam: Option<rh_sim::Vec2>,
    memory: Option<Memory>,
    brain: Brain,
    world: WorldTactics,
    /// The Wish module: its availability/remember/retry and slip state, and the public static map its blink landing reads.
    wish: WishModule,
    /// The room path service the tactics read (P-BOTS-3): the shared budget, the cache and the clear/sight queries.
    paths: Option<RoomPathService>,
    /// The planning feature module (P-BOTS-3 remainder): the source planning.ts state machine.
    planning: PlanModule,
    /// The planning screen's map view (camps and spawn pool), read once from the public arena layers at reset.
    plan_map: PlanMap,
    /// The stats-file choice biases the planning module reads (empty: the learning store is P-BOTS-5).
    plan_learned: PlanLearned,
    /// The Knowledge layer: the counter wheels this bot knows and its fixed mob-share errors, drawn once at reset.
    knowledge: Option<Knowledge>,
    /// The loot/choice executor (world.ts actLoot, strategy.ts loot, chests.ts).
    loot: Loot,
    /// The latest observation's prop and reward-chest rows with the handles that observation delivered: the only source
    /// of a Pickup/Choose handle (a key absent from it is dropped, never guessed).
    facts: LootFacts,
}

impl HumanBot {
    pub fn new(tier: TierId, persona: PersonaId) -> Self {
        Self {
            tier,
            persona,
            humanizer: None,
            perception: Perception::default(),
            map: None,
            motor: Rng::new(1),
            lapse: Rng::new(2),
            decide: Rng::new(3),
            me: None,
            ids: Vec::new(),
            stimuli: Vec::new(),
            prev_hp_frac: 0.,
            low_hp_prev_share: 1.,
            roam: None,
            memory: None,
            brain: Brain::default(),
            world: WorldTactics::default(),
            wish: WishModule::new(),
            paths: None,
            planning: PlanModule::new(),
            plan_map: PlanMap::default(),
            plan_learned: PlanLearned::default(),
            knowledge: None,
            loot: Loot::new(),
            facts: LootFacts::default(),
        }
    }
    pub fn tier(&self) -> TierId {
        self.tier
    }
    /// The Knowledge layer as this seat drew it (the strategy/tactics consumers land in the next slice).
    pub fn knowledge(&self) -> Option<&Knowledge> {
        self.knowledge.as_ref()
    }
    pub fn persona(&self) -> PersonaId {
        self.persona
    }

    fn tier_params(&self) -> &'static TierParams {
        TierParams::by_id(self.tier)
    }
    fn persona_params(&self) -> &'static PersonaParams {
        PersonaParams::by_id(self.persona)
    }

    /// The front end's chosen target as the Wish module sees it: the nearest targetable player it would fight/approach, else
    /// the nearest living mob it would farm. (The bounded front end has no explicit goal enum; this mirrors its branch order.
    /// The fair view carries no line-of-sight flag yet, so a delivered actor counts as in sight -- documented narrowing.)
    fn front_foe(&self, p: &Percept) -> Option<WishFoe> {
        let self_at = rh_sim::Vec2::new(p.self_view.x, p.self_view.y);
        let nearest_player = p
            .fighters
            .iter()
            .filter(|f| f.status == "alive" && f.targetable)
            .map(|f| (f, rh_sim::math::hypot(f.x - self_at.x, f.y - self_at.y)))
            .min_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((f, _)) = nearest_player {
            return Some(WishFoe {
                id: f.id.clone(),
                x: f.x,
                y: f.y,
                mob: false,
                targetable: f.targetable,
                los: true,
            });
        }
        let nearest_mob = p
            .mobs
            .iter()
            .filter(|m| m.status == "alive")
            .map(|m| (m, rh_sim::math::hypot(m.x - self_at.x, m.y - self_at.y)))
            .min_by(|a, b| a.1.total_cmp(&b.1));
        nearest_mob.map(|(m, _)| WishFoe {
            id: m.id.clone(),
            x: m.x,
            y: m.y,
            mob: true,
            targetable: true,
            los: true,
        })
    }

    /// Candidate generation is still the bounded compatibility front end, not source strategy.ts.
    /// Its goal is now retained and executed on the source brain's cadence.
    fn choose_goal(&mut self, p: &Percept) -> Goal {
        let at = rh_sim::Vec2::new(p.self_view.x, p.self_view.y);
        if let Some(f) = p
            .fighters
            .iter()
            .filter(|f| f.status == "alive" && f.targetable)
            .min_by(|a, b| {
                rh_sim::math::hypot(a.x - at.x, a.y - at.y)
                    .total_cmp(&rh_sim::math::hypot(b.x - at.x, b.y - at.y))
            })
        {
            return Goal::Fight {
                target: f.id.clone(),
            };
        }
        if let Some(m) = p
            .mobs
            .iter()
            .filter(|m| m.status == "alive")
            .min_by(|a, b| {
                rh_sim::math::hypot(a.x - at.x, a.y - at.y)
                    .total_cmp(&rh_sim::math::hypot(b.x - at.x, b.y - at.y))
            })
        {
            return Goal::Farm {
                target: m.id.clone(),
            };
        }
        if matches!(self.brain.status, GoalStatus::Done | GoalStatus::Failed) {
            self.roam = None;
        }
        if self.roam.is_none() {
            let Some(map) = self.map.as_ref() else {
                return Goal::Idle;
            };
            self.roam = Some(rh_sim::Vec2::new(
                self.decide.next_f64() * map.map_w(),
                self.decide.next_f64() * map.map_h(),
            ));
        }
        Goal::Roam {
            to: self.roam.expect("selected above"),
            why: "compatibility roam",
        }
    }
    fn compatibility_tactics(&self, p: &Percept, stimuli: &[Stimulus]) -> Output {
        let found = match &self.brain.goal {
            Goal::Fight { target } => p
                .fighters
                .iter()
                .find(|f| f.id == *target && f.status == "alive" && f.targetable)
                .map(|f| (f.id.clone(), f.x, f.y, false)),
            Goal::Farm { target } => p
                .mobs
                .iter()
                .find(|m| m.id == *target && m.status == "alive")
                .map(|m| (m.id.clone(), m.x, m.y, true)),
            _ => None,
        };
        let Some((id, x, y, mob)) = found else {
            return Output {
                intents: vec![],
                status: GoalStatus::Failed,
                why: "compatibility target not visible",
                attacking: false,
            };
        };
        let distance = rh_sim::math::hypot(x - p.self_view.x, y - p.self_view.y);
        let timing = stimuli
            .iter()
            .find(|s| s.kind == StimulusKind::NewThreat && s.subject.as_deref() == Some(&id))
            .map_or(IntentTiming::Step {}, |s| IntentTiming::React {
                stimulus: s.clone(),
            });
        let lock = if mob {
            distance <= 40.
        } else {
            distance <= self.persona_params().player_threat.max(200.)
        };
        let intents = if lock {
            vec![Intent {
                body: IntentBody::Lock {
                    target: id,
                    at: rh_sim::Vec2::new(x, y),
                },
                priority: crate::bots::types::PRIORITY_COMBAT,
                timing,
                why: "compatibility engage".into(),
            }]
        } else if !mob || distance <= self.tier_params().route.reach {
            vec![Intent {
                body: IntentBody::Move {
                    to: rh_sim::Vec2::new(x, y),
                },
                priority: crate::bots::types::PRIORITY_GOAL,
                timing: IntentTiming::Step {},
                why: "compatibility approach".into(),
            }]
        } else {
            vec![]
        };
        Output {
            intents,
            status: GoalStatus::Running,
            why: "compatibility combat",
            attacking: lock,
        }
    }
}

impl Policy for HumanBot {
    fn input_requirements(&self) -> crate::InputRequirements {
        crate::InputRequirements {
            inventory: true,
            owner_combat: true,
        }
    }
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: format!("human-{}-{}", self.tier.as_str(), self.persona.as_str()),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn stats(&self) -> Option<crate::PolicyStats> {
        let h = self.humanizer.as_ref()?;
        let s = h.stats();
        Some(crate::PolicyStats {
            commands: crate::bots::types::COMMAND_TYPES
                .iter()
                .map(|t| (t.as_str().to_owned(), s.command(*t)))
                .collect(),
            reactions: s
                .reactions
                .iter()
                .map(|(k, v)| (k.as_str().to_owned(), v.clone()))
                .collect(),
            target_clicks: s.target_clicks,
            click_missed: s.click_missed,
            click_wrong: s.click_wrong,
            hesitations: s.hesitations,
            lapses: s.lapses,
            throttled: s.throttled,
            superseded: s.superseded,
            apm_peak: s.apm_peak,
        })
    }
    fn reset(&mut self, m: &MatchStart) {
        // Source brain.ts 141-147: independent stream seeds derive(cfg.seed, 0/1/2) for decide/motor/lapse. The
        // source cfg.seed domain is 32-bit, so use the existing low-32 convention; the high seed half is not a source
        // input. Knowledge keeps its own derive(seed, 3) stream below.
        let source_seed = m.seed as u32;
        self.decide = Rng::new(derive(source_seed, 0));
        self.motor = Rng::new(derive(source_seed, 1));
        self.lapse = Rng::new(derive(source_seed, 2));
        let map = BotMap::from_tile_map(&m.arena.map);
        self.map = Some(map.clone());
        self.humanizer = Some(Humanizer::new(TierParams::by_id(self.tier), map));
        self.perception.reset();
        self.me = Some(m.me);
        self.ids.clear();
        self.stimuli.clear();
        self.prev_hp_frac = 0.;
        self.low_hp_prev_share = 1.;
        self.roam = None;
        self.memory = PlayerRef::new(m.me.0)
            .ok()
            .and_then(|viewer| Memory::new(Epoch(1), viewer, self.tier, MAX_RECORDS).ok());
        self.brain = Brain::default();
        self.world.reset();
        self.wish.reset_in(&m.arena.map, m.frost_wish);
        self.paths = Some(RoomPathService::new(&m.arena.map, PathBudget::default()));
        self.planning.reset();
        self.plan_map = PlanMap::from_arena(&m.arena);
        self.plan_learned = PlanLearned::default();
        self.loot.reset();
        self.facts = LootFacts::default();
        // Source brain.ts 141-147: the Knowledge layer has its own stream, mulberry32(derive(cfg.seed, 3)); the
        // decision stream is untouched, so the first decision draw is the decision stream's first draw.
        self.knowledge = Some(Knowledge::create(
            TierParams::by_id(self.tier),
            &mut Rng::new(derive(m.seed as u32, 3)),
        ));
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }
    // Legacy Vec callbacks cannot carry a typed refusal. They deliberately do nothing; live
    // dispatch uses decide_input_into, which explicitly refuses a raw Observation before mutation.
    fn decide_into(&mut self, _: &Observation, _: &mut Vec<PublicCommand>) {}
    fn input_kind(&self) -> InputKind {
        InputKind::Delivered14
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        let InputPreview::Delivered14(frame) = input else {
            return Err(InputRefusal::RequiresDelivered14);
        };
        self.check_frame(frame)
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        self.check_input(input.preview())?;
        let PolicyInput::Delivered14(accepted) = input else {
            unreachable!()
        };
        self.decide_frame_into(accepted.frame(), out);
        Ok(())
    }
}

#[cfg(test)]
impl HumanBot {
    /// Component comparison only: consumes checked public data, not a live handoff receipt.
    pub(crate) fn component_commands(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let frame = crate::delivery::test_support::frame(obs);
        if self.check_frame(&frame).is_err() {
            return Vec::new();
        }
        let mut out = Vec::new();
        self.decide_frame_into(&frame, &mut out);
        out
    }
}

impl HumanBot {
    fn check_frame(&self, obs: &Frame14) -> Result<(), InputRefusal> {
        if Some(PlayerId(obs.context().viewer.get())) != self.me {
            return Err(InputRefusal::InvalidOwner);
        }
        let Some(owner) = obs.owner.as_ref() else {
            return Ok(());
        };
        if Some(PlayerId(owner.id)) != self.me {
            return Err(InputRefusal::InvalidOwner);
        }
        if obs.phase != 3 {
            if obs.collections.inventory.is_none() {
                return Err(InputRefusal::InventoryUnavailable);
            }
            if obs.owner_combat.is_none() {
                return Err(InputRefusal::OwnerCombatUnavailable);
            }
        }
        let players = crate::bots::perception::memory_players(obs)
            .map_err(|_| InputRefusal::MemoryUnavailable)?;
        let viewer = PlayerRef::new(owner.id).map_err(|_| InputRefusal::InvalidOwner)?;
        self.memory
            .as_ref()
            .ok_or(InputRefusal::MemoryUnavailable)?
            .check_scene(Scene {
                epoch: obs.context().epoch,
                viewer,
                now: obs.source_time,
                owner: Some(OwnerSight {
                    at: rh_sim::Vec2::new(f64::from(owner.x), f64::from(owner.y)),
                    status: crate::delivery::frame::status(owner.status),
                }),
                players: &players,
            })
            .map_err(|_| InputRefusal::ClockResetRequired)
    }
    fn decide_frame_into(&mut self, obs: &Frame14, out: &mut Vec<PublicCommand>) {
        let Some(owner) = obs.owner.as_ref() else {
            return;
        };
        let Ok(players) = crate::bots::perception::memory_players(obs) else {
            return;
        };
        let Some(memory) = self.memory.as_mut() else {
            return;
        };
        let Ok(viewer) = PlayerRef::new(owner.id) else {
            return;
        };
        if memory
            .observe_scene(Scene {
                epoch: obs.context().epoch,
                viewer,
                now: obs.source_time,
                owner: Some(OwnerSight {
                    at: rh_sim::Vec2::new(f64::from(owner.x), f64::from(owner.y)),
                    status: crate::delivery::frame::status(owner.status),
                }),
                players: &players,
            })
            .is_err()
        {
            return;
        }
        let memory_stimuli = memory.stimuli().to_vec();
        let still_since = memory
            .own_motion()
            .expect("accepted owner scene")
            .still_since;
        if obs.phase == 3 {
            // The planning screen has no goal and no tactics: the module reads the private deal and answers it, exactly as
            // the source brain's planning branch does. Its intents are menu commands, converted 1:1 here.
            let now = obs.source_time;
            let deal = obs.collections.plan.as_ref().map(|view| PlanDeal {
                ends_at: view.ends_at,
                spawns: view.spawns.map(|v| v.map_or(-1, |n| n as i32)),
                taken: view.taken,
                pick: view.pick.map_or(-1, |n| n as i8),
                boons: view.boons.clone(),
                boon: view.boon.map_or(-1, |n| n as i8),
            });
            let faction = obs
                .owner
                .as_ref()
                .and_then(|me| rh_sim::FactionId::ALL.get(me.faction as usize).copied());
            let tier = self.tier;
            let Self {
                planning,
                plan_map,
                plan_learned,
                decide,
                lapse,
                ..
            } = self;
            planning.observe(now, deal.as_ref(), tier, decide);
            let intent = planning.intents(
                now,
                true,
                tier,
                plan_map,
                faction,
                None,
                plan_learned,
                decide,
                lapse,
            );
            if let Some(intent) = intent {
                out.push(PublicCommand::Plan {
                    spawn: intent.spawn,
                    boon: intent.boon,
                    ready: intent.ready,
                });
            }
            return;
        }
        let tier = self.tier_params();
        let Some(frame) = self.perception.build(obs, tier.attention.central) else {
            return;
        };
        self.ids = frame.ids;
        let frame_hit_at = frame.hit_at;
        let frame_fighter_hits = frame.fighter_hits;
        self.facts = frame.loot;
        let p = frame.percept;
        self.wish.absorb_hits(frame_hit_at, &frame_fighter_hits);
        if p.self_view.max_hp > 0. {
            let frac = p.self_view.hp / p.self_view.max_hp;
            if self.prev_hp_frac > 0. && frac + 1e-12 < self.prev_hp_frac {
                self.stimuli.push(Stimulus {
                    kind: StimulusKind::HpLoss,
                    at: p.now,
                    subject: Some("me".into()),
                    central: true,
                    value: Some((self.prev_hp_frac - frac) * p.self_view.max_hp),
                });
            }
            if self.low_hp_prev_share >= 0.5 && frac < 0.5 {
                self.stimuli.push(Stimulus {
                    kind: StimulusKind::LowHp,
                    at: p.now,
                    subject: None,
                    central: true,
                    value: Some(frac),
                });
            }
            self.prev_hp_frac = frac;
            self.low_hp_prev_share = frac;
        }
        let mut stimuli = std::mem::take(&mut self.stimuli);
        stimuli.extend(memory_stimuli);
        // The Wish module sees the same observation and the front end's chosen foe, and its cast is offered first: arming it is
        // part of deciding it, and the humanizer arbitrates by priority and channel as it does for every intent.
        if let Some(paths) = self.paths.as_mut() {
            paths.budget_mut().start_tick();
            paths.set_frame(p.now, p.hud.gates_locked);
        }
        self.wish.observe(&p, self.tier, &mut self.decide);
        let toasts: Vec<String> = obs
            .events
            .iter()
            .flat_map(|b| &b.events)
            .filter_map(|e| match e {
                rh_protocol::WireEvent::Toast { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        let self_key = crate::bots::perception::player_key(PlayerId(owner.id));
        let (tier_id, persona_id) = (self.tier, self.persona);
        self.loot.observe(&loot_view(
            &p,
            &self.facts,
            &toasts,
            &self_key,
            still_since,
            tier_id,
            persona_id,
        ));
        let active = p.self_view.status == "alive" && p.hud.phase == "active";
        let mut intents = Vec::new();
        if active {
            let slip_active = self.wish.goal_active(&p);
            let mut changed = false;
            if self.brain.strategy_due(p.now, &stimuli) {
                self.loot.settle(&self.brain.goal, self.brain.status, p.now);
                // Bounded compatibility order: a reward chest (chests.ts goals), then a loot detour (strategy.ts loot),
                // then the front end's fight/farm/roam. Both stand down in a fight (engaged, a fighter or awake mob close),
                // where the source ranks them below the fight; the chest pick still rides along the fight goal.
                let looting = if slip_active {
                    None
                } else {
                    let v = loot_view(
                        &p,
                        &self.facts,
                        &toasts,
                        &self_key,
                        still_since,
                        tier_id,
                        persona_id,
                    );
                    self.paths
                        .as_mut()
                        .and_then(|paths| self.loot.chest_goal(&v, paths))
                        .or_else(|| self.loot.loot_goal(&v))
                };
                let goal = if slip_active {
                    Goal::WishSlip
                } else if let Some(goal) = looting {
                    goal
                } else {
                    self.choose_goal(&p)
                };
                changed = self.brain.adopt(goal, p.now, tier, &mut self.decide);
            }
            let toast = obs
                .events
                .iter()
                .flat_map(|b| &b.events)
                .any(|e| matches!(e, rh_protocol::WireEvent::Toast { .. }));
            if self.brain.tactics_due(p.now, changed, toast, &stimuli) {
                let foe = self.front_foe(&p);
                let Some(paths) = self.paths.as_mut() else {
                    return;
                };
                let module_goal = matches!(self.brain.goal, Goal::WishSlip);
                // The chests module goal runs its own act() alone (brain.ts act: a module goal takes no other module's intents).
                let chest_goal = matches!(self.brain.goal, Goal::Chest { .. });
                // A cached source module goal finishes through act(), even before the next
                // strategy deadline. An expired/cornered slip must not pin the retained goal.
                let extra = if (module_goal && !slip_active) || chest_goal {
                    vec![]
                } else {
                    self.wish.intents(
                        &p,
                        &stimuli,
                        foe.as_ref(),
                        self.tier,
                        &mut self.decide,
                        paths,
                    )
                };
                let output = if module_goal {
                    let moving = extra
                        .iter()
                        .any(|i| matches!(i.body, IntentBody::Move { .. }));
                    Output {
                        intents: extra,
                        status: if moving {
                            GoalStatus::Running
                        } else {
                            GoalStatus::Done
                        },
                        why: if moving {
                            "Wish slip module"
                        } else {
                            "Wish slip finished or cornered"
                        },
                        attacking: false,
                    }
                } else {
                    let v = loot_view(
                        &p,
                        &self.facts,
                        &toasts,
                        &self_key,
                        still_since,
                        tier_id,
                        persona_id,
                    );
                    let world = match &self.brain.goal {
                        Goal::Loot { container } => Some(self.loot.act_loot(container, &v, paths)),
                        Goal::Chest { chest } => Some(self.loot.act_chest(chest, &v, paths)),
                        goal => self.world.act(
                            goal,
                            WorldContext {
                                now: p.now,
                                at: rh_sim::Vec2::new(p.self_view.x, p.self_view.y),
                                still_since,
                            },
                            |a, b| paths.walk(a, b).is_some(),
                        ),
                    };
                    let mut base =
                        world.unwrap_or_else(|| self.compatibility_tactics(&p, &stimuli));
                    if !chest_goal {
                        // The chests module's intents hook: the one `choose`, whatever the bot is doing.
                        let mut extra = extra;
                        extra.extend(self.loot.intents(&self.brain.goal, &v));
                        base.intents = merge_intents(base.intents, extra);
                    }
                    base
                };
                self.brain.acted(p.now, &output, tier, &mut self.decide);
                intents = output.intents;
            }
        }
        let Some(humanizer) = self.humanizer.as_mut() else {
            return;
        };
        {
            let mut ctx = Context {
                p: &p,
                engaged: matches!(
                    p.self_view.owner_lock,
                    Some(crate::bots::types::OwnerLock::Held { .. })
                ),
                motor: &mut self.motor,
                lapse: &mut self.lapse,
            };
            humanizer.submit(&intents, &mut ctx);
        }
        let cmds = {
            let mut ctx = Context {
                p: &p,
                engaged: matches!(
                    p.self_view.owner_lock,
                    Some(crate::bots::types::OwnerLock::Held { .. })
                ),
                motor: &mut self.motor,
                lapse: &mut self.lapse,
            };
            humanizer.release(&mut ctx)
        };
        for miss in humanizer.drain_misses() {
            self.stimuli.push(Stimulus {
                kind: StimulusKind::ClickMissed,
                at: miss.at,
                subject: Some(miss.target),
                central: true,
                value: None,
            });
        }
        for timed in cmds {
            let before = out.len();
            self.emit(timed.cmd.clone(), out);
            if out.len() != before {
                if let Some(memory) = self.memory.as_mut() {
                    memory.note_sent(&timed);
                }
            }
        }
    }
}

impl HumanBot {
    fn emit(&self, cmd: crate::bots::types::Command, out: &mut Vec<PublicCommand>) {
        emit_command(
            cmd,
            None,
            &HumanRefs {
                ids: &self.ids,
                facts: &self.facts,
            },
            out,
        );
    }
}

/// What a released command may name: the references of the accepted frame it was decided on. Anything else resolves to
/// `None` and the command is dropped (never a fabricated actor, item or chest).
pub(crate) trait CommandRefs {
    fn actor(&self, id: &str) -> Option<PlayerId>;
    fn pickup(&self, _id: &str) -> Option<u32> {
        None
    }
    fn chest(&self, _id: &str) -> Option<u32> {
        None
    }
}

/// HumanBot's references: its rendered actor keys, and the container/chest keys of the latest accepted observation (a
/// key resolves only to the handle that observation delivered for that public row; an unknown key is dropped, never
/// guessed and never a row index).
struct HumanRefs<'a> {
    ids: &'a [(String, PlayerId)],
    facts: &'a crate::bots::perception::LootFacts,
}
impl CommandRefs for HumanRefs<'_> {
    fn actor(&self, id: &str) -> Option<PlayerId> {
        self.ids
            .iter()
            .find(|(rendered, _)| rendered == id)
            .map(|(_, real)| *real)
    }
    fn pickup(&self, id: &str) -> Option<u32> {
        self.facts
            .props
            .iter()
            .find(|p| p.key == id)
            .map(|p| p.handle.get())
    }
    fn chest(&self, id: &str) -> Option<u32> {
        self.facts
            .chests
            .iter()
            .find(|c| c.key == id)
            .map(|c| c.handle.get())
    }
}

/// The one mapping from a released source command to the public proposal a seat submits (shared by HumanBot and
/// BrainBot). `seq` is the Brain's stamped move/stop order number (None: unstamped).
pub(crate) fn emit_command(
    cmd: crate::bots::types::Command,
    seq: Option<u8>,
    refs: &dyn CommandRefs,
    out: &mut Vec<PublicCommand>,
) {
    use crate::bots::types::Command as C;
    match cmd {
        C::Move { x, y } => out.push(PublicCommand::Move { x, y, seq }),
        C::Stop {} => out.push(PublicCommand::Stop { seq }),
        C::Target { id } => {
            if let Some(actor) = refs.actor(&id) {
                out.push(PublicCommand::Target { actor });
            }
        }
        C::Attack { a } => out.push(PublicCommand::Attack { a, t: None }),
        C::Release { a } => out.push(PublicCommand::Release { a, t: None }),
        C::Swap { slot } => out.push(PublicCommand::Swap { slot: Some(slot) }),
        C::Cast { slot, x, y, id } => {
            let slot = match slot.as_str() {
                "wish" => rh_sim::abilities::Slot::Wish,
                "q" => rh_sim::abilities::Slot::Q,
                "e" => rh_sim::abilities::Slot::E,
                _ => return,
            };
            out.push(PublicCommand::Cast {
                slot,
                x,
                y,
                id: id.as_deref().and_then(|id| refs.actor(id)),
                t: None,
                seq: None,
            });
        }
        C::Plan { spawn, boon, ready } => out.push(PublicCommand::Plan { spawn, boon, ready }),
        C::Pickup { container_id } => {
            if let Some(handle) = refs
                .pickup(&container_id)
                .and_then(rh_sim::PickupHandle::new)
            {
                out.push(PublicCommand::Pickup { handle });
            }
        }
        C::Choose { chest, pick, .. } => {
            if let Some(handle) = refs
                .chest(&chest)
                .and_then(rh_sim::reward_chests::RewardChestHandle::from_wire)
            {
                out.push(PublicCommand::Choose { handle, pick });
            }
        }
    }
}

/// The loot/choice executor's view of one accepted percept (plain borrows; no state handle).
fn loot_view<'a>(
    p: &'a Percept,
    facts: &'a LootFacts,
    toasts: &'a [String],
    self_key: &'a str,
    still_since: f64,
    tier: TierId,
    persona: PersonaId,
) -> LootView<'a> {
    LootView {
        now: p.now,
        at: rh_sim::Vec2::new(p.self_view.x, p.self_view.y),
        alive: p.self_view.status == "alive",
        active: p.hud.phase == "active",
        hp: p.self_view.hp,
        max_hp: p.self_view.max_hp,
        effects: p.self_view.effects,
        weapons: p.self_view.weapons,
        slot: p.self_view.slot,
        faction: p.self_view.faction,
        self_key,
        fighters: &p.fighters,
        mobs: &p.mobs,
        facts,
        gates_locked: p.hud.gates_locked,
        toasts,
        still_since,
        engaged: matches!(
            p.self_view.owner_lock,
            Some(crate::bots::types::OwnerLock::Held { .. })
        ),
        persona: PersonaParams::by_id(persona),
        tier: TierParams::by_id(tier),
    }
}

/// P-BOTS repair (Knowledge stream): the seat-level regression for the reset wiring. The source brain (brain.ts 141-147)
/// creates the Knowledge layer from its own stream, mulberry32(derive(cfg.seed, 3)), before any decision; the port used
/// to draw it from the decision stream (70 draws), which moved every later decision. The same source constructor also
/// installs independent decide/motor/lapse streams derive(seed, 0/1/2); see reset_stream_tests below.
#[cfg(test)]
mod knowledge_repair_reset_tests {
    use super::*;
    use crate::bots::types::TIERS;
    use rh_sim::constants::TICK_MS;

    fn start(seed: u64) -> MatchStart {
        MatchStart {
            me: PlayerId(1),
            seed,
            arena: std::sync::Arc::new(rh_sim::arenas::practice_arena()),
            content_hash: rh_sim::content::content_hash(),
            observation_version: rh_sim::OBSERVATION_VERSION,
            tick_ms: TICK_MS,
            frost_wish: rh_sim::FrostWish::Freeze,
        }
    }

    #[test]
    fn knowledge_repair_reset_uses_the_separate_tag3_stream() {
        let tier = TierId::Normal;
        for seed in [0u64, 1, 7, 42] {
            let mut bot = HumanBot::new(tier, PersonaId::Farmer);
            bot.reset(&start(seed));
            // (1) Knowledge is the separate tag3 construction (source brain.ts 146-147).
            let expected = Knowledge::create(
                TierParams::by_id(tier),
                &mut Rng::new(derive(seed as u32, 3)),
            );
            assert_eq!(
                bot.knowledge(),
                Some(&expected),
                "seed {seed}: reset must build Knowledge from mulberry32(derive(seed, 3))"
            );
            // The old wiring (Knowledge drawn from the decision stream) is a different layer: the regression cannot pass
            // by coincidence for these declared seeds.
            let wrong = Knowledge::create(
                TierParams::by_id(tier),
                &mut Rng::new(derive(seed as u32, 0)),
            );
            assert_ne!(
                &wrong, &expected,
                "seed {seed}: the decision stream is not the tag3 stream"
            );
            // (2) The decision stream is the source derive(seed, 0) stream and was not consumed: its next draw is
            // that stream's first draw.
            let mut decide = Rng::new(derive(seed as u32, 0));
            assert_eq!(
                bot.decide.next_f64().to_bits(),
                decide.next_f64().to_bits(),
                "seed {seed}: reset must not advance the decision stream"
            );
        }
    }

    #[test]
    fn knowledge_repair_tag3_vectors_are_the_source_derived_ones() {
        // The packet's source-derived vector; the corpus test also checks these against the captured source derive.
        assert_eq!(derive(0, 3), 3_971_731_199);
        assert_eq!(derive(1, 3), 197_380_189);
        assert_eq!(derive(7, 3), 2_057_029_952);
        assert_eq!(derive(42, 3), 3_268_108_958);
        assert_eq!(derive(u32::MAX, 3), 1_587_572_149);
    }

    #[test]
    fn knowledge_repair_seat_tiers_still_draw_their_own_knowledge() {
        // The tier table drives the layer (the capture varies it): a blind and a seer tier build different Knowledge.
        let start = start(7);
        let mut easy = HumanBot::new(TierId::Easy, PersonaId::Hunter);
        easy.reset(&start);
        let mut hard = HumanBot::new(TierId::Hard, PersonaId::Hunter);
        hard.reset(&start);
        assert_ne!(easy.knowledge(), hard.knowledge());
        let tier = TierParams::by_id(TierId::Easy);
        assert_eq!(
            tier.knowledge, TIERS[0].knowledge,
            "the layer is built from the tier table"
        );
    }
}

#[cfg(test)]
mod connected_tests;
#[cfg(test)]
mod loot_seat_tests;
#[cfg(test)]
mod reset_stream_tests;
