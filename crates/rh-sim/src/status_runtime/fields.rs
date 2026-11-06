//! Immutable field geometry and the exact rank-one reads used by status lifecycle.
use super::{AbilityId, StatusSource};
use crate::{PlayerId, Vec2};
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    Zone,
    Cloud,
    Trail,
}

/// Numerical admission, not a gameplay radius limit. Fourfold headroom keeps the
/// difference, squared length and two-term dot product of any admitted points finite.
pub fn geometry_scalar_is_safe(value: f64) -> bool {
    let headroom = value * 4.;
    value.is_finite() && (headroom * headroom).is_finite()
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub id: u32,
    pub kind: FieldKind,
    pub ability: AbilityId,
    pub owner: StatusSource,
    pub subject: Option<PlayerId>,
    pub x: f64,
    pub y: f64,
    pub x2: f64,
    pub y2: f64,
    pub r: f64,
    pub vx: f64,
    pub vy: f64,
    pub started_at: f64,
    pub ends_at: f64,
    pub exit_stun_ms: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbilityRuntime {
    pub fields: Vec<Field>,
    pub teleported_at: Option<f64>,
    pub dot: Vec<AbilityDotBucket>,
    pub dot_since: f64,
}
impl AbilityRuntime {
    pub fn new(now: f64) -> Self {
        Self {
            fields: Vec::with_capacity(crate::constants::MAX_PLAYERS),
            teleported_at: None,
            dot: Vec::with_capacity(crate::constants::MAX_PLAYERS * crate::constants::MAX_PLAYERS),
            dot_since: now,
        }
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbilityDotBucket {
    pub victim: PlayerId,
    pub by: Option<PlayerId>,
    pub ability: AbilityId,
    pub amount: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FieldSelector {
    All,
    Id(u32),
    Expired(f64),
    Cloud {
        owner: PlayerId,
        ability: Option<AbilityId>,
    },
    Departed(PlayerId),
}
impl FieldSelector {
    pub fn matches(self, f: &Field) -> bool {
        match self {
            Self::All => true,
            Self::Id(id) => f.id == id,
            Self::Expired(now) => f.ends_at <= now,
            Self::Cloud { owner, ability } => {
                f.kind == FieldKind::Cloud
                    && f.owner.id == Some(owner)
                    && Some(f.ability) == ability
            }
            Self::Departed(id) => {
                (f.owner.id == Some(id) && f.kind != FieldKind::Trail) || f.subject == Some(id)
            }
        }
    }
}
pub fn on_trail(f: &Field, p: Vec2) -> bool {
    let abx = f.x2 - f.x;
    let aby = f.y2 - f.y;
    let len2 = abx * abx + aby * aby;
    let t = if len2 > 0. {
        ((p.x - f.x) * abx + (p.y - f.y) * aby) / len2
    } else {
        0.
    };
    let t = t.clamp(0., 1.);
    let ex = p.x - (f.x + abx * t);
    let ey = p.y - (f.y + aby * t);
    crate::math::sqrt(ex * ex + ey * ey) <= f.r
}
/// A shared typed rank-one policy boundary for P-ABIL; this is not a duplicated Wish catalog.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RankOneFieldPolicy {
    pub exit_stun_ms: Option<f64>,
    pub burn: Option<(f64, f64)>,
}
pub const TRIAL_FIELD_POLICY: RankOneFieldPolicy = RankOneFieldPolicy {
    exit_stun_ms: Some(1500.),
    burn: None,
};
pub const BLAZE_FIELD_POLICY: RankOneFieldPolicy = RankOneFieldPolicy {
    exit_stun_ms: None,
    burn: Some((30., 2000.)),
};
pub fn rank_one_field_policy(id: AbilityId) -> RankOneFieldPolicy {
    match id {
        AbilityId::Trial => TRIAL_FIELD_POLICY,
        AbilityId::Blaze => BLAZE_FIELD_POLICY,
        _ => RankOneFieldPolicy {
            exit_stun_ms: None,
            burn: None,
        },
    }
}
