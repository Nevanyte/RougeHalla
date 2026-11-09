//! Shared public projection and policy delivery. Data projection is not proof of acceptance.
pub mod collections;
pub(crate) mod frame;
pub mod projection;
pub use frame::{
    AcceptedFrame14, Actor14, ActorKind14, CollectionView, DeliveryError, EventBatch, Frame14,
    FrameContext14, FxBatch, NpcRef14, SampleId,
};
mod session;
pub(crate) use session::DeliverySession;

#[cfg(test)]
pub(crate) mod test_support;
