//! Hitbox archetypes (ADR0024): one row per look that has art, each a small FOOT box for walls and paths and a full-height
//! BODY box for melee and projectile hits, plus the chest height projectiles fly at. Data and pure functions only: no
//! system and no schedule row.
//!
//! Sim axes: +x east, +y south, so north (screen up) is -y. A body box spans `[x - bx, x + bx]` by
//! `[y + oy - by, y + oy + by]` around the feet `(x, y)`; its centre is `chest = -oy` north of the feet, so two equal
//! archetypes are even north and south. Row 0 is `legacy_circle`: the 12 u disc for both walls and hits, chest 0, which is
//! the legacy behaviour bit for bit. Under [`HitboxMode::LegacyCircle`] (the default) every fighter is row 0.
//!
//! The boxed rows are measured from the art (`tools/hitbox-measure/measure.mjs --check` recomputes them from the Unity
//! bake receipt and fails if this table drifts).

use crate::constants::PLAYER_RADIUS;
use crate::content::FactionId;
use crate::fighter::FighterAffiliation;
use crate::geometry::{Aabb, Footprint};
use crate::math::Vec2;
use crate::mob_catalog::MobTypeId;

/// A stable archetype id: append-only, like a protocol bit (it travels on the wire as one byte).
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct ArchetypeId(pub u8);

impl ArchetypeId {
    pub const LEGACY_CIRCLE: Self = Self(0);
    pub const HERO: Self = Self(1);
    pub const HERO_FEMALE: Self = Self(2);
    pub const MAGE: Self = Self(3);
    pub const MAGE_FEMALE: Self = Self(4);
    pub const KNIGHT: Self = Self(5);
    pub const GOBLIN: Self = Self(6);
    pub const SKELETON: Self = Self(7);
    pub const GOBLIN_ELITE: Self = Self(8);
    pub const ANTLION: Self = Self(9);
    pub const SKELETON_ARCHER: Self = Self(10);
    pub const SKELETON_MAGE: Self = Self(11);
    pub const ZOMBIE: Self = Self(12);

    /// The row, or `None` for an id this build does not know.
    pub fn get(self) -> Option<&'static Archetype> {
        ARCHETYPES.get(self.0 as usize)
    }

    /// The row of an id that came from [`assign`] or a validated restore.
    pub fn row(self) -> &'static Archetype {
        self.get().expect("validated archetype id")
    }
}

/// Which hitboxes a match plays with. The default is the legacy circle, so tests, parity runs, benches and the headless
/// runner keep legacy behaviour; only the live server opts in to [`HitboxMode::Archetypes`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HitboxMode {
    #[default]
    LegacyCircle,
    Archetypes,
}

/// A pair of half-extents (east-west, north-south).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Half {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hull {
    /// The legacy disc: walls, paths and hits all use radius `r` around the feet.
    Circle { r: f64 },
    /// A foot box centred on the feet (walls and paths) and a body box offset from the feet (hits).
    Boxes {
        foot: Half,
        body: Half,
        body_offset: (f64, f64),
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Archetype {
    pub id: ArchetypeId,
    /// The Unity catalog appearance key the row was measured from (`legacy_circle` has no art).
    pub key: &'static str,
    pub hull: Hull,
    /// How far above the feet (north, -y) projectiles fly and melee is measured: the body box centre.
    pub chest: f64,
}

/// The foot box every boxed archetype shares. It lies inside the 12 u disc (sqrt(136) = 11.66 < 12), so every position or
/// segment that is clear for the legacy disc is clear for the foot box: spawn, placement and AI clearance stay 12 u.
pub const FOOT: Half = Half { x: 10.0, y: 6.0 };

const fn boxes(id: u8, key: &'static str, bx: f64, by: f64, chest: f64) -> Archetype {
    Archetype {
        id: ArchetypeId(id),
        key,
        hull: Hull::Boxes {
            foot: FOOT,
            body: Half { x: bx, y: by },
            body_offset: (0.0, -chest),
        },
        chest,
    }
}

/// The table (ADR0024 Decision 2). `boxes(id, key, bx, by, chest)`: body half-extents and the chest, with the body offset
/// `(0, -chest)`; the box top is `chest + by` north of the feet and its bottom `by - chest` south of them.
pub const ARCHETYPES: [Archetype; 13] = [
    Archetype {
        id: ArchetypeId(0),
        key: "legacy_circle",
        hull: Hull::Circle { r: PLAYER_RADIUS },
        chest: 0.0,
    },
    boxes(1, "hero", 16.0, 35.0, 30.0),
    boxes(2, "hero-female", 15.0, 35.0, 33.0),
    boxes(3, "mage", 17.0, 28.0, 25.0),
    boxes(4, "mage-female", 17.0, 28.0, 27.0),
    boxes(5, "knight", 18.0, 37.0, 35.0),
    boxes(6, "goblin", 17.0, 22.0, 19.0),
    boxes(7, "skeleton", 18.0, 40.0, 31.0),
    boxes(8, "mob-goblin-elite", 13.0, 18.0, 16.0),
    boxes(9, "mob-antlion", 20.0, 18.0, 11.0),
    boxes(10, "mob-skeleton-archer", 14.0, 24.0, 21.0),
    boxes(11, "mob-skeleton-mage", 14.0, 23.0, 21.0),
    boxes(12, "mob-zombie", 9.0, 21.0, 21.0),
];

impl Archetype {
    /// What the fighter occupies for walls and paths.
    #[inline]
    pub fn foot(&self) -> Footprint {
        match self.hull {
            Hull::Circle { r } => Footprint::Disc(r),
            Hull::Boxes { foot, .. } => Footprint::Box {
                hx: foot.x,
                hy: foot.y,
            },
        }
    }

    /// The body box around feet at `at`, or `None` for the legacy circle.
    #[inline]
    pub fn body_box(&self, at: Vec2) -> Option<Aabb> {
        match self.hull {
            Hull::Circle { .. } => None,
            Hull::Boxes {
                body, body_offset, ..
            } => Some(Aabb::centred(
                Vec2::new(at.x + body_offset.0, at.y + body_offset.1),
                body.x,
                body.y,
            )),
        }
    }

    /// The body offset's north-south part (`-chest` for a boxed row, 0 for the circle).
    #[inline]
    pub fn body_oy(&self) -> f64 {
        match self.hull {
            Hull::Circle { .. } => 0.0,
            Hull::Boxes { body_offset, .. } => body_offset.1,
        }
    }
}

/// What decides a fighter's archetype: public facts only (its kind, its faction, its catalog mob type).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Identity {
    Player(FighterAffiliation),
    Mob(MobTypeId),
    Dummy,
    Zombie,
    QuestGiver,
}

/// The one writer of `FighterCore::archetype`: every fighter constructor calls it.
pub fn assign(mode: HitboxMode, identity: Identity) -> ArchetypeId {
    if mode == HitboxMode::LegacyCircle {
        return ArchetypeId::LEGACY_CIRCLE;
    }
    use ArchetypeId as A;
    use MobTypeId as M;
    match identity {
        Identity::Player(FighterAffiliation::Faction(f)) => match f {
            FactionId::Fire | FactionId::Sentenced => A::HERO,
            FactionId::Plague => A::MAGE,
            FactionId::Frost => A::HERO_FEMALE,
            FactionId::Holy => A::MAGE_FEMALE,
        },
        Identity::Player(FighterAffiliation::Neutral) => A::KNIGHT,
        Identity::Dummy => A::KNIGHT,
        Identity::Zombie => A::ZOMBIE,
        Identity::QuestGiver => A::HERO,
        // Today's art mapping (Unity ShowcaseActorLook), in MobTypeId order.
        Identity::Mob(t) => match t {
            M::EmberImp => A::GOBLIN,
            M::CinderHound => A::ANTLION,
            M::MagmaBrute => A::GOBLIN_ELITE,
            M::FlameCaller => A::SKELETON_MAGE,
            M::Wyrmling => A::GOBLIN_ELITE,
            M::AshDrake => A::ANTLION,
            M::Bailiff => A::SKELETON,
            M::ChainWarden => A::GOBLIN_ELITE,
            M::Inquisitor => A::SKELETON_ARCHER,
            M::Pardoner => A::SKELETON_MAGE,
            M::Executioner => A::GOBLIN_ELITE,
            M::Gaoler => A::SKELETON_MAGE,
            M::PlagueRat => A::ANTLION,
            M::Bloatfly => A::ANTLION,
            M::RotMonk => A::ZOMBIE,
            M::MiasmaWitch => A::MAGE_FEMALE,
            M::RatOgre => A::GOBLIN_ELITE,
            M::PoxBehemoth => A::ZOMBIE,
            M::FrostWisp => A::SKELETON_MAGE,
            M::IceGolem => A::GOBLIN_ELITE,
            M::RimeStalker => A::SKELETON_ARCHER,
            M::FrostbowSentry => A::SKELETON_ARCHER,
            M::GlacialWarden => A::SKELETON,
            M::AvalancheTroll => A::GOBLIN_ELITE,
            M::Acolyte => A::MAGE,
            M::SeraphShard => A::SKELETON_MAGE,
            M::Penitent => A::ZOMBIE,
            M::Zealot => A::HERO,
            M::BloodSaint => A::MAGE_FEMALE,
            M::Archon => A::HERO_FEMALE,
        },
    }
}

/// The rules identity of the table, folded into `content_hash` under the tag `hitbox-archetypes/1`: every row's id, key,
/// hull and chest, and the mapping of every identity under [`HitboxMode::Archetypes`].
pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    word(ARCHETYPES.len() as u64);
    for row in &ARCHETYPES {
        word(u64::from(row.id.0));
        word(row.key.len() as u64);
        for b in row.key.bytes() {
            word(u64::from(b));
        }
        match row.hull {
            Hull::Circle { r } => {
                word(0);
                word(r.to_bits());
            }
            Hull::Boxes {
                foot,
                body,
                body_offset,
            } => {
                word(1);
                for v in [foot.x, foot.y, body.x, body.y, body_offset.0, body_offset.1] {
                    word(v.to_bits());
                }
            }
        }
        word(row.chest.to_bits());
    }
    let mut identities = vec![
        Identity::Player(FighterAffiliation::Neutral),
        Identity::Dummy,
        Identity::Zombie,
        Identity::QuestGiver,
    ];
    identities.extend(
        FactionId::ALL
            .iter()
            .map(|&f| Identity::Player(FighterAffiliation::Faction(f))),
    );
    identities.extend(MobTypeId::ALL.iter().map(|&t| Identity::Mob(t)));
    word(identities.len() as u64);
    for identity in identities {
        word(u64::from(assign(HitboxMode::Archetypes, identity).0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::TILE;

    #[test]
    fn the_table_keeps_its_invariants() {
        for (i, row) in ARCHETYPES.iter().enumerate() {
            assert_eq!(row.id.0 as usize, i, "ids are the row index");
            match row.hull {
                Hull::Circle { r } => {
                    assert_eq!((i, r, row.chest), (0, PLAYER_RADIUS, 0.0));
                }
                Hull::Boxes {
                    foot,
                    body,
                    body_offset,
                } => {
                    // The foot box lies inside the legacy disc and is smaller than a tile.
                    assert!(foot.x * foot.x + foot.y * foot.y <= PLAYER_RADIUS * PLAYER_RADIUS);
                    assert!(2.0 * foot.x.max(foot.y) < TILE);
                    assert_eq!(row.chest, -body_offset.1, "{}", row.key);
                    assert_eq!(body_offset.0, 0.0);
                    for v in [foot.x, foot.y, body.x, body.y, body_offset.1, row.chest] {
                        assert_eq!(v, v.trunc(), "integer values: {}", row.key);
                        assert!(v.abs() <= 127.0, "fits an i8/u8 on the wire: {}", row.key);
                    }
                    // The body box contains the feet's chest point and reaches no lower than a tile below the feet.
                    assert!(body.y >= row.chest && body.y - row.chest < TILE);
                }
            }
        }
        let keys: Vec<_> = ARCHETYPES.iter().map(|r| r.key).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), keys.len(), "unique keys");
    }

    #[test]
    fn legacy_mode_assigns_the_circle_to_everyone() {
        for t in MobTypeId::ALL {
            assert_eq!(
                assign(HitboxMode::LegacyCircle, Identity::Mob(t)),
                ArchetypeId::LEGACY_CIRCLE
            );
            assert_ne!(
                assign(HitboxMode::Archetypes, Identity::Mob(t)),
                ArchetypeId::LEGACY_CIRCLE
            );
        }
        for f in FactionId::ALL {
            let id = Identity::Player(f.into());
            assert_eq!(assign(HitboxMode::LegacyCircle, id), ArchetypeId(0));
            assert!(assign(HitboxMode::Archetypes, id).get().is_some());
        }
        assert_eq!(ArchetypeId(13).get(), None);
    }

    #[test]
    fn the_body_box_is_centred_on_the_chest() {
        let hero = ArchetypeId::HERO.row();
        let b = hero.body_box(Vec2::new(100.0, 200.0)).unwrap();
        assert_eq!((b.x0, b.x1, b.y0, b.y1), (84.0, 116.0, 135.0, 205.0));
        assert_eq!(b.centre(), Vec2::new(100.0, 200.0 - hero.chest));
        assert_eq!(ArchetypeId::LEGACY_CIRCLE.row().body_box(Vec2::new(0.0, 0.0)), None);
        assert_eq!(
            ArchetypeId::LEGACY_CIRCLE.row().foot(),
            Footprint::Disc(PLAYER_RADIUS)
        );
    }
}
