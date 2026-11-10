//! Derived, pure quest objective interpretation. The serialized Offer/Quests state remains in live.rs; this module
//! lowers a catalog definition on demand and evaluates explicit stored counts/masks plus typed credited facts. No World,
//! secrets, notices, rewards, IDs or new persistent state enter this module.
use super::catalog::{Def, Kind};
use crate::content::FactionId;
use crate::state::PlayerId;

#[derive(Clone, Copy, Debug)]
enum ObjectiveKind {
    Kill,
    Collect,
    Fetch,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Objective {
    kind: ObjectiveKind,
    count: u32,
    players: bool,
    region: Option<FactionId>,
    elite: bool,
    tour: u32,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Credited {
    Mob { zone: FactionId, elite: bool },
    Player,
    Collect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Advance {
    None,
    Count(u32),
    Tour { visits: u8, progress: u32 },
}

impl Objective {
    pub(crate) fn lower(def: &Def) -> Self {
        Self {
            kind: match def.kind {
                Kind::Kill => ObjectiveKind::Kill,
                Kind::Collect => ObjectiveKind::Collect,
                Kind::Fetch => ObjectiveKind::Fetch,
            },
            count: def.count,
            players: def.players,
            region: def.region,
            elite: def.elite,
            tour: def.tour,
        }
    }

    /// Source precedence: player-kill offers only count killed players, mob offers apply elite filtering before tour
    /// progress/region matching. A cap is a no-op, never a write of zero or a new row.
    pub(crate) fn advance(&self, credited: Credited, current: u32, mask: u8) -> Advance {
        match (self.kind, credited) {
            (ObjectiveKind::Kill, Credited::Player) if self.players => {
                count_step(current, self.count)
            }
            (ObjectiveKind::Kill, Credited::Mob { zone, elite }) if !self.players => {
                if self.elite && !elite {
                    return Advance::None;
                }
                if self.tour > 0 {
                    let visits = mask | (1u8 << zone.code());
                    let progress = self.count.min(visits.count_ones());
                    return Advance::Tour { visits, progress };
                }
                if self
                    .region
                    .is_none_or(|region| region.code() == zone.code())
                {
                    count_step(current, self.count)
                } else {
                    Advance::None
                }
            }
            (ObjectiveKind::Collect, Credited::Collect) => count_step(current, self.count),
            _ => Advance::None,
        }
    }

    pub(crate) fn ready(&self, progress: u32, carrier: Option<PlayerId>, id: PlayerId) -> bool {
        match self.kind {
            ObjectiveKind::Fetch => carrier == Some(id),
            ObjectiveKind::Kill | ObjectiveKind::Collect => progress >= self.count,
        }
    }

    /// One standing human's remaining kill supply, using the repaired actual visit mask. The caller owns the
    /// any-standing-human aggregation, publication/status/accepted gates and no-human no-expiry behavior.
    pub(crate) fn supply_possible(
        &self,
        have: u32,
        mask: u8,
        zones: &[u32; 5],
        elites: u32,
    ) -> bool {
        let need = self.count.saturating_sub(have);
        if self.tour > 0 {
            let fresh = zones
                .iter()
                .enumerate()
                .filter(|(i, n)| **n > 0 && (mask & (1 << i)) == 0)
                .count() as u32;
            fresh >= need
        } else if self.elite {
            elites >= need
        } else if let Some(region) = self.region {
            zones[usize::from(region.code())] >= need
        } else {
            zones.iter().sum::<u32>() >= need
        }
    }
}

fn count_step(current: u32, count: u32) -> Advance {
    if current >= count {
        Advance::None
    } else {
        Advance::Count(current.saturating_add(1).min(count))
    }
}
