//! The wire types. Nothing here carries a secret; errors are plain strings.

use rh_placement::backend::{
    BackendError, Fallback, PlacementState, PlacementStatus, StartPlacement,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Start,
    Describe,
    Stop,
    Terminate,
    Capacity,
    DnsUpsert,
    DnsDelete,
    DnsResolve,
}

impl Op {
    /// Operations whose accepted effect is an external mutation (and is traced).
    pub fn is_mutation(self) -> bool {
        matches!(
            self,
            Op::Start | Op::Stop | Op::Terminate | Op::DnsUpsert | Op::DnsDelete
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum WireReq {
    Start {
        placement_id: String,
        queue_name: String,
        max_player_sessions: u32,
        players: Vec<String>,
        game_session_data: String,
        location_order: Vec<String>,
        fallback: String,
    },
    Describe {
        placement_id: String,
    },
    Stop {
        placement_id: String,
    },
    Terminate {
        arn: String,
    },
    Capacity,
    DnsUpsert {
        name: String,
        ip: String,
        ttl_s: u32,
    },
    DnsDelete {
        name: String,
    },
    DnsResolve {
        name: String,
    },
}

impl WireReq {
    pub fn from_start(r: &StartPlacement) -> Self {
        WireReq::Start {
            placement_id: r.placement_id.clone(),
            queue_name: r.queue_name.clone(),
            max_player_sessions: r.max_player_sessions,
            players: r.players.clone(),
            game_session_data: r.game_session_data.clone(),
            location_order: r.location_order.clone(),
            fallback: r.fallback.api_name().to_string(),
        }
    }
    pub fn op(&self) -> Op {
        match self {
            WireReq::Start { .. } => Op::Start,
            WireReq::Describe { .. } => Op::Describe,
            WireReq::Stop { .. } => Op::Stop,
            WireReq::Terminate { .. } => Op::Terminate,
            WireReq::Capacity => Op::Capacity,
            WireReq::DnsUpsert { .. } => Op::DnsUpsert,
            WireReq::DnsDelete { .. } => Op::DnsDelete,
            WireReq::DnsResolve { .. } => Op::DnsResolve,
        }
    }
    /// Placement id, ARN or hostname: what a [`crate::remote_fake::Matcher`] prefix matches.
    pub fn key(&self) -> Option<String> {
        match self {
            WireReq::Start { placement_id, .. }
            | WireReq::Describe { placement_id }
            | WireReq::Stop { placement_id } => Some(placement_id.clone()),
            WireReq::Terminate { arn } => Some(arn.clone()),
            WireReq::DnsUpsert { name, .. }
            | WireReq::DnsDelete { name }
            | WireReq::DnsResolve { name } => Some(name.clone()),
            WireReq::Capacity => None,
        }
    }
    pub fn to_start(&self) -> Option<StartPlacement> {
        if let WireReq::Start {
            placement_id,
            queue_name,
            max_player_sessions,
            players,
            game_session_data,
            location_order,
            fallback,
        } = self
        {
            Some(StartPlacement {
                placement_id: placement_id.clone(),
                queue_name: queue_name.clone(),
                max_player_sessions: *max_player_sessions,
                players: players.clone(),
                game_session_data: game_session_data.clone(),
                location_order: location_order.clone(),
                fallback: if fallback == Fallback::None.api_name() {
                    Fallback::None
                } else {
                    Fallback::DefaultAfterSinglePass
                },
            })
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WirePlacement {
    pub game_session_data: Option<String>,
    pub placement_id: String,
    pub status: PlacementStatus,
    pub game_session_arn: Option<String>,
    pub region: Option<String>,
    pub ip_address: Option<String>,
    pub port: Option<u16>,
    pub placed_player_sessions: Vec<(String, String)>,
}

impl From<&PlacementState> for WirePlacement {
    fn from(s: &PlacementState) -> Self {
        Self {
            game_session_data: s.game_session_data.clone(),
            placement_id: s.placement_id.clone(),
            status: s.status,
            game_session_arn: s.game_session_arn.clone(),
            region: s.region.clone(),
            ip_address: s.ip_address.clone(),
            port: s.port,
            placed_player_sessions: s.placed_player_sessions.clone(),
        }
    }
}

impl From<WirePlacement> for PlacementState {
    fn from(s: WirePlacement) -> Self {
        Self {
            game_session_data: s.game_session_data,
            placement_id: s.placement_id,
            status: s.status,
            game_session_arn: s.game_session_arn,
            region: s.region,
            ip_address: s.ip_address,
            port: s.port,
            placed_player_sessions: s.placed_player_sessions,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "msg", rename_all = "snake_case")]
pub enum WireErr {
    NotFound,
    AlreadyExists,
    Invalid(String),
    Unavailable(String),
}

impl From<&BackendError> for WireErr {
    fn from(e: &BackendError) -> Self {
        match e {
            BackendError::NotFound => WireErr::NotFound,
            BackendError::AlreadyExists => WireErr::AlreadyExists,
            BackendError::Invalid(m) => WireErr::Invalid(m.clone()),
            BackendError::Unavailable(m) => WireErr::Unavailable(m.clone()),
        }
    }
}

impl From<WireErr> for BackendError {
    fn from(e: WireErr) -> Self {
        match e {
            WireErr::NotFound => BackendError::NotFound,
            WireErr::AlreadyExists => BackendError::AlreadyExists,
            WireErr::Invalid(m) => BackendError::Invalid(m),
            WireErr::Unavailable(m) => BackendError::Unavailable(m),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "res", rename_all = "snake_case")]
pub enum WireResp {
    Placement {
        state: WirePlacement,
    },
    Unit,
    Capacity {
        regions: BTreeMap<String, Option<u32>>,
    },
    Addrs {
        addrs: Vec<String>,
    },
    Err {
        err: WireErr,
    },
}
