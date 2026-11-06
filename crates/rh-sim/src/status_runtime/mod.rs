//! Ordered timed status state and leaf rules, translated from shared/status.ts and sim/status.ts.
//! Gameplay producers and scheduling live in systems/status; none of these helpers submit player input.
pub(crate) mod checkpoint;
mod fields;
mod mutation;
pub(crate) mod observe;
pub use observe::FieldView;
mod readers;
mod rules;
pub(crate) mod stats;
pub use fields::*;
pub use mutation::*;
pub use readers::*;
pub use rules::*;
pub use stats::{
    crit_chance, roll_dot_crit, DotCritState, StatView, CRIT_CHANCE_MAX, CRIT_EPSILON, CRIT_MULT,
    HOLY_LEECH_ROW_MULT, LIFESTEAL_MAX,
};

use crate::{content::DamageShares, PlayerId};
use std::sync::Arc;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum AbilityId {
    Freeze,
    Swarm,
    Trial,
    Blaze,
    LastStand,
}
impl AbilityId {
    pub const ALL: [Self; 5] = [
        Self::Freeze,
        Self::Swarm,
        Self::Trial,
        Self::Blaze,
        Self::LastStand,
    ];
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Freeze => "freeze",
            Self::Swarm => "swarm",
            Self::Trial => "trial",
            Self::Blaze => "blaze",
            Self::LastStand => "lastStand",
        }
    }
}

/// Source text key with an allocation-free handle for the existing axe producer.
/// Serialization and equality are the original string, never the storage variant.
#[derive(Clone, Debug)]
pub enum StatusTag {
    Axe,
    Block,
    Text(Arc<str>),
}
impl StatusTag {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Axe => "axe",
            Self::Block => "block",
            Self::Text(v) => v,
        }
    }
}
impl From<&str> for StatusTag {
    fn from(v: &str) -> Self {
        if v == "block" {
            return Self::Block;
        }
        if v == "axe" {
            Self::Axe
        } else {
            Self::Text(Arc::from(v))
        }
    }
}
impl PartialEq for StatusTag {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}
impl Eq for StatusTag {}
impl serde::Serialize for StatusTag {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}
impl<'de> serde::Deserialize<'de> for StatusTag {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = <Arc<str> as serde::Deserialize>::deserialize(d)?;
        Ok(if &*v == "axe" {
            Self::Axe
        } else if &*v == "block" {
            Self::Block
        } else {
            Self::Text(v)
        })
    }
}

/// Source metadata is a snapshot, including when its fighter subsequently leaves.
/// None denotes the source's empty ID; it does not imply the ledger's arena exemption.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusSource {
    pub id: Option<PlayerId>,
    pub name: Arc<str>,
    pub owner_id: Option<PlayerId>,
}

/// Sparse application payload. Absent fields retain the instance's previous data.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    /// Explicitly supplied JavaScript undefined keys, distinct from omitted keys.
    pub undefined_fields: u16,
    pub reveal_until: Option<f64>,
    pub field_id: Option<u32>,
    pub dealt_mult: Option<f64>,
    pub taken_from_source_mult: Option<f64>,
    pub move_mult: Option<f64>,
    pub floor_hp: Option<f64>,
    pub heal_share: Option<f64>,
    pub shares: Option<DamageShares>,
}
impl Payload {
    fn merge(&mut self, incoming: Self) {
        macro_rules! assign { ($($f:ident:$bit:expr),*) => { $(
            if incoming.$f.is_some() {self.$f=incoming.$f;self.undefined_fields&=!$bit;}
            else if incoming.undefined_fields&$bit!=0 {self.$f=None;self.undefined_fields|=$bit;}
        )* }; }
        assign!(reveal_until:1,field_id:2,dealt_mult:4,taken_from_source_mult:8,move_mult:16,floor_hp:32,heal_share:64,shares:128);
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusInstance {
    pub kind: StatusKind,
    pub source: StatusSource,
    pub ability: Option<AbilityId>,
    pub tag: Option<StatusTag>,
    pub started_at: f64,
    pub until: f64,
    pub value: f64,
    pub reveal_from: Option<f64>,
    pub taken: Option<f64>,
    pub data: Payload,
}
impl StatusInstance {
    pub fn key(&self) -> &str {
        key(self.ability, self.tag.as_ref().map(StatusTag::as_str))
    }
}
fn key(ability: Option<AbilityId>, tag: Option<&str>) -> &str {
    ability.map(AbilityId::as_str).or(tag).unwrap_or("")
}

/// The status runtime sees cast timing and cancellation predicates, never a wand action.
/// The ability producer owns the rest of the cast and supplies this fact.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CastFact {
    pub ability: AbilityId,
    pub started_at: f64,
    pub lands_at: f64,
    pub cancelled_by: CancelCauses,
    /// None is an isolated trusted status fact, never a Wish producer.
    pub producer: Option<crate::abilities::CastDetail>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CancelCauses {
    pub stun: bool,
    pub silence: bool,
    pub root: bool,
    pub stagger: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusRuntime {
    /// Source distinguishes an absent table from one that was initialized then emptied.
    pub initialized: bool,
    pub instances: Vec<StatusInstance>,
    pub cast: Option<CastFact>,
    pub effects: u16,
}
impl Default for StatusRuntime {
    fn default() -> Self {
        Self {
            initialized: false,
            instances: Vec::with_capacity(crate::constants::MAX_PLAYERS),
            cast: None,
            effects: 0,
        }
    }
}
impl StatusRuntime {
    pub fn refresh_effects(&mut self, now: f64) {
        self.effects = effects_of(&self.instances, self.cast, now);
    }
}

/// Structural admission for trusted checkpoint state. Stale instances and finite negative magnitudes are legitimate.
pub fn validate(rt: &StatusRuntime, now: f64) -> Result<(), &'static str> {
    if !rt.initialized && !rt.instances.is_empty() {
        return Err("uninitialized nonempty table");
    }
    for (i, st) in rt.instances.iter().enumerate() {
        let p = st.data;
        let present = (p.reveal_until.is_some() as u16)
            | ((p.field_id.is_some() as u16) << 1)
            | ((p.dealt_mult.is_some() as u16) << 2)
            | ((p.taken_from_source_mult.is_some() as u16) << 3)
            | ((p.move_mult.is_some() as u16) << 4)
            | ((p.floor_hp.is_some() as u16) << 5)
            | ((p.heal_share.is_some() as u16) << 6)
            | ((p.shares.is_some() as u16) << 7);
        if p.undefined_fields & !255 != 0 || p.undefined_fields & present != 0 {
            return Err("contradictory payload presence");
        }
        if rt.instances[..i]
            .iter()
            .any(|p| p.kind == st.kind && p.source.id == st.source.id && p.key() == st.key())
        {
            return Err("duplicate key");
        }
        if st.source.id.is_some_and(|id| id.0 == 0)
            || st.source.owner_id.is_some_and(|id| id.0 == 0)
            || st.data.field_id == Some(0)
        {
            return Err("zero identity");
        }
        if !st.value.is_finite()
            || !(0. ..=now).contains(&st.started_at)
            || !st.until.is_finite()
            || st.until < st.started_at
            || st.until > now + st.kind.rule().max_ms
        {
            return Err("invalid clock or magnitude");
        }
        for v in [
            st.reveal_from,
            st.taken,
            st.data.reveal_until,
            st.data.dealt_mult,
            st.data.taken_from_source_mult,
            st.data.move_mult,
            st.data.floor_hp,
            st.data.heal_share,
        ]
        .into_iter()
        .flatten()
        {
            if !v.is_finite() {
                return Err("nonfinite payload");
            }
        }
        if let Some(s) = st.data.shares {
            if ![s.phys, s.magic, s.true_].iter().all(|v| v.is_finite()) {
                return Err("nonfinite shares");
            }
        }
    }
    if let Some(c) = rt.cast {
        if !(0. ..=now).contains(&c.started_at) || !c.lands_at.is_finite() || c.lands_at < 0. {
            return Err("invalid cast clock");
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CastEndReason {
    Fizzle,
    Interrupted,
    Cancelled,
}

#[cfg(feature = "trusted-status-probes")]
pub mod probe;
