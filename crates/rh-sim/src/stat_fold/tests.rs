use std::cell::Cell;

use super::*;

fn stat(stat: EffectStat, v: f64) -> EffectRow<'static> {
    EffectRow::new(EffectKind::Stat { stat, v })
}

fn flat(stat: FlatStat, v: f64) -> EffectRow<'static> {
    EffectRow::new(EffectKind::Flat { stat, v })
}

fn while_row(cond: WhileCond, stat: StatKey, v: f64) -> EffectRow<'static> {
    EffectRow::new(EffectKind::While(WhileRow {
        cond,
        arg: 0.25,
        stat,
        v,
        ms: Some(50.0),
    }))
}

fn convert(from: ConvertFrom, to: ConvertTo, per: f64) -> EffectRow<'static> {
    EffectRow::new(EffectKind::Convert {
        from,
        to,
        per,
        cap: None,
    })
}

fn mult(key: MultKey, v: f64) -> EffectRow<'static> {
    EffectRow::new(EffectKind::Mult { key, v })
}

fn flag(flag: EffectFlag) -> EffectRow<'static> {
    EffectRow::new(EffectKind::Flag { flag })
}

fn assert_bits(actual: f64, expected: f64) {
    assert_eq!(
        actual.to_bits(),
        expected.to_bits(),
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn identities_and_source_order_arrays_are_complete() {
    let zero = zero_sums();
    for (index, key) in StatKey::source_order().into_iter().enumerate() {
        assert_eq!(key.index(), index);
        assert_eq!(is_product_stat(key), key.is_product());
        assert_eq!(is_flat_stat(key), key.index() >= 16);
        assert_bits(zero.get(key), if key.is_product() { 1.0 } else { 0.0 });
        let mut changed = zero;
        changed.set(key, 7.0);
        assert_bits(changed.get(key), 7.0);
    }
    assert_eq!(StatSums::from_source_values(zero.source_values()), zero);

    let identity = identity_mults();
    for (index, key) in MultKey::source_order().into_iter().enumerate() {
        assert_eq!(key.index(), index);
        assert_bits(identity.get(key), 1.0);
        let mut changed = identity;
        changed.set(key, 3.0);
        assert_bits(changed.get(key), 3.0);
    }
    assert_eq!(
        MultSums::from_source_values(identity.source_values()),
        identity
    );
    assert_eq!(ConvertFrom::source_order().len(), 4);
    assert_eq!(ConvertTo::source_order().len(), 19);
    assert_eq!(WhileCond::source_order().len(), 6);
    assert_eq!(MirrorField::source_order().len(), 7);
}

#[test]
fn every_stat_uses_its_source_accumulation_rule() {
    for key in EffectStat::source_order() {
        let folded = fold_stat_rows(&[stat(key, 0.25), stat(key, 0.5)], &FoldContext::default());
        let key = StatKey::from(key);
        assert_bits(folded.get(key), if key.is_product() { 1.875 } else { 0.75 });
    }
    for key in FlatStat::source_order() {
        let folded = fold_stat_rows(&[flat(key, 2.0), flat(key, 3.0)], &FoldContext::default());
        assert_bits(folded.get(StatKey::from(key)), 5.0);
    }
    let mut sums = zero_sums();
    add_to_sums(&mut sums, StatKey::LifestealMult, 1.0);
    add_to_sums(&mut sums, StatKey::LifestealMult, 0.5);
    assert_bits(sums.lifesteal_mult, 3.0);
}

#[test]
fn requirements_default_false_only_for_nonempty_missing_ownership() {
    let absent = stat(EffectStat::Damage, 0.1);
    let empty = absent.with_requirements(&[]);
    let required = absent.with_requirements(&["glassFang", "bloodPact"]);
    assert!(requirements_met(&absent, None));
    assert!(requirements_met(&empty, None));
    assert!(!requirements_met(&required, None));
    assert!(!requirements_met(&required, Some(&|id| id == "glassFang")));
    assert!(requirements_met(&required, Some(&|_| true)));
}

#[test]
fn known_ignored_rows_and_farm_non_stat_rows_do_not_fold() {
    let ignored = [
        EffectRow::new(EffectKind::Vs),
        EffectRow::new(EffectKind::Scale),
        EffectRow::new(EffectKind::OnHit),
        EffectRow::new(EffectKind::Trigger),
    ];
    assert_eq!(
        fold_stat_rows(&ignored, &FoldContext::default()),
        zero_sums()
    );

    let farm = [
        convert(ConvertFrom::Ad, ConvertTo::Armor, 1.0),
        mult(MultKey::Hit, 9.0),
        flag(EffectFlag::NoCrit),
        stat(EffectStat::Damage, 0.5),
    ];
    let folded = fold_rows(
        &[flat(FlatStat::Ad, 10.0)],
        &FoldContext {
            farm_rows: &farm,
            ..Default::default()
        },
    );
    assert_bits(folded.farm_sums.damage, 0.5);
    assert_bits(folded.sums.armor, 0.0);
    assert_bits(folded.mults.hit, 1.0);
    assert!(folded.flags.is_empty());
}

#[test]
fn while_answers_are_row_location_specific_and_cover_all_conditions() {
    for condition in WhileCond::source_order() {
        let rows = [while_row(condition, StatKey::AttackSpeed, 0.25)];
        let yes = FoldContext {
            holds: Some(&|_, row| {
                assert_eq!(row.cond, condition);
                true
            }),
            ..Default::default()
        };
        let no = FoldContext {
            holds: Some(&|_, _| false),
            ..Default::default()
        };
        assert_bits(fold_stat_rows(&rows, &yes).attack_speed, 0.25);
        assert_bits(fold_stat_rows(&rows, &no).attack_speed, 0.0);
    }

    let rows = [
        while_row(WhileCond::HpBelow, StatKey::Armor, 2.0),
        while_row(WhileCond::HpBelow, StatKey::Armor, 3.0),
    ];
    let farm = [while_row(WhileCond::HpBelow, StatKey::Armor, 5.0)];
    let context = FoldContext {
        holds: Some(&|location, _| {
            location == RowLocation::new(RowList::Effects, 1)
                || location == RowLocation::new(RowList::Farm, 0)
        }),
        farm_rows: &farm,
        ..Default::default()
    };
    let folded = fold_rows(&rows, &context);
    assert_bits(folded.plain.armor, 3.0);
    assert_bits(folded.farm_sums.armor, 5.0);
}

#[test]
fn failed_requirements_prevent_the_while_callback() {
    let calls = Cell::new(0);
    let rows =
        [while_row(WhileCond::Unarmed, StatKey::Damage, 1.0).with_requirements(&["missing"])];
    let context = FoldContext {
        holds: Some(&|_, _| {
            calls.set(calls.get() + 1);
            true
        }),
        ..Default::default()
    };
    assert_eq!(fold_stat_rows(&rows, &context), zero_sums());
    assert_eq!(calls.get(), 0);
}

#[test]
fn conversions_use_original_snapshots_and_product_target_is_a_noop() {
    let rows = [
        flat(FlatStat::Ad, 40.0),
        stat(EffectStat::AttackSpeed, 0.2),
        convert(ConvertFrom::BonusAttackSpeed, ConvertTo::Ad, 100.0),
        convert(ConvertFrom::Ad, ConvertTo::Armor, 0.25),
        convert(ConvertFrom::Ad, ConvertTo::LifestealMult, 100.0),
    ];
    let farm = [flat(FlatStat::Ad, 10.0)];
    let folded = fold_rows(
        &rows,
        &FoldContext {
            farm_rows: &farm,
            ..Default::default()
        },
    );
    assert_bits(folded.sums.ad, 60.0);
    assert_bits(folded.sums.armor, 12.5);
    assert_bits(folded.sums.lifesteal_mult, 1.0);
    assert_bits(folded.plain.ad, 40.0);
    assert_bits(folded.farm_sums.ad, 10.0);

    for target in ConvertTo::source_order() {
        let folded = fold_rows(
            &[
                flat(FlatStat::Ad, 2.0),
                convert(ConvertFrom::Ad, target, 1.0),
            ],
            &FoldContext::default(),
        );
        let key = target.stat_key();
        let expected = if key.is_product() {
            1.0
        } else if key == StatKey::Ad {
            4.0
        } else if key == StatKey::MoveSpeed {
            0.3
        } else {
            2.0
        };
        assert_bits(folded.sums.get(key), expected);
    }
}

#[test]
fn conversion_inputs_and_caps_follow_source_order() {
    let rows = [
        stat(EffectStat::AttackSpeed, 0.8),
        stat(EffectStat::MoveSpeed, 0.55),
        convert(ConvertFrom::BonusAttackSpeed, ConvertTo::Ap, 100.0),
        convert(ConvertFrom::BonusMoveSpeed, ConvertTo::Damage, 2.0),
    ];
    let folded = fold_rows(&rows, &FoldContext::default());
    assert_bits(folded.sums.ap, 50.0);
    assert_bits(folded.sums.damage, 0.6);
    assert_bits(folded.sums.attack_speed, 0.8);
    assert_bits(folded.sums.move_speed, 0.3);

    let capped = fold_rows(
        &[
            flat(FlatStat::Ad, 400.0),
            flat(FlatStat::Ap, 12.0),
            convert(ConvertFrom::Ad, ConvertTo::Ad, 1.0),
            convert(ConvertFrom::Ad, ConvertTo::Ap, 1.0),
            mult(MultKey::Ap, 1.5),
        ],
        &FoldContext::default(),
    );
    assert_bits(capped.sums.ad, 460.0);
    assert_bits(capped.sums.ap, 108.0);
    assert_bits(capped.plain.ap, 12.0);
}

#[test]
fn max_hp_and_mult_guards_preserve_special_float_behavior() {
    assert_bits(folded_max_hp(1000.0, -0.25), 750.0);
    assert_bits(folded_max_hp(1000.0, -0.9), 500.0);
    assert_bits(folded_max_hp(0.0, 0.5), 0.0);
    assert_bits(folded_max_hp(f64::NAN, 0.5), 0.0);
    assert!(folded_max_hp(1000.0, f64::NAN).is_nan());

    let folded = fold_rows(
        &[
            mult(MultKey::AsPost, 0.1),
            mult(MultKey::Hit, 4.0),
            mult(MultKey::WishCooldown, 0.2),
            mult(MultKey::HpRace, 9.0),
            mult(MultKey::Dot, f64::NAN),
            mult(MultKey::Returned, -0.0),
            mult(MultKey::Linger, -2.0),
        ],
        &FoldContext::default(),
    );
    assert_bits(folded.mults.as_post, 0.5);
    assert_bits(folded.mults.hit, 2.5);
    assert_bits(folded.mults.wish_cooldown, 0.5);
    assert_bits(folded.mults.hp_race, 2.5);
    assert_bits(folded.mults.dot, 0.0);
    assert_bits(folded.mults.returned, -0.0);
    assert_bits(folded.mults.linger, 0.0);
}

#[test]
fn flags_keep_first_insertion_order() {
    let folded = fold_rows(
        &[
            flag(EffectFlag::NoCrit),
            flag(EffectFlag::LockSecondSlot),
            flag(EffectFlag::NoCrit),
        ],
        &FoldContext::default(),
    );
    assert_eq!(
        folded.flags.as_slice(),
        &[EffectFlag::NoCrit, EffectFlag::LockSecondSlot]
    );
    for expected in EffectFlag::source_order() {
        let folded = fold_rows(&[flag(expected)], &FoldContext::default());
        assert!(folded.flags.contains(expected));
    }
}

#[test]
fn boosts_iterate_source_arithmetic_and_use_one_pre_boost_sheet() {
    assert_bits(chest_boost_bonus(0.0), 0.0);
    assert_bits(chest_boost_bonus(1.0), 0.2);
    assert_bits(chest_boost_bonus(2.0), 0.36000000000000004);
    assert_bits(chest_boost_bonus(3.0), 0.4880000000000001);
    assert_bits(chest_boost_bonus(9.0), 0.4880000000000001);
    assert_bits(chest_boost_bonus(2.9), 0.36000000000000004);
    assert_bits(chest_boost_bonus(f64::INFINITY), 0.0);
    assert_bits(chest_boost_bonus(f64::NAN), 0.0);
    assert_bits(
        chest_boost_gain(ChestBoostStat::Ad, 2.0, 25.0),
        9.000000000000002,
    );
    assert!(chest_boost_gain(ChestBoostStat::Ad, 1.0, f64::NAN).is_nan());

    let mut boosts = BoostCounts::default();
    boosts.set(ChestBoostStat::Ad, 2.0);
    let folded = fold_rows(
        &[flat(FlatStat::Ad, 25.0)],
        &FoldContext {
            boosts: Some(&boosts),
            ..Default::default()
        },
    );
    assert_bits(folded.farm_sums.ad, 9.000000000000002);

    let mut hp_boost = BoostCounts::default();
    hp_boost.set(ChestBoostStat::MaxHp, 1.0);
    let hp = fold_rows(
        &[],
        &FoldContext {
            base_max_hp: 1000.0,
            boosts: Some(&hp_boost),
            ..Default::default()
        },
    );
    assert_bits(hp.max_hp, 1030.0);
}

#[test]
fn farm_and_sources_stay_outside_row_ceilings() {
    let effects = [
        stat(EffectStat::AttackSpeed, 1.0),
        stat(EffectStat::MoveSpeed, 0.5),
        flat(FlatStat::Armor, 300.0),
        flat(FlatStat::Shield, 300.0),
        flat(FlatStat::Ad, 5.0),
        flat(FlatStat::Ap, 10.0),
        stat(EffectStat::MaxHp, 0.1),
        mult(MultKey::Ap, 2.0),
        EffectRow::new(EffectKind::Convert {
            from: ConvertFrom::Ad,
            to: ConvertTo::Ap,
            per: 1.0,
            cap: Some(60.0),
        }),
    ];
    let farm = [
        stat(EffectStat::AttackSpeed, 2.0),
        stat(EffectStat::MoveSpeed, 1.0),
        flat(FlatStat::Armor, 1000.0),
        flat(FlatStat::Shield, 1200.0),
        flat(FlatStat::Ad, 100.0),
        flat(FlatStat::Ap, 100.0),
        stat(EffectStat::MaxHp, 0.5),
        stat(EffectStat::Damage, 20.0),
    ];
    let folded = fold_rows(
        &effects,
        &FoldContext {
            base_max_hp: 1000.0,
            farm_rows: &farm,
            ..Default::default()
        },
    );
    let mirrors = mirrors_from_fold_with_sources(
        &folded,
        &SourceMods {
            as_mult: 0.5,
            speed_mult: 0.5,
            windup_mult: 1.0,
            armor: 40.0,
            shield: 40.0,
        },
        1.0,
    );
    assert_bits(folded.max_hp, 1600.0);
    assert_bits(folded.farm_sums.damage, 20.0);
    assert_bits(mirrors.as_mult, 2.0);
    assert_bits(mirrors.speed_mult, 1.15);
    assert_bits(mirrors.armor_bonus, 1200.0);
    assert_bits(mirrors.shield_bonus, 1400.0);
    assert_bits(mirrors.ad_bonus, 105.0);
    assert_bits(mirrors.ap_bonus, 340.0);
}

#[test]
fn attack_speed_cap_precedes_as_post_and_efficiency_only_scales_positive_rows() {
    let folded = fold_rows(
        &[
            stat(EffectStat::AttackSpeed, 0.5),
            mult(MultKey::AsPost, 2.0),
        ],
        &FoldContext {
            farm_rows: &[stat(EffectStat::AttackSpeed, 0.1)],
            ..Default::default()
        },
    );
    let compressed = mirrors_from_fold_with_sources(&folded, &no_source_mods(), 0.1);
    assert_bits(compressed.as_mult, 2.12);

    let slowed = fold_rows(
        &[stat(EffectStat::AttackSpeed, -0.25)],
        &FoldContext {
            farm_rows: &[stat(EffectStat::AttackSpeed, -0.1)],
            ..Default::default()
        },
    );
    assert_bits(
        mirrors_from_fold_with_sources(&slowed, &no_source_mods(), 0.0).as_mult,
        0.65,
    );
    assert!(cap_as_mult(f64::NAN).is_nan());
}

#[test]
fn js_min_max_preserve_nan_and_signed_zero() {
    assert!(js::min(f64::NAN, 1.0).is_nan());
    assert!(js::max(1.0, f64::NAN).is_nan());
    assert_bits(js::min(0.0, -0.0), -0.0);
    assert_bits(js::min(-0.0, 0.0), -0.0);
    assert_bits(js::max(0.0, -0.0), 0.0);
    assert_bits(js::max(-0.0, -0.0), -0.0);
}

#[test]
fn mult_codec_preserves_half_up_overflow_nonfinite_and_missing_behavior() {
    assert_bits(encode_mult(1.2345678901234567), 1235.0);
    assert_bits(encode_mult(0.0), 50.0);
    assert_bits(encode_mult(-3.0), 50.0);
    assert_bits(encode_mult(1e9), 1e12);
    assert_bits(encode_mult(f64::NAN), 1000.0);
    assert_bits(encode_mult(f64::INFINITY), 1000.0);
    assert_bits(encode_mult(f64::MAX), f64::MAX);
    assert_bits(decode_mult(1235.0), 1.235);
    assert_bits(decode_mult(-0.0), -0.0);
    assert_bits(decode_mult(f64::NAN), 1.0);
    assert_bits(decode_mult(f64::INFINITY), 1.0);
    assert_bits(decode_mult(None::<f64>), 1.0);
}

#[test]
fn flat_codec_preserves_negative_ties_wide_values_and_special_floats() {
    for (value, wire) in [
        (0.0, 0.0),
        (0.04, 0.0),
        (0.05, 1.0),
        (7.86, 79.0),
        (-7.86, -79.0),
        (-0.06, -1.0),
        (12.34, 123.0),
        (1e9, 1e10),
    ] {
        assert_bits(encode_flat(value), wire);
    }
    assert_bits(encode_flat(f64::NAN), 0.0);
    assert_bits(encode_flat(f64::NEG_INFINITY), 0.0);
    assert_bits(encode_flat(f64::MAX), f64::MAX);
    assert_bits(encode_flat(-f64::MAX), -f64::MAX);
    assert_bits(decode_flat(79.0), 7.9);
    assert_bits(decode_flat(-0.0), -0.0);
    assert!(decode_flat(f64::NAN).is_nan());
    assert_bits(decode_flat(f64::INFINITY), f64::INFINITY);
    assert!(decode_flat(None::<f64>).is_nan());
}

#[test]
fn complete_mirror_codec_uses_source_field_order() {
    let mirrors = StatMirrors {
        as_mult: 0.75,
        windup_mult: 1.12,
        speed_mult: 1.3,
        armor_bonus: 12.3,
        shield_bonus: -4.0,
        ad_bonus: 33.0,
        ap_bonus: 7.86,
    };
    let encoded = encode_mirrors(&mirrors);
    assert_eq!(
        encoded.source_values(),
        [750.0, 1120.0, 1300.0, 123.0, -40.0, 330.0, 79.0]
    );
    assert_eq!(
        decode_mirrors(&encoded).source_values(),
        [0.75, 1.12, 1.3, 12.3, -4.0, 33.0, 7.9]
    );
    assert_eq!(
        wire_identity_mirrors().source_values(),
        [1000.0, 1000.0, 1000.0, 0.0, 0.0, 0.0, 0.0]
    );
    assert_eq!(
        StatMirrors::from_source_values(mirrors.source_values()),
        mirrors
    );
    assert_eq!(
        WireMirrors::from_source_values(encoded.source_values()),
        encoded
    );
}

#[test]
fn content_visitor_mutates_every_numeric_field_in_fixed_order() {
    let base = default_definition();
    let mut original = Vec::new();
    visit_content(&base, |word| original.push(word));
    assert_eq!(original.len(), 33);
    assert_eq!(original[0], 1.5f64.to_bits());
    assert_eq!(original[16], 3);

    macro_rules! changed {
        ($field:ident) => {{
            let mut definition = base;
            definition.$field += 1.0;
            let mut words = Vec::new();
            visit_content(&definition, |word| words.push(word));
            assert_ne!(words, original, stringify!($field));
        }};
    }
    changed!(as_mult_cap);
    changed!(as_post_max);
    changed!(as_post_min);
    changed!(bonus_defense_cap);
    changed!(convert_ad_ap_cap);
    changed!(hp_race_cap);
    changed!(lifesteal_cap);
    changed!(max_hp_floor_share);
    changed!(move_bonus_cap);
    changed!(mod_mult_min);
    changed!(outgoing_row_cap);
    changed!(wish_cooldown_mult_min);
    changed!(mult_wire_per_unit);
    changed!(flat_wire_per_point);
    changed!(chest_boost_step);
    changed!(chest_boost_decay);

    let mut definition = base;
    definition.chest_boost_max_picks += 1;
    let mut words = Vec::new();
    visit_content(&definition, |word| words.push(word));
    assert_ne!(words, original);

    for stat in ChestBoostStat::source_order() {
        let mut definition = base;
        definition.chest_boosts[stat.index()].floor += 1.0;
        let mut words = Vec::new();
        visit_content(&definition, |word| words.push(word));
        assert_ne!(words, original, "{stat:?} floor");

        let mut definition = base;
        definition.chest_boosts[stat.index()].ceiling += 1.0;
        words.clear();
        visit_content(&definition, |word| words.push(word));
        assert_ne!(words, original, "{stat:?} ceiling");
    }
}
