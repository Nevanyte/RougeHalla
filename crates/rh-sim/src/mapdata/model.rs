//! Typed full-layer canonical import/export. The legacy map hash is captured metadata,
//! not a Rust-verified generator hash. Unknown fields are rejected at every record.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldPt {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TilePt {
    pub x: i32,
    pub y: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TileRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Zone {
    Fire,
    Sentenced,
    Plague,
    Frost,
    Holy,
}
impl Zone {
    pub fn code(self) -> u8 {
        match self {
            Self::Fire => 1,
            Self::Sentenced => 2,
            Self::Plague => 3,
            Self::Frost => 4,
            Self::Holy => 5,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fire => "fire",
            Self::Sentenced => "sentenced",
            Self::Plague => "plague",
            Self::Frost => "frost",
            Self::Holy => "holy",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RegionId {
    None,
    Fire,
    Sentenced,
    Plague,
    Frost,
    Holy,
    Coliseum,
}
impl RegionId {
    pub fn code(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Fire => 1,
            Self::Sentenced => 2,
            Self::Plague => 3,
            Self::Frost => 4,
            Self::Holy => 5,
            Self::Coliseum => 6,
        }
    }
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::None),
            1 => Some(Self::Fire),
            2 => Some(Self::Sentenced),
            3 => Some(Self::Plague),
            4 => Some(Self::Frost),
            5 => Some(Self::Holy),
            6 => Some(Self::Coliseum),
            _ => None,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RegionWeapon {
    Sword,
    Bow,
    Wand,
    Shield,
    Axe,
    Fists,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GateSide {
    #[serde(rename = "n")]
    North,
    #[serde(rename = "e")]
    East,
    #[serde(rename = "s")]
    South,
    #[serde(rename = "w")]
    West,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GateDef {
    pub side: GateSide,
    pub tiles: Vec<TilePt>,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColiseumDef {
    pub rect: TileRect,
    pub centre: WorldPt,
    pub gates: Vec<GateDef>,
    pub inner_spawns: Vec<WorldPt>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampDef {
    pub id: String,
    pub zone: Zone,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub spots: Vec<WorldPt>,
    pub elite_spot: i32,
    pub chest: WorldPt,
    pub area: u32,
    pub radius: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobCampDef {
    pub id: String,
    pub region: Zone,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub spots: Vec<WorldPt>,
    pub elite: bool,
    pub weapon: RegionWeapon,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactionRegionDef {
    pub id: Zone,
    pub pole: WorldPt,
    pub area: u32,
    pub spawns: Vec<WorldPt>,
    pub chest_spots: Vec<WorldPt>,
    pub mob_camps: Vec<MobCampDef>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZoneSpawn {
    pub x: f64,
    pub y: f64,
    pub zone: Zone,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeatureKind {
    Landmark,
    Crater,
    LavaRiver,
    FenceRow,
    Gallows,
    Barrow,
    Mere,
    Headland,
    Spire,
    Causeway,
    Hall,
    Infill,
    Bush,
    /// Signature landmark (P-MAPGEN-SIGNATURE-CORE-1, no legacy counterpart): the Plague giant bog tree, its trunk (wall)
    /// and the bog bands round it (floor, terrain bog). Appended: earlier kinds keep their names and discriminants.
    BogTree,
    /// Signature landmark: the Sentenced church, its wall ring round the far elite camp (wall).
    Church,
    /// Signature landmark: the church's graveyard, headstones beyond the door (wall).
    Graveyard,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureJob {
    Landmark,
    Pen,
    Crossing,
    Lane,
    Fork,
    Lee,
    Choke,
    Cover,
    Rest,
    Seal,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapFeature {
    pub kind: FeatureKind,
    pub variant: String,
    pub zone: Zone,
    pub jobs: Vec<FeatureJob>,
    pub ax: i32,
    pub ay: i32,
    /// Legacy's kind-specific ordered integer payload; never dropped or treated as arbitrary JSON.
    pub p: Vec<i32>,
    pub bbox: TileRect,
    pub tiles: u32,
}
/// Cosmetic only, retained losslessly; decor:false exports contain no props.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapProp {
    pub kind: u16,
    pub x: f64,
    pub y: f64,
    pub v: u8,
}
/// One zone's signature anchor (owner rule G3): the landmark that every later step arranges the zone around. Written
/// by the generator only with `pipeline::Options::signature`; a map without anchors serializes exactly as before.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZoneAnchor {
    pub zone: Zone,
    /// The landmark's feature kind (`BogTree`, `Church`, `Hall`).
    pub kind: FeatureKind,
    /// The landmark's centre tile.
    pub centre: TilePt,
    /// Bounding rectangle of the landmark feature's owned tiles (its `bbox`); bands are measured from it.
    pub footprint: TileRect,
    /// DIR16 index (0 = +x, 4 = +y, `landmarks::recipe_support::DIR16`) from the centre toward the coliseum centre.
    pub front: u8,
    /// The way in (the church door), on the footprint's edge facing `front`; empty for a landmark without one.
    pub entrance: Vec<TilePt>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameMapData {
    pub tiles: Vec<u8>,
    pub seed: i64,
    pub w: u32,
    pub h: u32,
    pub terrain: Vec<u8>,
    pub props: Vec<MapProp>,
    pub region_grid: Vec<u8>,
    pub attempt: u64,
    pub territory_grid: Vec<u8>,
    pub coliseum: ColiseumDef,
    pub regions: Vec<FactionRegionDef>,
    pub camps: Vec<CampDef>,
    pub spawn_pool: Vec<ZoneSpawn>,
    pub buildings: Vec<TileRect>,
    pub spawns: Vec<WorldPt>,
    pub crate_spots: Vec<WorldPt>,
    pub ground_spots: Vec<WorldPt>,
    pub features: Vec<MapFeature>,
    pub feature_grid: Vec<u8>,
    /// Signature anchors in zone-code order; omitted from JSON when empty (every legacy-mode map).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub anchors: Vec<ZoneAnchor>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerData {
    pub seed: i64,
    pub w: u32,
    pub h: u32,
    pub terrain: Vec<u8>,
    pub props: Vec<MapProp>,
    pub region_grid: Vec<u8>,
    pub attempt: u64,
    pub territory_grid: Vec<u8>,
    pub coliseum: ColiseumDef,
    pub regions: Vec<FactionRegionDef>,
    pub camps: Vec<CampDef>,
    pub spawn_pool: Vec<ZoneSpawn>,
    pub buildings: Vec<TileRect>,
    pub spawns: Vec<WorldPt>,
    pub crate_spots: Vec<WorldPt>,
    pub ground_spots: Vec<WorldPt>,
    pub features: Vec<MapFeature>,
    pub feature_grid: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapExport {
    pub format: String,
    pub legacy_map_hash_u32: u32,
    pub map: GameMapData,
}

impl GameMapData {
    /// The collision tiles, the sim's layers and the generator's anchors. The anchors stay off `LayerData`: it is
    /// checkpointed sim state, and the decoration bake reads them from the generator's map at pool-build time.
    pub(super) fn split(self) -> (Vec<u8>, LayerData, Vec<ZoneAnchor>) {
        let Self {
            tiles,
            seed,
            w,
            h,
            terrain,
            props,
            region_grid,
            attempt,
            territory_grid,
            coliseum,
            regions,
            camps,
            spawn_pool,
            buildings,
            spawns,
            crate_spots,
            ground_spots,
            features,
            feature_grid,
            anchors,
        } = self;
        (
            tiles,
            LayerData {
                seed,
                w,
                h,
                terrain,
                props,
                region_grid,
                attempt,
                territory_grid,
                coliseum,
                regions,
                camps,
                spawn_pool,
                buildings,
                spawns,
                crate_spots,
                ground_spots,
                features,
                feature_grid,
            },
            anchors,
        )
    }
    pub(super) fn join(tiles: Vec<u8>, data: LayerData, anchors: Vec<ZoneAnchor>) -> Self {
        let LayerData {
            seed,
            w,
            h,
            terrain,
            props,
            region_grid,
            attempt,
            territory_grid,
            coliseum,
            regions,
            camps,
            spawn_pool,
            buildings,
            spawns,
            crate_spots,
            ground_spots,
            features,
            feature_grid,
        } = data;
        Self {
            tiles,
            seed,
            w,
            h,
            terrain,
            props,
            region_grid,
            attempt,
            territory_grid,
            coliseum,
            regions,
            camps,
            spawn_pool,
            buildings,
            spawns,
            crate_spots,
            ground_spots,
            features,
            feature_grid,
            anchors,
        }
    }
}
