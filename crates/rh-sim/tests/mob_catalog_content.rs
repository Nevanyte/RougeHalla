//! Aggregate identity coverage for the exact catalog definition consumed by the roster helpers.
//! Every candidate changes the supplied actual Definition; no shadow catalog or alternate hash.
use rh_sim::{
    content::{content_hash, content_hash_of_mob_catalog_definition, REGISTRY, STAGGER_WEAPONS},
    mob_catalog::{
        Definition, MobRole, MobRoleDef, MobTag, MobTypeDef, RegionDef, Rules, DEFINITION,
    },
    FactionId, WeaponId,
};

fn hash(definition: &Definition) -> u64 {
    content_hash_of_mob_catalog_definition(REGISTRY, STAGGER_WEAPONS, definition)
}

fn assert_moves(base: &Definition, candidate: &Definition, label: &str) {
    assert_ne!(candidate, base, "ineffective perturbation: {label}");
    assert_ne!(
        hash(candidate),
        hash(base),
        "aggregate identity missed {label}"
    );
}

fn other_role(id: MobRole) -> MobRole {
    if id == MobRole::Grunt {
        MobRole::Swarm
    } else {
        MobRole::Grunt
    }
}
fn other_zone(id: FactionId) -> FactionId {
    if id == FactionId::Fire {
        FactionId::Holy
    } else {
        FactionId::Fire
    }
}
fn other_weapon(id: WeaponId) -> WeaponId {
    if id == WeaponId::Sword {
        WeaponId::Bow
    } else {
        WeaponId::Sword
    }
}
fn other_text(text: &'static str) -> &'static str {
    if text == "aggregate-perturbation" {
        "aggregate-other"
    } else {
        "aggregate-perturbation"
    }
}
fn other_tag(tag: MobTag) -> MobTag {
    if tag == MobTag::Fast {
        MobTag::Fragile
    } else {
        MobTag::Fast
    }
}

#[test]
fn supplied_default_mob_catalog_uses_the_real_aggregate_path() {
    assert_eq!(hash(&DEFINITION), content_hash());
}

#[test]
fn every_mob_catalog_field_moves_aggregate_identity() {
    let base = DEFINITION;
    assert_eq!(hash(&base), content_hash());

    // No `..`: adding any production field requires an explicit identity coverage decision.
    let Definition {
        roles: _,
        types: _,
        regions: _,
        rules: _,
    } = base;
    let mut checked = 0;
    let mut check = |candidate: Definition, label: String| {
        assert_moves(&base, &candidate, &label);
        checked += 1;
    };

    for (i, row) in base.roles.iter().enumerate() {
        let MobRoleDef {
            id: _,
            label: _,
            hp_mult: _,
            dmg_mult: _,
            move_mult: _,
            tags: _,
            blurb: _,
        } = *row;
        let mut d = base;
        d.roles[i].id = other_role(row.id);
        check(d, format!("roles[{i}].id"));
        let mut d = base;
        d.roles[i].label = other_text(row.label);
        check(d, format!("roles[{i}].label"));
        let mut d = base;
        d.roles[i].hp_mult = row.hp_mult + 0.125;
        check(d, format!("roles[{i}].hp_mult"));
        let mut d = base;
        d.roles[i].dmg_mult = row.dmg_mult + 0.125;
        check(d, format!("roles[{i}].dmg_mult"));
        let mut d = base;
        d.roles[i].move_mult = row.move_mult + 0.125;
        check(d, format!("roles[{i}].move_mult"));
        let mut d = base;
        d.roles[i].tags = if row.tags == [MobTag::Fast] {
            &[MobTag::Ranged]
        } else {
            &[MobTag::Fast]
        };
        check(d, format!("roles[{i}].tags"));
        let mut d = base;
        d.roles[i].blurb = other_text(row.blurb);
        check(d, format!("roles[{i}].blurb"));
    }
    for (i, row) in base.types.iter().enumerate() {
        let MobTypeDef {
            id: _,
            zone: _,
            elite: _,
            name: _,
            role: _,
            weapon: _,
        } = *row;
        let mut d = base;
        // Pick another real typed ID from the actual definition, never a made-up catalog row.
        d.types[i].id = base.types[(i + 1) % base.types.len()].id;
        check(d, format!("types[{i}].id"));
        let mut d = base;
        d.types[i].zone = other_zone(row.zone);
        check(d, format!("types[{i}].zone"));
        let mut d = base;
        d.types[i].elite = !row.elite;
        check(d, format!("types[{i}].elite"));
        let mut d = base;
        d.types[i].name = other_text(row.name);
        check(d, format!("types[{i}].name"));
        let mut d = base;
        d.types[i].role = other_role(row.role);
        check(d, format!("types[{i}].role"));
        let mut d = base;
        d.types[i].weapon = other_weapon(row.weapon);
        check(d, format!("types[{i}].weapon"));
    }
    for (i, row) in base.regions.iter().enumerate() {
        let RegionDef {
            zone: _,
            names: _,
            weapon: _,
        } = *row;
        let mut d = base;
        d.regions[i].zone = other_zone(row.zone);
        check(d, format!("regions[{i}].zone"));
        for (name_index, &name) in row.names.iter().enumerate() {
            let mut d = base;
            d.regions[i].names[name_index] = other_text(name);
            check(d, format!("regions[{i}].names[{name_index}]"));
        }
        let mut d = base;
        d.regions[i].weapon = other_weapon(row.weapon);
        check(d, format!("regions[{i}].weapon"));
    }
    let Rules {
        bag_copies: _,
        melee_damage: _,
        ranged_damage: _,
        elite_damage: _,
    } = base.rules;
    let mut d = base;
    d.rules.bag_copies += 1;
    check(d, "rules.bag_copies".into());
    let mut d = base;
    d.rules.melee_damage += 0.125;
    check(d, "rules.melee_damage".into());
    let mut d = base;
    d.rules.ranged_damage += 0.125;
    check(d, "rules.ranged_damage".into());
    let mut d = base;
    d.rules.elite_damage += 0.125;
    check(d, "rules.elite_damage".into());
    assert_eq!(
        checked, 239,
        "update explicit coverage when the definition changes"
    );
}

#[test]
fn fixed_array_membership_and_order_move_aggregate_identity() {
    let base = DEFINITION;
    let mut checked = 0;
    // Array lengths are fixed by the accepted production types. Exercise each position's
    // membership and every adjacent ordering boundary without pretending lengths are mutable.
    for i in 0..base.roles.len() {
        let other = (i + 1) % base.roles.len();
        assert_ne!(base.roles[i], base.roles[other]);
        let mut d = base;
        d.roles[i] = base.roles[other];
        assert_moves(
            &base,
            &d,
            &format!("roles[{i}] duplicate actual row {other}"),
        );
        checked += 1;
    }
    for i in 0..base.roles.len() - 1 {
        let mut d = base;
        d.roles.swap(i, i + 1);
        assert_moves(&base, &d, &format!("roles order {i}/{}", i + 1));
        checked += 1;
    }
    for i in 0..base.types.len() {
        let other = (i + 1) % base.types.len();
        assert_ne!(base.types[i], base.types[other]);
        let mut d = base;
        d.types[i] = base.types[other];
        assert_moves(
            &base,
            &d,
            &format!("types[{i}] duplicate actual row {other}"),
        );
        checked += 1;
    }
    for i in 0..base.types.len() - 1 {
        let mut d = base;
        d.types.swap(i, i + 1);
        assert_moves(&base, &d, &format!("types order {i}/{}", i + 1));
        checked += 1;
    }
    for i in 0..base.regions.len() {
        let other = (i + 1) % base.regions.len();
        assert_ne!(base.regions[i], base.regions[other]);
        let mut d = base;
        d.regions[i] = base.regions[other];
        assert_moves(
            &base,
            &d,
            &format!("regions[{i}] duplicate actual row {other}"),
        );
        checked += 1;
    }
    for i in 0..base.regions.len() - 1 {
        let mut d = base;
        d.regions.swap(i, i + 1);
        assert_moves(&base, &d, &format!("regions order {i}/{}", i + 1));
        checked += 1;
    }
    assert_eq!(checked, 77); // 40 row membership changes + 37 adjacent swaps.
}

// The production field requires 'static. This test-only helper leaks at most eleven
// tiny slices (<=3 tags each); no production allocation or extra framework is introduced.
fn bounded_static_tags(tags: Vec<MobTag>) -> &'static [MobTag] {
    assert!(tags.len() <= 3, "review coverage if source role tags grow");
    Box::leak(tags.into_boxed_slice())
}

#[test]
fn actual_tag_lengths_contents_and_order_move_aggregate_identity() {
    let base = DEFINITION;
    let (mut lengths, mut contents, mut orderings) = (0, 0, 0);
    for (role_index, row) in base.roles.iter().enumerate() {
        let mut tags = row.tags.to_vec();
        tags.push(MobTag::Fast);
        let mut d = base;
        d.roles[role_index].tags = bounded_static_tags(tags);
        assert_moves(&base, &d, &format!("roles[{role_index}] tag length"));
        lengths += 1;

        for tag_index in 0..row.tags.len() {
            let mut tags = row.tags.to_vec();
            tags[tag_index] = other_tag(tags[tag_index]);
            let mut d = base;
            d.roles[role_index].tags = bounded_static_tags(tags);
            assert_moves(
                &base,
                &d,
                &format!("roles[{role_index}] tag[{tag_index}] content"),
            );
            contents += 1;
        }
        for tag_index in 0..row.tags.len().saturating_sub(1) {
            if row.tags[tag_index] == row.tags[tag_index + 1] {
                continue;
            }
            let mut tags = row.tags.to_vec();
            tags.swap(tag_index, tag_index + 1);
            let mut d = base;
            d.roles[role_index].tags = bounded_static_tags(tags);
            assert_moves(
                &base,
                &d,
                &format!(
                    "roles[{role_index}] tag order {tag_index}/{}",
                    tag_index + 1
                ),
            );
            orderings += 1;
        }
    }
    assert_eq!((lengths, contents, orderings), (5, 5, 1));
}
