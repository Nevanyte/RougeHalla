//! The human-like seat: a Policy that reads only Observation (C-OBS), decides through the ported hand, and proposes
//! through the one validated input path (C-INPUT). docs/BOTS.md 4 describes the legacy layers; this is the bounded core
//! slice: fair perception -> a small goal/tactics front end -> the ported humanizer -> PublicCommands. The legacy memory,
//! strategy scoring and feature modules are P-BOTS-2..4 and remain unported.
use crate::bots::clicks::BotMap;
use crate::bots::humanizer::{Context, Humanizer};
use crate::bots::perception::Perception;
use crate::bots::random::Rng;
use crate::bots::types::{
    Intent, IntentBody, IntentTiming, PersonaId, PersonaParams, Stimulus, StimulusKind, TierId,
    TierParams,
};
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
    plan_sent: bool,
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
            plan_sent: false,
        }
    }
    pub fn tier(&self) -> TierId {
        self.tier
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
    fn resolve(&self, id: &str) -> Option<PlayerId> {
        self.ids
            .iter()
            .find(|(rendered, _)| rendered == id)
            .map(|(_, real)| *real)
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
            let need = self.roam.map_or(true, |r| {
                rh_sim::math::hypot(r.x - self_at.x, r.y - self_at.y) < 64.
            });
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
        self.decide = Rng::new((seed as u32).wrapping_mul(0x27d4_eb2d) ^ 0x1b56_c4e9);
        let map = BotMap::from_tile_map(&m.arena.map);
        self.map = Some(map.clone());
        self.humanizer = Some(Humanizer::new(TierParams::by_id(self.tier), map));
        self.perception.reset();
        self.me = Some(m.me);
        self.ids.clear();
        self.stimuli.clear();
        self.prev_hp_frac = 0.;
        self.roam = None;
        self.plan_sent = false;
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        if obs.phase == rh_sim::Phase::Planning {
            if !self.plan_sent {
                self.plan_sent = true;
                out.push(PublicCommand::Plan {
                    spawn: None,
                    boon: None,
                    ready: Some(true),
                });
            }
            return;
        }
        let tier = self.tier_params();
        let Some(frame) = self.perception.build(obs, tier.attention.central) else {
            return;
        };
        self.ids = frame.ids;
        let p = frame.percept;
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
        let intents = self.intents(&p, &stimuli);
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
