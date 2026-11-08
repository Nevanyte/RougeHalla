//! The docs/TELEMETRY.md RunRecord v1 shape, as a fixture-consumer type surface only.
//!
//! SOURCE OF TRUTH: parity/telemetry/run-record.json is one REAL RunRecord captured from the unmodified legacy recorder
//! in the pinned linux/amd64 Node 22.23.4 container (tools/bot-telemetry-fixtures). This module ports the record's
//! SHAPE: every field in the serializer's exact order, the optional fields at the positions the source spreads them, and
//! the null-vs-absent distinction (a source field that is always emitted even when null is a plain Option here; a source
//! optional field is skipped when absent). The parity test deserializes the captured source NDJSON line and re-serializes
//! it byte-identically; no value is fabricated and no runtime path consumes this type.
//!
//! NOT A RUNNER FEATURE (yet): nothing in the tournament runner emits or fills a RunRecord. Producing the VALUES needs
//! the read-only recorder seam inside rh-sim (follow-up A in docs/evidence/stage2-bots-telemetry/SCOPED_PLAN.md, needs a
//! lead-approved write-scope extension) and the Room-owned fill/writer fields (follow-up B). This surface exists so the
//! lead's producer-wiring decision can start from a pinned, tested record shape instead of a reinterpretation.
//!
//! Representation choices, all deliberate for exact source bytes:
//! - Numbers are JsNumber (a serde_json::Number wrapper): the source serializes with JSON.stringify, so an integral 530
//!   must stay 530 (not 530.0) and a decimal 0.5 must keep its representation. No Rust float is involved.
//! - By-name maps (damage/heal/gv/weaponMs/zoneMs/cards/boosts/trophies/mobStats/mobKills) are OrderedMap: the source
//!   object insertion order is part of the serialized bytes.
//! - Value-domain names (factions, weapons, regions, death kinds, damage sources, ability/signature ids, win-bonus
//!   reasons, ...) are Strings here; mapping them onto the Rust domain enums belongs to the producer-wiring slice, and
//!   doing it here would change the serialized bytes without the source record to prove it.
//! - Optional coverage: the captured run has no death causes, camps, snapshots, bot tags, client perf, planningMia,
//!   truncated counters or non-empty tiles; those fields exist in the shape (from the shared record contract) but this
//!   fixture does not exercise their values (see the SCOPED_PLAN coverage note).
use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// A JSON number exactly as the source serialized it (JSON.stringify representation preserved).
#[derive(Clone, Debug, PartialEq)]
pub struct JsNumber(pub serde_json::Number);

impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for JsNumber {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        serde_json::Number::deserialize(deserializer).map(JsNumber)
    }
}

impl JsNumber {
    pub fn as_u64(&self) -> Option<u64> {
        self.0.as_u64()
    }
    pub fn as_f64(&self) -> Option<f64> {
        self.0.as_f64()
    }
}

/// A required NULLABLE source field: the key is always emitted (a null is meaningful) and must be present in the input,
/// unlike an Option that serde would let a missing key satisfy.
fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// A by-name map whose serialized key order is the source object's insertion order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OrderedMap<T> {
    pub entries: Vec<(String, T)>,
}

impl<T: Serialize> Serialize for OrderedMap<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.entries.len()))?;
        for (key, value) in &self.entries {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for OrderedMap<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct OrderedVisitor<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for OrderedVisitor<T> {
            type Value = OrderedMap<T>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object preserving its key order")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut access: M) -> Result<Self::Value, M::Error> {
                let mut entries = Vec::with_capacity(access.size_hint().unwrap_or(0));
                while let Some((key, value)) = access.next_entry::<String, T>()? {
                    entries.push((key, value));
                }
                Ok(OrderedMap { entries })
            }
        }
        deserializer.deserialize_map(OrderedVisitor(std::marker::PhantomData))
    }
}

/// BuildInfo: always present; commit is a nullable string (the Worker may fill a null later).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuildInfo {
    pub server: String,
    #[serde(deserialize_with = "required_option")]
    pub commit: Option<String>,
}

/// The stat block shared by BuildSnapshot and PowerSnapshot (source TelemetryStats).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TelemetryStats {
    #[serde(rename = "maxHp")]
    pub max_hp: JsNumber,
    pub ad: JsNumber,
    pub ap: JsNumber,
    pub armor: JsNumber,
    pub shield: JsNumber,
    #[serde(rename = "asMult")]
    pub as_mult: JsNumber,
    #[serde(rename = "speedMult")]
    pub speed_mult: JsNumber,
}

/// The per-player final build snapshot (source BuildSnapshot).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuildSnapshot {
    #[serde(flatten)]
    pub stats: TelemetryStats,
    pub cards: OrderedMap<JsNumber>,
    #[serde(rename = "cardPower")]
    pub card_power: JsNumber,
    pub boosts: OrderedMap<JsNumber>,
    #[serde(rename = "boostsTotal")]
    pub boosts_total: JsNumber,
    pub trophies: OrderedMap<JsNumber>,
    #[serde(rename = "mobStats")]
    pub mob_stats: OrderedMap<JsNumber>,
    #[serde(rename = "mobStatsTotal")]
    pub mob_stats_total: JsNumber,
}

/// A power snapshot at one of TELEMETRY_SNAPSHOT_MINUTES (source PowerSnapshot; order from the interface).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PowerSnapshot {
    pub minute: JsNumber,
    #[serde(flatten)]
    pub stats: TelemetryStats,
    #[serde(rename = "cardPower")]
    pub card_power: JsNumber,
    #[serde(rename = "mobStatsTotal")]
    pub mob_stats_total: JsNumber,
    #[serde(rename = "boostsTotal")]
    pub boosts_total: JsNumber,
}

/// A death cause (source DeathCause); every optional member is absent when the source leaves it out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeathCause {
    pub kind: String,
    pub at: JsNumber,
    pub zone: String,
    pub coliseum: bool,
    #[serde(rename = "bySlot", default, skip_serializing_if = "Option::is_none")]
    pub by_slot: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ability: Option<String>,
    #[serde(rename = "mobType", default, skip_serializing_if = "Option::is_none")]
    pub mob_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camp: Option<JsNumber>,
}

/// The caster's Wish accounting (source WishStats).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WishStats {
    pub casts: JsNumber,
    pub landed: JsNumber,
    pub fizzled: JsNumber,
    pub interrupted: JsNumber,
    pub cancelled: JsNumber,
    pub hits: JsNumber,
    pub damage: JsNumber,
}

/// The client's one perf sample (source ClientPerfSample): every field optional and clamped.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClientPerfSample {
    pub v: JsNumber,
    #[serde(rename = "fpsP50", default, skip_serializing_if = "Option::is_none")]
    pub fps_p50: Option<JsNumber>,
    #[serde(
        rename = "frameMsP95",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub frame_ms_p95: Option<JsNumber>,
    #[serde(
        rename = "frameMsP99",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub frame_ms_p99: Option<JsNumber>,
    #[serde(
        rename = "longFrames",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub long_frames: Option<JsNumber>,
    #[serde(rename = "rttP50", default, skip_serializing_if = "Option::is_none")]
    pub rtt_p50: Option<JsNumber>,
    #[serde(rename = "rttP95", default, skip_serializing_if = "Option::is_none")]
    pub rtt_p95: Option<JsNumber>,
    #[serde(
        rename = "rttSamples",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub rtt_samples: Option<JsNumber>,
    #[serde(
        rename = "interpDelayMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub interp_delay_ms: Option<JsNumber>,
    #[serde(rename = "hiddenSec", default, skip_serializing_if = "Option::is_none")]
    pub hidden_sec: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpr: Option<JsNumber>,
    #[serde(rename = "canvasW", default, skip_serializing_if = "Option::is_none")]
    pub canvas_w: Option<JsNumber>,
    #[serde(rename = "canvasH", default, skip_serializing_if = "Option::is_none")]
    pub canvas_h: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ua: Option<String>,
}

/// The Room-owned connection counters (source NetStats).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NetStats {
    pub drops: JsNumber,
    pub reconnects: JsNumber,
}

/// The spawn point a player started on (source PlayerRecord.spawn).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Spawn {
    pub zone: String,
    pub tx: JsNumber,
    pub ty: JsNumber,
    pub picked: bool,
}

/// Damage split between players and mobs (source PlayerRecord.dealt).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DamageSplit {
    pub players: OrderedMap<JsNumber>,
    pub mobs: OrderedMap<JsNumber>,
}

/// Potion accounting (source PlayerRecord.potions).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Potions {
    pub small: JsNumber,
    pub large: JsNumber,
    pub granted: JsNumber,
}

/// Quest ids (source PlayerRecord.quests).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Quests {
    pub accepted: Vec<String>,
    pub completed: Vec<String>,
}

/// One player's record, in the source runtime's serialization order: the recorder draft fields first, then the
/// Room-owned fields the runtime appends (pid, optional bot tag, net, optional client perf, afk).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlayerRecord {
    pub slot: JsNumber,
    pub bot: bool,
    pub faction: String,
    pub spawn: Spawn,
    pub place: JsNumber,
    pub outcome: String,
    #[serde(rename = "aliveMs")]
    pub alive_ms: JsNumber,
    #[serde(deserialize_with = "required_option")]
    pub death: Option<DeathCause>,
    pub kills: JsNumber,
    #[serde(rename = "botKills")]
    pub bot_kills: JsNumber,
    #[serde(rename = "weaponMs")]
    pub weapon_ms: OrderedMap<JsNumber>,
    #[serde(rename = "mainWeapon")]
    pub main_weapon: String,
    #[serde(rename = "zoneMs")]
    pub zone_ms: OrderedMap<JsNumber>,
    #[serde(rename = "final")]
    pub final_build: BuildSnapshot,
    pub snapshots: Vec<PowerSnapshot>,
    #[serde(rename = "mobKills")]
    pub mob_kills: OrderedMap<JsNumber>,
    #[serde(rename = "eliteKills")]
    pub elite_kills: JsNumber,
    #[serde(rename = "campsCleared")]
    pub camps_cleared: JsNumber,
    #[serde(rename = "farmMs")]
    pub farm_ms: JsNumber,
    pub dealt: DamageSplit,
    pub taken: OrderedMap<JsNumber>,
    pub overkill: JsNumber,
    pub healed: OrderedMap<JsNumber>,
    pub wish: WishStats,
    pub potions: Potions,
    pub quests: Quests,
    pub gv: OrderedMap<JsNumber>,
    #[serde(
        rename = "winBonusWithheld",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub win_bonus_withheld: Option<bool>,
    #[serde(
        rename = "winBonusWhy",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub win_bonus_why: Option<String>,
    pub quit: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiles: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub pid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,
    pub net: NetStats,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<ClientPerfSample>,
    #[serde(rename = "afkMs")]
    pub afk_ms: JsNumber,
    pub afk: bool,
}

/// One side of a duel segment (source DuelSide).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DuelSide {
    pub slot: JsNumber,
    pub bot: bool,
    pub faction: String,
    pub weapon: String,
    #[serde(rename = "weaponsUsed")]
    pub weapons_used: Vec<String>,
    pub augments: Vec<String>,
    #[serde(rename = "cardPower")]
    pub card_power: JsNumber,
    #[serde(rename = "mobStatsTotal")]
    pub mob_stats_total: JsNumber,
    #[serde(rename = "boostsTotal")]
    pub boosts_total: JsNumber,
    pub hp: JsNumber,
    #[serde(rename = "hpEnd")]
    pub hp_end: JsNumber,
    pub dmg: OrderedMap<JsNumber>,
    pub wishes: JsNumber,
    pub terrain: String,
}

/// One duel segment (source DuelRecord).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DuelRecord {
    pub i: JsNumber,
    pub start: JsNumber,
    pub end: JsNumber,
    pub sides: [DuelSide; 2],
    pub first: JsNumber,
    pub outcome: String,
    pub winner: JsNumber,
    pub third: JsNumber,
    pub clean: bool,
    pub zone: String,
    pub coliseum: bool,
    #[serde(deserialize_with = "required_option")]
    pub comeback: Option<bool>,
}

/// One offer and its picks (source OfferRecord).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OfferPick {
    pub slot: JsNumber,
    pub option: JsNumber,
    pub at: JsNumber,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OfferRecord {
    pub i: JsNumber,
    pub kind: String,
    pub at: JsNumber,
    pub camp: JsNumber,
    pub elite: bool,
    pub options: Vec<String>,
    pub eligible: Vec<JsNumber>,
    pub picks: Vec<OfferPick>,
}

/// One camp clear (source CampClearRecord).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CampClearRecord {
    pub camp: JsNumber,
    pub cycle: JsNumber,
    pub zone: String,
    #[serde(rename = "type")]
    pub kind_name: String,
    pub elite: String,
    #[serde(rename = "engagedAt")]
    pub engaged_at: JsNumber,
    #[serde(rename = "clearedAt")]
    pub cleared_at: JsNumber,
    #[serde(rename = "killerSlot")]
    pub killer_slot: JsNumber,
    pub contributors: Vec<JsNumber>,
    #[serde(rename = "playerDeaths")]
    pub player_deaths: JsNumber,
}

/// What a cap dropped (source RunRecord.truncated).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Truncated {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duels: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offers: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camps: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub samples: Option<JsNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiles: Option<bool>,
}

/// The run's event timing (source coliseum).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Coliseum {
    pub teleports: Vec<JsNumber>,
    #[serde(rename = "suddenDeath")]
    pub sudden_death: Vec<JsNumber>,
}

/// The first player down with outcome died (source firstBlood).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FirstBlood {
    pub at: JsNumber,
    pub victim: JsNumber,
    pub killer: JsNumber,
}

/// The run's sim config plus the room's fill count (source RunRecord.config).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RunConfig {
    #[serde(rename = "planSeconds")]
    pub plan_seconds: JsNumber,
    pub quests: bool,
    pub mobs: bool,
    #[serde(rename = "coliseumSchedule")]
    pub coliseum_schedule: bool,
    #[serde(rename = "botsFillTo")]
    pub bots_fill_to: JsNumber,
}

/// One finished run, in the exact serialization order the captured source record shows: the recorder draft fields
/// first, then the Room-owned fields the runtime appends (runId, source, build, startedAtEpoch, endedAtEpoch).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RunRecord {
    pub v: JsNumber,
    pub kind: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: JsNumber,
    pub end: String,
    pub seed: JsNumber,
    pub attempt: JsNumber,
    #[serde(rename = "mapHash")]
    pub map_hash: JsNumber,
    pub config: RunConfig,
    pub humans: JsNumber,
    pub bots: JsNumber,
    pub players: Vec<PlayerRecord>,
    #[serde(rename = "winnerSlot")]
    pub winner_slot: JsNumber,
    #[serde(rename = "winBonusPaid")]
    pub win_bonus_paid: bool,
    pub coliseum: Coliseum,
    #[serde(rename = "firstBlood", deserialize_with = "required_option")]
    pub first_blood: Option<FirstBlood>,
    #[serde(
        rename = "planningMia",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub planning_mia: Option<JsNumber>,
    pub duels: Vec<DuelRecord>,
    pub offers: Vec<OfferRecord>,
    pub camps: Vec<CampClearRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<Truncated>,
    #[serde(rename = "runId")]
    pub run_id: String,
    pub source: String,
    pub build: BuildInfo,
    #[serde(rename = "startedAtEpoch")]
    pub started_at_epoch: JsNumber,
    #[serde(rename = "endedAtEpoch")]
    pub ended_at_epoch: JsNumber,
}

/// Parse one source RunRecord NDJSON line into the ported shape.
pub fn record_from_line(line: &str) -> Result<RunRecord, serde_json::Error> {
    serde_json::from_str(line)
}

/// Serialize the ported shape the way the source's JSON.stringify does for the same object.
pub fn record_to_line(record: &RunRecord) -> String {
    serde_json::to_string(record).expect("a RunRecord serializes")
}
