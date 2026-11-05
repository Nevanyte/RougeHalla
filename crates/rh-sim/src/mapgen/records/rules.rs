use crate::mapdata::{RegionWeapon, Zone};

/// Canonical faction and default mob-weapon policy, borrowed by runtime and identity.
#[derive(Clone, Copy)]
pub struct Definition<'a> {
    pub factions: &'a [(Zone, RegionWeapon)],
    pub terrain_ice: u8,
}
pub const DEFAULT_DEFINITION: Definition<'static> = Definition {
    factions: &[
        (Zone::Fire, RegionWeapon::Axe),
        (Zone::Sentenced, RegionWeapon::Sword),
        (Zone::Plague, RegionWeapon::Bow),
        (Zone::Frost, RegionWeapon::Shield),
        (Zone::Holy, RegionWeapon::Wand),
    ],
    terrain_ice: 6,
};
pub fn default_definition() -> Definition<'static> {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    word(d.factions.len() as u64);
    for &(f, w) in d.factions {
        word(u64::from(f.code()));
        word(match w {
            RegionWeapon::Sword => 1,
            RegionWeapon::Bow => 2,
            RegionWeapon::Wand => 3,
            RegionWeapon::Shield => 4,
            RegionWeapon::Axe => 5,
            RegionWeapon::Fists => 6,
        });
    }
    word(u64::from(d.terrain_ice));
}
