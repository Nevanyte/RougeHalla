//! What a step reports.

use crate::content::WeaponId;
use crate::results::{GvReason, RunResult};
use crate::state::PlayerId;

/// What a step reports. `is_important` events (deaths, results, the end) must reach every client and persistence; the rest
/// are presentation fx a slow client may lose (docs/CONTRACTS.md C-NET-5).
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

impl Event {
    pub fn is_important(&self) -> bool {
        matches!(
            self,
            Event::RaidStarted
                | Event::Death { .. }
                | Event::Victory { .. }
                | Event::RaidEnded
                | Event::Resolved { .. }
                | Event::Gv { .. }
        )
    }
}
