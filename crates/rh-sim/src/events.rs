//! What a step reports.

use crate::content::WeaponId;
use crate::results::{GvReason, RunResult};
use crate::state::PlayerId;

/// What a step reports. Every variant declares who may know of it ([`Event::visibility`]) and how a client receives it
/// ([`Event::class`]); important events (deaths, results, the end) are never dropped, fx may be (docs/CONTRACTS.md C-NET-5).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Event {
    RaidStarted,
    Windup {
        by: PlayerId,
        weapon: WeaponId,
        a: f64,
        ms: f64,
    },
    Swing {
        by: PlayerId,
        weapon: WeaponId,
        x: f64,
        y: f64,
        a: f64,
    },
    Hit {
        victim: PlayerId,
        by: PlayerId,
        amount: f64,
        weapon: WeaponId,
    },
    Stagger {
        id: PlayerId,
    },
    Death {
        id: PlayerId,
        x: f64,
        y: f64,
        by: Option<PlayerId>,
    },
    Gv {
        id: PlayerId,
        amount: u32,
        reason: GvReason,
    },
    Bounty {
        id: PlayerId,
        bounty: u32,
    },
    Victory {
        id: Option<PlayerId>,
        draw: bool,
    },
    RaidEnded,
    Resolved {
        id: PlayerId,
        result: RunResult,
        bot: bool,
    },
}

/// Who may be told of an event (docs/CONTRACTS.md C-OBS). Declared per event by [`Event::visibility`], an exhaustive
/// match: a new [`Event`] variant does not compile until its author has decided who may know of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visibility {
    /// Every observer (legacy: bounty announcements and the end of the run go to the whole room).
    Everyone,
    /// Observers who are the actor or can see it.
    IfSeen(PlayerId),
    /// Observers who can see `seen`, or who are `by`.
    IfSeenOrBy { seen: PlayerId, by: PlayerId },
    /// Not part of any observation: server and persistence only, or delivered by a dedicated path (a player's own result).
    ServerOnly,
}

/// How a client receives what it is told (docs/CONTRACTS.md C-NET-5). Declared per event by [`Event::class`] (and for what
/// an observer is shown by `SeenEvent::class`), both exhaustive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    /// Reliable: deaths, bounties, the end, a player's own result. Never dropped for a slow client.
    Important,
    /// Presentation fx a slow client may lose.
    Fx,
    /// Never sent to a client.
    ServerOnly,
}

impl Event {
    /// Who may know of this event. No wildcard arm, on purpose.
    pub fn visibility(&self) -> Visibility {
        match *self {
            Event::Swing { by, .. } => Visibility::IfSeen(by),
            Event::Hit { victim, by, .. } => Visibility::IfSeenOrBy { seen: victim, by },
            Event::Death { id, .. } => Visibility::IfSeen(id),
            Event::Bounty { .. } | Event::Victory { .. } => Visibility::Everyone,
            Event::RaidStarted
            | Event::Windup { .. }
            | Event::Stagger { .. }
            | Event::Gv { .. }
            | Event::RaidEnded
            | Event::Resolved { .. } => Visibility::ServerOnly,
        }
    }

    /// How a client that may know of this event receives it. No wildcard arm, on purpose.
    pub fn class(&self) -> Class {
        match self {
            Event::Death { .. }
            | Event::Bounty { .. }
            | Event::Victory { .. }
            | Event::Resolved { .. } => Class::Important,
            Event::Swing { .. } | Event::Hit { .. } => Class::Fx,
            Event::RaidStarted
            | Event::Windup { .. }
            | Event::Stagger { .. }
            | Event::Gv { .. }
            | Event::RaidEnded => Class::ServerOnly,
        }
    }
}
