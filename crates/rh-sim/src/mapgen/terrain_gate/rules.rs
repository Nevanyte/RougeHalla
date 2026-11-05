//! Generator acceptance data only. Physical classes, movement mask, tile scale and snap radius
//! reuse the existing content identity. Gameplay surface effects belong to a later packet.
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerrainKind {
    pub key: &'static str,
    pub tile: Option<u8>,
    pub home: Option<u8>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PropKind<'a> {
    pub key: &'a str,
    pub on: u8,
}
#[derive(Clone, Copy, Debug)]
pub struct TerrainGateDefinition<'a> {
    pub kinds: &'a [TerrainKind],
    pub props: &'a [PropKind<'a>],
    pub ice: u8,
    pub spawn_hazard_half: i64,
    pub loot_hazard_half: i64,
    pub camp_hazard_half: i64,
}
pub const KINDS: [TerrainKind; 8] = [
    TerrainKind {
        key: "none",
        tile: None,
        home: None,
    },
    TerrainKind {
        key: "lava",
        tile: Some(TILE_LOW),
        home: Some(1),
    },
    TerrainKind {
        key: "fence",
        tile: Some(TILE_LOW),
        home: Some(2),
    },
    TerrainKind {
        key: "crevasse",
        tile: Some(TILE_LOW),
        home: Some(4),
    },
    TerrainKind {
        key: "ember",
        tile: Some(TILE_FLOOR),
        home: Some(1),
    },
    TerrainKind {
        key: "bog",
        tile: Some(TILE_FLOOR),
        home: Some(3),
    },
    TerrainKind {
        key: "ice",
        tile: Some(TILE_FLOOR),
        home: Some(4),
    },
    TerrainKind {
        key: "light",
        tile: Some(TILE_FLOOR),
        home: Some(5),
    },
];
pub const PROPS: [PropKind<'static>; 34] = [
    PropKind {
        key: "ember_vent",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "glow_crack",
        on: TILE_WALL,
    },
    PropKind {
        key: "basalt_shard",
        on: TILE_WALL,
    },
    PropKind {
        key: "ash_drift",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "banner",
        on: TILE_WALL,
    },
    PropKind {
        key: "chain",
        on: TILE_LOW,
    },
    PropKind {
        key: "gallows",
        on: TILE_WALL,
    },
    PropKind {
        key: "cell_bars",
        on: TILE_WALL,
    },
    PropKind {
        key: "lantern",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "fungus_cap",
        on: TILE_WALL,
    },
    PropKind {
        key: "bubble",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "drip",
        on: TILE_WALL,
    },
    PropKind {
        key: "pipe",
        on: TILE_WALL,
    },
    PropKind {
        key: "ice_spire",
        on: TILE_WALL,
    },
    PropKind {
        key: "snow_drift",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "frost_sparkle",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "icicle",
        on: TILE_WALL,
    },
    PropKind {
        key: "column_cap",
        on: TILE_WALL,
    },
    PropKind {
        key: "banner_red",
        on: TILE_WALL,
    },
    PropKind {
        key: "candelabra",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "rubble",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "stained_glass",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "crater_lip",
        on: TILE_WALL,
    },
    PropKind {
        key: "anvil",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "slag_heap",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "gate_post",
        on: TILE_LOW,
    },
    PropKind {
        key: "stocks",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "tunnel_beam",
        on: TILE_WALL,
    },
    PropKind {
        key: "burrow_rubble",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "reed",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "tower_frost",
        on: TILE_WALL,
    },
    PropKind {
        key: "ice_crack",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "altar",
        on: TILE_FLOOR,
    },
    PropKind {
        key: "brazier",
        on: TILE_FLOOR,
    },
];
pub const DEFAULT_DEFINITION: TerrainGateDefinition<'static> = TerrainGateDefinition {
    kinds: &KINDS,
    props: &PROPS,
    ice: 6,
    spawn_hazard_half: 2,
    loot_hazard_half: 1,
    camp_hazard_half: 1,
};
pub fn default_definition() -> TerrainGateDefinition<'static> {
    DEFAULT_DEFINITION
}
/// Stable ordered visitor, with string byte lengths so adjacent keys cannot alias. No allocations.
pub fn visit_content(d: &TerrainGateDefinition<'_>, mut word: impl FnMut(u64)) {
    word(d.kinds.len() as u64);
    for k in d.kinds {
        word(k.key.len() as u64);
        for b in k.key.bytes() {
            word(u64::from(b));
        }
        word(k.tile.map_or(256, u64::from));
        word(k.home.map_or(256, u64::from));
    }
    word(d.props.len() as u64);
    for p in d.props {
        word(p.key.len() as u64);
        for b in p.key.bytes() {
            word(u64::from(b));
        }
        word(u64::from(p.on));
    }
    word(u64::from(d.ice));
    word(d.spawn_hazard_half as u64);
    word(d.loot_hazard_half as u64);
    word(d.camp_hazard_half as u64);
}
