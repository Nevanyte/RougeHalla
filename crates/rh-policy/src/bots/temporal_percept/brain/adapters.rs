//! Private Brain component adapters and projections (P-BOT-BRAIN-NATIVE-1).
//!
//! This file is the typed seam between the complete declared private source `Percept` (retained losslessly as the
//! source-shaped [`Percept::raw`] record, see [`super::percept`]) and the admitted Memory/Strategy/Tactics/Modules/Hand
//! components. Three rules shape everything here:
//!
//! - One tick frame is projected once per projection. Every component projection reads the complete declared source
//!   record (`p.raw`), never the narrower `StrategyPercept` or another component's typed view: absence, `undefined`,
//!   `null`, ordered objects/arrays, the container-weapon tri-state, `windupMult` presence and the four-status domain
//!   survive exactly. A malformed required leaf is a typed [`BrainError`], never a default.
//! - The trait adapters borrow the actual admitted state (the one `Memory`, the one `Knowledge`, the caller's one path
//!   service handle plus the caller-owned room allowance) and the source runtime streams. They never copy or reseed a
//!   provider, never read `World`/`Sim`, and never create a second engine.
//! - When a [`Recorder`] is active every declared source service callback is recorded with the exact source argument
//!   objects and result, in the source's own-key order. Path-service rows are emitted whenever a recorder is present (the
//!   source caller wraps its path service at construction, independent of the observer's later activation); Knowledge
//!   rows only from the observer's first `observe` on (the source observer installs those wrappers); `learned.bias` rows
//!   always (the source cfg owns that wrapper from construction).
//!
//! Recording is test instrumentation only: production constructs every adapter with `recorder: None` and runs the same
//! call sites with no trace work. All items are `pub(crate)`; nothing here is public policy/bot surface.

use super::super::data::MethodValue;
use super::super::memory::{
    source_input::{
        MemoryPercept, PerceptCampView, PerceptChest, PerceptContainer, PerceptEvent,
        PerceptEventRow, PerceptExtras, PerceptFighter, PerceptMinimap, PerceptMinimapMob,
        PerceptMob, PerceptPlan, PerceptProjectile, PerceptSelf, PerceptWeapon,
    },
    ContainerMemory, ContainersWeapon, FighterMemory, Memory, MobMemory, SelfMemory, Whereabouts,
};
use super::super::modules::types::{
    js_to_int32, AbilityDef, AbilityRank, CardCounts, ModuleConfig, ModuleContext, ModuleEvent,
    ModuleFighter, ModuleHud, ModuleMob, ModulePaths, ModulePercept, ModuleSelf, RngLanes,
    SourceChest, WishTargeting, WishView,
};
use super::super::strategy::types as strat;
use super::super::tactics::types as tact;
use super::config::{BrainError, BrainPathService};
use super::percept::Percept;
use super::trace::{
    begin_callback, encode_declared_record, encode_vec2, finish_callback, record_callback,
    to_method_value, BVal, Recorder,
};
use crate::bots::humanizer;
use crate::bots::paths::{PathBudget, WalkAnswer};
use crate::bots::types as hand;
use crate::bots::view::Features;
use rh_sim::map::TILE_WALL;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

// ---------------------------------------------------------------------------------------------------------------------
// Declared-record parsing helpers.
//
// The declared source record is a JSON-typed method value graph: objects keep their own-key order, `undefined` is an
// explicitly present value distinct from `null`, and every declared number is finite (the frozen runner asserts that
// before a case runs). These helpers accept exactly that domain and return a typed error at the first malformed or
// absent leaf; they never substitute an empty/default value for a consumed declared fact.

type R<T> = Result<T, BrainError>;

fn shape<T>(key: &'static str) -> R<T> {
    Err(BrainError::Shape(key))
}

fn missing<T>(key: &'static str) -> R<T> {
    Err(BrainError::Missing(key))
}

fn field<'a>(value: &'a BVal, key: &'static str) -> R<&'a BVal> {
    value.get(key).ok_or(BrainError::Missing(key))
}

fn object<'a>(value: &'a BVal, key: &'static str) -> R<&'a BVal> {
    if value.as_obj().is_some() {
        Ok(value)
    } else {
        shape(key)
    }
}

fn number(value: &BVal, key: &'static str) -> R<f64> {
    match value.get(key) {
        Some(BVal::Num(v)) => {
            if v.is_finite() {
                Ok(*v)
            } else {
                Err(BrainError::Nonfinite(key))
            }
        }
        Some(_) => shape(key),
        None => missing(key),
    }
}

fn number_value(value: &BVal, key: &'static str) -> R<f64> {
    match value {
        BVal::Num(v) => {
            if v.is_finite() {
                Ok(*v)
            } else {
                Err(BrainError::Nonfinite(key))
            }
        }
        _ => shape(key),
    }
}

/// A declared count/enum number narrowed to an unsigned integer (the source values are integer counts).
fn uint_value(value: &BVal, key: &'static str, max: u64) -> R<u64> {
    let n = number_value(value, key)?;
    if n.fract() != 0. || n < 0. || n > max as f64 {
        return shape(key);
    }
    Ok(n as u64)
}

fn uint_field(value: &BVal, key: &'static str, max: u64) -> R<u64> {
    match field(value, key) {
        Ok(member) => uint_value(member, key, max),
        Err(error) => Err(error),
    }
}

fn boolean(value: &BVal, key: &'static str) -> R<bool> {
    match value.get(key) {
        Some(BVal::Bool(v)) => Ok(*v),
        Some(_) => shape(key),
        None => missing(key),
    }
}

fn boolean_value(value: &BVal, key: &'static str) -> R<bool> {
    match value {
        BVal::Bool(v) => Ok(*v),
        _ => shape(key),
    }
}

fn text(value: &BVal, key: &'static str) -> R<String> {
    match value.get(key) {
        Some(BVal::Str(v)) => Ok(v.clone()),
        Some(_) => shape(key),
        None => missing(key),
    }
}

fn text_value(value: &BVal, key: &'static str) -> R<String> {
    match value {
        BVal::Str(v) => Ok(v.clone()),
        _ => shape(key),
    }
}

fn optional_text(value: &BVal, key: &'static str) -> R<Option<String>> {
    match value.get(key) {
        Some(BVal::Null) => Ok(None),
        Some(BVal::Str(v)) => Ok(Some(v.clone())),
        Some(_) => shape(key),
        None => missing(key),
    }
}

/// `type?: string`: an absent member and an own `undefined` both read as absent, exactly like the source optional.
fn optional_text_presence(value: &BVal, key: &'static str) -> R<Option<String>> {
    match value.get(key) {
        None | Some(BVal::Undefined) | Some(BVal::Null) => Ok(None),
        Some(BVal::Str(v)) => Ok(Some(v.clone())),
        Some(_) => shape(key),
    }
}

// The source's own `undefined` in a typed component field (P-BOT-BRAIN-LIVE-2a).
//
// The accepted-frame composer (`compose14.rs`, degraded fair profile) leaves some declared leaves `undefined`: a fact the
// seat cannot see. The component input types (Memory/Strategy/Tactics/Modules/Hand, outside this seam) cannot hold
// `undefined` in a `f64`, `String`, `bool` or `Option<String>`, so each reader below that takes such a leaf stores the
// value that takes the source's own `undefined` branch in the Rust readers of that field:
// - a number is NaN: JS `+undefined` is NaN, every relational comparison with it is false and arithmetic stays NaN;
// - a text is `""` (no key, name or winner is ever empty): falsy like `undefined`, and `=== x` is false for every real x;
// - a `T | null` text is `Some("")`: `!== null` holds as it does for `undefined`, and it equals no key;
// - a boolean is `false` (falsy, like `undefined`).
// Two places tell them apart, neither observable today: `undefined === undefined` but NaN != NaN (Memory's `minimap.t`
// change test re-runs its dot pass every tick, a no-op while `minimap.mobs` is always empty), and Memory's fighter-name
// fill (`m.name === ""`) refills a `""` name but not an `undefined` one (no decision reads a remembered fighter name).
// Only the leaves the composer documents as `undefined` are widened; every other leaf keeps its strict reader, and the
// declared record (`Percept::raw`) is never rewritten.

/// The typed stand-in for a source `undefined` text (see above).
const UNDEFINED_TEXT: &str = "";

fn number_or_undefined(value: &BVal, key: &'static str) -> R<f64> {
    match value.get(key) {
        Some(BVal::Undefined) => Ok(f64::NAN),
        _ => number(value, key),
    }
}

fn text_or_undefined(value: &BVal, key: &'static str) -> R<String> {
    match value.get(key) {
        Some(BVal::Undefined) => Ok(UNDEFINED_TEXT.to_owned()),
        _ => text(value, key),
    }
}

fn boolean_or_undefined(value: &BVal, key: &'static str) -> R<bool> {
    match value.get(key) {
        Some(BVal::Undefined) => Ok(false),
        _ => boolean(value, key),
    }
}

/// `string | null` that may be the source's own `undefined` (`self.attackTarget` of a held lock whose target is not on
/// the wire, a victory's unnamed winner): held, but no key.
fn optional_text_or_undefined(value: &BVal, key: &'static str) -> R<Option<String>> {
    match value.get(key) {
        Some(BVal::Undefined) => Ok(Some(UNDEFINED_TEXT.to_owned())),
        _ => optional_text(value, key),
    }
}

fn array<'a>(value: &'a BVal, key: &'static str) -> R<&'a [BVal]> {
    match value.get(key) {
        Some(BVal::Arr(rows)) => Ok(rows),
        Some(_) => shape(key),
        None => missing(key),
    }
}

fn at_point(value: &BVal, key: &'static str) -> R<Vec2> {
    object(value, key)?;
    Ok(Vec2::new(number(value, "x")?, number(value, "y")?))
}

fn faction_value(value: &BVal, key: &'static str) -> R<FactionId> {
    let name = text_value(value, key)?;
    FactionId::parse(&name).ok_or(BrainError::Shape(key))
}

fn faction_field(value: &BVal, key: &'static str) -> R<FactionId> {
    match field(value, key) {
        Ok(member) => faction_value(member, key),
        Err(error) => Err(error),
    }
}

fn optional_faction(value: &BVal, key: &'static str) -> R<Option<FactionId>> {
    match value.get(key) {
        Some(BVal::Null) | Some(BVal::Undefined) => Ok(None),
        Some(BVal::Str(_)) => faction_field(value, key).map(Some),
        Some(_) => shape(key),
        None => missing(key),
    }
}

fn weapon_value(value: &BVal, key: &'static str) -> R<WeaponId> {
    let name = text_value(value, key)?;
    WeaponId::parse(&name).ok_or(BrainError::Shape(key))
}

fn weapon_field(value: &BVal, key: &'static str) -> R<Option<WeaponId>> {
    match field(value, key)? {
        BVal::Null | BVal::Undefined => Ok(None),
        BVal::Str(_) => weapon_field_required(value, key).map(Some),
        _ => shape(key),
    }
}

fn weapon_field_required(value: &BVal, key: &'static str) -> R<WeaponId> {
    weapon_value(field(value, key)?, key)
}

fn weapon_pair(value: &BVal, key: &'static str) -> R<[Option<WeaponId>; 2]> {
    let rows = array(value, key)?;
    if rows.len() != 2 {
        return shape(key);
    }
    Ok([
        optional_weapon_value(&rows[0], key)?,
        optional_weapon_value(&rows[1], key)?,
    ])
}

fn optional_weapon_value(value: &BVal, key: &'static str) -> R<Option<WeaponId>> {
    match value {
        BVal::Null | BVal::Undefined => Ok(None),
        BVal::Str(name) => WeaponId::parse(name)
            .map(Some)
            .ok_or(BrainError::Shape(key)),
        _ => shape(key),
    }
}

/// Source `ContainerView.weapon: WeaponId | null | undefined` tri-state.
fn container_weapon(value: &BVal, key: &'static str) -> R<ContainersWeapon> {
    match field(value, key)? {
        BVal::Undefined => Ok(ContainersWeapon::Undefined),
        BVal::Null => Ok(ContainersWeapon::Null),
        member => weapon_value(member, key).map(ContainersWeapon::Weapon),
    }
}

/// The admitted Memory reader's own tri-state for the same declared leaf.
fn memory_weapon(value: &BVal, key: &'static str) -> R<PerceptWeapon> {
    match field(value, key)? {
        BVal::Undefined => Ok(PerceptWeapon::Undefined),
        BVal::Null => Ok(PerceptWeapon::Null),
        member => weapon_value(member, key).map(PerceptWeapon::Weapon),
    }
}

fn features(value: &BVal) -> R<Features> {
    object(value, "features")?;
    let message_types = array(value, "messageTypes")?
        .iter()
        .map(|kind| text_value(kind, "features.messageTypes"))
        .collect::<R<Vec<_>>>()?;
    Ok(Features {
        message_types,
        wishes: boolean(value, "wishes")?,
        status_effects: boolean(value, "statusEffects")?,
        fields: boolean(value, "fields")?,
        planning: boolean(value, "planning")?,
        chests: boolean(value, "chests")?,
        skills: boolean(value, "skills")?,
        relics: boolean(value, "relics")?,
        camps: boolean(value, "camps")?,
        hazards: boolean(value, "hazards")?,
    })
}

/// The declared source self object (`percept.self`) retained verbatim for callback arguments.
fn source_self(p: &Percept) -> R<&BVal> {
    let raw = object(&p.raw, "percept")?;
    let self_record = field(raw, "self")?;
    object(self_record, "self")
}

// ---------------------------------------------------------------------------------------------------------------------
// Projections: complete declared source Percept -> each admitted component's typed input.

/// Project the complete declared source percept into the admitted Memory's declared fold input.
pub(crate) fn memory_percept(p: &Percept) -> Result<MemoryPercept, BrainError> {
    let raw = object(&p.raw, "percept")?;
    let self_raw = object(field(raw, "self")?, "self")?;
    let hud = object(field(raw, "hud")?, "hud")?;
    let minimap = object(field(raw, "minimap")?, "minimap")?;
    let mut fighters = Vec::new();
    for row in array(raw, "fighters")? {
        object(row, "fighters")?;
        fighters.push(PerceptFighter {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            bot: boolean_or_undefined(row, "bot")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            facing: number(row, "facing")?,
            status: text(row, "status")?,
            hp_frac: number(row, "hpFrac")?,
            faction: optional_faction(row, "faction")?,
            in_hand: weapon_field(row, "inHand")?,
            draw_started_at: number_or_undefined(row, "drawStartedAt")?,
            bounty: number(row, "bounty")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
        });
    }
    let mut mobs = Vec::new();
    for row in array(raw, "mobs")? {
        object(row, "mobs")?;
        mobs.push(PerceptMob {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            name: text_or_undefined(row, "name")?,
            type_: optional_text_presence(row, "type")?,
            faction: optional_faction(row, "faction")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            status: text(row, "status")?,
            hp_frac: number(row, "hpFrac")?,
            in_hand: weapon_field(row, "inHand")?,
        });
    }
    let mut containers = Vec::new();
    for row in array(raw, "containers")? {
        object(row, "containers")?;
        containers.push(PerceptContainer {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            closed: boolean(row, "closed")?,
            weapon: memory_weapon(row, "weapon")?,
        });
    }
    let mut projectiles = Vec::new();
    for row in array(raw, "projectiles")? {
        object(row, "projectiles")?;
        projectiles.push(PerceptProjectile {
            id: text_or_undefined(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            vx: number_or_undefined(row, "vx")?,
            vy: number_or_undefined(row, "vy")?,
            x0: number_or_undefined(row, "x0")?,
            y0: number_or_undefined(row, "y0")?,
            t0: number_or_undefined(row, "t0")?,
            range: number_or_undefined(row, "range")?,
            from: optional_text(row, "from")?,
        });
    }
    let mut minimap_mobs = Vec::new();
    for row in array(minimap, "mobs")? {
        object(row, "minimap.mobs")?;
        minimap_mobs.push(PerceptMinimapMob {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            faction: optional_faction(row, "faction")?,
            elite: boolean(row, "elite")?,
        });
    }
    let mut events = Vec::new();
    for row in array(raw, "events")? {
        events.push(memory_event(row)?);
    }
    let extras = projection_extras(field(raw, "extras")?)?;
    Ok(MemoryPercept {
        now: number(raw, "now")?,
        view_t: number(raw, "viewT")?,
        self_: PerceptSelf {
            id: text(self_raw, "id")?,
            name: text_or_undefined(self_raw, "name")?,
            x: number(self_raw, "x")?,
            y: number(self_raw, "y")?,
            facing: number(self_raw, "facing")?,
            status: text(self_raw, "status")?,
            hp: number(self_raw, "hp")?,
            max_hp: number(self_raw, "maxHp")?,
            attack_target: optional_text_or_undefined(self_raw, "attackTarget")?,
            move_seq: number(self_raw, "moveSeq")?,
        },
        hud_in_coliseum: boolean(hud, "inColiseum")?,
        fighters,
        mobs,
        containers,
        projectiles,
        minimap: PerceptMinimap {
            t: number_or_undefined(minimap, "t")?,
            mobs: minimap_mobs,
        },
        events,
        extras,
        features: features(field(raw, "features")?)?,
    })
}

fn memory_event(row: &BVal) -> R<PerceptEventRow> {
    object(row, "events")?;
    let t = number(row, "t")?;
    let at = match field(row, "at")? {
        BVal::Null => None,
        at => Some(at_point(at, "events.at")?),
    };
    let kind = match text(row, "kind")?.as_str() {
        "windup" => PerceptEvent::Windup {
            by: text(row, "by")?,
            weapon: weapon_field_required(row, "weapon")?,
            a: number(row, "a")?,
            ms: number(row, "ms")?,
        },
        "swing" => PerceptEvent::Swing {
            by: text(row, "by")?,
            weapon: weapon_field_required(row, "weapon")?,
            a: number(row, "a")?,
        },
        "hit" => PerceptEvent::Hit {
            id: text(row, "id")?,
            by: optional_text(row, "by")?,
            amount: number(row, "amount")?,
            weapon: weapon_field(row, "weapon")?,
        },
        "block" => PerceptEvent::Block {
            id: text(row, "id")?,
            by: optional_text(row, "by")?,
            weapon: weapon_field(row, "weapon")?,
        },
        "stagger" => PerceptEvent::Stagger {
            id: text(row, "id")?,
        },
        "cancel" => PerceptEvent::Cancel {
            id: text(row, "id")?,
        },
        "projEnd" => PerceptEvent::ProjEnd {
            id: text(row, "id")?,
        },
        "death" => PerceptEvent::Death {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            by: optional_text(row, "by")?,
            mob: boolean(row, "mob")?,
        },
        "heal" => PerceptEvent::Heal {
            id: text(row, "id")?,
        },
        "teleport" => PerceptEvent::Teleport,
        "bounty" => PerceptEvent::Bounty {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            bounty: number(row, "bounty")?,
        },
        "victory" => PerceptEvent::Victory {
            id: optional_text(row, "id")?,
            name: optional_text_or_undefined(row, "name")?,
            draw: boolean(row, "draw")?,
        },
        "toast" => PerceptEvent::Toast {
            text: text(row, "text")?,
        },
        "result" => PerceptEvent::Result,
        "private" => PerceptEvent::Private {
            type_: text(row, "type")?,
        },
        "ext" => PerceptEvent::Ext {
            fx: text(row, "fx")?,
            data: declared_record(field(row, "data")?, "events.data")?,
        },
        _ => return shape("events.kind"),
    };
    Ok(PerceptEventRow { t, at, kind })
}

/// One retained declared record (`MethodValue` subset) from the source-shaped trace model.
fn declared_record(value: &BVal, key: &'static str) -> R<MethodValue> {
    to_method_value(value).ok_or(BrainError::Shape(key))
}

/// Project the complete declared source percept into the admitted Strategy's declared decision input.
pub(crate) fn strategy_percept(p: &Percept) -> Result<strat::StrategyPercept, BrainError> {
    let raw = object(&p.raw, "percept")?;
    let self_raw = object(field(raw, "self")?, "self")?;
    let hud = object(field(raw, "hud")?, "hud")?;
    let mut fighters = Vec::new();
    for row in array(raw, "fighters")? {
        object(row, "fighters")?;
        fighters.push(strat::StrategyFighter {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            dist: number(row, "dist")?,
            los: boolean(row, "los")?,
            status: text(row, "status")?,
            targetable: boolean(row, "targetable")?,
            immune: boolean(row, "immune")?,
            hp_frac: number(row, "hpFrac")?,
            faction: optional_faction(row, "faction")?,
            in_hand: weapon_field(row, "inHand")?,
            bounty: number(row, "bounty")?,
            tint: number(row, "tint")?,
        });
    }
    let mut mobs = Vec::new();
    for row in array(raw, "mobs")? {
        object(row, "mobs")?;
        mobs.push(strat::StrategyMob {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            status: text(row, "status")?,
            kind: text(row, "kind")?,
        });
    }
    let mut containers = Vec::new();
    for row in array(raw, "containers")? {
        object(row, "containers")?;
        containers.push(strat::StrategyContainer {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            closed: boolean(row, "closed")?,
            weapon: container_weapon(row, "weapon")?,
        });
    }
    let extras_raw = object(field(raw, "extras")?, "extras")?;
    let camps = match extras_raw.get("camps") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(BVal::Arr(rows)) => {
            let mut views = Vec::new();
            for row in rows {
                object(row, "extras.camps")?;
                views.push(strat::CampView {
                    index: uint_field(row, "index", u32::MAX as u64)? as usize,
                    type_: optional_text_presence(row, "type")?,
                    reward: optional_text_presence(row, "reward")?.unwrap_or_default(),
                    alive: uint_field(row, "alive", u32::MAX as u64)? as u32,
                    state: uint_field(row, "state", 2)? as u8,
                    respawn_at: match row.get("respawnAt") {
                        Some(BVal::Num(v)) if v.is_finite() => Some(*v),
                        Some(BVal::Num(_)) => return Err(BrainError::Nonfinite("extras.camps")),
                        Some(BVal::Undefined) | Some(BVal::Null) => None,
                        Some(_) => return shape("extras.camps"),
                        None => None,
                    },
                });
            }
            Some(views)
        }
        Some(_) => return shape("extras.camps"),
    };
    Ok(strat::StrategyPercept {
        now: number(raw, "now")?,
        self_: strat::StrategySelf {
            id: text(self_raw, "id")?,
            name: text_or_undefined(self_raw, "name")?,
            faction: optional_faction(self_raw, "faction")?,
            x: number(self_raw, "x")?,
            y: number(self_raw, "y")?,
            facing: number(self_raw, "facing")?,
            status: text(self_raw, "status")?,
            hp: number(self_raw, "hp")?,
            max_hp: number(self_raw, "maxHp")?,
            barrier: number(self_raw, "barrier")?,
            draw_started_at: number(self_raw, "drawStartedAt")?,
            ready_at: number(self_raw, "readyAt")?,
            immune_until: number_or_undefined(self_raw, "immuneUntil")?,
            sig: number(self_raw, "sig")?,
            brand: number(self_raw, "brand")?,
            as_mult: number(self_raw, "asMult")?,
            // Source `self.windupMult ?? 1`: the declared read of the one optional mirror (the strategy's charged
            // formulas use `asMult`; this field is retained for the source self record).
            windup_mult: match self_raw.get("windupMult") {
                None | Some(BVal::Undefined) | Some(BVal::Null) => 1.,
                Some(BVal::Num(v)) if v.is_finite() => *v,
                Some(BVal::Num(_)) => return Err(BrainError::Nonfinite("self.windupMult")),
                Some(_) => return shape("self.windupMult"),
            },
            gv: number(self_raw, "gv")?,
            move_seq: number(self_raw, "moveSeq")?,
            weapons: weapon_pair(self_raw, "weapons")?,
            slot: uint_field(self_raw, "slot", 1)? as u8,
            attack_target: optional_text_or_undefined(self_raw, "attackTarget")?,
            mob_kills: number_or_undefined(self_raw, "mobKills")?,
            power: number(self_raw, "power")?,
            kills: number(self_raw, "kills")?,
            mob_stats: mob_stats(self_raw)?,
            speed_mult: number(self_raw, "speedMult")?,
            bounty: number(self_raw, "bounty")?,
        },
        hud: strat::StrategyHud {
            raid_started_at: number(hud, "raidStartedAt")?,
            patience_ends_at: number(hud, "patienceEndsAt")?,
            sudden_death_at: number(hud, "suddenDeathAt")?,
            in_coliseum: boolean(hud, "inColiseum")?,
            // `StrategyHud.alive` is a count (`u32`) and cannot carry `undefined`. Its one reader is `alive > 2`
            // (engine.rs coliseum gate; strategy.ts:801), where `undefined > 2` is false, as is `0 > 2`.
            alive: match hud.get("alive") {
                Some(BVal::Undefined) => 0,
                _ => uint_field(hud, "alive", u32::MAX as u64)? as u32,
            },
            gates_locked: boolean(hud, "gatesLocked")?,
        },
        fighters,
        mobs,
        containers,
        extras: strat::StrategyExtras { camps },
    })
}

/// Source `self.mobStats?: Record<string, number>`: the per normal-type credited kill stacks, in declared order.
fn mob_stats(self_raw: &BVal) -> R<Vec<(String, u32)>> {
    match self_raw.get("mobStats") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => Ok(Vec::new()),
        Some(BVal::Obj(fields))
        | Some(BVal::Instance {
            entries: fields, ..
        }) => {
            let mut stats = Vec::with_capacity(fields.len());
            for (id, value) in fields {
                let n = number_value(value, "self.mobStats")?;
                // The declared source record stores binary64 counts; the hunt consumes unsigned stacks.
                let stacks = if n.fract() == 0. && n >= 0. && n <= u32::MAX as f64 {
                    n as u32
                } else {
                    return shape("self.mobStats");
                };
                stats.push((id.clone(), stacks));
            }
            Ok(stats)
        }
        Some(_) => shape("self.mobStats"),
    }
}

/// Project the complete declared source percept into the admitted Tactics' declared action input.
pub(crate) fn tactic_percept(p: &Percept) -> Result<tact::TacticPercept, BrainError> {
    let raw = object(&p.raw, "percept")?;
    let self_raw = object(field(raw, "self")?, "self")?;
    let hud = object(field(raw, "hud")?, "hud")?;
    let minimap = object(field(raw, "minimap")?, "minimap")?;
    let mut fighters = Vec::new();
    for row in array(raw, "fighters")? {
        object(row, "fighters")?;
        fighters.push(tact::TacticFighter {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            bot: boolean_or_undefined(row, "bot")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            facing: number(row, "facing")?,
            status: text(row, "status")?,
            hp_frac: number(row, "hpFrac")?,
            barrier_frac: number(row, "barrierFrac")?,
            faction: optional_faction(row, "faction")?,
            in_hand: weapon_field(row, "inHand")?,
            draw_started_at: number_or_undefined(row, "drawStartedAt")?,
            bounty: number(row, "bounty")?,
            immune: boolean(row, "immune")?,
            sig: number(row, "sig")?,
            brand: number(row, "brand")?,
            targetable: boolean(row, "targetable")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
            dist: number(row, "dist")?,
            los: boolean(row, "los")?,
            tint: number(row, "tint")?,
            central: boolean(row, "central")?,
        });
    }
    let mut mobs = Vec::new();
    for row in array(raw, "mobs")? {
        object(row, "mobs")?;
        mobs.push(tact::TacticMob {
            id: text(row, "id")?,
            type_: optional_text_presence(row, "type")?,
            kind: text(row, "kind")?,
            name: text_or_undefined(row, "name")?,
            faction: optional_faction(row, "faction")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            facing: number(row, "facing")?,
            status: text(row, "status")?,
            hp_frac: number(row, "hpFrac")?,
            in_hand: weapon_field(row, "inHand")?,
            draw_started_at: number_or_undefined(row, "drawStartedAt")?,
            sig: number(row, "sig")?,
            brand: number(row, "brand")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
            dist: number(row, "dist")?,
            los: boolean(row, "los")?,
            central: boolean(row, "central")?,
        });
    }
    let mut containers = Vec::new();
    for row in array(raw, "containers")? {
        object(row, "containers")?;
        containers.push(tact::TacticContainer {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            label: text(row, "label")?,
            closed: boolean(row, "closed")?,
            weapon: container_weapon(row, "weapon")?,
            interactable: boolean(row, "interactable")?,
            dist: number(row, "dist")?,
        });
    }
    let mut projectiles = Vec::new();
    for row in array(raw, "projectiles")? {
        object(row, "projectiles")?;
        projectiles.push(tact::TacticProjectile {
            id: text_or_undefined(row, "id")?,
            kind: projectile_kind(&text(row, "kind")?)?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            vx: number_or_undefined(row, "vx")?,
            vy: number_or_undefined(row, "vy")?,
            x0: number_or_undefined(row, "x0")?,
            y0: number_or_undefined(row, "y0")?,
            t0: number_or_undefined(row, "t0")?,
            range: number_or_undefined(row, "range")?,
            from: optional_text(row, "from")?,
        });
    }
    let mut minimap_mobs = Vec::new();
    for row in array(minimap, "mobs")? {
        object(row, "minimap.mobs")?;
        minimap_mobs.push(tact::TacticMinimapMob {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            faction: optional_faction(row, "faction")?,
            elite: boolean(row, "elite")?,
        });
    }
    let mut events = Vec::new();
    for row in array(raw, "events")? {
        events.push(tactic_event(row)?);
    }
    Ok(tact::TacticPercept {
        now: number(raw, "now")?,
        view_t: number(raw, "viewT")?,
        self_: tact::TacticSelf {
            id: text(self_raw, "id")?,
            name: text_or_undefined(self_raw, "name")?,
            x: number(self_raw, "x")?,
            y: number(self_raw, "y")?,
            facing: number(self_raw, "facing")?,
            status: text(self_raw, "status")?,
            hp: number(self_raw, "hp")?,
            max_hp: number(self_raw, "maxHp")?,
            barrier: number(self_raw, "barrier")?,
            faction: optional_faction(self_raw, "faction")?,
            weapons: weapon_pair(self_raw, "weapons")?,
            slot: uint_field(self_raw, "slot", 1)? as u8,
            attack_target: optional_text_or_undefined(self_raw, "attackTarget")?,
            draw_started_at: number(self_raw, "drawStartedAt")?,
            ready_at: number(self_raw, "readyAt")?,
            immune_until: number_or_undefined(self_raw, "immuneUntil")?,
            sig: number(self_raw, "sig")?,
            brand: number(self_raw, "brand")?,
            power: number(self_raw, "power")?,
            as_mult: number(self_raw, "asMult")?,
            windup_mult: windup_presence(self_raw)?,
            speed_mult: number(self_raw, "speedMult")?,
            kills: number(self_raw, "kills")?,
            mob_kills: number_or_undefined(self_raw, "mobKills")?,
            gv: number(self_raw, "gv")?,
            bounty: number(self_raw, "bounty")?,
            move_seq: number(self_raw, "moveSeq")?,
        },
        hud: tact::TacticHud {
            phase: text(hud, "phase")?,
            training: boolean(hud, "training")?,
            lobby_ends_at: number(hud, "lobbyEndsAt")?,
            raid_started_at: number(hud, "raidStartedAt")?,
            patience_ends_at: number(hud, "patienceEndsAt")?,
            sudden_death_at: number(hud, "suddenDeathAt")?,
            in_coliseum: boolean(hud, "inColiseum")?,
            gates_locked: boolean(hud, "gatesLocked")?,
            started_with: number(hud, "startedWith")?,
            alive: number_or_undefined(hud, "alive")?,
            player_count: number(hud, "playerCount")?,
            min_players: number_or_undefined(hud, "minPlayers")?,
            winner: text_or_undefined(hud, "winner")?,
        },
        fighters,
        mobs,
        containers,
        projectiles,
        minimap: tact::TacticMinimap {
            t: number_or_undefined(minimap, "t")?,
            mobs: minimap_mobs,
            gates_locked: boolean(minimap, "gatesLocked")?,
        },
        events,
        extras: projection_extras(field(raw, "extras")?)?,
        features: features(field(raw, "features")?)?,
    })
}

fn projectile_kind(kind: &str) -> R<tact::ProjectileKind> {
    match kind {
        "arrow" => Ok(tact::ProjectileKind::Arrow),
        "ball" => Ok(tact::ProjectileKind::Ball),
        _ => shape("projectiles.kind"),
    }
}

/// Source optional `windupMult?: number`: the declared witness keeps absent and own `undefined` apart.
fn windup_presence(self_raw: &BVal) -> R<tact::Presence<f64>> {
    match self_raw.get("windupMult") {
        None => Ok(tact::Presence::Absent),
        Some(BVal::Undefined) => Ok(tact::Presence::Undefined),
        Some(BVal::Num(v)) if v.is_finite() => Ok(tact::Presence::Value(*v)),
        Some(BVal::Num(_)) => Err(BrainError::Nonfinite("self.windupMult")),
        Some(_) => shape("self.windupMult"),
    }
}

/// The admitted Memory declared extras subset (`camps`, `chests`, `plan`), from the declared source extras object.
fn projection_extras(extras_raw: &BVal) -> R<PerceptExtras> {
    object(extras_raw, "extras")?;
    let mut extras = PerceptExtras::default();
    match extras_raw.get("camps") {
        None | Some(BVal::Undefined) => {}
        Some(BVal::Arr(rows)) => {
            for row in rows {
                object(row, "extras.camps")?;
                extras.camps.push(PerceptCampView {
                    id: text(row, "id")?,
                    state: uint_field(row, "state", 2)? as u8,
                });
            }
        }
        Some(_) => return shape("extras.camps"),
    }
    match extras_raw.get("chests") {
        None | Some(BVal::Undefined) => {}
        Some(BVal::Arr(rows)) => {
            for row in rows {
                object(row, "extras.chests")?;
                extras.chests.push(PerceptChest {
                    id: text(row, "id")?,
                    x: number(row, "x")?,
                    y: number(row, "y")?,
                    picked: boolean(row, "picked")?,
                });
            }
        }
        Some(_) => return shape("extras.chests"),
    }
    match extras_raw.get("plan") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => {}
        Some(plan) => {
            object(plan, "extras.plan")?;
            extras.plan = Some(PerceptPlan {
                ends_at: number(plan, "endsAt")?,
            });
        }
    }
    Ok(extras)
}

fn tactic_event(row: &BVal) -> R<tact::TacticEvent> {
    object(row, "events")?;
    let t = number(row, "t")?;
    let at = match field(row, "at")? {
        BVal::Null => None,
        at => Some(at_point(at, "events.at")?),
    };
    let kind = match text(row, "kind")?.as_str() {
        "windup" => tact::TacticEventKind::Windup {
            by: text(row, "by")?,
            weapon: weapon_field_required(row, "weapon")?,
            a: number(row, "a")?,
            ms: number(row, "ms")?,
        },
        "swing" => tact::TacticEventKind::Swing {
            by: text(row, "by")?,
            weapon: weapon_field_required(row, "weapon")?,
            a: number(row, "a")?,
        },
        "hit" => tact::TacticEventKind::Hit {
            id: text(row, "id")?,
            by: optional_text(row, "by")?,
            amount: number(row, "amount")?,
            weapon: weapon_field(row, "weapon")?,
            sig: optional_text(row, "sig")?,
        },
        "block" => tact::TacticEventKind::Block {
            id: text(row, "id")?,
            by: optional_text(row, "by")?,
            weapon: weapon_field(row, "weapon")?,
        },
        "stagger" => tact::TacticEventKind::Stagger {
            id: text(row, "id")?,
        },
        "cancel" => tact::TacticEventKind::Cancel {
            id: text(row, "id")?,
        },
        "projEnd" => tact::TacticEventKind::ProjEnd {
            id: text(row, "id")?,
            proj: projectile_kind(&text(row, "proj")?)?,
            reason: text(row, "reason")?,
        },
        "death" => tact::TacticEventKind::Death {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            by: optional_text(row, "by")?,
            mob: boolean(row, "mob")?,
        },
        "heal" => tact::TacticEventKind::Heal {
            id: text(row, "id")?,
            amount: number(row, "amount")?,
        },
        "teleport" => tact::TacticEventKind::Teleport,
        "bounty" => tact::TacticEventKind::Bounty {
            id: text(row, "id")?,
            name: text_or_undefined(row, "name")?,
            bounty: number(row, "bounty")?,
        },
        "victory" => tact::TacticEventKind::Victory {
            id: optional_text(row, "id")?,
            name: optional_text_or_undefined(row, "name")?,
            draw: boolean(row, "draw")?,
        },
        "toast" => tact::TacticEventKind::Toast {
            text: text(row, "text")?,
        },
        "result" => tact::TacticEventKind::Result,
        "private" => {
            let msg = field(row, "msg")?;
            object(msg, "events.msg")?;
            tact::TacticEventKind::Private {
                type_: text(row, "type")?,
                msg: declared_record(msg, "events.msg")?,
            }
        }
        "ext" => tact::TacticEventKind::Ext {
            fx: text(row, "fx")?,
            data: declared_record(field(row, "data")?, "events.data")?,
        },
        _ => return shape("events.kind"),
    };
    Ok(tact::TacticEvent { t, at, kind })
}

/// Project the complete declared source percept into the admitted Modules' declared hook input.
pub(crate) fn module_percept(p: &Percept) -> Result<ModulePercept, BrainError> {
    let raw = object(&p.raw, "percept")?;
    let self_raw = object(field(raw, "self")?, "self")?;
    let hud = object(field(raw, "hud")?, "hud")?;
    let extras_raw = object(field(raw, "extras")?, "extras")?;
    let chests = match extras_raw.get("chests") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(BVal::Arr(rows)) => {
            let mut parsed = Vec::with_capacity(rows.len());
            for row in rows {
                parsed.push(source_chest(row)?);
            }
            Some(parsed)
        }
        Some(_) => return shape("extras.chests"),
    };
    let wish = match extras_raw.get("wish") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(row) => Some(module_wish(row)?),
    };
    let mut effects = Vec::new();
    match extras_raw.get("effects") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => {}
        Some(BVal::Obj(fields))
        | Some(BVal::Instance {
            entries: fields, ..
        }) => {
            for (id, value) in fields {
                effects.push((id.clone(), number_value(value, "extras.effects")?));
            }
        }
        Some(_) => return shape("extras.effects"),
    }
    let mut fighters = Vec::new();
    for row in array(raw, "fighters")? {
        object(row, "fighters")?;
        fighters.push(ModuleFighter {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            status: text(row, "status")?,
            dist: number(row, "dist")?,
            los: boolean(row, "los")?,
            targetable: boolean(row, "targetable")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
            faction: optional_faction(row, "faction")?,
        });
    }
    let mut mobs = Vec::new();
    for row in array(raw, "mobs")? {
        object(row, "mobs")?;
        mobs.push(ModuleMob {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            status: text(row, "status")?,
            dist: number(row, "dist")?,
            los: boolean(row, "los")?,
        });
    }
    let mut events = Vec::new();
    for row in array(raw, "events")? {
        events.push(module_event(row)?);
    }
    let faction_text = match self_raw.get("faction") {
        Some(BVal::Str(name)) => name.clone(),
        Some(BVal::Null) | None => String::new(),
        Some(_) => return shape("self.faction"),
    };
    let build = match self_raw.get("build") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(BVal::Obj(fields))
        | Some(BVal::Instance {
            entries: fields, ..
        }) => {
            let mut counts = CardCounts::default();
            for (id, value) in fields {
                counts.set(id.clone(), number_value(value, "self.build")?);
            }
            Some(counts)
        }
        Some(_) => return shape("self.build"),
    };
    Ok(ModulePercept {
        now: number(raw, "now")?,
        view_t: number(raw, "viewT")?,
        self_: ModuleSelf {
            id: text(self_raw, "id")?,
            name: text_or_undefined(self_raw, "name")?,
            x: number(self_raw, "x")?,
            y: number(self_raw, "y")?,
            facing: number(self_raw, "facing")?,
            status: text(self_raw, "status")?,
            hp: number(self_raw, "hp")?,
            max_hp: number(self_raw, "maxHp")?,
            barrier: number(self_raw, "barrier")?,
            faction_text,
            faction: optional_faction(self_raw, "faction")?,
            weapons: weapon_pair(self_raw, "weapons")?,
            slot: uint_field(self_raw, "slot", 1)? as u8,
            attack_target: optional_text_or_undefined(self_raw, "attackTarget")?,
            build,
            record: declared_record(self_raw, "self")?,
        },
        hud: ModuleHud {
            phase: text(hud, "phase")?,
            in_coliseum: boolean(hud, "inColiseum")?,
            gates_locked: boolean(hud, "gatesLocked")?,
            patience_ends_at: number(hud, "patienceEndsAt")?,
        },
        fighters,
        mobs,
        chests,
        wish,
        effects,
        events,
        features: features(field(raw, "features")?)?,
    })
}

fn source_chest(row: &BVal) -> R<SourceChest> {
    object(row, "extras.chests")?;
    let options = match field(row, "options")? {
        BVal::Null => None,
        BVal::Arr(rows) => Some(
            rows.iter()
                .map(|card| text_value(card, "extras.chests.options"))
                .collect::<R<Vec<_>>>()?,
        ),
        _ => return shape("extras.chests.options"),
    };
    let taken_by = array(row, "takenBy")?
        .iter()
        .map(|id| text_value(id, "extras.chests.takenBy"))
        .collect::<R<Vec<_>>>()?;
    let life_ms = match row.get("lifeMs") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(BVal::Num(v)) if v.is_finite() => Some(*v),
        Some(BVal::Num(_)) => return Err(BrainError::Nonfinite("extras.chests.lifeMs")),
        Some(_) => return shape("extras.chests.lifeMs"),
    };
    Ok(SourceChest {
        id: text(row, "id")?,
        x: number(row, "x")?,
        y: number(row, "y")?,
        expires_at: number(row, "expiresAt")?,
        life_ms,
        options,
        taken_by,
        picked: boolean(row, "picked")?,
    })
}

fn module_wish(row: &BVal) -> R<WishView> {
    object(row, "extras.wish")?;
    let def = match field(row, "def")? {
        BVal::Undefined | BVal::Null => None,
        BVal::Obj(_) | BVal::Instance { .. } => Some(ability_def(field(row, "def")?)?),
        _ => return shape("extras.wish.def"),
    };
    Ok(WishView {
        ability: text(row, "ability")?,
        def,
        // A rank that is not on the wire stays `undefined`: every reader goes through source `rankOf`
        // (shared abilities.ts:126, `Number.isFinite(rank) ? rank : 1`), which reads NaN as rank 1, the one rank a Wish has.
        rank: number_or_undefined(row, "rank")?,
        ready_at: number(row, "readyAt")?,
        casting: boolean(row, "casting")?,
    })
}

fn wish_targeting(value: &BVal) -> R<WishTargeting> {
    object(value, "extras.wish.def.ranks.targeting")?;
    let kind = text(value, "kind")?;
    match kind.as_str() {
        "self" => Ok(WishTargeting::Self_),
        "dir" => Ok(WishTargeting::Dir),
        "unit" => {
            let who = text(value, "who")?;
            if who != "enemy" {
                return shape("extras.wish.def.ranks.targeting.who");
            }
            Ok(WishTargeting::Unit {
                range: number(value, "range")?,
                los: boolean(value, "los")?,
                snap_radius: number(value, "snapRadius")?,
            })
        }
        "point" => Ok(WishTargeting::Point {
            range: number(value, "range")?,
            min_range: number(value, "minRange")?,
        }),
        _ => shape("extras.wish.def.ranks.targeting.kind"),
    }
}

fn ai_intent(tag: &str) -> R<crate::bots::wish::AiIntent> {
    use crate::bots::wish::AiIntent;
    Ok(match tag {
        "escape" => AiIntent::Escape,
        "sustain" => AiIntent::Sustain,
        "engage" => AiIntent::Engage,
        "control" => AiIntent::Control,
        "peel" => AiIntent::Peel,
        "burst" => AiIntent::Burst,
        "zone" => AiIntent::Zone,
        "buff" => AiIntent::Buff,
        _ => return shape("extras.wish.def.ai"),
    })
}

fn blocked_by(tag: &str) -> R<crate::bots::wish::BlockedBy> {
    use crate::bots::wish::BlockedBy;
    Ok(match tag {
        "stun" => BlockedBy::Stun,
        "silence" => BlockedBy::Silence,
        "root" => BlockedBy::Root,
        _ => return shape("extras.wish.def.blockedBy"),
    })
}

fn ability_rank(value: &BVal) -> R<AbilityRank> {
    object(value, "extras.wish.def.ranks")?;
    let raw = declared_record(value, "extras.wish.def.ranks")?;
    let cast_ms = match value.get("castMs") {
        None | Some(BVal::Undefined) => None,
        Some(member) => Some(number_value(member, "extras.wish.def.ranks.castMs")?),
    };
    let targeting = match value.get("targeting") {
        None | Some(BVal::Undefined) => None,
        Some(member) => Some(wish_targeting(member)?),
    };
    let mut hides_caster = false;
    let mut blink = None;
    if let Some(effects) = value.get("effects") {
        let BVal::Arr(rows) = effects else {
            // A declared guard rank whose effects member is not an array keeps the admitted guard shape; the complete
            // declaration is retained in `raw`.
            return Ok(AbilityRank {
                cast_ms,
                targeting,
                hides_caster,
                blink,
                raw,
            });
        };
        for effect in rows {
            object(effect, "extras.wish.def.ranks.effects")?;
            let Some(operation) = effect.get("do") else {
                continue;
            };
            let BVal::Str(operation) = operation else {
                return shape("extras.wish.def.ranks.effects.do");
            };
            if operation == "status" {
                let to = effect.get("to").and_then(BVal::as_str);
                let status = effect.get("status").and_then(BVal::as_str);
                if to == Some("self") && status == Some("hidden") {
                    hides_caster = true;
                }
            } else if operation == "blink" {
                let max_dist = number(effect, "maxDist")?;
                let min_dist = number(effect, "minDist")?;
                blink = Some((max_dist, min_dist));
            }
        }
    }
    Ok(AbilityRank {
        cast_ms,
        targeting,
        hides_caster,
        blink,
        raw,
    })
}

fn ability_def(value: &BVal) -> R<AbilityDef> {
    object(value, "extras.wish.def")?;
    let raw = declared_record(value, "extras.wish.def")?;
    let name = match value.get("name") {
        None | Some(BVal::Undefined) => String::new(),
        Some(BVal::Str(name)) => name.clone(),
        Some(_) => return shape("extras.wish.def.name"),
    };
    let mut ai = Vec::new();
    let mut ai_is_array = false;
    match value.get("ai") {
        None | Some(BVal::Undefined) => {}
        Some(BVal::Arr(rows)) => {
            ai_is_array = true;
            for row in rows {
                ai.push(ai_intent(&text_value(row, "extras.wish.def.ai")?)?);
            }
        }
        Some(_) => return shape("extras.wish.def.ai"),
    }
    let mut blocked = Vec::new();
    let mut blocked_is_array = false;
    match value.get("blockedBy") {
        None | Some(BVal::Undefined) => {}
        Some(BVal::Arr(rows)) => {
            blocked_is_array = true;
            for row in rows {
                blocked.push(blocked_by(&text_value(row, "extras.wish.def.blockedBy")?)?);
            }
        }
        Some(_) => return shape("extras.wish.def.blockedBy"),
    }
    let mut ranks = Vec::new();
    match value.get("ranks") {
        None | Some(BVal::Undefined) => {}
        Some(BVal::Arr(rows)) => {
            for row in rows {
                ranks.push(ability_rank(row)?);
            }
        }
        Some(_) => return shape("extras.wish.def.ranks"),
    }
    // Source `defOf` also requires array-typed `ai`/`blockedBy`; a boundary object missing those arrays is represented
    // as the guarded-out absence (`ranks` empty) while its complete declaration stays in `raw`.
    if !ai_is_array || !blocked_is_array {
        ranks.clear();
    }
    Ok(AbilityDef {
        name,
        ai,
        blocked_by: blocked,
        ranks,
        raw,
    })
}

fn module_event(row: &BVal) -> R<ModuleEvent> {
    object(row, "events")?;
    let kind = text(row, "kind")?;
    let t = number(row, "t")?;
    match field(row, "at")? {
        BVal::Null => {}
        at => {
            at_point(at, "events.at")?;
        }
    }
    let mut type_ = None;
    let mut msg = None;
    if kind == "private" {
        type_ = Some(text(row, "type")?);
        let record = field(row, "msg")?;
        object(record, "events.msg")?;
        msg = Some(declared_record(record, "events.msg")?);
    }
    Ok(ModuleEvent {
        kind,
        t,
        type_,
        msg,
        record: declared_record(row, "events")?,
    })
}

/// Project the complete declared source percept into the narrow public `Percept` the admitted Humanizer reads.
///
/// The hand reads only its own drawn fighter, the HUD gates/phase, the fighter/mob/container rows behind its clicks and
/// the reward-chest panel gate. Facts the public narrowing cannot represent (the private Wish slot, the source's own
/// absence rules outside those reads) are not fabricated: `extras.wish` stays `None` and the self lock case is the
/// public "unavailable" `None`.
pub(crate) fn hand_percept(p: &Percept) -> Result<hand::Percept, BrainError> {
    let raw = object(&p.raw, "percept")?;
    let self_raw = object(field(raw, "self")?, "self")?;
    let hud = object(field(raw, "hud")?, "hud")?;
    let extras_raw = object(field(raw, "extras")?, "extras")?;
    let me_id = text(self_raw, "id")?;
    let mut effects = 0u16;
    match extras_raw.get("effects") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => {}
        Some(BVal::Obj(fields))
        | Some(BVal::Instance {
            entries: fields, ..
        }) => {
            if let Some((_, value)) = fields.iter().find(|(id, _)| *id == me_id) {
                effects = js_to_int32(number_value(value, "extras.effects")?) as u16;
            }
        }
        Some(_) => return shape("extras.effects"),
    }
    let mut fighters = Vec::new();
    for row in array(raw, "fighters")? {
        object(row, "fighters")?;
        fighters.push(hand::FighterView {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
            status: text(row, "status")?,
            targetable: boolean(row, "targetable")?,
        });
    }
    let mut mobs = Vec::new();
    for row in array(raw, "mobs")? {
        object(row, "mobs")?;
        mobs.push(hand::MobView {
            id: text(row, "id")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            vx: number(row, "vx")?,
            vy: number(row, "vy")?,
            status: text(row, "status")?,
            kind: text(row, "kind")?,
        });
    }
    let mut containers = Vec::new();
    for row in array(raw, "containers")? {
        object(row, "containers")?;
        containers.push(hand::ContainerView {
            id: text(row, "id")?,
            kind: text(row, "kind")?,
            x: number(row, "x")?,
            y: number(row, "y")?,
            interactable: boolean(row, "interactable")?,
        });
    }
    let chests = match extras_raw.get("chests") {
        None | Some(BVal::Undefined) | Some(BVal::Null) => None,
        Some(BVal::Arr(rows)) => {
            let mut parsed = Vec::with_capacity(rows.len());
            for row in rows {
                object(row, "extras.chests")?;
                let options = match field(row, "options")? {
                    BVal::Null => None,
                    BVal::Arr(cards) => Some(
                        cards
                            .iter()
                            .map(|card| text_value(card, "extras.chests.options"))
                            .collect::<R<Vec<_>>>()?,
                    ),
                    _ => return shape("extras.chests.options"),
                };
                parsed.push(hand::RewardChestView {
                    id: text(row, "id")?,
                    x: number(row, "x")?,
                    y: number(row, "y")?,
                    expires_at: number(row, "expiresAt")?,
                    options,
                });
            }
            Some(parsed)
        }
        Some(_) => return shape("extras.chests"),
    };
    Ok(hand::Percept {
        now: number(raw, "now")?,
        self_view: hand::SelfView {
            id: me_id,
            faction: optional_faction(self_raw, "faction")?,
            x: number(self_raw, "x")?,
            y: number(self_raw, "y")?,
            facing: number(self_raw, "facing")?,
            status: text(self_raw, "status")?,
            hp: number(self_raw, "hp")?,
            max_hp: number(self_raw, "maxHp")?,
            effects,
            weapons: {
                let pair = weapon_pair(self_raw, "weapons")?;
                [
                    pair[0].map(strat::to_bot_weapon),
                    pair[1].map(strat::to_bot_weapon),
                ]
            },
            slot: uint_field(self_raw, "slot", 1)? as u8,
            attack_target: optional_text_or_undefined(self_raw, "attackTarget")?,
            // The private source SelfView declares no owner lock; the public field's documented "unavailable" is None.
            owner_lock: None,
            ready_at: number(self_raw, "readyAt")?,
        },
        hud: hand::HudView {
            phase: text(hud, "phase")?,
            gates_locked: boolean(hud, "gatesLocked")?,
        },
        fighters,
        mobs,
        containers,
        extras: hand::PerceptExtras { chests, wish: None },
    })
}

/// The admitted Humanizer's own think/release context around the narrow public percept and the two runtime lanes.
pub(crate) fn hand_context<'a>(
    p: &'a hand::Percept,
    engaged: bool,
    motor: &'a mut crate::bots::random::Rng,
    lapse: &'a mut crate::bots::random::Rng,
) -> humanizer::Context<'a> {
    humanizer::Context {
        p,
        engaged,
        motor,
        lapse,
    }
}
// ---------------------------------------------------------------------------------------------------------------------
// Memory adapters.
//
// The admitted Memory is the only store: these adapters reborrow its actual view/query surface and never build a second
// one. The Brain's tick stimulus overlay (observed stimuli plus the alive-only missed-click rows) is passed in explicitly
// because Memory itself keeps the post-filter source `stimuli` (dead-frame misses discarded); both components see exactly
// the source's `ctx.mem.stimuli`.

use super::super::modules::types::HuntChest;
use super::super::modules::types::LearnedBiasFn;
use super::super::strategy::HuntMobLike;
use super::trace::encode_method_value;
use crate::bots::knowledge::Knowledge;
use crate::bots::random::Rng;
use crate::bots::types::{BotWeapon, FightOdds, OpponentSnapshot, Stimulus};

/// Strategy's declared Memory read surface over the one admitted `Memory`, with the tick stimulus overlay.
pub(crate) struct StrategyMemory<'a> {
    pub(crate) mem: &'a Memory,
    pub(crate) stimuli: &'a [Stimulus],
}

impl strat::MemoryApi for StrategyMemory<'_> {
    fn fighters(&self) -> &[(String, FighterMemory)] {
        self.mem.view().fighters
    }
    fn mobs(&self) -> &[(String, MobMemory)] {
        self.mem.view().mobs
    }
    fn camps(&self) -> &[(String, super::super::memory::CampMemory)] {
        self.mem.view().camps
    }
    fn containers(&self) -> &[(String, ContainerMemory)] {
        self.mem.view().containers
    }
    fn self_memory(&self) -> &SelfMemory {
        self.mem.view().self_memory
    }
    fn stimuli(&self) -> &[Stimulus] {
        self.stimuli
    }
    fn bounties(&self) -> &[(String, f64)] {
        self.mem.view().bounties
    }
    fn choices(&self) -> &[String] {
        self.mem.view().choices
    }
    fn whereabouts(&self, id: &str, now: f64) -> Option<Whereabouts> {
        Memory::whereabouts(self.mem, id, now).ok().flatten()
    }
}

/// Tactics' declared Memory read surface over the one admitted `Memory`, with the tick stimulus overlay. Tactics reads
/// owned clones (source `MemoryView` is a value view) and the one query with a side effect, `whereabouts`.
pub(crate) struct TacticsMemory<'a> {
    pub(crate) mem: &'a mut Memory,
    pub(crate) stimuli: &'a [Stimulus],
}

impl tact::MemoryApi for TacticsMemory<'_> {
    fn fighter(&self, id: &str) -> Option<FighterMemory> {
        self.mem
            .view()
            .fighters
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn mob(&self, id: &str) -> Option<MobMemory> {
        self.mem
            .view()
            .mobs
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn container(&self, id: &str) -> Option<ContainerMemory> {
        self.mem
            .view()
            .containers
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn self_memory(&self) -> SelfMemory {
        self.mem.view().self_memory.clone()
    }
    fn stimuli(&self) -> Vec<Stimulus> {
        self.stimuli.to_vec()
    }
    fn whereabouts(&mut self, id: &str, now: f64) -> Option<Whereabouts> {
        Memory::whereabouts(&*self.mem, id, now).ok().flatten()
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Knowledge / learned-bias adapters over the one admitted component.
//
// The source observer wraps the runtime Knowledge methods on its first `observe`; before that (and for a Brain whose module
// list has no observer) the source records no knowledge rows. `learned.bias` is different: the source cfg owns that
// wrapper from construction, so it records on every call whenever a recorder watches the Brain.

fn encode_faction_name(faction: FactionId) -> BVal {
    BVal::text(faction.as_str())
}

fn encode_bot_weapon_name(weapon: BotWeapon) -> BVal {
    BVal::text(weapon.as_str())
}

/// Source `OpponentSnapshot` own-key order: `{id,faction,inHand,otherSlot,hpFrac,bounty,dist,tint}`.
fn encode_opponent_snapshot(snapshot: &OpponentSnapshot) -> BVal {
    BVal::obj([
        ("id", BVal::text(snapshot.id.clone())),
        (
            "faction",
            snapshot.faction.map_or(BVal::Null, encode_faction_name),
        ),
        (
            "inHand",
            snapshot.in_hand.map_or(BVal::Null, encode_bot_weapon_name),
        ),
        (
            "otherSlot",
            snapshot
                .other_slot
                .map_or(BVal::Null, encode_bot_weapon_name),
        ),
        ("hpFrac", BVal::num(snapshot.hp_frac)),
        ("bounty", BVal::num(f64::from(snapshot.bounty))),
        ("dist", BVal::num(snapshot.dist)),
        ("tint", BVal::num(snapshot.tint)),
    ])
}

/// Source `FightOdds` own-key order: `{edge,score,known,why}`.
fn encode_fight_odds(odds: &FightOdds) -> BVal {
    BVal::obj([
        ("edge", BVal::num(odds.edge)),
        ("score", BVal::num(odds.score)),
        ("known", BVal::flag(odds.known)),
        ("why", BVal::text(odds.why.as_str())),
    ])
}

/// Strategy's declared Knowledge surface over the one admitted `Knowledge`, recording the source `knowledge.*` rows.
pub(crate) struct StrategyKnowledge<'a> {
    pub(crate) know: &'a Knowledge,
    pub(crate) recorder: Option<&'a Recorder>,
    pub(crate) actor: &'a str,
    /// The complete declared source percept `self` object, exactly what the source strategy passes as `me`.
    pub(crate) source_self: &'a BVal,
}

impl StrategyKnowledge<'_> {
    /// The observer-owned Knowledge wrappers only exist after the source observer's first `observe`.
    fn sink(&self) -> Option<&Recorder> {
        self.recorder
            .filter(|recorder| recorder.is_active(self.actor))
    }
}

impl strat::KnowledgeApi for StrategyKnowledge<'_> {
    fn faction_edge(&self, a: FactionId, b: FactionId) -> i8 {
        let edge = Knowledge::faction_edge(self.know, a, b);
        record_callback(
            self.sink(),
            self.actor,
            "knowledge.factionEdge",
            vec![encode_faction_name(a), encode_faction_name(b)],
            BVal::num(f64::from(edge)),
        );
        edge
    }
    fn weapon_edge(&self, a: BotWeapon, b: BotWeapon) -> i8 {
        let edge = Knowledge::weapon_edge(self.know, a, b);
        record_callback(
            self.sink(),
            self.actor,
            "knowledge.weaponEdge",
            vec![encode_bot_weapon_name(a), encode_bot_weapon_name(b)],
            BVal::num(f64::from(edge)),
        );
        edge
    }
    fn mob_share(&self, me: FactionId, region: FactionId, elite: bool) -> f64 {
        let share = Knowledge::mob_share(self.know, me, region, elite);
        record_callback(
            self.sink(),
            self.actor,
            "knowledge.mobShare",
            vec![
                encode_faction_name(me),
                encode_faction_name(region),
                BVal::flag(elite),
            ],
            BVal::num(share),
        );
        share
    }
    fn odds(&self, me: &strat::StrategySelf, them: &strat::Enemy) -> FightOdds {
        let odds = strat::KnowledgeApi::odds(self.know, me, them);
        record_callback(
            self.sink(),
            self.actor,
            "knowledge.odds",
            vec![
                encode_declared_record(self.source_self),
                encode_opponent_snapshot(&them.snap),
            ],
            encode_fight_odds(&odds),
        );
        odds
    }
}

/// Tactics' declared Knowledge surface over the one admitted `Knowledge` (only `weaponEdge` in that closure).
pub(crate) struct TacticsKnowledge<'a> {
    pub(crate) know: &'a Knowledge,
    pub(crate) recorder: Option<&'a Recorder>,
    pub(crate) actor: &'a str,
}

impl TacticsKnowledge<'_> {
    fn sink(&self) -> Option<&Recorder> {
        self.recorder
            .filter(|recorder| recorder.is_active(self.actor))
    }
}

impl tact::KnowledgeApi for TacticsKnowledge<'_> {
    fn weapon_edge(&self, a: WeaponId, b: WeaponId) -> i8 {
        let edge =
            Knowledge::weapon_edge(self.know, strat::to_bot_weapon(a), strat::to_bot_weapon(b));
        record_callback(
            self.sink(),
            self.actor,
            "knowledge.weaponEdge",
            vec![BVal::text(a.as_str()), BVal::text(b.as_str())],
            BVal::num(f64::from(edge)),
        );
        edge
    }
}

/// The source `cfg.learned` callback surface over the caller's declared bias table, recording `learned.bias` rows for
/// both Strategy and Modules (they share the one source cfg object). `enabled` is a field read, never a callback.
pub(crate) struct StrategyLearned<'a> {
    pub(crate) learned: &'a dyn strat::LearnedBias,
    pub(crate) recorder: Option<&'a Recorder>,
    pub(crate) actor: &'a str,
}

impl StrategyLearned<'_> {
    fn bias_call(&self, key: &str) -> f64 {
        let value = self.learned.bias(key);
        record_callback(
            self.recorder,
            self.actor,
            "learned.bias",
            vec![BVal::text(key)],
            BVal::num(value),
        );
        value
    }
}

impl strat::LearnedBias for StrategyLearned<'_> {
    fn enabled(&self) -> bool {
        self.learned.enabled()
    }
    fn bias(&self, key: &str) -> f64 {
        self.bias_call(key)
    }
}

impl LearnedBiasFn for StrategyLearned<'_> {
    fn enabled(&self) -> bool {
        self.learned.enabled()
    }
    fn bias(&self, key: &str) -> f64 {
        self.bias_call(key)
    }
}

/// One recorded runtime lane: the Brain's own `Rng` borrowed for a stack-local span, with every draw recorded in the one
/// per-lane source order. Production passes the raw `Rng` (the trait is implemented for it) and never constructs this.
pub(crate) struct RecordedLane<'a> {
    pub(crate) rng: &'a mut Rng,
    pub(crate) recorder: Option<Recorder>,
    pub(crate) actor: &'a str,
    pub(crate) lane: usize,
}

impl RecordedLane<'_> {
    fn next_value(&mut self) -> f64 {
        let value = self.rng.next_f64();
        if let Some(recorder) = &self.recorder {
            recorder.rng(self.actor, self.lane, value);
        }
        value
    }
}

impl strat::RngStream for RecordedLane<'_> {
    fn draw(&mut self) -> f64 {
        self.next_value()
    }
}

impl tact::RngStream for RecordedLane<'_> {
    fn draw(&mut self) -> f64 {
        self.next_value()
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The one Brain path adapter.
//
// One actual caller-bound service handle plus the caller-owned room allowance, forwarding the three private path traits
// (Strategy, Tactics, Modules) to the same service and the same borrowed budget. LOS/clear/collision-map reads stay
// budget-free, exactly like the source service. Every source callback is recorded with the source's own argument
// objects: the complete declared percept `self` record, the source point objects, the source camp/chest/container/Foe
// objects, and the declared source GameMap record for `collisionMap` (derived `withGates` copy while the gates are
// locked, exactly like the source service's gated map).
//
// The source hunt passes a derived `MobLike` object to `paths.walk` (`huntAdapter.ts mobLikeOf`); the admitted
// `PathApi::walk_mob` entry point retains that source argument, and the Root-granted parent-visible re-export of the
// hunt record lets this adapter record its exact declared shape instead of a point fallback.

fn encode_walk_answer(answer: Option<WalkAnswer>) -> BVal {
    answer.map_or(BVal::Null, |answer| {
        BVal::obj([
            ("dist", BVal::num(answer.dist)),
            ("exact", BVal::flag(answer.exact)),
        ])
    })
}

fn encode_point_path(points: &Option<Vec<Vec2>>) -> BVal {
    points.as_ref().map_or(BVal::Null, |points| {
        BVal::arr(points.iter().map(|point| encode_vec2(*point)))
    })
}

fn encode_tactic_container_weapon(weapon: ContainersWeapon) -> BVal {
    match weapon {
        ContainersWeapon::Undefined => BVal::Undefined,
        ContainersWeapon::Null => BVal::Null,
        ContainersWeapon::Weapon(weapon) => BVal::text(weapon.as_str()),
    }
}

/// Source `TacticContainer` (`ContainerView`) own-key order:
/// `{id,kind,x,y,label,closed,weapon,interactable,dist}`.
fn encode_tactic_container(container: &tact::TacticContainer) -> BVal {
    BVal::obj([
        ("id", BVal::text(container.id.clone())),
        ("kind", BVal::text(container.kind.clone())),
        ("x", BVal::num(container.x)),
        ("y", BVal::num(container.y)),
        ("label", BVal::text(container.label.clone())),
        ("closed", BVal::flag(container.closed)),
        ("weapon", encode_tactic_container_weapon(container.weapon)),
        ("interactable", BVal::flag(container.interactable)),
        ("dist", BVal::num(container.dist)),
    ])
}

/// Source `Foe` (`tactics/fight.ts`) own-key order:
/// `{id,mob,seen,x,y,vx,vy,dist,los,facing,hpFrac,faction,theirs,targetable}`.
fn encode_foe(foe: &tact::Foe) -> BVal {
    BVal::obj([
        ("id", BVal::text(foe.id.clone())),
        ("mob", BVal::flag(foe.mob)),
        ("seen", BVal::flag(foe.seen)),
        ("x", BVal::num(foe.x)),
        ("y", BVal::num(foe.y)),
        ("vx", BVal::num(foe.vx)),
        ("vy", BVal::num(foe.vy)),
        ("dist", BVal::num(foe.dist)),
        ("los", BVal::flag(foe.los)),
        ("facing", BVal::num(foe.facing)),
        ("hpFrac", BVal::num(foe.hp_frac)),
        (
            "faction",
            foe.faction.map_or(BVal::Null, encode_faction_name),
        ),
        (
            "theirs",
            foe.theirs
                .map_or(BVal::Null, |weapon| BVal::text(weapon.as_str())),
        ),
        ("targetable", BVal::flag(foe.targetable)),
    ])
}

fn encode_path_arg(arg: tact::PathArg<'_>) -> BVal {
    match arg {
        tact::PathArg::Point(point) => encode_vec2(point),
        tact::PathArg::Foe(foe) => encode_foe(foe),
        tact::PathArg::Container(container) => encode_tactic_container(container),
    }
}

fn encode_route_element(element: &tact::RouteElement) -> BVal {
    match element {
        tact::RouteElement::Point(point) => encode_vec2(*point),
        tact::RouteElement::Foe(foe) => encode_foe(foe),
        tact::RouteElement::Container(container) => encode_tactic_container(container),
    }
}

fn encode_route(route: &Option<tact::PathRoute>) -> BVal {
    route.as_ref().map_or(BVal::Null, |route| {
        BVal::arr(route.elements.iter().map(encode_route_element))
    })
}

/// Source generated-map camp record own-key order: `{id,zone,x,y,r,spots,eliteSpot,chest,area,radius}`.
fn encode_camp(camp: &strat::CampDef) -> BVal {
    BVal::obj([
        ("id", BVal::text(camp.id.clone())),
        ("zone", encode_faction_name(camp.zone)),
        ("x", BVal::num(camp.x)),
        ("y", BVal::num(camp.y)),
        ("r", BVal::num(camp.r)),
        (
            "spots",
            BVal::arr(camp.spots.iter().map(|spot| encode_vec2(*spot))),
        ),
        ("eliteSpot", BVal::num(camp.elite_spot)),
        ("chest", encode_vec2(camp.chest)),
        ("area", BVal::num(camp.area)),
        ("radius", BVal::num(camp.radius)),
    ])
}

/// The source `withGates(map)` record: the spread copy keeps the declared map's own-key order and replaces only the
/// `tiles` array entries the coliseum gates occupy (`TILE_WALL`). Derived from the declared map record only; never from
/// an expected trace value.
fn with_gates_record(map: &BVal) -> BVal {
    let mut out = map.clone();
    let mut cells: Vec<Vec2> = Vec::new();
    if let Some(gates) = map
        .get("coliseum")
        .and_then(|coliseum| coliseum.get("gates"))
        .and_then(BVal::as_arr)
    {
        for gate in gates {
            if let Some(tiles) = gate.get("tiles").and_then(BVal::as_arr) {
                for tile in tiles {
                    if let (Some(x), Some(y)) = (
                        tile.get("x").and_then(BVal::as_num),
                        tile.get("y").and_then(BVal::as_num),
                    ) {
                        cells.push(Vec2::new(x, y));
                    }
                }
            }
        }
    }
    if cells.is_empty() {
        return out;
    }
    let Some(width) = map.get("w").and_then(BVal::as_num) else {
        return out;
    };
    let width = width as usize;
    if let BVal::Obj(fields) = &mut out {
        if let Some((_, BVal::U8(tiles))) =
            fields.iter_mut().find(|(key, _)| key.as_str() == "tiles")
        {
            for cell in cells {
                let index = (cell.y as usize)
                    .saturating_mul(width)
                    .saturating_add(cell.x as usize);
                if let Some(tile) = tiles.get_mut(index) {
                    *tile = TILE_WALL;
                }
            }
        }
    }
    out
}

/// Source `MobLike` (`huntAdapter.ts mobLikeOf`) own-key order:
/// `{kind,type,status,x,y,hp,maxHp,faction,weapon0}`. `type` is the catalog-canonical `MobTypeId` and its own key is
/// present with a tagged `undefined` when the source lookup yields nothing; `faction`/`weapon0` are the source `?? ""`
/// spellings.
fn encode_hunt_mob_like(mob: &HuntMobLike) -> BVal {
    let mob_type = match mob
        .type_
        .as_deref()
        .and_then(rh_sim::mob_catalog::mob_type_by_id)
    {
        Some(mob_type) => BVal::text(mob_type.id.as_str()),
        None => BVal::Undefined,
    };
    BVal::obj([
        ("kind", BVal::text(mob.kind.clone())),
        ("type", mob_type),
        ("status", BVal::text(mob.status.clone())),
        ("x", BVal::num(mob.x)),
        ("y", BVal::num(mob.y)),
        ("hp", BVal::num(mob.hp)),
        ("maxHp", BVal::num(mob.max_hp)),
        (
            "faction",
            BVal::text(mob.faction_text.as_deref().unwrap_or("")),
        ),
        (
            "weapon0",
            BVal::text(mob.weapon0_text.as_deref().unwrap_or("")),
        ),
    ])
}

/// One caller-bound Brain path service, the caller-owned room allowance and the declared source records the callbacks
/// quote. Implements the Strategy, Tactics and Modules private path traits; `module_paths` returns the same object so a
/// module goals callback reborrows the one actual service/allowance instead of a copy.
pub(crate) struct BrainPathAdapter<'a> {
    service: &'a mut dyn BrainPathService,
    budget: &'a mut PathBudget,
    recorder: Option<&'a Recorder>,
    actor: &'a str,
    service_handle: &'a str,
    /// The complete declared source percept `self` object (callback `me` argument).
    self_record: &'a BVal,
    /// The complete declared source `GameMap` record (`paths.collisionMap` result).
    map_record: &'a BVal,
    /// The declared map's camp records, when the map record carries them (exact `paths.walk` camp argument).
    map_camps: Option<&'a [BVal]>,
    gates_locked: bool,
}

impl<'a> BrainPathAdapter<'a> {
    pub(crate) fn new(
        service: &'a mut dyn BrainPathService,
        budget: &'a mut PathBudget,
        recorder: Option<&'a Recorder>,
        actor: &'a str,
        service_handle: &'a str,
        percept_raw: &'a BVal,
        map_raw: &'a BVal,
    ) -> Result<Self, BrainError> {
        let self_record = percept_raw.get("self").ok_or(BrainError::Missing("self"))?;
        if self_record.as_obj().is_none() {
            return Err(BrainError::Shape("self"));
        }
        if map_raw.as_obj().is_none() {
            return Err(BrainError::Shape("map"));
        }
        let map_camps = map_raw.get("camps").and_then(BVal::as_arr);
        let gates_locked = match percept_raw
            .get("hud")
            .and_then(|hud| hud.get("gatesLocked"))
        {
            Some(BVal::Bool(value)) => *value,
            Some(_) => return Err(BrainError::Shape("hud.gatesLocked")),
            None => false,
        };
        Ok(Self {
            service,
            budget,
            recorder,
            actor,
            service_handle,
            self_record,
            map_record: map_raw,
            map_camps,
            gates_locked,
        })
    }

    fn self_argument(&self) -> BVal {
        encode_declared_record(self.self_record)
    }

    /// The exact declared camp object for one generated-map camp: the map record's own record when present (own-key
    /// order preserved), else the complete `CampDef` in the source camp literal order.
    fn camp_argument(&self, camp: &strat::CampDef) -> BVal {
        if let Some(camps) = self.map_camps {
            if let Some(record) = camps
                .iter()
                .find(|row| row.get("id").and_then(BVal::as_str) == Some(camp.id.as_str()))
            {
                return encode_declared_record(record);
            }
        }
        encode_camp(camp)
    }

    /// The source `collisionMap()` answer: the declared map, or its `withGates` copy while the gates are locked.
    fn collision_map_record(&self) -> BVal {
        if self.gates_locked {
            with_gates_record(self.map_record)
        } else {
            encode_declared_record(self.map_record)
        }
    }

    fn path_service_extra(&self) -> Vec<(&'static str, BVal)> {
        vec![("service", BVal::text(self.service_handle))]
    }

    fn call_walk(&mut self, from: Vec2, to: Vec2, args: Vec<BVal>) -> Option<WalkAnswer> {
        let extra = self.path_service_extra();
        let slot = begin_callback(self.recorder, self.actor, "paths.walk", args, extra);
        let answer = self.service.walk(from, to, &mut *self.budget);
        finish_callback(self.recorder, slot, encode_walk_answer(answer));
        answer
    }

    fn call_path(&mut self, from: Vec2, to: Vec2, args: Vec<BVal>) -> Option<Vec<Vec2>> {
        let extra = self.path_service_extra();
        let slot = begin_callback(self.recorder, self.actor, "paths.path", args, extra);
        let points = self.service.path(from, to, &mut *self.budget);
        finish_callback(self.recorder, slot, encode_point_path(&points));
        points
    }

    fn call_los(&self, a: Vec2, b: Vec2, args: Vec<BVal>) -> bool {
        let extra = self.path_service_extra();
        let slot = begin_callback(self.recorder, self.actor, "paths.los", args, extra);
        let clear = self.service.los(a, b);
        finish_callback(self.recorder, slot, BVal::flag(clear));
        clear
    }

    fn call_clear(&self, a: Vec2, b: Vec2, args: Vec<BVal>) -> bool {
        let extra = self.path_service_extra();
        let slot = begin_callback(self.recorder, self.actor, "paths.clear", args, extra);
        let clear = self.service.clear(a, b);
        finish_callback(self.recorder, slot, BVal::flag(clear));
        clear
    }

    fn call_collision_map(&self) -> &TileMap {
        if self.recorder.is_some() {
            let extra = self.path_service_extra();
            let slot = begin_callback(
                self.recorder,
                self.actor,
                "paths.collisionMap",
                Vec::new(),
                extra,
            );
            let record = self.collision_map_record();
            let map = self.service.collision_map();
            finish_callback(self.recorder, slot, record);
            return map;
        }
        self.service.collision_map()
    }
}

impl strat::PathApi for BrainPathAdapter<'_> {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        self.call_walk(from, to, vec![encode_vec2(from), encode_vec2(to)])
    }

    fn walk_mob(&mut self, from: Vec2, to: &HuntMobLike) -> Option<WalkAnswer> {
        let args = vec![encode_vec2(from), encode_hunt_mob_like(to)];
        self.call_walk(from, Vec2::new(to.x, to.y), args)
    }

    fn walk_camp(&mut self, from: &strat::StrategySelf, to: &strat::CampDef) -> Option<WalkAnswer> {
        let args = vec![self.self_argument(), self.camp_argument(to)];
        self.call_walk(from.pos(), Vec2::new(to.x, to.y), args)
    }

    fn los(&self, a: Vec2, b: Vec2) -> bool {
        self.call_los(a, b, vec![encode_vec2(a), encode_vec2(b)])
    }

    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        self.call_clear(a, b, vec![encode_vec2(a), encode_vec2(b)])
    }

    fn module_paths(&mut self) -> Option<&mut dyn ModulePaths> {
        Some(self)
    }
}

impl tact::PathApi for BrainPathAdapter<'_> {
    fn walk(&mut self, from: &tact::TacticSelf, to: tact::PathArg<'_>) -> Option<WalkAnswer> {
        let args = vec![self.self_argument(), encode_path_arg(to)];
        self.call_walk(from.pos(), to.point(), args)
    }

    fn path(&mut self, from: &tact::TacticSelf, to: tact::PathArg<'_>) -> Option<tact::PathRoute> {
        let args = vec![self.self_argument(), encode_path_arg(to)];
        let extra = self.path_service_extra();
        let slot = begin_callback(self.recorder, self.actor, "paths.path", args, extra);
        let points = self.service.path(from.pos(), to.point(), &mut *self.budget);
        let route = points.map(|points| tact::PathRoute {
            elements: points.into_iter().map(tact::RouteElement::Point).collect(),
        });
        finish_callback(self.recorder, slot, encode_route(&route));
        route
    }

    fn los(&mut self, a: &tact::TacticSelf, b: tact::PathArg<'_>) -> bool {
        let args = vec![self.self_argument(), encode_path_arg(b)];
        self.call_los(a.pos(), b.point(), args)
    }

    fn clear(&mut self, a: &tact::TacticSelf, b: tact::PathArg<'_>) -> bool {
        let args = vec![self.self_argument(), encode_path_arg(b)];
        self.call_clear(a.pos(), b.point(), args)
    }

    fn collision_map(&mut self) -> &TileMap {
        self.call_collision_map()
    }
}

impl ModulePaths for BrainPathAdapter<'_> {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        // The admitted modules always pass the bot's own drawn position and a source target object; a plain point target
        // is the source's `paths.walk(me, point)` shape.
        let args = vec![self.self_argument(), encode_vec2(to)];
        self.call_walk(from, to, args)
    }

    fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
        let args = vec![self.self_argument(), encode_vec2(to)];
        self.call_path(from, to, args)
    }

    fn los(&self, a: Vec2, b: Vec2) -> bool {
        let args = vec![self.self_argument(), encode_vec2(b)];
        self.call_los(a, b, args)
    }

    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        let args = vec![self.self_argument(), encode_vec2(b)];
        self.call_clear(a, b, args)
    }

    fn collision_map(&self) -> &TileMap {
        self.call_collision_map()
    }

    fn walk_target(&mut self, from: Vec2, target: &HuntChest) -> Option<WalkAnswer> {
        let args = vec![self.self_argument(), encode_method_value(&target.data())];
        self.call_walk(from, target.pos(), args)
    }

    fn los_target(&self, from: Vec2, target: &HuntChest) -> bool {
        let args = vec![self.self_argument(), encode_method_value(&target.data())];
        self.call_los(from, target.pos(), args)
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Module hook context assembly.
//
// One call environment per module hook: the caller's declared cfg identity/facts, the complete projected module percept,
// the same Memory overlay, the same actual path adapter, the gates-aware collision view, the caller's log sink (source
// `cfg.services.log`, no name prefix), the three runtime lanes and the engaged fact. The engine builds the parts on the
// stack around one hook call and drops the context before any other component runs.

pub(crate) struct ModuleCallParts<'a> {
    pub(crate) cfg: &'a ModuleConfig<'a>,
    pub(crate) p: &'a ModulePercept,
    pub(crate) mem: &'a dyn strat::MemoryApi,
    pub(crate) paths: &'a mut dyn ModulePaths,
    /// Source `withGates(map)` collision view for the current gate state.
    pub(crate) collision: &'a TileMap,
    pub(crate) log: &'a dyn Fn(&str),
    pub(crate) decide: &'a mut dyn strat::RngStream,
    pub(crate) lapse: &'a mut dyn strat::RngStream,
    pub(crate) motor: &'a mut dyn strat::RngStream,
    pub(crate) engaged: bool,
}

pub(crate) fn module_context<'a>(parts: ModuleCallParts<'a>) -> ModuleContext<'a> {
    ModuleContext {
        cfg: parts.cfg,
        p: parts.p,
        mem: parts.mem,
        paths: parts.paths,
        collision: parts.collision,
        log: parts.log,
        rng: RngLanes {
            decide: parts.decide,
            motor: parts.motor,
            lapse: parts.lapse,
        },
        engaged: parts.engaged,
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Small unit checks that need no corpus: projection of a hand-built declared percept and same-budget path forwarding.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::paths::PathStats;
    use crate::bots::view::Features;

    fn test_self() -> BVal {
        BVal::obj([
            ("id", BVal::text("me")),
            ("name", BVal::text("Me")),
            ("x", BVal::num(100.)),
            ("y", BVal::num(200.)),
            ("facing", BVal::num(0.)),
            ("status", BVal::text("alive")),
            ("hp", BVal::num(90.)),
            ("maxHp", BVal::num(100.)),
            ("barrier", BVal::num(0.)),
            ("faction", BVal::text("fire")),
            ("weapons", BVal::arr([BVal::text("sword"), BVal::Null])),
            ("slot", BVal::num(0.)),
            ("attackTarget", BVal::Null),
            ("drawStartedAt", BVal::num(0.)),
            ("readyAt", BVal::num(0.)),
            ("immuneUntil", BVal::num(0.)),
            ("sig", BVal::num(0.)),
            ("brand", BVal::num(0.)),
            ("power", BVal::num(3.)),
            ("asMult", BVal::num(1.)),
            ("windupMult", BVal::num(1.5)),
            ("speedMult", BVal::num(1.)),
            ("kills", BVal::num(0.)),
            ("mobKills", BVal::num(2.)),
            ("gv", BVal::num(0.)),
            ("bounty", BVal::num(0.)),
            ("moveSeq", BVal::num(4.)),
        ])
    }

    fn test_hud(gates_locked: bool) -> BVal {
        BVal::obj([
            ("phase", BVal::text("active")),
            ("training", BVal::flag(false)),
            ("lobbyEndsAt", BVal::num(0.)),
            ("raidStartedAt", BVal::num(0.)),
            ("patienceEndsAt", BVal::num(200_000.)),
            ("suddenDeathAt", BVal::num(0.)),
            ("inColiseum", BVal::flag(false)),
            ("gatesLocked", BVal::flag(gates_locked)),
            ("startedWith", BVal::num(6.)),
            ("alive", BVal::num(6.)),
            ("playerCount", BVal::num(6.)),
            ("minPlayers", BVal::num(2.)),
            ("winner", BVal::text("")),
        ])
    }

    fn test_percept_raw(gates_locked: bool) -> BVal {
        BVal::obj([
            ("now", BVal::num(1000.)),
            ("viewT", BVal::num(970.)),
            ("self", test_self()),
            ("hud", test_hud(gates_locked)),
            (
                "fighters",
                BVal::arr([BVal::obj([
                    ("id", BVal::text("foe")),
                    ("name", BVal::text("foe")),
                    ("bot", BVal::flag(false)),
                    ("x", BVal::num(120.)),
                    ("y", BVal::num(200.)),
                    ("facing", BVal::num(std::f64::consts::PI)),
                    ("status", BVal::text("alive")),
                    ("hpFrac", BVal::num(0.5)),
                    ("barrierFrac", BVal::num(0.)),
                    ("faction", BVal::text("frost")),
                    ("inHand", BVal::text("sword")),
                    ("drawStartedAt", BVal::num(0.)),
                    ("bounty", BVal::num(0.)),
                    ("immune", BVal::flag(false)),
                    ("sig", BVal::num(0.)),
                    ("brand", BVal::num(0.)),
                    ("targetable", BVal::flag(true)),
                    ("vx", BVal::num(0.)),
                    ("vy", BVal::num(0.)),
                    ("dist", BVal::num(20.)),
                    ("los", BVal::flag(true)),
                    ("tint", BVal::num(0.)),
                    ("central", BVal::flag(true)),
                ])]),
            ),
            (
                "mobs",
                BVal::arr([BVal::obj([
                    ("id", BVal::text("mob1")),
                    ("kind", BVal::text("mob")),
                    ("name", BVal::text("Pardoner")),
                    ("type", BVal::text("pardoner")),
                    ("faction", BVal::text("sentenced")),
                    ("x", BVal::num(140.)),
                    ("y", BVal::num(200.)),
                    ("facing", BVal::num(std::f64::consts::PI)),
                    ("status", BVal::text("alive")),
                    ("hpFrac", BVal::num(1.)),
                    ("inHand", BVal::text("sword")),
                    ("drawStartedAt", BVal::num(0.)),
                    ("sig", BVal::num(0.)),
                    ("brand", BVal::num(0.)),
                    ("vx", BVal::num(0.)),
                    ("vy", BVal::num(0.)),
                    ("dist", BVal::num(40.)),
                    ("los", BVal::flag(true)),
                    ("central", BVal::flag(true)),
                ])]),
            ),
            (
                "containers",
                BVal::arr([BVal::obj([
                    ("id", BVal::text("box")),
                    ("kind", BVal::text("reward")),
                    ("x", BVal::num(160.)),
                    ("y", BVal::num(200.)),
                    ("label", BVal::text("")),
                    ("closed", BVal::flag(true)),
                    ("weapon", BVal::Undefined),
                    ("interactable", BVal::flag(true)),
                    ("dist", BVal::num(60.)),
                ])]),
            ),
            ("projectiles", BVal::arr([])),
            (
                "minimap",
                BVal::obj([
                    ("t", BVal::num(1000.)),
                    ("mobs", BVal::arr([])),
                    ("gatesLocked", BVal::flag(gates_locked)),
                ]),
            ),
            (
                "events",
                BVal::arr([BVal::obj([
                    ("kind", BVal::text("hit")),
                    ("t", BVal::num(999.)),
                    ("at", BVal::Null),
                    ("id", BVal::text("me")),
                    ("by", BVal::text("foe")),
                    ("amount", BVal::num(5.)),
                    ("weapon", BVal::text("sword")),
                    ("sig", BVal::Null),
                ])]),
            ),
            (
                "extras",
                BVal::obj([
                    ("effects", BVal::obj([("me", BVal::num(4096.))])),
                    (
                        "chests",
                        BVal::arr([BVal::obj([
                            ("id", BVal::text("box")),
                            ("x", BVal::num(160.)),
                            ("y", BVal::num(200.)),
                            ("expiresAt", BVal::num(15_000.)),
                            ("options", BVal::Null),
                            ("takenBy", BVal::arr([])),
                            ("picked", BVal::flag(false)),
                        ])]),
                    ),
                ]),
            ),
            (
                "features",
                super::super::trace::encode_features(&Features::default()),
            ),
        ])
    }

    fn test_percept(gates_locked: bool) -> Percept {
        Percept {
            raw: test_percept_raw(gates_locked),
            ..Percept::default()
        }
    }

    #[test]
    fn projections_keep_the_declared_source_facts() {
        let percept = test_percept(false);
        let memory = memory_percept(&percept).expect("memory projection");
        assert_eq!(memory.now, 1000.);
        assert_eq!(memory.self_.status, "alive");
        assert_eq!(memory.self_.move_seq, 4.);
        assert_eq!(memory.containers[0].weapon, PerceptWeapon::Undefined);
        assert_eq!(memory.extras.chests[0].id, "box");
        assert!(memory.extras.plan.is_none());
        match &memory.events[0].kind {
            PerceptEvent::Hit { amount, by, .. } => {
                assert_eq!(*amount, 5.);
                assert_eq!(by.as_deref(), Some("foe"));
            }
            other => panic!("unexpected event {other:?}"),
        }

        let strategy = strategy_percept(&percept).expect("strategy projection");
        assert_eq!(strategy.self_.windup_mult, 1.5);
        assert_eq!(strategy.self_.weapons, [Some(WeaponId::Sword), None]);
        assert_eq!(strategy.hud.raid_started_at, 0.);
        assert_eq!(strategy.fighters[0].id, "foe");
        assert_eq!(strategy.containers[0].weapon, ContainersWeapon::Undefined);
        assert_eq!(strategy.extras.camps, None);

        let tactics = tactic_percept(&percept).expect("tactics projection");
        assert_eq!(tactics.self_.windup_mult, tact::Presence::Value(1.5));
        assert!(!tactics.minimap.gates_locked);
        assert!(matches!(
            tactics.events[0].kind,
            tact::TacticEventKind::Hit { .. }
        ));

        let module = module_percept(&percept).expect("module projection");
        assert_eq!(module.self_.faction_text, "fire");
        assert!(module.chests.is_some());
        assert_eq!(module.effects, vec![("me".to_string(), 4096.)]);

        let hand = hand_percept(&percept).expect("hand projection");
        assert_eq!(hand.self_view.effects, 4096);
        assert_eq!(hand.hud.phase, "active");
        assert_eq!(hand.extras.chests.as_ref().map(Vec::len), Some(1));
        assert!(hand.extras.wish.is_none());
    }

    #[test]
    fn path_adapter_forwards_one_budget_and_records_source_rows() {
        struct FakeService {
            map: TileMap,
        }
        impl BrainPathService for FakeService {
            fn set_frame(&mut self, _now: f64, _gates_locked: bool) {}
            fn walk(
                &mut self,
                _from: Vec2,
                _to: Vec2,
                budget: &mut PathBudget,
            ) -> Option<WalkAnswer> {
                budget.take().then_some(WalkAnswer {
                    dist: 12.5,
                    exact: true,
                })
            }
            fn path(&mut self, from: Vec2, to: Vec2, budget: &mut PathBudget) -> Option<Vec<Vec2>> {
                budget.take().then(|| vec![from, to])
            }
            fn los(&self, _a: Vec2, _b: Vec2) -> bool {
                true
            }
            fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
                false
            }
            fn collision_map(&self) -> &TileMap {
                &self.map
            }
            fn stats(&self) -> PathStats {
                PathStats::default()
            }
            fn module_paths_capable(&self) -> bool {
                true
            }
        }

        let map_record = BVal::obj([
            ("seed", BVal::num(0.)),
            ("w", BVal::num(4.)),
            ("h", BVal::num(4.)),
            ("tiles", BVal::U8(vec![0; 16])),
            (
                "coliseum",
                BVal::obj([
                    (
                        "gates",
                        BVal::arr([BVal::obj([
                            ("side", BVal::text("n")),
                            (
                                "tiles",
                                BVal::arr([BVal::obj([
                                    ("x", BVal::num(1.)),
                                    ("y", BVal::num(1.)),
                                ])]),
                            ),
                        ])]),
                    ),
                    (
                        "centre",
                        BVal::obj([("x", BVal::num(64.)), ("y", BVal::num(64.))]),
                    ),
                ]),
            ),
        ]);
        let mut service = FakeService {
            map: TileMap::new(4, 4, vec![0; 16]).expect("tile map"),
        };
        let recorder = Recorder::new();
        let raw = test_percept_raw(true);
        let mut budget = PathBudget::new(1);
        {
            let mut adapter = BrainPathAdapter::new(
                &mut service,
                &mut budget,
                Some(&recorder),
                "a",
                "a",
                &raw,
                &map_record,
            )
            .expect("adapter");
            let first = strat::PathApi::walk(&mut adapter, Vec2::new(1., 1.), Vec2::new(2., 2.));
            assert_eq!(first.map(|answer| answer.dist), Some(12.5));
            let second = strat::PathApi::walk(&mut adapter, Vec2::new(1., 1.), Vec2::new(3., 2.));
            assert!(second.is_none(), "the one borrowed allowance is spent");

            let chest = HuntChest {
                id: "box".into(),
                kind: "reward".into(),
                x: 160.,
                y: 200.,
                expires_at: 15_000.,
                life_ms: None,
                options: vec!["?".into()],
                taken_by: Vec::new(),
                pickers: Vec::new(),
                raw: None,
            };
            assert!(
                ModulePaths::walk_target(&mut adapter, Vec2::new(100., 200.), &chest).is_none()
            );
            let _ = ModulePaths::collision_map(&adapter);
        }
        assert_eq!(budget.left(), 0);
        let events = recorder.events();
        let rows = events.as_arr().expect("event array");
        assert!(rows.len() >= 3, "one row per callback: {events:?}");
        let walk_row = &rows[0];
        assert_eq!(
            walk_row.get("name").and_then(BVal::as_str),
            Some("paths.walk")
        );
        assert_eq!(walk_row.get("service").and_then(BVal::as_str), Some("a"));
        let args = walk_row
            .get("args")
            .and_then(BVal::as_arr)
            .expect("args array");
        assert_eq!(
            args[0].get("x").and_then(BVal::as_num),
            Some(1.),
            "the plain strategy walk's from point keeps the source point object shape"
        );
        let result = walk_row.get("result").expect("recorded result");
        assert_eq!(result.get("dist").and_then(BVal::as_num), Some(12.5));
        let target_row = &rows[2];
        assert_eq!(
            target_row.get("name").and_then(BVal::as_str),
            Some("paths.walk")
        );
        let target_args = target_row
            .get("args")
            .and_then(BVal::as_arr)
            .expect("target args array");
        assert_eq!(
            target_args[0].get("id").and_then(BVal::as_str),
            Some("me"),
            "a module walk target keeps the source self object as its first argument"
        );
        assert_eq!(
            target_args[1].get("kind").and_then(BVal::as_str),
            Some("reward"),
            "the source chest row object is the second argument"
        );
        let collision_row = rows.last().expect("collision row");
        assert_eq!(
            collision_row.get("name").and_then(BVal::as_str),
            Some("paths.collisionMap")
        );
        let record = collision_row.get("result").expect("collision record");
        let tiles = match record.get("tiles") {
            Some(BVal::U8(tiles)) => tiles,
            other => panic!("expected a u8 tile layer, got {other:?}"),
        };
        // The declared gate tile (1,1) on the 4-wide record lives at index 5.
        assert_eq!(
            tiles[5], TILE_WALL,
            "the gated record sets the declared gate tile to a wall"
        );
    }
}
