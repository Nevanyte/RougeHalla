//! Data-only component adapter for existing declared public-scene tests. It does NOT mint an
//! AcceptedFrame14, commit an offer, attest delivery, or install facts absent from the input.
use super::{DeliverySession, Frame14};
pub(crate) fn frame(obs: &rh_sim::Observation) -> Frame14 {
    let viewer = obs.me.as_ref().expect("declared component owner").id;
    let session = DeliverySession::new(viewer);
    (*session
        .prepare(obs, true, true, &[])
        .expect("declared component scene is protocol14 representable")
        .frame)
        .clone()
}
