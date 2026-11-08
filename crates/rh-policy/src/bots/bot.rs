//! The human-like seat: a Policy that reads only Observation (C-OBS), decides through the ported hand, and proposes
//! through the one validated input path (C-INPUT). docs/BOTS.md 4 describes the legacy layers; this is the bounded core
//! slice: fair perception -> a small goal/tactics front end -> the ported humanizer -> PublicCommands. The legacy memory,
//! strategy scoring and feature modules are P-BOTS-2..4 and remain unported.
use crate::bots::clicks::BotMap;
use crate::bots::humanizer::{Context, Humanizer};
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{PathBudget, RoomPathService};
use crate::bots::perception::Perception;
use crate::bots::planning::{PlanDeal, PlanLearned, PlanMap, PlanModule};
use crate::bots::random::{derive, Rng};
use crate::bots::types::{
    Intent, IntentBody, IntentTiming, Percept, PersonaId, PersonaParams, Stimulus, StimulusKind,
    TierId, TierParams,
};
use crate::bots::wish::{WishFoe, WishModule};
use crate::{MatchStart, Policy, PolicySpec, POLICY_CONTRACT_VERSION};
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
    roam: Option<rh_sim::Vec2>,
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
            roam: None,
            wish: WishModule::new(),
            paths: None,
            planning: PlanModule::new(),
            plan_map: PlanMap::default(),
            plan_learned: PlanLearned::default(),
            knowledge: None,
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
    /// The decision stream's seed for a seat seed (unchanged by the Knowledge repair; the other streams use their own
    /// hashes and are not touched either).
    fn decide_seed(seed: u64) -> u32 {
        (seed as u32).wrapping_mul(0x27d4_eb2d) ^ 0x1b56_c4e9
    }
    fn persona_params(&self) -> &'static PersonaParams {
        PersonaParams::by_id(self.persona)
    }
    fn resolve(&self, id: &str) -> Option<PlayerId> {
        self.ids
            .iter()
            .find(|(rendered, _)| rendered == id)
            .map(|(_, real)| *real)
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

    /// The decision front end: one goal (fight the nearest enemy, else walk toward it, else roam), turned into intents.
    fn intents(&mut self, p: &crate::bots::types::Percept, stimuli: &[Stimulus]) -> Vec<Intent> {
        let tier = self.tier_params();
        let persona = self.persona_params();
        let now = p.now;
        let self_at = rh_sim::Vec2::new(p.self_view.x, p.self_view.y);
        let mut intents = Vec::new();
        let nearest = p
            .fighters
            .iter()
            .filter(|f| f.status == "alive" && f.targetable)
            .map(|f| (f, rh_sim::math::hypot(f.x - self_at.x, f.y - self_at.y)))
            .min_by(|a, b| a.1.total_cmp(&b.1));
        let nearest_mob = p
            .mobs
            .iter()
            .filter(|m| m.status == "alive")
            .map(|m| (m, rh_sim::math::hypot(m.x - self_at.x, m.y - self_at.y)))
            .min_by(|a, b| a.1.total_cmp(&b.1));
        let engage_range = persona.player_threat.max(200.);
        if let Some((target, dist)) = nearest {
            if dist <= engage_range {
                let fresh = stimuli.iter().find(|s| {
                    s.kind == StimulusKind::NewThreat
                        && s.subject.as_deref() == Some(target.id.as_str())
                });
                let timing = match fresh {
                    Some(stim) => IntentTiming::React {
                        stimulus: stim.clone(),
                    },
                    None => IntentTiming::Step {},
                };
                intents.push(Intent {
                    body: IntentBody::Lock {
                        target: target.id.clone(),
                        at: rh_sim::Vec2::new(target.x, target.y),
                    },
                    priority: crate::bots::types::PRIORITY_COMBAT,
                    timing,
                    why: "human-bot engage".into(),
                });
            } else {
                intents.push(Intent {
                    body: IntentBody::Move {
                        to: rh_sim::Vec2::new(target.x, target.y),
                    },
                    priority: crate::bots::types::PRIORITY_GOAL,
                    timing: IntentTiming::Step {},
                    why: "human-bot approach".into(),
                });
            }
        } else if let Some((mob, dist)) = nearest_mob {
            // Farm the nearest mob once it is reasonably close; the bounded front end does not route camps (P-BOTS-4).
            if dist <= tier.route.reach && dist > 40. {
                intents.push(Intent {
                    body: IntentBody::Move {
                        to: rh_sim::Vec2::new(mob.x, mob.y),
                    },
                    priority: crate::bots::types::PRIORITY_GOAL,
                    timing: IntentTiming::Step {},
                    why: "human-bot farm".into(),
                });
            } else if dist <= 40. {
                intents.push(Intent {
                    body: IntentBody::Lock {
                        target: mob.id.clone(),
                        at: rh_sim::Vec2::new(mob.x, mob.y),
                    },
                    priority: crate::bots::types::PRIORITY_COMBAT,
                    timing: IntentTiming::Step {},
                    why: "human-bot farm lock".into(),
                });
            }
        } else {
            // Roam: pick a fresh point from the policy's own decide stream when the last one is reached.
            let need = self
                .roam
                .is_none_or(|r| rh_sim::math::hypot(r.x - self_at.x, r.y - self_at.y) < 64.);
            if need {
                let map = self.map.clone().expect("map at reset");
                let x = self.decide.next_f64() * map.map_w();
                let y = self.decide.next_f64() * map.map_h();
                self.roam = Some(rh_sim::Vec2::new(x, y));
            }
            if let Some(to) = self.roam {
                intents.push(Intent {
                    body: IntentBody::Move { to },
                    priority: crate::bots::types::PRIORITY_CHORE,
                    timing: IntentTiming::Step {},
                    why: "human-bot roam".into(),
                });
            }
        }
        let _ = now;
        intents
    }
}

impl Policy for HumanBot {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: format!("human-{}-{}", self.tier.as_str(), self.persona.as_str()),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, m: &MatchStart) {
        let seed = m.seed;
        self.motor = Rng::new((seed as u32) ^ 0x9e37_79b9);
        self.lapse = Rng::new(((seed >> 32) as u32) ^ 0x85eb_ca6b);
        self.decide = Rng::new(Self::decide_seed(seed));
        let map = BotMap::from_tile_map(&m.arena.map);
        self.map = Some(map.clone());
        self.humanizer = Some(Humanizer::new(TierParams::by_id(self.tier), map));
        self.perception.reset();
        self.me = Some(m.me);
        self.ids.clear();
        self.stimuli.clear();
        self.prev_hp_frac = 0.;
        self.roam = None;
        self.wish.reset(&m.arena.map);
        self.paths = Some(RoomPathService::new(&m.arena.map, PathBudget::default()));
        self.planning.reset();
        self.plan_map = PlanMap::from_arena(&m.arena);
        self.plan_learned = PlanLearned::default();
        // Source brain.ts 141-147: the Knowledge layer has its own stream, mulberry32(derive(cfg.seed, 3)); the
        // decision stream is untouched, so the first decision draw is the decision stream's first draw.
        self.knowledge = Some(Knowledge::create(
            TierParams::by_id(self.tier),
            &mut Rng::new(derive(seed as u32, 3)),
        ));
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        if obs.phase == rh_sim::Phase::Planning {
            // The planning screen has no goal and no tactics: the module reads the private deal and answers it, exactly as
            // the source brain's planning branch does. Its intents are menu commands, converted 1:1 here.
            let now = obs.server_time;
            let deal = obs.plan.as_ref().map(PlanDeal::from_view);
            let faction = obs.me.as_ref().map(|me| me.faction);
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
            if frac < self.persona_params().flee_hp {
                self.stimuli.push(Stimulus {
                    kind: StimulusKind::LowHp,
                    at: p.now,
                    subject: Some("me".into()),
                    central: true,
                    value: Some(frac),
                });
            }
            self.prev_hp_frac = frac;
        }
        let mut stimuli = std::mem::take(&mut self.stimuli);
        stimuli.extend(frame.stimuli);
        // The Wish module sees the same observation and the front end's chosen foe, and its cast is offered first: arming it is
        // part of deciding it, and the humanizer arbitrates by priority and channel as it does for every intent.
        if let Some(paths) = self.paths.as_mut() {
            paths.budget_mut().start_tick();
            paths.set_frame(p.now, p.hud.gates_locked);
        }
        self.wish.observe(&p, self.tier, &mut self.decide);
        let slip_active = self.wish.goal_active(&p);
        let foe = self.front_foe(&p);
        let mut intents = {
            let Some(paths) = self.paths.as_mut() else {
                return;
            };
            self.wish.intents(
                &p,
                &stimuli,
                foe.as_ref(),
                self.tier,
                &mut self.decide,
                paths,
            )
        };
        // While the Wish module holds the slip goal, the bot casts and walks away and locks nobody: the module goal is above
        // every front-end goal (legacy strategy scores it 1.4 over a flee at 1.1), so the front end's intents are not offered.
        if !slip_active {
            intents.extend(self.intents(&p, &stimuli));
        }
        let Some(humanizer) = self.humanizer.as_mut() else {
            return;
        };
        {
            let mut ctx = Context {
                p: &p,
                engaged: p.self_view.attack_target.is_some(),
                motor: &mut self.motor,
                lapse: &mut self.lapse,
            };
            humanizer.submit(&intents, &mut ctx);
        }
        let cmds = {
            let mut ctx = Context {
                p: &p,
                engaged: p.self_view.attack_target.is_some(),
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
            self.emit(timed.cmd, out);
        }
    }
}

impl HumanBot {
    fn emit(&self, cmd: crate::bots::types::Command, out: &mut Vec<PublicCommand>) {
        use crate::bots::types::Command as C;
        match cmd {
            C::Move { x, y } => out.push(PublicCommand::Move { x, y, seq: None }),
            C::Stop {} => out.push(PublicCommand::Stop { seq: None }),
            C::Target { id } => {
                if let Some(actor) = self.resolve(&id) {
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
                    id: id.as_deref().and_then(|id| self.resolve(id)),
                    t: None,
                    seq: None,
                });
            }
            C::Plan { spawn, boon, ready } => out.push(PublicCommand::Plan { spawn, boon, ready }),
            // Pickup and Choose need the delivered item/chest handle, which this bounded fair view does not carry yet.
            C::Pickup { .. } | C::Choose { .. } => {}
        }
    }
}

/// P-BOTS repair (Knowledge stream): the seat-level regression for the reset wiring. The source brain (brain.ts 141-147)
/// creates the Knowledge layer from its own stream, mulberry32(derive(cfg.seed, 3)), before any decision; the port used
/// to draw it from the decision stream (70 draws), which moved every later decision.
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
                &mut Rng::new(HumanBot::decide_seed(seed)),
            );
            assert_ne!(
                &wrong, &expected,
                "seed {seed}: the decision stream is not the tag3 stream"
            );
            // (2) The decision stream was not consumed: its next draw is the stream's first draw.
            let mut decide = Rng::new(HumanBot::decide_seed(seed));
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
