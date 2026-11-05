//! Offline planner CLI. Reads JSON on stdin, writes JSON on stdout. Touches no network and no cloud API.
//!
//!   rh-placement plan < request.json           # { "regions": [...], "policy": {...}?, "capacity": {...}?, "request": {...}, "queue": "...", "zone": "..." }
//!
//! Output: the ranked regions, the attempt ladder, the warnings, and for the first attempt the exact
//! `StartGameSessionPlacement` JSON (the payload the NOT RUN placement test would send).

use rh_placement::backend::{Fallback, StartPlacement};
use rh_placement::score::{plan, PlanError};
use rh_placement::*;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::io::Read;

#[derive(Deserialize)]
struct Input {
    regions: Vec<RegionConfig>,
    #[serde(default)]
    policy: PlacementPolicy,
    #[serde(default)]
    capacity: BTreeMap<String, RegionCapacity>,
    request: PlacementRequest,
    #[serde(default = "default_queue")]
    queue: String,
}

fn default_queue() -> String {
    "rh-placement-queue".into()
}

fn main() {
    if std::env::args().nth(1).as_deref() != Some("plan") {
        eprintln!("usage: rh-placement plan < input.json");
        std::process::exit(2);
    }
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("stdin");
    let input: Input = match serde_json::from_str(&raw) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("bad input: {e}");
            std::process::exit(2);
        }
    };
    let out = match plan(
        &input.regions,
        &input.policy,
        &input.capacity,
        &input.request,
    ) {
        Ok(p) => {
            let first = &p.attempts[0];
            let sp = StartPlacement {
                placement_id: format!("rh-{}-1", input.request.request_id),
                queue_name: input.queue,
                max_player_sessions: 8,
                players: input
                    .request
                    .party
                    .iter()
                    .map(|m| m.callsign.clone())
                    .collect(),
                game_session_data: format!("{{\"requestId\":\"{}\"}}", input.request.request_id),
                location_order: first.locations.clone(),
                fallback: Fallback::None,
            };
            json!({
                "ok": true,
                "manual": p.manual,
                "scoredMembers": p.scored_members,
                "ranked": p.ranked.iter().map(|r| json!({"region": r.region, "maxMs": r.max_ms, "sumMs": r.sum_ms, "tier": r.tier, "eligible": r.eligible, "availableSessions": r.available_sessions, "costMs": r.cost_ms})).collect::<Vec<_>>(),
                "attempts": p.attempts.iter().map(|a| json!({"kind": format!("{:?}", a.kind), "locations": a.locations, "timeoutMs": a.timeout.as_millis() as u64})).collect::<Vec<_>>(),
                "warnings": p.warnings.iter().map(|w| json!({"code": w.code(), "text": w.text()})).collect::<Vec<_>>(),
                "firstStartGameSessionPlacement": sp.to_api_json(),
            })
        }
        Err(PlanError::Refused(r)) => json!({"ok": false, "code": r.code(), "text": r.text()}),
        Err(PlanError::UnknownRegion(r)) => {
            json!({"ok": false, "code": "unknown_region", "region": r})
        }
        Err(PlanError::Invalid(m)) => json!({"ok": false, "code": "invalid_request", "detail": m}),
    };
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
