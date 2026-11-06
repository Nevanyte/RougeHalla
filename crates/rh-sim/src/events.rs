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
    MobArmed {
        id: PlayerId,
        weapon: WeaponId,
    },
    CampCleared {
        camp: u32,
    },
    PotionNotice {
        id: PlayerId,
        notice: crate::potions::Notice,
    },
    ChestRefused {
        id: PlayerId,
        reason: crate::reward_chests::Refusal,
    },
    ChestTaken {
        chest: u32,
        by: PlayerId,
        pick: i8,
    },
    /// Private source-timed ability chunk; public output uses frozen per-step contributions.
    AbilityHit {
        victim: PlayerId,
        by: Option<PlayerId>,
        ability: crate::status_runtime::AbilityId,
        amount: f64,
    },
    CastStarted {
        id: PlayerId,
        ability: crate::status_runtime::AbilityId,
        ms: f64,
        target: Option<PlayerId>,
        x: f64,
        y: f64,
    },
    CastLanded {
        id: PlayerId,
        ability: crate::status_runtime::AbilityId,
        target: Option<PlayerId>,
        x: f64,
        y: f64,
        to: Option<crate::Vec2>,
    },
    CastEnded {
        id: PlayerId,
        ability: crate::status_runtime::AbilityId,
        reason: crate::status_runtime::CastEndReason,
    },
    StatusApplied {
        id: PlayerId,
        kind: crate::status_runtime::StatusKind,
        ms: f64,
        by: Option<PlayerId>,
    },
    MarkNotice {
        recipient: PlayerId,
        notice: MarkNotice,
    },
    /// Source-exact private delayed chunk. Public projection consumes per-tick contributions instead.
    SignatureHit {
        victim: PlayerId,
        by: PlayerId,
        sig: crate::factions::SignatureKind,
        weapon: Option<WeaponId>,
        amount: f64,
    },
    RaidStarted,
    PlanningStarted,
    Teleported,
    Plan {
        to: PlayerId,
        plan: crate::PlanView,
    },
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
    Heal {
        id: PlayerId,
        amount: f64,
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
            Event::Plan { to, .. } => Visibility::Owner(to),
            Event::PlanningStarted => Visibility::ServerOnly,
            Event::Teleported => Visibility::Everyone,
            Event::MobArmed { id, .. } => Visibility::Owner(id),
            Event::CampCleared { .. } => Visibility::Everyone,
            Event::ChestRefused { id, .. } => Visibility::Owner(id),
            Event::ChestTaken { .. } => Visibility::ServerOnly,
            Event::CastStarted { id, .. }
            | Event::CastLanded { id, .. }
            | Event::CastEnded { id, .. } => Visibility::IfSeen(id),
            Event::StatusApplied { id, .. } => Visibility::IfSeen(id),
            Event::Swing { by, .. } => Visibility::IfSeen(by),
            Event::Hit { victim, by, .. } => Visibility::IfSeenOrBy { seen: victim, by },
            Event::Block { id, .. }
            | Event::Heal { id, .. }
            | Event::AttackCancelled { id }
            | Event::Stagger { id }
            | Event::Death { id, .. } => Visibility::IfSeen(id),
            Event::PickupRefused { id, .. } | Event::PotionNotice { id, .. } => {
                Visibility::Owner(id)
            }
            Event::Bounty { .. } | Event::Victory { .. } => Visibility::Everyone,
            Event::AbilityHit { .. }
            | Event::MarkNotice { .. }
            | Event::SignatureHit { .. }
            | Event::ProjectileLaunched(_)
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
            Event::Plan { .. } => Class::Important,
            Event::PlanningStarted => Class::ServerOnly,
            Event::Teleported => Class::Fx,
            Event::MobArmed { .. } | Event::CampCleared { .. } => Class::Important,
            Event::ChestRefused { .. } => Class::Important,
            Event::ChestTaken { .. } => Class::ServerOnly,
            Event::Death { .. }
            | Event::Bounty { .. }
            | Event::Victory { .. }
            | Event::Resolved { .. } => Class::Important,
            Event::CastStarted { .. }
            | Event::CastLanded { .. }
            | Event::CastEnded { .. }
            | Event::StatusApplied { .. }
            | Event::Swing { .. }
            | Event::Hit { .. }
            | Event::Block { .. }
            | Event::Heal { .. }
            | Event::AttackCancelled { .. }
            | Event::Stagger { .. } => Class::Fx,
            Event::PickupRefused { .. } | Event::PotionNotice { .. } => Class::Important,
            Event::AbilityHit { .. }
            | Event::MarkNotice { .. }
            | Event::SignatureHit { .. }
            | Event::ProjectileLaunched(_)
            | Event::ProjectileEnded { .. }
            | Event::RaidStarted
            | Event::Windup { .. }
            | Event::Gv { .. }
            | Event::RaidEnded => Class::ServerOnly,
        }
    }
}

/// Private source notices, fixed text without per-step string allocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MarkNotice {
    Marked,
    CarriedOut,
    ExecuteBlocked,
}
impl MarkNotice {
    pub const fn message(self) -> &'static str {
        match self {
            Self::Marked => "Sentenced marked you.",
            Self::CarriedOut => "Your sentence has been carried out.",
            Self::ExecuteBlocked => "Execute blocked - already sentenced.",
        }
    }
}
