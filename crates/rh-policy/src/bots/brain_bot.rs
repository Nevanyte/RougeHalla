//! The ported legacy Brain on a policy seat (P-BOT-BRAIN-LIVE-1): `BrainBot` composes the source `Percept` from the seat's
//! accepted [`Frame14`] only (`temporal_percept/brain/compose14.rs`, the owner-approved degraded fair profile), drives the
//! unchanged Brain (`temporal_percept/brain.rs`) and maps its released commands through the shared command mapper to
//! [`PublicCommand`]s, which the seat submits through `validate` + `Sim::submit` like a human's (C-INPUT).
//!
//! The composer's setup is [`Setup14::public`] (the public map without the server's spawn points, the room's features,
//! the tier's attention share, the pinned delays: world 100 ms, self 0), and the Brain is not ticked while the
//! composition does not cover the view time yet (`Composed14::covered`, frames.ts:131).
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
    brain_map, configured_features, key_of, Refs, SeatComposer14, Setup14,
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
    composer: SeatComposer14,
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

    /// The composer setup of the seated match (tests: it is `Setup14::public`).
    #[cfg(test)]
    pub(crate) fn composer_setup(&self) -> Option<&Setup14> {
        self.seated.as_ref().map(|s| s.composer.setup())
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
        // Only what a client knows: the public map (no server spawn points), the room's features, the pinned delays.
        let setup = Setup14::public(&m.arena, self.features.clone(), tier.attention.central);
        let map = Arc::new(brain_map(&setup.arena));
        let paths: SeatPathHandle = Arc::new(Mutex::new(Box::new(ArenaPathService::new(
            &map.open,
            &map.locked,
        ))));
        let host = SeatModuleHost::new();
        let id = key_of(m.me.0);
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
            composer: SeatComposer14::new(m.me, self.tier, setup),
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
        if !composed.covered {
            // frames.ts:131: no percept until the ring covers the view time; the sample is retained, the Brain waits.
            return Ok(());
        }
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

/// P-BOT-BRAIN-RECONCILE-1 review notes: the map twin and a faulted seat's finish.
#[cfg(test)]
mod reconcile_tests;

/// P-BOT-BRAIN-RECONCILE-1: the seat composes with the public setup only (C-OBS), with the pinned delays.
#[cfg(test)]
mod setup_tests {
    use super::*;
    use crate::bots::temporal_percept::brain::compose14::{
        BRAIN_SELF_DELAY_MS, BRAIN_WORLD_DELAY_MS,
    };
    use rh_sim::{FactionId, Secrets, Sim, SimConfig};

    #[test]
    fn a_brain_seat_composes_with_the_public_setup() {
        let arena = crate::bots::temporal_percept::brain::compose14::test_support::seed1_arena();
        assert!(
            !arena.spawns.is_empty(),
            "premise: the server's arena has spawn points"
        );
        let config = SimConfig::default();
        let mut sim = Sim::new(config.clone(), arena.clone(), Secrets::from_seed(1));
        let me = sim
            .add_player("seat", Some(FactionId::Fire), true)
            .expect("seat");
        let features = brain_features(&config, &arena);
        let mut bot = BrainBot::new(TierId::Hard, PersonaId::Hunter, features.clone());
        assert!(
            bot.composer_setup().is_none(),
            "nothing seated before reset"
        );
        bot.reset(&MatchStart::of(&sim, me, 5));
        let setup = bot.composer_setup().expect("seated").clone();
        let public = Setup14::public(
            &arena,
            features,
            TierParams::by_id(TierId::Hard).attention.central,
        );
        assert_eq!(setup.world_delay_ms, BRAIN_WORLD_DELAY_MS);
        assert_eq!(BRAIN_SELF_DELAY_MS, 0.);
        assert_eq!(setup.world_delay_ms, public.world_delay_ms);
        assert_eq!(setup.attention_central, public.attention_central);
        assert_eq!(setup.features, public.features);
        assert!(setup.arena.spawns.is_empty(), "no server spawn points");
        assert_eq!(setup.arena.map.tiles, arena.map.tiles);
        assert_eq!(setup.arena.map.w, arena.map.w);
        assert_eq!(setup.arena.map.h, arena.map.h);
    }

    /// The cloud line's private plan deal (brief 6.3): a Brain seat in a source match with a planning phase sees the
    /// delivered deal as the source's immediate `private`/`plan` event, once per change of the plan group.
    #[test]
    fn a_brain_seat_sees_the_private_plan_deal_once_per_change() {
        use crate::{drive_seats, scripted, Seat};
        let arena = crate::bots::temporal_percept::brain::compose14::test_support::seed1_arena();
        let config = SimConfig {
            lifecycle: rh_sim::ArenaMode::Source(Default::default()),
            min_players: 1,
            lobby_seconds: 2.,
            fill_seconds: 1.,
            ..SimConfig::default()
        };
        let mut sim = Sim::new(config.clone(), arena.clone(), Secrets::from_seed(3));
        let me = sim
            .add_player("seat", Some(FactionId::Fire), true)
            .expect("seat");
        let tap: Tap = Arc::new(Mutex::new(Vec::new()));
        let mut seats = vec![Seat::new(
            &MatchStart::of(&sim, me, 9),
            Box::new(
                BrainBot::new(
                    TierId::Hard,
                    PersonaId::Hunter,
                    brain_features(&config, &arena),
                )
                .with_tap(tap.clone()),
            ),
            Box::new(scripted::Idle),
        )];
        seats[0].bind_fx(&sim).expect("unbound");
        let mut events = Vec::new();
        for _ in 0..400 {
            drive_seats(&mut sim, &mut seats, &events);
            events.clear();
            sim.step_into(&mut events);
        }
        assert_eq!(seats[0].fault, None);
        let deals: Vec<_> = tap
            .lock()
            .expect("tap")
            .iter()
            .flat_map(|(raw, _)| raw.get("events").and_then(|e| e.as_arr()).unwrap_or(&[]))
            .filter(|e| {
                e.get("kind").and_then(|k| k.as_str()) == Some("private")
                    && e.get("type").and_then(|k| k.as_str()) == Some("plan")
            })
            .filter_map(|e| e.get("msg").cloned())
            .collect();
        assert!(!deals.is_empty(), "the planning phase dealt a plan");
        for pair in deals.windows(2) {
            assert_ne!(pair[0], pair[1], "a deal is sent only when it changes");
        }
    }
}
