//! Full immutable gameplay map metadata, admitted separately from the collision map.
//! `MapExport::validate` checks both layers together; deserializing `MapLayers`
//! checks metadata references, then `validate_for_tiles` must accompany attachment
//! to a TileMap. No generator/hash-parity claim is made by this import boundary.
mod model;
mod validate;
pub use model::*;
use serde::{Deserialize, Serialize};
pub use validate::MapDataError;

/// Validated immutable metadata. The private fields prevent mutation after admission.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "LayersRepr")]
pub struct MapLayers {
    legacy_map_hash_u32: u32,
    data: LayerData,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayersRepr {
    legacy_map_hash_u32: u32,
    data: LayerData,
}
impl TryFrom<LayersRepr> for MapLayers {
    type Error = MapDataError;
    fn try_from(raw: LayersRepr) -> Result<Self, Self::Error> {
        validate::metadata(&raw.data)?;
        Ok(Self {
            legacy_map_hash_u32: raw.legacy_map_hash_u32,
            data: raw.data,
        })
    }
}
/// Collision data and metadata that passed one combined validation.
#[derive(Clone, Debug, PartialEq)]
pub struct ValidatedMap {
    tiles: Vec<u8>,
    layers: MapLayers,
}
impl ValidatedMap {
    pub fn layers(&self) -> &MapLayers {
        &self.layers
    }
    pub fn tiles(&self) -> &[u8] {
        &self.tiles
    }
    pub fn into_parts(self) -> (u32, u32, Vec<u8>, MapLayers) {
        (
            self.layers.data.w,
            self.layers.data.h,
            self.tiles,
            self.layers,
        )
    }
    pub fn into_export(self) -> MapExport {
        MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: self.layers.legacy_map_hash_u32,
            map: GameMapData::join(self.tiles, self.layers.data),
        }
    }
}
impl MapExport {
    pub fn validate(self) -> Result<ValidatedMap, MapDataError> {
        if self.format != "rh-map/2" {
            return Err(MapDataError::new("format", "expected rh-map/2"));
        }
        let (tiles, data) = self.map.split();
        validate::metadata(&data)?;
        validate::collision(&data, &tiles)?;
        Ok(ValidatedMap {
            tiles,
            layers: MapLayers {
                legacy_map_hash_u32: self.legacy_map_hash_u32,
                data,
            },
        })
    }
}
impl MapLayers {
    pub fn data(&self) -> &LayerData {
        &self.data
    }
    /// An oracle's identity, carried unchanged; Rust has not recomputed this hash.
    pub fn legacy_map_hash_u32(&self) -> u32 {
        self.legacy_map_hash_u32
    }
    pub fn dimensions(&self) -> (u32, u32) {
        (self.data.w, self.data.h)
    }
    pub fn w(&self) -> u32 {
        self.data.w
    }
    pub fn h(&self) -> u32 {
        self.data.h
    }
    pub fn coliseum(&self) -> &ColiseumDef {
        &self.data.coliseum
    }
    /// Rebuild a canonical document from stored immutable metadata and collision.
    /// This preserves the captured legacy hash; it does not verify or recompute it.
    pub fn to_export(&self, tiles: &[u8]) -> Result<MapExport, MapDataError> {
        self.validate_for_tiles(tiles)?;
        Ok(MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: self.legacy_map_hash_u32,
            map: GameMapData::join(tiles.to_vec(), self.data.clone()),
        })
    }
    pub fn validate_for_tiles(&self, tiles: &[u8]) -> Result<(), MapDataError> {
        validate::collision(&self.data, tiles)
    }
    pub fn region_at_world(&self, x: f64, y: f64) -> RegionId {
        self.world_index(x, y)
            .and_then(|i| RegionId::from_code(self.data.region_grid[i]))
            .unwrap_or(RegionId::None)
    }
    pub fn is_coliseum_at_world(&self, x: f64, y: f64) -> bool {
        self.region_at_world(x, y) == RegionId::Coliseum
    }
    /// Exactly the legacy bushAt identity: 1 + the feature's array index, or zero.
    pub fn bush_at_world(&self, x: f64, y: f64) -> u16 {
        let Some(i) = self.world_index(x, y) else {
            return 0;
        };
        let id = self.data.feature_grid[i];
        if id > 0 && self.data.features[id as usize - 1].kind == FeatureKind::Bush {
            u16::from(id)
        } else {
            0
        }
    }
    fn world_index(&self, x: f64, y: f64) -> Option<usize> {
        validate::world_index(&self.data, WorldPt { x, y })
    }
}
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) fn source_terrain_fixture(w: u32, h: u32, terrain: Vec<u8>) -> MapLayers {
    let n = (w * h) as usize;
    MapLayers {
        legacy_map_hash_u32: 0,
        data: LayerData {
            seed: 0,
            w,
            h,
            terrain,
            props: vec![],
            region_grid: vec![0; n],
            attempt: 0,
            territory_grid: vec![0; n],
            coliseum: ColiseumDef {
                rect: TileRect {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 0,
                },
                centre: WorldPt { x: 16., y: 16. },
                gates: vec![],
                inner_spawns: vec![],
            },
            regions: vec![],
            camps: vec![],
            spawn_pool: vec![],
            buildings: vec![],
            spawns: vec![],
            crate_spots: vec![],
            ground_spots: vec![],
            features: vec![],
            feature_grid: vec![0; n],
        },
    }
}
