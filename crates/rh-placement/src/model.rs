//! Shared data types: configuration, the request a party makes, and what the user can be told.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

/// Largest party / room (matches `rh_sim::MAX_PLAYERS` at the time of writing; the placement service does not link the sim).
pub const MAX_PARTY: usize = 8;
/// Largest RTT accepted from a client, in ms. Anything above is a measurement fault, not a region choice.
pub const MAX_REPORTED_RTT_MS: u32 = 5_000;

/// One selectable region (a GameLift fleet location the queue may place in).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionConfig {
    /// AWS location code, e.g. `us-west-2`. Also the key of every RTT map and the GameLift `LocationOrder` entry.
    pub id: String,
    /// What the player sees, e.g. "Oregon".
    pub label: String,
    /// The regional probe origin (`https://probe-<id>.<zone>`; docs/hosting/LATENCY_PROBES.md). Informational here.
    #[serde(default)]
    pub probe_url: String,
}

/// What to do when no region meets the hard limit and the player did not choose one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverLimitPolicy {
    /// Place in the best region anyway and tell the player the ping is high (default: a ceiling warns, it does not forbid).
    PlaceWithWarning,
    /// Refuse with [`Refusal::AllRegionsOverLimit`]; the player may choose a region manually.
    Refuse,
}

/// Tunables. Defaults are the provisional values of docs/hosting/LATENCY_PROBES.md (owner decision pending).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PlacementPolicy {
    /// At or under this the region is `Preferred`.
    pub preferred_max_ms: u32,
    /// Over this the region is `OverLimit` (still usable, with a warning, unless [`OverLimitPolicy::Refuse`]).
    pub hard_max_ms: u32,
    /// Costs inside the same bucket of this many ms are a tie (then lower mean RTT, then capacity order, then list order).
    pub tie_bucket_ms: u32,
    /// Added to the cost of a region whose idle session capacity is known to be zero (a scale-up wait is likely).
    pub no_capacity_penalty_ms: u32,
    /// Reports older than this are ignored (the member counts as having no data).
    pub max_report_age_s: u32,
    pub over_limit: OverLimitPolicy,
    /// Per-attempt wait before we cancel and widen.
    pub attempt_timeout_ms: u64,
    /// Whole-request budget across attempts and DNS.
    pub total_budget_ms: u64,
    pub poll_interval_ms: u64,
    /// How long we wait for the new hostname to resolve at the authoritative servers before giving the client the name.
    pub dns_verify_timeout_ms: u64,
    pub dns_ttl_s: u32,
}

impl Default for PlacementPolicy {
    fn default() -> Self {
        Self {
            preferred_max_ms: 120,
            hard_max_ms: 180,
            tie_bucket_ms: 10,
            no_capacity_penalty_ms: 40,
            max_report_age_s: 300,
            over_limit: OverLimitPolicy::PlaceWithWarning,
            attempt_timeout_ms: 20_000,
            total_budget_ms: 75_000,
            poll_interval_ms: 1_000,
            dns_verify_timeout_ms: 10_000,
            dns_ttl_s: 60,
        }
    }
}

impl PlacementPolicy {
    pub fn attempt_timeout(&self) -> Duration {
        Duration::from_millis(self.attempt_timeout_ms)
    }
    pub fn total_budget(&self) -> Duration {
        Duration::from_millis(self.total_budget_ms)
    }
    pub fn poll_interval(&self) -> Duration {
        Duration::from_millis(self.poll_interval_ms.max(1))
    }
    pub fn dns_verify_timeout(&self) -> Duration {
        Duration::from_millis(self.dns_verify_timeout_ms)
    }
    /// Reject nonsensical settings at start-up rather than at the first player.
    pub fn validate(&self) -> Result<(), String> {
        if self.preferred_max_ms == 0 || self.preferred_max_ms > self.hard_max_ms {
            return Err("preferred_max_ms must be in 1..=hard_max_ms".into());
        }
        if self.tie_bucket_ms == 0 {
            return Err("tie_bucket_ms must be at least 1".into());
        }
        if self.attempt_timeout_ms < 1_000 || self.total_budget_ms < self.attempt_timeout_ms {
            return Err("attempt_timeout_ms must be >= 1000 and <= total_budget_ms".into());
        }
        if self.dns_ttl_s < 30 {
            return Err("dns_ttl_s below 30 s is not accepted by the DNS provider".into());
        }
        Ok(())
    }
}

/// One member's latest probe result. `rtt_ms[region]` is the median of the warmed-up samples; `null` means the probe failed
/// (two or more failures, LATENCY_PROBES.md); a missing key means the region was not measured. Both count as "not reachable".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberReport {
    pub callsign: String,
    /// Seconds since this report was measured (the service stamps it from its own receive time, not the client's clock).
    pub age_s: u32,
    pub rtt_ms: BTreeMap<String, Option<u32>>,
}

/// A party asking for a match.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacementRequest {
    /// Minted by the account API for this party action (8..=32 ASCII alphanumerics). It makes the call idempotent: it is
    /// part of the GameLift placement id.
    pub request_id: String,
    pub party: Vec<MemberReport>,
    /// The player's explicit choice. Strict: honoured exactly or refused, never silently replaced.
    #[serde(default)]
    pub region_override: Option<String>,
}

/// Idle session capacity of one region, from CloudWatch `AvailableGameSessions` (a minute stale at best).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionCapacity {
    /// `None` = unknown (metric missing): never penalised.
    pub available_sessions: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Preferred,
    Acceptable,
    OverLimit,
}

/// Things the UI can show next to the result. Stable codes (`code()`), plain text for the default rendering.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Warning {
    /// Fewer members had usable data than the party size; their RTT did not influence the choice.
    MembersUnscored { callsigns: Vec<String> },
    /// Members whose probes all failed: they were left out of scoring and may not be able to connect.
    MembersUnreachable { callsigns: Vec<String> },
    /// Nobody had usable data: the configured region order was used.
    NoLatencyData,
    /// No region is reachable by every scored member; the regions reachable by the most members were used.
    PartialReachability { reached: usize, of: usize },
    /// The chosen region is over the hard limit for the slowest member.
    HighPing { region: String, worst_ms: u32 },
    /// Nothing was under the hard limit; the best region was used anyway.
    AllRegionsOverLimit { best_region: String, best_ms: u32 },
    /// The manual region has no known idle capacity right now: expect a wait for a new host.
    OverrideNoCapacity { region: String },
}

impl Warning {
    pub fn code(&self) -> &'static str {
        match self {
            Warning::MembersUnscored { .. } => "members_unscored",
            Warning::MembersUnreachable { .. } => "members_unreachable",
            Warning::NoLatencyData => "no_latency_data",
            Warning::PartialReachability { .. } => "partial_reachability",
            Warning::HighPing { .. } => "high_ping",
            Warning::AllRegionsOverLimit { .. } => "all_regions_over_limit",
            Warning::OverrideNoCapacity { .. } => "override_no_capacity",
        }
    }
    pub fn text(&self) -> String {
        match self {
            Warning::MembersUnscored { callsigns } => format!("No recent ping for {}; their connection was not considered.", callsigns.join(", ")),
            Warning::MembersUnreachable { callsigns } => format!("{} could not reach any region and may not be able to join.", callsigns.join(", ")),
            Warning::NoLatencyData => "No ping data yet; using the default region.".into(),
            Warning::PartialReachability { reached, of } => format!("No region is reachable by all {of} players; using one reachable by {reached}."),
            Warning::HighPing { region, worst_ms } => format!("Ping to {region} will be high for the slowest player ({worst_ms} ms)."),
            Warning::AllRegionsOverLimit { best_region, best_ms } => format!("Every region has high ping for someone in this party; the best is {best_region} at {best_ms} ms."),
            Warning::OverrideNoCapacity { region } => format!("{region} has no ready server right now; starting one may take a minute."),
        }
    }
}

/// Reasons the planner will not produce a placement at all.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Refusal {
    /// Every member probed and no probe succeeded.
    NoReachableRegion,
    /// `OverLimitPolicy::Refuse` and nothing is under the hard limit. `best` is the least bad region for the party.
    AllRegionsOverLimit { best_region: String, best_ms: u32 },
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::NoReachableRegion => "no_reachable_region",
            Refusal::AllRegionsOverLimit { .. } => "all_regions_over_limit",
        }
    }
    pub fn text(&self) -> String {
        match self {
            Refusal::NoReachableRegion => "Could not reach any game region from your network. Check your connection and try again.".into(),
            Refusal::AllRegionsOverLimit { best_region, best_ms } => format!(
                "Ping is too high everywhere for this party (best: {best_region}, {best_ms} ms). Choose a region manually to play anyway."
            ),
        }
    }
}
