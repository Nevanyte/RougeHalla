//! What a step reports.

use crate::content::WeaponId;
use crate::results::{GvReason, RunResult};
use crate::state::PlayerId;

/// A private legacy pickup toast.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PickupRefusal {
    Blocked,
    NothingThere,
    TooFar,
    Unreachable,
    NothingToTake,
}

impl PickupRefusal {
    pub fn message(self) -> &'static str {
        match self {
            Self::Blocked => "Can't do that now",
            Self::NothingThere => "Nothing there",
            Self::TooFar => "Too far away",
            Self::Unreachable => "Can't reach that",
            Self::NothingToTake => "Nothing to take",
        }
    }
}

/// What a step reports. Every variant declares who may know of it ([`Event::visibility`]) and how a client receives it
/// ([`Event::class`]); important events (deaths, results, the end) are never dropped, fx may be (docs/CONTRACTS.md C-NET-5).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Event {
    RaidStarted,
    ProjectileLaunched(crate::ProjectileLaunch),
    ProjectileEnded {
        launch: crate::ProjectileLaunch,
        at: crate::Vec2,
        reason: crate::ProjectileEnd,
    },
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
    /// `by` is `None` for damage no fighter dealt (legacy `SUDDEN_DEATH_KILLER`, the arena's own damage; it credits nobody) and `weapon` is `None` for damage no weapon
    /// dealt (an ability, a field); every hit the slice produces has both. Names are resolved from the roster (players) or
    /// content (future mob types) only when a result or a client needs them, never stored here.
    Hit {
        victim: PlayerId,
        by: Option<PlayerId>,
        amount: f64,
        weapon: Option<WeaponId>,
        passive: bool,
    },
    Block {
        id: PlayerId,
        by: PlayerId,
        weapon: WeaponId,
        passive: bool,
    },
    PickupRefused {
        id: PlayerId,
        reason: PickupRefusal,
        /// The requester could see the target when its order was applied. Private
        /// metadata for projecting the toast; movement later in the tick cannot reveal it.
        #[serde(default)]
        target_visible: bool,
    },
    AttackCancelled {
        id: PlayerId,
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
    /// Only the addressed player.
    Owner(PlayerId),
    /// Observers who are the actor or can see it.
    IfSeen(PlayerId),
    /// Observers who can see `seen`, or who are `by` (nobody, when the source is `None`).
    IfSeenOrBy {
        seen: PlayerId,
        by: Option<PlayerId>,
    },
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
            Event::Block { id, .. }
            | Event::AttackCancelled { id }
            | Event::Stagger { id }
            | Event::Death { id, .. } => Visibility::IfSeen(id),
            Event::PickupRefused { id, .. } => Visibility::Owner(id),
            Event::Bounty { .. } | Event::Victory { .. } => Visibility::Everyone,
            Event::ProjectileLaunched(_)
            | Event::ProjectileEnded { .. }
            | Event::RaidStarted
            | Event::Windup { .. }
            | Event::Gv { .. }
            | Event::RaidEnded
            | Event::Resolved { .. } => Visibility::ServerOnly,
        }
    }

    /// How a client that may know of this event receives it. No wildcard arm, on purpose. Advisory for the wire: the publish
    /// path routes by its own exhaustive match over what an observer is shown, and debug-asserts it agrees with this.
    pub fn class(&self) -> Class {
        match self {
            Event::Death { .. }
            | Event::Bounty { .. }
            | Event::Victory { .. }
            | Event::Resolved { .. } => Class::Important,
            Event::Swing { .. }
            | Event::Hit { .. }
            | Event::Block { .. }
            | Event::AttackCancelled { .. }
            | Event::Stagger { .. } => Class::Fx,
            Event::PickupRefused { .. } => Class::Important,
            Event::ProjectileLaunched(_)
            | Event::ProjectileEnded { .. }
            | Event::RaidStarted
            | Event::Windup { .. }
            | Event::Gv { .. }
            | Event::RaidEnded => Class::ServerOnly,
        }
    }
}
