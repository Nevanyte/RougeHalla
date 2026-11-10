//! The complete declared private source `Percept` a Brain tick accepts (packages/server/src/bots/brain/types.ts).
//!
//! This is a declared source-method input, never an earned World observation: the checked Brain intake validates every
//! consumed leaf before any component exists, and the component projections in [`super::adapters`] narrow this same
//! object for Memory/Strategy/Tactics/Modules/Humanizer (they never rebuild facts from a narrower percept).
//!
//! The complete record is kept losslessly as a [`BVal`] (own-key order preserved) so component callback arguments and
//! the frozen component trace reproduce the exact declared object; the small typed header holds only the leaves the
//! Brain coordinator itself reads (`now`, the owner's position/status/faction/weapons/draw clock/attack target, the HUD
//! gates phase and the toast presence) so the coordinator never re-parses the record.

use super::trace::BVal;
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2, WeaponId};

/// Source `Percept` (types.ts): the complete private tick input.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Percept {
    /// Source `percept.now` (server ms): the only clock a policy sees.
    pub(crate) now: f64,
    /// Source `percept.viewT`: the view's own delayed clock (retained for callback arguments).
    pub(crate) view_time: f64,
    /// `percept.self.x/y` (the owner's drawn position).
    pub(crate) me_x: f64,
    pub(crate) me_y: f64,
    /// `percept.self.status` (alive/dead/mia/lobby in the complete four-status domain).
    pub(crate) me_status: String,
    /// `percept.self.faction` (`null` before the pick).
    pub(crate) me_faction: Option<FactionId>,
    /// `percept.self.weapons` (two slots, `null` empty).
    pub(crate) me_weapons: [Option<WeaponId>; 2],
    /// `percept.self.drawStartedAt` (0 when not drawing).
    pub(crate) me_draw_started_at: f64,
    /// `percept.self.attackTarget` (`null` when no held lock).
    pub(crate) me_attack_target: Option<String>,
    /// `percept.hud.phase` (active/planning/ended/lobby in the declared source domain).
    pub(crate) hud_phase: String,
    pub(crate) hud_gates_locked: bool,
    pub(crate) hud_sudden_death_at: f64,
    /// `percept.events.some(e => e.kind === "toast")`.
    pub(crate) has_toast: bool,
    /// `percept.features` (the per-tick declared feature verdicts; the source module guard filters `cfg.features`).
    pub(crate) features: Features,
    /// The complete declared source record, own-key order preserved (callback arguments and trace context).
    pub(crate) raw: BVal,
}

impl Percept {
    pub(crate) fn me_pos(&self) -> Vec2 {
        Vec2::new(self.me_x, self.me_y)
    }

    /// Source `p.self.status === "alive"`: the four-status domain is alive/dead/mia/lobby; only `alive` is alive.
    pub(crate) fn alive(&self) -> bool {
        self.me_status == "alive"
    }

    /// Source `p.hud.phase !== "active"` (the nonactive branch, which still releases the real hand).
    pub(crate) fn active(&self) -> bool {
        self.hud_phase == "active"
    }

    /// Source `p.hud.phase === "planning"` (planning-only module Idle intents).
    pub(crate) fn planning(&self) -> bool {
        self.hud_phase == "planning"
    }

    /// Source `p.hud.suddenDeathAt > 0 && p.now >= p.hud.suddenDeathAt`.
    pub(crate) fn sudden_death(&self) -> bool {
        self.hud_sudden_death_at > 0. && self.now >= self.hud_sudden_death_at
    }
}

impl Default for Percept {
    fn default() -> Self {
        Self {
            now: 0.,
            view_time: 0.,
            me_x: 0.,
            me_y: 0.,
            me_status: "dead".to_string(),
            me_faction: None,
            me_weapons: [None, None],
            me_draw_started_at: 0.,
            me_attack_target: None,
            hud_phase: "ended".to_string(),
            hud_gates_locked: false,
            hud_sudden_death_at: 0.,
            has_toast: false,
            features: Features::default(),
            raw: BVal::Null,
        }
    }
}
