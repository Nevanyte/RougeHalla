//! Credentials and durable results, behind small enums so the server builds with no database. `Memory` mirrors the
//! durable store's rules (idempotent by (match, profile), fenced leases) for tests and local play; `Postgres` (feature
//! `postgres`) is rh-persist, the real transactional store.

use crate::room::MatchId;
use rh_sim::RunResult;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

pub enum Auth {
    /// Local development: any well-formed callsign; the token is not checked.
    Dev,
    /// callsign (lower-cased) -> token.
    Static(HashMap<String, String>),
    #[cfg(feature = "postgres")]
    Postgres(std::sync::Arc<rh_persist::Store>),
}

impl Auth {
    pub async fn verify(&self, profile: &str, token: &str) -> bool {
        match self {
            Auth::Dev => true,
            Auth::Static(m) => m
                .get(&profile.to_ascii_lowercase())
                .is_some_and(|t| t == token),
            #[cfg(feature = "postgres")]
            Auth::Postgres(store) => store.verify_token(profile, token).await.unwrap_or(false),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Recorded {
    Applied,
    AlreadyApplied,
}

#[derive(Default)]
pub struct MemoryStore {
    pub fences: Mutex<HashMap<String, i64>>,
    pub results: Mutex<Vec<(MatchId, String, RunResult)>>,
    applied: Mutex<HashSet<(MatchId, String)>>,
}

pub enum Persistence {
    Memory(MemoryStore),
    #[cfg(feature = "postgres")]
    Postgres {
        store: std::sync::Arc<rh_persist::Store>,
        owner: String,
    },
}

impl Persistence {
    pub fn memory() -> Self {
        Persistence::Memory(MemoryStore::default())
    }

    /// Takes the profile's session lease for this match; returns its fence.
    pub async fn acquire(&self, profile: &str, m: MatchId) -> Result<i64, String> {
        match self {
            Persistence::Memory(s) => {
                let mut f = s.fences.lock().expect("fences");
                let e = f.entry(profile.to_ascii_lowercase()).or_insert(0);
                *e += 1;
                let _ = m;
                Ok(*e)
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, owner } => {
                let lease = store
                    .acquire_lease(
                        profile,
                        uuid::Uuid::from_bytes(m),
                        owner,
                        std::time::Duration::from_secs(3600),
                    )
                    .await
                    .map_err(|e| format!("lease refused: {e}"))?;
                Ok(lease.fence)
            }
        }
    }

    pub async fn record(
        &self,
        m: MatchId,
        profile: &str,
        fence: i64,
        r: &RunResult,
    ) -> Result<Recorded, String> {
        match self {
            Persistence::Memory(s) => {
                let key = (m, profile.to_ascii_lowercase());
                if !s.applied.lock().expect("applied").insert(key) {
                    return Ok(Recorded::AlreadyApplied);
                }
                let _ = fence;
                s.results
                    .lock()
                    .expect("results")
                    .push((m, profile.to_string(), r.clone()));
                Ok(Recorded::Applied)
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, .. } => {
                let res = crate::persist::pg::to_persist(r);
                match store
                    .record_result(uuid::Uuid::from_bytes(m), profile, fence, &res)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    rh_persist::RecordOutcome::Applied { .. } => Ok(Recorded::Applied),
                    rh_persist::RecordOutcome::AlreadyApplied => Ok(Recorded::AlreadyApplied),
                    other => Err(format!("{other:?}")),
                }
            }
        }
    }
}

#[cfg(feature = "postgres")]
pub mod pg {
    //! Mapping from the simulation's RunResult to rh-persist's MatchResult (the legacy RunResult shape).
    use rh_sim::sim::Outcome;

    /// Faction and weapon per-win counters need the player's faction and weapon at the end, which RunResult does not carry
    /// yet (docs/backlog P-PERSIST-2).
    pub fn to_persist(r: &rh_sim::RunResult) -> rh_persist::MatchResult {
        let g = &r.gv;
        rh_persist::MatchResult {
            outcome: Some(match r.outcome {
                Outcome::Won => rh_persist::Outcome::Won,
                Outcome::Draw => rh_persist::Outcome::Draw,
                Outcome::Died => rh_persist::Outcome::Died,
                Outcome::Mia => rh_persist::Outcome::Mia,
            }),
            kills: r.kills as i64,
            gv: rh_persist::GvBreakdown {
                kills: g.kills as i64,
                mobs: g.mobs as i64,
                bounty: g.bounty as i64,
                quest: g.quest as i64,
                win: g.win as i64,
                total: g.total as i64,
            },
            faction: None,
            weapon: None,
            win_qualified: r.outcome == Outcome::Won && !r.win_bonus_withheld,
        }
    }
}
