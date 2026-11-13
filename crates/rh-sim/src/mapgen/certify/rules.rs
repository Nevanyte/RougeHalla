//! One independent contract definition drives hard checks and content identity.
macro_rules! definition {($($name:ident:$ty:ty=$value:expr;)+)=>{
 #[derive(Clone,Copy,Debug)]pub struct Definition{$(pub $name:$ty,)+}
 pub const R:Definition=Definition{$($name:$value,)+};
 pub fn visit_content(word:impl FnMut(u64)){visit_definition(&R,word)}
 pub fn visit_definition(d:&Definition,mut word:impl FnMut(u64)){ $(word(d.$name as f64 as u64);word((d.$name as f64).to_bits());)+
  word(TERRAIN.len()as u64);for &(tile,home) in &TERRAIN {word(tile as u64);word(home as u64);}
  word(PATH_HAZARDS.len()as u64);for &kind in &PATH_HAZARDS{word(kind as u64);}
  word(PROP_CLASSES.len()as u64);for &c in &PROP_CLASSES{word(c as u64);}
  word(ZONES.len()as u64);for zone in &ZONES{word(zone.code() as u64);}
  word(WEAPONS.len()as u64);for weapon in &WEAPONS{word(*weapon as u64);}
  word(LANDMARKS.len()as u64);for (name,zone) in &LANDMARKS{word(name.len() as u64);for b in name.bytes(){word(b as u64);}word(zone.code()as u64);}
  word(KINDS.len()as u64);for row in &KINDS{word(row.kind as u64);word(row.params_min as u64);word(row.wall as u64);word(row.low as u64);word(row.terrain as u64);word(row.jobs.len()as u64);for j in row.jobs{word(*j as u64);}}
 }
}}
definition! {
 size:usize=160; tile:f64=32.0; auto_strict:u8=1; eps:f64=1e-9;
 gates:usize=4; gate_width:usize=4; gate_lane:i32=3; players:usize=8;
 area_spread:usize=8; floor_share:f64=1.15; ring:i32=3; ring_contact:usize=24; slivers:usize=100;
 camps:usize=10; elites:usize=2; elite_sep:f64=16.0; camp_gap:f64=9.0; clearing:f64=2.5;
 territory_radius:f64=30.0; radius_eps:f64=1e-6; spots_min:usize=3; spots_max:usize=5;
 pool_min:usize=24; pool_max:usize=32; pool_zones:usize=4; spawn_sep:f64=5.0; spawn_camp:f64=5.0; spawn_safe:f64=10.0; walk_ratio:f64=1.2; walk_hazards:usize=8;
 crates_min:usize=4; crates_max:usize=6; ground_min:usize=30; ground_max:usize=45;
 features:usize=250; piece_min:usize=6; landmark_floor:f64=0.6; landmark_gap:i32=3;
 camp_span:i32=3; halo:i32=1; protection_span:i32=4; clearing_cover_span:i32=2;
 spawn_pad:i32=1; spawn_hazard:i32=2; crate_pad:i32=1; ground_hazard:i32=1;
 crate_spawn_gap:usize=3; crate_spot_gap:usize=2; crate_camp_gap:usize=3; crate_pair_gap:usize=2;
 ground_spawn_gap:f64=3.0; ground_crate_gap:usize=2; border_margin:i32=2;
 landmark_margin:i32=1; jobs_max:usize=2; square_side:usize=3; direction_count:i32=16; hall_pitch:i32=6; rotation_count:i32=4; ice:u8=6; fence_kind:u8=2;
 max_metadata:usize=512; max_strict_codes:usize=256; max_camp_radius_tiles:f64=8.0;
 fence_reach:i32=3; fence_detour:usize=10; fence_run:usize=9; fence_search:usize=40; snap:usize=4;
}
/// (required class, home zone), NONE's class is the sentinel 255.
pub const TERRAIN: [(u8, u8); 8] = [
    (255, 0),
    (2, 1),
    (2, 2),
    (2, 4),
    (0, 1),
    (0, 3),
    (0, 4),
    (0, 5),
];
pub const PROP_CLASSES: [u8; 34] = [
    0, 1, 1, 0, 1, 2, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0,
    0, 0,
];
use crate::mapdata::{FeatureJob as J, FeatureKind as K};
pub struct Kind {
    pub kind: K,
    pub params_min: usize,
    pub wall: bool,
    pub low: bool,
    pub terrain: u8,
    pub jobs: &'static [J],
}
pub const KINDS: [Kind; 13] = [
    Kind {
        kind: K::Landmark,
        params_min: 3,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark, J::Lee, J::Fork, J::Rest],
    },
    Kind {
        kind: K::Crater,
        params_min: 3,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Pen],
    },
    Kind {
        kind: K::LavaRiver,
        params_min: 2,
        wall: false,
        low: true,
        terrain: 1,
        jobs: &[J::Crossing],
    },
    Kind {
        kind: K::FenceRow,
        params_min: 3,
        wall: false,
        low: true,
        terrain: R.fence_kind,
        jobs: &[J::Lane],
    },
    Kind {
        kind: K::Gallows,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::Barrow,
        params_min: 4,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Fork, J::Choke],
    },
    Kind {
        kind: K::Mere,
        params_min: 2,
        wall: false,
        low: false,
        terrain: 0,
        jobs: &[J::Crossing],
    },
    Kind {
        kind: K::Headland,
        params_min: 1,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Lee],
    },
    Kind {
        kind: K::Spire,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::Causeway,
        params_min: 0,
        wall: false,
        low: false,
        terrain: 0,
        jobs: &[J::Crossing, J::Lee],
    },
    Kind {
        kind: K::Hall,
        params_min: 5,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Cover, J::Rest],
    },
    Kind {
        kind: K::Infill,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Seal],
    },
    Kind {
        kind: K::Bush,
        params_min: 2,
        wall: false,
        low: false,
        terrain: 0,
        jobs: &[J::Cover],
    },
];
/// The signature landmarks' kinds (P-MAPGEN-SIGNATURE-CORE-1; no legacy counterpart), kept apart from the legacy
/// table above so that table, and `content_hash`, stay the source's own: only maps generated with
/// `pipeline::Options::signature` (default off) carry these kinds. No params; the map's anchor carries their geometry.
///
/// Fire (P-MAPGEN-SIG-FIRE-1): `Volcano` may hold wall (the cone) and LOW tiles, which must be lava (a lava crater);
/// `LavaStream` and `LavaPool` hold only LOW lava (never wall), like the legacy `LavaRiver` row they replace in
/// signature mode, and own their ember edge as floor (the certifier's `feature-hazards` rule fails unowned hazard
/// floor). Every wall or LOW piece needs `piece_min` solid tiles (`feature-size`).
///
/// Frost (P-MAPGEN-SIG-FROST-1): `Cave` is a wall chamber (the ring) that owns its ice floor. Wall, no LOW (the
/// chamber holds no water or chasm), terrain 0 (the row's terrain binds LOW tiles only; owned floor may carry any
/// terrain, and owning the ice is what `feature-hazards` asks of hazard floor in a strict zone), job landmark. The ice
/// is the cave's own, not a `Mere`: a mere's params count its lake's ice (`feature-params`), and the Frost styler's
/// lakes are numbered by its plan. Ice must still keep floor on all eight sides (`ice-neighbours`) and stay off camp
/// clearings and halos (`terrain-protected`).
///
/// Plague (P-LAND-PLAGUE-1): `BogPool` is one free pool of the Plague styler in signature mode: owned floor carrying
/// terrain bog (owning it is what `feature-hazards` asks of hazard floor in a strict zone). No wall, no LOW, terrain 0
/// (the row's terrain binds LOW tiles only), no params, job crossing.
pub const SIGNATURE_KINDS: [Kind; 8] = [
    Kind {
        kind: K::BogTree,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::Church,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::Graveyard,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Cover],
    },
    Kind {
        kind: K::Volcano,
        params_min: 0,
        wall: true,
        low: true,
        terrain: 1,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::LavaStream,
        params_min: 0,
        wall: false,
        low: true,
        terrain: 1,
        jobs: &[J::Crossing],
    },
    Kind {
        kind: K::LavaPool,
        params_min: 0,
        wall: false,
        low: true,
        terrain: 1,
        jobs: &[J::Crossing],
    },
    Kind {
        kind: K::Cave,
        params_min: 0,
        wall: true,
        low: false,
        terrain: 0,
        jobs: &[J::Landmark],
    },
    Kind {
        kind: K::BogPool,
        params_min: 0,
        wall: false,
        low: false,
        terrain: 0,
        jobs: &[J::Crossing],
    },
];
/// The certifier's row for a feature kind: the legacy table, then the signature table.
pub fn kind(k: K) -> &'static Kind {
    KINDS
        .iter()
        .chain(&SIGNATURE_KINDS)
        .find(|r| r.kind == k)
        .expect("every feature kind has a certifier row")
}

pub const PATH_HAZARDS: [u8; 3] = [4, 5, R.ice];

pub const ZONES: [crate::mapdata::Zone; 5] = [
    crate::mapdata::Zone::Fire,
    crate::mapdata::Zone::Sentenced,
    crate::mapdata::Zone::Plague,
    crate::mapdata::Zone::Frost,
    crate::mapdata::Zone::Holy,
];
pub const WEAPONS: [crate::mapdata::RegionWeapon; 5] = [
    crate::mapdata::RegionWeapon::Axe,
    crate::mapdata::RegionWeapon::Sword,
    crate::mapdata::RegionWeapon::Bow,
    crate::mapdata::RegionWeapon::Shield,
    crate::mapdata::RegionWeapon::Wand,
];
pub const LANDMARKS: [(&str, crate::mapdata::Zone); 5] = [
    ("forge", crate::mapdata::Zone::Fire),
    ("guardHouse", crate::mapdata::Zone::Sentenced),
    ("burrow", crate::mapdata::Zone::Plague),
    ("watchtower", crate::mapdata::Zone::Frost),
    ("shrine", crate::mapdata::Zone::Holy),
];
