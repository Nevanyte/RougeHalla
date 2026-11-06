//! Actual initial source loot/travel producers. The sink allocates and stores real objects, in source order.
//! Later pickup, chest choices, consumable use, death drops and lifecycle are separate integrations.
use crate::constants::{PLAYER_RADIUS, TILE};
use crate::geometry::circle_clear;
use crate::map::{TileMap, MASK_MOVE};
use crate::mapdata::{CampDef, FactionRegionDef, GameMapData, LayerData, WorldPt, ZoneSpawn};
use crate::math::Vec2;
use crate::private_rng::{fmix, mixed_salt};
use crate::rng::Mulberry32;
use crate::WeaponId;
mod rules;
pub use rules::{visit_content, Definition, DEFINITION};
#[cfg(test)]
mod tests;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ItemDef {
    PotionSmall,
    Weapon(WeaponId),
}
impl ItemDef {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PotionSmall => "potionSmall",
            Self::Weapon(w) => w.as_str(),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub uid: u64,
    pub def: ItemDef,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Kind {
    Chest,
    Ground,
    Cannon,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialContainer {
    pub id: u32,
    pub kind: Kind,
    pub at: Vec2,
    pub opened: bool,
    pub items: Vec<Item>,
    pub target: Option<Vec2>,
    /// Private source statCrates membership, not a public reveal or reward stream draw.
    pub stat_offer: bool,
}
impl InitialContainer {
    pub fn label(&self) -> String {
        match self.kind {
            Kind::Chest => "Chest".into(),
            Kind::Cannon => "Travel cannon · F to blast".into(),
            Kind::Ground => {
                let ItemDef::Weapon(w) = self.items[0].def else {
                    unreachable!("ground is a weapon")
                };
                let text = w.as_str();
                format!("{}{}", text[..1].to_ascii_uppercase(), &text[1..])
            }
        }
    }
}
/// Implemented by the authoritative construction context. Each call must really allocate/store its object.
/// `next_item_uid` precedes the entity allocation, matching argument evaluation in source spawnLoot/dropWeapon.
pub trait InitialSink {
    fn next_entity_id(&mut self) -> u32;
    fn next_item_uid(&mut self) -> u64;
    fn insert(&mut self, object: InitialContainer);
}
/// Borrowed map inputs; geometry is queried through the admitted collision map's existing circle_clear.
pub struct Input<'a> {
    pub collision: &'a TileMap,
    pub crate_spots: &'a [WorldPt],
    pub ground_spots: &'a [WorldPt],
    pub spawns: &'a [WorldPt],
    pub spawn_pool: &'a [ZoneSpawn],
    pub camps: &'a [CampDef],
    pub regions: &'a [FactionRegionDef],
}
impl<'a> Input<'a> {
    pub fn empty(collision: &'a TileMap) -> Self {
        Self {
            collision,
            crate_spots: &[],
            ground_spots: &[],
            spawns: &[],
            spawn_pool: &[],
            camps: &[],
            regions: &[],
        }
    }
    pub fn from_map(collision: &'a TileMap, map: &'a GameMapData) -> Self {
        Self {
            collision,
            crate_spots: &map.crate_spots,
            ground_spots: &map.ground_spots,
            spawns: &map.spawns,
            spawn_pool: &map.spawn_pool,
            camps: &map.camps,
            regions: &map.regions,
        }
    }
    pub fn from_layers(collision: &'a TileMap, map: &'a LayerData) -> Self {
        Self {
            collision,
            crate_spots: &map.crate_spots,
            ground_spots: &map.ground_spots,
            spawns: &map.spawns,
            spawn_pool: &map.spawn_pool,
            camps: &map.camps,
            regions: &map.regions,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    NonFinitePoint,
}
fn point(p: WorldPt) -> Vec2 {
    Vec2 { x: p.x, y: p.y }
}
fn valid(p: Vec2) -> bool {
    p.x.is_finite() && p.y.is_finite()
}
fn same_tile(a: Vec2, b: Vec2) -> bool {
    libm::floor(a.x / TILE) == libm::floor(b.x / TILE)
        && libm::floor(a.y / TILE) == libm::floor(b.y / TILE)
}
/// Source saltedUnit(hashSalt, CRAT, index), retaining integer wrapping and lane/eat order.
fn crate_score(salt: [u32; 4], index: usize) -> u32 {
    let mut h = salt[0];
    for (offset, part) in [
        DEFINITION.crate_tag,
        index as u32,
        salt[0],
        salt[1],
        salt[2],
        salt[3],
    ]
    .into_iter()
    .enumerate()
    {
        h = fmix((h ^ part).wrapping_add(salt[(offset + 1) & 3].wrapping_mul(0x9e37_79b1)));
    }
    fmix(h)
}
fn roll_weapon(random: &mut Mulberry32) -> WeaponId {
    let total: f64 = DEFINITION.chest_weights.iter().sum();
    let mut r = random.next_f64() * total;
    for (weapon, weight) in WeaponId::ALL[..5].iter().zip(DEFINITION.chest_weights) {
        r -= weight;
        if r < 0.0 {
            return *weapon;
        }
    }
    WeaponId::ALL[4]
}
/// The caller already consumed createWorld's orderSalt draw. This advances only main loot rolls;
/// rosters and their private Sfc32 stream remain owned by the actor/world constructor.
pub fn build_initial(
    input: &Input<'_>,
    training: bool,
    main: &mut Mulberry32,
    reward_words: [u32; 4],
    sink: &mut impl InitialSink,
) -> Result<(), Error> {
    build(input, training, main, reward_words, sink, true)
}
/// The actual loot.install prefix, for an explicit MVP module profile without consumables/travel.
pub fn build_loot(
    input: &Input<'_>,
    training: bool,
    main: &mut Mulberry32,
    reward_words: [u32; 4],
    sink: &mut impl InitialSink,
) -> Result<(), Error> {
    build(input, training, main, reward_words, sink, false)
}
fn build(
    input: &Input<'_>,
    training: bool,
    main: &mut Mulberry32,
    reward_words: [u32; 4],
    sink: &mut impl InitialSink,
    travel: bool,
) -> Result<(), Error> {
    // Complete point admission before drawing or touching the sink, including late travel-only inputs.
    let mut protected: Vec<Vec2> = input.spawns.iter().copied().map(point).collect();
    protected.extend(input.spawn_pool.iter().map(|p| Vec2 { x: p.x, y: p.y }));
    for camp in input.camps {
        protected.push(Vec2 {
            x: camp.x,
            y: camp.y,
        });
        protected.push(point(camp.chest));
        protected.extend(camp.spots.iter().copied().map(point));
    }
    if protected
        .iter()
        .copied()
        .chain(input.crate_spots.iter().copied().map(point))
        .chain(input.ground_spots.iter().copied().map(point))
        .chain(input.regions.iter().map(|r| point(r.pole)))
        .any(|p| !valid(p))
    {
        return Err(Error::NonFinitePoint);
    }
    let mut occupied = Vec::new();
    let hash_salt = mixed_salt(reward_words, DEFINITION.gamble_tag);
    let mut ranked: Vec<usize> = (0..input.crate_spots.len()).collect();
    ranked.sort_by_key(|&i| (crate_score(hash_salt, i), i));
    ranked.truncate(DEFINITION.stat_crates);
    for (i, at) in input.crate_spots.iter().copied().enumerate() {
        let _discarded = roll_weapon(main);
        let item = Item {
            uid: sink.next_item_uid(),
            def: ItemDef::PotionSmall,
        };
        let object = InitialContainer {
            id: sink.next_entity_id(),
            kind: Kind::Chest,
            at: point(at),
            opened: false,
            items: vec![item],
            target: None,
            stat_offer: training || ranked.contains(&i),
        };
        occupied.push(object.at);
        sink.insert(object);
    }
    for at in input.ground_spots.iter().copied() {
        let there = main.next_f64() < DEFINITION.ground_chance;
        let weapon = roll_weapon(main); // Always drawn, including absent drops.
        if there {
            let item = Item {
                uid: sink.next_item_uid(),
                def: ItemDef::Weapon(weapon),
            };
            let object = InitialContainer {
                id: sink.next_entity_id(),
                kind: Kind::Ground,
                at: point(at),
                opened: false,
                items: vec![item],
                target: None,
                stat_offer: false,
            };
            occupied.push(object.at);
            sink.insert(object);
        }
    }
    if training || !travel {
        return Ok(());
    }
    occupied.extend(protected);
    let mut sites = Vec::new();
    for region in input.regions {
        let mut candidates = Vec::new();
        for dy in -DEFINITION.cannon_search_tiles..=DEFINITION.cannon_search_tiles {
            for dx in -DEFINITION.cannon_search_tiles..=DEFINITION.cannon_search_tiles {
                candidates.push(Vec2 {
                    x: region.pole.x + f64::from(dx) * TILE,
                    y: region.pole.y + f64::from(dy) * TILE,
                });
            }
        }
        // Stable sort retains dy/dx enumeration for exact distance ties, as Array.sort does.
        candidates.sort_by(|a, b| {
            libm::hypot(a.x - region.pole.x, a.y - region.pole.y)
                .total_cmp(&libm::hypot(b.x - region.pole.x, b.y - region.pole.y))
        });
        if let Some(at) = candidates.into_iter().find(|&p| {
            circle_clear(input.collision, p, PLAYER_RADIUS, MASK_MOVE)
                && !occupied.iter().any(|&o| same_tile(o, p))
                && !sites.iter().any(|&o| same_tile(o, p))
        }) {
            sites.push(at);
        }
    }
    if sites.len() >= 2 {
        for (i, &at) in sites.iter().enumerate() {
            let target = sites[(i + (sites.len() / 2).max(1)) % sites.len()];
            let id = sink.next_entity_id();
            sink.insert(InitialContainer {
                id,
                kind: Kind::Cannon,
                at,
                opened: false,
                items: Vec::new(),
                target: Some(target),
                stat_offer: false,
            });
        }
    }
    Ok(())
}
