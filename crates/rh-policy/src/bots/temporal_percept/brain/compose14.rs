//! The accepted-frame composer (P-BOT-BRAIN-LIVE-1, piece 1): `Frame14` -> the source `Percept`.
//!
//! The composer sees only an accepted `Frame14` (the bytes a human client gets), its own retained ring of earlier
//! accepted frames and the static setup. It never sees `Sim`, `World` or any server-only state. A fact the seat cannot
//! see is the source's `undefined` (never a plausible default); a missing required group refuses the frame.
//!
//! STUB: signatures only. The implementer replaces the bodies; the oracle is `compose14_tests.rs`.

use super::percept::Percept;
use super::trace::BVal;
use crate::bots::view::Features;
use crate::delivery::Frame14;
use rh_sim::Arena;
use std::sync::Arc;

/// Static, public setup bound once per seat (never read from a live world).
#[derive(Clone, Debug)]
pub(crate) struct Setup14 {
    /// The match's public map (from `MatchStart::arena`).
    pub(crate) arena: Arc<Arena>,
    /// The declared source feature verdicts for this room (message types in source order).
    pub(crate) features: Features,
    /// Source `worldDelayMs`: `viewT = now - world_delay_ms`. Zero composes the present.
    pub(crate) world_delay_ms: f64,
    /// Source `attentionCentral` share of the view box (`isCentral`).
    pub(crate) attention_central: f64,
}

/// Why a frame cannot become a percept. The composer is atomic: a refusal leaves its ring untouched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal14 {
    OwnerMissing,
    InventoryMissing,
    OwnerCombatMissing,
    BuildMissing,
    /// The Arena group (raid start, patience, gates, coliseum) is absent, e.g. the Off arena profile.
    ArenaMissing,
    /// The sample is not later than the last composed one in this session.
    Clock,
}

/// A camp ward the viewer owns, for the Vision filter (source `wardOwner === selfId && wardExpiresAt > now`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WardSight14 {
    /// Index into the frame's camp rows (`map.camps` order).
    pub(crate) camp: usize,
    pub(crate) expires_at: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Composed14 {
    pub(crate) percept: Percept,
    /// Only the viewer's own wards (`WireWard::yours`); another player's ward is not a vision source for this seat.
    pub(crate) wards: Vec<WardSight14>,
}

pub(crate) struct Composer14 {
    setup: Setup14,
}

impl Composer14 {
    pub(crate) fn new(setup: Setup14) -> Self {
        Self { setup }
    }

    /// Forget every retained sample (a new session or match).
    pub(crate) fn reset(&mut self) {
        let _ = &self.setup;
    }

    pub(crate) fn compose(&mut self, frame: &Frame14) -> Result<Composed14, Refusal14> {
        let _ = frame;
        Ok(Composed14 {
            percept: Percept {
                raw: BVal::Undefined,
                features: self.setup.features.clone(),
                ..Percept::default()
            },
            wards: Vec::new(),
        })
    }
}
