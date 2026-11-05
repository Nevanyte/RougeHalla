//! The planner: pure, deterministic, no I/O. Everything the player is told traces back to a field here.
//!
//! Rules (docs/hosting/PLACEMENT.md section 4 states them with the reasoning):
//!
//! 1. Score each region by the **worst** scored member's RTT (minimise the maximum), not the mean: one player at 250 ms
//!    is a worse match than three at 90 ms and one at 130 ms. GameLift's own latency ordering averages, which is why we
//!    do not send `PlayerLatencies`.
//! 2. A region every scored member reached is *eligible*. Tier by that maximum: `Preferred` (<= preferred), `Acceptable`
//!    (<= hard), `OverLimit`.
//! 3. Rank eligible regions by (tier, cost bucket, summed RTT, configured order) where cost = max RTT plus a penalty when
//!    the region is known to have zero idle sessions (capacity acts only through that penalty). The bucket makes a few ms of
//!    difference a tie that the summed RTT and then the configured order decide.
//! 4. Attempt ladder: preferred regions with capacity, then every acceptable region, then (policy) every eligible region.
//!    Each attempt is one bounded GameLift placement; the service never relies on `DEFAULT_AFTER_SINGLE_PASS`.
//! 5. A manual region is strict: one attempt, that region only, warnings but no refusal and no silent substitute.

use crate::model::*;
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegionScore {
    pub region: String,
    /// Worst RTT among the members that reached the region (`None` when no scored member did).
    pub max_ms: Option<u32>,
    /// Sum of those members' RTTs (tie-break; the same member count for every eligible region).
    pub sum_ms: Option<u32>,
    pub reached_by: usize,
    pub tier: Tier,
    /// Reached by every scored member. Ineligible regions are listed last and never placed in automatically.
    pub eligible: bool,
    pub available_sessions: Option<u32>,
    /// `max_ms` plus the no-capacity penalty.
    pub cost_ms: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttemptKind {
    /// Preferred-tier regions that have idle capacity.
    Preferred,
    /// Every acceptable region (includes ones that need a scale-up).
    Widened,
    /// Over-limit regions as well (only under [`OverLimitPolicy::PlaceWithWarning`]).
    LastResort,
    /// Ranking carried no information (nobody had data): the configured order.
    DefaultOrder,
    /// The player's explicit choice.
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub kind: AttemptKind,
    /// GameLift `LocationOrder`, best first, no duplicates.
    pub locations: Vec<String>,
    pub timeout: Duration,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub manual: bool,
    pub ranked: Vec<RegionScore>,
    pub attempts: Vec<Attempt>,
    pub warnings: Vec<Warning>,
    /// How many members influenced the ranking.
    pub scored_members: usize,
}

impl Plan {
    pub fn score_of(&self, region: &str) -> Option<&RegionScore> {
        self.ranked.iter().find(|r| r.region == region)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlanError {
    /// The request or configuration is malformed (a bug or an attack, not a network condition).
    Invalid(String),
    /// A manual region that is not configured.
    UnknownRegion(String),
    Refused(Refusal),
}

pub fn callsign_ok(s: &str) -> bool {
    (2..=16).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn request_id_ok(s: &str) -> bool {
    (8..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn validate_regions(regions: &[RegionConfig]) -> Result<(), String> {
    if regions.is_empty() {
        return Err("no regions configured".into());
    }
    if regions.len() > 10 {
        return Err("at most 10 regions (GameLift LocationOrder limit)".into());
    }
    let mut seen = BTreeSet::new();
    for r in regions {
        if !crate::hostname::region_ok(&r.id) {
            return Err(format!(
                "region id {:?} is not a DNS-safe location code",
                r.id
            ));
        }
        if !seen.insert(&r.id) {
            return Err(format!("region {} configured twice", r.id));
        }
    }
    Ok(())
}

enum Member<'a> {
    Scored(&'a MemberReport),
    Unreachable(&'a str),
    NoData(&'a str),
}

fn classify<'a>(
    m: &'a MemberReport,
    regions: &[RegionConfig],
    policy: &PlacementPolicy,
) -> Member<'a> {
    if m.age_s > policy.max_report_age_s {
        return Member::NoData(&m.callsign);
    }
    let known: Vec<&Option<u32>> = regions.iter().filter_map(|r| m.rtt_ms.get(&r.id)).collect();
    if known.is_empty() {
        Member::NoData(&m.callsign)
    } else if known.iter().all(|v| v.is_none()) {
        Member::Unreachable(&m.callsign)
    } else {
        Member::Scored(m)
    }
}

/// Plan a placement. `capacity` may be empty (every region unknown).
pub fn plan(
    regions: &[RegionConfig],
    policy: &PlacementPolicy,
    capacity: &BTreeMap<String, RegionCapacity>,
    req: &PlacementRequest,
) -> Result<Plan, PlanError> {
    validate_regions(regions).map_err(PlanError::Invalid)?;
    policy.validate().map_err(PlanError::Invalid)?;
    if !request_id_ok(&req.request_id) {
        return Err(PlanError::Invalid(
            "request_id must be 8..=32 ASCII alphanumerics".into(),
        ));
    }
    if req.party.is_empty() || req.party.len() > MAX_PARTY {
        return Err(PlanError::Invalid(format!(
            "party size must be 1..={MAX_PARTY}"
        )));
    }
    let mut names = BTreeSet::new();
    for m in &req.party {
        if !callsign_ok(&m.callsign) {
            return Err(PlanError::Invalid(format!(
                "invalid callsign {:?}",
                m.callsign
            )));
        }
        if !names.insert(m.callsign.to_ascii_lowercase()) {
            return Err(PlanError::Invalid(format!(
                "callsign {} appears twice",
                m.callsign
            )));
        }
        for (region, v) in &m.rtt_ms {
            if matches!(v, Some(ms) if *ms > MAX_REPORTED_RTT_MS) {
                return Err(PlanError::Invalid(format!(
                    "rtt for {region} exceeds {MAX_REPORTED_RTT_MS} ms"
                )));
            }
        }
    }
    if let Some(o) = &req.region_override {
        if !regions.iter().any(|r| &r.id == o) {
            return Err(PlanError::UnknownRegion(o.clone()));
        }
    }

    let mut warnings = Vec::new();
    let mut scored: Vec<&MemberReport> = Vec::new();
    let (mut unreachable, mut nodata) = (Vec::new(), Vec::new());
    for m in &req.party {
        match classify(m, regions, policy) {
            Member::Scored(m) => scored.push(m),
            Member::Unreachable(c) => unreachable.push(c.to_string()),
            Member::NoData(c) => nodata.push(c.to_string()),
        }
    }
    if !nodata.is_empty() {
        warnings.push(Warning::MembersUnscored {
            callsigns: nodata.clone(),
        });
    }
    if !unreachable.is_empty() {
        warnings.push(Warning::MembersUnreachable {
            callsigns: unreachable.clone(),
        });
    }
    let n = scored.len();
    let cap_of = |id: &str| capacity.get(id).and_then(|c| c.available_sessions);

    // Per-region aggregates over the scored members (empty when nobody was scored).
    let mut raw: Vec<RegionScore> = regions
        .iter()
        .map(|r| {
            let vals: Vec<u32> = scored
                .iter()
                .filter_map(|m| m.rtt_ms.get(&r.id).copied().flatten())
                .collect();
            let max = vals.iter().copied().max();
            let sum = if vals.is_empty() {
                None
            } else {
                Some(vals.iter().sum())
            };
            let cap = cap_of(&r.id);
            let penalty = if cap == Some(0) {
                policy.no_capacity_penalty_ms
            } else {
                0
            };
            RegionScore {
                region: r.id.clone(),
                max_ms: max,
                sum_ms: sum,
                reached_by: vals.len(),
                tier: match max {
                    Some(ms) if ms <= policy.preferred_max_ms => Tier::Preferred,
                    Some(ms) if ms <= policy.hard_max_ms => Tier::Acceptable,
                    Some(_) => Tier::OverLimit,
                    None => Tier::Acceptable,
                },
                eligible: n > 0 && vals.len() == n,
                available_sessions: cap,
                cost_ms: max.map(|m| m.saturating_add(penalty)),
            }
        })
        .collect();

    // Manual region: strict, one attempt.
    if let Some(o) = &req.region_override {
        let s = raw
            .iter()
            .find(|r| &r.region == o)
            .cloned()
            .expect("validated above");
        if n > 0 {
            if s.reached_by < n {
                warnings.push(Warning::PartialReachability {
                    reached: s.reached_by,
                    of: n,
                });
            }
            if let Some(ms) = s.max_ms {
                if ms > policy.hard_max_ms {
                    warnings.push(Warning::HighPing {
                        region: o.clone(),
                        worst_ms: ms,
                    });
                }
            }
        }
        if s.available_sessions == Some(0) {
            warnings.push(Warning::OverrideNoCapacity { region: o.clone() });
        }
        return Ok(Plan {
            manual: true,
            ranked: rank(raw, policy, regions),
            attempts: vec![Attempt {
                kind: AttemptKind::Manual,
                locations: vec![o.clone()],
                timeout: policy.total_budget(),
            }],
            warnings,
            scored_members: n,
        });
    }

    // Nobody scored.
    if n == 0 {
        if nodata.is_empty() {
            // Everyone probed and nothing answered.
            return Err(PlanError::Refused(Refusal::NoReachableRegion));
        }
        warnings.push(Warning::NoLatencyData);
        // Known-empty regions go last; otherwise the configured order.
        let order: Vec<RegionScore> = {
            let mut v = raw.clone();
            v.sort_by_key(|r| {
                (
                    r.available_sessions == Some(0),
                    index_of(regions, &r.region),
                )
            });
            v
        };
        let locations: Vec<String> = order.iter().map(|r| r.region.clone()).collect();
        return Ok(Plan {
            manual: false,
            ranked: order,
            attempts: vec![Attempt {
                kind: AttemptKind::DefaultOrder,
                locations,
                timeout: policy.attempt_timeout(),
            }],
            warnings,
            scored_members: 0,
        });
    }

    // Eligibility: reached by every scored member; if no region is, fall back to the best-reached regions and say so.
    if !raw.iter().any(|r| r.eligible) {
        let best = raw.iter().map(|r| r.reached_by).max().unwrap_or(0);
        warnings.push(Warning::PartialReachability {
            reached: best,
            of: n,
        });
        for r in raw.iter_mut() {
            r.eligible = r.reached_by == best && best > 0;
        }
    }
    let ranked = rank(std::mem::take(&mut raw), policy, regions);
    let eligible: Vec<&RegionScore> = ranked.iter().filter(|r| r.eligible).collect();
    let best = eligible[0];
    if best.tier == Tier::OverLimit {
        let (best_region, best_ms) = (best.region.clone(), best.max_ms.unwrap_or(0));
        if policy.over_limit == OverLimitPolicy::Refuse {
            return Err(PlanError::Refused(Refusal::AllRegionsOverLimit {
                best_region,
                best_ms,
            }));
        }
        warnings.push(Warning::AllRegionsOverLimit {
            best_region,
            best_ms,
        });
    }

    // The ladder. Each later attempt is a superset of the one before, in rank order.
    let mut attempts: Vec<Attempt> = Vec::new();
    let push = |kind: AttemptKind, locs: Vec<String>, attempts: &mut Vec<Attempt>| {
        if locs.is_empty() || attempts.last().is_some_and(|a| a.locations == locs) {
            return;
        }
        attempts.push(Attempt {
            kind,
            locations: locs,
            timeout: policy.attempt_timeout(),
        });
    };
    let take = |pred: &dyn Fn(&RegionScore) -> bool| -> Vec<String> {
        eligible
            .iter()
            .filter(|r| pred(r))
            .map(|r| r.region.clone())
            .collect()
    };
    push(
        AttemptKind::Preferred,
        take(&|r| r.tier == Tier::Preferred && r.available_sessions != Some(0)),
        &mut attempts,
    );
    push(
        AttemptKind::Widened,
        take(&|r| r.tier <= Tier::Acceptable),
        &mut attempts,
    );
    if policy.over_limit == OverLimitPolicy::PlaceWithWarning {
        push(AttemptKind::LastResort, take(&|_| true), &mut attempts);
    }
    if attempts.is_empty() {
        // Only reachable if the ladder rules above all produced nothing: never leave the caller without an attempt.
        push(AttemptKind::LastResort, take(&|_| true), &mut attempts);
    }
    Ok(Plan {
        manual: false,
        ranked,
        attempts,
        warnings,
        scored_members: n,
    })
}

fn index_of(regions: &[RegionConfig], id: &str) -> usize {
    regions
        .iter()
        .position(|r| r.id == id)
        .unwrap_or(usize::MAX)
}

fn rank(
    mut v: Vec<RegionScore>,
    policy: &PlacementPolicy,
    regions: &[RegionConfig],
) -> Vec<RegionScore> {
    let bucket = policy.tie_bucket_ms.max(1);
    v.sort_by_key(|r| {
        (
            !r.eligible,
            r.tier,
            r.cost_ms.map(|c| c / bucket).unwrap_or(u32::MAX),
            r.sum_ms.unwrap_or(u32::MAX),
            index_of(regions, &r.region),
        )
    });
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn regions() -> Vec<RegionConfig> {
        ["us-west-2", "ca-central-1", "us-east-2"]
            .iter()
            .map(|id| RegionConfig {
                id: id.to_string(),
                label: id.to_string(),
                probe_url: String::new(),
            })
            .collect()
    }

    fn m(name: &str, rtts: &[(&str, Option<u32>)]) -> MemberReport {
        MemberReport {
            callsign: name.into(),
            age_s: 5,
            rtt_ms: rtts.iter().map(|(r, v)| (r.to_string(), *v)).collect(),
        }
    }

    fn req(party: Vec<MemberReport>) -> PlacementRequest {
        PlacementRequest {
            request_id: "req00001".into(),
            party,
            region_override: None,
        }
    }

    fn cap(pairs: &[(&str, Option<u32>)]) -> BTreeMap<String, RegionCapacity> {
        pairs
            .iter()
            .map(|(r, c)| {
                (
                    r.to_string(),
                    RegionCapacity {
                        available_sessions: *c,
                    },
                )
            })
            .collect()
    }

    fn go(party: Vec<MemberReport>) -> Result<Plan, PlanError> {
        plan(
            &regions(),
            &PlacementPolicy::default(),
            &BTreeMap::new(),
            &req(party),
        )
    }

    fn order(p: &Plan) -> Vec<&str> {
        p.ranked.iter().map(|r| r.region.as_str()).collect()
    }

    #[test]
    fn single_player_picks_the_lowest_rtt() {
        let p = go(vec![m(
            "alice",
            &[
                ("us-west-2", Some(30)),
                ("ca-central-1", Some(70)),
                ("us-east-2", Some(95)),
            ],
        )])
        .unwrap();
        assert_eq!(order(&p), ["us-west-2", "ca-central-1", "us-east-2"]);
        assert!(p.warnings.is_empty());
        assert_eq!(p.attempts[0].kind, AttemptKind::Preferred);
        assert_eq!(
            p.attempts[0].locations,
            ["us-west-2", "ca-central-1", "us-east-2"]
        );
    }

    #[test]
    fn party_minimises_the_maximum_not_the_mean() {
        // West: mean 95 but worst 190. East-ish: mean 112 but worst 120. Minimise-the-max picks ca-central-1.
        let p = go(vec![
            m(
                "alice",
                &[
                    ("us-west-2", Some(20)),
                    ("ca-central-1", Some(110)),
                    ("us-east-2", Some(150)),
                ],
            ),
            m(
                "bob",
                &[
                    ("us-west-2", Some(190)),
                    ("ca-central-1", Some(120)),
                    ("us-east-2", Some(40)),
                ],
            ),
        ])
        .unwrap();
        assert_eq!(p.ranked[0].region, "ca-central-1");
        assert_eq!(p.ranked[0].max_ms, Some(120));
        assert_eq!(p.score_of("us-west-2").unwrap().tier, Tier::OverLimit);
        // The over-limit region is last and only appears in the last-resort attempt, never in the first two.
        assert_eq!(p.attempts[0].locations, ["ca-central-1"]);
        assert_eq!(p.attempts.last().unwrap().kind, AttemptKind::LastResort);
        assert_eq!(p.attempts[1].locations, ["ca-central-1", "us-east-2"]);
        assert!(!p
            .attempts
            .iter()
            .any(|a| a.kind != AttemptKind::LastResort
                && a.locations.contains(&"us-west-2".to_string())));
    }

    #[test]
    fn every_member_counts_including_the_slowest() {
        // Seven fast players cannot outvote one slow one.
        let mut party: Vec<MemberReport> = (0..7)
            .map(|i| {
                m(
                    &format!("p{i}x"),
                    &[("us-west-2", Some(15)), ("us-east-2", Some(75))],
                )
            })
            .collect();
        party.push(m(
            "slowpoke",
            &[("us-west-2", Some(160)), ("us-east-2", Some(45))],
        ));
        let p = go(party).unwrap();
        assert_eq!(p.ranked[0].region, "us-east-2");
        assert_eq!(p.scored_members, 8);
    }

    #[test]
    fn zero_capacity_adds_a_penalty_and_buckets_make_ties() {
        let party = vec![m(
            "alice",
            &[
                ("us-west-2", Some(62)),
                ("ca-central-1", Some(66)),
                ("us-east-2", Some(110)),
            ],
        )];
        // 62 and 66 share the 60..69 bucket: a tie, so the summed RTT decides and spare capacity does not flip it.
        let p = plan(
            &regions(),
            &PlacementPolicy::default(),
            &cap(&[("us-west-2", Some(3)), ("ca-central-1", Some(3))]),
            &req(party.clone()),
        )
        .unwrap();
        assert_eq!(p.ranked[0].region, "us-west-2");
        // Zero idle sessions in west adds 40 ms to its cost: 102 vs 66, so ca-central-1 wins.
        let p = plan(
            &regions(),
            &PlacementPolicy::default(),
            &cap(&[("us-west-2", Some(0)), ("ca-central-1", Some(2))]),
            &req(party),
        )
        .unwrap();
        assert_eq!(p.ranked[0].region, "ca-central-1");
        // The empty region is excluded from the first attempt, kept in the second (a scale-up may finish).
        assert_eq!(p.attempts[0].locations, ["ca-central-1", "us-east-2"]);
        assert_eq!(
            p.attempts[1].locations,
            ["ca-central-1", "us-west-2", "us-east-2"]
        );
    }

    #[test]
    fn unknown_capacity_is_never_penalised() {
        let party = vec![m(
            "alice",
            &[("us-west-2", Some(30)), ("ca-central-1", Some(70))],
        )];
        let p = plan(
            &regions(),
            &PlacementPolicy::default(),
            &cap(&[("us-west-2", None)]),
            &req(party),
        )
        .unwrap();
        assert_eq!(p.ranked[0].region, "us-west-2");
        assert_eq!(p.ranked[0].cost_ms, Some(30));
    }

    #[test]
    fn a_region_a_member_cannot_reach_is_ineligible() {
        let p = go(vec![
            m(
                "alice",
                &[("us-west-2", Some(20)), ("ca-central-1", Some(60))],
            ),
            m("bob", &[("us-west-2", None), ("ca-central-1", Some(80))]),
        ])
        .unwrap();
        assert_eq!(p.ranked[0].region, "ca-central-1");
        assert!(!p.score_of("us-west-2").unwrap().eligible);
        assert!(p
            .attempts
            .iter()
            .all(|a| !a.locations.contains(&"us-west-2".to_string())));
        // A region nobody measured (missing key) is the same as unreachable.
        let p = go(vec![
            m("alice", &[("us-west-2", Some(20))]),
            m(
                "bob",
                &[("us-west-2", Some(30)), ("ca-central-1", Some(10))],
            ),
        ])
        .unwrap();
        assert_eq!(p.ranked[0].region, "us-west-2");
        assert!(!p.score_of("ca-central-1").unwrap().eligible);
    }

    #[test]
    fn no_common_region_degrades_with_a_warning() {
        let p = go(vec![
            m("alice", &[("us-west-2", Some(20))]),
            m("bob", &[("us-east-2", Some(20))]),
        ])
        .unwrap();
        assert!(p
            .warnings
            .contains(&Warning::PartialReachability { reached: 1, of: 2 }));
        assert_eq!(p.ranked.iter().filter(|r| r.eligible).count(), 2);
    }

    #[test]
    fn members_without_data_or_with_stale_data_do_not_influence_the_choice() {
        let mut stale = m(
            "old",
            &[("us-west-2", Some(400)), ("ca-central-1", Some(10))],
        );
        stale.age_s = 301;
        let p = go(vec![
            m(
                "alice",
                &[("us-west-2", Some(20)), ("ca-central-1", Some(90))],
            ),
            stale,
            m("empty", &[]),
        ])
        .unwrap();
        assert_eq!(p.ranked[0].region, "us-west-2");
        assert_eq!(p.scored_members, 1);
        assert!(p.warnings.contains(&Warning::MembersUnscored {
            callsigns: vec!["old".into(), "empty".into()]
        }));
    }

    #[test]
    fn unreachable_members_are_flagged_but_do_not_block_the_party() {
        let p = go(vec![
            m(
                "alice",
                &[("us-west-2", Some(20)), ("ca-central-1", Some(90))],
            ),
            m("walled", &[("us-west-2", None), ("ca-central-1", None)]),
        ])
        .unwrap();
        assert_eq!(p.ranked[0].region, "us-west-2");
        assert!(p.warnings.contains(&Warning::MembersUnreachable {
            callsigns: vec!["walled".into()]
        }));
    }

    #[test]
    fn everyone_unreachable_is_a_refusal_everyone_unmeasured_is_the_default_order() {
        let e = go(vec![m(
            "alice",
            &[("us-west-2", None), ("ca-central-1", None)],
        )])
        .unwrap_err();
        assert_eq!(e, PlanError::Refused(Refusal::NoReachableRegion));
        let p = go(vec![m("alice", &[])]).unwrap();
        assert_eq!(order(&p), ["us-west-2", "ca-central-1", "us-east-2"]);
        assert!(p.warnings.contains(&Warning::NoLatencyData));
        assert_eq!(p.attempts[0].kind, AttemptKind::DefaultOrder);
        // A mix of unreachable and unmeasured is not a refusal: the unmeasured member may be fine.
        assert!(go(vec![m("alice", &[("us-west-2", None)]), m("bob", &[])]).is_ok());
    }

    #[test]
    fn default_order_demotes_regions_known_to_be_empty() {
        let p = plan(
            &regions(),
            &PlacementPolicy::default(),
            &cap(&[("us-west-2", Some(0))]),
            &req(vec![m("alice", &[])]),
        )
        .unwrap();
        assert_eq!(order(&p), ["ca-central-1", "us-east-2", "us-west-2"]);
    }

    #[test]
    fn all_over_the_limit_places_with_a_warning_by_default_and_refuses_by_policy() {
        let party = vec![m(
            "alice",
            &[
                ("us-west-2", Some(240)),
                ("ca-central-1", Some(200)),
                ("us-east-2", Some(260)),
            ],
        )];
        let p = go(party.clone()).unwrap();
        assert_eq!(p.ranked[0].region, "ca-central-1");
        assert!(p.warnings.contains(&Warning::AllRegionsOverLimit {
            best_region: "ca-central-1".into(),
            best_ms: 200
        }));
        assert_eq!(p.attempts.len(), 1);
        assert_eq!(p.attempts[0].kind, AttemptKind::LastResort);
        let strict = PlacementPolicy {
            over_limit: OverLimitPolicy::Refuse,
            ..PlacementPolicy::default()
        };
        let e = plan(&regions(), &strict, &BTreeMap::new(), &req(party)).unwrap_err();
        assert_eq!(
            e,
            PlanError::Refused(Refusal::AllRegionsOverLimit {
                best_region: "ca-central-1".into(),
                best_ms: 200
            })
        );
    }

    #[test]
    fn manual_override_is_strict_single_and_never_forbidden() {
        let mut r = req(vec![m(
            "alice",
            &[
                ("us-west-2", Some(30)),
                ("ca-central-1", Some(70)),
                ("us-east-2", Some(230)),
            ],
        )]);
        r.region_override = Some("us-east-2".into());
        let p = plan(
            &regions(),
            &PlacementPolicy::default(),
            &cap(&[("us-east-2", Some(0))]),
            &r,
        )
        .unwrap();
        assert!(p.manual);
        assert_eq!(p.attempts.len(), 1);
        assert_eq!(p.attempts[0].kind, AttemptKind::Manual);
        assert_eq!(p.attempts[0].locations, ["us-east-2"]);
        assert!(p.warnings.contains(&Warning::HighPing {
            region: "us-east-2".into(),
            worst_ms: 230
        }));
        assert!(p.warnings.contains(&Warning::OverrideNoCapacity {
            region: "us-east-2".into()
        }));
        // Works with no latency data at all, and also under the Refuse policy.
        r.party = vec![m("alice", &[])];
        let strict = PlacementPolicy {
            over_limit: OverLimitPolicy::Refuse,
            ..PlacementPolicy::default()
        };
        assert!(plan(&regions(), &strict, &BTreeMap::new(), &r).is_ok());
        r.region_override = Some("eu-west-1".into());
        assert_eq!(
            plan(&regions(), &strict, &BTreeMap::new(), &r).unwrap_err(),
            PlanError::UnknownRegion("eu-west-1".into())
        );
    }

    #[test]
    fn attempts_widen_monotonically_without_repeats() {
        let party = vec![m(
            "alice",
            &[
                ("us-west-2", Some(50)),
                ("ca-central-1", Some(150)),
                ("us-east-2", Some(210)),
            ],
        )];
        let p = go(party).unwrap();
        let kinds: Vec<_> = p.attempts.iter().map(|a| a.kind).collect();
        assert_eq!(
            kinds,
            [
                AttemptKind::Preferred,
                AttemptKind::Widened,
                AttemptKind::LastResort
            ]
        );
        assert_eq!(p.attempts[0].locations, ["us-west-2"]);
        assert_eq!(p.attempts[1].locations, ["us-west-2", "ca-central-1"]);
        assert_eq!(
            p.attempts[2].locations,
            ["us-west-2", "ca-central-1", "us-east-2"]
        );
        for w in p.attempts.windows(2) {
            assert!(w[0].locations.iter().all(|l| w[1].locations.contains(l)));
        }
    }

    #[test]
    fn identical_preferred_and_acceptable_sets_collapse_to_one_attempt() {
        let p = go(vec![m(
            "alice",
            &[
                ("us-west-2", Some(30)),
                ("ca-central-1", Some(40)),
                ("us-east-2", Some(50)),
            ],
        )])
        .unwrap();
        assert_eq!(p.attempts.len(), 1);
    }

    #[test]
    fn ranking_is_deterministic_and_ignores_input_order() {
        let a = m(
            "alice",
            &[
                ("us-west-2", Some(61)),
                ("ca-central-1", Some(61)),
                ("us-east-2", Some(61)),
            ],
        );
        let b = m(
            "bobby",
            &[
                ("us-west-2", Some(61)),
                ("ca-central-1", Some(61)),
                ("us-east-2", Some(61)),
            ],
        );
        let p1 = go(vec![a.clone(), b.clone()]).unwrap();
        let p2 = go(vec![b, a]).unwrap();
        assert_eq!(
            order(&p1),
            ["us-west-2", "ca-central-1", "us-east-2"],
            "full ties resolve by configured order"
        );
        assert_eq!(order(&p1), order(&p2));
    }

    #[test]
    fn validation() {
        let ok = vec![m("alice", &[("us-west-2", Some(1))])];
        let bad = |f: &dyn Fn(&mut PlacementRequest)| {
            let mut r = req(ok.clone());
            f(&mut r);
            matches!(
                plan(
                    &regions(),
                    &PlacementPolicy::default(),
                    &BTreeMap::new(),
                    &r
                ),
                Err(PlanError::Invalid(_))
            )
        };
        assert!(bad(&|r| r.request_id = "short".into()));
        assert!(bad(&|r| r.request_id = "has space!".into()));
        assert!(bad(&|r| r.party.clear()));
        assert!(bad(
            &|r| r.party = (0..9).map(|i| m(&format!("pl{i}"), &[])).collect()
        ));
        assert!(bad(&|r| r.party[0].callsign = "x".into()));
        assert!(bad(&|r| r.party[0].callsign = "bad name".into()));
        assert!(bad(&|r| r.party.push(m("ALICE", &[]))));
        assert!(bad(&|r| {
            r.party[0].rtt_ms.insert("us-west-2".into(), Some(5001));
        }));
        // Unknown regions in a report are ignored, not fatal (a client with a newer region list).
        let mut r = req(ok.clone());
        r.party[0].rtt_ms.insert("mars-1".into(), Some(1));
        assert!(plan(
            &regions(),
            &PlacementPolicy::default(),
            &BTreeMap::new(),
            &r
        )
        .is_ok());
        // Configuration errors.
        assert!(plan(
            &[],
            &PlacementPolicy::default(),
            &BTreeMap::new(),
            &req(ok.clone())
        )
        .is_err());
        let bad_policy = PlacementPolicy {
            preferred_max_ms: 300,
            ..PlacementPolicy::default()
        };
        assert!(plan(&regions(), &bad_policy, &BTreeMap::new(), &req(ok)).is_err());
    }

    #[test]
    fn region_list_limits() {
        let many: Vec<RegionConfig> = (0..11)
            .map(|i| RegionConfig {
                id: format!("r-{i}"),
                label: String::new(),
                probe_url: String::new(),
            })
            .collect();
        assert!(validate_regions(&many).is_err());
        let dup = vec![regions()[0].clone(), regions()[0].clone()];
        assert!(validate_regions(&dup).is_err());
        let bad = vec![RegionConfig {
            id: "US-West".into(),
            label: String::new(),
            probe_url: String::new(),
        }];
        assert!(validate_regions(&bad).is_err());
    }
}
