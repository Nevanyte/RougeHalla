//! Optional command-only tournament diagnostic. No simulation or observation state enters this queue.
//! Unlike the source manager's one shared line RNG, each seat owns an independent stream derived
//! from its policy seed. This is deliberately not a full source network/manager model.
use crate::tournament::mix;
use rh_policy::bots::Rng;
use rh_sim::{PlayerId, PublicCommand};
use std::collections::VecDeque;

/// Source BotManager.MAX_QUEUED, applied per seat BEFORE consuming a jitter draw.
const MAX_QUEUED: usize = 256;

struct Line {
    player: PlayerId,
    rng: Rng,
    last_arrival: f64,
    pending: VecDeque<(f64, PublicCommand)>,
}

pub(crate) struct CommandDelay {
    latency: f64,
    jitter: f64,
    lines: Vec<Line>,
}

impl CommandDelay {
    pub(crate) fn new(latency: f64, jitter: f64) -> Self {
        assert!(latency.is_finite() && latency >= 0. && jitter.is_finite() && jitter >= 0.);
        Self {
            latency,
            jitter,
            lines: Vec::new(),
        }
    }

    pub(crate) fn add_seat(&mut self, player: PlayerId, seed: u64) {
        self.lines.push(Line {
            player,
            rng: Rng::new(mix(seed as u32, 1)),
            last_arrival: f64::NEG_INFINITY,
            pending: VecDeque::new(),
        });
    }

    pub(crate) fn enqueue(&mut self, player: PlayerId, now: f64, command: PublicCommand) -> bool {
        let line = self
            .lines
            .iter_mut()
            .find(|l| l.player == player)
            .expect("owned seat");
        if line.pending.len() >= MAX_QUEUED {
            return false;
        }
        let arrival = line
            .last_arrival
            .max(now + self.latency + (line.rng.next_f64() * 2. - 1.) * self.jitter);
        line.last_arrival = arrival;
        line.pending.push_back((arrival, command));
        true
    }

    pub(crate) fn drain(&mut self, step_time: f64) -> Vec<(PlayerId, PublicCommand)> {
        let mut out = Vec::new();
        for line in &mut self.lines {
            while line
                .pending
                .front()
                .is_some_and(|(arrival, _)| *arrival <= step_time)
            {
                out.push((line.player, line.pending.pop_front().expect("front").1));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saturated_seat_refuses_before_jitter_draw_without_affecting_another_seat() {
        let command = PublicCommand::Stop { seq: None };
        let mut actual = CommandDelay::new(100., 80.);
        let mut control = CommandDelay::new(100., 80.);
        for queue in [&mut actual, &mut control] {
            queue.add_seat(PlayerId(1), 7);
            queue.add_seat(PlayerId(2), 8);
            for _ in 0..MAX_QUEUED {
                assert!(queue.enqueue(PlayerId(1), 0., command));
            }
        }
        for _ in 0..10 {
            assert!(!actual.enqueue(PlayerId(1), 0., command));
        }
        assert_eq!(actual.lines[0].pending.len(), MAX_QUEUED);
        assert!(actual.enqueue(PlayerId(2), 0., command));
        assert!(control.enqueue(PlayerId(2), 0., command));
        assert_eq!(actual.drain(1000.), control.drain(1000.));
        assert!(actual.enqueue(PlayerId(1), 1000., command));
        assert!(control.enqueue(PlayerId(1), 1000., command));
        assert_eq!(
            actual.lines[0].pending, control.lines[0].pending,
            "refused commands must consume neither jitter nor FIFO clock"
        );
    }
    struct ClickOnce {
        at: f64,
        interval: u32,
        fired: bool,
    }
    impl rh_policy::Policy for ClickOnce {
        fn spec(&self) -> rh_policy::PolicySpec {
            rh_policy::PolicySpec {
                name: "timed click".into(),
                version: "1".into(),
                contract: rh_policy::POLICY_CONTRACT_VERSION,
                observation_version: rh_sim::OBSERVATION_VERSION,
                decision_interval_ticks: self.interval,
            }
        }
        fn reset(&mut self, _: &rh_policy::MatchStart) {
            self.fired = false;
        }
        fn decide(&mut self, obs: &rh_sim::Observation) -> Vec<PublicCommand> {
            if !self.fired && obs.server_time >= self.at {
                self.fired = true;
                vec![PublicCommand::Stop { seq: Some(77) }]
            } else {
                Vec::new()
            }
        }
    }

    #[test]
    fn real_env_delivers_before_the_first_eligible_step_independently_of_decision_cadence() {
        use crate::{Agent, AgentSpec, Env, EnvConfig};
        // Source afterPatch clicks at `at`; beforeStep(stepT) drains arrival <= stepT.
        // Even zero delay cannot retroactively change the already-completed observation step.
        for (latency, interval, at, expected) in [
            (0., 1, 100., 150.),
            (1., 1, 100., 150.),
            (50., 1, 100., 150.),
            (100., 1, 100., 200.),
            (120., 1, 100., 250.),
            (100., 3, 200., 300.),
        ] {
            let agent = AgentSpec {
                profile: "clock".into(),
                faction: rh_sim::FactionId::Holy,
                bot: true,
                agent: Agent::Policy {
                    policy: Box::new(ClickOnce {
                        at,
                        interval,
                        fired: false,
                    }),
                },
            };
            let mut env = Env::new_delayed(
                EnvConfig {
                    arena: rh_sim::arenas::practice_arena(),
                    sim: rh_sim::SimConfig {
                        consumables: false,
                        ..Default::default()
                    },
                    max_ticks: 20,
                    record: true,
                },
                vec![agent],
                7,
                Some((latency, 0.)),
            );
            let id = env.sim.players()[0].id;
            let mut applied_at = None;
            for _ in 0..12 {
                env.advance(&[]);
                if env.sim.player(id).unwrap().motion.move_seq == 77 {
                    applied_at.get_or_insert(env.sim.server_time());
                }
            }
            assert_eq!(
                applied_at,
                Some(expected),
                "latency={latency}, cadence={interval}"
            );
            let stats = &env.seat_stats()[0].1;
            assert_eq!((stats.proposed, stats.accepted, stats.rejected), (1, 1, 0));
        }
    }
}
