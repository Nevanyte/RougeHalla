//! The record payload preserves every uninspected public leaf and optional omission.
//! Typed fields below are the exact leaves the source temporal composer reads.
use super::data::{faction, finite, num, object, text, weapon, Object};
use super::Error;
use crate::bots::view::{Features, MessageData};
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MethodId(pub(crate) String);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Actor {
    pub(crate) id: MethodId,
    pub(crate) at: Vec2,
    pub(crate) status: String,
    pub(crate) faction: Option<FactionId>,
    pub(crate) hand: Option<WeaponId>,
    pub(crate) record: Object,
}
impl Actor {
    fn read(record: Object) -> Result<Self, Error> {
        Ok(Self {
            id: MethodId(record.string("id")?.to_owned()),
            at: record.at()?,
            status: record.string("status")?.to_owned(),
            faction: faction(record.get("faction")?)?,
            hand: weapon(record.get("inHand")?)?,
            record,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Owner {
    pub(crate) id: MethodId,
    pub(crate) at: Vec2,
    pub(crate) status: String,
    pub(crate) faction: Option<FactionId>,
    pub(crate) weapons: [Option<WeaponId>; 2],
    pub(crate) slot: usize,
    pub(crate) record: Object,
}
impl Owner {
    fn read(record: Object) -> Result<Self, Error> {
        let weapons = record.array("weapons")?;
        if weapons.len() != 2 {
            return Err(Error::Shape("weapons"));
        }
        let slot = match record.number("slot")? {
            0. => 0,
            1. => 1,
            _ => return Err(Error::Shape("slot")),
        };
        Ok(Self {
            id: MethodId(record.string("id")?.to_owned()),
            at: record.at()?,
            status: record.string("status")?.to_owned(),
            faction: faction(record.get("faction")?)?,
            weapons: [weapon(&weapons[0])?, weapon(&weapons[1])?],
            slot,
            record,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Hud {
    pub(crate) phase: String,
    pub(crate) locked: bool,
    pub(crate) record: Object,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Container {
    pub(crate) at: Vec2,
    pub(crate) kind: String,
    pub(crate) record: Object,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Projectile {
    pub(crate) id: MethodId,
    pub(crate) kind: String,
    pub(crate) origin: Vec2,
    pub(crate) velocity: Vec2,
    pub(crate) started: f64,
    pub(crate) range: f64,
}
impl Projectile {
    fn read(record: Object) -> Result<Self, Error> {
        let kind = record.string("kind")?.to_owned();
        if kind != "arrow" && kind != "ball" {
            return Err(Error::Shape("projectile kind"));
        }
        // Input current coordinates/from are not a launch-course substitute. Require
        // actual source shape but use only the immutable course that FrameRing reads.
        record.at()?;
        record.nullable_string("from")?;
        Ok(Self {
            id: MethodId(record.string("id")?.to_owned()),
            kind,
            origin: Vec2::new(record.number("x0")?, record.number("y0")?),
            velocity: Vec2::new(record.number("vx")?, record.number("vy")?),
            started: record.number("t0")?,
            range: record.number("range")?,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum EventKind {
    Teleport,
    Death {
        id: MethodId,
        by: Option<String>,
        mob: bool,
    },
    Impact {
        by: Option<String>,
    },
    End {
        id: MethodId,
        reason: String,
    },
    Ext {
        data: Object,
    },
    Other,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Event {
    pub(crate) at: Option<Vec2>,
    pub(crate) time: f64,
    pub(crate) kind: EventKind,
    pub(crate) record: Object,
}
impl Event {
    fn read(record: Object) -> Result<Self, Error> {
        let at = match record.get("at")? {
            MessageData::Null => None,
            value => Some(Object::read(value.clone())?.at()?),
        };
        let kind = match record.string("kind")? {
            "teleport" => EventKind::Teleport,
            "death" => EventKind::Death {
                id: MethodId(record.string("id")?.to_owned()),
                by: record.nullable_string("by")?,
                mob: record.boolean("mob")?,
            },
            "hit" | "block" => EventKind::Impact {
                by: record.nullable_string("by")?,
            },
            "projEnd" => EventKind::End {
                id: MethodId(record.string("id")?.to_owned()),
                reason: record.string("reason")?.to_owned(),
            },
            "ext" => EventKind::Ext {
                data: record.object("data")?,
            },
            _ => EventKind::Other,
        };
        Ok(Self {
            at,
            time: record.number("t")?,
            kind,
            record,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Frame {
    pub(crate) time: f64,
    pub(crate) owner: Owner,
    pub(crate) hud: Hud,
    pub(crate) fighters: Vec<Actor>,
    pub(crate) mobs: Vec<Actor>,
    pub(crate) containers: Vec<Container>,
    pub(crate) projectiles: Vec<Projectile>,
    pub(crate) minimap: MessageData,
    pub(crate) events: Vec<Event>,
    pub(crate) immediate: Vec<Event>,
    pub(crate) extras: Object,
}
impl Frame {
    /// Declared source method data only. Missing fields refuse; no Unknown→empty,
    /// Unknown→null faction, reconstructed course or expected-Percept constructor.
    pub(crate) fn read(data: MessageData) -> Result<Self, Error> {
        let record = Object::read(data)?;
        let hud = record.object("hud")?;
        let frame = Self {
            time: record.number("t")?,
            owner: Owner::read(record.object("self")?)?,
            hud: Hud {
                phase: hud.string("phase")?.to_owned(),
                locked: hud.boolean("gatesLocked")?,
                record: hud,
            },
            fighters: read_rows(&record, "fighters", Actor::read)?,
            mobs: read_rows(&record, "mobs", Actor::read)?,
            containers: read_rows(&record, "containers", |row| {
                Ok(Container {
                    at: row.at()?,
                    kind: row.string("kind")?.to_owned(),
                    record: row,
                })
            })?,
            projectiles: read_rows(&record, "projectiles", Projectile::read)?,
            minimap: record.get("minimap")?.clone(),
            events: read_rows(&record, "events", Event::read)?,
            immediate: read_rows(&record, "immediate", Event::read)?,
            extras: record.object("extras")?,
        };
        frame.validate_extras()?;
        Ok(frame)
    }
    fn validate_extras(&self) -> Result<(), Error> {
        if let Some(effects) = self.extras.optional("effects") {
            let effects = Object::read(effects.clone())?;
            for (_, value) in effects.0 {
                if !matches!(value, MessageData::Num(_)) {
                    return Err(Error::Shape("effects"));
                }
            }
        }
        if let Some(fields) = self.extras.optional("fields") {
            let MessageData::Arr(fields) = fields else {
                return Err(Error::Shape("fields"));
            };
            for field in fields {
                let field = Object::read(field.clone())?;
                field.string("kind")?;
                field.at()?;
                field.number("x2")?;
                field.number("y2")?;
                field.number("r")?;
                field.nullable_string("owner")?;
            }
        }
        Ok(())
    }
}
fn read_rows<T>(
    record: &Object,
    key: &'static str,
    read: impl Fn(Object) -> Result<T, Error>,
) -> Result<Vec<T>, Error> {
    record
        .array(key)?
        .iter()
        .map(|value| read(Object::read(value.clone())?))
        .collect()
}

/// Public static collision inputs, both supplied explicitly. No World lookup and
/// no fallback that treats unavailable gate geometry as an open map.
pub(crate) struct Maps {
    pub(crate) open: TileMap,
    pub(crate) locked: TileMap,
}
pub(crate) struct Compose<'a> {
    pub(crate) self_delay_ms: f64,
    pub(crate) world_delay_ms: f64,
    pub(crate) attention_central: f64,
    pub(crate) maps: &'a Maps,
    pub(crate) features: &'a Features,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Percept {
    pub(crate) now: f64,
    pub(crate) view_time: f64,
    pub(crate) owner: Object,
    pub(crate) hud: Object,
    pub(crate) fighters: Vec<Object>,
    pub(crate) mobs: Vec<Object>,
    pub(crate) containers: Vec<Object>,
    pub(crate) projectiles: Vec<MessageData>,
    pub(crate) minimap: MessageData,
    pub(crate) events: Vec<Object>,
    pub(crate) extras: Object,
    pub(crate) features: Features,
}
impl Percept {
    pub(crate) fn data(&self) -> MessageData {
        let rows = |rows: &[Object]| MessageData::Arr(rows.iter().map(Object::data).collect());
        object([
            ("now", num(self.now)),
            ("viewT", num(self.view_time)),
            ("self", self.owner.data()),
            ("hud", self.hud.data()),
            ("fighters", rows(&self.fighters)),
            ("mobs", rows(&self.mobs)),
            ("containers", rows(&self.containers)),
            ("projectiles", MessageData::Arr(self.projectiles.clone())),
            ("minimap", self.minimap.clone()),
            ("events", rows(&self.events)),
            ("extras", self.extras.data()),
            ("features", features_data(&self.features)),
        ])
    }
    pub(crate) fn validate(&self) -> Result<(), Error> {
        finite(&self.data())
    }
}

fn features_data(f: &Features) -> MessageData {
    let bit = MessageData::Bool;
    object([
        (
            "messageTypes",
            MessageData::Arr(f.message_types.iter().map(|s| text(s)).collect()),
        ),
        ("wishes", bit(f.wishes)),
        ("statusEffects", bit(f.status_effects)),
        ("fields", bit(f.fields)),
        ("planning", bit(f.planning)),
        ("chests", bit(f.chests)),
        ("skills", bit(f.skills)),
        ("relics", bit(f.relics)),
        ("camps", bit(f.camps)),
        ("hazards", bit(f.hazards)),
    ])
}
