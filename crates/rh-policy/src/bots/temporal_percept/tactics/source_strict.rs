//! Strict envelope / finite / consumed-field validation for the frozen private-tactics declared-method witness.
//!
//! This is the native reader of the same corpus that `tools/bot-private-tactics-fixtures/verify.mjs` reads: the source
//! author's strict reader is the specification, so this module mirrors its validation clauses (closed tagged values,
//! duplicate collection members, primitive Map keys, closed case/operation/declaration envelopes, finite declared inputs,
//! closed consumed facts, transcript/draw-count/callback shapes) and additionally closes the declared source GameMap,
//! the resolved config, the declared Percept and every expected-output channel over the fields the replay consumes.
//! Test-only: the corpus is an offline declared witness, not a public intake path.

use serde_json::Value;

use super::source_reader::{self, SVal};

type R<T> = Result<T, String>;

const FORMAT: &str = "rh-bot-private-tactics-source/1";
const METHOD_VALUE: &str = "rh-method-value/1";

const PROFILE_KEYS: &[&str] = &[
    "sourceBase",
    "boundary",
    "image",
    "node",
    "platform",
    "arch",
    "random",
    "path",
    "actualRuntimeImports",
    "sourceInventory",
    "sourceInventorySha256",
    "configFiles",
    "compatibilityCorpora",
    "dependencyVersions",
    "toolFiles",
];
const PROFILE_STRING_KEYS: &[&str] = &[
    "sourceBase",
    "boundary",
    "image",
    "node",
    "platform",
    "arch",
    "random",
    "path",
    "sourceInventorySha256",
];
const PROFILE_OBJECT_KEYS: &[&str] = &[
    "actualRuntimeImports",
    "sourceInventory",
    "configFiles",
    "compatibilityCorpora",
    "dependencyVersions",
    "toolFiles",
];
const PROFILE_INVENTORY_KEYS: &[&str] = &[
    "actualRuntimeImports",
    "sourceInventory",
    "configFiles",
    "compatibilityCorpora",
    "toolFiles",
];

const EXPECTED_MAPS: &[&str] = &["open", "wall", "fence", "detour", "generated7"];
const GAME_MAP_KEYS: &[&str] = &[
    "seed",
    "w",
    "h",
    "tiles",
    "terrain",
    "props",
    "attempt",
    "territoryGrid",
    "regionGrid",
    "coliseum",
    "regions",
    "camps",
    "spawnPool",
    "buildings",
    "spawns",
    "crateSpots",
    "groundSpots",
    "features",
    "featureGrid",
];
const GAME_MAP_GRID_KEYS: &[&str] = &[
    "tiles",
    "terrain",
    "territoryGrid",
    "regionGrid",
    "featureGrid",
];
const GAME_MAP_ARRAY_KEYS: &[&str] = &[
    "props",
    "regions",
    "camps",
    "spawnPool",
    "buildings",
    "spawns",
    "crateSpots",
    "groundSpots",
    "features",
];

const CASE_KEYS: &[&str] = &[
    "id",
    "suite",
    "covers",
    "config",
    "initial",
    "setupTranscript",
    "operations",
];

const CONFIG_REQUIRED: &[&str] = &[
    "tier",
    "persona",
    "seed",
    "id",
    "name",
    "features",
    "pathBudget",
    "modules",
    "learned",
    "tierValues",
    "personaValues",
    "map",
    "seeds",
];
const CONFIG_OPTIONAL: &[&str] = &["tierOverrides", "personaOverrides", "path"];

const FEATURE_KEYS: &[&str] = &[
    "messageTypes",
    "wishes",
    "statusEffects",
    "fields",
    "planning",
    "chests",
    "skills",
    "relics",
    "camps",
    "hazards",
];
const FEATURE_BOOL_KEYS: &[&str] = &[
    "wishes",
    "statusEffects",
    "fields",
    "planning",
    "chests",
    "skills",
    "relics",
    "camps",
    "hazards",
];
const CLIENT_MESSAGE_TYPES: &[&str] = &[
    "move",
    "stop",
    "target",
    "attack",
    "release",
    "swap",
    "pickup",
    "cast",
    "plan",
    "choose",
    "useConsumable",
];

const TIERS: &[&str] = &["easy", "normal", "hard"];
const PERSONAS: &[&str] = &["farmer", "hunter", "opportunist", "cautious"];

const TIER_VALUES_KEYS: &[&str] = &[
    "id",
    "reaction",
    "step",
    "daze",
    "refractoryMs",
    "thinkMs",
    "strategyMs",
    "apm",
    "burst",
    "minGapMs",
    "moveScatter",
    "targetScatter",
    "minimapSigma",
    "edgeClickP",
    "timingSigmaMs",
    "hesitation",
    "softmaxT",
    "lapseP",
    "dodgeP",
    "jukeP",
    "orbwalk",
    "knowledge",
    "mobShareNoise",
    "route",
    "attention",
    "memorySpanMs",
    "feintRead",
    "appraisal",
    "wary",
    "caution",
];
const EX_GAUSSIAN_KEYS: &[&str] = &["mu", "sigma", "tau", "floor", "cap"];
const TIER_VALUES_SCALARS: &[&str] = &[
    "refractoryMs",
    "apm",
    "burst",
    "minGapMs",
    "minimapSigma",
    "edgeClickP",
    "timingSigmaMs",
    "softmaxT",
    "lapseP",
    "dodgeP",
    "jukeP",
    "knowledge",
    "mobShareNoise",
    "memorySpanMs",
    "feintRead",
    "wary",
];
const THINK_KEYS: &[&str] = &["mean", "jitter"];
const MOVE_SCATTER_KEYS: &[&str] = &["base", "perUnit"];
const TARGET_SCATTER_KEYS: &[&str] = &["sigma", "lagS", "slipP", "slipMult"];
const HESITATION_KEYS: &[&str] = &["p", "minMs", "maxMs"];
const ORBWALK_KEYS: &[&str] = &["p", "stepU", "angleJitter"];
const ROUTE_KEYS: &[&str] = &["horizon", "walkPaths", "reach"];
const ATTENTION_KEYS: &[&str] = &["central", "peripheryMult", "engagedMult", "reconsiderMs"];
const APPRAISAL_KEYS: &[&str] = &["bias", "lead", "busy", "hue", "noise"];
const CAUTION_KEYS: &[&str] = &["mobShare", "eliteShare", "startHp"];

const PERSONA_VALUES_KEYS: &[&str] = &[
    "id",
    "pve",
    "pvp",
    "loot",
    "bounty",
    "thirdParty",
    "engageEdge",
    "bountyCaution",
    "fleeHp",
    "reengageHp",
    "kite",
    "chaseGiveUpMs",
    "mobKillGoal",
    "playerThreat",
    "eliteAppetite",
    "coliseum",
    "risk",
];
const TIER_OVERRIDE_KEYS: &[&str] = &[
    "dodgeP",
    "jukeP",
    "feintRead",
    "knowledge",
    "orbwalk",
    "step",
    "reaction",
];
const PERSONA_OVERRIDE_KEYS: &[&str] = &[
    "kite",
    "coliseum",
    "pve",
    "pvp",
    "loot",
    "bounty",
    "thirdParty",
    "engageEdge",
    "bountyCaution",
    "fleeHp",
    "reengageHp",
    "chaseGiveUpMs",
    "mobKillGoal",
    "playerThreat",
    "eliteAppetite",
    "risk",
];

const SEED_KEYS: &[&str] = &["decide", "motor", "lapse", "knowledge"];

const INITIAL_KEYS: &[&str] = &["memory", "stats"];
const MEMORY_KEYS: &[&str] = &[
    "fighters",
    "mobs",
    "camps",
    "containers",
    "self",
    "stimuli",
    "bounties",
    "choices",
];
const MEMORY_MAP_KEYS: &[&str] = &["fighters", "mobs", "camps", "containers", "bounties"];

const SUITES: &[&str] = &["tactics", "fight", "world", "orb", "reflex", "retreat"];
const METHODS: &[&str] = &[
    "observe",
    "act",
    "noteSent",
    "recordChoice",
    "step",
    "reset",
    "point",
    "check",
    "leave",
    "pickHoldSpot",
    "inReach",
];
const GOALS: &[&str] = &[
    "idle", "farm", "hunt", "fight", "loot", "flee", "roam", "hold", "module",
];
const FIGHT_GOALS: &[&str] = &["farm", "hunt", "fight"];
const STATUSES: &[&str] = &["alive", "dead", "mia"];
const FACTIONS: &[&str] = &["fire", "sentenced", "plague", "frost", "holy"];
const WEAPONS: &[&str] = &["sword", "axe", "shield", "bow", "wand", "fists"];
const MOB_KINDS: &[&str] = &["mob", "elite", "dummy", "npc"];
const PROJECTILE_KINDS: &[&str] = &["ball", "arrow"];
const INTENT_KINDS: &[&str] = &[
    "lock", "move", "stop", "swap", "pickup", "cast", "plan", "choose",
];
const GOAL_STATES: &[&str] = &["running", "done", "failed", "blocked"];
const STREAMS: &[&str] = &["decide", "motor", "lapse", "knowledge"];
const CALLBACK_NAMES: &[&str] = &[
    "paths.setFrame",
    "paths.clear",
    "paths.collisionMap",
    "paths.walk",
    "paths.los",
    "paths.path",
    "knowledge.weaponEdge",
    "memory.whereabouts",
];

const PERCEPT_KEYS: &[&str] = &[
    "now",
    "viewT",
    "self",
    "hud",
    "fighters",
    "mobs",
    "containers",
    "projectiles",
    "minimap",
    "events",
    "extras",
    "features",
];
const SELF_REQUIRED: &[&str] = &[
    "id",
    "name",
    "x",
    "y",
    "facing",
    "status",
    "hp",
    "maxHp",
    "barrier",
    "faction",
    "weapons",
    "slot",
    "attackTarget",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "speedMult",
    "kills",
    "mobKills",
    "gv",
    "bounty",
    "moveSeq",
];
const SELF_NUMBERS: &[&str] = &[
    "facing",
    "hp",
    "maxHp",
    "barrier",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "speedMult",
    "kills",
    "mobKills",
    "gv",
    "bounty",
    "moveSeq",
];
const HUD_KEYS: &[&str] = &[
    "phase",
    "training",
    "lobbyEndsAt",
    "raidStartedAt",
    "patienceEndsAt",
    "suddenDeathAt",
    "inColiseum",
    "gatesLocked",
    "startedWith",
    "alive",
    "playerCount",
    "minPlayers",
    "winner",
];
const HUD_NUMBERS: &[&str] = &[
    "lobbyEndsAt",
    "raidStartedAt",
    "patienceEndsAt",
    "suddenDeathAt",
    "startedWith",
    "alive",
    "playerCount",
    "minPlayers",
];
const FIGHTER_KEYS: &[&str] = &[
    "id",
    "name",
    "bot",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "barrierFrac",
    "faction",
    "inHand",
    "drawStartedAt",
    "bounty",
    "immune",
    "sig",
    "brand",
    "targetable",
    "vx",
    "vy",
    "dist",
    "los",
    "tint",
    "central",
];
const FIGHTER_NUMBERS: &[&str] = &[
    "facing",
    "hpFrac",
    "barrierFrac",
    "bounty",
    "drawStartedAt",
    "sig",
    "brand",
    "vx",
    "vy",
    "dist",
    "tint",
];
const MOB_KEYS: &[&str] = &[
    "id",
    "kind",
    "name",
    "type",
    "faction",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "inHand",
    "drawStartedAt",
    "sig",
    "brand",
    "vx",
    "vy",
    "dist",
    "los",
    "central",
];
const MOB_NUMBERS: &[&str] = &[
    "facing",
    "hpFrac",
    "drawStartedAt",
    "sig",
    "brand",
    "vx",
    "vy",
    "dist",
];
const CONTAINER_KEYS: &[&str] = &[
    "id",
    "kind",
    "x",
    "y",
    "label",
    "closed",
    "weapon",
    "interactable",
    "dist",
];
const PROJECTILE_KEYS: &[&str] = &[
    "id", "kind", "x", "y", "vx", "vy", "x0", "y0", "t0", "range", "from",
];
const PROJECTILE_NUMBERS: &[&str] = &["vx", "vy", "x0", "y0", "t0", "range"];
const MINIMAP_KEYS: &[&str] = &["t", "mobs", "gatesLocked"];
const MINIMAP_MOB_KEYS: &[&str] = &["id", "x", "y", "faction", "elite"];

const EVENT_KINDS: &[&str] = &[
    "windup", "swing", "hit", "block", "stagger", "cancel", "projEnd", "death", "heal", "teleport",
    "bounty", "victory", "toast", "result", "private", "ext",
];
const EVENT_BASE_KEYS: &[&str] = &["kind", "t", "at"];
const EVENT_OPTIONAL_KEYS: &[&str] = &["id", "by", "weapon", "amount", "bounty", "a", "ms"];
const EVENT_NUMBER_KEYS: &[&str] = &["amount", "bounty", "a", "ms"];

const OP_KEYS: &[&str] = &[
    "method",
    "declaration",
    "result",
    "memory",
    "stats",
    "callbacks",
    "drawCounts",
    "pathStats",
];

const TACTICS_STATS_KEYS: &[&str] = &["dodges", "jukes", "kiteCycles", "retreats", "mobTargets"];
const FIGHT_STATS_KEYS: &[&str] = &["mobTargets", "cycles", "holdUntil", "dodges", "jukes"];
const REFLEX_STATS_KEYS: &[&str] = &["holdUntil", "dodges", "jukes"];

fn err(path: &str, message: impl Into<String>) -> String {
    format!("{path}: {}", message.into())
}

fn describe(value: &SVal) -> &'static str {
    match value {
        SVal::Undefined => "undefined",
        SVal::Null => "null",
        SVal::Bool(_) => "boolean",
        SVal::Num(_) => "number",
        SVal::Str(_) => "string",
        SVal::Arr(_) => "array",
        SVal::Map(_) => "map",
        SVal::Set(_) => "set",
        SVal::Obj(_) => "object",
        SVal::U8(_) => "u8 bytes",
        SVal::Instance { .. } => "instance",
        SVal::Callable => "callable",
    }
}

// ---------------------------------------------------------------------------
// Tagged SVal field access / shape helpers
// ---------------------------------------------------------------------------

fn as_entries<'a>(value: &'a SVal, path: &str) -> R<&'a [(String, SVal)]> {
    match value {
        SVal::Obj(entries) => Ok(entries),
        other => Err(err(
            path,
            format!("expected a tagged object, got {}", describe(other)),
        )),
    }
}

fn find<'a>(entries: &'a [(String, SVal)], name: &str, path: &str) -> R<&'a SVal> {
    entries
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
        .ok_or_else(|| err(path, format!("missing consumed field {name}")))
}

fn maybe<'a>(entries: &'a [(String, SVal)], name: &str) -> Option<&'a SVal> {
    entries.iter().find(|(key, _)| key == name).map(|(_, v)| v)
}

fn only(entries: &[(String, SVal)], required: &[&str], optional: &[&str], path: &str) -> R<()> {
    for (key, _) in entries {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            return Err(err(path, format!("unexpected field {key}")));
        }
    }
    for key in required {
        if !entries.iter().any(|(present, _)| present == key) {
            return Err(err(path, format!("missing required field {key}")));
        }
    }
    Ok(())
}

fn object_closed<'a>(
    value: &'a SVal,
    required: &[&str],
    optional: &[&str],
    path: &str,
) -> R<&'a [(String, SVal)]> {
    let entries = as_entries(value, path)?;
    only(entries, required, optional, path)?;
    Ok(entries)
}

fn expect_str<'a>(value: &'a SVal, path: &str) -> R<&'a str> {
    match value {
        SVal::Str(text) => Ok(text),
        other => Err(err(
            path,
            format!("expected a string, got {}", describe(other)),
        )),
    }
}

fn expect_bool(value: &SVal, path: &str) -> R<bool> {
    match value {
        SVal::Bool(flag) => Ok(*flag),
        other => Err(err(
            path,
            format!("expected a boolean, got {}", describe(other)),
        )),
    }
}

fn expect_num(value: &SVal, path: &str) -> R<f64> {
    match value {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(err(
            path,
            format!("expected a finite number, got {}", describe(other)),
        )),
    }
}

fn expect_integral(value: &SVal, path: &str) -> R<f64> {
    let number = expect_num(value, path)?;
    if number.fract() != 0.0 {
        return Err(err(
            path,
            format!("expected an integral number, got {number}"),
        ));
    }
    Ok(number)
}

fn expect_uint32(value: &SVal, path: &str) -> R<u64> {
    let number = expect_integral(value, path)?;
    if number < 0.0 || number > f64::from(u32::MAX) {
        return Err(err(
            path,
            format!("expected a non-negative u32 integer, got {number}"),
        ));
    }
    Ok(number as u64)
}

fn expect_array<'a>(value: &'a SVal, path: &str) -> R<&'a [SVal]> {
    match value {
        SVal::Arr(values) => Ok(values),
        other => Err(err(
            path,
            format!("expected a tagged array, got {}", describe(other)),
        )),
    }
}

fn expect_u8<'a>(value: &'a SVal, path: &str) -> R<&'a [u8]> {
    match value {
        SVal::U8(values) => Ok(values),
        other => Err(err(
            path,
            format!("expected u8 bytes, got {}", describe(other)),
        )),
    }
}

fn one_of<'a>(value: &'a SVal, allowed: &[&str], label: &str, path: &str) -> R<&'a str> {
    let text = expect_str(value, path)?;
    if !allowed.contains(&text) {
        return Err(err(path, format!("unsupported {label}: {text}")));
    }
    Ok(text)
}

fn nullable_one_of(value: &SVal, allowed: &[&str], label: &str, path: &str) -> R<()> {
    match value {
        SVal::Null => Ok(()),
        _ => one_of(value, allowed, label, path).map(|_| ()),
    }
}

fn expect_weapon(value: &SVal, path: &str) -> R<()> {
    nullable_one_of(value, WEAPONS, "weapon", path)
}

fn expect_faction(value: &SVal, path: &str) -> R<()> {
    nullable_one_of(value, FACTIONS, "faction", path)
}

fn expect_nullable_str(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Null | SVal::Str(_) => Ok(()),
        other => Err(err(
            path,
            format!("expected null or string, got {}", describe(other)),
        )),
    }
}

/// Any decoded non-null source object/map/array: the `typeof value === 'object'` places in the source reader.
fn expect_objectish(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Obj(_) | SVal::Map(_) | SVal::Arr(_) => Ok(()),
        other => Err(err(
            path,
            format!("expected an encoded object, got {}", describe(other)),
        )),
    }
}

fn expect_vec(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    expect_num(find(entries, "x", path)?, &format!("{path}.x"))?;
    expect_num(find(entries, "y", path)?, &format!("{path}.y"))?;
    Ok(())
}

fn expect_optional_vec(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Null => Ok(()),
        _ => expect_vec(value, path),
    }
}

// ---------------------------------------------------------------------------
// Plain JSON (outer envelope) helpers
// ---------------------------------------------------------------------------

fn json_object<'a>(value: &'a Value, path: &str) -> R<&'a serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| err(path, "expected a plain JSON object"))
}

fn json_array<'a>(value: &'a Value, path: &str) -> R<&'a Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| err(path, "expected a plain JSON array"))
}

fn json_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
    path: &str,
) -> R<&'a Value> {
    object
        .get(key)
        .ok_or_else(|| err(path, format!("missing field {key}")))
}

fn json_string<'a>(value: &'a Value, path: &str) -> R<&'a str> {
    value
        .as_str()
        .ok_or_else(|| err(path, "expected a JSON string"))
}

fn closed_plain(
    object: &serde_json::Map<String, Value>,
    required: &[&str],
    optional: &[&str],
    path: &str,
) -> R<()> {
    for key in object.keys() {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            return Err(err(path, format!("unexpected field {key}")));
        }
    }
    for key in required {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing required field {key}")));
        }
    }
    Ok(())
}

fn json_format_equals(
    object: &serde_json::Map<String, Value>,
    key: &str,
    expected: &str,
    path: &str,
) -> R<()> {
    let actual = json_string(json_field(object, key, path)?, path)?;
    if actual != expected {
        return Err(err(path, format!("expected {expected:?}, got {actual:?}")));
    }
    Ok(())
}

fn is_lowercase_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

// ---------------------------------------------------------------------------
// Strict tagged-value decode (source_reader::parse plus the verify.mjs clauses)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Declared inputs: no instance/callable/hole diagnostic tags.
    Input,
    /// Expected-output diagnostics: Undefined/Null/instance-free tags stay decodable, numbers stay finite.
    Diagnostic,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UndefinedRule {
    Reject,
    Allow,
    /// Declarations: Undefined only at the two recorded corpus positions (self.windupMult, containers[].weapon).
    Declaration,
}

fn undefined_declared(value: &str) -> bool {
    value.ends_with(".self.windupMult")
        || (value.contains(".containers[") && value.ends_with("].weapon"))
}

fn same_value_zero(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Num(x), SVal::Num(y)) => {
            x.to_bits() == y.to_bits() || x == y || (x.is_nan() && y.is_nan())
        }
        _ => source_reader::same(a, b),
    }
}

fn primitive_map_key(value: &SVal) -> bool {
    matches!(
        value,
        SVal::Null | SVal::Undefined | SVal::Bool(_) | SVal::Num(_) | SVal::Str(_)
    )
}

fn decode(value: &Value, path: &str, mode: Mode, undefined: UndefinedRule) -> R<SVal> {
    let parsed = source_reader::parse(value, path)?;
    walk_value(&parsed, path, mode, undefined)?;
    Ok(parsed)
}

fn walk_value(value: &SVal, path: &str, mode: Mode, undefined: UndefinedRule) -> R<()> {
    match value {
        SVal::Undefined => match undefined {
            UndefinedRule::Reject => {
                Err(err(path, "unexpected tagged Undefined in a declared value"))
            }
            UndefinedRule::Allow => Ok(()),
            UndefinedRule::Declaration => {
                if undefined_declared(path) {
                    Ok(())
                } else {
                    Err(err(
                        path,
                        "tagged Undefined is only recorded at self.windupMult and containers[].weapon",
                    ))
                }
            }
        },
        SVal::Null | SVal::Bool(_) | SVal::Str(_) | SVal::U8(_) => Ok(()),
        SVal::Num(number) => {
            if number.is_finite() {
                Ok(())
            } else {
                Err(err(path, "non-finite tagged number"))
            }
        }
        SVal::Callable => match mode {
            Mode::Input => Err(err(
                path,
                "declared input must not carry a callable diagnostic tag",
            )),
            Mode::Diagnostic => Ok(()),
        },
        SVal::Instance { name, entries } => {
            if mode == Mode::Input {
                Err(err(path, "declared input must not carry an instance tag"))
            } else if name.is_empty() {
                Err(err(path, "instance tag name must be a non-empty string"))
            } else {
                for (key, entry) in entries {
                    walk_value(entry, &format!("{path}.{key}"), mode, undefined)?;
                }
                Ok(())
            }
        }
        SVal::Arr(values) => {
            for (index, entry) in values.iter().enumerate() {
                walk_value(entry, &format!("{path}[{index}]"), mode, undefined)?;
            }
            Ok(())
        }
        SVal::Set(values) => {
            for (index, entry) in values.iter().enumerate() {
                walk_value(entry, &format!("{path}[{index}]"), mode, undefined)?;
                if values[..index]
                    .iter()
                    .any(|seen| same_value_zero(seen, entry))
                {
                    return Err(err(
                        &format!("{path}[{index}]"),
                        "duplicate Set member (SameValueZero)",
                    ));
                }
            }
            Ok(())
        }
        SVal::Map(entries) => {
            for (index, (key, entry)) in entries.iter().enumerate() {
                let key_path = format!("{path}.entries[{index}].key");
                if !primitive_map_key(key) {
                    return Err(err(
                        &key_path,
                        "fixture Map keys must be primitive (null|undefined|string|number|boolean)",
                    ));
                }
                if entries[..index]
                    .iter()
                    .any(|(seen, _)| same_value_zero(seen, key))
                {
                    return Err(err(
                        &format!("{path}.entries[{index}]"),
                        "duplicate Map key (SameValueZero)",
                    ));
                }
                walk_value(key, &key_path, mode, undefined)?;
                walk_value(
                    entry,
                    &format!("{path}.entries[{index}].value"),
                    mode,
                    undefined,
                )?;
            }
            Ok(())
        }
        SVal::Obj(entries) => {
            for (key, entry) in entries {
                walk_value(entry, &format!("{path}.{key}"), mode, undefined)?;
            }
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Corpus entry point
// ---------------------------------------------------------------------------

pub(crate) fn validate_corpus(source: &Value) -> R<()> {
    let top = json_object(source, "source")?;
    closed_plain(
        top,
        &["cases", "format", "maps", "methodValue", "profile"],
        &[],
        "source",
    )?;
    json_format_equals(top, "format", FORMAT, "source.format")?;
    json_format_equals(top, "methodValue", METHOD_VALUE, "source.methodValue")?;
    validate_profile(json_field(top, "profile", "source")?, "source.profile")?;
    let map_ids = validate_maps(json_field(top, "maps", "source")?, "source.maps")?;
    validate_cases(
        json_field(top, "cases", "source")?,
        &map_ids,
        "source.cases",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Profile envelope
// ---------------------------------------------------------------------------

fn validate_profile(value: &Value, path: &str) -> R<()> {
    let profile = json_object(value, path)?;
    closed_plain(profile, PROFILE_KEYS, &[], path)?;
    for key in PROFILE_STRING_KEYS {
        let field_path = format!("{path}.{key}");
        let text = json_string(json_field(profile, key, path)?, &field_path)?;
        if text.is_empty() {
            return Err(err(&field_path, "profile strings must not be empty"));
        }
    }
    let sha = json_string(
        json_field(profile, "sourceInventorySha256", path)?,
        &format!("{path}.sourceInventorySha256"),
    )?;
    if !is_lowercase_hex(sha, 64) {
        return Err(err(
            &format!("{path}.sourceInventorySha256"),
            "expected 64 lowercase hex digits",
        ));
    }
    for key in PROFILE_OBJECT_KEYS {
        if !json_field(profile, key, path)?.is_object() {
            return Err(err(&format!("{path}.{key}"), "expected a JSON object"));
        }
    }
    json_format_equals(profile, "node", "v22.23.4", &format!("{path}.node"))?;
    json_format_equals(profile, "platform", "linux", &format!("{path}.platform"))?;
    json_format_equals(profile, "arch", "x64", &format!("{path}.arch"))?;
    for key in PROFILE_INVENTORY_KEYS {
        let inventory = json_object(json_field(profile, key, path)?, &format!("{path}.{key}"))?;
        if inventory.is_empty() {
            return Err(err(
                &format!("{path}.{key}"),
                "expected a non-empty inventory",
            ));
        }
        for (name, entry) in inventory {
            let entry_path = format!("{path}.{key}.{name}");
            let entry = json_object(entry, &entry_path)?;
            closed_plain(entry, &["bytes", "sha256"], &[], &entry_path)?;
            let bytes = json_field(entry, "bytes", &entry_path)?;
            if bytes.as_u64().is_none() {
                return Err(err(
                    &format!("{entry_path}.bytes"),
                    "expected a non-negative integer byte count",
                ));
            }
            let digest = json_string(
                json_field(entry, "sha256", &entry_path)?,
                &format!("{entry_path}.sha256"),
            )?;
            if !is_lowercase_hex(digest, 64) {
                return Err(err(
                    &format!("{entry_path}.sha256"),
                    "expected 64 lowercase hex digits",
                ));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Declared maps
// ---------------------------------------------------------------------------

fn validate_maps(value: &Value, path: &str) -> R<Vec<String>> {
    let maps = json_array(value, path)?;
    let mut ids: Vec<String> = Vec::new();
    for (index, map) in maps.iter().enumerate() {
        let map_path = format!("{path}[{index}]");
        let object = json_object(map, &map_path)?;
        closed_plain(object, &["id", "mapHashU32", "value"], &[], &map_path)?;
        let id = json_string(
            json_field(object, "id", &map_path)?,
            &format!("{map_path}.id"),
        )?;
        if id.is_empty() {
            return Err(err(&format!("{map_path}.id"), "map ids must not be empty"));
        }
        if ids.iter().any(|seen| seen == id) {
            return Err(err(&map_path, format!("duplicate map id {id}")));
        }
        let hash = json_field(object, "mapHashU32", &map_path)?;
        if hash.as_u64().is_none_or(|hash| hash > u64::from(u32::MAX)) {
            return Err(err(
                &format!("{map_path}.mapHashU32"),
                "expected an integral u32 map hash",
            ));
        }
        let decoded = decode(
            json_field(object, "value", &map_path)?,
            &format!("{map_path}.value"),
            Mode::Input,
            UndefinedRule::Reject,
        )?;
        validate_game_map(&decoded, &format!("{map_path}.value"))?;
        ids.push(id.to_string());
    }
    if ids.len() != EXPECTED_MAPS.len() {
        return Err(err(
            path,
            format!(
                "expected exactly {} maps {:?}, got {}",
                EXPECTED_MAPS.len(),
                EXPECTED_MAPS,
                ids.len()
            ),
        ));
    }
    for expected in EXPECTED_MAPS {
        if !ids.iter().any(|id| id == expected) {
            return Err(err(path, format!("missing expected map {expected}")));
        }
    }
    Ok(ids)
}

fn validate_game_map(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, GAME_MAP_KEYS, &[], path)?;
    expect_num(find(entries, "seed", path)?, &format!("{path}.seed"))?;
    expect_num(find(entries, "attempt", path)?, &format!("{path}.attempt"))?;
    let width = expect_integral(find(entries, "w", path)?, &format!("{path}.w"))?;
    let height = expect_integral(find(entries, "h", path)?, &format!("{path}.h"))?;
    if width <= 0.0 || width > 160.0 {
        return Err(err(
            &format!("{path}.w"),
            format!("map width {width} outside 1..=160"),
        ));
    }
    if height <= 0.0 || height > 160.0 {
        return Err(err(
            &format!("{path}.h"),
            format!("map height {height} outside 1..=160"),
        ));
    }
    let cells = width as u64 * height as u64;
    for key in GAME_MAP_GRID_KEYS {
        let grid_path = format!("{path}.{key}");
        let grid = expect_u8(find(entries, key, path)?, &grid_path)?;
        if grid.len() as u64 != cells {
            return Err(err(
                &grid_path,
                format!(
                    "expected {} bytes for a {}x{} map, got {}",
                    cells,
                    width,
                    height,
                    grid.len()
                ),
            ));
        }
    }
    for key in GAME_MAP_ARRAY_KEYS {
        expect_array(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    let coliseum_path = format!("{path}.coliseum");
    let coliseum = object_closed(
        find(entries, "coliseum", path)?,
        &["rect", "centre", "gates", "innerSpawns"],
        &[],
        &coliseum_path,
    )?;
    let rect_path = format!("{coliseum_path}.rect");
    let rect = object_closed(
        find(coliseum, "rect", &coliseum_path)?,
        &["x", "y", "w", "h"],
        &[],
        &rect_path,
    )?;
    for key in ["x", "y", "w", "h"] {
        expect_num(find(rect, key, &rect_path)?, &format!("{rect_path}.{key}"))?;
    }
    let centre_path = format!("{coliseum_path}.centre");
    let centre = object_closed(
        find(coliseum, "centre", &coliseum_path)?,
        &["x", "y"],
        &[],
        &centre_path,
    )?;
    for key in ["x", "y"] {
        expect_num(
            find(centre, key, &centre_path)?,
            &format!("{centre_path}.{key}"),
        )?;
    }
    expect_array(
        find(coliseum, "gates", &coliseum_path)?,
        &format!("{coliseum_path}.gates"),
    )?;
    expect_array(
        find(coliseum, "innerSpawns", &coliseum_path)?,
        &format!("{coliseum_path}.innerSpawns"),
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

fn validate_cases(value: &Value, map_ids: &[String], path: &str) -> R<()> {
    let cases = json_array(value, path)?;
    if cases.is_empty() {
        return Err(err(path, "cases must be a non-empty array"));
    }
    let mut ids: Vec<String> = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let case_path = format!("{path}[{index}]");
        let object = json_object(case, &case_path)?;
        closed_plain(object, CASE_KEYS, &[], &case_path)?;
        let id = json_string(
            json_field(object, "id", &case_path)?,
            &format!("{case_path}.id"),
        )?;
        if id.is_empty() {
            return Err(err(
                &format!("{case_path}.id"),
                "case ids must not be empty",
            ));
        }
        if ids.iter().any(|seen| seen == id) {
            return Err(err(&case_path, format!("duplicate case id {id}")));
        }
        let case_path = format!("{path}[{id}]");
        let suite = json_string(
            json_field(object, "suite", &case_path)?,
            &format!("{case_path}.suite"),
        )?;
        one_of(
            &SVal::Str(suite.to_string()),
            SUITES,
            "suite",
            &format!("{case_path}.suite"),
        )?;
        let covers = json_array(
            json_field(object, "covers", &case_path)?,
            &format!("{case_path}.covers"),
        )?;
        for (cover_index, cover) in covers.iter().enumerate() {
            if cover.as_str().is_none() {
                return Err(err(
                    &format!("{case_path}.covers[{cover_index}]"),
                    "covers must be strings",
                ));
            }
        }
        let config = decode(
            json_field(object, "config", &case_path)?,
            &format!("{case_path}.config"),
            Mode::Input,
            UndefinedRule::Reject,
        )?;
        validate_config(&config, map_ids, &format!("{case_path}.config"))?;
        validate_initial(object, suite, &format!("{case_path}.initial"))?;
        validate_setup(object, &format!("{case_path}.setupTranscript"))?;
        let operations = json_array(
            json_field(object, "operations", &case_path)?,
            &format!("{case_path}.operations"),
        )?;
        if operations.is_empty() {
            return Err(err(
                &format!("{case_path}.operations"),
                "operations must be a non-empty array",
            ));
        }
        for (operation_index, operation) in operations.iter().enumerate() {
            validate_operation(
                operation,
                suite,
                id,
                &config,
                &format!("{case_path}.operations[{operation_index}]"),
            )?;
        }
        ids.push(id.to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Resolved config
// ---------------------------------------------------------------------------

fn validate_config(config: &SVal, map_ids: &[String], path: &str) -> R<()> {
    let entries = object_closed(config, CONFIG_REQUIRED, CONFIG_OPTIONAL, path)?;
    one_of(
        find(entries, "tier", path)?,
        TIERS,
        "tier",
        &format!("{path}.tier"),
    )?;
    one_of(
        find(entries, "persona", path)?,
        PERSONAS,
        "persona",
        &format!("{path}.persona"),
    )?;
    expect_integral(find(entries, "seed", path)?, &format!("{path}.seed"))?;
    expect_uint32(
        find(entries, "pathBudget", path)?,
        &format!("{path}.pathBudget"),
    )?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
    validate_features(
        find(entries, "features", path)?,
        &format!("{path}.features"),
    )?;
    let modules = expect_array(find(entries, "modules", path)?, &format!("{path}.modules"))?;
    for (index, module) in modules.iter().enumerate() {
        as_entries(module, &format!("{path}.modules[{index}]"))?;
    }
    let learned = as_entries(find(entries, "learned", path)?, &format!("{path}.learned"))?;
    expect_bool(
        find(learned, "enabled", &format!("{path}.learned"))?,
        &format!("{path}.learned.enabled"),
    )?;
    validate_tier_values(
        find(entries, "tierValues", path)?,
        &format!("{path}.tierValues"),
    )?;
    validate_persona_values(
        find(entries, "personaValues", path)?,
        &format!("{path}.personaValues"),
    )?;
    let seeds = object_closed(
        find(entries, "seeds", path)?,
        SEED_KEYS,
        &[],
        &format!("{path}.seeds"),
    )?;
    for key in SEED_KEYS {
        expect_integral(
            find(seeds, key, &format!("{path}.seeds"))?,
            &format!("{path}.seeds.{key}"),
        )?;
    }
    let map = expect_str(find(entries, "map", path)?, &format!("{path}.map"))?;
    if !map_ids.iter().any(|map_id| map_id == map) {
        return Err(err(
            &format!("{path}.map"),
            format!("config map {map:?} is not one of the declared maps"),
        ));
    }
    if let Some(descriptor) = maybe(entries, "path") {
        validate_path_descriptor(descriptor, &format!("{path}.path"))?;
    }
    if let Some(overrides) = maybe(entries, "tierOverrides") {
        validate_tier_overrides(overrides, &format!("{path}.tierOverrides"))?;
    }
    if let Some(overrides) = maybe(entries, "personaOverrides") {
        validate_persona_overrides(overrides, &format!("{path}.personaOverrides"))?;
    }
    Ok(())
}

fn validate_features(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, FEATURE_KEYS, &[], path)?;
    let messages = expect_array(
        find(entries, "messageTypes", path)?,
        &format!("{path}.messageTypes"),
    )?;
    for (index, message) in messages.iter().enumerate() {
        one_of(
            message,
            CLIENT_MESSAGE_TYPES,
            "feature message",
            &format!("{path}.messageTypes[{index}]"),
        )?;
    }
    for key in FEATURE_BOOL_KEYS {
        expect_bool(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_ex_gaussian(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, EX_GAUSSIAN_KEYS, &[], path)?;
    for key in EX_GAUSSIAN_KEYS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_number_object(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object_closed(value, keys, &[], path)?;
    for key in keys {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_tier_values(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, TIER_VALUES_KEYS, &[], path)?;
    one_of(
        find(entries, "id", path)?,
        TIERS,
        "tier id",
        &format!("{path}.id"),
    )?;
    for key in ["reaction", "step", "daze"] {
        validate_ex_gaussian(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    for key in ["thinkMs", "strategyMs"] {
        validate_number_object(
            find(entries, key, path)?,
            THINK_KEYS,
            &format!("{path}.{key}"),
        )?;
    }
    for key in TIER_VALUES_SCALARS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    validate_number_object(
        find(entries, "moveScatter", path)?,
        MOVE_SCATTER_KEYS,
        &format!("{path}.moveScatter"),
    )?;
    validate_number_object(
        find(entries, "targetScatter", path)?,
        TARGET_SCATTER_KEYS,
        &format!("{path}.targetScatter"),
    )?;
    validate_number_object(
        find(entries, "hesitation", path)?,
        HESITATION_KEYS,
        &format!("{path}.hesitation"),
    )?;
    validate_number_object(
        find(entries, "orbwalk", path)?,
        ORBWALK_KEYS,
        &format!("{path}.orbwalk"),
    )?;
    let route_path = format!("{path}.route");
    let route = object_closed(find(entries, "route", path)?, ROUTE_KEYS, &[], &route_path)?;
    let horizon = expect_integral(
        find(route, "horizon", &route_path)?,
        &format!("{route_path}.horizon"),
    )?;
    if horizon < 0.0 || horizon > f64::from(u32::MAX) {
        return Err(err(
            &format!("{route_path}.horizon"),
            "route horizon outside u32",
        ));
    }
    expect_bool(
        find(route, "walkPaths", &route_path)?,
        &format!("{route_path}.walkPaths"),
    )?;
    expect_num(
        find(route, "reach", &route_path)?,
        &format!("{route_path}.reach"),
    )?;
    validate_number_object(
        find(entries, "attention", path)?,
        ATTENTION_KEYS,
        &format!("{path}.attention"),
    )?;
    validate_number_object(
        find(entries, "appraisal", path)?,
        APPRAISAL_KEYS,
        &format!("{path}.appraisal"),
    )?;
    validate_number_object(
        find(entries, "caution", path)?,
        CAUTION_KEYS,
        &format!("{path}.caution"),
    )?;
    Ok(())
}

fn validate_persona_values(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, PERSONA_VALUES_KEYS, &[], path)?;
    one_of(
        find(entries, "id", path)?,
        PERSONAS,
        "persona id",
        &format!("{path}.id"),
    )?;
    for key in PERSONA_VALUES_KEYS {
        if *key == "id" {
            continue;
        }
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_tier_overrides(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    for (key, _) in entries {
        if !TIER_OVERRIDE_KEYS.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported tier override {key}")));
        }
    }
    for (key, entry) in entries {
        let entry_path = format!("{path}.{key}");
        match key.as_str() {
            "orbwalk" => {
                let nested = as_entries(entry, &entry_path)?;
                for (nested_key, value) in nested {
                    if !ORBWALK_KEYS.contains(&nested_key.as_str()) {
                        return Err(err(
                            &entry_path,
                            format!("unsupported orbwalk override {nested_key}"),
                        ));
                    }
                    expect_num(value, &format!("{entry_path}.{nested_key}"))?;
                }
            }
            "step" | "reaction" => {
                let nested = as_entries(entry, &entry_path)?;
                for (nested_key, value) in nested {
                    if !EX_GAUSSIAN_KEYS.contains(&nested_key.as_str()) {
                        return Err(err(
                            &entry_path,
                            format!("unsupported {key} override {nested_key}"),
                        ));
                    }
                    expect_num(value, &format!("{entry_path}.{nested_key}"))?;
                }
            }
            _ => {
                expect_num(entry, &entry_path)?;
            }
        }
    }
    Ok(())
}

fn validate_persona_overrides(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    for (key, entry) in entries {
        if !PERSONA_OVERRIDE_KEYS.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported persona override {key}")));
        }
        expect_num(entry, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_path_descriptor(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    let kind = one_of(
        find(entries, "kind", path)?,
        &["radius-denial", "half-plane"],
        "path descriptor",
        &format!("{path}.kind"),
    )?;
    match kind {
        "radius-denial" => {
            object_closed(value, &["kind", "radius"], &[], path)?;
            expect_num(find(entries, "radius", path)?, &format!("{path}.radius"))?;
        }
        _ => {
            object_closed(value, &["kind", "x"], &[], path)?;
            expect_num(find(entries, "x", path)?, &format!("{path}.x"))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Initial state + constructor transcript
// ---------------------------------------------------------------------------

fn validate_initial(case: &serde_json::Map<String, Value>, suite: &str, path: &str) -> R<()> {
    let initial = json_object(json_field(case, "initial", path)?, path)?;
    closed_plain(initial, INITIAL_KEYS, &[], path)?;
    let memory = decode(
        json_field(initial, "memory", path)?,
        &format!("{path}.memory"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    validate_initial_memory(&memory, &format!("{path}.memory"))?;
    let stats = decode(
        json_field(initial, "stats", path)?,
        &format!("{path}.stats"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    validate_stats(&stats, suite, &format!("{path}.stats"))?;
    Ok(())
}

fn validate_initial_memory(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, MEMORY_KEYS, &[], path)?;
    for key in MEMORY_MAP_KEYS {
        match find(entries, key, path)? {
            SVal::Map(_) => {}
            other => {
                return Err(err(
                    &format!("{path}.{key}"),
                    format!("expected a tagged Map, got {}", describe(other)),
                ))
            }
        }
    }
    match find(entries, "self", path)? {
        SVal::Obj(_) => {}
        other => {
            return Err(err(
                &format!("{path}.self"),
                format!("expected a tagged object, got {}", describe(other)),
            ))
        }
    }
    expect_array(find(entries, "stimuli", path)?, &format!("{path}.stimuli"))?;
    expect_array(find(entries, "choices", path)?, &format!("{path}.choices"))?;
    Ok(())
}

fn validate_setup(case: &serde_json::Map<String, Value>, path: &str) -> R<()> {
    let value = decode(
        json_field(case, "setupTranscript", path)?,
        path,
        Mode::Input,
        UndefinedRule::Reject,
    )?;
    let draws = expect_array(&value, path)?;
    if draws.len() != 70 {
        return Err(err(
            path,
            format!(
                "constructor transcript must hold exactly 70 draws, got {}",
                draws.len()
            ),
        ));
    }
    for (index, draw) in draws.iter().enumerate() {
        let draw_path = format!("{path}[{index}]");
        let entries = object_closed(
            draw,
            &["sequence", "kind", "stream", "index", "value"],
            &[],
            &draw_path,
        )?;
        one_of(
            find(entries, "kind", &draw_path)?,
            &["rng"],
            "transcript kind",
            &format!("{draw_path}.kind"),
        )?;
        let sequence = expect_integral(
            find(entries, "sequence", &draw_path)?,
            &format!("{draw_path}.sequence"),
        )?;
        if sequence != index as f64 {
            return Err(err(
                &format!("{draw_path}.sequence"),
                "transcript sequence must equal its position",
            ));
        }
        one_of(
            find(entries, "stream", &draw_path)?,
            &["knowledge"],
            "constructor stream",
            &format!("{draw_path}.stream"),
        )?;
        let ordinal = expect_integral(
            find(entries, "index", &draw_path)?,
            &format!("{draw_path}.index"),
        )?;
        if ordinal != index as f64 {
            return Err(err(
                &format!("{draw_path}.index"),
                "constructor knowledge draw ordinal must equal its position",
            ));
        }
        let drawn = expect_num(
            find(entries, "value", &draw_path)?,
            &format!("{draw_path}.value"),
        )?;
        if !(0.0..1.0).contains(&drawn) {
            return Err(err(
                &format!("{draw_path}.value"),
                format!("drawn value {drawn} outside [0,1)"),
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

fn validate_operation(op: &Value, suite: &str, case_id: &str, config: &SVal, path: &str) -> R<()> {
    let object = json_object(op, path)?;
    closed_plain(object, OP_KEYS, &["thrown"], path)?;
    let method = json_string(
        json_field(object, "method", path)?,
        &format!("{path}.method"),
    )?;
    one_of(
        &SVal::Str(method.to_string()),
        METHODS,
        "method",
        &format!("{path}.method"),
    )?;
    let declaration = decode(
        json_field(object, "declaration", path)?,
        &format!("{path}.declaration"),
        Mode::Input,
        UndefinedRule::Declaration,
    )?;
    validate_declaration(
        &declaration,
        method,
        suite,
        config,
        &format!("{path}.declaration"),
    )?;
    let result = decode(
        json_field(object, "result", path)?,
        &format!("{path}.result"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    let _memory = decode(
        json_field(object, "memory", path)?,
        &format!("{path}.memory"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    let stats = decode(
        json_field(object, "stats", path)?,
        &format!("{path}.stats"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    validate_stats(&stats, suite, &format!("{path}.stats"))?;
    let callbacks = decode(
        json_field(object, "callbacks", path)?,
        &format!("{path}.callbacks"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    validate_callbacks(&callbacks, &format!("{path}.callbacks"))?;
    let path_stats = decode(
        json_field(object, "pathStats", path)?,
        &format!("{path}.pathStats"),
        Mode::Diagnostic,
        UndefinedRule::Allow,
    )?;
    let path_stats_entries = object_closed(
        &path_stats,
        &["searches", "hits", "fallbacks"],
        &[],
        &format!("{path}.pathStats"),
    )?;
    for key in ["searches", "hits", "fallbacks"] {
        expect_integral(
            find(path_stats_entries, key, &format!("{path}.pathStats"))?,
            &format!("{path}.pathStats.{key}"),
        )?;
    }
    validate_draw_counts(
        json_field(object, "drawCounts", path)?,
        &format!("{path}.drawCounts"),
    )?;
    let thrown = object.get("thrown");
    if let Some(thrown) = thrown {
        validate_thrown(thrown, case_id, method, &format!("{path}.thrown"))?;
    }
    if method == "act" && thrown.is_none() {
        validate_act_result(&result, &format!("{path}.result"))?;
    }
    Ok(())
}

fn declaration_fields(method: &str, suite: &str) -> R<&'static [&'static str]> {
    Ok(match method {
        "observe" => &["input"],
        "act" => &["goal"],
        "noteSent" => &["input"],
        "recordChoice" => &["input"],
        "step" => &["foe", "weapon", "locked"],
        "reset" => {
            if suite == "orb" {
                &["readyAt"]
            } else {
                &[]
            }
        }
        "point" => &["threats"],
        "check" => &[],
        "leave" => &[],
        "pickHoldSpot" => &["centre", "radius"],
        "inReach" => &["foe", "weapon"],
        _ => return Err(format!("unsupported declaration method {method}")),
    })
}

fn validate_declaration(
    declaration: &SVal,
    method: &str,
    suite: &str,
    config: &SVal,
    path: &str,
) -> R<()> {
    let fields = declaration_fields(method, suite)?;
    let mut required: Vec<&str> = Vec::with_capacity(1 + fields.len());
    required.push("method");
    required.extend_from_slice(fields);
    let entries = object_closed(
        declaration,
        &required,
        &["env", "engaged", "knowsSuddenDeath"],
        path,
    )?;
    let declared = expect_str(find(entries, "method", path)?, &format!("{path}.method"))?;
    if declared != method {
        return Err(err(
            &format!("{path}.method"),
            format!("declaration method {declared:?} differs from operation method {method:?}"),
        ));
    }
    if let Some(flag) = maybe(entries, "engaged") {
        expect_bool(flag, &format!("{path}.engaged"))?;
    }
    if let Some(flag) = maybe(entries, "knowsSuddenDeath") {
        expect_bool(flag, &format!("{path}.knowsSuddenDeath"))?;
    }
    let env_descriptor = match maybe(entries, "env") {
        Some(env) => validate_env(env, &format!("{path}.env"))?,
        None => None,
    };
    if let Some(descriptor) = env_descriptor.or_else(|| config.optional("path")) {
        validate_path_descriptor(descriptor, &format!("{path}.path"))?;
    }
    match method {
        "observe" => validate_percept(find(entries, "input", path)?, &format!("{path}.input"))?,
        "act" => validate_goal(find(entries, "goal", path)?, suite, &format!("{path}.goal"))?,
        "noteSent" => validate_note_sent(find(entries, "input", path)?, &format!("{path}.input"))?,
        "recordChoice" => {
            expect_str(find(entries, "input", path)?, &format!("{path}.input"))?;
        }
        "step" => validate_step(declaration, path)?,
        "reset" => {
            if suite == "orb" {
                expect_num(find(entries, "readyAt", path)?, &format!("{path}.readyAt"))?;
            }
        }
        "point" => {
            let threats =
                expect_array(find(entries, "threats", path)?, &format!("{path}.threats"))?;
            for (index, threat) in threats.iter().enumerate() {
                expect_vec(threat, &format!("{path}.threats[{index}]"))?;
            }
        }
        "check" | "leave" => {}
        "pickHoldSpot" => {
            expect_vec(find(entries, "centre", path)?, &format!("{path}.centre"))?;
            expect_num(find(entries, "radius", path)?, &format!("{path}.radius"))?;
        }
        "inReach" => validate_in_reach(
            find(entries, "foe", path)?,
            find(entries, "weapon", path)?,
            path,
        )?,
        _ => unreachable!("method was checked against METHODS"),
    }
    Ok(())
}

fn validate_env<'a>(value: &'a SVal, path: &str) -> R<Option<&'a SVal>> {
    let entries = as_entries(value, path)?;
    for (key, _) in entries {
        if key != "path" && key != "emptyPath" {
            return Err(err(path, format!("unsupported environment override {key}")));
        }
    }
    let descriptor = maybe(entries, "path");
    if let Some(descriptor) = descriptor {
        validate_path_descriptor(descriptor, &format!("{path}.path"))?;
    }
    if let Some(flag) = maybe(entries, "emptyPath") {
        expect_bool(flag, &format!("{path}.emptyPath"))?;
    }
    Ok(descriptor)
}

fn validate_note_sent(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(
        value,
        &["at", "cmd", "intent", "priority", "stimulus"],
        &[],
        path,
    )?;
    expect_num(find(entries, "at", path)?, &format!("{path}.at"))?;
    let cmd_path = format!("{path}.cmd");
    let cmd = object_closed(
        find(entries, "cmd", path)?,
        &["type", "msg"],
        &[],
        &cmd_path,
    )?;
    one_of(
        find(cmd, "type", &cmd_path)?,
        CLIENT_MESSAGE_TYPES,
        "command",
        &format!("{cmd_path}.type"),
    )?;
    expect_str(find(entries, "intent", path)?, &format!("{path}.intent"))?;
    expect_uint32(
        find(entries, "priority", path)?,
        &format!("{path}.priority"),
    )?;
    find(entries, "stimulus", path)?;
    Ok(())
}

fn validate_step(declaration: &SVal, path: &str) -> R<()> {
    let entries = as_entries(declaration, path)?;
    let foe_path = format!("{path}.foe");
    let foe = object_closed(
        find(entries, "foe", path)?,
        &["id", "x", "y"],
        &[],
        &foe_path,
    )?;
    expect_str(find(foe, "id", &foe_path)?, &format!("{foe_path}.id"))?;
    expect_num(find(foe, "x", &foe_path)?, &format!("{foe_path}.x"))?;
    expect_num(find(foe, "y", &foe_path)?, &format!("{foe_path}.y"))?;
    expect_weapon(find(entries, "weapon", path)?, &format!("{path}.weapon"))?;
    expect_bool(find(entries, "locked", path)?, &format!("{path}.locked"))?;
    Ok(())
}

fn validate_in_reach(foe: &SVal, weapon: &SVal, path: &str) -> R<()> {
    let foe_path = format!("{path}.foe");
    let entries = as_entries(foe, &foe_path)?;
    expect_num(find(entries, "x", &foe_path)?, &format!("{foe_path}.x"))?;
    expect_num(find(entries, "y", &foe_path)?, &format!("{foe_path}.y"))?;
    expect_bool(find(entries, "los", &foe_path)?, &format!("{foe_path}.los"))?;
    expect_weapon(weapon, &format!("{path}.weapon"))?;
    Ok(())
}

fn validate_goal(value: &SVal, suite: &str, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    let kind_value = find(entries, "kind", path)?;
    if suite == "fight" {
        one_of(kind_value, FIGHT_GOALS, "goal", &format!("{path}.kind"))?;
        object_closed(value, &["id", "kind"], &[], path)?;
        expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
        return Ok(());
    }
    let kind = one_of(kind_value, GOALS, "goal", &format!("{path}.kind"))?;
    match kind {
        "idle" => {
            object_closed(value, &["kind"], &[], path)?;
        }
        "farm" => {
            object_closed(value, &["kind", "mob", "camp"], &[], path)?;
            expect_str(find(entries, "mob", path)?, &format!("{path}.mob"))?;
            expect_nullable_str(find(entries, "camp", path)?, &format!("{path}.camp"))?;
        }
        "hunt" | "fight" => {
            object_closed(value, &["kind", "target"], &[], path)?;
            expect_str(find(entries, "target", path)?, &format!("{path}.target"))?;
        }
        "loot" => {
            object_closed(value, &["kind", "container"], &[], path)?;
            expect_str(
                find(entries, "container", path)?,
                &format!("{path}.container"),
            )?;
        }
        "flee" => {
            object_closed(value, &["kind", "from", "until"], &[], path)?;
            let from = expect_array(find(entries, "from", path)?, &format!("{path}.from"))?;
            for (index, point) in from.iter().enumerate() {
                expect_vec(point, &format!("{path}.from[{index}]"))?;
            }
            expect_num(find(entries, "until", path)?, &format!("{path}.until"))?;
        }
        "roam" => {
            object_closed(value, &["kind", "to", "why"], &[], path)?;
            expect_vec(find(entries, "to", path)?, &format!("{path}.to"))?;
            one_of(
                find(entries, "why", path)?,
                &["explore", "camp", "lastSeen", "coliseum", "centre"],
                "roam reason",
                &format!("{path}.why"),
            )?;
        }
        "hold" => {
            object_closed(value, &["kind", "at", "why"], &[], path)?;
            expect_vec(find(entries, "at", path)?, &format!("{path}.at"))?;
            one_of(
                find(entries, "why", path)?,
                &["coliseum", "ambush", "wait"],
                "hold reason",
                &format!("{path}.why"),
            )?;
        }
        _ => {
            object_closed(value, &["kind", "module", "data"], &[], path)?;
            expect_str(find(entries, "module", path)?, &format!("{path}.module"))?;
            expect_objectish(find(entries, "data", path)?, &format!("{path}.data"))?;
        }
    }
    Ok(())
}

fn validate_act_result(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    for key in ["intents", "status", "attacking"] {
        find(entries, key, path)?;
    }
    expect_bool(
        find(entries, "attacking", path)?,
        &format!("{path}.attacking"),
    )?;
    let status_path = format!("{path}.status");
    let status = as_entries(find(entries, "status", path)?, &status_path)?;
    one_of(
        find(status, "state", &status_path)?,
        GOAL_STATES,
        "goal status",
        &format!("{status_path}.state"),
    )?;
    expect_str(
        find(status, "why", &status_path)?,
        &format!("{status_path}.why"),
    )?;
    let intents = expect_array(find(entries, "intents", path)?, &format!("{path}.intents"))?;
    for (index, intent) in intents.iter().enumerate() {
        let intent_path = format!("{path}.intents[{index}]");
        let intent = as_entries(intent, &intent_path)?;
        one_of(
            find(intent, "kind", &intent_path)?,
            INTENT_KINDS,
            "intent",
            &format!("{intent_path}.kind"),
        )?;
    }
    Ok(())
}

fn validate_draw_counts(value: &Value, path: &str) -> R<()> {
    let counts = json_object(value, path)?;
    closed_plain(
        counts,
        &["decide", "motor", "lapse", "knowledge"],
        &[],
        path,
    )?;
    for key in ["decide", "motor", "lapse", "knowledge"] {
        let count = json_field(counts, key, path)?;
        if count.as_u64().is_none() {
            return Err(err(
                &format!("{path}.{key}"),
                "draw count must be a non-negative integer",
            ));
        }
    }
    Ok(())
}

fn validate_thrown(value: &Value, case_id: &str, method: &str, path: &str) -> R<()> {
    let object = json_object(value, path)?;
    closed_plain(object, &["name", "message"], &[], path)?;
    let name = json_string(json_field(object, "name", path)?, &format!("{path}.name"))?;
    let message = json_string(
        json_field(object, "message", path)?,
        &format!("{path}.message"),
    )?;
    if case_id != "loot-path-empty" || method != "act" {
        return Err(err(
            path,
            format!("only the frozen loot-path-empty act row may throw (case {case_id}, method {method})"),
        ));
    }
    if name != "TypeError" {
        return Err(err(
            &format!("{path}.name"),
            format!("expected the frozen TypeError, got {name:?}"),
        ));
    }
    if message != "Cannot read properties of undefined (reading 'x')" {
        return Err(err(
            &format!("{path}.message"),
            format!("unexpected frozen thrown message {message:?}"),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Expected-output channels
// ---------------------------------------------------------------------------

fn validate_stats(value: &SVal, suite: &str, path: &str) -> R<()> {
    match suite {
        "tactics" => {
            let entries = object_closed(value, &["stats", "getStats"], &[], path)?;
            for key in ["stats", "getStats"] {
                let inner_path = format!("{path}.{key}");
                let inner = object_closed(
                    find(entries, key, path)?,
                    TACTICS_STATS_KEYS,
                    &[],
                    &inner_path,
                )?;
                for stat in TACTICS_STATS_KEYS {
                    expect_integral(
                        find(inner, stat, &inner_path)?,
                        &format!("{inner_path}.{stat}"),
                    )?;
                }
            }
        }
        "fight" => {
            let entries = object_closed(value, FIGHT_STATS_KEYS, &[], path)?;
            for key in FIGHT_STATS_KEYS {
                expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
            }
        }
        "orb" => {
            let entries = object_closed(value, &["cycles"], &[], path)?;
            expect_num(find(entries, "cycles", path)?, &format!("{path}.cycles"))?;
        }
        "reflex" => {
            let entries = object_closed(value, REFLEX_STATS_KEYS, &[], path)?;
            for key in REFLEX_STATS_KEYS {
                expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
            }
        }
        "world" | "retreat" => {
            object_closed(value, &[], &[], path)?;
        }
        other => return Err(err(path, format!("unsupported suite {other} for stats"))),
    }
    Ok(())
}

fn validate_callbacks(value: &SVal, path: &str) -> R<()> {
    let events = expect_array(value, path)?;
    for (index, event) in events.iter().enumerate() {
        let event_path = format!("{path}[{index}]");
        let entries = as_entries(event, &event_path)?;
        let kind = one_of(
            find(entries, "kind", &event_path)?,
            &["callback", "rng"],
            "callback kind",
            &format!("{event_path}.kind"),
        )?;
        match kind {
            "callback" => {
                object_closed(
                    event,
                    &["sequence", "kind", "name", "args", "result"],
                    &[],
                    &event_path,
                )?;
                validate_sequence(entries, index, &event_path)?;
                one_of(
                    find(entries, "name", &event_path)?,
                    CALLBACK_NAMES,
                    "callback identity",
                    &format!("{event_path}.name"),
                )?;
                expect_array(
                    find(entries, "args", &event_path)?,
                    &format!("{event_path}.args"),
                )?;
            }
            _ => {
                object_closed(
                    event,
                    &["sequence", "kind", "stream", "index", "value"],
                    &[],
                    &event_path,
                )?;
                validate_sequence(entries, index, &event_path)?;
                one_of(
                    find(entries, "stream", &event_path)?,
                    STREAMS,
                    "stream",
                    &format!("{event_path}.stream"),
                )?;
                let ordinal = expect_integral(
                    find(entries, "index", &event_path)?,
                    &format!("{event_path}.index"),
                )?;
                if ordinal < 0.0 || ordinal > f64::from(u32::MAX) {
                    return Err(err(
                        &format!("{event_path}.index"),
                        "stream ordinal outside u32",
                    ));
                }
                let drawn = expect_num(
                    find(entries, "value", &event_path)?,
                    &format!("{event_path}.value"),
                )?;
                if !(0.0..1.0).contains(&drawn) {
                    return Err(err(
                        &format!("{event_path}.value"),
                        format!("drawn value {drawn} outside [0,1)"),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_sequence(entries: &[(String, SVal)], index: usize, path: &str) -> R<()> {
    let sequence = expect_integral(
        find(entries, "sequence", path)?,
        &format!("{path}.sequence"),
    )?;
    if sequence != index as f64 {
        return Err(err(
            &format!("{path}.sequence"),
            "transcript sequence must equal its position",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Declared Percept
// ---------------------------------------------------------------------------

fn validate_percept(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, PERCEPT_KEYS, &[], path)?;
    expect_num(find(entries, "now", path)?, &format!("{path}.now"))?;
    expect_num(find(entries, "viewT", path)?, &format!("{path}.viewT"))?;
    validate_percept_self(find(entries, "self", path)?, &format!("{path}.self"))?;
    validate_percept_hud(find(entries, "hud", path)?, &format!("{path}.hud"))?;
    let fighters = expect_array(
        find(entries, "fighters", path)?,
        &format!("{path}.fighters"),
    )?;
    for (index, fighter) in fighters.iter().enumerate() {
        validate_percept_fighter(fighter, &format!("{path}.fighters[{index}]"))?;
    }
    let mobs = expect_array(find(entries, "mobs", path)?, &format!("{path}.mobs"))?;
    for (index, mob) in mobs.iter().enumerate() {
        validate_percept_mob(mob, &format!("{path}.mobs[{index}]"))?;
    }
    let containers = expect_array(
        find(entries, "containers", path)?,
        &format!("{path}.containers"),
    )?;
    for (index, container) in containers.iter().enumerate() {
        validate_percept_container(container, &format!("{path}.containers[{index}]"))?;
    }
    let projectiles = expect_array(
        find(entries, "projectiles", path)?,
        &format!("{path}.projectiles"),
    )?;
    for (index, projectile) in projectiles.iter().enumerate() {
        validate_percept_projectile(projectile, &format!("{path}.projectiles[{index}]"))?;
    }
    validate_percept_minimap(find(entries, "minimap", path)?, &format!("{path}.minimap"))?;
    let events = expect_array(find(entries, "events", path)?, &format!("{path}.events"))?;
    for (index, event) in events.iter().enumerate() {
        validate_percept_event(event, &format!("{path}.events[{index}]"))?;
    }
    validate_percept_extras(find(entries, "extras", path)?, &format!("{path}.extras"))?;
    validate_features(
        find(entries, "features", path)?,
        &format!("{path}.features"),
    )?;
    Ok(())
}

fn validate_percept_self(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, SELF_REQUIRED, &["windupMult"], path)?;
    expect_vec(value, path)?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
    one_of(
        find(entries, "status", path)?,
        STATUSES,
        "status",
        &format!("{path}.status"),
    )?;
    expect_faction(find(entries, "faction", path)?, &format!("{path}.faction"))?;
    let weapons = expect_array(find(entries, "weapons", path)?, &format!("{path}.weapons"))?;
    if weapons.len() != 2 {
        return Err(err(
            &format!("{path}.weapons"),
            "self weapons must be a two-slot array",
        ));
    }
    for (index, weapon) in weapons.iter().enumerate() {
        expect_weapon(weapon, &format!("{path}.weapons[{index}]"))?;
    }
    let slot = expect_integral(find(entries, "slot", path)?, &format!("{path}.slot"))?;
    if slot != 0.0 && slot != 1.0 {
        return Err(err(&format!("{path}.slot"), "self slot must be 0 or 1"));
    }
    expect_nullable_str(
        find(entries, "attackTarget", path)?,
        &format!("{path}.attackTarget"),
    )?;
    for key in SELF_NUMBERS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    if let Some(windup_mult) = maybe(entries, "windupMult") {
        match windup_mult {
            SVal::Undefined => {}
            _ => {
                expect_num(windup_mult, &format!("{path}.windupMult"))?;
            }
        }
    }
    Ok(())
}

fn validate_percept_hud(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, HUD_KEYS, &[], path)?;
    expect_str(find(entries, "phase", path)?, &format!("{path}.phase"))?;
    expect_str(find(entries, "winner", path)?, &format!("{path}.winner"))?;
    for key in ["training", "inColiseum", "gatesLocked"] {
        expect_bool(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    for key in HUD_NUMBERS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_percept_fighter(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, FIGHTER_KEYS, &[], path)?;
    expect_vec(value, path)?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
    for key in ["bot", "immune", "targetable", "los", "central"] {
        expect_bool(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    one_of(
        find(entries, "status", path)?,
        STATUSES,
        "status",
        &format!("{path}.status"),
    )?;
    expect_faction(find(entries, "faction", path)?, &format!("{path}.faction"))?;
    expect_weapon(find(entries, "inHand", path)?, &format!("{path}.inHand"))?;
    for key in FIGHTER_NUMBERS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_percept_mob(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, MOB_KEYS, &[], path)?;
    expect_vec(value, path)?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
    one_of(
        find(entries, "kind", path)?,
        MOB_KINDS,
        "mob kind",
        &format!("{path}.kind"),
    )?;
    expect_str(find(entries, "type", path)?, &format!("{path}.type"))?;
    one_of(
        find(entries, "status", path)?,
        STATUSES,
        "status",
        &format!("{path}.status"),
    )?;
    expect_faction(find(entries, "faction", path)?, &format!("{path}.faction"))?;
    expect_weapon(find(entries, "inHand", path)?, &format!("{path}.inHand"))?;
    for key in ["los", "central"] {
        expect_bool(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    for key in MOB_NUMBERS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_percept_container(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, CONTAINER_KEYS, &[], path)?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    expect_str(find(entries, "kind", path)?, &format!("{path}.kind"))?;
    expect_str(find(entries, "label", path)?, &format!("{path}.label"))?;
    expect_vec(value, path)?;
    for key in ["closed", "interactable"] {
        expect_bool(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    match find(entries, "weapon", path)? {
        SVal::Undefined | SVal::Null => {}
        weapon => {
            expect_weapon(weapon, &format!("{path}.weapon"))?;
        }
    }
    expect_num(find(entries, "dist", path)?, &format!("{path}.dist"))?;
    Ok(())
}

fn validate_percept_projectile(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, PROJECTILE_KEYS, &[], path)?;
    expect_str(find(entries, "id", path)?, &format!("{path}.id"))?;
    one_of(
        find(entries, "kind", path)?,
        PROJECTILE_KINDS,
        "projectile kind",
        &format!("{path}.kind"),
    )?;
    expect_vec(value, path)?;
    for key in PROJECTILE_NUMBERS {
        expect_num(find(entries, key, path)?, &format!("{path}.{key}"))?;
    }
    expect_nullable_str(find(entries, "from", path)?, &format!("{path}.from"))?;
    Ok(())
}

fn validate_percept_minimap(value: &SVal, path: &str) -> R<()> {
    let entries = object_closed(value, MINIMAP_KEYS, &[], path)?;
    expect_num(find(entries, "t", path)?, &format!("{path}.t"))?;
    expect_bool(
        find(entries, "gatesLocked", path)?,
        &format!("{path}.gatesLocked"),
    )?;
    let mobs = expect_array(find(entries, "mobs", path)?, &format!("{path}.mobs"))?;
    for (index, mob) in mobs.iter().enumerate() {
        let mob_path = format!("{path}.mobs[{index}]");
        let mob = object_closed(mob, MINIMAP_MOB_KEYS, &[], &mob_path)?;
        expect_str(find(mob, "id", &mob_path)?, &format!("{mob_path}.id"))?;
        expect_num(find(mob, "x", &mob_path)?, &format!("{mob_path}.x"))?;
        expect_num(find(mob, "y", &mob_path)?, &format!("{mob_path}.y"))?;
        expect_faction(
            find(mob, "faction", &mob_path)?,
            &format!("{mob_path}.faction"),
        )?;
        expect_bool(find(mob, "elite", &mob_path)?, &format!("{mob_path}.elite"))?;
    }
    Ok(())
}

fn event_required_fields(kind: &str) -> Option<&'static [&'static str]> {
    Some(match kind {
        "windup" => &["by", "weapon", "a", "ms"],
        "swing" => &["by", "weapon", "a"],
        "hit" => &["id", "by", "amount", "weapon", "sig"],
        "block" => &["id", "by", "weapon"],
        "stagger" => &["id"],
        "cancel" => &["id"],
        "projEnd" => &["id", "proj", "reason"],
        "death" => &["id", "name", "by", "mob"],
        "heal" => &["id", "amount"],
        "teleport" => &[],
        "bounty" => &["id", "name", "bounty"],
        "victory" => &["id", "name", "draw"],
        "toast" => &["text"],
        "result" => &["result"],
        "private" => &["type", "msg"],
        "ext" => &["fx", "data"],
        _ => return None,
    })
}

fn validate_percept_event(value: &SVal, path: &str) -> R<()> {
    let entries = as_entries(value, path)?;
    let kind = one_of(
        find(entries, "kind", path)?,
        EVENT_KINDS,
        "event",
        &format!("{path}.kind"),
    )?;
    let required = event_required_fields(kind).expect("kind was checked against EVENT_KINDS");
    let mut allowed: Vec<&str> = Vec::with_capacity(3 + required.len() + EVENT_OPTIONAL_KEYS.len());
    allowed.extend_from_slice(EVENT_BASE_KEYS);
    allowed.extend_from_slice(required);
    allowed.extend_from_slice(EVENT_OPTIONAL_KEYS);
    for (key, _) in entries {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unexpected {kind} event field {key}")));
        }
    }
    for key in required {
        find(entries, key, path)?;
    }
    expect_num(find(entries, "t", path)?, &format!("{path}.t"))?;
    expect_optional_vec(find(entries, "at", path)?, &format!("{path}.at"))?;
    if let Some(id) = maybe(entries, "id") {
        expect_nullable_str(id, &format!("{path}.id"))?;
    }
    if let Some(by) = maybe(entries, "by") {
        expect_nullable_str(by, &format!("{path}.by"))?;
    }
    if let Some(weapon) = maybe(entries, "weapon") {
        expect_weapon(weapon, &format!("{path}.weapon"))?;
    }
    for key in EVENT_NUMBER_KEYS {
        if let Some(number) = maybe(entries, key) {
            expect_num(number, &format!("{path}.{key}"))?;
        }
    }
    match kind {
        "windup" => {
            expect_str(find(entries, "by", path)?, &format!("{path}.by"))?;
        }
        "swing" => {
            expect_str(find(entries, "by", path)?, &format!("{path}.by"))?;
        }
        "hit" => {
            expect_num(find(entries, "sig", path)?, &format!("{path}.sig"))?;
        }
        "projEnd" => {
            expect_str(find(entries, "proj", path)?, &format!("{path}.proj"))?;
            expect_str(find(entries, "reason", path)?, &format!("{path}.reason"))?;
        }
        "death" => {
            expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
            expect_bool(find(entries, "mob", path)?, &format!("{path}.mob"))?;
        }
        "bounty" => {
            expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
        }
        "victory" => {
            expect_str(find(entries, "name", path)?, &format!("{path}.name"))?;
        }
        "toast" => {
            expect_str(find(entries, "text", path)?, &format!("{path}.text"))?;
        }
        "private" => {
            expect_str(find(entries, "type", path)?, &format!("{path}.type"))?;
            expect_objectish(find(entries, "msg", path)?, &format!("{path}.msg"))?;
        }
        "ext" => {
            expect_str(find(entries, "fx", path)?, &format!("{path}.fx"))?;
            expect_objectish(find(entries, "data", path)?, &format!("{path}.data"))?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_percept_extras(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Null => Ok(()),
        SVal::Obj(_) => {
            let entries = as_entries(value, path)?;
            for (key, entry) in entries {
                let entry_path = format!("{path}.{key}");
                match key.as_str() {
                    "camps" => {
                        let camps = expect_array(entry, &entry_path)?;
                        for (index, camp) in camps.iter().enumerate() {
                            let camp_path = format!("{entry_path}[{index}]");
                            let camp = object_closed(camp, &["id", "state"], &[], &camp_path)?;
                            expect_str(find(camp, "id", &camp_path)?, &format!("{camp_path}.id"))?;
                            let state = expect_integral(
                                find(camp, "state", &camp_path)?,
                                &format!("{camp_path}.state"),
                            )?;
                            if !(0.0..=2.0).contains(&state) {
                                return Err(err(
                                    &format!("{camp_path}.state"),
                                    "camp state outside 0..=2",
                                ));
                            }
                        }
                    }
                    "chests" => {
                        let chests = expect_array(entry, &entry_path)?;
                        for (index, chest) in chests.iter().enumerate() {
                            let chest_path = format!("{entry_path}[{index}]");
                            let chest = object_closed(
                                chest,
                                &["id", "x", "y", "picked"],
                                &[],
                                &chest_path,
                            )?;
                            expect_str(
                                find(chest, "id", &chest_path)?,
                                &format!("{chest_path}.id"),
                            )?;
                            expect_num(find(chest, "x", &chest_path)?, &format!("{chest_path}.x"))?;
                            expect_num(find(chest, "y", &chest_path)?, &format!("{chest_path}.y"))?;
                            expect_bool(
                                find(chest, "picked", &chest_path)?,
                                &format!("{chest_path}.picked"),
                            )?;
                        }
                    }
                    "plan" => {
                        let plan = object_closed(entry, &["endsAt"], &[], &entry_path)?;
                        expect_num(
                            find(plan, "endsAt", &entry_path)?,
                            &format!("{entry_path}.endsAt"),
                        )?;
                    }
                    other => return Err(err(path, format!("unsupported extras field {other}"))),
                }
            }
            Ok(())
        }
        other => Err(err(
            path,
            format!(
                "extras must be null or a tagged object, got {}",
                describe(other)
            ),
        )),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    fn load_corpus() -> Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/policy/bot-private-tactics/source.json"
        );
        let text = std::fs::read_to_string(path).expect("read the frozen private-tactics source");
        serde_json::from_str(&text).expect("parse the frozen private-tactics source")
    }

    #[test]
    fn private_tactics_source_envelope_guard() {
        let source = load_corpus();
        validate_corpus(&source).expect("the frozen private-tactics source must validate");
        let cases = source["cases"].as_array().expect("cases array");
        assert_eq!(cases.len(), 154, "frozen case total");
        let operations: usize = cases
            .iter()
            .map(|case| {
                case["operations"]
                    .as_array()
                    .expect("operations array")
                    .len()
            })
            .sum();
        assert_eq!(operations, 720, "frozen operation total");
        let mut suites: Vec<&str> = cases
            .iter()
            .map(|case| case["suite"].as_str().expect("case suite"))
            .collect();
        suites.sort_unstable();
        suites.dedup();
        assert_eq!(
            suites,
            ["fight", "orb", "reflex", "retreat", "tactics", "world"],
            "frozen suite set"
        );
        let maps: Vec<&str> = source["maps"]
            .as_array()
            .expect("maps array")
            .iter()
            .map(|map| map["id"].as_str().expect("map id"))
            .collect();
        assert_eq!(
            maps,
            ["open", "wall", "fence", "detour", "generated7"],
            "frozen map list"
        );
        for case in cases {
            let draws = case["setupTranscript"]["values"]
                .as_array()
                .expect("constructor transcript values");
            assert_eq!(draws.len(), 70, "frozen constructor draw total");
            let knowledge = draws
                .iter()
                .filter(|draw| {
                    let entries = draw["entries"].as_array().expect("tagged entries");
                    let field = |name: &str| {
                        entries
                            .iter()
                            .find(|pair| pair[0] == name)
                            .map(|pair| &pair[1])
                    };
                    field("kind").is_some_and(|value| value == "rng")
                        && field("stream").is_some_and(|value| value == "knowledge")
                })
                .count();
            assert_eq!(knowledge, 70, "frozen knowledge draw total per case");
        }
        eprintln!(
            "private tactics source envelope: {} cases / {} operations / 70 knowledge draws per case / suites {:?} / maps {:?}",
            cases.len(),
            operations,
            suites,
            maps
        );
    }

    fn rejects_decode(value: &Value) -> bool {
        decode(value, "control", Mode::Input, UndefinedRule::Reject).is_err()
    }

    fn mutated(source: &Value, mutate: impl FnOnce(&mut Value)) -> Value {
        let mut copy = source.clone();
        mutate(&mut copy);
        copy
    }

    fn tagged_entry<'a>(tagged: &'a mut Value, key: &str) -> &'a mut Value {
        let entries = tagged["entries"]
            .as_array_mut()
            .expect("tagged raw entries");
        let position = entries
            .iter()
            .position(|pair| pair[0] == key)
            .unwrap_or_else(|| panic!("tagged entry {key}"));
        &mut entries[position][1]
    }

    fn observe_input(body: &mut Value) -> &mut Value {
        let operations = body["cases"][0]["operations"]
            .as_array_mut()
            .expect("case operations");
        let position = operations
            .iter()
            .position(|operation| operation["method"] == "observe")
            .expect("an observe operation");
        tagged_entry(&mut operations[position]["declaration"], "input")
    }

    fn control_now(body: &mut Value) {
        *tagged_entry(observe_input(body), "now") = json!({"$": "number", "value": "+Infinity"});
    }

    fn control_missing_ready_at(body: &mut Value) {
        let self_object = tagged_entry(observe_input(body), "self");
        let entries = self_object["entries"].as_array_mut().expect("self entries");
        entries.retain(|pair| pair[0] != "readyAt");
    }

    fn control_bad_status(body: &mut Value) {
        *tagged_entry(tagged_entry(observe_input(body), "self"), "status") = json!("future");
    }

    fn control_nan_x(body: &mut Value) {
        *tagged_entry(tagged_entry(observe_input(body), "self"), "x") =
            json!({"$": "number", "value": "NaN"});
    }

    fn control_unknown_view_t(body: &mut Value) {
        *tagged_entry(observe_input(body), "viewT") = json!({"$": "number", "value": "-Infinity"});
    }

    fn control_missing_orbwalk_p(body: &mut Value) {
        let orbwalk = tagged_entry(
            tagged_entry(&mut body["cases"][0]["config"], "tierValues"),
            "orbwalk",
        );
        let entries = orbwalk["entries"].as_array_mut().expect("orbwalk entries");
        entries.retain(|pair| pair[0] != "p");
    }

    fn control_duplicate_case(body: &mut Value) {
        let cases = body["cases"].as_array_mut().expect("cases array");
        let first = cases[0].clone();
        cases.push(first);
    }

    fn reject(count: &mut usize, label: &str, rejected: bool) {
        assert!(rejected, "reader control must be rejected: {label}");
        *count += 1;
    }

    #[test]
    fn private_tactics_source_reader_controls() {
        let mut count = 0usize;
        let tagged_rejects = [
            json!({"$": "future"}),
            json!({"$": "undefined", "x": 1}),
            json!({"$": "map", "entries": [["a", 1], ["a", 2]]}),
            json!({"$": "number", "value": "Infinity"}),
            json!({"$": "object", "entries": [["a", 1], ["a", 2]]}),
            json!({"$": "u8", "values": [256]}),
            json!({"$": "instance", "name": "x", "entries": []}),
        ];
        for value in &tagged_rejects {
            reject(&mut count, "tagged-value decode", rejects_decode(value));
        }
        let negative_zero_key =
            json!({"$": "map", "entries": [[0, 1], [{"$": "number", "value": "-0"}, 2]]});
        reject(
            &mut count,
            "duplicate Map key with -0 (SameValueZero)",
            rejects_decode(&negative_zero_key),
        );
        let source = load_corpus();
        reject(
            &mut count,
            "unsupported format",
            validate_corpus(&mutated(&source, |body| {
                body["format"] = json!("future");
            }))
            .is_err(),
        );
        reject(
            &mut count,
            "extra top-level key",
            validate_corpus(&mutated(&source, |body| {
                body["extra"] = json!(1);
            }))
            .is_err(),
        );
        for (label, mutate) in [
            ("observe input now +Infinity", control_now as fn(&mut Value)),
            (
                "observe input self without readyAt",
                control_missing_ready_at,
            ),
            ("observe input self unknown status", control_bad_status),
            ("observe input self NaN x", control_nan_x),
            ("observe input viewT -Infinity", control_unknown_view_t),
        ] {
            reject(
                &mut count,
                label,
                validate_corpus(&mutated(&source, mutate)).is_err(),
            );
        }
        reject(
            &mut count,
            "tierValues.orbwalk missing p",
            validate_corpus(&mutated(&source, control_missing_orbwalk_p)).is_err(),
        );
        reject(
            &mut count,
            "duplicate case id",
            validate_corpus(&mutated(&source, control_duplicate_case)).is_err(),
        );
        eprintln!("private tactics source reader controls: {count} rejected");
        assert_eq!(count, 17, "the frozen reader-control negative total");
    }
}
