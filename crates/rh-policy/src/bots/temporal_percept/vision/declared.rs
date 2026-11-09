//! Declared `BotVision.update` method inputs: exactly the leaves the source reads from
//! `PerceptionInput` (`state.serverTime/phase/training/players/gatesLocked/camps` and
//! `privates`). JavaScript truthiness, strict equality, `?.` and `??` stay explicit.
//! The leaves an active update reads are planned in source order before any mutation;
//! a value the source would throw on, or one needing string/object coercion, refuses
//! instead of being guessed. Nothing is defaulted that the source does not default.
use super::super::data::{MethodValue, Object};
use super::super::Error;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UpdateInput {
    pub(crate) server_time: f64,
    /// `state.phase === "active"`.
    pub(crate) phase_active: bool,
    /// ToBoolean(`state.training`).
    pub(crate) training: bool,
    /// Read by an active update only.
    gates_locked: MethodValue,
    camps: MethodValue,
    privates: MethodValue,
    /// `state.players` in its declared Map iteration order.
    players: Vec<(String, MethodValue)>,
}

/// What an active source update reads, validated in its order.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Plan<'a> {
    /// The untrusted `msg` of each `type === "vision"` private message, in order.
    pub(crate) snapshots: Vec<&'a MethodValue>,
    /// `[id, p.extra?.bushRevealUntil ?? 0]` per player, in Map order.
    pub(crate) reveals: Vec<(&'a str, f64)>,
    pub(crate) gates_locked: bool,
    /// `me?.status === "alive"`: `[ToNumber(me.x), ToNumber(me.y)]` before `Math.fround`.
    pub(crate) origin: Option<(f64, f64)>,
    /// Per original camp index below `map.camps.length`: owned by the seat, with its expiry.
    pub(crate) wards: Vec<(usize, f64)>,
}

/// JavaScript ToBoolean.
pub(crate) fn truthy(value: &MethodValue) -> bool {
    match value {
        MethodValue::Undefined | MethodValue::Null => false,
        MethodValue::Bool(v) => *v,
        MethodValue::Num(v) => *v != 0. && !v.is_nan(),
        MethodValue::Str(v) => !v.is_empty(),
        MethodValue::Arr(_) | MethodValue::Obj(_) => true,
    }
}

/// A property read: an absent own member is `undefined`; primitives and arrays expose
/// none of the members the source reads.
fn member<'a>(value: &'a MethodValue, key: &str) -> &'a MethodValue {
    match value {
        MethodValue::Obj(fields) => fields
            .iter()
            .find(|(k, _)| k == key)
            .map_or(&MethodValue::Undefined, |(_, v)| v),
        _ => &MethodValue::Undefined,
    }
}

/// ToNumber over the primitive domain; strings/objects would need JS parsing/ToPrimitive.
fn to_number(value: &MethodValue, key: &'static str) -> Result<f64, Error> {
    match value {
        MethodValue::Undefined => Ok(f64::NAN),
        MethodValue::Null => Ok(0.),
        MethodValue::Bool(v) => Ok(f64::from(u8::from(*v))),
        MethodValue::Num(v) => Ok(*v),
        _ => Err(Error::Shape(key)),
    }
}

impl UpdateInput {
    /// `state` is the declared state record without `players`; `players` is its Map in
    /// iteration order (duplicate keys refuse: a Map cannot hold them); `privates` is
    /// `input.privates` (absent → `None`).
    pub(crate) fn read(
        state: &Object,
        players: Vec<(String, MethodValue)>,
        privates: Option<MethodValue>,
    ) -> Result<Self, Error> {
        let server_time = state.number("serverTime")?;
        if !server_time.is_finite() {
            return Err(Error::Nonfinite);
        }
        for (index, (id, _)) in players.iter().enumerate() {
            if players[..index].iter().any(|(other, _)| other == id) {
                return Err(Error::Shape("players"));
            }
        }
        let state = MethodValue::Obj(state.0.clone());
        Ok(Self {
            server_time,
            phase_active: matches!(member(&state, "phase"), MethodValue::Str(p) if p == "active"),
            training: truthy(member(&state, "training")),
            gates_locked: member(&state, "gatesLocked").clone(),
            camps: member(&state, "camps").clone(),
            privates: privates.unwrap_or(MethodValue::Undefined),
            players,
        })
    }

    /// The reads of an active update, in source order: privates, players' reveals,
    /// gatesLocked, the seat's status/position, then camps up to `map_camps`.
    pub(crate) fn plan(&self, self_id: &str, map_camps: usize) -> Result<Plan<'_>, Error> {
        let mut snapshots = Vec::new();
        match &self.privates {
            MethodValue::Undefined | MethodValue::Null => {}
            MethodValue::Arr(rows) => {
                for message in rows {
                    match message {
                        // `message.type` on a nullish message throws.
                        MethodValue::Undefined | MethodValue::Null => {
                            return Err(Error::Shape("private message"))
                        }
                        _ if matches!(member(message, "type"), MethodValue::Str(t) if t == "vision") =>
                        {
                            snapshots.push(member(message, "msg"));
                        }
                        _ => {}
                    }
                }
            }
            // A string iterates its characters, none of which has `type`.
            MethodValue::Str(_) => {}
            // Any other value is not iterable: the source throws.
            _ => return Err(Error::Shape("privates")),
        }
        let mut reveals = Vec::with_capacity(self.players.len());
        for (id, p) in &self.players {
            if matches!(p, MethodValue::Undefined | MethodValue::Null) {
                return Err(Error::Shape("player"));
            }
            let extra = member(p, "extra");
            let until = match member(extra, "bushRevealUntil") {
                MethodValue::Undefined | MethodValue::Null => 0.,
                MethodValue::Num(v) => *v,
                _ => return Err(Error::Shape("bushRevealUntil")),
            };
            reveals.push((id.as_str(), until));
        }
        let me = self
            .players
            .iter()
            .find(|(id, _)| id == self_id)
            .map(|(_, p)| p);
        let origin = match me {
            Some(me) if matches!(member(me, "status"), MethodValue::Str(s) if s == "alive") => {
                Some((
                    to_number(member(me, "x"), "x")?,
                    to_number(member(me, "y"), "y")?,
                ))
            }
            _ => None,
        };
        let mut wards = Vec::new();
        match &self.camps {
            camps if !truthy(camps) => {}
            MethodValue::Arr(camps) => {
                for (index, camp) in camps.iter().enumerate() {
                    if !truthy(camp) || index >= map_camps {
                        continue;
                    }
                    if !matches!(member(camp, "wardOwner"), MethodValue::Str(o) if o == self_id) {
                        continue;
                    }
                    match member(camp, "wardExpiresAt") {
                        MethodValue::Undefined => {}
                        MethodValue::Num(end) => wards.push((index, *end)),
                        // null/boolean/string relational coercion is outside the declared domain.
                        _ => return Err(Error::Shape("wardExpiresAt")),
                    }
                }
            }
            // `.length` of an object/number/boolean is undefined (no loop); a string's
            // characters never own a ward.
            _ => {}
        }
        Ok(Plan {
            snapshots,
            reveals,
            gates_locked: truthy(&self.gates_locked),
            origin,
            wards,
        })
    }
}

/// Source restore guard: `snapshot.seed/w/h` strictly equal and `cells` an array.
pub(crate) fn snapshot_cells(
    msg: &MethodValue,
    seed: f64,
    w: f64,
    h: f64,
) -> Option<&[MethodValue]> {
    if !truthy(msg) {
        return None;
    }
    let same = |key: &str, want: f64| matches!(member(msg, key), MethodValue::Num(v) if *v == want);
    if !same("seed", seed) || !same("w", w) || !same("h", h) {
        return None;
    }
    match member(msg, "cells") {
        MethodValue::Arr(cells) => Some(cells),
        _ => None,
    }
}

/// One restored cell: `Number.isInteger(index) && index >= 0 && index < length &&
/// Number.isFinite(expiry) && expiry > now`. Short arrays destructure to undefined.
pub(crate) fn restored_cell(cell: &MethodValue, len: usize, now: f64) -> Option<(usize, f64)> {
    let MethodValue::Arr(parts) = cell else {
        return None;
    };
    let (MethodValue::Num(index), MethodValue::Num(expiry)) = (
        parts.first().unwrap_or(&MethodValue::Undefined),
        parts.get(1).unwrap_or(&MethodValue::Undefined),
    ) else {
        return None;
    };
    let integer = index.is_finite() && index.trunc() == *index;
    (integer && *index >= 0. && *index < len as f64 && expiry.is_finite() && *expiry > now)
        .then_some((*index as usize, *expiry))
}
