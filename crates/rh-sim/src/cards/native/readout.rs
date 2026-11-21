//! P-AUG-NATIVE-1b: the own-only native readout producer (C-OBS). A viewer's rows come from the viewer's own native
//! slots only, held cards in native order, each card's rows as its batch table declares them; fixed size, no
//! allocation. P-WIRE19-B observes them (`Observation::readouts`, beside the owner's card counts) and puts them on the
//! wire (State key 14).
use crate::cards::CardId;
use crate::{PlayerId, Sim};

/// The most readout rows one viewer can have (two per native card).
pub const MAX_READOUTS: usize = 28;

/// What a readout row shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ReadoutKind {
    /// The slot's `counter` (stacks in the card's own units).
    Counter,
    /// One of the slot's `meters`.
    Meter,
    /// The number of the slot's `marks` set.
    Marks,
}

/// One readout row: a card, what it shows, its value and its maximum.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Readout {
    pub card: CardId,
    pub kind: ReadoutKind,
    pub value: f64,
    pub max: f64,
}

/// A viewer's readout rows (fixed size).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Readouts {
    rows: [Readout; MAX_READOUTS],
    len: usize,
}

impl Default for Readouts {
    fn default() -> Self {
        Self {
            rows: [Readout {
                card: CardId::MarksmansTally,
                kind: ReadoutKind::Counter,
                value: 0.,
                max: 0.,
            }; MAX_READOUTS],
            len: 0,
        }
    }
}

impl Readouts {
    /// The rows, in native order.
    pub fn rows(&self) -> &[Readout] {
        &self.rows[..self.len]
    }
}

/// Where a batch table's readout row reads its value and maximum: the slot's `counter` (max `counter_cap`), one of its
/// `meters` (max that meter's cap) or its `marks` (the number set, max the number of the rule's bits).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Source {
    Counter,
    #[allow(dead_code)] // a batch packet's card shows a second or third meter
    Meter(usize),
    #[allow(dead_code)] // Pathfinder (P-AUG-NATIVE-3)
    Marks,
}

/// The readout rows of `viewer`'s own native cards (none for a non-holder, a non-player or a `Legacy` world): held
/// cards in native order, each card's rows as its batch table declares them. Reads only `k.cards` and the viewer's own
/// slots (C-OBS); no allocation.
pub fn readouts(sim: &Sim, viewer: PlayerId) -> Readouts {
    let mut out = Readouts::default();
    if sim.k.cards.rule() != crate::AugmentRule::Rework {
        return out;
    }
    let Some(p) = sim.w.player(viewer) else {
        return out;
    };
    for (card, slot) in p.build.native.held() {
        let (Some(sources), Some(rule)) = (super::readout_sources(card), super::rule(card)) else {
            continue;
        };
        for source in sources {
            if out.len == MAX_READOUTS {
                return out;
            }
            let (kind, value, max) = match *source {
                Source::Counter => (ReadoutKind::Counter, slot.counter, rule.counter_cap),
                Source::Meter(m) => (ReadoutKind::Meter, slot.meters[m], rule.meter_caps[m]),
                Source::Marks => (
                    ReadoutKind::Marks,
                    f64::from(slot.marks.count_ones()),
                    f64::from(rule.marks.count_ones()),
                ),
            };
            out.rows[out.len] = Readout {
                card,
                kind,
                value,
                max,
            };
            out.len += 1;
        }
    }
    out
}
