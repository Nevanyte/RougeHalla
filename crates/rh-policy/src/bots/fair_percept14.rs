//! Lossless current14 policy facts and bounded accepted-sample retention.
//!
//! This is not the legacy interpolating FrameRing or full Memory. It retains complete,
//! immutable accepted public samples and couples intake to the existing player-memory
//! kernel. New cue/course/protection/continuity facts remain unavailable. No raw
//! Observation constructor, hidden lookup, NPC identity stitching or live Brain switch.
use super::delivered::{Epoch, Fact, PlayerRef};
use super::memory_prefix::{Memory, OwnerSight, PlayerSight, Scene};
use super::types::TierId;
use crate::delivery::frame::SessionId;
use crate::delivery::{
    AcceptedFrame14, Actor14, CollectionView, EventBatch, Frame14, FrameContext14, FxBatch,
    SampleId,
};
use rh_protocol::{WireInventory, WireOwnerCombat, WireSelf};
use rh_sim::Vec2;
use std::convert::Infallible;

/// Families that current14 cannot supply. A known empty collection is NOT an answer
/// for any of these families. New versions require their own reviewed producers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unpublished14 {
    OwnerImmunity,
    RemoteImmunity,
    RemoteBowDraw,
    WandCueHistory,
    FlightCourses,
    NpcContinuity,
    ItemContinuity,
    InterpolatedWorld,
}

/// Consumer prerequisites, checked before either retained history or Memory changes.
/// The complete collections themselves preserve supported None versus present-empty.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Required14 {
    OwnerPresent,
    InventoryPresent,
    OwnerCombat,
    Unpublished(Unpublished14),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal14 {
    Limits,
    Protocol,
    Epoch,
    Viewer,
    Session,
    Sequence,
    Clock,
    Capacity,
    Missing(Required14),
    Memory(super::memory_prefix::Error),
    Release,
}

/// All delivered owner leaves remain available through their original decoded types.
/// In particular, empty inventory slots do not become a fabricated Fists kit; a held
/// redacted lock does not become Clear; absolute clocks/mirrors are never restamped.
#[derive(Clone, Copy, Debug)]
pub struct OwnerFacts14<'a> {
    pub display: &'a WireSelf,
    pub inventory: Fact<Option<&'a WireInventory>>,
    pub combat: Fact<&'a WireOwnerCombat>,
}

/// An owned public sample with an actual local acceptance receipt. Read-only access
/// neither creates input capabilities nor asserts socket/browser receipt.
/// ```compile_fail
/// use rh_policy::{bots::fair_percept14::FairPercept14, delivery::Frame14};
/// fn unaccepted(frame: Frame14) -> FairPercept14 {
///     FairPercept14::from_accepted(frame)
/// }
/// ```
#[derive(Clone, Debug)]
pub struct FairPercept14 {
    accepted: AcceptedFrame14,
}

impl FairPercept14 {
    pub fn from_accepted(accepted: AcceptedFrame14) -> Self {
        Self { accepted }
    }

    pub fn context(&self) -> FrameContext14 {
        self.decoded().context()
    }

    /// Original accepted source clock. No tick*50 reconstruction or render-time label.
    pub fn source_time(&self) -> f64 {
        self.decoded().source_time()
    }

    pub fn owner(&self) -> Fact<Option<OwnerFacts14<'_>>> {
        let frame = self.decoded();
        let Fact::Delivered(owner) = frame.owner() else {
            unreachable!("accepted current14 owner group is a supported optional value")
        };
        Fact::Delivered(owner.map(|display| OwnerFacts14 {
            display,
            inventory: frame.inventory(),
            combat: frame.owner_combat(),
        }))
    }

    /// Preserve every entitled actor row in delivered order, including neutral/unarmed
    /// actors. NpcRef14 remains sample-local and cannot join history across samples.
    pub fn actors(&self) -> impl ExactSizeIterator<Item = Actor14<'_>> {
        self.decoded().actors()
    }

    /// All eleven groups, including owner-only Quest/Trade strings and authoritative
    /// deadlines. None, present-empty and omitted-update retention remain unchanged.
    pub fn collections(&self) -> &CollectionView {
        self.decoded().collections()
    }

    /// Batch clocks/order/duplicates remain unchanged. Untimed14 events do not gain an
    /// invented event origin. Iterating a stored sample does not create new occurrences.
    pub fn events(&self) -> &[EventBatch] {
        self.decoded().events()
    }

    pub fn fx(&self) -> &[FxBatch] {
        self.decoded().fx()
    }

    /// The entire immutable decoded sample also preserves phase/training/ack and every
    /// current owner/actor scalar. This is data access, not an AcceptedFrame factory.
    pub fn decoded(&self) -> &Frame14 {
        self.accepted.frame()
    }

    pub fn unavailable(&self, _: Unpublished14) -> Fact<Infallible> {
        Fact::Unavailable
    }

    pub fn require(&self, required: &[Required14]) -> Result<(), Refusal14> {
        require(self.decoded(), required)
    }
}

fn require(frame: &Frame14, required: &[Required14]) -> Result<(), Refusal14> {
    for &item in required {
        let present = match item {
            Required14::OwnerPresent => matches!(frame.owner(), Fact::Delivered(Some(_))),
            Required14::InventoryPresent => {
                matches!(frame.inventory(), Fact::Delivered(Some(_)))
            }
            Required14::OwnerCombat => matches!(frame.owner_combat(), Fact::Delivered(_)),
            Required14::Unpublished(_) => false,
        };
        if !present {
            return Err(Refusal14::Missing(item));
        }
    }
    Ok(())
}

/// A finite FIFO of complete accepted samples plus the existing player-memory prefix.
/// Caller-selected frame count is a component limit, not a producer/population bound.
/// Full refuses atomically; no oldest-sample eviction, coalescing or silent cue loss.
pub struct FairPerceptRing14 {
    frames: Vec<FairPercept14>,
    frame_limit: usize,
    memory_limit: usize,
    tier: TierId,
    epoch: Epoch,
    viewer: PlayerRef,
    affinity: Option<SessionId>,
    last: Option<(SampleId, u32, f64)>,
    memory: Memory,
}

impl FairPerceptRing14 {
    pub fn new(
        epoch: Epoch,
        viewer: PlayerRef,
        tier: TierId,
        frame_limit: usize,
        memory_limit: usize,
    ) -> Result<Self, Refusal14> {
        if frame_limit == 0 {
            return Err(Refusal14::Limits);
        }
        let memory = Memory::new(epoch, viewer, tier, memory_limit).map_err(Refusal14::Memory)?;
        Ok(Self {
            frames: Vec::new(),
            frame_limit,
            memory_limit,
            tier,
            epoch,
            viewer,
            affinity: None,
            last: None,
            memory,
        })
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn retained(&self) -> &[FairPercept14] {
        &self.frames
    }

    pub fn latest(&self) -> Option<&FairPercept14> {
        self.frames.last()
    }

    pub fn memory(&self) -> &Memory {
        &self.memory
    }

    /// Data-only pre-acceptance check for Policy::check_input. It does not append a
    /// sample or mint acceptance. The mutating intake still requires AcceptedFrame14.
    pub fn check_preview(&self, frame: &Frame14, required: &[Required14]) -> Result<(), Refusal14> {
        self.preflight(frame, required).map(|_| ())
    }

    fn preflight(
        &self,
        frame: &Frame14,
        required: &[Required14],
    ) -> Result<Vec<PlayerSight>, Refusal14> {
        require(frame, required)?;
        let context = frame.context();
        if context.protocol != 14 {
            return Err(Refusal14::Protocol);
        }
        if context.epoch != self.epoch {
            return Err(Refusal14::Epoch);
        }
        if context.viewer != self.viewer {
            return Err(Refusal14::Viewer);
        }
        if self
            .affinity
            .as_ref()
            .is_some_and(|v| !frame.same_local_session(v))
        {
            return Err(Refusal14::Session);
        }
        let expected = self
            .last
            .map_or(Some(1), |(sample, _, _)| sample.0.checked_add(1));
        if expected != Some(context.sample.0) {
            return Err(Refusal14::Sequence);
        }
        if !frame.source_time().is_finite()
            || frame.source_time() < 0.
            || self
                .last
                .is_some_and(|(_, tick, time)| frame.tick() < tick || frame.source_time() <= time)
        {
            return Err(Refusal14::Clock);
        }
        if self.frames.len() >= self.frame_limit {
            return Err(Refusal14::Capacity);
        }
        let players = super::perception::memory_players(frame).map_err(Refusal14::Memory)?;
        // Match the current HumanBot owner-clear behavior: retain the genuine clear
        // sample, but do not fabricate an OwnerSight or update player-memory from it.
        if let Fact::Delivered(Some(owner)) = frame.owner() {
            self.memory
                .check_scene(self.scene(frame, owner, &players))
                .map_err(Refusal14::Memory)?;
        }
        Ok(players)
    }

    fn scene<'a>(
        &self,
        frame: &Frame14,
        owner: &WireSelf,
        players: &'a [PlayerSight],
    ) -> Scene<'a> {
        Scene {
            epoch: self.epoch,
            viewer: self.viewer,
            now: frame.source_time(),
            owner: Some(OwnerSight {
                at: Vec2::new(f64::from(owner.x), f64::from(owner.y)),
                status: crate::delivery::frame::status(owner.status),
            }),
            players,
        }
    }

    /// All fallible data/availability/order/Memory checks precede both commits.
    /// No RNG or gameplay input is owned or advanced by this component.
    pub fn accept(
        &mut self,
        accepted: &AcceptedFrame14,
        required: &[Required14],
    ) -> Result<&FairPercept14, Refusal14> {
        let frame = accepted.frame();
        if !frame.same_local_session(&accepted.session) {
            return Err(Refusal14::Session);
        }
        let players = self.preflight(frame, required)?;
        let candidate = FairPercept14::from_accepted(accepted.clone());
        if let Fact::Delivered(Some(owner)) = frame.owner() {
            let scene = self.scene(frame, owner, &players);
            self.memory
                .observe_scene(scene)
                .map_err(Refusal14::Memory)?;
        }
        self.affinity = Some(accepted.session.clone());
        self.last = Some((frame.context().sample, frame.tick(), frame.source_time()));
        self.frames.push(candidate);
        Ok(self.frames.last().expect("accepted sample appended"))
    }

    /// Explicitly release an exactly retained prefix after the consumer has consumed
    /// its batches. Memory and next sample/session fences survive even an empty FIFO.
    /// This does not ACK a socket or retire any command capability.
    pub fn release_through(&mut self, sample: SampleId) -> Result<(), Refusal14> {
        let Some(index) = self
            .frames
            .iter()
            .position(|f| f.context().sample == sample)
        else {
            return Err(Refusal14::Release);
        };
        self.frames.drain(..=index);
        Ok(())
    }

    /// Atomically start from the first accepted sample of a DIFFERENT local session.
    /// Failed required-fact checks retain the old FIFO/Memory. Old callbacks cannot
    /// join after reset even when numeric epoch/viewer/sample values happen to match.
    pub fn reset_from(
        &mut self,
        first: &AcceptedFrame14,
        required: &[Required14],
    ) -> Result<(), Refusal14> {
        if self.affinity.as_ref().is_some_and(|v| v == &first.session) {
            return Err(Refusal14::Session);
        }
        let context = first.frame().context();
        let mut next = Self::new(
            context.epoch,
            context.viewer,
            self.tier,
            self.frame_limit,
            self.memory_limit,
        )?;
        next.accept(first, required)?;
        *self = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
