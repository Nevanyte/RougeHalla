//! The ported legacy Brain on a policy seat (P-BOT-BRAIN-LIVE-1): `BrainBot` composes the source `Percept` from the seat's
//! accepted [`Frame14`] only (`temporal_percept/brain/compose14.rs`, the owner-approved degraded fair profile), drives the
//! unchanged Brain (`temporal_percept/brain.rs`) and maps its released commands through the shared command mapper to
//! [`PublicCommand`]s, which the seat submits through `validate` + `Sim::submit` like a human's (C-INPUT).
//!
//! The Brain sees no `Sim`/`World`: its map is the match's public static map, its features the server's configuration,
//! its path service a room path service over that public map, and its randomness the low 32 bits of the seat's own seed
//! (source `cfg.seed`). A Brain-native failure is a typed refusal ([`InputRefusal::PolicyFailed`]); the seat then faults
//! the policy and its fallback (live: `HumanBot`) plays the rest of the match.

use std::sync::{Arc, Mutex};

use super::bot::{emit_command, CommandRefs};
use super::learning::LearnedBias;
use super::paths::PathBudget;
use super::temporal_percept::brain::compose14::{
    actor_key, brain_map, camp_ids, configured_features, ComposeStatic, Composer14, Refs,
};
use super::temporal_percept::brain::room_paths::ArenaPathService;
use super::temporal_percept::brain::{
    Brain, BrainCfgToken, SeatBrainConfig, SeatCallerServices, SeatLearnedBias, SeatModuleHost,
    SeatPathHandle, SeatRoomFrame, SeatRunResult,
};
use super::types::{PersonaId, PersonaParams, TierId, TierParams};
use super::view::Features;
use crate::delivery::Frame14;
use crate::{
    InputKind, InputPreview, InputRefusal, MatchStart, Policy, PolicyFinish, PolicyInput,
    PolicySpec, PolicyStats, POLICY_CONTRACT_VERSION,
};
use rh_sim::{Observation, PublicCommand, OBSERVATION_VERSION};

/// The feature verdicts a server configuration offers its Brain seats (bound once from the `SimConfig` and the public
/// map, never inferred from a frame's missing data).
pub fn brain_features(sim: &rh_sim::SimConfig, arena: &rh_sim::Arena) -> Features {
    configured_features(sim, &arena.map)
}

/// The learning store's frozen snapshot as the Brain's `cfg.learned` (source `deps.store.snapshot()`).
struct Learned(LearnedBias);
impl SeatLearnedBias for Learned {
    fn enabled(&self) -> bool {
        self.0.enabled()
    }
    fn bias(&self, key: &str) -> f64 {
        self.0.bias(key)
    }
}

/// One match's seated Brain: its composer, the Brain graph, the allowance it borrows per decision.
struct Seated {
    composer: Composer14,
    brain: Brain,
    budget: PathBudget,
    /// The references of the last composed frame (a released command names only those).
    refs: Refs,
    /// Wall-clock cost of each timed decision (ns), for the per-seat p99 report; never an input to a decision.
    decide_ns: Vec<u64>,
    /// The composer's share of each timed decision (ns).
    compose_ns: Vec<u64>,
}

/// The legacy Brain behind the policy seat contract.
pub struct BrainBot {
    tier: TierId,
    persona: PersonaId,
    features: Features,
    learned: LearnedBias,
    timing: bool,
    seated: Option<Seated>,
    /// Test-only: every composed percept record and the proposals decided from it.
    #[cfg(test)]
    tap: Option<Tap>,
}

#[cfg(test)]
pub(crate) type Tap =
    Arc<Mutex<Vec<(super::temporal_percept::brain::SeatBVal, Vec<PublicCommand>)>>>;

impl BrainBot {
    pub fn new(tier: TierId, persona: PersonaId, features: Features) -> Self {
        Self {
            tier,
            persona,
            features,
            learned: LearnedBias::NO_BIAS,
            timing: false,
            seated: None,
            #[cfg(test)]
            tap: None,
        }
    }

    /// The learning snapshot this bot's strategy reads its choice biases from (source `cfg.learned`).
    pub fn with_learned(mut self, learned: LearnedBias) -> Self {
        self.learned = learned;
        self
    }

    /// Record the wall-clock cost of every decision (diagnostics only: the measurement never reaches a decision).
    pub fn with_decision_timing(mut self) -> Self {
        self.timing = true;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_tap(mut self, tap: Tap) -> Self {
        self.tap = Some(tap);
        self
    }

    pub fn tier(&self) -> TierId {
        self.tier
    }
    pub fn persona(&self) -> PersonaId {
        self.persona
    }

    /// The per-decision wall-clock costs recorded so far (ns), when timing was asked for.
    pub fn decision_ns(&self) -> &[u64] {
        self.seated.as_ref().map_or(&[], |s| &s.decide_ns)
    }

    /// The composer's share of each timed decision (ns), in the same order as [`BrainBot::decision_ns`].
    pub fn compose_ns(&self) -> &[u64] {
        self.seated.as_ref().map_or(&[], |s| &s.compose_ns)
    }

    fn check_frame(&self, frame: &Frame14) -> Result<(), InputRefusal> {
        self.seated
            .as_ref()
            .ok_or(InputRefusal::MemoryUnavailable)?
            .composer
            .check(frame)
    }
}

impl Policy for BrainBot {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: format!("brain-{}-{}", self.tier.as_str(), self.persona.as_str()),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }

    fn stats(&self) -> Option<PolicyStats> {
        let stats = self.seated.as_ref()?.brain.stats();
        let s = &stats.humanizer;
        Some(PolicyStats {
            commands: super::types::COMMAND_TYPES
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
        self.seated = None;
        let tier: &'static TierParams = TierParams::by_id(self.tier);
        let persona: &'static PersonaParams = PersonaParams::by_id(self.persona);
        let map = Arc::new(brain_map(&m.arena));
        let statics = Arc::new(ComposeStatic {
            tick_ms: m.tick_ms,
            central: tier.attention.central,
            features: self.features.clone(),
            open: map.open.clone(),
            locked: map.locked.clone(),
            camp_ids: camp_ids(&m.arena),
        });
        let paths: SeatPathHandle = Arc::new(Mutex::new(Box::new(ArenaPathService::new(
            &map.open,
            &map.locked,
        ))));
        let host = SeatModuleHost::new();
        let id = actor_key(m.me.0);
        let config = SeatBrainConfig {
            id: id.clone(),
            name: id,
            // Source `cfg.seed` is 32-bit: the low half of the seat's own seed (HumanBot's convention).
            seed: m.seed as u32,
            tier,
            persona,
            map,
            features: self.features.clone(),
            modules: host.enabled_handles(&self.features),
            services: SeatCallerServices {
                paths,
                log: Arc::new(|_: &str| {}),
                learned: Arc::new(Learned(self.learned.clone())),
            },
            original_cfg: BrainCfgToken(0),
            service_label: "room".into(),
            trace_actor: None,
            recorder: None,
            #[cfg(test)]
            force_missing_module_paths: false,
        };
        let Ok(mut brain) = Brain::new(config) else {
            return;
        };
        brain.use_sample_scoped_mob_ids();
        self.seated = Some(Seated {
            composer: Composer14::new(m.me, self.tier, statics),
            brain,
            budget: PathBudget::default(),
            refs: Refs::default(),
            decide_ns: Vec::new(),
            compose_ns: Vec::new(),
        });
    }

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
        let PolicyInput::Delivered14(accepted) = input else {
            return Err(InputRefusal::RequiresDelivered14);
        };
        self.check_frame(accepted.frame())?;
        let timing = self.timing;
        let seated = self
            .seated
            .as_mut()
            .ok_or(InputRefusal::MemoryUnavailable)?;
        // Diagnostics only (the seat's budget is the one sanctioned clock): never read by a decision.
        #[allow(clippy::disallowed_methods)]
        let started = timing.then(std::time::Instant::now);
        let Some(composed) = seated.composer.compose(accepted)? else {
            return Ok(());
        };
        #[allow(clippy::disallowed_methods)]
        let composed_at = timing.then(std::time::Instant::now);
        seated.refs = composed.refs;
        #[cfg(test)]
        let base = out.len();
        seated.budget.start_tick();
        let released = seated
            .brain
            .tick(
                &composed.percept,
                &mut SeatRoomFrame {
                    budget: &mut seated.budget,
                },
            )
            .map_err(|_| InputRefusal::PolicyFailed)?;
        for command in released {
            let seq = command.seq.map(|s| s as u8);
            emit_command(command.cmd, seq, &seated.refs as &dyn CommandRefs, out);
        }
        #[cfg(test)]
        if let Some(tap) = &self.tap {
            tap.lock()
                .expect("tap")
                .push((composed.percept.raw.clone(), out[base..].to_vec()));
        }
        if let (Some(started), Some(composed_at)) = (started, composed_at) {
            let ns = |d: std::time::Duration| d.as_nanos().min(u128::from(u64::MAX)) as u64;
            seated.decide_ns.push(ns(started.elapsed()));
            seated
                .compose_ns
                .push(ns(composed_at.duration_since(started)));
        }
        Ok(())
    }

    fn finish(&mut self, result: Option<&rh_sim::RunResult>) -> Option<PolicyFinish> {
        let seated = self.seated.as_ref()?;
        let result = result.map(|r| SeatRunResult {
            outcome: match r.outcome {
                rh_sim::Outcome::Won => "won",
                rh_sim::Outcome::Draw => "draw",
                rh_sim::Outcome::Died => "died",
                rh_sim::Outcome::Mia => "mia",
            }
            .into(),
            place: f64::from(r.place),
            players: f64::from(r.players),
        });
        Some(PolicyFinish {
            choices: seated.brain.end(result.as_ref()).choices,
        })
    }

    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        Vec::new()
    }
    // A raw Observation is refused by the typed path (decide_input_into); the legacy callbacks do nothing.
    fn decide_into(&mut self, _: &Observation, _: &mut Vec<PublicCommand>) {}
}

#[cfg(test)]
mod tests;
