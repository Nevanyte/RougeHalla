//! Aggregate identity coverage for generator-owned record and terrain gate inputs.
use rh_sim::content::{
    content_hash, content_hash_of_records_definition, content_hash_of_terrain_gate_definition,
    REGISTRY, STAGGER_WEAPONS,
};
use rh_sim::mapdata::{RegionWeapon, Zone};
use rh_sim::mapgen::{records, terrain_gate};

fn records_hash(d: &records::Definition<'_>) -> u64 {
    content_hash_of_records_definition(REGISTRY, STAGGER_WEAPONS, d)
}

fn terrain_hash(d: &terrain_gate::TerrainGateDefinition<'_>) -> u64 {
    content_hash_of_terrain_gate_definition(REGISTRY, STAGGER_WEAPONS, d)
}

fn assert_records_changed(base: u64, d: &records::Definition<'_>, label: &str) {
    assert_ne!(base, records_hash(d), "records hash omitted {label}");
}

fn assert_terrain_changed(base: u64, d: &terrain_gate::TerrainGateDefinition<'_>, label: &str) {
    assert_ne!(base, terrain_hash(d), "terrain gate hash omitted {label}");
}

#[test]
fn records_identity_covers_every_entry_order_length_and_ice_value() {
    let base = records::default_definition();
    let baseline = records_hash(&base);
    assert_eq!(baseline, content_hash());
    let records::Definition {
        factions: _,
        terrain_ice: _,
    } = base;
    assert_eq!(base.factions.len(), 5);

    let entries = [
        (Zone::Fire, RegionWeapon::Axe),
        (Zone::Sentenced, RegionWeapon::Sword),
        (Zone::Plague, RegionWeapon::Bow),
        (Zone::Frost, RegionWeapon::Shield),
        (Zone::Holy, RegionWeapon::Wand),
    ];
    assert_eq!(base.factions, &entries);
    for (index, entry) in entries.into_iter().enumerate() {
        let mut factions = base.factions.to_vec();
        let different_weapon = if entry.1 == RegionWeapon::Fists {
            RegionWeapon::Axe
        } else {
            RegionWeapon::Fists
        };
        factions[index] = (entry.0, different_weapon);
        let d = records::Definition {
            factions: &factions,
            ..base
        };
        assert_records_changed(baseline, &d, "each faction weapon entry");

        let different_zone = if entry.0 == Zone::Fire {
            Zone::Holy
        } else {
            Zone::Fire
        };
        factions[index] = (different_zone, entry.1);
        let d = records::Definition {
            factions: &factions,
            ..base
        };
        assert_records_changed(baseline, &d, "each faction entry");
    }
    {
        let mut factions = base.factions.to_vec();
        factions.swap(0, 1);
        let d = records::Definition {
            factions: &factions,
            ..base
        };
        assert_records_changed(baseline, &d, "faction ordering");
    }
    {
        let factions = &base.factions[..4];
        let d = records::Definition { factions, ..base };
        assert_records_changed(baseline, &d, "faction slice length");
    }
    {
        let d = records::Definition {
            terrain_ice: base.terrain_ice + 1,
            ..base
        };
        assert_records_changed(baseline, &d, "terrain_ice");
    }
}

#[test]
fn terrain_gate_identity_covers_all_ordered_tables_and_thresholds() {
    let base = terrain_gate::default_definition();
    let baseline = terrain_hash(&base);
    assert_eq!(baseline, content_hash());
    let terrain_gate::TerrainGateDefinition {
        kinds: _,
        props: _,
        ice: _,
        spawn_hazard_half: _,
        loot_hazard_half: _,
        camp_hazard_half: _,
    } = base;
    assert_eq!(base.kinds.len(), 8);
    assert_eq!(base.props.len(), 34);

    for kind in base.kinds {
        let terrain_gate::TerrainKind {
            key: _,
            tile: _,
            home: _,
        } = *kind;
    }
    for prop in base.props {
        let terrain_gate::PropKind {
            key: _,
            on: _,
            home: _,
        } = *prop;
    }

    for index in 0..base.kinds.len() {
        let original = base.kinds[index];
        let cases = [
            terrain_gate::TerrainKind {
                key: "alternate_kind",
                ..original
            },
            terrain_gate::TerrainKind {
                tile: original.tile.map_or(Some(0), |v| Some(v.wrapping_add(1))),
                ..original
            },
            terrain_gate::TerrainKind {
                home: original.home.map_or(Some(0), |v| Some(v.wrapping_add(1))),
                ..original
            },
        ];
        for (field, changed) in ["key", "tile", "home"].into_iter().zip(cases) {
            let mut kinds = base.kinds.to_vec();
            kinds[index] = changed;
            let d = terrain_gate::TerrainGateDefinition {
                kinds: &kinds,
                ..base
            };
            assert_terrain_changed(baseline, &d, &format!("kind {index} {field}"));
        }

        if original.tile.is_some() {
            let mut kinds = base.kinds.to_vec();
            kinds[index] = terrain_gate::TerrainKind {
                tile: None,
                ..original
            };
            let d = terrain_gate::TerrainGateDefinition {
                kinds: &kinds,
                ..base
            };
            assert_terrain_changed(baseline, &d, &format!("kind {index} tile Some to None"));
        }
        if original.home.is_some() {
            let mut kinds = base.kinds.to_vec();
            kinds[index] = terrain_gate::TerrainKind {
                home: None,
                ..original
            };
            let d = terrain_gate::TerrainGateDefinition {
                kinds: &kinds,
                ..base
            };
            assert_terrain_changed(baseline, &d, &format!("kind {index} home Some to None"));
        }
    }
    {
        let mut kinds = base.kinds.to_vec();
        kinds.swap(0, 1);
        let d = terrain_gate::TerrainGateDefinition {
            kinds: &kinds,
            ..base
        };
        assert_terrain_changed(baseline, &d, "kind ordering");
    }
    {
        let kinds = &base.kinds[..7];
        let d = terrain_gate::TerrainGateDefinition { kinds, ..base };
        assert_terrain_changed(baseline, &d, "kind slice length");
    }

    for index in 0..base.props.len() {
        let original = base.props[index];
        let mut props = base.props.to_vec();
        props[index] = terrain_gate::PropKind {
            key: "alternate_prop",
            ..original
        };
        let d = terrain_gate::TerrainGateDefinition {
            props: &props,
            ..base
        };
        assert_terrain_changed(baseline, &d, &format!("prop {index} key"));

        props[index] = terrain_gate::PropKind {
            on: original.on.wrapping_add(1),
            ..original
        };
        let d = terrain_gate::TerrainGateDefinition {
            props: &props,
            ..base
        };
        assert_terrain_changed(baseline, &d, &format!("prop {index} on"));

        props[index] = terrain_gate::PropKind {
            home: None,
            ..original
        };
        let d = terrain_gate::TerrainGateDefinition {
            props: &props,
            ..base
        };
        assert_terrain_changed(baseline, &d, &format!("prop {index} home"));
        props[index] = terrain_gate::PropKind {
            home: Some(if original.home == Some(Zone::Fire) {
                Zone::Holy
            } else {
                Zone::Fire
            }),
            ..original
        };
        let d = terrain_gate::TerrainGateDefinition {
            props: &props,
            ..base
        };
        assert_terrain_changed(baseline, &d, &format!("prop {index} home identity"));
    }
    {
        let mut props = base.props.to_vec();
        props.swap(0, 1);
        let d = terrain_gate::TerrainGateDefinition {
            props: &props,
            ..base
        };
        assert_terrain_changed(baseline, &d, "prop ordering");
    }
    {
        let props = &base.props[..33];
        let d = terrain_gate::TerrainGateDefinition { props, ..base };
        assert_terrain_changed(baseline, &d, "prop slice length");
    }
    {
        let d = terrain_gate::TerrainGateDefinition {
            ice: base.ice + 1,
            ..base
        };
        assert_terrain_changed(baseline, &d, "ice");
    }
    for (name, field) in [
        ("spawn_hazard_half", 0),
        ("loot_hazard_half", 1),
        ("camp_hazard_half", 2),
    ] {
        let mut d = base;
        match field {
            0 => d.spawn_hazard_half = -3,
            1 => d.loot_hazard_half = -3,
            _ => d.camp_hazard_half = -3,
        }
        assert_terrain_changed(baseline, &d, name);
    }
}
