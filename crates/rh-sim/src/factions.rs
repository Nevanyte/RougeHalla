//! Trusted faction runtime. Private source-ordered chunks are independent of public projection.
use crate::{PlayerId, WeaponId};
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum SignatureKind {
    Disease,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DotBucket {
    pub victim: PlayerId,
    pub by: PlayerId,
    pub sig: SignatureKind,
    pub weapon: Option<WeaponId>,
    pub amount: f64,
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FactionRuntime {
    pub dot_since: f64,
    pub dot: Vec<DotBucket>,
}
/// Trusted pre-application ledger diagnostic. It is not an observation or command surface.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct DamageView {
    pub victim: PlayerId,
    pub by: Option<PlayerId>,
    pub raw: f64,
    pub scale: f64,
    pub weapon: Option<WeaponId>,
    pub sig: Option<SignatureKind>,
    pub execute: bool,
    pub phys: f64,
    pub magic: f64,
    pub true_: f64,
}
impl From<crate::systems::ledger::Entry> for DamageView {
    fn from(e: crate::systems::ledger::Entry) -> Self {
        Self {
            victim: e.victim,
            by: e.by,
            raw: e.packet.raw,
            scale: e.scale,
            weapon: e.weapon,
            sig: e.sig,
            execute: e.execute,
            phys: e.packet.phys,
            magic: e.packet.magic,
            true_: e.packet.true_,
        }
    }
}
impl crate::Sim {
    pub fn faction_runtime(&self) -> &FactionRuntime {
        &self.w.factions
    }
    pub fn damage_entries(&self) -> &[DamageView] {
        &self.s.ledger_diagnostics
    }
}
