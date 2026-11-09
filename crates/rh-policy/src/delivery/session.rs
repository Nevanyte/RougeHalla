//! Seat-local staged projection. Nothing is accepted merely by building a Frame14.
use super::{
    collections::{CollectionPublisher, PendingState},
    projection, AcceptedFrame14, CollectionView, DeliveryError, EventBatch, Frame14,
    FrameContext14, FxBatch, SampleId,
};
use crate::bots::delivered::{Epoch, PlayerRef};
use rh_protocol::{ServerMsg, SnapshotData, WireEvent};
use rh_sim::{Observation, PlayerId};
use std::sync::Arc;

pub(crate) struct DeliverySession {
    session: super::frame::SessionId,
    epoch: Epoch,
    next: u64,
    viewer: Option<PlayerRef>,
    collections: CollectionPublisher,
    received: CollectionView,
    last_clock: Option<f64>,
}
pub(crate) struct PreparedDelivery {
    session: super::frame::SessionId,
    state: PendingState,
    pub(crate) frame: Arc<Frame14>,
}
impl DeliverySession {
    pub(crate) fn identity(&self) -> super::frame::SessionId {
        self.session.clone()
    }
    pub(crate) fn new(viewer: PlayerId) -> Self {
        Self {
            session: super::frame::SessionId::new(),
            epoch: Epoch(1),
            next: 1,
            viewer: PlayerRef::new(viewer.0).ok(),
            collections: CollectionPublisher::default(),
            received: CollectionView::default(),
            last_clock: None,
        }
    }
    pub(crate) fn prepare(
        &self,
        obs: &Observation,
        props_changed: bool,
        rewards_changed: bool,
        results: &[WireEvent],
    ) -> Result<PreparedDelivery, DeliveryError> {
        let viewer = self.viewer.ok_or(DeliveryError::Namespace)?;
        if self.next == u64::MAX {
            return Err(DeliveryError::SampleExhausted);
        }
        if self.last_clock.is_some_and(|t| obs.server_time < t) {
            return Err(DeliveryError::Clock);
        }
        projection::observation_supported(obs)?;
        let mut snapshot = SnapshotData::build_checked_with_server_time(
            None,
            obs.tick,
            obs.server_time,
            projection::checked_phase(obs.phase)?,
            0,
            obs.me.as_ref().map(projection::wire_self),
            obs.visible.iter().map(projection::checked_actor),
        )?;
        snapshot.set_training(obs.training);
        snapshot.set_owner_combat(obs.owner_combat.map(projection::wire_owner_combat))?;
        let state = self
            .collections
            .prepare(obs, props_changed, rewards_changed, false)?;
        let mut received = self.received.clone();
        if let Some(bytes) = &state.frame {
            received.apply(&ServerMsg::decode(bytes)?)?;
        }
        let mut events = Vec::new();
        let mut fx = Vec::new();
        for event in &obs.events {
            match projection::to_wire(event) {
                projection::Wire::Event(v) => events.push(v),
                projection::Wire::Fx(v) => fx.push(v),
                projection::Wire::Omitted => {}
                projection::Wire::Refused(v) => {
                    return Err(rh_protocol::EncodeError::BadValue(v).into())
                }
            }
        }
        events.extend(results.iter().cloned());
        let mut event_batches = Vec::new();
        let mut fx_batches = Vec::new();
        if !events.is_empty() {
            let bytes = ServerMsg::Events {
                tick: obs.tick,
                events,
            }
            .try_encode()?;
            let ServerMsg::Events { tick, events } = ServerMsg::decode(&bytes)? else {
                unreachable!()
            };
            event_batches.push(EventBatch { tick, events });
        }
        if !fx.is_empty() {
            let bytes = ServerMsg::Fx { tick: obs.tick, fx }.try_encode()?;
            let ServerMsg::Fx { tick, fx } = ServerMsg::decode(&bytes)? else {
                unreachable!()
            };
            fx_batches.push(FxBatch { tick, fx });
        }
        let context = FrameContext14 {
            protocol: 14,
            epoch: self.epoch,
            sample: SampleId(self.next),
            viewer,
        };
        let mut frame = Frame14::from_reconstructed(
            context,
            snapshot.decoded(),
            received,
            event_batches,
            fx_batches,
        )?;
        // Only the local scope is shared. It is neither a decoded fact nor an ActorRefs epoch.
        frame.affinity = self.session.clone();
        let frame = Arc::new(frame);
        Ok(PreparedDelivery {
            session: self.session.clone(),
            state,
            frame,
        })
    }
    pub(crate) fn commit(&mut self, prepared: PreparedDelivery) -> AcceptedFrame14 {
        prepared.state.commit(&mut self.collections);
        self.received = prepared.frame.collections.clone();
        self.last_clock = Some(prepared.frame.source_time());
        self.next += 1;
        AcceptedFrame14 {
            session: prepared.session,
            frame: prepared.frame,
        }
    }
}
impl PreparedDelivery {
    /// Internal channel envelope only. The receiver obtaining this envelope is acceptance; a failed
    /// send returns/drops it without running a policy. Commit remains the sender's responsibility.
    pub(crate) fn envelope(&self) -> AcceptedFrame14 {
        AcceptedFrame14 {
            session: self.session.clone(),
            frame: Arc::clone(&self.frame),
        }
    }
}
