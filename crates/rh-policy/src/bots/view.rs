//! The first half of the full fair client-percept model (source brain/perception.ts): the window tests, the JSON-safe
//! message copy, and the room feature detection every fair-view consumer gates itself on. The perceive() constructor itself
//! (self/fighter/mob/container/camp/field/minimap views, fx decoding and the event stream) is the next slice: it needs the
//! fair Observation to carry client-level leaves it does not have yet, so this file lands the pieces that are pure, exported
//! by the source and verifiable value-for-value today.
use rh_sim::Vec2;

/// The source's client message set (shared/messages.ts CLIENT_MESSAGE_TYPES), in order.
pub const CLIENT_MESSAGE_TYPES: [&str; 19] = [
    "move",
    "stop",
    "target",
    "aim",
    "attack",
    "release",
    "swap",
    "pickup",
    "plan",
    "cast",
    "choose",
    "train",
    "questAccept",
    "attackMove",
    "consumeCorpse",
    "huntTarget",
    "useConsumable",
    "trade",
    "beat",
];

/// The floor-hazard terrain codes (shared/terrain.ts TERRAIN_EMBER..TERRAIN_LIGHT; the same 4..7 the sim's surface reads).
const TERRAIN_EMBER: u8 = 4;
const TERRAIN_LIGHT: u8 = 7;

/// A JSON-like value for message/probe data: the source's plainCopy world without a serialization dependency.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum MessageData {
    #[default]
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<MessageData>),
    Obj(Vec<(String, MessageData)>),
}
impl MessageData {
    /// The object member under key (the source reads presence from the instance).
    pub fn get(&self, key: &str) -> Option<&MessageData> {
        match self {
            MessageData::Obj(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }
}

/// What a room and branch can do (types.ts Features), by runtime presence only.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Features {
    pub message_types: Vec<String>,
    pub wishes: bool,
    pub status_effects: bool,
    pub fields: bool,
    pub planning: bool,
    pub chests: bool,
    pub skills: bool,
    pub relics: bool,
    pub camps: bool,
    pub hazards: bool,
}

/// What detect_features inspects: declared instances, never classes.
#[derive(Clone, Debug, Default)]
pub struct FeatureProbe {
    pub state: MessageData,
    pub player: Option<MessageData>,
    pub map_terrain: Option<Vec<u8>>,
    pub map_hazards: bool,
    pub message_types: Option<Vec<String>>,
}
/// The source's shared ABILITIES export exists in every build this policy targets, so its presence probe is true.
const ABILITIES_EXPORTED: bool = true;
/// Source skillSlotsFilled: does any faction have an ability in Q or E? shared abilityInSlot answers null for both.
fn skill_slots_filled() -> bool {
    rh_sim::FactionId::ALL.into_iter().any(|f| {
        rh_sim::abilities::ability_in_slot(rh_sim::abilities::Slot::Q, f).is_some()
            || rh_sim::abilities::ability_in_slot(rh_sim::abilities::Slot::E, f).is_some()
    })
}
/// shared/terrain.ts hasFloorHazard: any ember, bog, ice or light tile.
fn has_floor_hazard(terrain: &[u8]) -> bool {
    terrain
        .iter()
        .any(|t| (TERRAIN_EMBER..=TERRAIN_LIGHT).contains(t))
}
/// Source detectFeatures(probe): the runtime-presence feature flags the fair-view consumers gate on.
pub fn detect_features(probe: &FeatureProbe) -> Features {
    let types: Vec<String> = probe.message_types.clone().unwrap_or_else(|| {
        CLIENT_MESSAGE_TYPES
            .iter()
            .map(|t| (*t).to_string())
            .collect()
    });
    let accepts = |t: &str| types.iter().any(|x| x == t);
    // Source firstPlayer: the state's first player when no player instance was handed in.
    let first_player = probe
        .state
        .get("players")
        .and_then(|players| match players {
            MessageData::Obj(members) => members.first().map(|(_, p)| p),
            _ => None,
        });
    // Source probe.player ?? firstPlayer(probe.state): an explicit null player is missing, not an instance.
    let player = probe
        .player
        .as_ref()
        .filter(|player| !matches!(player, MessageData::Null))
        .or(first_player);
    let has = |o: Option<&MessageData>, key: &str| o.is_some_and(|o| o.has(key));
    let hazards = probe.map_terrain.as_deref().is_some_and(has_floor_hazard) || probe.map_hazards;
    Features {
        wishes: accepts("cast") && has(player, "wishReadyAt") && ABILITIES_EXPORTED,
        status_effects: has(player, "effects"),
        fields: probe.state.has("fields"),
        planning: accepts("plan"),
        chests: accepts("choose"),
        skills: accepts("cast")
            && has(player, "qReadyAt")
            && has(player, "eReadyAt")
            && skill_slots_filled(),
        relics: has(player, "build"),
        camps: probe.state.has("camps"),
        hazards,
        message_types: types,
    }
}
/// Source inView: inside the window (plus pad) centred on (cx, cy).
pub fn in_view(cx: f64, cy: f64, x: f64, y: f64, pad: f64) -> bool {
    (x - cx).abs() <= crate::bots::types::BOT_VIEW_HALF_W + pad
        && (y - cy).abs() <= crate::bots::types::BOT_VIEW_HALF_H + pad
}
#[derive(Clone, Debug, PartialEq)]
pub struct FieldInView {
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub x2: f64,
    pub y2: f64,
    pub r: f64,
}
/// Source fieldInView: does the field touch the window (plus pad)? A trail is its segment, anything else its disc.
pub fn field_in_view(cx: f64, cy: f64, f: &FieldInView, pad: f64) -> bool {
    let line = f.kind == "trail";
    let x0 = if line { f64::min(f.x, f.x2) } else { f.x };
    let x1 = if line { f64::max(f.x, f.x2) } else { f.x };
    let y0 = if line { f64::min(f.y, f.y2) } else { f.y };
    let y1 = if line { f64::max(f.y, f.y2) } else { f.y };
    let w = crate::bots::types::BOT_VIEW_HALF_W + pad + f.r;
    let h = crate::bots::types::BOT_VIEW_HALF_H + pad + f.r;
    x1 >= cx - w && x0 <= cx + w && y1 >= cy - h && y0 <= cy + h
}
/// Source plainCopy: a JSON-like deep copy of message data (arrays copy, object keys whose value copies to nothing drop,
/// depth beyond 8 drops).
pub fn plain_copy(v: &MessageData) -> Option<MessageData> {
    copy_at(v, 0)
}
fn copy_at(v: &MessageData, depth: usize) -> Option<MessageData> {
    match v {
        MessageData::Null | MessageData::Bool(_) | MessageData::Num(_) | MessageData::Str(_) => {
            Some(v.clone())
        }
        MessageData::Arr(items) => {
            if depth > 8 {
                return None;
            }
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(copy_at(item, depth + 1).unwrap_or(MessageData::Null));
            }
            Some(MessageData::Arr(out))
        }
        MessageData::Obj(members) => {
            if depth > 8 {
                return None;
            }
            let mut out = Vec::with_capacity(members.len());
            for (key, value) in members {
                if let Some(copied) = copy_at(value, depth + 1) {
                    out.push((key.clone(), copied));
                }
            }
            Some(MessageData::Obj(out))
        }
    }
}
/// World-space helper on the public Vec2 type keeps call sites plain.
pub fn in_view_at(c: Vec2, at: Vec2, pad: f64) -> bool {
    in_view(c.x, c.y, at.x, at.y, pad)
}
