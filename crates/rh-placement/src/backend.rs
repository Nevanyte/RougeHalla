//! The two external systems placement talks to, as traits, and the exact GameLift request we build.
//!
//! The real implementations live outside this crate (they hold the AWS and DNS credentials). `StartPlacement` has **no**
//! latency field on purpose: GameLift rejects `PlayerLatencies` together with `PriorityConfigurationOverride`
//! (`InvalidRequestException`) and averages latencies instead of taking the worst member, so we order locations ourselves and
//! always send the override. The type makes the forbidden combination unrepresentable.

use crate::model::RegionCapacity;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::future::Future;

/// GameLift `PlacementFallbackStrategy`. We only ever use `None`: widening is done by our own next attempt so that every
/// widening is visible, bounded and logged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fallback {
    /// `NONE`: limit placement to the override list.
    None,
    /// `DEFAULT_AFTER_SINGLE_PASS` (supported by the request builder and the fake, not used by the service).
    DefaultAfterSinglePass,
}

impl Fallback {
    pub fn api_name(self) -> &'static str {
        match self {
            Fallback::None => "NONE",
            Fallback::DefaultAfterSinglePass => "DEFAULT_AFTER_SINGLE_PASS",
        }
    }
}

/// `StartGameSessionPlacement` ([API](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_StartGameSessionPlacement.html)).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartPlacement {
    /// `^[a-zA-Z0-9-]+$`, at most 48, unique across Regions and never reused.
    pub placement_id: String,
    pub queue_name: String,
    pub max_player_sessions: u32,
    /// `PlayerId` is the callsign (docs/hosting/CONTROL_API.md section 2). `PlayerData` is empty: nothing rides along.
    pub players: Vec<String>,
    pub game_session_data: String,
    /// `PriorityConfigurationOverride.LocationOrder`: 1..=10 distinct locations.
    pub location_order: Vec<String>,
    pub fallback: Fallback,
}

impl StartPlacement {
    /// The request as the AWS CLI's `--cli-input-json` / SDK JSON shape. This is the exact payload of the NOT RUN placement test.
    pub fn to_api_json(&self) -> serde_json::Value {
        json!({
            "GameSessionQueueName": self.queue_name,
            "PlacementId": self.placement_id,
            "MaximumPlayerSessionCount": self.max_player_sessions,
            "DesiredPlayerSessions": self.players.iter().map(|p| json!({"PlayerId": p})).collect::<Vec<_>>(),
            "GameSessionData": self.game_session_data,
            "PriorityConfigurationOverride": {
                "LocationOrder": self.location_order,
                "PlacementFallbackStrategy": self.fallback.api_name(),
            },
        })
    }

    /// Checks the documented request limits so a bad request fails in our code, not in a billed API call.
    pub fn validate(&self) -> Result<(), String> {
        let id = &self.placement_id;
        if id.is_empty()
            || id.len() > 48
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(format!(
                "placement id {id:?} violates ^[a-zA-Z0-9-]+$ and 1..=48"
            ));
        }
        if self.location_order.is_empty() || self.location_order.len() > 10 {
            return Err("LocationOrder must hold 1..=10 locations".into());
        }
        let mut seen = std::collections::BTreeSet::new();
        for l in &self.location_order {
            if !seen.insert(l) {
                return Err(format!("location {l} listed twice"));
            }
            if l.is_empty()
                || l.len() > 64
                || !l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            {
                return Err(format!("location {l:?} violates ^[A-Za-z0-9-]+$"));
            }
        }
        if self.players.len() as u32 > self.max_player_sessions {
            return Err("more desired player sessions than MaximumPlayerSessionCount".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlacementStatus {
    Pending,
    Fulfilled,
    Cancelled,
    TimedOut,
    Failed,
}

impl PlacementStatus {
    pub fn is_terminal(self) -> bool {
        self != PlacementStatus::Pending
    }
}

/// The fields of `GameSessionPlacement` we read. Connection fields are only final when `status == Fulfilled`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlacementState {
    pub placement_id: String,
    pub status: PlacementStatus,
    pub game_session_arn: Option<String>,
    pub region: Option<String>,
    pub ip_address: Option<String>,
    pub port: Option<u16>,
    /// `(PlayerId, PlayerSessionId)`.
    pub placed_player_sessions: Vec<(String, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackendError {
    /// A placement with this id exists (ids are never reused).
    AlreadyExists,
    /// `InvalidRequestException` / `NotFoundException`: the request is wrong; retrying it unchanged will not help.
    Invalid(String),
    /// Throttling, 5xx, network: the call may be retried.
    Unavailable(String),
}

/// GameLift as the placement service uses it. Credentials live in the implementation, never in the caller.
pub trait GameLiftBackend: Send + Sync {
    fn start_placement(
        &self,
        req: &StartPlacement,
    ) -> impl Future<Output = Result<PlacementState, BackendError>> + Send;
    fn describe_placement(
        &self,
        placement_id: &str,
    ) -> impl Future<Output = Result<PlacementState, BackendError>> + Send;
    /// `StopGameSessionPlacement`: `Invalid` when the session was already created (the caller then re-describes).
    fn stop_placement(
        &self,
        placement_id: &str,
    ) -> impl Future<Output = Result<PlacementState, BackendError>> + Send;
    /// `TerminateGameSession`: cleans up a session nobody will join (for example when DNS failed after placement).
    fn terminate_game_session(
        &self,
        game_session_arn: &str,
    ) -> impl Future<Output = Result<(), BackendError>> + Send;
    /// Idle session capacity per location (CloudWatch `AvailableGameSessions`). A missing region means unknown.
    fn capacity(
        &self,
    ) -> impl Future<Output = Result<BTreeMap<String, RegionCapacity>, BackendError>> + Send;
}

/// The practice-zone DNS as the placement service uses it (Cloudflare today, see TLS_DNS.md).
pub trait DnsBackend: Send + Sync {
    /// Create or replace the record for `name` (an A record for IPv4, AAAA for IPv6) with `ttl_s`.
    fn upsert(
        &self,
        name: &str,
        ip: &str,
        ttl_s: u32,
    ) -> impl Future<Output = Result<(), BackendError>> + Send;
    fn delete(&self, name: &str) -> impl Future<Output = Result<(), BackendError>> + Send;
    /// What the zone's authoritative servers answer for `name` right now (empty when absent). Not a recursive lookup.
    fn resolve_authoritative(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Vec<String>, BackendError>> + Send;
}
