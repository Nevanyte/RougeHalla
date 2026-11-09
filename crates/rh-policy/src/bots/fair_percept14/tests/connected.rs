//! Real accepted Seat/AsyncSeat -> retained public sample -> existing Memory/HumanBot
//! -> ordinary observer resolution + validate/Sim::submit. No full-Brain activation.
use super::{scene, *};
use crate::bots::{types::PersonaId, HumanBot};
use crate::{
    drive_seats_with, scripted, AsyncSeat, InputKind, InputPreview, InputRefusal,
    InputRequirements, MatchStart, Policy, PolicyInput, PolicySpec, Seat,
};
use rh_sim::{Command, PublicCommand, SightCache};
use std::sync::mpsc;
use std::time::{Duration, Instant};

struct Receipt {
    frame: Frame14,
    memory: Memory,
    commands: Vec<PublicCommand>,
}

struct RetainedHumanBot {
    inner: HumanBot,
    ring: Option<FairPerceptRing14>,
    receipts: mpsc::Sender<Receipt>,
}

impl Policy for RetainedHumanBot {
    fn input_kind(&self) -> InputKind {
        self.inner.input_kind()
    }
    fn input_requirements(&self) -> InputRequirements {
        self.inner.input_requirements()
    }
    fn spec(&self) -> PolicySpec {
        self.inner.spec()
    }
    fn reset(&mut self, start: &MatchStart) {
        self.inner.reset(start);
        self.ring = Some(
            FairPerceptRing14::new(
                Epoch(1),
                PlayerRef::new(start.me.0).unwrap(),
                TierId::Normal,
                4,
                8,
            )
            .unwrap(),
        );
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        self.inner.check_input(input)?;
        let InputPreview::Delivered14(frame) = input else {
            return Err(InputRefusal::RequiresDelivered14);
        };
        self.ring
            .as_ref()
            .ok_or(InputRefusal::MemoryUnavailable)?
            .check_preview(frame, &[Required14::OwnerPresent])
            .map_err(|_| InputRefusal::MemoryUnavailable)
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        let PolicyInput::Delivered14(accepted) = input else {
            panic!("raw shortcut")
        };
        self.check_input(InputPreview::Delivered14(accepted.frame()))?;
        let ring = self.ring.as_mut().unwrap();
        let frame = ring
            .accept(accepted, &[Required14::OwnerPresent])
            .map_err(|_| InputRefusal::MemoryUnavailable)?
            .decoded()
            .clone();
        let memory = ring.memory().clone();
        // Reading the complete immutable sample is explicit consumption. Retiring its
        // FIFO prefix is not a socket ACK and changes no observer command capability.
        ring.release_through(frame.context().sample).unwrap();
        let base = out.len();
        self.inner.decide_input_into(input, out)?;
        let commands = out[base..].to_vec();
        for command in &commands {
            if let PublicCommand::Target { actor } = command {
                assert!(frame.actors().any(|a| a.wire().id == actor.0));
            }
        }
        self.receipts
            .send(Receipt {
                frame,
                memory,
                commands,
            })
            .unwrap();
        Ok(())
    }
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        panic!("raw shortcut")
    }
}

fn policy(receipts: mpsc::Sender<Receipt>) -> RetainedHumanBot {
    RetainedHumanBot {
        inner: HumanBot::new(TierId::Normal, PersonaId::Hunter),
        ring: None,
        receipts,
    }
}

fn assert_receipts(receipts: &[Receipt]) {
    assert!(
        receipts.len() > 1,
        "actual scheduling spans real source steps"
    );
    assert!(receipts.iter().any(|r| !r.commands.is_empty()));
    for (index, receipt) in receipts.iter().enumerate() {
        assert_eq!(receipt.frame.context().sample, SampleId(index as u64 + 1));
        assert_eq!(receipt.frame.context().viewer, PlayerRef::new(1).unwrap());
        assert!(receipt.frame.collections().complete());
        assert_eq!(
            receipt.memory.own_motion().unwrap().source_time.to_bits(),
            receipt.frame.source_time().to_bits()
        );
        assert!(receipt
            .memory
            .records()
            .iter()
            .all(|r| r.id != PlayerRef::new(1).unwrap()));
    }
}

#[test]
fn real_sync_accepted_intake_runs_memory_humanizer_and_normal_submit_without_fallback() {
    let mut sim = scene(440.);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (tx, rx) = mpsc::channel();
    let mut seats = [Seat::new(
        &start,
        Box::new(policy(tx)),
        Box::new(scripted::Idle),
    )];
    seats[0].bind_fx(&sim).unwrap();
    let mut sight = SightCache::new();
    let mut events = vec![];
    let mut submitted: Vec<Command> = vec![];
    for _ in 0..200 {
        drive_seats_with(&mut sim, &mut seats, &events, &mut sight, |_, c| {
            submitted.push(c)
        });
        assert!(seats[0].fault.is_none(), "{:?}", seats[0].fault);
        if seats[0].stats.accepted > 0 {
            break;
        }
        events = sim.step();
    }
    let receipts: Vec<_> = rx.try_iter().collect();
    assert_receipts(&receipts);
    assert!(!submitted.is_empty());
    assert!(seats[0].stats.proposed > 0 && seats[0].stats.accepted > 0);
    assert_eq!(seats[0].stats.fallback_decisions, 0);
}

#[test]
#[allow(clippy::disallowed_methods)] // Harness-only deadline; not a policy/source clock.
fn real_async_accepted_intake_keeps_original_sample_clocks_and_validated_commands() {
    let mut sim = scene(440.);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (tx, rx) = mpsc::channel();
    let mut seat = AsyncSeat::spawn(&start, Box::new(policy(tx)), Box::new(scripted::Idle), 4);
    seat.bind_fx(&sim).unwrap();
    let mut events = vec![];
    let mut submitted: Vec<Command> = vec![];
    let mut receipts = vec![];
    for _ in 0..200 {
        seat.poll(&mut sim, &events, |_, c| submitted.push(c))
            .unwrap();
        let request = seat.pending.clone().expect("actual request queued");
        let receipt = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("actual retained HumanBot callback");
        assert_eq!(receipt.frame.context().sample, request.sample);
        assert_eq!(receipt.frame.context().epoch, request.epoch);
        receipts.push(receipt);
        let limit = Instant::now() + Duration::from_secs(5);
        while seat.pending.is_some() {
            assert!(Instant::now() < limit, "worker reply did not arrive");
            seat.poll(&mut sim, &events, |_, c| submitted.push(c))
                .unwrap();
            std::thread::yield_now();
        }
        assert!(seat.fault.is_none(), "{:?}", seat.fault);
        if seat.stats.accepted > 0 {
            break;
        }
        events = sim.step();
    }
    assert_receipts(&receipts);
    assert!(!submitted.is_empty());
    assert!(seat.stats.proposed > 0 && seat.stats.accepted > 0);
    assert_eq!(seat.stats.fallback_decisions, 0);
}
